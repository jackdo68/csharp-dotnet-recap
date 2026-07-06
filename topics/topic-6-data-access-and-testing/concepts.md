# Topic 6: Data Access & Testing — EF Core Unpacked, plus xUnit

## The one question this topic answers

> **What is EF Core actually doing under those two migration commands — and how does DI make the data layer testable?**

Topic 5 wired the database in cookbook-style: a minimal `DbContext`, two magic `dotnet ef` commands, and a service that mutates objects and calls `SaveChangesAsync`. It all works — and you can't yet explain *why*. This topic opens the hood: the `DbContext`, change tracking, what a migration file contains, how LINQ becomes SQL — and then cashes in the `IPaymentService` interface by testing the money logic against a fake database.

**You arrive with:** a running Postgres-backed `PaymentApp` you can operate but not fully explain. **You leave with:** the mental model for every line of the data layer, a unique-email constraint you added yourself, and a test project proving the money logic — no Docker required to run it.

## EF Core in one mapping

| Prisma | EF Core |
|---|---|
| `schema.prisma` | your C# model classes *are* the schema (runtime types — Topic 3) |
| `PrismaClient` | `DbContext` |
| `prisma.user` | `DbSet<User>` (the one table — balance lives on the user) |
| `prisma migrate dev` | `dotnet ef migrations add` + `database update` |
| `@unique` | an index in `OnModelCreating` (you'll add one below) |
| `update({ where, data })` | mutate the tracked entity + `SaveChangesAsync` (change tracking) |
| generated client types | none needed — the models are already typed |

## The DbContext, unpacked

Re-read Topic 5's `PaymentDbContext` with fresh eyes:

```csharp
public class PaymentDbContext : DbContext
{
    public PaymentDbContext(DbContextOptions<PaymentDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
}
```

- **`DbContext` = one unit of work.** It's a database session that *remembers every entity it has handed you* (the change tracker). That memory is why it's registered **scoped** — one per request — and why the captive-dependency crash from exercise 5.2 exists: an app-wide session would remember everything forever.
- **`Set<User>()`** is Topic 3's reified generics doing real work: the type argument locates the table mapping at runtime. `Users` → table `"Users"` purely by convention; `Id` → identity primary key, also by convention.
- **Change tracking is the Prisma difference to internalize.** In Topic 5's transfer you wrote `payer.Balance -= amount;` — a plain property mutation, no ORM call — and then one `SaveChangesAsync()`. At save time EF *diffs* every tracked entity against the snapshot it took when handing them out, and emits exactly the `UPDATE` statements needed, wrapped in a transaction. Prisma makes you *declare* the write (`update({ where, data })`); EF *observes* it. Both models are fine; confusing them is how you write EF code that saves nothing (mutating an entity the context never tracked).

### Staged writes — `Add` is `git add`, `SaveChanges` is `git commit`

The same deferred model governs *inserts*, and it's where Prisma instinct actively misleads. `_db.Users.Add(user)` performs **zero SQL** — it registers the object with the change tracker in state `Added`: an intention, recorded in memory. The database round trip happens at `SaveChangesAsync()`, and only *then* does the id exist:

```csharp
// Prisma: every call IS a round trip          // EF: calls accumulate intentions
const u = await prisma.user.create({ data });  _db.Users.Add(user);        // no SQL. user.Id == 0 !
console.log(u.id);  // id already real         _db.Users.Add(another);     // still no SQL
                                               await _db.SaveChangesAsync(); // ONE trip, ONE transaction
                                               Console.WriteLine(user.Id);   // now real — read back
                                               //   via INSERT ... RETURNING "Id"
```

This is the **unit of work** pattern (the official docs use exactly that term): collect every change belonging to one business operation, then flush them together, atomically. Three consequences you'll feel:

1. **One `SaveChangesAsync` = one implicit transaction.** The transfer's two balance mutations commit or neither does — you got atomicity without writing `BEGIN`/`COMMIT`. That's the pattern's main payoff, not a side effect.
2. **The classic EF bug is forgetting to save.** Mutate entities, return, wonder why the database never changed. Prisma structurally can't have this bug (every write is a call); EF trades that safety for batching.
3. **Staged entities have default ids** (`0`) until the flush. `RegisterAsync` can read `user.Id` only *after* `SaveChangesAsync` — before the flush it's `0`, because Postgres generates the identity value via `INSERT ... RETURNING "Id"`. Log `user.Id` before the save and you'll see `0`; the classic bug is depending on an id that doesn't exist yet. (When you later need two *related* rows in one operation, EF stages both, saves **once**, inserts in dependency order, and fixes up the foreign key itself — but our single `User` table needs only one insert, so `RegisterAsync` saves exactly once.)

And the lifetime story closes its loop: "scoped `DbContext`" *means* "one unit of work per HTTP request" — the request's staged changes live and die together.

## Migrations, unpacked

Open `Migrations/` — the folder Topic 5 told you to ignore. Inside `*_InitialCreate.cs`:

```csharp
public partial class InitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)      // apply
    {
        migrationBuilder.CreateTable(
            name: "Users",
            columns: table => new
            {
                Id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy",
                                NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                Name = table.Column<string>(type: "text", nullable: false),
                Balance = table.Column<decimal>(type: "numeric", nullable: false),
                File = table.Column<string>(type: "text", nullable: true),
                // ...
            });
    }

    protected override void Down(MigrationBuilder migrationBuilder)    // revert
    {
        migrationBuilder.DropTable(name: "Users");
    }
}
```

The anatomy:

- **`Up`/`Down`** — apply and revert, as reviewable C# (Prisma's analogue is the SQL files in `prisma/migrations/`, minus generated rollbacks). These are checked into git; a schema change is a PR like any other.
- **Where did the column types come from?** Your properties, read by reflection (Topic 3): `string` → `text`, `int` → `integer` + identity, `decimal` → `numeric`. No schema file exists anywhere — the classes are the source of truth, and `migrations add` *diffs your classes against a snapshot* (`PaymentDbContextModelSnapshot.cs`, also in that folder) to compute the delta.
- **`database update`** runs every not-yet-applied migration, tracked in the `__EFMigrationsHistory` table — which is how the same command is a no-op on an up-to-date database and a full build on an empty one.

## Make the schema yours — a constraint the classes can't express

Rule: emails must be unique. A C# property can't say that (it's a fact about the *table*, not one object), so it goes in `OnModelCreating` — the escape hatch for everything class shapes can't state:

```csharp
// in PaymentDbContext:
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    // Prisma's @unique, spelled as fluent configuration.
    modelBuilder.Entity<User>().HasIndex(u => u.Email).IsUnique();
}
```

Then the round-trip you now understand:

```bash
dotnet ef migrations add AddUserEmailUniqueIndex   # diff -> a tiny Up/Down pair
dotnet ef database update                          # CREATE UNIQUE INDEX ...
```

Why a database constraint instead of checking in C# (`Users.AnyAsync(u => u.Email == ...)` before insert)? Because check-then-insert is **two steps** — two simultaneous registrations can both pass the check, then both insert. The unique index is the only arbiter that acts *atomically at the moment of write*. Hold that sentence; Topic 7 generalizes it into the course's biggest lesson.

## LINQ-to-SQL — same surface, different engine

```csharp
_db.Users.Where(u => u.Balance > 10_000)   // does NOT filter in memory
// EF translates the expression tree -> SQL:  WHERE "Balance" > 10000
```

Same LINQ you learned on `List<T>` in Topic 2 — but against a `DbSet`, the lambda is captured as an **expression tree** (Topic 3's runtime types again) and compiled to SQL; only matching rows cross the wire. The placement rule that follows: `.Where(...).ToListAsync()` filters in the database; `.ToListAsync()` then `.Where(...)` fetches *every row* and filters in memory — same result, catastrophically different at scale, and the classic EF code-review catch.

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

    // The two services, with their fakes injected BY HAND (no mocking framework).
    private static AuthService NewAuth(PaymentDbContext db) => new(db, new PasswordHasher<User>());
    private static PaymentService NewPayment(PaymentDbContext db) => new(db);

    // No get-balance endpoint — read the balance straight from the context.
    private static async Task<decimal> BalanceOf(PaymentDbContext db, int id)
        => (await db.Users.FindAsync(id))!.Balance;

    [Fact]  // = test(...) in jest
    public async Task RegisterAsync_CreatesUser_WithStartingBalance()
    {
        var db = NewDb();
        var user = await NewAuth(db).RegisterAsync(
            new RegisterRequest("Alice", "alice@bank.test", "Passw0rd!"));

        Assert.True(user.Id > 0);
        Assert.Equal(1000m, user.Balance);
        Assert.NotEqual("Passw0rd!", user.PasswordHash);   // hashed, never plaintext
    }

    [Fact]
    public async Task TransferAsync_MovesMoney_Exactly()
    {
        var db = NewDb();
        var alice = await NewAuth(db).RegisterAsync(new RegisterRequest("Alice", "a@t.t", "x"));
        var bob   = await NewAuth(db).RegisterAsync(new RegisterRequest("Bob",   "b@t.t", "x"));

        await NewPayment(db).TransferAsync(alice.Id, bob.Id, 250m);

        Assert.Equal(750m,  await BalanceOf(db, alice.Id));
        Assert.Equal(1250m, await BalanceOf(db, bob.Id));
    }

    [Fact]
    public async Task TransferAsync_Throws_WhenInsufficientFunds()
    {
        var db = NewDb();
        var alice = await NewAuth(db).RegisterAsync(new RegisterRequest("Alice", "a@t.t", "x"));
        var bob   = await NewAuth(db).RegisterAsync(new RegisterRequest("Bob",   "b@t.t", "x"));

        // = expect(...).rejects.toThrow(), but asserting the exception TYPE
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => NewPayment(db).TransferAsync(alice.Id, bob.Id, 5000m));

        Assert.Equal(1000m, await BalanceOf(db, alice.Id));   // nothing moved
    }
}
```

```bash
dotnet test
```

xUnit mapped to jest: no `describe`/`it` nesting — the **class is the suite**, each `[Fact]` method is a test, the method name is the test name (hence the long descriptive names). Parameterised tests use `[Theory]` + `[InlineData(...)]` (jest's `test.each`). `Assert.ThrowsAsync<T>` is `expect().rejects.toThrow()`, except it asserts the exception *type* — Topic 4's typed failures making tests sharper.

Note what the in-memory provider buys you: `dotnet test` passes with Postgres **down** — unit tests have no Docker dependency. (The trade-off: it's not real SQL, so it won't catch provider-specific issues, the unique index, or — important for Topic 7 — real locking behaviour; integration tests against real Postgres exist for that, one rung up the ladder.)

The punchline: `PaymentService` never knew whether it got real Postgres or a fake — the constructor takes "a `PaymentDbContext`", and both tests and production satisfy it. **Constructor injection is the whole mocking story at this level** — no module mocking, no `jest.mock('./db')` hoisting rituals. That's the interface and DI from Topic 5 paying rent.

## Interview talking points

- `DbContext` = unit of work + change tracker, `DbSet<T>` = table, `SaveChangesAsync` = diff-and-commit; models are the schema because types exist at runtime.
- EF *tracks changes*: mutate the entity, `SaveChangesAsync` writes the UPDATEs — vs Prisma's explicit `update({ data })`. Corollary: mutating an untracked object saves nothing.
- Staged writes / unit of work: `Add` is memory-only (`git add`), `SaveChangesAsync` is the commit — one flush, one transaction, ids materialized via `INSERT ... RETURNING`. "In Prisma every call is a round trip; in EF, calls accumulate and flush atomically" is a one-sentence answer that shows you know both ORMs.
- Migrations are generated, versioned C# with `Up`/`Down`, applied idempotently via `__EFMigrationsHistory` — reviewable in PRs like Prisma migration files.
- Constraints that span rows (unique email) belong in the database, not in check-then-insert C# — the check and the write must be atomic.
- LINQ against EF is translated from expression trees to SQL — and `.ToListAsync()` placement decides whether the database or your process does the filtering.
- Testing story: inject an in-memory `DbContext`; DI means no mocking framework needed for this level.
