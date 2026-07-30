# Topic 6: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → Web API + EF Core → **EF Core deep dive** → Transfer endpoint → Document upload → Authentication → Production

Topic 5 got EF Core working. This topic opens the hood to understand how it actually works: change tracking, the staged-writes model, LINQ-to-SQL, and transactions.

**Prerequisites:** Complete Topic 5 hands-on (working PaymentApp API with PostgreSQL).

---

## Exercise 6.1 — Inspect the database schema

Let's verify what EF Core actually created in PostgreSQL.

**Task:** Use psql to examine the schema.

**Solution**

```bash
# List all tables
docker compose exec db psql -U payapp -d payapp -c '\dt'

# Expected output:
#  Schema |        Name              | Type  | Owner
# --------+--------------------------+-------+--------
#  public | Users                    | table | payapp
#  public | __EFMigrationsHistory    | table | payapp

# Describe the Users table
docker compose exec db psql -U payapp -d payapp -c '\d "Users"'

# Expected output shows:
#  Column       |            Type             | Nullable
# --------------+-----------------------------+----------
#  Id           | integer                     | not null (identity)
#  CreatedAt    | timestamp with time zone    | not null
#  UpdatedAt    | timestamp with time zone    |
#  Name         | character varying(100)      | not null
#  Email        | character varying(255)      | not null
#  PasswordHash | text                        | not null
#  Balance      | numeric(18,2)               | not null
#  DocumentPath | text                        |
# Indexes:
#  "PK_Users" PRIMARY KEY (Id)
#  "IX_Users_Email" UNIQUE (Email)
```

**Understanding the mapping:**

| C# Type | PostgreSQL Type | Notes |
|---------|-----------------|-------|
| `int` | `integer` + identity | Auto-increment |
| `string` | `text` or `varchar(n)` | Based on `HasMaxLength()` |
| `decimal` | `numeric(18,2)` | Based on `HasPrecision()` |
| `DateTime` | `timestamp with time zone` | Always use UTC |
| `string?` | nullable column | Null allowed |

The `__EFMigrationsHistory` table tracks which migrations have been applied.

---

## Exercise 6.2 — Understand change tracking

EF Core tracks changes to entities. Let's see this in action.

**Task:** Create a script that demonstrates change tracking.

**Solution**

Create `test-change-tracking.cs`:

```csharp
#!/usr/bin/env dotnet
#r "src/PaymentApp.Infrastructure/bin/Debug/net10.0/PaymentApp.Infrastructure.dll"
#r "src/PaymentApp.Domain/bin/Debug/net10.0/PaymentApp.Domain.dll"
#:package Npgsql.EntityFrameworkCore.PostgreSQL@10.0.0
#:package Microsoft.EntityFrameworkCore@10.0.0

using Microsoft.EntityFrameworkCore;
using PaymentApp.Domain.Entities;
using PaymentApp.Infrastructure.Data;

var options = new DbContextOptionsBuilder<PaymentDbContext>()
    .UseNpgsql("Host=localhost;Database=payapp;Username=payapp;Password=devpass")
    .Options;

using var db = new PaymentDbContext(options);

// 1. Query returns TRACKED entities
var alice = await db.Users.FirstOrDefaultAsync(u => u.Email == "alice@bank.test");
if (alice == null)
{
    Console.WriteLine("No alice found. Run the Topic 5 tests first.");
    return;
}

Console.WriteLine($"1. Queried Alice: Balance = {alice.Balance}");

// 2. Check the entity state
var entry = db.Entry(alice);
Console.WriteLine($"2. Entity state: {entry.State}");  // Unchanged

// 3. Mutate the entity
alice.Balance += 100;
Console.WriteLine($"3. After mutation: State = {entry.State}");  // Modified

// 4. See what changed
foreach (var prop in entry.Properties.Where(p => p.IsModified))
{
    Console.WriteLine($"   Changed: {prop.Metadata.Name} from {prop.OriginalValue} to {prop.CurrentValue}");
}

// 5. Revert without saving (detach and re-query)
entry.State = EntityState.Unchanged;
Console.WriteLine($"5. After revert: Balance = {alice.Balance}");  // Still 100 more (in memory)

// Re-query to get original
var fresh = await db.Users.FirstOrDefaultAsync(u => u.Id == alice.Id);
Console.WriteLine($"   Fresh query: Balance = {fresh!.Balance}");  // Original value
```

Build and run:

```bash
dotnet build src/PaymentApp.Infrastructure
dotnet run test-change-tracking.cs
```

**Key insights:**

| State | Meaning | On SaveChanges |
|-------|---------|----------------|
| `Unchanged` | Tracked, no modifications | Nothing |
| `Modified` | Tracked, properties changed | UPDATE |
| `Added` | New entity | INSERT |
| `Deleted` | Marked for deletion | DELETE |
| `Detached` | Not tracked | Nothing |

**Clean up:**

```bash
rm test-change-tracking.cs
```

---

## Exercise 6.3 — Staged writes: the git analogy

The `git add` + `git commit` analogy helps understand EF Core's write model.

**Task:** Demonstrate that changes accumulate and flush in one transaction.

**Solution**

Create `test-staged-writes.cs`:

```csharp
#!/usr/bin/env dotnet
#r "src/PaymentApp.Infrastructure/bin/Debug/net10.0/PaymentApp.Infrastructure.dll"
#r "src/PaymentApp.Domain/bin/Debug/net10.0/PaymentApp.Domain.dll"
#:package Npgsql.EntityFrameworkCore.PostgreSQL@10.0.0
#:package Microsoft.EntityFrameworkCore@10.0.0

using Microsoft.EntityFrameworkCore;
using PaymentApp.Domain.Entities;
using PaymentApp.Infrastructure.Data;

var options = new DbContextOptionsBuilder<PaymentDbContext>()
    .UseNpgsql("Host=localhost;Database=payapp;Username=payapp;Password=devpass")
    .LogTo(Console.WriteLine, Microsoft.Extensions.Logging.LogLevel.Information)
    .EnableSensitiveDataLogging()
    .Options;

using var db = new PaymentDbContext(options);

Console.WriteLine("=== Creating a new user ===");

var newUser = new User
{
    Name = "Test User",
    Email = $"test-{Guid.NewGuid()}@bank.test",
    PasswordHash = "dummy",
    CreatedAt = DateTime.UtcNow
};
newUser.SetInitialBalance(500m);

Console.WriteLine($"Before Add: Id = {newUser.Id}");  // 0 (not yet assigned)

db.Users.Add(newUser);  // "git add" - staged, no SQL yet
Console.WriteLine($"After Add: Id = {newUser.Id}");   // Still 0

Console.WriteLine("\n=== Calling SaveChangesAsync ===");
await db.SaveChangesAsync();  // "git commit" - executes INSERT

Console.WriteLine($"\nAfter Save: Id = {newUser.Id}");  // Now has real ID

// Clean up
db.Users.Remove(newUser);
await db.SaveChangesAsync();
Console.WriteLine("\nCleaned up test user.");
```

Run it and watch the SQL:

```bash
dotnet run test-staged-writes.cs
```

You'll see:
1. `Id` is 0 until `SaveChangesAsync`
2. The actual `INSERT INTO "Users" ... RETURNING "Id"` SQL
3. After save, `Id` has the database-generated value

**The key insight:** EF Core uses `INSERT ... RETURNING` to get the generated ID in one round trip.

**Clean up:**

```bash
rm test-staged-writes.cs
```

---

## Exercise 6.4 — LINQ becomes SQL

The same LINQ syntax produces different results against in-memory collections vs `DbSet`.

**Task:** Compare LINQ execution modes.

**Solution**

Create `test-linq-sql.cs`:

```csharp
#!/usr/bin/env dotnet
#r "src/PaymentApp.Infrastructure/bin/Debug/net10.0/PaymentApp.Infrastructure.dll"
#r "src/PaymentApp.Domain/bin/Debug/net10.0/PaymentApp.Domain.dll"
#:package Npgsql.EntityFrameworkCore.PostgreSQL@10.0.0
#:package Microsoft.EntityFrameworkCore@10.0.0

using Microsoft.EntityFrameworkCore;
using PaymentApp.Domain.Entities;
using PaymentApp.Infrastructure.Data;

var options = new DbContextOptionsBuilder<PaymentDbContext>()
    .UseNpgsql("Host=localhost;Database=payapp;Username=payapp;Password=devpass")
    .LogTo(sql => Console.WriteLine($"SQL: {sql}"),
           Microsoft.Extensions.Logging.LogLevel.Information)
    .Options;

using var db = new PaymentDbContext(options);

Console.WriteLine("=== Query 1: Filter in database (GOOD) ===");
var richUsers = await db.Users
    .Where(u => u.Balance > 500)
    .Select(u => new { u.Name, u.Balance })
    .ToListAsync();
// SQL: SELECT "u"."Name", "u"."Balance" FROM "Users" AS "u" WHERE "u"."Balance" > 500

Console.WriteLine($"Found {richUsers.Count} users with balance > 500\n");

Console.WriteLine("=== Query 2: Fetch all, filter in memory (BAD) ===");
var allUsers = await db.Users.ToListAsync();
// SQL: SELECT * FROM "Users" (fetches EVERYTHING)
var richUsersMemory = allUsers.Where(u => u.Balance > 500).ToList();
// No SQL - filtering happens in C#

Console.WriteLine($"Found {richUsersMemory.Count} users (but fetched ALL users first)\n");

Console.WriteLine("=== Query 3: Use projection to limit columns ===");
var names = await db.Users
    .Where(u => u.Balance > 0)
    .Select(u => u.Name)  // Only fetch the Name column
    .ToListAsync();
// SQL: SELECT "u"."Name" FROM "Users" AS "u" WHERE "u"."Balance" > 0

Console.WriteLine($"Names: {string.Join(", ", names)}");
```

Run and observe the SQL:

```bash
dotnet run test-linq-sql.cs
```

**The placement rule:**

| Pattern | SQL Generated | Performance |
|---------|---------------|-------------|
| `.Where().ToListAsync()` | `WHERE` clause | Good |
| `.ToListAsync().Where()` | Fetches all | Bad |
| `.Select(u => u.Name)` | Only `Name` column | Good |
| `.Select(u => u)` | All columns | Okay |

**Clean up:**

```bash
rm test-linq-sql.cs
```

---

## Exercise 6.5 — Explicit transactions

`SaveChangesAsync()` creates an implicit transaction. Sometimes you need explicit control.

**Task:** Demonstrate explicit transaction handling.

**Solution**

Add a method to understand explicit transactions. Create `test-transactions.cs`:

```csharp
#!/usr/bin/env dotnet
#r "src/PaymentApp.Infrastructure/bin/Debug/net10.0/PaymentApp.Infrastructure.dll"
#r "src/PaymentApp.Domain/bin/Debug/net10.0/PaymentApp.Domain.dll"
#:package Npgsql.EntityFrameworkCore.PostgreSQL@10.0.0
#:package Microsoft.EntityFrameworkCore@10.0.0

using Microsoft.EntityFrameworkCore;
using PaymentApp.Domain.Entities;
using PaymentApp.Infrastructure.Data;

var options = new DbContextOptionsBuilder<PaymentDbContext>()
    .UseNpgsql("Host=localhost;Database=payapp;Username=payapp;Password=devpass")
    .Options;

using var db = new PaymentDbContext(options);

var alice = await db.Users.FirstAsync(u => u.Email == "alice@bank.test");
var bob = await db.Users.FirstAsync(u => u.Email == "bob@bank.test");

Console.WriteLine($"Before: Alice={alice.Balance}, Bob={bob.Balance}");

// Explicit transaction
using var transaction = await db.Database.BeginTransactionAsync();
try
{
    alice.Balance -= 100m;
    await db.SaveChangesAsync();  // First save (within transaction)

    bob.Balance += 100m;
    await db.SaveChangesAsync();  // Second save (still within transaction)

    // Both succeed - commit
    await transaction.CommitAsync();
    Console.WriteLine("Transaction committed");
}
catch (Exception ex)
{
    // Either failed - rollback both
    await transaction.RollbackAsync();
    Console.WriteLine($"Transaction rolled back: {ex.Message}");
}

Console.WriteLine($"After: Alice={alice.Balance}, Bob={bob.Balance}");

// Verify in fresh context
using var verifyDb = new PaymentDbContext(options);
var aliceVerify = await verifyDb.Users.FirstAsync(u => u.Email == "alice@bank.test");
var bobVerify = await verifyDb.Users.FirstAsync(u => u.Email == "bob@bank.test");
Console.WriteLine($"Verified: Alice={aliceVerify.Balance}, Bob={bobVerify.Balance}");
```

**When to use explicit transactions:**

| Scenario | Use |
|----------|-----|
| Multiple `SaveChangesAsync` calls that must succeed together | Explicit transaction |
| Single `SaveChangesAsync` with multiple changes | Implicit (automatic) |
| Read then write with consistency requirements | Explicit transaction |

**Clean up:**

```bash
rm test-transactions.cs
```

---

## Exercise 6.6 — The unique constraint race

Concepts explained why check-then-insert has a race condition. Let's see the database enforce uniqueness.

**Task:** Try to violate the unique constraint.

**Solution**

```bash
# Try to register duplicate email directly in SQL
docker compose exec db psql -U payapp -d payapp -c \
  "INSERT INTO \"Users\" (\"Name\", \"Email\", \"PasswordHash\", \"Balance\", \"CreatedAt\")
   VALUES ('Duplicate', 'alice@bank.test', 'hash', 1000, NOW());"

# Error: duplicate key value violates unique constraint "IX_Users_Email"
# DETAIL: Key ("Email")=(alice@bank.test) already exists.
```

The database rejected the duplicate. This is why:

1. Check-then-insert (`if not exists then insert`) has a race window
2. Two simultaneous requests can both pass the check
3. Only one will win the insert; the other gets a constraint violation
4. The constraint is the *only* atomic enforcer

**In our code:**
- `AuthService.RegisterAsync` checks with `AnyAsync` (for nice error message)
- But the unique constraint is the real guarantee
- Topic 10 will add middleware to catch `DbUpdateException` and return 409

---

## Exercise 6.7 — AsNoTracking for read-only queries

When you're just reading data (not modifying), skip change tracking for better performance.

**Task:** Compare tracked vs untracked queries.

**Solution**

```csharp
// Tracked (default) - EF watches for changes
var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == 1);
// user.Balance = 0; // This would be tracked
// await _db.SaveChangesAsync(); // Would UPDATE

// Untracked - faster, but changes are ignored
var userReadOnly = await _db.Users
    .AsNoTracking()
    .FirstOrDefaultAsync(u => u.Id == 1);
// userReadOnly.Balance = 0; // Not tracked!
// await _db.SaveChangesAsync(); // Does nothing
```

**When to use `AsNoTracking()`:**

| Use Case | Tracking |
|----------|----------|
| API read endpoints (GET) | `AsNoTracking()` |
| Data for display/reporting | `AsNoTracking()` |
| Data you'll modify and save | Default (tracked) |

---

## Exercise 6.8 — Build and verify

**Task:** Ensure everything still compiles and tests pass.

**Solution**

```bash
dotnet build
dotnet run --project src/PaymentApp.Api
```

Test that transfers still work:

```bash
# Check current balances
docker compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "Balance" FROM "Users" ORDER BY "Id";'
```

---

## What we learned

| Concept | What it means |
|---------|---------------|
| **Change Tracking** | EF watches entities and diffs on save |
| **Entity States** | Unchanged, Modified, Added, Deleted, Detached |
| **Staged Writes** | `Add()` = stage, `SaveChangesAsync()` = commit |
| **LINQ-to-SQL** | Same syntax, different execution |
| **Projection** | `.Select()` limits columns fetched |
| **AsNoTracking** | Skip tracking for read-only queries |
| **Explicit Transactions** | `BeginTransactionAsync()` + `CommitAsync()` |

---

## Interview talking points

- "DbContext is a unit of work. It tracks changes and flushes them in one transaction on `SaveChangesAsync()`."
- "Entity IDs are 0 until after `SaveChangesAsync()` — EF uses `INSERT ... RETURNING` to get them."
- "LINQ placement matters: `.Where().ToListAsync()` filters in the database. `.ToListAsync().Where()` fetches everything and filters in memory."
- "Use `AsNoTracking()` for read-only queries — it skips change tracking overhead."
- "Check-then-insert has race conditions. Database constraints are the only atomic enforcers."
- "Explicit transactions span multiple `SaveChangesAsync()` calls when you need all-or-nothing."

---

## Next: Topic 7

In Topic 7, we add the transfer endpoint with proper concurrency handling. We'll explore the thread pool and why transfer needs synchronization.
