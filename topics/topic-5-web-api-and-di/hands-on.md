# Topic 5: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → **Web API + EF Core** → EF Core deep dive → Transfer endpoint → Document upload → Authentication → Production

This is where PaymentApp becomes a real API. We'll add services to the Application layer, EF Core to Infrastructure, and controllers to the Api layer — all wired together with dependency injection and connected to PostgreSQL.

**Prerequisites:** Complete Topic 4 hands-on (you should have domain models and exceptions).

**Time:** ~90 minutes

---

## Exercise 5.1 — Start PostgreSQL

We need a database. docker-compose makes this identical to what you'd do in Node.

**Task:** Create a docker-compose file and start PostgreSQL.

**Solution**

Create `docker-compose.yml` in the `PaymentApp` root (next to the `.sln` file):

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
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Start it:

```bash
docker-compose up -d
```

Verify it's running:

```bash
docker-compose exec db psql -U payapp -c "SELECT 1;"
```

---

## Exercise 5.2 — Add EF Core packages

**Task:** Add EF Core packages to the Infrastructure project.

**Solution**

```bash
dotnet add src/PaymentApp.Infrastructure/PaymentApp.Infrastructure.csproj \
  package Npgsql.EntityFrameworkCore.PostgreSQL

dotnet add src/PaymentApp.Infrastructure/PaymentApp.Infrastructure.csproj \
  package Microsoft.EntityFrameworkCore.Design
```

Also add the password hasher to Infrastructure:

```bash
dotnet add src/PaymentApp.Infrastructure/PaymentApp.Infrastructure.csproj \
  package Microsoft.Extensions.Identity.Core
```

---

## Exercise 5.3 — Create the DbContext

The `DbContext` is EF Core's unit of work — it tracks changes and commits them to the database.

**Task:** Create `PaymentDbContext` in Infrastructure.

**Solution**

Create `src/PaymentApp.Infrastructure/Data/PaymentDbContext.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PaymentApp.Domain.Entities;

namespace PaymentApp.Infrastructure.Data;

public class PaymentDbContext : DbContext
{
    public PaymentDbContext(DbContextOptions<PaymentDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Configure User entity
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Email).IsUnique();
            entity.Property(e => e.Balance).HasPrecision(18, 2);
            entity.Property(e => e.Email).HasMaxLength(255);
            entity.Property(e => e.Name).HasMaxLength(100);

            // Ignore domain events collection (not stored in DB)
            entity.Ignore(e => e.DomainEvents);
        });
    }
}
```

**Understanding the syntax:**

| Part | Purpose |
|------|---------|
| `DbSet<User> Users` | Maps to the "Users" table |
| `HasKey(e => e.Id)` | Primary key |
| `HasIndex(e => e.Email).IsUnique()` | Unique constraint |
| `HasPrecision(18, 2)` | Decimal precision for money |
| `Ignore(e => e.DomainEvents)` | Don't try to persist this |

**How EF Core discovers what to map:**

EF Core uses **reflection** to find properties (members with getters/setters). Methods are behavior, not data, so they're never considered for column mapping in the first place.

| Member Type | EF Core Behavior |
|-------------|------------------|
| Properties (`public string Name { get; set; }`) | Mapped to columns by default |
| Fields (`private string _name;`) | Not mapped unless explicitly configured |
| Methods (`public void Debit(decimal amount)`) | Never considered — not data |
| Computed properties (no setter, or `[NotMapped]`) | Needs explicit ignore |

**What is reflection?** The ability to inspect types at runtime — examining what properties, methods, and attributes a class has while the program is running. In TypeScript, types are erased at runtime (you can't ask "what properties does this class have?"). In C#, types exist at runtime (reified generics), so EF Core can literally query `typeof(User).GetProperties()` to discover your entity's shape. This is Topic 3's runtime types in action.

---

## Exercise 5.4 — Create DTOs in Application layer

DTOs (Data Transfer Objects) are records that carry data across boundaries. They're separate from domain entities.

**Task:** Create request/response DTOs.

**Solution**

Create `src/PaymentApp.Application/DTOs/AuthDtos.cs`:

```bash
mkdir -p src/PaymentApp.Application/DTOs
```

```csharp
namespace PaymentApp.Application.DTOs;

public record RegisterRequest(string Name, string Email, string Password);

public record UserResponse(int Id, string Name, string Email);
```

**Don't let the parentheses fool you:** `record RegisterRequest(string Name, ...)` looks like a function signature, but those "parameters" become properties. It's shorthand for a class with `{ get; init; }` properties. On the wire, it's a JSON object:

```json
{ "name": "Alice", "email": "alice@bank.test", "password": "Passw0rd!" }
```

Not an array of arguments. The parentheses `()` is just C# being terse.

Create `src/PaymentApp.Application/DTOs/PaymentDtos.cs`:

```csharp
namespace PaymentApp.Application.DTOs;

public record TransferRequest(int PayerUserId, int PayeeUserId, decimal Amount);

public record TransferResponse(string Status, decimal PayerBalance, decimal PayeeBalance);
```

**Why DTOs separate from entities?**

| Aspect | Entity | DTO |
|--------|--------|-----|
| Purpose | Domain logic | Wire format |
| Contains | Business rules, behavior | Just data |
| PasswordHash | Yes (hashed) | Never exposed |
| Naming | PascalCase | Becomes camelCase on wire |

---

## Exercise 5.5 — Create service interfaces

Interfaces define contracts. Services implement them. Controllers depend on the interfaces, not implementations.

**Task:** Create service interfaces in Application layer.

**Solution**

Create `src/PaymentApp.Application/Interfaces/IAuthService.cs`:

```csharp
using PaymentApp.Application.DTOs;
using PaymentApp.Domain.Entities;

namespace PaymentApp.Application.Interfaces;

public interface IAuthService
{
    Task<User> RegisterAsync(RegisterRequest request);
}
```

Create `src/PaymentApp.Application/Interfaces/IPaymentService.cs`:

```csharp
namespace PaymentApp.Application.Interfaces;

public interface IPaymentService
{
    Task TransferAsync(int payerUserId, int payeeUserId, decimal amount);
}
```

---

## Exercise 5.6 — Implement services in Infrastructure

Services implement the interfaces and contain the actual logic.

**Task:** Create `AuthService` and `PaymentService`.

**Solution**

Create `src/PaymentApp.Infrastructure/Services/AuthService.cs`:

```bash
mkdir -p src/PaymentApp.Infrastructure/Services
```

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Constants;
using PaymentApp.Domain.Entities;
using PaymentApp.Domain.Exceptions;
using PaymentApp.Infrastructure.Data;

namespace PaymentApp.Infrastructure.Services;

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
        // Check for duplicate email
        var exists = await _db.Users.AnyAsync(u => u.Email == request.Email);
        if (exists)
            throw new DuplicateEmailException(request.Email);

        var user = new User
        {
            Name = request.Name,
            Email = request.Email,
            CreatedAt = DateTime.UtcNow
        };

        // Hash password (salted, secure)
        user.PasswordHash = _hasher.HashPassword(user, request.Password);

        // Set initial balance
        user.SetInitialBalance(PaymentDefaults.InitialBalance);

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return user;
    }
}
```

Create `src/PaymentApp.Infrastructure/Services/PaymentService.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Exceptions;
using PaymentApp.Infrastructure.Data;

namespace PaymentApp.Infrastructure.Services;

public class PaymentService : IPaymentService
{
    private readonly PaymentDbContext _db;

    public PaymentService(PaymentDbContext db)
    {
        _db = db;
    }

    public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
    {
        if (amount <= 0)
            throw InvalidTransferException.NegativeAmount(amount);

        if (payerUserId == payeeUserId)
            throw InvalidTransferException.SameUser();

        var payer = await _db.Users.FirstOrDefaultAsync(u => u.Id == payerUserId)
            ?? throw new UserNotFoundException(payerUserId);

        var payee = await _db.Users.FirstOrDefaultAsync(u => u.Id == payeeUserId)
            ?? throw new UserNotFoundException(payeeUserId);

        // Domain logic handles validation and events
        payer.Withdraw(amount);
        payee.Deposit(amount);

        // One commit, both changes
        await _db.SaveChangesAsync();
    }
}
```

**Key points:**
- Services use our domain exceptions (not generic ones)
- `Withdraw()` and `Deposit()` are domain methods that enforce business rules
- `SaveChangesAsync()` commits both changes in one transaction

---

## Exercise 5.7 — Create controllers

Controllers are thin HTTP shells. They delegate to services.

**Task:** Create `AuthController` and `PaymentController`.

**Solution**

Update `src/PaymentApp.Api/Controllers/` — first remove any placeholder:

```bash
rm -f src/PaymentApp.Api/Controllers/.gitkeep
```

Create `src/PaymentApp.Api/Controllers/AuthController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Interfaces;

namespace PaymentApp.Api.Controllers;

[ApiController]
[Route("v1/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _auth;

    public AuthController(IAuthService auth)
    {
        _auth = auth;
    }

    [HttpPost("register")]
    public async Task<ActionResult<UserResponse>> Register(RegisterRequest request)
    {
        var user = await _auth.RegisterAsync(request);
        var response = new UserResponse(user.Id, user.Name, user.Email);
        return CreatedAtAction(nameof(Register), new { id = user.Id }, response);
    }
}
```

Create `src/PaymentApp.Api/Controllers/PaymentController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Exceptions;

namespace PaymentApp.Api.Controllers;

[ApiController]
[Route("v1/payment")]
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
    public async Task<ActionResult<TransferResponse>> Transfer(TransferRequest request)
    {
        if (request.Amount > 10_000)
        {
            _logger.LogWarning(
                "Large transfer: user {Payer} -> user {Payee}, amount {Amount}",
                request.PayerUserId, request.PayeeUserId, request.Amount);
        }

        try
        {
            await _payments.TransferAsync(
                request.PayerUserId,
                request.PayeeUserId,
                request.Amount);

            return Ok(new TransferResponse("completed", 0, 0));
        }
        catch (UserNotFoundException ex)
        {
            return NotFound(new { code = ex.Code, message = ex.Message });
        }
        catch (InsufficientBalanceException ex)
        {
            return BadRequest(new { code = ex.Code, message = ex.Message });
        }
        catch (InvalidTransferException ex)
        {
            return BadRequest(new { code = ex.Code, message = ex.Message });
        }
    }
}
```

**Understanding controller patterns:**

| Pattern | Example |
|---------|---------|
| Constructor injection | `AuthController(IAuthService auth)` |
| Attribute routing | `[Route("v1/auth")]` |
| Action methods | `[HttpPost("register")]` |
| Typed exceptions | Catch by type, return appropriate HTTP status |
| Structured logging | `_logger.LogWarning("...", args)` — not string interpolation |

---

## Exercise 5.8 — Wire up Program.cs

`Program.cs` is where all the DI registration happens.

**Task:** Update Program.cs to wire everything together.

**Solution**

Replace `src/PaymentApp.Api/Program.cs`:

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Entities;
using PaymentApp.Infrastructure.Data;
using PaymentApp.Infrastructure.Services;

var builder = WebApplication.CreateBuilder(args);

// Add controllers
builder.Services.AddControllers();

// Add OpenAPI (Swagger)
builder.Services.AddOpenApi();

// Add EF Core with PostgreSQL
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseNpgsql("Host=localhost;Database=payapp;Username=payapp;Password=devpass"));

// Register services (Scoped = one instance per HTTP request)
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPaymentService, PaymentService>();

// Register password hasher (Singleton = one instance for app lifetime)
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
```

**Understanding DI lifetimes:**

| Lifetime | Method | Use For |
|----------|--------|---------|
| Scoped | `AddScoped` | Per-request services (DbContext, business services) |
| Transient | `AddTransient` | Lightweight, stateless helpers |
| Singleton | `AddSingleton` | Thread-safe, stateless utilities |

---

## Exercise 5.9 — Create and run migrations

EF Core migrations translate your C# models into database schema changes.

**Task:** Create the initial migration and apply it.

**Solution**

Install the EF Core CLI tools (one-time):

```bash
dotnet tool install --global dotnet-ef
```

Create the migration (run from solution root):

```bash
dotnet ef migrations add InitialCreate \
  --project src/PaymentApp.Infrastructure \
  --startup-project src/PaymentApp.Api
```

Apply it to the database:

```bash
dotnet ef database update \
  --project src/PaymentApp.Infrastructure \
  --startup-project src/PaymentApp.Api
```

Verify the table was created:

```bash
docker-compose exec db psql -U payapp -c '\d "Users"'
```

You should see the Users table with all columns.

---

## Exercise 5.10 — Test the API

**Task:** Register users and test transfers.

**Solution**

Run the API:

```bash
dotnet run --project src/PaymentApp.Api
```

Note the port (usually 5000 or 5001). In another terminal:

```bash
# Register Alice
curl -i -X POST http://localhost:5000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'

# Register Bob
curl -X POST http://localhost:5000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@bank.test","password":"Passw0rd!"}'

# Transfer $250 from Alice (1) to Bob (2)
curl -X POST http://localhost:5000/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":250}'

# Check balances directly in database
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "Balance" FROM "Users" ORDER BY "Id";'
```

Expected output:

```
 Id | Name  | Balance
----+-------+---------
  1 | Alice |  750.00
  2 | Bob   | 1250.00
```

---

## Exercise 5.11 — Test error cases

**Task:** Verify our domain exceptions work correctly.

**Solution**

```bash
# Transfer to non-existent user -> 404
curl -X POST http://localhost:5000/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":999,"amount":100}'
# {"code":"USER_NOT_FOUND","message":"User with ID 999 was not found"}

# Negative amount -> 400
curl -X POST http://localhost:5000/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":-100}'
# {"code":"INVALID_TRANSFER","message":"Transfer amount must be positive..."}

# Overdraw -> 400
curl -X POST http://localhost:5000/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":10000}'
# {"code":"INSUFFICIENT_BALANCE","message":"Cannot withdraw..."}

# Duplicate email -> handled by unique constraint
curl -X POST http://localhost:5000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice2","email":"alice@bank.test","password":"Passw0rd!"}'
# {"code":"DUPLICATE_EMAIL","message":"A user with email 'alice@bank.test' already exists"}

# Invalid JSON -> 400 from framework (not our code)
curl -X POST http://localhost:5000/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"amount":"heaps"}'
# Returns ProblemDetails with validation errors
```

---

## What we built

| Layer | Files Added |
|-------|-------------|
| **Infrastructure** | `Data/PaymentDbContext.cs`, `Services/AuthService.cs`, `Services/PaymentService.cs` |
| **Application** | `DTOs/AuthDtos.cs`, `DTOs/PaymentDtos.cs`, `Interfaces/IAuthService.cs`, `Interfaces/IPaymentService.cs` |
| **Api** | `Controllers/AuthController.cs`, `Controllers/PaymentController.cs`, `Program.cs` (updated) |

**Full project structure:**

```
PaymentApp/
├── docker-compose.yml
├── PaymentApp.sln
└── src/
    ├── PaymentApp.Domain/
    │   ├── Common/
    │   ├── Constants/
    │   ├── Entities/
    │   ├── Events/
    │   ├── Exceptions/
    │   ├── Utilities/
    │   └── ValueObjects/
    ├── PaymentApp.Application/
    │   ├── DTOs/
    │   │   ├── AuthDtos.cs
    │   │   └── PaymentDtos.cs
    │   └── Interfaces/
    │       ├── IAuthService.cs
    │       └── IPaymentService.cs
    ├── PaymentApp.Infrastructure/
    │   ├── Data/
    │   │   └── PaymentDbContext.cs
    │   ├── Migrations/
    │   │   └── (generated)
    │   └── Services/
    │       ├── AuthService.cs
    │       └── PaymentService.cs
    └── PaymentApp.Api/
        ├── Controllers/
        │   ├── AuthController.cs
        │   └── PaymentController.cs
        └── Program.cs
```

---

## Key concepts

| Concept | What it means |
|---------|---------------|
| **DI Container** | Manages object creation and lifetimes |
| **Scoped** | One instance per HTTP request |
| **Singleton** | One instance for app lifetime |
| **DbContext** | Unit of work + change tracker |
| **Migration** | C# code that changes DB schema |
| **Controller** | Thin HTTP shell, delegates to services |
| **Interface** | Contract that allows swapping implementations |

---

## Recap

- "The DI container validates the dependency graph at startup. A singleton can't depend on a scoped service — the container refuses to start."
- "DbContext is scoped because each request needs its own unit of work. A singleton DbContext would share state across requests and isn't thread-safe."
- "Controllers depend on interfaces, not implementations. That's what makes services testable — you can inject fakes."
- "Domain exceptions carry business context. The controller catches by type and maps to HTTP status codes."
- "EF Core reads my model classes at runtime (reflection) to build the schema. No schema file needed."

---

## Next: Topic 6

In Topic 6, we dive deep into EF Core: change tracking, how LINQ becomes SQL, and transactions.
