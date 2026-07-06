# Topic 10: Pipeline & Integrations

> **How does a .NET service talk to the outside world — and what happens when the other end fails?**

## What this topic covers

| Gap | Solution | Node equivalent |
|-----|----------|-----------------|
| Request validation | DataAnnotations on DTOs | zod |
| Middleware pipeline | `app.Use(...)` + exception handler | Express middleware |
| Outbound HTTP | `IHttpClientFactory` + typed client | axios |
| Background work | `BackgroundService` | node-cron |

## Final architecture

```
client ──► PaymentApp (.NET)  ── validates, authenticates, orchestrates
              │
              └── POST /v1/withdraw, /v1/deposit ──► payment-processor (Node)
                                                            │
                         shared Postgres ───────────────────┘
```

**Key principle:** The processor is the ONLY writer of money (single-writer pattern). It uses atomic conditional SQL — replaces Topic 7's `SemaphoreSlim`.

## The payment processor (Node — provided)

A simple Express service with two endpoints. The key line:

```sql
UPDATE "Users" SET "Balance" = "Balance" - $1
WHERE "Id" = $2 AND "Balance" >= $1
RETURNING "Balance"
```

This **atomic conditional update** is the production fix for Topic 7's race. No app-level lock needed — works across any number of replicas.

(Full code in Hands On — `server.js`, `package.json`, `Dockerfile`)

## Gap 1: Declarative validation (≈ zod)

DataAnnotations on DTOs → automatic 400s before your action runs:

```csharp
public record RegisterRequest(
    [property: Required, MinLength(2)] string Name,
    [property: Required, EmailAddress] string Email,
    [property: Required, MinLength(8)] string Password);

public record TransferRequest(
    [property: Range(1, int.MaxValue)] int PayerUserId,
    [property: Range(1, int.MaxValue)] int PayeeUserId,
    [property: Range(0.01, 1_000_000)] decimal Amount);
```

**Result:** `{"errors": {"Amount": ["must be between 0.01 and 1000000"]}}` — like `zod.flatten()`.

**Rule:** Validation attributes = rules the request alone can answer. Business rules (insufficient funds) stay in service.

## Gap 2: Middleware pipeline (≈ Express)

**Inline middleware** (request timing):

```csharp
app.Use(async (context, next) =>
{
    var sw = Stopwatch.StartNew();
    await next();  // ≈ next()
    app.Logger.LogInformation("{Method} {Path} -> {Status} in {Elapsed}ms",
        context.Request.Method, context.Request.Path,
        context.Response.StatusCode, sw.ElapsedMilliseconds);
});
```

**Global exception handler** (replaces per-controller try/catch):

```csharp
public class ExceptionMappingMiddleware
{
    private readonly RequestDelegate _next;

    public async Task InvokeAsync(HttpContext context)
    {
        try { await _next(context); }
        catch (KeyNotFoundException ex)       { await Write(context, 404, ex.Message); }
        catch (InvalidOperationException ex)  { await Write(context, 400, ex.Message); }
        catch (HttpRequestException ex)       { await Write(context, 502, "Processor unavailable"); }
    }
}
```

Register **first** in pipeline:
```csharp
app.UseMiddleware<ExceptionMappingMiddleware>();
```

Now controllers are happy-path only. Exception→status mapping stated **once**.

## Gap 3: Outbound HTTP (`IHttpClientFactory`)

Never `new HttpClient()` per request — socket exhaustion. Use a typed client:

```csharp
public class PaymentClient
{
    private readonly HttpClient _http;
    public PaymentClient(HttpClient http) => _http = http;

    public Task WithdrawAsync(int userId, decimal amount) => PostAsync("v1/withdraw", userId, amount);
    public Task DepositAsync(int userId, decimal amount)  => PostAsync("v1/deposit", userId, amount);

    private async Task PostAsync(string path, int userId, decimal amount)
    {
        var response = await _http.PostAsJsonAsync(path, new { userId, amount });
        if (response.IsSuccessStatusCode) return;

        // Translate HTTP errors → domain exceptions
        var body = await response.Content.ReadFromJsonAsync<ProcessorError>();
        throw response.StatusCode switch
        {
            HttpStatusCode.NotFound   => new KeyNotFoundException(body?.Error ?? "Not found"),
            HttpStatusCode.BadRequest => new InvalidOperationException(body?.Error ?? "Rejected"),
            _ => new HttpRequestException($"Processor returned {(int)response.StatusCode}"),
        };
    }
}
```

Register:
```csharp
builder.Services.AddHttpClient<PaymentClient>(client =>
    client.BaseAddress = new Uri(builder.Configuration["PaymentProcessor:BaseUrl"]!));
```

## Transfer orchestration

Three jobs: **lock** both users, fire **both legs**, **compensate** on failure.

### Per-user locks (registered as singleton)

```csharp
public class UserLocks
{
    private readonly ConcurrentDictionary<int, SemaphoreSlim> _gates = new();

    public async Task<IDisposable> LockPairAsync(int userIdA, int userIdB)
    {
        // ALWAYS lock in ascending id order — prevents deadlock
        var (first, second) = userIdA < userIdB ? (userIdA, userIdB) : (userIdB, userIdA);
        await GateFor(first).WaitAsync();
        await GateFor(second).WaitAsync();
        return new Releaser(...);
    }
}
```

**Why ascending order?** Without it: Alice→Bob holds Alice, waits for Bob. Bob→Alice holds Bob, waits for Alice. **Deadlock.**

### The saga pattern

```csharp
public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    using var _ = await _locks.LockPairAsync(payerUserId, payeeUserId);

    var withdraw = _processor.WithdrawAsync(payerUserId, amount);
    var deposit  = _processor.DepositAsync(payeeUserId, amount);

    try { await Task.WhenAll(withdraw, deposit); }
    catch
    {
        // Compensate whichever leg succeeded
        if (withdraw.IsCompletedSuccessfully)
            await _processor.DepositAsync(payerUserId, amount);  // undo
        if (deposit.IsCompletedSuccessfully)
            await _processor.WithdrawAsync(payeeUserId, amount); // undo
        throw;
    }
}
```

**Key points:**
- `Task.WhenAll` = `Promise.all` — both legs in flight at once (I/O concurrency)
- Compensation handles both directions (either leg can be the survivor)
- If compensation fails → log critical, manual repair needed
- True atomicity across HTTP calls doesn't exist (two-generals problem)

## Gap 4: Background work (`BackgroundService`)

```csharp
public class SettlementAuditor : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;  // GOTCHA: must use factory, not direct injection

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
            var total = await db.Users.SumAsync(u => u.Balance, stoppingToken);
            _logger.LogInformation("AUDIT: total = {Total}", total);

            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }
}
```

Register: `builder.Services.AddHostedService<SettlementAuditor>();`

**Gotcha:** `BackgroundService` = singleton. `DbContext` = scoped. Can't inject scoped into singleton → use `IServiceScopeFactory`, create scope per tick.

**Node equivalent:** Separate cron container or BullMQ. Here it's in-process.

## Docker Compose (three services)

```yaml
services:
  db:
    image: postgres:17
    environment: { POSTGRES_USER: payapp, POSTGRES_PASSWORD: devpass, POSTGRES_DB: payapp }

  processor:
    build: ./payment-processor
    environment:
      DATABASE_URL: "postgres://payapp:devpass@db:5432/payapp"

  api:
    build: ./PaymentApp
    environment:
      ConnectionStrings__PaymentDb: "Host=db;..."
      PaymentProcessor__BaseUrl: "http://processor:4000"
      Jwt__Key: "..."
```

Service names = hostnames (`db`, `processor`).

## Interview talking points

- **Middleware:** Express's model with types. Global exception handler replaces per-controller try/catch.
- **Validation layers:** Deserialization (shape) → DataAnnotations (per-field) → Business rules (state). Name which rejected.
- **HttpClient:** Never `new HttpClient()` — socket exhaustion. Typed clients translate HTTP → domain exceptions.
- **The money sentence:** "Atomic SQL in the database survives replicas. Cross-service = saga: concurrent legs, compensation for survivors, critical alert when compensation fails."
- **Deadlock fix:** Per-user gates in ascending id order. Global acquisition order prevents circular wait.
- **BackgroundService:** Singleton can't inject scoped. Use `IServiceScopeFactory`, create scope per tick.
