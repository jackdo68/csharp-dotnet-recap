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

**Common mistake:** Using `localhost` in containers.

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

Docker creates a network where services can find each other by name. `db` is the name of the database service, so use that.

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
| Logging | Console | Structured logging to a service |

---

## Interview talking points

- "I use multi-stage Docker builds to keep the final image small — only the runtime, not the SDK."
- "docker-compose is for local dev with multiple services. In production, I'd use Kubernetes or a managed container service."
- "Environment variables override config files. I use `ConnectionStrings__PaymentDb` in compose to override `appsettings.json`."
- "The 'localhost lie' — inside a container, localhost means the container itself, not your machine. Use service names instead."
- "For migrations, I apply them in CI/CD before deploying, not on app startup, to avoid race conditions with multiple replicas."
