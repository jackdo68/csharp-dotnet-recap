# Topic 6: Data Access & Testing

> **What is EF Core actually doing — and how does DI make the data layer testable?**

Topic 5 wired the database cookbook-style. This topic opens the hood:
- How `DbContext` and change tracking work
- What migration files contain
- How LINQ becomes SQL
- How to test with a fake database (no Docker needed)

## Prisma → EF Core mapping

| Prisma | EF Core |
|--------|---------|
| `schema.prisma` | C# model classes (types = schema) |
| `PrismaClient` | `DbContext` |
| `prisma.user` | `DbSet<User>` |
| `prisma migrate dev` | `dotnet ef migrations add` + `database update` |
| `@unique` | Index in `OnModelCreating` |
| `update({ where, data })` | Mutate entity + `SaveChangesAsync` |
| Generated client types | Not needed — models are typed |

## The DbContext

```csharp
public class PaymentDbContext : DbContext
{
    public PaymentDbContext(DbContextOptions<PaymentDbContext> options) : base(options) { }
    public DbSet<User> Users => Set<User>();
}
```

**Key concepts:**

| Concept | What it means |
|---------|---------------|
| `DbContext` | Unit of work — remembers every entity it hands you |
| `DbSet<User>` | One table (convention: `Users` → table `"Users"`) |
| Change tracker | Tracks mutations, diffs at save time |
| Scoped lifetime | One context per request (Topic 5's rule) |

**The Prisma difference:**

| Prisma | EF Core |
|--------|---------|
| You *declare* the write: `update({ data })` | You *mutate* the entity: `user.Balance -= 100` |
| Each call = round trip | Changes accumulate, flush with `SaveChangesAsync` |

⚠️ **Classic EF bug:** mutating an untracked entity saves nothing.

## Staged writes: the git analogy

| Git | EF Core |
|-----|---------|
| `git add` | `_db.Users.Add(user)` — no SQL, just staged |
| `git commit` | `await _db.SaveChangesAsync()` — one trip, one transaction |

```csharp
_db.Users.Add(user);           // no SQL yet. user.Id == 0
_db.Users.Add(another);        // still no SQL
await _db.SaveChangesAsync();  // ONE round trip, ONE transaction
Console.WriteLine(user.Id);    // now real (via INSERT ... RETURNING)
```

**Key points:**
- One `SaveChangesAsync` = one implicit transaction (atomicity for free)
- `user.Id` is `0` until after the save — Postgres generates it
- Scoped `DbContext` = one unit of work per HTTP request

**Classic bugs:**
- Forgetting to call `SaveChangesAsync` — nothing saved
- Reading `user.Id` before save — it's `0`

## Migrations

Inside `Migrations/*_InitialCreate.cs`:

```csharp
public partial class InitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)    // apply
    {
        migrationBuilder.CreateTable(name: "Users", columns: table => new {
            Id = table.Column<int>(type: "integer", nullable: false),
            Name = table.Column<string>(type: "text", nullable: false),
            Balance = table.Column<decimal>(type: "numeric", nullable: false),
            // ...
        });
    }

    protected override void Down(MigrationBuilder migrationBuilder)  // revert
    {
        migrationBuilder.DropTable(name: "Users");
    }
}
```

**How it works:**

| Step | What happens |
|------|--------------|
| `migrations add` | Diffs your classes against snapshot → generates `Up`/`Down` |
| `database update` | Runs pending migrations (tracked in `__EFMigrationsHistory`) |

**Type mapping (from reflection):**

| C# type | Postgres type |
|---------|---------------|
| `string` | `text` |
| `int` | `integer` + identity |
| `decimal` | `numeric` |

## Database constraints

Some rules can't be expressed on a single object (e.g., "emails must be unique"). Use `OnModelCreating`:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<User>().HasIndex(u => u.Email).IsUnique();  // Prisma's @unique
}
```

Then migrate:

```bash
dotnet ef migrations add AddUserEmailUniqueIndex
dotnet ef database update
```

**Why not check in C# first?**

```csharp
if (await _db.Users.AnyAsync(u => u.Email == email)) throw ...;  // ❌ race condition
await _db.Users.AddAsync(user);
```

Check-then-insert = two steps. Two simultaneous registrations can both pass the check, then both insert. The unique index acts atomically at write time. (Topic 7 expands on this.)

## LINQ-to-SQL

Same LINQ syntax, but against `DbSet` it compiles to SQL:

```csharp
_db.Users.Where(u => u.Balance > 10_000)   // → SQL: WHERE "Balance" > 10000
```

**The placement rule:**

| Code | What happens |
|------|--------------|
| `.Where(...).ToListAsync()` | Filter in database — only matching rows cross the wire |
| `.ToListAsync().Where(...)` | Fetch ALL rows, filter in memory — catastrophic at scale |

This is the classic EF code-review catch.

## Testing with xUnit

**Setup:**

```bash
dotnet new xunit -n PaymentApp.Tests
cd PaymentApp.Tests
dotnet add reference ../PaymentApp/PaymentApp.csproj
dotnet add package Microsoft.EntityFrameworkCore.InMemory
```

**xUnit → Jest mapping:**

| Jest | xUnit |
|------|-------|
| `describe` | Class (the suite) |
| `test()` / `it()` | `[Fact]` method |
| `test.each()` | `[Theory]` + `[InlineData(...)]` |
| `expect().rejects.toThrow()` | `Assert.ThrowsAsync<T>()` |

**Example test:**

```csharp
public class PaymentServiceTests
{
    private static PaymentDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<PaymentDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PaymentDbContext(options);
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
}
```

**Why this works:**

| Benefit | How |
|---------|-----|
| No Docker needed | In-memory DB instead of real Postgres |
| No mocking framework | Constructor injection — pass fake `DbContext` directly |
| Isolated tests | Fresh DB per test (`Guid.NewGuid()`) |

**Trade-off:** In-memory DB won't catch Postgres-specific issues (unique constraints, locking behavior). Use integration tests for those.

**The punchline:** `PaymentService` never knows if it got real Postgres or a fake. Constructor injection = the whole mocking story.

## Interview talking points

- **DbContext:** Unit of work + change tracker. `DbSet<T>` = table. `SaveChangesAsync` = diff and commit.
- **EF vs Prisma:** EF tracks changes (mutate → save). Prisma declares writes (`update({ data })`). Mutating untracked objects saves nothing.
- **Staged writes:** `Add` = memory-only (`git add`). `SaveChangesAsync` = commit. One flush, one transaction. IDs via `INSERT ... RETURNING`.
- **Migrations:** Generated C# with `Up`/`Down`. Applied idempotently via `__EFMigrationsHistory`. Reviewable in PRs.
- **Constraints:** Multi-row rules (unique email) belong in the database. Check-then-insert has race conditions.
- **LINQ placement:** `.Where().ToListAsync()` filters in DB. `.ToListAsync().Where()` fetches all, filters in memory.
- **Testing:** Inject in-memory `DbContext`. DI = no mocking framework needed.
