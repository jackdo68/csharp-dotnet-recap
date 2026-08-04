# Topic 10: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint + Document upload → .NET Standard Library → Authentication → **Production**

Topic 9 added authentication. This topic packages PaymentApp for production using Docker.

**Prerequisites:** Complete Topic 9 hands-on (working authentication).

---

## Exercise 10.1 — Create the Dockerfile

**Task:** Create a Dockerfile that builds and runs PaymentApp.

**Solution**

Create `Dockerfile` in the root folder (same level as `PaymentApp.sln`):

```dockerfile
# ==================================================
# Stage 1: Build
# ==================================================
# Use the SDK image (has compilers and build tools)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project files first (for better caching)
# If these don't change, Docker won't re-download packages
COPY *.sln .
COPY src/PaymentApp.Domain/*.csproj src/PaymentApp.Domain/
COPY src/PaymentApp.Application/*.csproj src/PaymentApp.Application/
COPY src/PaymentApp.Infrastructure/*.csproj src/PaymentApp.Infrastructure/
COPY src/PaymentApp.Api/*.csproj src/PaymentApp.Api/

# Restore packages (download dependencies)
RUN dotnet restore

# Copy all source code
COPY . .

# Build the app in Release mode
# -c Release = Release configuration (optimized)
# -o /app/publish = output to /app/publish folder
RUN dotnet publish src/PaymentApp.Api -c Release -o /app/publish

# ==================================================
# Stage 2: Runtime
# ==================================================
# Use the smaller runtime image (no compilers needed)
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app

# Copy the built app from the build stage
COPY --from=build /app/publish .

# Create a folder for uploads
RUN mkdir -p /app/uploads

# Tell ASP.NET to listen on port 8080
ENV ASPNETCORE_URLS=http://+:8080

# Document that we're using port 8080
EXPOSE 8080

# Run the app
ENTRYPOINT ["dotnet", "PaymentApp.Api.dll"]
```

**What each part does:**

| Line | What it does |
|------|--------------|
| `FROM ... AS build` | Start the build stage using the SDK image |
| `COPY *.csproj` | Copy project files (for package restore caching) |
| `RUN dotnet restore` | Download all NuGet packages |
| `RUN dotnet publish` | Compile the app and output to /app/publish |
| `FROM ... aspnet` | Start the runtime stage (smaller image) |
| `COPY --from=build` | Copy the built app from the build stage |
| `ENTRYPOINT` | The command to run when the container starts |

---

## Exercise 10.2 — Create .dockerignore

**Task:** Create a .dockerignore file to exclude unnecessary files.

**Solution**

Create `.dockerignore` in the root folder:

```
# Build outputs
bin/
obj/

# IDE files
.vs/
.vscode/
*.user

# Git
.git/
.gitignore

# Documentation
*.md

# Docker files (we're already in Docker!)
Dockerfile
docker-compose*.yml
.dockerignore

# Test files
tests/

# Scripts
*.sh
```

This makes the build faster by not copying unnecessary files.

---

## Exercise 10.3 — Create docker-compose.yml

**Task:** Create a docker-compose file that runs the database and API together.

**Solution**

Create `docker-compose.yml` in the root folder:

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
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U payapp -d payapp"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Our API
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      # Database connection string
      # IMPORTANT: Use "db" as the host, not "localhost"
      # "db" is the service name, and Docker creates a network where services can find each other
      ConnectionStrings__PaymentDb: "Host=db;Database=payapp;Username=payapp;Password=devpass"

      # JWT settings (different from dev for security)
      Jwt__Key: "docker-compose-secret-key-at-least-32-chars!"
      Jwt__Issuer: "paymentapp"
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - uploads:/app/uploads

# Named volumes (persist data between restarts)
volumes:
  db_data:
  uploads:
```

**Understanding the settings:**

| Setting | What it does |
|---------|--------------|
| `image: postgres:16` | Use the official PostgreSQL 16 image |
| `environment: POSTGRES_*` | Set up the database user and password |
| `ports: "5432:5432"` | Make the database accessible from your machine |
| `volumes: db_data` | Keep database data when the container restarts |
| `build: .` | Build the image from the current folder (using Dockerfile) |
| `depends_on` | Wait for the database to be ready before starting the API |
| `ConnectionStrings__PaymentDb` | Override the connection string from appsettings.json |

---

## Exercise 10.4 — Add auto-migration

**Task:** Make the app automatically apply database migrations when it starts.

**Solution**

Update `src/PaymentApp.Api/Program.cs` to add migration at startup:

```csharp
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Entities;
using PaymentApp.Infrastructure.Clients;
using PaymentApp.Infrastructure.Data;
using PaymentApp.Infrastructure.Services;

var builder = WebApplication.CreateBuilder(args);

// Add controllers
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Add database
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("PaymentDb")));

// Add password hasher
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();

// Add our services
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPaymentService, PaymentService>();
builder.Services.AddScoped<IDocumentService, DocumentService>();

// HTTP client for the FX service (Topic 8): named client + typed wrapper
builder.Services.AddHttpClient("fx", client =>
{
    client.BaseAddress = new Uri("https://api.frankfurter.app/");
});
builder.Services.AddScoped<ExchangeRateClient>();

// Add health checks
builder.Services.AddHealthChecks()
    .AddNpgSql(builder.Configuration.GetConnectionString("PaymentDb")!);

// JWT Authentication setup
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)),
            ValidateAudience = false,
            NameClaimType = "name",
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

// =============================================
// Apply database migrations automatically
// =============================================
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    // Wait for database to be ready (important in Docker)
    var maxRetries = 10;
    var delay = TimeSpan.FromSeconds(2);

    for (int i = 0; i < maxRetries; i++)
    {
        try
        {
            logger.LogInformation("Checking database connection (attempt {Attempt}/{Max})...", i + 1, maxRetries);
            await db.Database.CanConnectAsync();
            logger.LogInformation("Database connected. Applying migrations...");
            await db.Database.MigrateAsync();
            logger.LogInformation("Migrations applied successfully.");
            break;
        }
        catch (Exception ex)
        {
            logger.LogWarning("Database not ready: {Message}. Retrying in {Seconds}s...", ex.Message, delay.TotalSeconds);
            if (i == maxRetries - 1) throw;
            await Task.Delay(delay);
        }
    }
}

// Configure middleware
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthentication();
app.UseAuthorization();

// Health check endpoint
app.MapHealthChecks("/health");

app.MapControllers();

app.Run();
```

**Note:** You also need to add the health check NuGet package:

```bash
dotnet add src/PaymentApp.Api package AspNetCore.HealthChecks.NpgSql
```

---

## Exercise 10.5 — Create the external payment processor

Topic 7 fixed the transfer race with a `static SemaphoreSlim`. That gate lives inside **one** process, so it stops protecting anything the moment you run a second API replica (each replica gets its own gate — see this topic's Concepts). Now that Docker makes scaling trivial, we finish the arc promised in Topics 7 and 8: move the money mutation behind a dedicated **payment-processor** service whose correctness lives in the **database**, not in app memory.

**Task:** Create a small external service that owns the balance mutation with an atomic, replica-safe update.

**Solution**

Create `payment-processor/package.json`:

```json
{
  "name": "payment-processor",
  "type": "module",
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.11.5"
  }
}
```

Create `payment-processor/server.js`:

```js
import express from "express";
import pg from "pg";
import { randomUUID } from "crypto";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://payapp:devpass@localhost:5432/payapp",
});

const app = express();
app.use(express.json());

// EF Core created case-sensitive PascalCase identifiers (Topic 6), so every
// column is quoted. Unquoted names in Postgres would fold to lowercase and miss.
function badInput({ userId, amount }) {
  if (!Number.isInteger(userId)) return "userId must be an integer";
  if (typeof amount !== "number" || !(amount > 0)) return "amount must be a positive number";
  return null;
}

app.post("/v1/withdraw", async (req, res) => {
  const err = badInput(req.body ?? {});
  if (err) return res.status(400).json({ error: err });
  const { userId, amount } = req.body;

  // THE line this service exists for: an ATOMIC conditional update.
  // Read-check-write happens inside the database as one indivisible statement —
  // no app-level lock, and it stays correct with any number of replicas.
  const result = await pool.query(
    `UPDATE "Users" SET "Balance" = "Balance" - $1
      WHERE "Id" = $2 AND "Balance" >= $1
      RETURNING "Balance"`,
    [amount, userId]
  );
  // Return an external transaction id — this is the id the PaymentApp ledger
  // stores as the "external system" reference for this movement.
  if (result.rowCount === 1)
    return res.json({ transactionId: randomUUID(), balance: result.rows[0].Balance });

  // 0 rows: either the user doesn't exist, or the balance guard failed.
  const exists = await pool.query(`SELECT 1 FROM "Users" WHERE "Id" = $1`, [userId]);
  if (exists.rowCount === 0)
    return res.status(404).json({ error: `No user ${userId}` });
  return res.status(400).json({ error: "Insufficient funds" });
});

app.post("/v1/deposit", async (req, res) => {
  const err = badInput(req.body ?? {});
  if (err) return res.status(400).json({ error: err });
  const { userId, amount } = req.body;

  const result = await pool.query(
    `UPDATE "Users" SET "Balance" = "Balance" + $1
      WHERE "Id" = $2
      RETURNING "Balance"`,
    [amount, userId]
  );
  if (result.rowCount === 0)
    return res.status(404).json({ error: `No user ${userId}` });
  return res.json({ transactionId: randomUUID(), balance: result.rows[0].Balance });
});

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

const port = process.env.PORT ?? 4000;
app.listen(port, () => console.log(`payment-processor listening on :${port}`));
```

Create `payment-processor/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4000
CMD ["node", "server.js"]
```

**Why this fixes what `SemaphoreSlim` couldn't:**

| Element | Why it matters |
|---------|----------------|
| `UPDATE ... WHERE "Balance" >= $1` | The check and the write are one indivisible SQL statement. No read-modify-write window, so no race — *regardless of how many API replicas call it*. |
| `RETURNING "Balance"` | Postgres hands back the new balance in the same round-trip — no second `SELECT`. |
| `transactionId: randomUUID()` | Each successful call returns an **external transaction id**. PaymentApp stores this on its ledger row (Exercise 10.7) as the external system's reference. |
| `rowCount === 1` vs `0` | 1 row updated = success. 0 rows = either no such user (404) or the guard blocked it (insufficient funds, 400). |
| Quoted `"Users"`/`"Id"`/`"Balance"` | EF Core created PascalCase identifiers; unquoted names fold to lowercase in Postgres and wouldn't match. |
| Separate service | Real payment systems isolate money movement in a narrowly-scoped, separately-deployed service. It also gives us a concrete `HttpClient` integration to build against. |

**Interview talking point:** "An in-process lock only coordinates one process. To stay correct across replicas I pushed the money mutation into a single atomic SQL statement — `UPDATE ... WHERE Balance >= amount RETURNING Balance` — where the database itself is the arbiter."

---

## Exercise 10.6 — Add the processor to docker-compose

**Task:** Run the processor as a third service and point the API at it by service name.

**Solution**

Update `docker-compose.yml` to add the `processor` service and the `PaymentProcessor__BaseUrl` env var on the API:

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
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U payapp -d payapp"]
      interval: 5s
      timeout: 5s
      retries: 5

  # External payment processor (owns the atomic balance mutation)
  processor:
    build: ./payment-processor
    ports:
      - "4000:4000"
    environment:
      DATABASE_URL: "postgres://payapp:devpass@db:5432/payapp"
    depends_on:
      db:
        condition: service_healthy

  # Our API
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      ConnectionStrings__PaymentDb: "Host=db;Database=payapp;Username=payapp;Password=devpass"
      # Point at the processor by SERVICE NAME, not localhost (the "localhost lie")
      PaymentProcessor__BaseUrl: "http://processor:4000"
      Jwt__Key: "docker-compose-secret-key-at-least-32-chars!"
      Jwt__Issuer: "paymentapp"
    depends_on:
      db:
        condition: service_healthy
      processor:
        condition: service_started
    volumes:
      - uploads:/app/uploads

# Named volumes (persist data between restarts)
volumes:
  db_data:
  uploads:
```

**Key points:**

| Setting | What it does |
|---------|--------------|
| `build: ./payment-processor` | Build the processor image from its own folder's Dockerfile |
| `DATABASE_URL: ...@db:5432` | The processor talks to Postgres by service name `db` too |
| `PaymentProcessor__BaseUrl: http://processor:4000` | Overrides `PaymentProcessor:BaseUrl` — service name `processor`, **not** `localhost` |
| `depends_on: processor` | Start the processor before the API |

**Ordering note:** The API auto-migrates on startup (Exercise 10.4), so it creates the `Users` table. The processor only touches the database when a request comes in, so as long as the API has finished migrating before the first transfer, the shared table is there. In a stricter setup you'd run migrations as a dedicated one-off job (see Concepts, "EF Core migrations in Docker").

---

## Exercise 10.7 — Add the Transaction ledger

PaymentApp is the **merchant in the middle**: it no longer holds balances itself (the processor's `"Users"."Balance"` does that), but it **records every movement it orchestrates**. A transfer becomes **two ledger rows** sharing one `TransferId` — a `Withdraw` leg for the payer and a `Deposit` leg for the payee — each tracking its own lifecycle.

**Task:** Add a `Transaction` entity, wire it into `PaymentDbContext`, and create the migration.

**Solution**

Create `src/PaymentApp.Domain/Entities/Transaction.cs`:

```csharp
namespace PaymentApp.Domain.Entities;

public enum TransactionType { Withdraw, Deposit }

public enum TransactionStatus { Pending, Successful, Failed }

/// <summary>
/// One leg of a transfer — a single call to the payment processor.
/// A transfer writes two of these, linked by TransferId.
/// </summary>
public class Transaction
{
    public int Id { get; set; }                        // our internal id (PK)
    public Guid TransferId { get; set; }               // links the two legs of one transfer
    public int UserId { get; set; }                    // whose balance moved
    public TransactionType Type { get; set; }          // Withdraw (payer) or Deposit (payee)
    public decimal Amount { get; set; }
    public TransactionStatus Status { get; set; }      // Pending -> Successful | Failed

    // Filled in once the processor responds:
    public string? ExternalTransactionId { get; set; } // id returned by the Node processor
    public string? ProcessorResponse { get; set; }     // raw JSON from the processor (jsonb)

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}
```

Wire it into `src/PaymentApp.Infrastructure/Data/PaymentDbContext.cs` — add the `DbSet`:

```csharp
public DbSet<User> Users => Set<User>();
public DbSet<Transaction> Transactions => Set<Transaction>();   // NEW
```

and configure it inside `OnModelCreating`:

```csharp
// Configure Transaction entity
modelBuilder.Entity<Transaction>(entity =>
{
    entity.HasKey(e => e.Id);
    entity.HasIndex(e => e.TransferId);                 // both legs share one TransferId
    entity.Property(e => e.Amount).HasPrecision(18, 2);

    // Store enums as readable text ("Pending"), not ints
    entity.Property(e => e.Type).HasConversion<string>().HasMaxLength(20);
    entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);

    entity.Property(e => e.ExternalTransactionId).HasMaxLength(100);

    // Store the processor's raw response as Postgres jsonb (queryable JSON)
    entity.Property(e => e.ProcessorResponse).HasColumnType("jsonb");
});
```

Create the migration (the API auto-applies it on next startup — Exercise 10.4):

```bash
dotnet ef migrations add AddTransactions \
  --project src/PaymentApp.Infrastructure \
  --startup-project src/PaymentApp.Api
```

**Field-by-field:**

| Field | Why it's here |
|-------|---------------|
| `Id` | Our internal primary key for the ledger row |
| `TransferId` (`Guid`) | Correlates the two legs (withdraw + deposit) of one transfer |
| `Type` / `Status` | Stored as text via `HasConversion<string>()` — readable in `psql`, and stable even if you reorder the enum |
| `ExternalTransactionId` | The id the Node processor returns — our reference into the external system |
| `ProcessorResponse` (`jsonb`) | The raw processor reply, stored verbatim for audit/debugging. `jsonb` lets Postgres index and query into the JSON later |
| `Status` lifecycle | `Pending` when the row is created, then `Successful` or `Failed` once the processor answers |

> **No accidental foreign key:** `UserId` is a plain column — there's no `User` navigation on `Transaction` (and no `Transactions` collection on `User`), so EF Core won't infer a relationship. The balance lives in the processor's world; the ledger just references the user by id.

**Interview talking point:** "Enums map to ints by default; I use `HasConversion<string>()` so the column reads as `Pending`/`Successful` and doesn't silently shift meaning if I reorder the enum. I also keep the processor's raw response in a `jsonb` column so failures stay auditable and queryable."

---

## Exercise 10.8 — Create the PaymentProcessorClient

**Task:** Create a typed .NET client that calls the processor through a named `HttpClient` and returns the external id + raw response the ledger needs.

**Solution**

Create `src/PaymentApp.Infrastructure/Clients/PaymentProcessorClient.cs`:

```csharp
using System.Net.Http.Json;
using System.Text.Json;

namespace PaymentApp.Infrastructure.Clients;

/// <summary>
/// The outcome of one processor call. We always capture the raw JSON so the
/// ledger can store it verbatim (jsonb) whether the call succeeded or failed.
/// </summary>
public record ProcessorResult(
    bool Ok,
    string? ExternalTransactionId,
    decimal? Balance,
    string RawJson);

/// <summary>
/// Typed client for the external payment-processor service.
/// Uses a named HttpClient (configured in Program.cs) so the base URL comes from
/// config and one pooled handler is reused (Topic 8: avoids socket exhaustion).
/// </summary>
public class PaymentProcessorClient
{
    private readonly HttpClient _client;
    private static readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    public PaymentProcessorClient(IHttpClientFactory factory)
    {
        // "processor" = the named client registered in Program.cs
        _client = factory.CreateClient("processor");
    }

    public Task<ProcessorResult> WithdrawAsync(int userId, decimal amount) =>
        PostAsync("/v1/withdraw", userId, amount);

    public Task<ProcessorResult> DepositAsync(int userId, decimal amount) =>
        PostAsync("/v1/deposit", userId, amount);

    private async Task<ProcessorResult> PostAsync(string path, int userId, decimal amount)
    {
        var response = await _client.PostAsJsonAsync(path, new { userId, amount });

        // Always read the raw body — the ledger stores it in a jsonb column, for
        // both the success reply and a 400 { "error": "Insufficient funds" }.
        var rawJson = await response.Content.ReadAsStringAsync();

        if (response.IsSuccessStatusCode)
        {
            // Web defaults are case-insensitive, so this maps the processor's
            // lowercase "transactionId"/"balance" fields.
            var body = JsonSerializer.Deserialize<SuccessBody>(rawJson, _json);
            return new ProcessorResult(true, body?.TransactionId, body?.Balance, rawJson);
        }

        // Business failure (e.g. insufficient funds) — record it, don't throw here.
        // PaymentService decides what a failed leg means for the transfer.
        return new ProcessorResult(false, null, null, rawJson);
    }

    private record SuccessBody(string TransactionId, decimal Balance);
}
```

Register it in `src/PaymentApp.Api/Program.cs` — **add** a named client for the processor, next to the `fx` client carried over from Topic 8:

```csharp
// Named HttpClient for the payment processor.
// BaseAddress comes from config PaymentProcessor:BaseUrl
// (compose sets it to http://processor:4000 via PaymentProcessor__BaseUrl).
builder.Services.AddHttpClient("processor", client =>
{
    client.BaseAddress = new Uri(builder.Configuration["PaymentProcessor:BaseUrl"]!);
});

builder.Services.AddScoped<PaymentProcessorClient>();
```

(`using PaymentApp.Infrastructure.Clients;` is already at the top of `Program.cs` from the FX client.)

For local (non-Docker) runs, add the base URL to `appsettings.Development.json` so `PaymentProcessor:BaseUrl` resolves when you're not in compose:

```json
{
  "PaymentProcessor": {
    "BaseUrl": "http://localhost:4000"
  }
}
```

**Why a named client?** A named `HttpClient` is the .NET equivalent of `axios.create({ baseURL })` — a pre-configured instance DI hands you, pooling one handler underneath so you never hit socket exhaustion (Topic 8).

---

## Exercise 10.9 — Record the transfer in the ledger

Now tie it together: the transfer calls the processor **and** records each leg in the `Transaction` ledger. This replaces the Topic 7 in-process `SemaphoreSlim` entirely — balance correctness lives in the processor's atomic SQL, and PaymentApp's job is to orchestrate and record.

**Task:** Rewrite the transfer so each leg (a) writes a `Pending` ledger row, (b) calls the processor, (c) flips the row to `Successful`/`Failed` with the external id and raw response.

**Solution**

Update `src/PaymentApp.Infrastructure/Services/PaymentService.cs`:

```csharp
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Entities;
using PaymentApp.Domain.Exceptions;
using PaymentApp.Infrastructure.Clients;
using PaymentApp.Infrastructure.Data;

namespace PaymentApp.Infrastructure.Services;

public class PaymentService : IPaymentService
{
    private readonly PaymentDbContext _db;
    private readonly PaymentProcessorClient _processor;

    public PaymentService(PaymentDbContext db, PaymentProcessorClient processor)
    {
        _db = db;
        _processor = processor;
    }

    public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
    {
        // Cheap validation stays here — no need to write a ledger row for a bad request.
        if (amount <= 0)
            throw InvalidTransferException.NegativeAmount(amount);

        if (payerUserId == payeeUserId)
            throw InvalidTransferException.SameUser();

        // One TransferId ties the two ledger legs together.
        var transferId = Guid.NewGuid();

        // --- Leg 1: withdraw from the payer ---
        var withdrawal = await RecordLegAsync(
            transferId, payerUserId, TransactionType.Withdraw,
            amount, () => _processor.WithdrawAsync(payerUserId, amount));

        if (withdrawal.Status == TransactionStatus.Failed)
            throw new InvalidOperationException("Withdrawal rejected by the payment processor");

        // --- Leg 2: deposit to the payee ---
        var deposit = await RecordLegAsync(
            transferId, payeeUserId, TransactionType.Deposit,
            amount, () => _processor.DepositAsync(payeeUserId, amount));

        if (deposit.Status == TransactionStatus.Failed)
        {
            // Compensating leg: refund the payer so money is never lost. It gets its
            // OWN ledger row under the same TransferId, so the reversal is auditable.
            await RecordLegAsync(
                transferId, payerUserId, TransactionType.Deposit,
                amount, () => _processor.DepositAsync(payerUserId, amount));

            throw new InvalidOperationException("Deposit failed; the payer was refunded");
        }
    }

    // Writes a Pending row, calls the processor, then flips the row to
    // Successful/Failed with the external id + raw response. Two SaveChanges so the
    // Pending intent is durable even if the process dies mid-call.
    private async Task<Transaction> RecordLegAsync(
        Guid transferId, int userId, TransactionType type,
        decimal amount, Func<Task<ProcessorResult>> call)
    {
        var tx = new Transaction
        {
            TransferId = transferId,
            UserId = userId,
            Type = type,
            Amount = amount,
            Status = TransactionStatus.Pending,
        };
        _db.Transactions.Add(tx);
        await _db.SaveChangesAsync();          // Pending row is now durable

        var result = await call();             // hit the processor

        tx.Status = result.Ok ? TransactionStatus.Successful : TransactionStatus.Failed;
        tx.ExternalTransactionId = result.ExternalTransactionId;
        tx.ProcessorResponse = result.RawJson;
        tx.CompletedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();          // record the outcome

        return tx;
    }
}
```

No DI change is needed: `PaymentDbContext` (Topic 5) and `PaymentProcessorClient` (Exercise 10.8) are already registered, and `PaymentService` is already `AddScoped` from Exercise 10.4.

**The lifecycle of one leg:**

```
new Transaction(Pending) ──SaveChanges──▶ row exists, intent is durable
        │
        ▼
call processor ──▶ ProcessorResult(Ok, externalId, rawJson)
        │
        ▼
Status = Successful|Failed, ExternalTransactionId, ProcessorResponse ──SaveChanges──▶ outcome recorded
```

**What a $100 Alice→Bob transfer writes:**

```
 Id | TransferId | UserId | Type     | Amount | Status     | ExternalTransactionId
----+------------+--------+----------+--------+------------+----------------------
  1 |  abc-123   |   1    | Withdraw |  100   | Successful | 7f3a...
  2 |  abc-123   |   2    | Deposit  |  100   | Successful | 9b2c...
```

If Bob's deposit fails you instead get **three** rows under `abc-123`: the successful withdraw, the failed deposit (with the processor's error JSON in `ProcessorResponse`), and a compensating deposit back to Alice.

**What changed:**

| Before (Topic 7) | After (Topic 10) |
|------------------|------------------|
| `static SemaphoreSlim` in-process lock | Gone — balance atomicity lives in the processor's SQL |
| No record of what happened | Every leg is a `Transaction` row: status + external id + raw response |
| Failures were invisible | Failed legs are persisted (`Failed` + error JSON) and the payer is refunded |
| Correct on **1** replica | Correct on **N** replicas |

**Note the honest tradeoff:** a transfer is still two calls, not one atomic transaction. Writing the `Pending` row *before* the call makes intent durable — but a crash *between* the legs leaves a `Pending`/half-done transfer that a reconciler must finish. That's exactly why production reaches for **idempotency keys + an outbox** (Topic 12). The ledger you just built is the first half of that pattern: a durable, auditable record of intent.

**Interview talking point:** "I write a `Pending` ledger row before each processor call and flip it to `Successful`/`Failed` after — so intent is durable and every external call is auditable via the stored transaction id and raw `jsonb` response. A crash mid-transfer leaves a `Pending` row a reconciler can finish, which is the seed of the outbox pattern."

---

## Exercise 10.10 — Build and run with Docker

**Task:** Build and run the complete application using Docker.

**Solution**

```bash
# Build and start everything
docker-compose up --build

# Or run in background
docker-compose up --build -d
```

You should see:
1. Database starting
2. API building
3. Migrations running
4. API listening on port 8080

**Test it:**

```bash
# Health check
curl http://localhost:8080/health
# Should return: Healthy

# Register a user
curl -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'

# Check the database
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "Email", "Balance" FROM "Users";'
```

---

## Exercise 10.11 — Understand the localhost lie

**Task:** Understand why we use `Host=db` instead of `Host=localhost`.

**Explanation**

When you run `docker-compose up`, Docker creates a private network. Each service gets a hostname matching its name:

```
┌─────────────────────────────────────────────┐
│  Docker Network                              │
│                                              │
│   ┌─────────┐          ┌─────────┐          │
│   │   db    │          │   api   │          │
│   │         │◄─────────│         │          │
│   │ :5432   │  Host=db │ :8080   │          │
│   └─────────┘          └─────────┘          │
│                                              │
└─────────────────────────────────────────────┘
         ▲                      ▲
         │                      │
    port 5432              port 8080
         │                      │
    ┌────┴──────────────────────┴────┐
    │       Your Machine              │
    │       localhost                 │
    └─────────────────────────────────┘
```

**From your machine:**
- `localhost:5432` → reaches the database
- `localhost:8080` → reaches the API

**From inside the API container:**
- `localhost` → means inside the API container (nothing there!)
- `db` → reaches the database container

This is why we use `Host=db` in the connection string.

---

## Exercise 10.12 — Test the complete flow

**Task:** Test the full application running in Docker.

**Solution**

```bash
# Make sure everything is running
docker-compose up -d

# Wait for it to start
sleep 5

# 1. Check health
echo "=== Health Check ==="
curl -s http://localhost:8080/health

# 2. Register Alice
echo -e "\n\n=== Register Alice ==="
ALICE_TOKEN=$(curl -s -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Token: ${ALICE_TOKEN:0:50}..."

# 3. Register Bob
echo -e "\n\n=== Register Bob ==="
BOB_TOKEN=$(curl -s -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@bank.test","password":"Passw0rd!"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Token: ${BOB_TOKEN:0:50}..."

# 4. Alice transfers to Bob
echo -e "\n\n=== Transfer $100 from Alice to Bob ==="
curl -s -X POST http://localhost:8080/v1/payment/transfer \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":100}'

# 5. Check balances
echo -e "\n\n=== Check Balances ==="
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "Balance" FROM "Users";'

# 6. Check the ledger — two rows, one TransferId, both Successful
echo -e "\n\n=== Transaction Ledger ==="
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "TransferId", "UserId", "Type", "Amount", "Status", "ExternalTransactionId"
      FROM "Transactions" ORDER BY "Id";'
```

**Expected output:**

```
=== Health Check ===
Healthy

=== Register Alice ===
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzd...

=== Register Bob ===
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzd...

=== Transfer $100 from Alice to Bob ===
{"payerUserId":1,"payerNewBalance":900.00,...}

=== Check Balances ===
 Id | Name  | Balance
----+-------+---------
  1 | Alice |  900.00
  2 | Bob   | 1100.00

=== Transaction Ledger ===
 Id |             TransferId              | UserId |   Type   | Amount |   Status   | ExternalTransactionId
----+--------------------------------------+--------+----------+--------+------------+-----------------------
  1 | 3f2a...                              |      1 | Withdraw | 100.00 | Successful | 7f3a...
  2 | 3f2a...                              |      2 | Deposit  | 100.00 | Successful | 9b2c...
```

Both legs share one `TransferId`, both are `Successful`, and each carries the processor's external id. Inspect the stored `jsonb` reply with:

```bash
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "ProcessorResponse" FROM "Transactions" ORDER BY "Id";'
```

---

## Exercise 10.13 — View logs

**Task:** Learn how to view and troubleshoot container logs.

**Solution**

```bash
# View all logs
docker-compose logs

# View only API logs
docker-compose logs api

# Follow logs in real-time (like tail -f)
docker-compose logs -f api

# View last 50 lines
docker-compose logs --tail 50 api
```

---

## Exercise 10.14 — Clean up

**Task:** Stop the containers and clean up.

**Solution**

```bash
# Stop containers (keeps data)
docker-compose down

# Stop containers AND delete data
docker-compose down -v

# Remove built images too
docker-compose down -v --rmi all
```

---

## Exercise 10.15 — Build and verify

**Task:** Make sure everything works.

**Solution**

```bash
# Clean start
docker-compose down -v

# Build and run
docker-compose up --build -d

# Wait for startup
sleep 10

# Test
curl http://localhost:8080/health

# Clean up
docker-compose down
```

---

## What we built

| File | Purpose |
|------|---------|
| `Dockerfile` | Instructions for building the app image |
| `.dockerignore` | Files to exclude from the build |
| `docker-compose.yml` | Run database + processor + API together |
| Updated `Program.cs` | Auto-migration + health checks + named processor client |
| `payment-processor/` | External service owning the atomic, replica-safe balance mutation |
| `Entities/Transaction.cs` + `AddTransactions` migration | The ledger: one row per processor call, with status + external id + `jsonb` response |
| `Clients/PaymentProcessorClient.cs` | Typed .NET client returning the external id + raw response |
| Updated `PaymentService.cs` | Transfers go through the processor and record each leg in the ledger (no in-process lock) |

---

## Project structure (final)

```
PaymentApp/
├── Dockerfile              (NEW)
├── .dockerignore           (NEW)
├── docker-compose.yml      (NEW)
├── payment-processor/      (NEW — external service)
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── PaymentApp.sln
└── src/
    ├── PaymentApp.Domain/
    │   ├── Common/
    │   ├── Constants/
    │   ├── Entities/         (User + Transaction ledger)
    │   ├── Events/
    │   ├── Exceptions/
    │   ├── Utilities/
    │   └── ValueObjects/
    ├── PaymentApp.Application/
    │   ├── DTOs/
    │   └── Services/
    ├── PaymentApp.Infrastructure/
    │   ├── Clients/         (NEW — PaymentProcessorClient)
    │   ├── Data/
    │   └── Services/
    └── PaymentApp.Api/
        └── Controllers/
```

---

## Key takeaways

| Concept | What it means |
|---------|---------------|
| Multi-stage build | Build with SDK, run with smaller runtime image |
| docker-compose | Run multiple containers together |
| Service names | Use `db`/`processor` not `localhost` for container-to-container |
| Environment variables | Override config: `Jwt__Key` overrides `Jwt:Key` |
| Health checks | Let load balancers know if your app is healthy |
| Volumes | Persist data between container restarts |
| Replica-safe writes | In-process locks don't scale — push the money mutation into an atomic DB `UPDATE` behind a processor service |

---

## Interview talking points

- "I use multi-stage builds to keep production images small — SDK for build, runtime for deployment."
- "docker-compose is for local dev. In production, I'd use Kubernetes or ECS."
- "The 'localhost lie' — inside a container, localhost means the container itself. I use service names instead."
- "Environment variables override appsettings.json. I use `__` for nested keys: `Jwt__Key` overrides `Jwt:Key`."
- "Health checks tell the orchestrator if my app is ready to receive traffic."

---

## PaymentApp is complete!

You've built a complete payment API:
- ✅ User registration and login with JWT
- ✅ Password hashing
- ✅ Money transfers, replica-safe via an external payment processor (atomic DB update)
- ✅ A Transaction ledger recording every movement (status lifecycle + external id + `jsonb` response)
- ✅ Document upload with CPU-bound processing
- ✅ PostgreSQL database with EF Core
- ✅ Docker containerization with a multi-service compose stack

---

## Next: Topic 11

In Topic 11, we add automated tests to ensure PaymentApp works correctly and stays working as we make changes.
