# Topic 5: Hands On

> **The PaymentApp build:** **Topic 5 (you are here): the API is born — straight onto Postgres** → Topic 6 EF Core unpacked + tests → Topic 7 document upload + the transfer race → Topic 8 Docker & ship → Topic 9 register, login, lock down → Topic 10 the pipeline & the payment processor.

This is where the app is **built** — the full code for every file is below. Type it in (don't paste), then run the drills. Budget ~90 minutes.

## Exercise 5.0 — Build the API, in dependency order

Scaffold, add packages, write the compose file, `docker compose up -d`, then type the files **bottom of the dependency chain upward** — each references only files that already exist.

```bash
dotnet new webapi --use-controllers -n PaymentApp
cd PaymentApp
rm Controllers/WeatherForecastController.cs WeatherForecast.cs 2>/dev/null

dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL   # Postgres driver + EF provider (the `pg` of .NET)
dotnet add package Microsoft.EntityFrameworkCore.Design    # migrations tooling
dotnet add package Microsoft.Extensions.Identity.Core      # just the password hasher
```

`docker-compose.yml` — the identical file a Node team would write:

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: payapp
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: payapp
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data   # data survives container restarts

volumes:
  pgdata:
```

```bash
docker compose up -d
```

**1. `Models/User.cs`** — the one and only table. Balance lives here; there is no `Account`:

```csharp
namespace PaymentApp.Models;

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";   // NEVER the password itself
    public decimal Balance { get; set; }             // money = decimal. Always.
    public string? File { get; set; }                // uploaded .txt filename (filled in Topic 7)
}
```

**2. `Models/Requests.cs`** — the DTOs (records: immutable data that flows). `UserResponse` is deliberately *not* the entity, so `PasswordHash` can't leak into JSON:

```csharp
namespace PaymentApp.Models;

public record RegisterRequest(string Name, string Email, string Password);
public record TransferRequest(int PayerUserId, int PayeeUserId, decimal Amount);
public record UserResponse(int Id, string Name, string Email);
```

**3. `Data/PaymentDbContext.cs`** — the database session (minimal; Topic 6 unpacks every line):

```csharp
using Microsoft.EntityFrameworkCore;
using PaymentApp.Models;

namespace PaymentApp.Data;

public class PaymentDbContext : DbContext
{
    public PaymentDbContext(DbContextOptions<PaymentDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();   // one DbSet -> one "Users" table
}
```

**4. `Services/IAuthService.cs`** — the auth contract (login + tokens arrive in Topic 9):

```csharp
using PaymentApp.Models;

namespace PaymentApp.Services;

public interface IAuthService
{
    Task<User> RegisterAsync(RegisterRequest request);
}
```

**5. `Services/AuthService.cs`** — hash the password, save the user with a $1,000 starting balance:

```csharp
using Microsoft.AspNetCore.Identity;
using PaymentApp.Data;
using PaymentApp.Models;

namespace PaymentApp.Services;

public class AuthService : IAuthService
{
    private readonly PaymentDbContext _db;
    private readonly IPasswordHasher<User> _hasher;

    public AuthService(PaymentDbContext db, IPasswordHasher<User> hasher)
    {
        _db = db;
        _hasher = hasher;
    }

    public async Task<User> RegisterAsync(RegisterRequest request)
    {
        var user = new User
        {
            Name = request.Name,
            Email = request.Email,
            Balance = 1000m,          // every new user starts with $1,000 (demo bank)
        };
        user.PasswordHash = _hasher.HashPassword(user, request.Password);  // salted, framework crypto
        _db.Users.Add(user);          // stage the insert
        await _db.SaveChangesAsync(); // commit -> EF fills user.Id
        return user;
    }
}
```

**6. `Services/IPaymentService.cs`** and **`Services/PaymentService.cs`** — transfer moves money between two users' balances. The read-check-modify here is deliberately racy; Topic 7 fixes it:

```csharp
using PaymentApp.Models;

namespace PaymentApp.Services;

public interface IPaymentService
{
    Task TransferAsync(int payerUserId, int payeeUserId, decimal amount);
}
```

```csharp
using Microsoft.EntityFrameworkCore;
using PaymentApp.Data;

namespace PaymentApp.Services;

public class PaymentService : IPaymentService
{
    private readonly PaymentDbContext _db;
    public PaymentService(PaymentDbContext db) => _db = db;

    public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
    {
        if (amount <= 0)
            throw new ArgumentException("Amount must be positive.");

        var payer = await _db.Users.FirstOrDefaultAsync(u => u.Id == payerUserId)
            ?? throw new KeyNotFoundException($"No user {payerUserId}.");
        var payee = await _db.Users.FirstOrDefaultAsync(u => u.Id == payeeUserId)
            ?? throw new KeyNotFoundException($"No user {payeeUserId}.");

        if (payer.Balance < amount)
            throw new InvalidOperationException("Insufficient funds.");

        // Read-check-modify on shared money. Looks innocent — Topic 7 shows how it loses money under load.
        payer.Balance -= amount;
        payee.Balance += amount;
        await _db.SaveChangesAsync();   // one commit, both rows (EF change tracking — Topic 6)
    }
}
```

**7. The controllers** — thin HTTP shells. `Controllers/AuthController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Models;
using PaymentApp.Services;

namespace PaymentApp.Controllers;

[ApiController]
[Route("v1/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _auth;
    public AuthController(IAuthService auth) => _auth = auth;

    [HttpPost("register")]                       // POST /v1/auth/register
    public async Task<ActionResult<UserResponse>> Register(RegisterRequest request)
    {
        var user = await _auth.RegisterAsync(request);
        var response = new UserResponse(user.Id, user.Name, user.Email);  // no hash leaves the building
        return CreatedAtAction(nameof(Register), new { id = user.Id }, response);  // 201 + Location
    }
}
```

`Controllers/PaymentController.cs` — where Topic 4's catch-by-type earns rent:

```csharp
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Models;
using PaymentApp.Services;

namespace PaymentApp.Controllers;

[ApiController]
[Route("v1/payment")]
public class PaymentController : ControllerBase
{
    private readonly IPaymentService _payments;
    public PaymentController(IPaymentService payments) => _payments = payments;

    [HttpPost("transfer")]                       // POST /v1/payment/transfer
    public async Task<ActionResult> Transfer(TransferRequest request)
    {
        try
        {
            await _payments.TransferAsync(request.PayerUserId, request.PayeeUserId, request.Amount);
            return Ok(new { status = "completed" });
        }
        catch (KeyNotFoundException ex)      { return NotFound(new { error = ex.Message }); }   // unknown user
        catch (ArgumentException ex)         { return BadRequest(new { error = ex.Message }); }  // bad amount
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }  // insufficient funds
    }
}
```

**8. `Program.cs`** — the DI registrations:

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Data;
using PaymentApp.Models;
using PaymentApp.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// EF Core against the composed Postgres. (Hardcoded string is deliberate for now —
// Topic 8 moves it into config and overrides it per environment.)
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseNpgsql("Host=localhost;Database=payapp;Username=payapp;Password=devpass"));

// 👇 dependency injection registration: "when asked for IThing, give a Thing."
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPaymentService, PaymentService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();

var app = builder.Build();
app.MapControllers();
app.Run();
```

**Then the schema (cookbook now — Topic 6 opens it up) and run:**

```bash
dotnet tool install --global dotnet-ef    # one-time
dotnet ef migrations add InitialCreate    # read model classes -> write the "Users" table
dotnet ef database update                 # apply it to Postgres
dotnet run                                # note the port — the drills call it PORT
```

Two checkpoints while typing: after each file, glance at the Problems panel — forget `using PaymentApp.Models;` and you get **CS0246: The type or namespace name 'User' could not be found**; fixing these as you go teaches the namespace system faster than reading about it. And read `AddScoped` aloud as *"when anyone asks for `IPaymentService`, hand them a fresh `PaymentService` per request."*

## Exercise 5.1 — Prove it works

There's no balance endpoint (by design — you removed the temptation to leak it), so you verify money by reading Postgres directly. That's a Topic 6 skill you may as well start now.

1. Register Alice and Bob:

```bash
curl -i -X POST http://localhost:PORT/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'

curl -X POST http://localhost:PORT/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@bank.test","password":"Passw0rd!"}'
```

2. Transfer $250 from Alice (user 1) to Bob (user 2), then read both balances from the DB:

```bash
curl -X POST http://localhost:PORT/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":250}'
# {"status":"completed"}

docker compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id","Name","Balance" FROM "Users" ORDER BY "Id";'
#  Id | Name  | Balance
#  ---+-------+--------
#   1 | Alice |  750.00
#   2 | Bob   | 1250.00
```

3. Break it four ways and note the status of each: transfer to user 999; transfer with a negative amount; transfer more than Alice has; transfer with `"amount":"heaps"`. **Which responses came from *your* code, and which from the platform?**
4. `Ctrl+C` the app, start it again, re-read the balances. Where does the state actually live?

**Solution**

1. Registration returns **201** with a `Location` header (from `CreatedAtAction`) and the `UserResponse` JSON — note there's no `passwordHash` field, and the JSON is camelCased even though your C# is PascalCase (the web defaults translate for JS clients). (Topic 9 changes this to return a JWT.)

3. The four failures:

| Payload | Status | Came from |
|---|---|---|
| payee 999 | **404** `{"error":"No user 999."}` | your `catch (KeyNotFoundException)` |
| negative amount | **400** `{"error":"Amount must be positive."}` | your `catch (ArgumentException)` |
| amount > balance | **400** `{"error":"Insufficient funds."}` | your `catch (InvalidOperationException)` |
| `"amount":"heaps"` | **400** problem-details naming `$.amount` | `[ApiController]` + the deserializer — your code never ran |

The last row is the one to internalize: Topic 4's boundary enforcement rejected the payload before routing reached your action. You wrote zero validation code for it.

4. Balances survive the restart because state lives in **Postgres**, not in any C# object — the service instance that handled the transfer was garbage-collected long ago; only rows remain. That's *why* `AddScoped` is right here: a fresh service per request is fine when the service holds no state of its own.

## Exercise 5.2 — Break the lifetimes: the captive dependency

Concepts claimed "a service's lifetime is bounded by its shortest-lived dependency." Prove the container enforces it:

1. Change `AddScoped<IPaymentService, PaymentService>()` to `AddSingleton<...>` and restart. What happens — and *when* (first request, or earlier)?
2. Read the error aloud and explain *why* this combination is dangerous enough to refuse outright.
3. Revert to `AddScoped`. Then, for the interview: one sentence each on a dependency you'd register scoped, transient, and singleton.

**Solution**

1. The app **refuses to start** — no request needed:

```
System.AggregateException: Some services are not able to be constructed
 ---> InvalidOperationException: Cannot consume scoped service
      'PaymentApp.Data.PaymentDbContext' from singleton
      'PaymentApp.Services.IPaymentService'.
```

The container validates the whole dependency graph at startup (in Development) and rejects the lifetime mismatch before it can hurt anyone. The Node equivalent: nothing stops a module-level singleton from capturing a per-request object — you find out in production, via weirdness.

2. A singleton lives forever; a scoped `DbContext` is one request's database session. If the container allowed the capture, the *first* request's DbContext would secretly become the *app-wide* one: its change-tracker accumulating every entity ever touched (a memory leak with a business model), stale reads served forever, and — because `DbContext` isn't thread-safe — concurrent requests corrupting each other through it (Topic 7 gives you the vocabulary). This failure mode is a **captive dependency**, and "the DI container validates the graph at startup" is the .NET-specific fact worth saying in an interview.

3. Typical answers:
   - **Scoped:** the EF Core `DbContext` — one unit-of-work per request.
   - **Transient:** a cheap, stateless helper — a validator or a `FeeCalculator`.
   - **Singleton:** something stateless/thread-safe shared by everyone — your `PasswordHasher`, an `HttpClient`-based API client (Topic 10's `PaymentClient`), a cache, configuration.

**Talking point:** the classic DI bug family is "long-lived thing holding short-lived state." You've now watched the container refuse it at startup — a story most candidates can't tell.

## Exercise 5.3 — The compiler as your to-do list

Both lookups in `TransferAsync` repeat the same "find user or throw" line. Extract it — and feel nominal typing force every implementation to keep up.

1. Add `Task<User> FindUserAsync(int userId)` to `IPaymentService`. Save `PaymentService` *before* implementing it and read the error.
2. Implement it, then use it to DRY the two lookups in `TransferAsync`.

**Solution**

1. The moment you add the method to the interface and save: **CS0535: 'PaymentService' does not implement interface member 'IPaymentService.FindUserAsync(int)'**. That error *is* the point — nominal typing means the contract forces every implementation to catch up before the code compiles again (strict TS flags this too, but here it's the language's whole model, not an opt-in).

2. `Services/PaymentService.cs`:

```csharp
public async Task<User> FindUserAsync(int userId) =>
    await _db.Users.FirstOrDefaultAsync(u => u.Id == userId)
        ?? throw new KeyNotFoundException($"No user {userId}.");

public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    if (amount <= 0) throw new ArgumentException("Amount must be positive.");

    var payer = await FindUserAsync(payerUserId);   // both lookups now one line
    var payee = await FindUserAsync(payeeUserId);

    if (payer.Balance < amount) throw new InvalidOperationException("Insufficient funds.");
    payer.Balance -= amount;
    payee.Balance += amount;
    await _db.SaveChangesAsync();
}
```

Note what you did *not* touch: `Program.cs`. The registration maps the interface to the class once; growing the interface is invisible to the wiring.

## Exercise 5.4 — A second injected dependency

Inject ASP.NET Core's built-in `ILogger<PaymentController>` into the payment controller alongside the service (add a constructor parameter — no registration needed; the platform pre-registers logging). Log a warning whenever a transfer over $10,000 is attempted. Watch it appear in the `dotnet run` console.

What does it tell you that you never registered `ILogger<T>` yourself?

**Solution**

```csharp
public class PaymentController : ControllerBase
{
    private readonly IPaymentService _payments;
    private readonly ILogger<PaymentController> _logger;

    public PaymentController(IPaymentService payments, ILogger<PaymentController> logger)
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

(The `{Payer}` placeholders are **structured logging** — named properties, not string interpolation; log aggregators index them. Use this, not `$"..."`, in log calls. In a payment system this exact line is the seed of an AML alert.)

**What it tells you:** the platform pre-registers dozens of services (logging, config, `HttpClientFactory`, hosting) in the same container your own services go into. "Batteries included" isn't a list of libraries — it's one container everything shares. You added a constructor parameter and the wiring came from the platform.
