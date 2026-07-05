# Topic 6: Data Access & Testing — EF Core and xUnit

## The one question this topic answers

> **How does the standard .NET data layer work, and how does DI make it testable?**

Right now the payment service forgets every user and balance on restart. We swap in **EF Core** (the Prisma/Sequelize of .NET) backed by **PostgreSQL in Docker** — and because the controllers depend on `IPaymentService`, not the implementation, the controllers don't change at all. Then we prove the DI payoff by testing the service against a fake database.

**You arrive with:** Topic 5's `PaymentApp` — register, balance, transfer, deposit, all in-memory singletons. **You leave with:** the same API persisting `Users` and `Accounts` to Postgres, back on the normal `AddScoped` lifetime, with a test project proving the money logic.

## EF Core in one mapping

| Prisma | EF Core |
|---|---|
| `schema.prisma` | your C# model classes *are* the schema (runtime types — Topic 3) |
| `PrismaClient` | `DbContext` |
| `prisma.user` / `prisma.account` | `DbSet<User>` / `DbSet<Account>` |
| `prisma migrate dev` | `dotnet ef migrations add` + `database update` |
| `@unique` | an index in `OnModelCreating` |
| generated client types | none needed — the models are already typed |

## Wire it up

### The database — `docker-compose.yml`

Same move you'd make for local Prisma development: don't install Postgres, *compose* it. Create `docker-compose.yml` inside `PaymentApp/`:

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

Nothing .NET-specific here — it's the identical compose file a Node team would use. Topic 8 grows it a second service (the API itself).

### Packages

```bash
cd PaymentApp
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL
dotnet add package Microsoft.EntityFrameworkCore.Design
```

(Npgsql is the Postgres driver + EF provider — the `pg` of .NET. Swapping databases means swapping this package and one line in `Program.cs`; everything else in this topic is provider-agnostic.)

### The DbContext — `Data/PaymentDbContext.cs`

```csharp
using Microsoft.EntityFrameworkCore;
using PaymentApp.Models;

namespace PaymentApp.Data;

public class PaymentDbContext : DbContext
{
    public PaymentDbContext(DbContextOptions<PaymentDbContext> options) : base(options) { }

    // Each DbSet is a table.
    public DbSet<User> Users => Set<User>();
    public DbSet<Account> Accounts => Set<Account>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Prisma's @unique, spelled as a fluent configuration.
        modelBuilder.Entity<User>().HasIndex(u => u.Email).IsUnique();
    }
}
```

New syntax:

- `: base(options)` — calls the parent constructor: `super(options)`, written in the signature.
- `=> Set<User>()` — an **expression-bodied member**: a read-only property computed by the right-hand expression. `Set<T>()` is Topic 3's reified generics doing real work — the type argument locates the table at runtime.
- `OnModelCreating` — the escape hatch for anything the class shapes can't say on their own (unique indexes, composite keys, relations). The 90% case needs nothing here; the unique email is our one rule.

### The service, rewritten — `Services/PaymentService.cs`

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using PaymentApp.Data;
using PaymentApp.Models;

namespace PaymentApp.Services;

public class PaymentService : IPaymentService
{
    private readonly PaymentDbContext _db;
    private readonly IPasswordHasher<User> _hasher;

    // The DbContext is itself injected via DI — dependencies all the way down.
    public PaymentService(PaymentDbContext db, IPasswordHasher<User> hasher)
    {
        _db = db;
        _hasher = hasher;
    }

    public async Task<User> RegisterAsync(RegisterRequest request)
    {
        var user = new User { Name = request.Name, Email = request.Email };
        user.PasswordHash = _hasher.HashPassword(user, request.Password);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();            // commit -> EF fills user.Id

        _db.Accounts.Add(new Account { UserId = user.Id, Balance = 1000m });
        await _db.SaveChangesAsync();
        return user;
    }

    public async Task<decimal?> GetBalanceAsync(int userId)
    {
        var account = await _db.Accounts.FirstOrDefaultAsync(a => a.UserId == userId);
        return account?.Balance;
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

        // Read-check-modify, now across TWO HTTP requests' worth of time
        // (SELECT ... then UPDATE). Still racy — Topic 7 makes it lose money
        // on purpose, then fixes it.
        payer.Balance -= amount;
        payee.Balance += amount;
        await _db.SaveChangesAsync();            // one commit for both rows
    }

    public async Task<decimal> DepositAsync(int userId, decimal amount)
    {
        if (amount <= 0) throw new ArgumentException("Amount must be positive.");
        var account = await _db.Accounts.FirstOrDefaultAsync(a => a.UserId == userId)
            ?? throw new KeyNotFoundException($"No account for user {userId}.");
        account.Balance += amount;
        await _db.SaveChangesAsync();
        return account.Balance;
    }
}
```

Note the controllers didn't change a character — the interface held. And note EF's change tracking: you mutate `payer.Balance` like a plain object, and `SaveChangesAsync` figures out the `UPDATE` statements. Prisma makes you say `update({ where, data })`; EF watches what you touched.

### Registration — `Program.cs`

```csharp
// Register EF Core against the composed Postgres
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseNpgsql("Host=localhost;Database=payapp;Username=payapp;Password=devpass"));

// Back to Scoped (the normal choice): the database owns the data now,
// and DbContext is itself scoped per request.
builder.Services.AddScoped<IPaymentService, PaymentService>();
```

The Topic 5 lifetime story resolves: the in-memory singleton becomes the standard scoped service, because state now lives in the database and `DbContext` is scoped (one unit-of-work per request).

(Hardcoding the connection string is deliberate for now — Topic 8 moves it into config and overrides it per environment. One concept at a time.)

### Migrations

Make sure the database is up (`docker compose up -d`), then:

```bash
dotnet tool install --global dotnet-ef    # one-time
dotnet ef migrations add InitialCreate    # generate from your models
dotnet ef database update                 # apply -> creates Users + Accounts in Postgres
```

A migration is a versioned schema change, like `prisma migrate` — except the source of truth is your C# classes, read by reflection. Look inside `Migrations/`: the generated code is C#, readable, and checked into git.

**LINQ-to-SQL:** `_db.Accounts.Where(a => a.Balance > 10_000)` doesn't filter in memory — EF translates the *expression* into `WHERE "Balance" > 10000` and runs it in the database. Same LINQ surface as Topic 2's lists, radically different execution.

## Testing — where DI pays out

```bash
cd ..    # workspace root
dotnet new xunit -n PaymentApp.Tests
cd PaymentApp.Tests
dotnet add reference ../PaymentApp/PaymentApp.csproj
dotnet add package Microsoft.EntityFrameworkCore.InMemory
```

Delete the sample `UnitTest1.cs`, create `PaymentServiceTests.cs`:

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Data;
using PaymentApp.Models;
using PaymentApp.Services;
using Xunit;

namespace PaymentApp.Tests;

public class PaymentServiceTests
{
    // Helper: a fresh in-memory DB per test (isolated).
    private static PaymentDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<PaymentDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new PaymentDbContext(options);
    }

    private static PaymentService NewService(PaymentDbContext db)
        => new(db, new PasswordHasher<User>());   // inject the fakes BY HAND

    [Fact]  // = test(...) in jest
    public async Task RegisterAsync_CreatesAccount_WithStartingBalance()
    {
        var service = NewService(NewDb());

        var user = await service.RegisterAsync(
            new RegisterRequest("Alice", "alice@bank.test", "Passw0rd!"));

        Assert.True(user.Id > 0);
        Assert.Equal(1000m, await service.GetBalanceAsync(user.Id));
        Assert.NotEqual("Passw0rd!", user.PasswordHash);   // hashed, never plaintext
    }

    [Fact]
    public async Task TransferAsync_MovesMoney_Exactly()
    {
        var db = NewDb();
        var service = NewService(db);
        var alice = await service.RegisterAsync(new RegisterRequest("Alice", "a@t.t", "x"));
        var bob   = await service.RegisterAsync(new RegisterRequest("Bob",   "b@t.t", "x"));

        await service.TransferAsync(alice.Id, bob.Id, 250m);

        Assert.Equal(750m,  await service.GetBalanceAsync(alice.Id));
        Assert.Equal(1250m, await service.GetBalanceAsync(bob.Id));
    }

    [Fact]
    public async Task TransferAsync_Throws_WhenInsufficientFunds()
    {
        var service = NewService(NewDb());
        var alice = await service.RegisterAsync(new RegisterRequest("Alice", "a@t.t", "x"));
        var bob   = await service.RegisterAsync(new RegisterRequest("Bob",   "b@t.t", "x"));

        // = expect(...).rejects.toThrow(), but asserting the exception TYPE
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.TransferAsync(alice.Id, bob.Id, 5000m));

        Assert.Equal(1000m, await service.GetBalanceAsync(alice.Id));   // nothing moved
    }
}
```

```bash
dotnet test
```

xUnit mapped to jest: no `describe`/`it` nesting — the **class is the suite**, each `[Fact]` method is a test, the method name is the test name (hence the long descriptive names). Parameterised tests use `[Theory]` + `[InlineData(...)]` (jest's `test.each`). `Assert.ThrowsAsync<T>` is `expect().rejects.toThrow()`, except it asserts the exception *type* — Topic 4's typed failures making tests sharper.

Note what the in-memory provider buys you: `dotnet test` passes with Postgres **down** — unit tests have no Docker dependency. (The trade-off: it's not real SQL, so it won't catch provider-specific issues or — important for Topic 7 — real locking behaviour; integration tests against real Postgres exist for that, one rung up the ladder.)

The punchline: `PaymentService` never knew whether it got real Postgres or a fake. Constructor injection made the tests a few lines of arrangement — no module mocking, no `jest.mock('./db')` hoisting rituals.

## Interview talking points

- `DbContext` = unit of work, `DbSet<T>` = table, `SaveChangesAsync` = commit; models are the schema because types exist at runtime.
- EF *tracks changes*: mutate the entity, `SaveChangesAsync` writes the UPDATEs — vs Prisma's explicit `update({ data })`.
- LINQ queries against EF are translated to SQL from expression trees — filtering happens in the database, not memory.
- Migrations are generated, versioned C# — reviewable in PRs like Prisma migration files.
- Testing story: inject an in-memory `DbContext`; DI means no mocking framework needed for this level.
