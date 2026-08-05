# Topic 10: Production

> **How do I package and run my .NET app in production?**

This topic covers Docker (packaging your app), docker-compose (running multiple services together), and environment variables (configuring your app for different environments).

---

## Why Docker?

Docker packages your app and all its requirements into a single "image" (a file that contains everything needed to run your app). This means:

- "It works on my machine" → "It works anywhere Docker runs"
- Same image runs in dev, staging, and production
- Easy to deploy: just copy the image to the server

---

## Docker basics

### Key terms

| Term | What it means |
|------|---------------|
| **Image** | A packaged app with all its files and settings (like a template) |
| **Container** | A running instance of an image (like an object from a class) |
| **Dockerfile** | Instructions for building an image |
| **docker-compose.yml** | Instructions for running multiple containers together |

### Node.js to .NET comparison

| Node.js | .NET |
|---------|------|
| `FROM node:20` | `FROM mcr.microsoft.com/dotnet/aspnet:10.0` |
| `npm ci` | `dotnet restore` |
| `npm run build` | `dotnet publish -c Release` |
| `node dist/server.js` | `dotnet MyApp.dll` |
| `process.env.PORT` | `Environment.GetEnvironmentVariable("PORT")` or config |

---

## The Dockerfile

A Dockerfile has two stages:
1. **Build stage**: Install tools, restore packages, compile the code
2. **Runtime stage**: Copy only what's needed to run the app (smaller image)

```dockerfile
# ==== Stage 1: Build ====
# Use the SDK image (has compilers and build tools)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project files and restore packages
COPY *.sln .
COPY src/PaymentApp.Domain/*.csproj src/PaymentApp.Domain/
COPY src/PaymentApp.Application/*.csproj src/PaymentApp.Application/
COPY src/PaymentApp.Infrastructure/*.csproj src/PaymentApp.Infrastructure/
COPY src/PaymentApp.Api/*.csproj src/PaymentApp.Api/
RUN dotnet restore

# Copy everything else and build
COPY . .
RUN dotnet publish src/PaymentApp.Api -c Release -o /app/publish

# ==== Stage 2: Runtime ====
# Use the smaller runtime image (no compilers)
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .

# Tell the app to listen on port 8080
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

# Run the app
ENTRYPOINT ["dotnet", "PaymentApp.Api.dll"]
```

**Why two stages?**

| Stage | Image size | What it has |
|-------|------------|-------------|
| SDK (build) | ~900 MB | Compilers, build tools, NuGet |
| Runtime | ~200 MB | Just what's needed to run |

The final image only contains the runtime stage, so it's much smaller.

---

## docker-compose.yml

docker-compose lets you run multiple containers together. For PaymentApp, we need:
- The database (PostgreSQL)
- Our API

```yaml
version: '3.8'

services:
  # PostgreSQL database
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: payapp
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: payapp
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data

  # Our API
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      # Database connection (use "db" as hostname — that's the service name)
      ConnectionStrings__PaymentDb: "Host=db;Database=payapp;Username=payapp;Password=devpass"
      # JWT settings
      Jwt__Key: "production-secret-key-at-least-32-characters!"
      Jwt__Issuer: "paymentapp"
    depends_on:
      - db

volumes:
  db_data:
```

**Key points:**

| Setting | What it does |
|---------|--------------|
| `depends_on: [db]` | Start the database before the API |
| `Host=db` | Use "db" as the hostname (the service name in compose) |
| `volumes: db_data` | Keep database data when the container restarts |
| `ports: "8080:8080"` | Map port 8080 on your machine to port 8080 in the container |

---

## Environment variables

In .NET, environment variables override config file settings. This lets you use one image with different settings per environment.

### How .NET config works

Settings are loaded in layers. Later layers override earlier ones:

```
1. appsettings.json            (base settings)
2. appsettings.Development.json (dev-only settings)
3. Environment variables       (override everything)
```

### Environment variable naming

Config keys use `:` but environment variables use `__` (double underscore):

| Config path | Environment variable |
|-------------|---------------------|
| `ConnectionStrings:PaymentDb` | `ConnectionStrings__PaymentDb` |
| `Jwt:Key` | `Jwt__Key` |
| `Logging:LogLevel:Default` | `Logging__LogLevel__Default` |

### Reading config in code

```csharp
// In Program.cs — it's already set up
var connectionString = builder.Configuration.GetConnectionString("PaymentDb");

// In a service — inject IConfiguration
public class MyService
{
    private readonly string _apiKey;

    public MyService(IConfiguration config)
    {
        _apiKey = config["ExternalApi:Key"]
            ?? throw new InvalidOperationException("ExternalApi:Key not configured");
    }
}
```

---

## The "localhost lie"

:::caution
Don't use `localhost` inside a container to reach another container. It doesn't point where you think.
:::

```
Your machine:  localhost = your machine
Container:     localhost = inside the container (not your machine!)
```

**Example:**

```yaml
# ❌ WRONG — "localhost" means inside the API container, not the db container
ConnectionStrings__PaymentDb: "Host=localhost;Database=payapp;..."

# ✅ CORRECT — use the service name
ConnectionStrings__PaymentDb: "Host=db;Database=payapp;..."
```

Docker creates a network where services can find each other by name. `db` is the name of the database service. Use that instead.

---

## Calling an external payment processor

Back in Topic 7, we protected the transfer with a `static SemaphoreSlim` — a **mutex inside one process**. That's correct for exactly one API instance. But the whole point of Docker + compose is that scaling out is trivial. The moment you run a second replica, the guarantee evaporates:

```
   Replica A            Replica B
 ┌───────────┐        ┌───────────┐
 │ _gate  #A │        │ _gate  #B │   ← two different semaphore objects!
 └─────┬─────┘        └─────┬─────┘
       └──────────┬─────────┘
                  ▼
            one shared DB      ← both read Balance=1000, both subtract 100,
                                 the race Topic 7 "fixed" is back
```

Each replica has its **own** `_gate`. A semaphore only coordinates threads *within its own process* — it knows nothing about the other container. Topic 7 flagged exactly this and pointed here for the real fix.

### The fix: make the write atomic in the database

The durable fix is to stop doing read-check-write in application memory and let the **database** do it in one indivisible statement:

```sql
UPDATE "Users"
   SET "Balance" = "Balance" - @amount
 WHERE "Id" = @userId
   AND "Balance" >= @amount      -- the guard: only succeeds if funds exist
 RETURNING "Balance";
```

There is no window between the check and the write — Postgres evaluates the `WHERE` and applies the `SET` as a single locked row operation. Run it from 1 replica or 50 and it stays correct, with **no application lock at all**. This is the "database row lock / conditional update" Topic 7 promised.

### Why a separate service?

In real payment systems, the code that actually moves money is usually a **dedicated, narrowly-scoped service**. It's often PCI-scoped, separately audited, and deployed on its own cadence — everything else calls it over HTTP. PaymentApp models that with a tiny **payment-processor** that owns the balance mutation and exposes two endpoints:

| Endpoint | Body | Returns | What it does |
|----------|------|---------|--------------|
| `POST /v1/withdraw` | `{ userId, amount }` | `{ transactionId, balance }` | The atomic conditional `UPDATE` above. `400` if insufficient funds |
| `POST /v1/deposit`  | `{ userId, amount }` | `{ transactionId, balance }` | Atomic `UPDATE ... SET "Balance" = "Balance" + amount` |

It happens to be a ~40-line Node/Express service — a fitting bookend, since that's the world you came from. Nothing about the pattern is Node-specific; it's just a service that owns one job. Each successful call returns a `transactionId` — the **external system's** reference for that movement, which PaymentApp stores on its ledger.

### The .NET side: a typed client over `IHttpClientFactory`

PaymentApp calls the processor with a **named** `HttpClient` (Topic 8's `IHttpClientFactory`), with the base address coming from config:

```csharp
builder.Services.AddHttpClient("processor", client =>
{
    client.BaseAddress = new Uri(builder.Configuration["PaymentProcessor:BaseUrl"]!);
});
```

This is where the **"localhost lie" bites again**. In compose, the base URL is `http://processor:4000` — the **service name**, not `localhost`. Inside the api container, `localhost` is the api container itself; the processor lives at hostname `processor`.

Your mental anchor is `fetch`/`axios` for `HttpClient`. A named client is just a pre-configured axios instance (`axios.create({ baseURL })`) that DI hands you, already wired.

### PaymentApp as the merchant: the Transaction ledger

The processor owns *balances*; PaymentApp owns the *record*. It sits in the middle as the merchant, and writes a `Transaction` row per processor call. One transfer produces **two** ledger rows — a `Withdraw` leg for the payer, a `Deposit` leg for the payee — sharing one `TransferId`. Each row runs a small lifecycle:

```
Pending ──(processor answers)──▶ Successful | Failed
```

The row is created `Pending` *before* the HTTP call, so the intent is durable. Once the processor responds, it flips to `Successful` or `Failed` — stamped with the `ExternalTransactionId` it returned, with the raw reply kept verbatim in a `jsonb` column for audit. Enums (`Type`, `Status`) are stored as **text** (`HasConversion<string>()`), so `psql` reads `Pending`/`Withdraw` and reordering the enum can't silently change stored meaning. This "write intent, then confirm" shape is the seed of the outbox pattern (Topic 12).

### Honest tradeoff — this fixes the balance race, not cross-account atomicity

A transfer is now **two** calls: withdraw from the payer, then deposit to the payee. Each call is atomic on its own row, and both survive multiple replicas — but the *pair* is not one transaction.

:::danger
If the deposit fails after the withdraw succeeds, money has left the payer and not arrived. PaymentApp keeps this simple — it compensates by refunding the payer on failure — but the production-grade answer is **idempotency keys + a compensating transaction, or the outbox pattern**, so the two steps reliably reconcile. That's exactly the territory Topic 12 covers.
:::

---

## Running with Docker

### Build and run with compose

```bash
# Start everything (builds if needed)
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs api
docker-compose logs db

# Stop everything
docker-compose down

# Stop and remove data
docker-compose down -v
```

### Common commands

| Command | What it does |
|---------|--------------|
| `docker-compose up` | Start all services |
| `docker-compose up -d` | Start in background |
| `docker-compose down` | Stop all services |
| `docker-compose down -v` | Stop and delete volumes (data) |
| `docker-compose logs <service>` | View logs for a service |
| `docker-compose exec db psql -U payapp -d payapp` | Run a command in a container |
| `docker-compose build` | Rebuild images |

---

## EF Core migrations in Docker

When using Docker, you need to apply database migrations. There are several approaches:

### Option 1: Apply migrations on startup (simple, good for dev)

Add to `Program.cs`:

```csharp
// After Build()
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    db.Database.Migrate();  // Apply any pending migrations
}
```

**Pros:** Simple, always up to date
**Cons:** Every instance tries to migrate (need locking for multiple replicas)

### Option 2: Run migrations before starting (good for production)

Create a separate migration step in CI/CD:

```bash
# Run migrations as a one-time job
dotnet ef database update --connection "Host=db;Database=payapp;..."
```

**Pros:** Controlled, single writer
**Cons:** More setup

---

## Health checks

Health checks let you verify your app is working. Kubernetes and load balancers use these.

```csharp
// In Program.cs
builder.Services.AddHealthChecks()
    .AddNpgSql(builder.Configuration.GetConnectionString("PaymentDb")!);

// Later
app.MapHealthChecks("/health");
```

Now `GET /health` returns:
- `200 OK` if the app and database are working
- `503 Service Unavailable` if something is wrong

---

## The .dockerignore file

Like `.gitignore`, but for Docker. Prevents unnecessary files from being copied:

```
bin/
obj/
.git/
.vs/
.vscode/
*.md
Dockerfile
docker-compose.yml
```

This makes builds faster and images smaller.

---

## Summary: dev vs production

| Aspect | Development | Production |
|--------|-------------|------------|
| Database | `docker-compose up db` | Managed service (RDS, Cloud SQL) |
| Config | `appsettings.Development.json` | Environment variables |
| Secrets | Plain text in config | Secret manager (Vault, AWS Secrets) |
| JWT key | Same for everyone | Rotated, stored securely |
| Migrations | Auto on startup | CI/CD pipeline |
| Transfer safety | In-process `SemaphoreSlim` (1 replica) | External processor + atomic DB update (N replicas) |
| Logging | Console | Structured logging to a service |

---

## Recap

- "I use multi-stage Docker builds to keep the final image small — only the runtime, not the SDK."
- "docker-compose is for local dev with multiple services. In production, I'd use Kubernetes or a managed container service."
- "Environment variables override config files. I use `ConnectionStrings__PaymentDb` in compose to override `appsettings.json`."
- "The 'localhost lie' — inside a container, localhost means the container itself, not your machine. Use service names instead."
- "For migrations, I apply them in CI/CD before deploying, not on app startup, to avoid race conditions with multiple replicas."
- "In-process locks like `SemaphoreSlim` don't survive horizontal scaling — each replica has its own lock. I moved the money mutation behind a payment-processor service that does an atomic conditional `UPDATE ... WHERE Balance >= amount`, which stays correct with any number of replicas."
- "I call the processor through a named `HttpClient` with the base URL from config — `http://processor:4000`, the compose service name, not localhost."
