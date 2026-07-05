# Topic 10: The Pipeline — Middleware, Validation, Outbound Calls

## The one question this topic answers

> **How does a .NET service talk to the outside world — incoming requests through a middleware pipeline with declarative validation, outgoing calls through `HttpClient` — and what happens to money when the service on the other end fails?**

This topic closes the four gaps left after Topic 9, all in one move: we extract the money-moving into an **external payment processor** (a small Node/Express service — provided ready-made below, you don't write it) and rebuild `PaymentApp`'s plumbing around it:

1. **Request validation** — DataAnnotations on DTOs (≈ zod), automatic 400s.
2. **The middleware pipeline** — `app.Use(...)` and a global exception handler (≈ Express middleware + the `(err, req, res, next)` handler).
3. **Outbound HTTP** — `IHttpClientFactory` + a typed client (≈ axios, structured).
4. **Background work** — a `BackgroundService` auditor (≈ a node-cron worker, in-process).

And one payoff that's been owed since Topic 7: the processor moves money with **atomic conditional SQL**, so your `SemaphoreSlim` gets deleted — the coordination moves into the database, where it survives multiple replicas. That was Topic 7's closing sentence; today you build it.

**The final architecture** (all in one compose file):

```
client ──► PaymentApp (.NET)  ── validates, authenticates, orchestrates
              │        │
              │        └── POST /v1/withdraw, /v1/deposit ──► payment-processor (Node/Express)
              │                                                     │
              └────────────── shared Postgres ──────────────────────┘
                     (PaymentApp reads balances; the processor is the ONLY writer of money)
```

A .NET API orchestrating a Node service over one database is not a toy setup — polyglot service pairs like this are everywhere in real payment stacks, and "who is allowed to write money" being a single service is a real design principle (single-writer).

## The payment processor — ready-made, don't type this one

Create a sibling folder in your workspace (`~/csharp-recap/payment-processor/`) with three files. This is deliberately Express — your home turf — so all the learning stays on the .NET side.

`package.json`:

```json
{
  "name": "payment-processor",
  "type": "module",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.12.0"
  }
}
```

`server.js`:

```js
import express from "express";
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://payapp:devpass@localhost:5432/payapp",
});

const app = express();
app.use(express.json());

// Note the quoted "Accounts"/"Balance"/"UserId": EF Core created case-sensitive
// PascalCase identifiers (Topic 6), and unquoted names in Postgres fold to lowercase.

// Shared input check. In a real service you'd reach for zod — same idea as
// the DataAnnotations you're about to add on the .NET side.
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
  // This is the production-grade fix Topic 7 promised.
  const result = await pool.query(
    `UPDATE "Accounts" SET "Balance" = "Balance" - $1
     WHERE "UserId" = $2 AND "Balance" >= $1
     RETURNING "Balance"`,
    [amount, userId]
  );
  if (result.rowCount === 1) return res.json({ balance: result.rows[0].Balance });

  // 0 rows: either the account doesn't exist, or the balance guard failed.
  const exists = await pool.query(`SELECT 1 FROM "Accounts" WHERE "UserId" = $1`, [userId]);
  if (exists.rowCount === 0)
    return res.status(404).json({ error: `No account for user ${userId}` });
  return res.status(400).json({ error: "Insufficient funds" });
});

app.post("/v1/deposit", async (req, res) => {
  const err = badInput(req.body ?? {});
  if (err) return res.status(400).json({ error: err });
  const { userId, amount } = req.body;

  const result = await pool.query(
    `UPDATE "Accounts" SET "Balance" = "Balance" + $1
     WHERE "UserId" = $2
     RETURNING "Balance"`,
    [amount, userId]
  );
  if (result.rowCount === 0)
    return res.status(404).json({ error: `No account for user ${userId}` });
  return res.json({ balance: result.rows[0].Balance });
});

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

const port = process.env.PORT ?? 4000;
app.listen(port, () => console.log(`payment-processor listening on :${port}`));
```

`Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 4000
CMD ["node", "server.js"]
```

Two things worth 30 seconds even though this is your language:

- **`pg` returns `numeric` as a string** (`"990.00"`), not a number — because a JS `number` can't hold arbitrary-precision decimals without loss. The whole `decimal`-for-money lesson from Topic 2, restated by your own ecosystem. (Real processors go further and use integer minor units — cents — end to end.)
- The **atomic `UPDATE ... WHERE "Balance" >= $1`** is doing what your `SemaphoreSlim` did, but in the only place that survives horizontal scaling: the shared database. `rowCount === 0` *is* the "insufficient funds" signal — no separate read, no race window.

## Gap 1 — declarative validation (≈ zod)

DataAnnotations move the "is this input even sane?" rules onto the DTOs, where `[ApiController]` enforces them **before your action runs** — the missing middle layer between deserialization (shape) and business rules (exceptions):

```csharp
using System.ComponentModel.DataAnnotations;

// [property:] targets the attribute at the record's generated property —
// new syntax: attributes can aim at different targets (property, param, return).
public record RegisterRequest(
    [property: Required, property: MinLength(2)] string Name,
    [property: Required, property: EmailAddress] string Email,
    [property: Required, property: MinLength(8)] string Password);

public record TransferRequest(
    [property: Range(1, int.MaxValue)] int PayerUserId,
    [property: Range(1, int.MaxValue)] int PayeeUserId,
    [property: Range(0.01, 1_000_000)] decimal Amount);
```

A failing request now gets an automatic **400** with a per-field problem-details body (`"errors": { "Amount": ["The field Amount must be between 0.01 and 1000000."] }`) — `zod.flatten()`, no code in the controller. Delete the `amount <= 0` throw from the service: that rule now lives at the boundary, stated once, visible in the DTO's type. (Business rules that need *state* — insufficient funds — stay in the service/processor; validation attributes are for rules the request alone can answer.)

## Gap 2 — the middleware pipeline (≈ Express, finally in full)

You've been using the pipeline all along (`UseAuthentication` → `UseAuthorization` order in Topic 9 *is* Express middleware ordering). Now write your own. Two flavors:

**Inline, Express-style** — request timing (put it early in `Program.cs`'s pipeline):

```csharp
app.Use(async (context, next) =>
{
    var sw = System.Diagnostics.Stopwatch.StartNew();
    await next();                                    // ≈ next() — call the rest of the pipeline
    app.Logger.LogInformation("{Method} {Path} -> {Status} in {Elapsed}ms",
        context.Request.Method, context.Request.Path,
        context.Response.StatusCode, sw.ElapsedMilliseconds);
});
```

**A middleware class** — the global exception handler that replaces every controller try/catch (≈ Express's `(err, req, res, next)` terminal handler, but typed):

`Middleware/ExceptionMappingMiddleware.cs`:

```csharp
namespace PaymentApp.Middleware;

public class ExceptionMappingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionMappingMiddleware> _logger;

    public ExceptionMappingMiddleware(RequestDelegate next, ILogger<ExceptionMappingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);                    // run the REST of the pipeline
        }
        catch (KeyNotFoundException ex)              // domain: not found
        {
            await Write(context, StatusCodes.Status404NotFound, ex.Message);
        }
        catch (InvalidOperationException ex)         // domain: rule violated
        {
            await Write(context, StatusCodes.Status400BadRequest, ex.Message);
        }
        catch (HttpRequestException ex)              // downstream service unreachable/broken
        {
            _logger.LogError(ex, "Payment processor call failed");
            await Write(context, StatusCodes.Status502BadGateway, "Payment processor unavailable.");
        }
    }

    private static Task Write(HttpContext context, int status, string error)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(new { status, error });
    }
}
```

Register it **first** in the pipeline, so it wraps everything downstream:

```csharp
app.UseMiddleware<ExceptionMappingMiddleware>();
// then timing, then UseAuthentication, UseAuthorization, MapControllers
```

Now delete the try/catch from `PaymentsController` and `AccountController` — actions shrink to their happy path, and the exception→status mapping is stated **once** for the whole app. Topic 4's catch-by-type, promoted from per-endpoint to infrastructure. (The framework also ships `UseExceptionHandler`/`IExceptionHandler` for this job with RFC-7807 output; writing it by hand once is how you understand what they do.)

## Gap 3 — outbound HTTP: `IHttpClientFactory` + a typed client (≈ axios)

Never `new HttpClient()` per request (socket exhaustion — the .NET equivalent of not reusing keep-alive agents in Node). The factory pattern, with a **typed client** so consumers get a real API instead of raw HTTP:

`Services/PaymentProcessorClient.cs`:

```csharp
using System.Net;

namespace PaymentApp.Services;

public class PaymentProcessorClient
{
    private readonly HttpClient _http;     // injected pre-configured by the factory

    public PaymentProcessorClient(HttpClient http) => _http = http;

    public Task WithdrawAsync(int userId, decimal amount) => PostAsync("v1/withdraw", userId, amount);
    public Task DepositAsync(int userId, decimal amount)  => PostAsync("v1/deposit", userId, amount);

    private async Task PostAsync(string path, int userId, decimal amount)
    {
        var response = await _http.PostAsJsonAsync(path, new { userId, amount });
        if (response.IsSuccessStatusCode) return;

        // Translate the processor's HTTP vocabulary back into OUR domain exceptions,
        // so the rest of the app (and the exception middleware) never sees raw HTTP.
        var body = await response.Content.ReadFromJsonAsync<ProcessorError>();
        throw response.StatusCode switch
        {
            HttpStatusCode.NotFound   => new KeyNotFoundException(body?.Error ?? "Account not found."),
            HttpStatusCode.BadRequest => new InvalidOperationException(body?.Error ?? "Rejected by processor."),
            _ => new HttpRequestException($"Processor returned {(int)response.StatusCode}"),
        };
    }

    private record ProcessorError(string? Error);
}
```

Registration in `Program.cs` — note this *is* DI, the client is just another constructor-injected dependency:

```csharp
builder.Services.AddHttpClient<PaymentProcessorClient>(client =>
    client.BaseAddress = new Uri(builder.Configuration["PaymentProcessor:BaseUrl"]!));
```

`appsettings.json` gains `"PaymentProcessor": { "BaseUrl": "http://localhost:4000" }` — overridden to `http://processor:4000` in compose, exactly like the connection string (Topic 8's machinery, third rep).

### The transfer, re-orchestrated — both legs in flight, locked accounts, compensation

`PaymentService.TransferAsync` becomes an orchestrator with three jobs: **lock** both accounts, fire **both legs concurrently**, and **compensate** if only one leg lands. Topic 7's single static `SemaphoreSlim` (one gate for *all* transfers) gets replaced by something smarter: one gate **per account**.

**First, the per-account locks** — `Services/AccountLocks.cs`, registered as a **singleton** (gates must be shared app-wide; a scoped instance would hand every request its own gates, guarding nothing — Topic 5's lifetime lesson, third rep):

```csharp
using System.Collections.Concurrent;

namespace PaymentApp.Services;

public class AccountLocks
{
    // One SemaphoreSlim per account id, created on first use.
    // ConcurrentDictionary because many threads race to create gates (Topic 7!).
    private readonly ConcurrentDictionary<int, SemaphoreSlim> _gates = new();

    private SemaphoreSlim GateFor(int userId)
        => _gates.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));

    // Lock BOTH accounts — ALWAYS acquiring in ascending id order. See below: this
    // single line is the difference between "works" and "deadlocks under load".
    public async Task<IDisposable> LockPairAsync(int userIdA, int userIdB)
    {
        var (first, second) = userIdA < userIdB ? (userIdA, userIdB) : (userIdB, userIdA);
        var outer = GateFor(first);
        var inner = GateFor(second);
        await outer.WaitAsync();
        await inner.WaitAsync();
        return new Releaser(inner, outer);          // release in reverse order
    }

    private sealed class Releaser(SemaphoreSlim inner, SemaphoreSlim outer) : IDisposable
    {
        public void Dispose() { inner.Release(); outer.Release(); }
    }
}
```

(`class Releaser(SemaphoreSlim inner, ...)` is a **primary constructor** — the parameter list on the class line generates the stored fields; record syntax's convenience, for classes.)

**Why ascending id order is load-bearing:** picture two simultaneous transfers, Alice→Bob and Bob→Alice, with naive lock-the-payer-first ordering. Request 1 holds Alice's gate and waits for Bob's; request 2 holds Bob's and waits for Alice's. Neither can proceed, ever — a **deadlock**, the concurrency bug one rank above Topic 7's race condition (a race gives wrong numbers; a deadlock stops the world). The classic fix is a **global acquisition order**: everyone locks the lower id first, so the circular wait can't form. The exercises make you build the deadlock on purpose first — it's the best five minutes of the course.

**Then the orchestration** — fire both legs at once (`Task.WhenAll` = `Promise.all` — this is I/O concurrency, Topic 7's rule: no threads burned, the "parallelism" is in flight, not on cores):

```csharp
public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    if (payerUserId == payeeUserId)
        throw new InvalidOperationException("Cannot transfer to yourself.");

    // Both balances frozen (within this process) for the duration of the saga.
    using var _ = await _locks.LockPairAsync(payerUserId, payeeUserId);

    var withdraw = _processor.WithdrawAsync(payerUserId, amount);   // both legs
    var deposit  = _processor.DepositAsync(payeeUserId, amount);    // in flight AT ONCE

    try
    {
        await Task.WhenAll(withdraw, deposit);
        // WhenAll waits for BOTH to finish even when one faults —
        // so after the catch, each task's status is safely inspectable.
    }
    catch
    {
        try
        {
            // Compensate whichever leg SUCCEEDED — either direction:
            if (withdraw.IsCompletedSuccessfully)
                await _processor.DepositAsync(payerUserId, amount);    // undo the withdraw
            if (deposit.IsCompletedSuccessfully)
                await _processor.WithdrawAsync(payeeUserId, amount);   // undo the deposit
        }
        catch (Exception ex)
        {
            // Compensation ITSELF failed: the books are now wrong and no code
            // path can fix them. Real systems: durable outbox + retry + page a human.
            _logger.LogCritical(ex,
                "COMPENSATION FAILED: transfer {Payer}->{Payee} amount {Amount} needs manual repair",
                payerUserId, payeeUserId, amount);
        }
        throw;   // rethrow the original failure — the middleware maps it to a status
    }
}
```

(`PaymentService` now takes `PaymentProcessorClient`, `AccountLocks`, and `ILogger<PaymentService>` — plus the `DbContext` it keeps for balance reads. Constructor injection scales; that's the point of it.)

Three honest observations, in ascending order of seniority:

1. **Concurrent legs change the failure geometry.** Sequential withdraw-then-deposit could only strand money in one direction; with both in flight, *either* leg can be the survivor, so compensation must handle both — that's why the catch inspects `IsCompletedSuccessfully` on each task.
2. **This is "atomic" with an asterisk.** Locks + compensation make the pair *appear* all-or-nothing in every failure you can catch — but if the process dies between the legs, no catch block runs. True atomicity across two HTTP calls does not exist (this is the two-generals problem); real processors approximate it with **authorize/capture** (place a hold, then settle) and idempotency keys. The catch block is a **saga** in miniature: load-bearing *and* insufficient, and knowing both halves is the interview answer.
3. **The locks are per-process; the SQL is the backstop.** Two API replicas each have their own `AccountLocks` — across replicas, correctness rests on the processor's atomic `UPDATE`, which is exactly where it should rest. The locks' real job is serializing *sagas* on the same accounts within an instance, so a compensation deposit can't interleave with another transfer's withdraw. Defense in depth, each layer honest about what it guards.

## Gap 4 — background work: a `BackgroundService` auditor

The reconciliation job every payment company runs, in miniature — and it carries a classic production gotcha:

`Services/SettlementAuditor.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PaymentApp.Data;

namespace PaymentApp.Services;

public class SettlementAuditor : BackgroundService     // ≈ a node-cron worker, in-process
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<SettlementAuditor> _logger;

    // GOTCHA: BackgroundService is a SINGLETON; PaymentDbContext is SCOPED.
    // You cannot inject a scoped service into a singleton (the container throws
    // at startup). The pattern: inject the scope FACTORY, make a scope per tick.
    public SettlementAuditor(IServiceScopeFactory scopes, ILogger<SettlementAuditor> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using (var scope = _scopes.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
                var total = await db.Accounts.SumAsync(a => a.Balance, stoppingToken);
                _logger.LogInformation("AUDIT: total money in system = {Total}", total);
            }
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);   // respects shutdown
        }
    }
}
```

```csharp
builder.Services.AddHostedService<SettlementAuditor>();   // in Program.cs
```

It starts with the app, logs the invariant every 30 seconds, and drains politely on SIGTERM (the `stoppingToken` is Topic 8's graceful shutdown reaching into your loop). In Node this is a separate cron container or a BullMQ worker fleet; here it's a class in the same process and the same DI container — difference #5's last word.

## The three-service compose file

`docker-compose.yml` moves **up to the workspace root** (it now builds two apps), with contexts pointed into each project:

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: payapp
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: payapp
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  processor:
    build: ./payment-processor
    ports: ["4000:4000"]
    environment:
      DATABASE_URL: "postgres://payapp:devpass@db:5432/payapp"
    depends_on: [db]

  api:
    build: ./PaymentApp
    ports: ["8080:8080"]
    environment:
      ConnectionStrings__PaymentDb: "Host=db;Database=payapp;Username=payapp;Password=devpass"
      PaymentProcessor__BaseUrl: "http://processor:4000"
      Jwt__Key: "compose-secret-key-32-chars-minimum!!"
      Jwt__Issuer: "paymentapp"
    depends_on: [db, processor]

volumes:
  pgdata:
```

Same service-name-as-hostname rule as Topic 8 (`Host=db`, `http://processor:4000`), now with three participants.

## Interview talking points

- "The middleware pipeline is Express's model with types: `app.Use` + `next()`, and a global exception-mapping middleware replaces per-controller try/catch — exception→status stated once."
- Validation has three layers, and you can name which rejected a request: **deserialization** (shape, Topic 4), **DataAnnotations** (per-field rules, automatic 400), **business rules** (state-dependent, exceptions from the service).
- "`IHttpClientFactory` typed clients: never `new HttpClient()` per request — socket exhaustion — and the client translates downstream HTTP into our domain exceptions."
- The money sentence: "each leg is an atomic conditional `UPDATE` in the database — that survives replicas; but splitting withdraw/deposit across services reopens atomicity as a saga: concurrent legs via `Task.WhenAll`, compensation for whichever leg survived, and a critical alert when compensation itself fails." One breath, five years of scars.
- Deadlock and lock ordering: "per-account gates acquired in ascending id order — a global acquisition order is the classic fix for circular wait." Producing the A→B/B→A deadlock on purpose (exercise 10.5) gives you a war story most candidates only know from textbooks.
- `BackgroundService` + `IServiceScopeFactory`: singleton hosts can't inject scoped services — make a scope per tick. Everyone hits this once; you've now hit it on purpose.
