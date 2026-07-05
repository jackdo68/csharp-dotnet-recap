# Topic 5: Web API & Dependency Injection — batteries included

## The one question this topic answers

> **How does a real .NET service hang together — and why is dependency injection the organizing principle instead of an optional pattern?**

## The philosophy split

Node's philosophy: a minimal core, then *you assemble* the stack — Express, an ORM, validation, a test runner — and wire the pieces together yourself. .NET's philosophy: one platform **ships** the web framework (ASP.NET Core), the ORM (EF Core), config, logging, and — crucially — a built-in **dependency injection container** as the single organizing principle. You never `new` up a dependency: a class declares what it needs in its constructor, and the wiring is registered once at startup.

The other half is **convention over configuration**: controller classes auto-route from attributes, `IThing`/`Thing` pairs, the `Async` suffix, namespaces mirroring folders. More upfront structure than Node — but every unfamiliar .NET codebase looks broadly alike, which is exactly what you want when joining one.

## What we're building (Topics 5–9)

A small **payment service** — the app the rest of the course grows one topic at a time:

| Endpoint | Access | Arrives in |
|---|---|---|
| `POST /v1/register` — name, email, password → new user + account | public | **Topic 5** |
| `GET /v1/account/{userId}/balance` | public *for now* | **Topic 5** |
| `POST /v1/payments/transfer` — payer, payee, amount | public *for now* | **Topic 5** |
| `POST /v1/login` — email + password → JWT | public | Topic 9 |
| the two money endpoints locked behind tokens | private | Topic 9 |

Two tables' worth of domain: a **User** (name, email, hashed password) and their **Account** (balance). In this topic it all lives in memory; Topic 6 moves it to Postgres, Topic 7 exposes the transfer race condition hiding in today's code, Topic 8 ships it in Docker, Topic 9 locks it down.

## Build it: the Payment API

```bash
dotnet new webapi --use-controllers -n PaymentApp
cd PaymentApp
dotnet run    # note the port, Ctrl+C to stop
rm Controllers/WeatherForecastController.cs WeatherForecast.cs 2>/dev/null
dotnet add package Microsoft.Extensions.Identity.Core   # just for the password hasher
```

(`--use-controllers` gives the classic controller style — what banks use and interviewers expect — rather than minimal APIs, which are Express-style route lambdas.)

### The domain — `Models/User.cs` and `Models/Account.cs`

```csharp
namespace PaymentApp.Models;

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";   // NEVER the password itself
}
```

```csharp
namespace PaymentApp.Models;

public class Account
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public decimal Balance { get; set; }   // money = decimal. Always.
}
```

### The DTOs — `Models/Requests.cs`

```csharp
namespace PaymentApp.Models;

// What clients send us. Records: immutable data that flows (Topic 2's rule).
public record RegisterRequest(string Name, string Email, string Password);
public record TransferRequest(int PayerUserId, int PayeeUserId, decimal Amount);

// What we send back for a user. Deliberately NOT the entity:
// serializing User would leak PasswordHash into JSON. Shape the response.
public record UserResponse(int Id, string Name, string Email);
```

That `UserResponse` is a real security habit, not ceremony — the same reason your Node code never `res.json(userDoc)` straight from Mongo.

### The contract — `Services/IPaymentService.cs`

```csharp
using PaymentApp.Models;

namespace PaymentApp.Services;

// The contract. Controllers depend on THIS, not the concrete class.
public interface IPaymentService
{
    Task<User> RegisterAsync(RegisterRequest request);
    Task<decimal?> GetBalanceAsync(int userId);
    Task TransferAsync(int payerUserId, int payeeUserId, decimal amount);
}
```

### A first implementation — `Services/PaymentService.cs`

In-memory for now; Topic 6 swaps in Postgres *without touching the controllers* — that's the payoff of the interface.

```csharp
using Microsoft.AspNetCore.Identity;
using PaymentApp.Models;

namespace PaymentApp.Services;

public class PaymentService : IPaymentService
{
    private readonly List<User> _users = new();
    private readonly List<Account> _accounts = new();
    private int _nextUserId = 1;
    private int _nextAccountId = 1;
    private readonly IPasswordHasher<User> _hasher;

    // The hasher is itself injected — dependencies all the way down.
    public PaymentService(IPasswordHasher<User> hasher)
    {
        _hasher = hasher;
    }

    public Task<User> RegisterAsync(RegisterRequest request)
    {
        var user = new User { Id = _nextUserId++, Name = request.Name, Email = request.Email };
        user.PasswordHash = _hasher.HashPassword(user, request.Password);  // salted, framework crypto
        _users.Add(user);

        // Every new user gets an account with a $1,000 starting balance
        // (so transfers are testable — think "demo bank").
        _accounts.Add(new Account { Id = _nextAccountId++, UserId = user.Id, Balance = 1000m });

        return Task.FromResult(user);   // Task.FromResult = Promise.resolve
    }

    public Task<decimal?> GetBalanceAsync(int userId)
    {
        var account = _accounts.FirstOrDefault(a => a.UserId == userId);  // LINQ .find()
        return Task.FromResult(account?.Balance);   // null if no such user
    }

    public Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
    {
        if (amount <= 0)
            throw new ArgumentException("Amount must be positive.");

        var payer = _accounts.FirstOrDefault(a => a.UserId == payerUserId)
            ?? throw new KeyNotFoundException($"No account for user {payerUserId}.");
        var payee = _accounts.FirstOrDefault(a => a.UserId == payeeUserId)
            ?? throw new KeyNotFoundException($"No account for user {payeeUserId}.");

        if (payer.Balance < amount)
            throw new InvalidOperationException("Insufficient funds.");

        // Read-check-modify on shared state. Looks innocent.
        // Topic 7 demonstrates exactly how this loses money under load.
        payer.Balance -= amount;
        payee.Balance += amount;

        return Task.CompletedTask;   // async signature, nothing to await yet
    }
}
```

Two new pieces: `Task.CompletedTask` is the `void` sibling of `Task.FromResult` (a resolved `Promise<void>`), and the typed exceptions are Topic 4's philosophy in service code — the *service* states what went wrong; the *controller* decides what that means in HTTP.

### The controllers — thin HTTP shells

`Controllers/UsersController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Models;
using PaymentApp.Services;

namespace PaymentApp.Controllers;

[ApiController]                 // enables model validation + nice defaults
[Route("v1")]
public class UsersController : ControllerBase
{
    private readonly IPaymentService _payments;

    // Constructor injection: .NET hands us the service automatically.
    public UsersController(IPaymentService payments)
    {
        _payments = payments;
    }

    [HttpPost("register")]                       // POST /v1/register
    public async Task<ActionResult<UserResponse>> Register(RegisterRequest request)
    {
        var user = await _payments.RegisterAsync(request);
        var response = new UserResponse(user.Id, user.Name, user.Email);  // no hash leaves the building
        return CreatedAtAction(nameof(Register), new { id = user.Id }, response);  // 201 + Location
    }
}
```

`Controllers/AccountController.cs`:

```csharp
[ApiController]
[Route("v1/account")]
public class AccountController : ControllerBase
{
    private readonly IPaymentService _payments;

    public AccountController(IPaymentService payments) => _payments = payments;

    [HttpGet("{userId}/balance")]                // GET /v1/account/3/balance
    public async Task<ActionResult<decimal>> GetBalance(int userId)
    {
        var balance = await _payments.GetBalanceAsync(userId);
        if (balance is null) return NotFound();  // 404 — typed HTTP outcome, not a crash
        return Ok(balance);
    }
}
```

(Topic 9 changes this route to `GET /v1/account/balance` — *whose* balance will come from the token, not the URL. Until then, the URL parameter is an honest placeholder.)

`Controllers/PaymentsController.cs` — where Topic 4 pays off:

```csharp
[ApiController]
[Route("v1/payments")]
public class PaymentsController : ControllerBase
{
    private readonly IPaymentService _payments;

    public PaymentsController(IPaymentService payments) => _payments = payments;

    [HttpPost("transfer")]                       // POST /v1/payments/transfer
    public async Task<ActionResult> Transfer(TransferRequest request)
    {
        try
        {
            await _payments.TransferAsync(request.PayerUserId, request.PayeeUserId, request.Amount);
            return Ok(new { status = "completed" });
        }
        catch (KeyNotFoundException ex)          // unknown payer/payee
        {
            return NotFound(new { error = ex.Message });
        }
        catch (ArgumentException ex)             // bad amount
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)     // insufficient funds
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
```

The catch blocks route by exception *type* — Topic 4's exercise 4.4, now earning rent in a real API.

Unpacking the new syntax across the three controllers:

- `[ApiController]`, `[Route(...)]`, `[HttpGet]` — **attributes**: C#'s decorators. If you've seen NestJS, they're exactly `@Controller()` / `@Get(':id')`, written in square brackets above the target.
- `: ControllerBase` — the colon is `extends` and `implements` in one (base class first, then interfaces).
- `ActionResult<T>` — "either a `T` or any HTTP result like `NotFound()`": how a nominal language expresses TS's union return.
- `=> _payments = payments;` — an expression-bodied constructor: same one-liner arrow you met on properties.
- `new { status = "completed" }` — an **anonymous type**: the one place C# allows an ad-hoc object literal.

### Wire it up — `Program.cs`

```csharp
using Microsoft.AspNetCore.Identity;
using PaymentApp.Models;
using PaymentApp.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// 👇 THIS is dependency injection registration.
// "When something asks for IPaymentService, give it a PaymentService."
// Singleton because our store is an in-memory list — one instance
// for the whole app, or users and balances vanish between requests.
builder.Services.AddSingleton<IPaymentService, PaymentService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();

var app = builder.Build();

app.MapControllers();

app.Run();
```

## DI lifetimes (you will get asked this)

- **`AddScoped`** — one instance per HTTP request (the usual default).
- **`AddTransient`** — a new instance every time it's asked for.
- **`AddSingleton`** — one instance for the whole app lifetime.

We used `AddSingleton` above only because the service *is* the data store right now — with `AddScoped`, every request would get a fresh empty bank. Once Postgres holds the data (Topic 6), the service switches to the usual `AddScoped`. The exercises make you watch this go wrong.

## Trace one request (so the magic is mechanical)

1. `POST /v1/payments/transfer` arrives; ASP.NET Core matches it to `PaymentsController.Transfer`.
2. To build the controller, the DI container sees the constructor needs `IPaymentService`, looks up the registration, and injects the singleton `PaymentService`. It reads the constructor's parameter *types at runtime* — Topic 3's runtime types making Topic 5's DI possible.
3. The JSON body is auto-deserialized into `TransferRequest` — Topic 4's boundary enforcement; `{"amount":"heaps"}` becomes an automatic 400 before your code runs.
4. `await` frees the thread during real I/O (Topic 7 explains where it goes).
5. The returned object is auto-serialized to JSON (camelCased for JS clients).

In Express you'd wire middleware and instantiate everything yourself. Here the wiring comes from registrations — more upfront structure, far less glue code.

## Interview talking points

- Constructor injection + the three lifetimes (`Scoped` vs `Transient` vs `Singleton`) — the most likely C#-specific question. Know a failure story: a singleton holding per-request state (or its inverse, which you're about to build).
- *Why* DI: loose coupling and testability — swap the real service for a fake in tests (Topic 6 does exactly that).
- Controllers depend on interfaces, never concrete classes; the container binds by declared relationships (Topic 2's nominal typing).
- Attributes ≈ decorators; `[ApiController]` gives automatic model validation → 400s.
- Return DTOs, not entities — "so the password hash can't leak into JSON" is a senior-sounding sentence because it's a junior-shaped bug.
