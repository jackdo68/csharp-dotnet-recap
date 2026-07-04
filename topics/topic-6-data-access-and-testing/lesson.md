# Topic 6: Data Access & Testing — EF Core and xUnit

## The one question this topic answers

> **How does the standard .NET data layer work, and how does DI make it testable?**

Right now the Loan API's data vanishes on restart. We swap in **EF Core** (the Prisma/Sequelize of .NET) with SQLite — and because the controller depends on `ILoanService`, not the implementation, the controller doesn't change at all. Then we prove the DI payoff by testing the service against a fake database.

## EF Core in one mapping

| Prisma | EF Core |
|---|---|
| `schema.prisma` | your C# model classes *are* the schema (runtime types — Topic 3) |
| `PrismaClient` | `DbContext` |
| `prisma.loanApplication` | `DbSet<LoanApplication>` |
| `prisma migrate dev` | `dotnet ef migrations add` + `database update` |
| generated client types | none needed — the models are already typed |

## Wire it up

### Packages

```bash
cd LoanApp
dotnet add package Microsoft.EntityFrameworkCore.Sqlite
dotnet add package Microsoft.EntityFrameworkCore.Design
```

### The DbContext — `Data/LoanDbContext.cs`

```csharp
using LoanApp.Models;
using Microsoft.EntityFrameworkCore;

namespace LoanApp.Data;

public class LoanDbContext : DbContext
{
    public LoanDbContext(DbContextOptions<LoanDbContext> options) : base(options) { }

    // Each DbSet is a table. This one maps LoanApplication -> "LoanApplications".
    public DbSet<LoanApplication> LoanApplications => Set<LoanApplication>();
}
```

Two new bits of syntax:

- `: base(options)` — calls the parent constructor: `super(options)`, written in the signature.
- `=> Set<LoanApplication>()` — an **expression-bodied member**: a read-only property computed by the right-hand expression (a TS `get` accessor in one line). Same arrow as a lambda; position tells you which is which. And `Set<T>()` is Topic 3's reified generics doing real work — the type argument locates the table at runtime.

### The service, rewritten — `Services/LoanService.cs`

```csharp
using LoanApp.Data;
using LoanApp.Models;
using Microsoft.EntityFrameworkCore;

namespace LoanApp.Services;

public class LoanService : ILoanService
{
    private readonly LoanDbContext _db;

    // The DbContext is itself injected via DI — dependencies all the way down.
    public LoanService(LoanDbContext db)
    {
        _db = db;
    }

    public async Task<List<LoanApplication>> GetAllAsync()
    {
        return await _db.LoanApplications.ToListAsync();   // real async SQL
    }

    public async Task<LoanApplication?> GetByIdAsync(int id)
    {
        return await _db.LoanApplications.FindAsync(id);
    }

    public async Task<LoanApplication> CreateAsync(CreateLoanRequest request)
    {
        var loan = new LoanApplication
        {
            ApplicantName = request.ApplicantName,
            Amount = request.Amount,
            Status = "Pending"
        };
        _db.LoanApplications.Add(loan);   // stage the insert
        await _db.SaveChangesAsync();     // commit -> EF fills loan.Id
        return loan;
    }
}
```

### Registration — `Program.cs`

```csharp
using LoanApp.Data;
using LoanApp.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// Register EF Core with a SQLite file called loans.db
builder.Services.AddDbContext<LoanDbContext>(options =>
    options.UseSqlite("Data Source=loans.db"));

// Back to Scoped (the normal choice): the database owns the data now,
// and DbContext is itself scoped per request.
builder.Services.AddScoped<ILoanService, LoanService>();

var app = builder.Build();

app.MapControllers();

app.Run();
```

The Topic 5 lifetime story resolves: the in-memory singleton becomes the standard scoped service, because state now lives in the database and `DbContext` is scoped (one unit-of-work per request).

### Migrations

```bash
dotnet tool install --global dotnet-ef    # one-time
dotnet ef migrations add InitialCreate    # generate from your model
dotnet ef database update                 # apply -> creates loans.db
```

A migration is a versioned schema change, like `prisma migrate` — except the source of truth is your C# classes, read by reflection. Look inside `Migrations/`: the generated code is C#, readable, and checked into git.

**LINQ-to-SQL:** `_db.LoanApplications.Where(l => l.Status == "Approved")` doesn't filter in memory — EF translates the *expression* into `WHERE "Status" = 'Approved'` and runs it in the database. Same LINQ surface as Topic 2's lists, radically different execution.

## Testing — where DI pays out

```bash
cd ..    # workspace root
dotnet new xunit -n LoanApp.Tests
cd LoanApp.Tests
dotnet add reference ../LoanApp/LoanApp.csproj
dotnet add package Microsoft.EntityFrameworkCore.InMemory
```

Delete the sample `UnitTest1.cs`, create `LoanServiceTests.cs`:

```csharp
using LoanApp.Data;
using LoanApp.Models;
using LoanApp.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanApp.Tests;

public class LoanServiceTests
{
    // Helper: a fresh in-memory DB per test (isolated).
    private static LoanDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<LoanDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new LoanDbContext(options);
    }

    [Fact]  // = test(...) in jest
    public async Task CreateAsync_SetsStatusToPending_AndAssignsId()
    {
        var db = NewDb();
        var service = new LoanService(db);   // inject the fake DB BY HAND
        var request = new CreateLoanRequest("Alice", 300_000);

        var loan = await service.CreateAsync(request);

        Assert.True(loan.Id > 0);
        Assert.Equal("Pending", loan.Status);
        Assert.Equal("Alice", loan.ApplicantName);
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsNull_WhenMissing()
    {
        var service = new LoanService(NewDb());
        var result = await service.GetByIdAsync(999);
        Assert.Null(result);
    }
}
```

```bash
dotnet test
```

xUnit mapped to jest: no `describe`/`it` nesting — the **class is the suite**, each `[Fact]` method is a test, the method name is the test name (hence the long descriptive names). Parameterised tests use `[Theory]` + `[InlineData(...)]` (jest's `test.each`). `Guid.NewGuid()` = `crypto.randomUUID()` — a unique DB name per test keeps them isolated.

The punchline: `LoanService` never knew whether it got real SQLite or a fake. Constructor injection made the test three lines of arrangement — no module mocking, no `jest.mock('./db')` hoisting rituals.

## Interview talking points

- `DbContext` = unit of work, `DbSet<T>` = table, `SaveChangesAsync` = commit; models are the schema because types exist at runtime.
- LINQ queries against EF are translated to SQL from expression trees — filtering happens in the database, not memory.
- Migrations are generated, versioned C# — reviewable in PRs like Prisma migration files.
- Testing story: inject an in-memory `DbContext`; DI means no mocking framework needed for this level.
