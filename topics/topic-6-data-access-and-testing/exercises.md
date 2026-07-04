# Topic 6: Exercises

Do the lesson's swap first (EF Core packages, `LoanDbContext`, rewritten service, registration, migration). Then:

## Exercise 6.1 — Prove persistence

1. Run the app, POST two loans, stop the app (`Ctrl+C`), start it again, GET the list. Confirm the loans survived — then say *which registration change from Topic 5's exercises this fixes for good*.
2. Open `loans.db` with `sqlite3 loans.db '.schema'` (or a GUI). Compare the generated table to your C# class — where did `TEXT`/`decimal` column types come from?

## Exercise 6.2 — A query endpoint

Add `GET /api/loans/approved` returning only approved loans **and their total**:

1. Add `Task<(List<LoanApplication> Loans, decimal Total)> GetApprovedAsync()` to the interface and service — note the **named tuple** return type, C#'s `{ loans, total }` without declaring a record.
2. Use a LINQ `Where` on the `DbSet`, and get the total with `SumAsync`.
3. Controller action: return an anonymous object `new { loans, total }` as JSON.
4. Route gotcha: `[HttpGet("approved")]` must not collide with `[HttpGet("{id}")]` — test `GET /api/loans/approved` and `GET /api/loans/1` both still work, and explain why the framework doesn't try to parse `"approved"` as an `int` id.

## Exercise 6.3 — Migrations round-trip

Add a `DateTime CreatedAt` property to `LoanApplication` (default it to `DateTime.UtcNow` in `CreateAsync`). Generate and apply a second migration. Look at the generated migration file — what two methods does it contain, and what's the Prisma analogue?

## Exercise 6.4 — Tests

In `LoanApp.Tests`:

1. Write a test: create two loans, assert `GetAllAsync()` returns exactly 2.
2. Write a test for your `ApproveAsync` from Topic 5: create → approve → assert status; and assert approving id 999 returns null.
3. Convert your "create" test into a `[Theory]` with `[InlineData]` covering amounts `1`, `300_000`, `10_000_000` — assert each comes back `"Pending"` with the right amount.
