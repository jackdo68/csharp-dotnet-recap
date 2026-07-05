# Topic 5: Exercises & Solutions

> **The PaymentApp build:** **Topic 5 (you are here): the API is born, in-memory** → Topic 6 Postgres + tests → Topic 7 the transfer race → Topic 8 Docker & ship → Topic 9 register, login, lock down → Topic 10 the pipeline & the payment processor.

Build the API from the lesson first (type it in, don't paste), then extend it. Try each exercise before reading its solution. Budget ~90 minutes for the build plus all four exercises.

## Exercise 5.0 — Build the lesson's API, in dependency order

Scaffold (`dotnet new webapi --use-controllers -n PaymentApp`, delete the WeatherForecast files, add the `Microsoft.Extensions.Identity.Core` package), then type the lesson's files **bottom of the dependency chain upward** — each file only references files that already exist:

1. `Models/User.cs` and `Models/Account.cs` — the entities
2. `Models/Requests.cs` — the DTOs (records: `RegisterRequest`, `TransferRequest`, `UserResponse`)
3. `Services/IPaymentService.cs` — the contract
4. `Services/PaymentService.cs` — the in-memory implementation
5. `Controllers/UsersController.cs`, `AccountController.cs`, `PaymentsController.cs`
6. `Program.cs` — the DI registrations

Two checkpoints while typing:

- After each file, glance at the Problems panel. Forget `using PaymentApp.Models;` in the interface file and you get **CS0246: The type or namespace name 'User' could not be found** — fixing these as you go teaches the namespace system faster than reading about it.
- The lines that make everything work are the two `AddSingleton` registrations — read the first one aloud as *"when anyone asks for `IPaymentService`, hand them the one shared `PaymentService`."*

Finish with `dotnet run`, note the port (use it wherever the exercises say `PORT`), and leave it running — every exercise below happens against the live app from a second terminal.

## Exercise 5.1 — Prove it works

1. Register Alice and Bob, then check both balances:

```bash
curl -i -X POST http://localhost:PORT/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'

curl -X POST http://localhost:PORT/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@bank.test","password":"Passw0rd!"}'

curl http://localhost:PORT/v1/account/1/balance     # 1000
curl http://localhost:PORT/v1/account/2/balance     # 1000
```

2. Transfer $250 from Alice (user 1) to Bob (user 2), and confirm both balances moved.
3. Break it four ways and note the status code of each: transfer to user 999; transfer with a negative amount; transfer more than Alice has; transfer with `"amount":"heaps"`. **Which of the four responses came from *your* code, and which came from the platform?**

**Solution**

1. Registration returns **201** with a `Location` header (from `CreatedAtAction`) and the `UserResponse` JSON — note there's no `passwordHash` field in it, and the JSON is camelCased even though your C# properties are PascalCase (the web defaults translate for JS clients).

2.

```bash
curl -X POST http://localhost:PORT/v1/payments/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":250}'
# {"status":"completed"}
curl http://localhost:PORT/v1/account/1/balance     # 750
curl http://localhost:PORT/v1/account/2/balance     # 1250
```

3. The four failures:

| Payload | Status | Came from |
|---|---|---|
| payee 999 | **404** `{"error":"No account for user 999."}` | your `catch (KeyNotFoundException)` |
| negative amount | **400** `{"error":"Amount must be positive."}` | your `catch (ArgumentException)` |
| amount > balance | **400** `{"error":"Insufficient funds."}` | your `catch (InvalidOperationException)` |
| `"amount":"heaps"` | **400** problem-details naming `$.amount` | `[ApiController]` + the deserializer — your code never ran |

The last row is the one to internalize: Topic 4's boundary enforcement rejected the payload before routing even reached your action. You wrote zero validation code for it.

## Exercise 5.2 — Break it with the wrong lifetime

1. Change the `IPaymentService` registration to `AddScoped`. Restart, register Alice (note the 201!), then immediately check her balance. What happens, and why exactly?
2. Now reason: with `AddSingleton`, the controller is still created per request — so why does the data survive?
3. Put it back to `AddSingleton`. In one sentence each, name a dependency you'd register as scoped, transient, and singleton in a real service.

**Solution**

1. Registration succeeds (201), then `GET /v1/account/1/balance` returns **404** — Alice is *gone*. `AddScoped` = one instance per HTTP request: the register request got a fresh `PaymentService` (empty lists), added Alice, returned — and that instance became garbage when the request ended. The balance request got its *own* fresh, empty bank. Two requests, two services, two banks.
2. With `AddSingleton`, controllers are still built per request, but the container hands *every* controller the **same one** `PaymentService` — the controller is disposable; its dependency is shared. Lifetime is a property of each registration, not of the request pipeline.
3. Typical answers:
   - **Scoped:** the EF Core `DbContext` — one unit-of-work per request (Topic 6).
   - **Transient:** a cheap, stateless helper — a validator or a `FeeCalculator`.
   - **Singleton:** something expensive and thread-safe shared by everyone — an `HttpClient`-based API client, a cache, configuration. (The password hasher you registered is exactly this: stateless, safe to share.)

**Talking point:** "a singleton holding per-request state" is the classic DI bug — you just built its inverse (scoped holding app-wide state) on purpose. Interviewers love this story.

## Exercise 5.3 — The deposit endpoint

Add `POST /v1/account/{userId}/deposit` that adds money to an account. Work in dependency order — contract, implementation, endpoint — and use the compiler as your to-do list.

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
public Task<decimal> DepositAsync(int userId, decimal amount)
{
    if (amount <= 0) throw new ArgumentException("Amount must be positive.");
    var account = _accounts.FirstOrDefault(a => a.UserId == userId)
        ?? throw new KeyNotFoundException($"No account for user {userId}.");
    account.Balance += amount;
    return Task.FromResult(account.Balance);
}
```

`Controllers/AccountController.cs` — add (and put `record DepositRequest(decimal Amount);` in `Models/Requests.cs`):

```csharp
[HttpPost("{userId}/deposit")]                  // POST /v1/account/3/deposit
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
curl -X POST http://localhost:PORT/v1/account/1/deposit \
  -H "Content-Type: application/json" -d '{"amount":500}'      # 1250 (or wherever Alice was)
curl -i -X POST http://localhost:PORT/v1/account/999/deposit \
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
