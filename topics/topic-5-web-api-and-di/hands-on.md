# Topic 5: Hands On

> **The PaymentApp build:** **Topic 5 (you are here): the API is born — straight onto Postgres** → Topic 6 EF Core unpacked + tests → Topic 7 the transfer race → Topic 8 Docker & ship → Topic 9 register, login, lock down → Topic 10 the pipeline & the payment processor.

Build the API from Concepts first (type it in, don't paste), then extend it. Try each exercise before reading its solution. Budget ~90 minutes for the build plus all four exercises.

## Exercise 5.0 — Build Concepts' API, in dependency order

Scaffold (`dotnet new webapi --use-controllers -n PaymentApp`, delete the WeatherForecast files, add the three packages), write the compose file, `docker compose up -d`, then type Concepts' files **bottom of the dependency chain upward** — each file only references files that already exist:

1. `Models/User.cs` and `Models/Account.cs` — the entities
2. `Models/Requests.cs` — the DTOs (records: `RegisterRequest`, `TransferRequest`, `UserResponse`)
3. `Data/PaymentDbContext.cs` — the database session (minimal; Topic 6 unpacks it)
4. `Services/IPaymentService.cs` — the contract
5. `Services/PaymentService.cs` — the implementation, against the real database
6. `Controllers/UsersController.cs`, `AccountsController.cs`, `PaymentsController.cs`
7. `Program.cs` — the DI registrations

Then the schema cookbook (`dotnet ef migrations add InitialCreate` + `dotnet ef database update` — Topic 6 explains what just happened) and `dotnet run`.

Two checkpoints while typing:

- After each file, glance at the Problems panel. Forget `using PaymentApp.Models;` in the interface file and you get **CS0246: The type or namespace name 'User' could not be found** — fixing these as you go teaches the namespace system faster than reading about it.
- Read the `AddScoped` registration aloud as *"when anyone asks for `IPaymentService`, hand them a `PaymentService` — a fresh one per request."*

Note the port from `dotnet run` (use it wherever the exercises say `PORT`), and leave the app running — every exercise below happens against the live app from a second terminal.

## Exercise 5.1 — Prove it works

1. Register Alice and Bob, then check both balances:

```bash
curl -i -X POST http://localhost:PORT/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'

curl -X POST http://localhost:PORT/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@bank.test","password":"Passw0rd!"}'

curl http://localhost:PORT/v1/accounts/1/balance     # 1000
curl http://localhost:PORT/v1/accounts/2/balance     # 1000
```

2. Transfer $250 from Alice (user 1) to Bob (user 2), and confirm both balances moved.
3. Break it four ways and note the status code of each: transfer to user 999; transfer with a negative amount; transfer more than Alice has; transfer with `"amount":"heaps"`. **Which of the four responses came from *your* code, and which came from the platform?**
4. One more that in-memory apps can't do: `Ctrl+C` the app, start it again, and read Alice's balance. Where does the state actually live?

**Solution**

1. Registration returns **201** with a `Location` header (from `CreatedAtAction`) and the `UserResponse` JSON — note there's no `passwordHash` field in it, and the JSON is camelCased even though your C# properties are PascalCase (the web defaults translate for JS clients).

2.

```bash
curl -X POST http://localhost:PORT/v1/payments/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":250}'
# {"status":"completed"}
curl http://localhost:PORT/v1/accounts/1/balance     # 750
curl http://localhost:PORT/v1/accounts/2/balance     # 1250
```

3. The four failures:

| Payload | Status | Came from |
|---|---|---|
| payee 999 | **404** `{"error":"No account for user 999."}` | your `catch (KeyNotFoundException)` |
| negative amount | **400** `{"error":"Amount must be positive."}` | your `catch (ArgumentException)` |
| amount > balance | **400** `{"error":"Insufficient funds."}` | your `catch (InvalidOperationException)` |
| `"amount":"heaps"` | **400** problem-details naming `$.amount` | `[ApiController]` + the deserializer — your code never ran |

The last row is the one to internalize: Topic 4's boundary enforcement rejected the payload before routing even reached your action. You wrote zero validation code for it.

4. Balances survive the restart because state lives in **Postgres**, not in any C# object — the service instance that handled the transfer was garbage-collected long ago; only rows remain. This is *why* `AddScoped` is the right lifetime here: a fresh service per request is fine when the service holds no state of its own. (Topic 6's exercises push this further: the data even survives killing the database *container*.)

## Exercise 5.2 — Break the lifetimes: the captive dependency

Concepts claimed "a service's lifetime is bounded by its shortest-lived dependency." Prove the container enforces it:

1. Change the service registration to `AddSingleton<IPaymentService, PaymentService>();` and restart. What happens — and *when* does it happen (first request, or earlier)?
2. Read the error aloud and explain in your own words *why* this combination is dangerous enough to refuse outright. What would actually go wrong if the container allowed it?
3. Revert to `AddScoped`. Then, for the interview: one sentence each on a dependency you'd register as scoped, transient, and singleton in a real service.

**Solution**

1. The app **refuses to start** — no request needed:

```
System.AggregateException: Some services are not able to be constructed
 ---> InvalidOperationException: Cannot consume scoped service
      'PaymentApp.Data.PaymentDbContext' from singleton
      'PaymentApp.Services.IPaymentService'.
```

The container validates the whole dependency graph at startup (in the Development environment) and rejects the lifetime mismatch before it can hurt anyone. Compare the Node equivalent: nothing stops a module-level singleton from capturing a per-request object — you find out in production, via weirdness.

2. A singleton lives forever; a scoped `DbContext` is one request's database session. If the container allowed the capture, the *first* request's DbContext would secretly become the *app-wide* one: its change-tracker accumulating every entity ever touched (a memory leak with a business model), stale reads served forever, and — because `DbContext` is not thread-safe — concurrent requests corrupting each other through it (Topic 7 gives you the vocabulary for how bad that gets). This failure mode has a name — a **captive dependency** — and "the DI container validates the graph at startup" is the .NET-specific fact worth saying in an interview.

3. Typical answers:
   - **Scoped:** the EF Core `DbContext` — one unit-of-work per request; you're living this choice already.
   - **Transient:** a cheap, stateless helper — a validator or a `FeeCalculator`.
   - **Singleton:** something stateless/thread-safe shared by everyone — your `PasswordHasher`, an `HttpClient`-based API client (Topic 10), a cache, configuration.

**Talking point:** the classic DI bug family is "long-lived thing holding short-lived state" — a singleton with per-request state, or a singleton capturing a scoped dependency. You've now watched the container refuse the second one at startup, which is a story most candidates can't tell.

## Exercise 5.3 — The deposit endpoint

Add `POST /v1/accounts/{userId}/deposit` that adds money to an account. Work in dependency order — contract, implementation, endpoint — and use the compiler as your to-do list.

1. Add `Task<decimal> DepositAsync(int userId, decimal amount)` to the interface (returns the new balance; throw for unknown user or non-positive amount).
2. Save and read the error on `PaymentService` before fixing it — what does it say?
3. Add the controller action: define `record DepositRequest(decimal Amount);`, return 200 with the new balance, 404 for a missing user.
4. Verify with curl: deposit → balance changed; deposit to user 999 → 404.

**Solution**

`Services/IPaymentService.cs` — add:

```csharp
Task<decimal> DepositAsync(int userId, decimal amount);
```

2\. The moment you save: **CS0535: 'PaymentService' does not implement interface member 'IPaymentService.DepositAsync(int, decimal)'**. That error is the point — nominal typing means the contract *forces* every implementation to catch up before the code compiles again.

`Services/PaymentService.cs` — add:

```csharp
public async Task<decimal> DepositAsync(int userId, decimal amount)
{
    if (amount <= 0) throw new ArgumentException("Amount must be positive.");
    var account = await _db.Accounts.FirstOrDefaultAsync(a => a.UserId == userId)
        ?? throw new KeyNotFoundException($"No account for user {userId}.");
    account.Balance += amount;          // mutate the tracked entity...
    await _db.SaveChangesAsync();       // ...EF writes the UPDATE (Topic 6: change tracking)
    return account.Balance;
}
```

`Controllers/AccountsController.cs` — add (and put `record DepositRequest(decimal Amount);` in `Models/Requests.cs`):

```csharp
[HttpPost("{userId}/deposit")]                  // POST /v1/accounts/3/deposit
public async Task<ActionResult<decimal>> Deposit(int userId, DepositRequest request)
{
    try
    {
        var balance = await _payments.DepositAsync(userId, request.Amount);
        return Ok(balance);
    }
    catch (KeyNotFoundException ex) { return NotFound(new { error = ex.Message }); }
    catch (ArgumentException ex)    { return BadRequest(new { error = ex.Message }); }
}
```

```bash
curl -X POST http://localhost:PORT/v1/accounts/1/deposit \
  -H "Content-Type: application/json" -d '{"amount":500}'      # 1250 (or wherever Alice was)
curl -i -X POST http://localhost:PORT/v1/accounts/999/deposit \
  -H "Content-Type: application/json" -d '{"amount":500}'      # 404
```

Note what you did *not* touch: `Program.cs`. The registration maps the interface to the class once; growing the interface is invisible to the wiring.

## Exercise 5.4 — A second injected dependency

Inject ASP.NET Core's built-in `ILogger<PaymentsController>` into the payments controller alongside the service (add a constructor parameter — no registration needed; the platform pre-registers logging). Log a warning whenever a transfer over $10,000 is attempted — the compliance flavor is deliberate. Watch it appear in the `dotnet run` console output.

What does it tell you that you never registered `ILogger<T>` yourself?

**Solution**

```csharp
public class PaymentsController : ControllerBase
{
    private readonly IPaymentService _payments;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(IPaymentService payments, ILogger<PaymentsController> logger)
    {
        _payments = payments;
        _logger = logger;
    }

    [HttpPost("transfer")]
    public async Task<ActionResult> Transfer(TransferRequest request)
    {
        if (request.Amount > 10_000)
            _logger.LogWarning("Large transfer: user {Payer} -> user {Payee}, amount {Amount}",
                request.PayerUserId, request.PayeeUserId, request.Amount);
        // ... rest unchanged
    }
}
```

(The `{Payer}` placeholders are **structured logging** — named properties, not string interpolation; log aggregators index them. Use this, not `$"..."`, in log calls. In a payment system this exact log line is the seed of an AML alert.)

**What it tells you:** the platform pre-registers dozens of services (logging, config, `HttpClientFactory`, hosting) in the same container your own services go into. "Batteries included" isn't a list of libraries — it's one container everything shares. You added a constructor parameter and the wiring came from the platform.
