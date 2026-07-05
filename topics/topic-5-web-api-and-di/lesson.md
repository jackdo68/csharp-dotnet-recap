# Topic 5: Web API & Dependency Injection — batteries included

## The one question this topic answers

> **How does a real .NET service hang together — and why is dependency injection the organizing principle instead of an optional pattern?**

## The philosophy split

Node's philosophy: a minimal core, then *you assemble* the stack — Express, an ORM, validation, a test runner — and wire the pieces together yourself. .NET's philosophy: one platform **ships** the web framework (ASP.NET Core), the ORM (EF Core), config, logging, and — crucially — a built-in **dependency injection container** as the single organizing principle. You never `new` up a dependency: a class declares what it needs in its constructor, and the wiring is registered once at startup.

The other half is **convention over configuration**: controller classes auto-route from attributes, `IThing`/`Thing` pairs, the `Async` suffix, namespaces mirroring folders. More upfront structure than Node — but every unfamiliar .NET codebase looks broadly alike, which is exactly what you want when joining one.

## What we're building (Topics 5–10)

A small **payment service** — the app the rest of the course grows one topic at a time:

| Endpoint | Access | Arrives in |
|---|---|---|
| `POST /v1/register` — name, email, password → new user + account | public | **Topic 5** |
| `GET /v1/account/{userId}/balance` | public *for now* | **Topic 5** |
| `POST /v1/payments/transfer` — payer, payee, amount | public *for now* | **Topic 5** |
| `POST /v1/login` — email + password → JWT | public | Topic 9 |
| the two money endpoints locked behind tokens | private | Topic 9 |

Two tables of domain: a **User** (name, email, hashed password) and their **Account** (balance) — and they live in **PostgreSQL from day one**. No throwaway in-memory layer: you write the service once, against the real database, and Topic 6 unpacks how the data layer actually works. (Two commands in this topic — the migrations — get a cookbook treatment now and full understanding next topic. That's the deliberate trade for never writing the same service twice.)

Topic 7 exposes the race condition hiding in today's transfer, Topic 8 ships everything in Docker, Topic 9 locks it down, Topic 10 rebuilds the plumbing production-style.

## Build it: the Payment API

**The database precedes the API** — same as starting a Prisma project. Scaffold, then compose Postgres:

```bash
dotnet new webapi --use-controllers -n PaymentApp
cd PaymentApp
rm Controllers/WeatherForecastController.cs WeatherForecast.cs 2>/dev/null

dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL   # Postgres driver + EF provider (the `pg` of .NET)
dotnet add package Microsoft.EntityFrameworkCore.Design    # tooling for migrations
dotnet add package Microsoft.Extensions.Identity.Core      # just the password hasher
```

(`--use-controllers` gives the classic controller style — what banks use and interviewers expect — rather than minimal APIs, which are Express-style route lambdas.)

`docker-compose.yml` in the project folder — the identical file a Node team would write:

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
docker compose up -d     # start it in the background; `docker compose down` stops it
```

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

These classes are about to *be* the database schema — no separate `schema.prisma`. Topic 3's runtime types are why that works; Topic 6 shows the machinery.

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

### The DbContext — `Data/PaymentDbContext.cs`

The database session object — Prisma's `PrismaClient`, roughly. Minimal for now; Topic 6 unpacks every line:

```csharp
using Microsoft.EntityFrameworkCore;
using PaymentApp.Models;

namespace PaymentApp.Data;

public class PaymentDbContext : DbContext
{
    public PaymentDbContext(DbContextOptions<PaymentDbContext> options) : base(options) { }

    // Each DbSet is a table: Users -> "Users", Accounts -> "Accounts".
    public DbSet<User> Users => Set<User>();
    public DbSet<Account> Accounts => Set<Account>();
}
```

(`: base(options)` is `super(options)` written in the signature; `=> Set<User>()` is an expression-bodied property — Topic 2's arrow, again.)

### The contract — `Services/IPaymentService.cs`

```csharp
using PaymentApp.Models;

namespace PaymentApp.Services;

// The contract. Controllers depend on THIS, not the concrete class.
// Payoff: tests hand the service a fake database (Topic 6), and callers
// never know or care what's behind it.
public interface IPaymentService
{
    Task<User> RegisterAsync(RegisterRequest request);
    Task<decimal?> GetBalanceAsync(int userId);
    Task TransferAsync(int payerUserId, int payeeUserId, decimal amount);
}
```

### The service — `Services/PaymentService.cs` (written once, against the real database)

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Data;
using PaymentApp.Models;

namespace PaymentApp.Services;

public class PaymentService : IPaymentService
{
    private readonly PaymentDbContext _db;
    private readonly IPasswordHasher<User> _hasher;

    // BOTH dependencies injected — the DbContext and the hasher.
    // Dependencies all the way down; nobody news anything up.
    public PaymentService(PaymentDbContext db, IPasswordHasher<User> hasher)
    {
        _db = db;
        _hasher = hasher;
    }

    public async Task<User> RegisterAsync(RegisterRequest request)
    {
        var user = new User { Name = request.Name, Email = request.Email };
        user.PasswordHash = _hasher.HashPassword(user, request.Password);  // salted, framework crypto
        _db.Users.Add(user);                 // stage the insert
        await _db.SaveChangesAsync();        // commit -> EF fills user.Id

        // Every new user gets an account with a $1,000 starting balance
        // (so transfers are testable — think "demo bank").
        _db.Accounts.Add(new Account { UserId = user.Id, Balance = 1000m });
        await _db.SaveChangesAsync();
        return user;
    }

    public async Task<decimal?> GetBalanceAsync(int userId)
    {
        var account = await _db.Accounts.FirstOrDefaultAsync(a => a.UserId == userId);  // LINQ .find(), as SQL
        return account?.Balance;             // null if no such user
    }

    public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
    {
        if (amount <= 0)
            throw new ArgumentException("Amount must be positive.");

        var payer = await _db.Accounts.FirstOrDefaultAsync(a => a.UserId == payerUserId)
            ?? throw new KeyNotFoundException($"No account for user {payerUserId}.");
        var payee = await _db.Accounts.FirstOrDefaultAsync(a => a.UserId == payeeUserId)
            ?? throw new KeyNotFoundException($"No account for user {payeeUserId}.");

        if (payer.Balance < amount)
            throw new InvalidOperationException("Insufficient funds.");

        // Read-check-modify on shared money. Looks innocent.
        // Topic 7 demonstrates exactly how this loses money under load.
        payer.Balance -= amount;
        payee.Balance += amount;
        await _db.SaveChangesAsync();        // one commit for both rows
    }
}
```

Two things to notice. The typed exceptions are Topic 4's philosophy in service code — the *service* states what went wrong; the *controller* decides what that means in HTTP. And you mutate `payer.Balance` like a plain object, then `SaveChangesAsync` writes the `UPDATE`s — EF *watches what you touched* (change tracking, unpacked in Topic 6), where Prisma makes you spell out `update({ where, data })`.

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

The catch blocks route by exception *type* — Topic 4's exercise 4.4, now earning rent in a real API. (Topic 10 promotes this mapping into a single piece of middleware; for now, per-controller is honest.)

Unpacking the new syntax across the three controllers:

- `[ApiController]`, `[Route(...)]`, `[HttpGet]` — **attributes**: C#'s decorators. If you've seen NestJS, they're exactly `@Controller()` / `@Get(':id')`, written in square brackets above the target.
- `: ControllerBase` — the colon is `extends` and `implements` in one (base class first, then interfaces).
- `ActionResult<T>` — "either a `T` or any HTTP result like `NotFound()`": how a nominal language expresses TS's union return.
- `=> _payments = payments;` — an expression-bodied constructor: same one-liner arrow you met on properties.
- `new { status = "completed" }` — an **anonymous type**: the one place C# allows an ad-hoc object literal.

### Wire it up — `Program.cs`

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Data;
using PaymentApp.Models;
using PaymentApp.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// EF Core against the composed Postgres. (Hardcoded string is deliberate
// for now — Topic 8 moves it into config and overrides it per environment.)
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseNpgsql("Host=localhost;Database=payapp;Username=payapp;Password=devpass"));

// 👇 THIS is dependency injection registration.
// "When something asks for IPaymentService, give it a PaymentService."
builder.Services.AddScoped<IPaymentService, PaymentService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();

var app = builder.Build();

app.MapControllers();

app.Run();
```

### Create the schema — two commands (cookbook for now)

```bash
dotnet tool install --global dotnet-ef    # one-time
dotnet ef migrations add InitialCreate    # generate schema-from-classes
dotnet ef database update                 # apply -> creates Users + Accounts in Postgres
```

Treat these as a recipe today: "read my model classes, write the tables." A `Migrations/` folder appeared in your project — **Topic 6 opens it up** and makes migrations mechanical rather than magical. Then:

```bash
dotnet run    # note the port — the exercises call it PORT
```

## DI lifetimes (you will get asked this)

- **`AddScoped`** — one instance per HTTP request (the usual default).
- **`AddTransient`** — a new instance every time it's asked for.
- **`AddSingleton`** — one instance for the whole app lifetime.

Read our three registrations through that lens, because each chose deliberately:

| Registration | Lifetime | Why |
|---|---|---|
| `PaymentDbContext` (via `AddDbContext`) | **scoped** | one database session = one unit of work per request; sharing it app-wide would leak state between requests |
| `IPaymentService` | **scoped** | it holds a scoped `DbContext`, so it must not outlive one — a service's lifetime is bounded by its *shortest-lived* dependency |
| `IPasswordHasher<User>` | **singleton** | stateless and thread-safe — one instance can serve everyone forever |

That second row is a real rule with real teeth: a longer-lived service holding a shorter-lived dependency is called a **captive dependency**, and the container refuses to build one — the exercises make you trigger that refusal on purpose and read the error.

## Trace one request (so the magic is mechanical)

1. `POST /v1/payments/transfer` arrives; ASP.NET Core matches it to `PaymentsController.Transfer`.
2. To build the controller, the DI container sees the constructor needs `IPaymentService`; building *that* needs a `PaymentDbContext` and the hasher — the container resolves the whole graph, reading constructor parameter *types at runtime* (Topic 3's runtime types making Topic 5's DI possible).
3. The JSON body is auto-deserialized into `TransferRequest` — Topic 4's boundary enforcement; `{"amount":"heaps"}` becomes an automatic 400 before your code runs.
4. `await _db...` frees the thread during the real SQL round-trip (Topic 7 explains where it goes).
5. The returned object is auto-serialized to JSON (camelCased for JS clients).

In Express you'd wire middleware and instantiate everything yourself. Here the wiring comes from registrations — more upfront structure, far less glue code.

## Interview talking points

- Constructor injection + the three lifetimes (`Scoped` vs `Transient` vs `Singleton`) — the most likely C#-specific question. Know the failure story: a **captive dependency** (singleton holding a scoped `DbContext`) — and that the container catches it at startup.
- *Why* DI: loose coupling and testability — hand the service a fake database in tests (Topic 6 does exactly that), no module-mocking rituals.
- Controllers depend on interfaces, never concrete classes; the container binds by declared relationships (Topic 2's nominal typing).
- Attributes ≈ decorators; `[ApiController]` gives automatic model validation → 400s.
- Return DTOs, not entities — "so the password hash can't leak into JSON" is a senior-sounding sentence because it's a junior-shaped bug.
