# Topic 6: Solutions

## 6.1 — Prove persistence

1. The loans survive the restart because state lives in `loans.db`, not in a service instance. This permanently fixes the Topic 5 lifetime problem: the service went **back to `AddScoped`** (fresh instance per request is now *correct*), and the singleton-list workaround is gone.
2. `.schema` shows something like:

```sql
CREATE TABLE "LoanApplications" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_LoanApplications" PRIMARY KEY AUTOINCREMENT,
    "ApplicantName" TEXT NOT NULL,
    "Amount" TEXT NOT NULL,        -- SQLite has no decimal; EF stores it as TEXT to keep precision
    "Status" TEXT NOT NULL
);
```

The column types came from your **C# property types, read by reflection** (Topic 3). `Id` became the auto-increment PK purely by naming convention. No schema file exists anywhere — the class is the schema.

## 6.2 — A query endpoint

Interface:

```csharp
Task<(List<LoanApplication> Loans, decimal Total)> GetApprovedAsync();
```

Service:

```csharp
public async Task<(List<LoanApplication> Loans, decimal Total)> GetApprovedAsync()
{
    var query = _db.LoanApplications.Where(l => l.Status == "Approved");
    var loans = await query.ToListAsync();
    var total = await query.SumAsync(l => l.Amount);
    return (loans, total);
}
```

Both lines run **in the database**: the `Where` becomes SQL `WHERE`, `SumAsync` becomes SQL `SUM`. (For one round-trip you could sum in memory from `loans` — at this scale either is fine; knowing the difference is the point.)

Controller:

```csharp
[HttpGet("approved")]                           // GET /api/loans/approved
public async Task<ActionResult> GetApproved()
{
    var (loans, total) = await _loanService.GetApprovedAsync();   // tuple deconstruction ≈ destructuring
    return Ok(new { loans, total });            // anonymous type -> {"loans":[...],"total":...}
}
```

4. No collision: `[HttpGet("{id}")]` declares `int id`, and routing treats the literal segment `approved` as a better match than the parameterised one — plus `"approved"` fails the `int` route constraint. Order in the file doesn't matter; specificity does. (In Express, `/loans/approved` had to be registered *before* `/loans/:id` — order-dependent routing is a real bug class this design removes.)

## 6.3 — Migrations round-trip

```csharp
public DateTime CreatedAt { get; set; }          // on LoanApplication
// in CreateAsync:  CreatedAt = DateTime.UtcNow,
```

```bash
dotnet ef migrations add AddCreatedAt
dotnet ef database update
```

The generated file has two methods: **`Up`** (apply: `AddColumn<DateTime>...`) and **`Down`** (revert: `DropColumn`). Prisma analogue: the SQL files in `prisma/migrations/` — except EF's are C# you can edit (e.g. to backfill data), and `Down` gives you generated rollbacks.

## 6.4 — Tests

```csharp
[Fact]
public async Task GetAllAsync_ReturnsBothLoans()
{
    var service = new LoanService(NewDb());
    await service.CreateAsync(new CreateLoanRequest("Alice", 300_000));
    await service.CreateAsync(new CreateLoanRequest("Bob", 150_000));

    var all = await service.GetAllAsync();

    Assert.Equal(2, all.Count);
}

[Fact]
public async Task ApproveAsync_ApprovesExistingLoan_AndReturnsNullForMissing()
{
    var service = new LoanService(NewDb());
    var loan = await service.CreateAsync(new CreateLoanRequest("Alice", 300_000));

    var approved = await service.ApproveAsync(loan.Id);
    var missing  = await service.ApproveAsync(999);

    Assert.NotNull(approved);
    Assert.Equal("Approved", approved!.Status);
    Assert.Null(missing);
}

[Theory]                       // = test.each in jest
[InlineData(1)]
[InlineData(300_000)]
[InlineData(10_000_000)]
public async Task CreateAsync_AlwaysStartsPending(decimal amount)
{
    var service = new LoanService(NewDb());

    var loan = await service.CreateAsync(new CreateLoanRequest("Alice", amount));

    Assert.Equal("Pending", loan.Status);
    Assert.Equal(amount, loan.Amount);
}
```

`dotnet test` → green. Each test built its own database in one line and handed it to the service by hand — **constructor injection is the whole mocking story** at this level. The `approved!` is the null-forgiving operator (TS's `!`), justified because the line above asserted `NotNull`.
