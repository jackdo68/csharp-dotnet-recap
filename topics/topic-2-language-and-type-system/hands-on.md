# Topic 2: Hands On

> **The PaymentApp build:** Solution structure → **Domain models** → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint → Document upload → Authentication → Production

In this hands-on, you'll add the domain models to PaymentApp: the `User` entity and `Money` value object. Along the way, you'll internalize C# properties, records, and value types.

**Prerequisites:** Complete Topic 1 hands-on (you should have a `PaymentApp` solution with four projects).

---

## Exercise 2.1 — Create the User entity

The `User` is the core entity in PaymentApp. It represents a bank customer with a balance.

**Task:** Create a `User` class in `PaymentApp.Domain/Entities/` with these properties:
- `Id` (int) — primary key
- `Name` (string) — display name
- `Email` (string) — unique identifier for login
- `PasswordHash` (string) — we never store plain passwords
- `Balance` (decimal) — current balance (always use `decimal` for money)
- `DocumentPath` (string?) — nullable path to uploaded document

**Solution**

Create `src/PaymentApp.Domain/Entities/User.cs`:

```csharp
namespace PaymentApp.Domain.Entities;

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public decimal Balance { get; set; }
    public string? DocumentPath { get; set; }
}
```

**Understanding the syntax:**

| Syntax | What it means |
|--------|---------------|
| `namespace PaymentApp.Domain.Entities;` | File-scoped namespace — every type in this file belongs to this namespace |
| `public class User` | A reference type (lives on the heap, passed by reference) |
| `{ get; set; }` | Auto-property — compiler generates a backing field + getter/setter |
| `= string.Empty` | Default value — prevents null warnings without making the property nullable |
| `string?` | Nullable reference type — explicitly allows null |
| `decimal` | 128-bit decimal for financial calculations — never use `float` or `double` for money |

**Why `= string.Empty` instead of just `string`?**

With nullable reference types enabled (the default in .NET 10), a plain `string` means "this will never be null." The compiler warns if you might leave it uninitialized. The `= string.Empty` default satisfies that contract.

Alternative: make the properties required and set them via constructor (we'll see this pattern in Topic 4).

---

## Exercise 2.2 — Create the Money value object

A value object represents a concept where identity doesn't matter — only the value does. Two `Money` instances with the same amount and currency are equal, regardless of where they came from.

**Task:** Create a `Money` record in `PaymentApp.Domain/ValueObjects/`:
- `Amount` (decimal)
- `Currency` (string) — e.g., "USD", "AUD"

**Solution**

First, create the folder:

```bash
mkdir -p src/PaymentApp.Domain/ValueObjects
```

Create `src/PaymentApp.Domain/ValueObjects/Money.cs`:

```csharp
namespace PaymentApp.Domain.ValueObjects;

public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money Zero(string currency) => new(0m, currency);

    public static Money USD(decimal amount) => new(amount, "USD");
    public static Money AUD(decimal amount) => new(amount, "AUD");

    public Money Add(Money other)
    {
        if (Currency != other.Currency)
            throw new InvalidOperationException($"Cannot add {Currency} to {other.Currency}");

        return this with { Amount = Amount + other.Amount };
    }

    public Money Subtract(Money other)
    {
        if (Currency != other.Currency)
            throw new InvalidOperationException($"Cannot subtract {other.Currency} from {Currency}");

        return this with { Amount = Amount - other.Amount };
    }

    public override string ToString() => $"{Currency} {Amount:N2}";
}
```

**Understanding the syntax:**

| Syntax | What it means |
|--------|---------------|
| `readonly record struct` | Immutable value type with value-based equality |
| `Money(decimal Amount, string Currency)` | Primary constructor — parameters become properties |
| `this with { Amount = ... }` | Copy with modification — like spread in JS: `{ ...this, amount: x }` |
| `0m` | Decimal literal — the `m` suffix is required |
| `$"{Amount:N2}"` | Format specifier — N2 = number with 2 decimal places and thousand separators |

**Why `readonly record struct` instead of `record`?**

| Type | Storage | Equality | Mutability |
|------|---------|----------|------------|
| `class` | Heap (reference) | Reference | Mutable |
| `record` | Heap (reference) | Value | Immutable by default |
| `struct` | Inline (stack) | Value (if you implement it) | Can be mutable |
| `readonly record struct` | Inline (stack) | Value (automatic) | Immutable |

For small, immutable values like `Money`, `readonly record struct` is optimal:
- No heap allocation (good for performance in hot paths)
- Value-based equality (two `Money(100, "USD")` are equal)
- Immutable (`readonly` prevents mutation bugs)

---

## Exercise 2.3 — Verify value equality

Records and record structs have value-based equality. Classes don't. Let's prove it.

**Task:** Create a quick test in a console app (temporary — we'll delete it after).

**Solution**

Create `src/PaymentApp.Domain/Program.cs` temporarily:

```csharp
using PaymentApp.Domain.Entities;
using PaymentApp.Domain.ValueObjects;

// Value object equality
var m1 = Money.USD(100);
var m2 = Money.USD(100);
Console.WriteLine($"m1 == m2: {m1 == m2}");  // True — same value

var m3 = m1 with { Amount = 200 };
Console.WriteLine($"m1 == m3: {m1 == m3}");  // False — different amount
Console.WriteLine($"m1 unchanged: {m1}");    // USD 100.00 — original untouched

// Class reference equality
var u1 = new User { Id = 1, Name = "Alice", Email = "alice@bank.test" };
var u2 = new User { Id = 1, Name = "Alice", Email = "alice@bank.test" };
Console.WriteLine($"u1 == u2: {u1 == u2}");  // False — different references

// Same reference
var u3 = u1;
Console.WriteLine($"u1 == u3: {u1 == u3}");  // True — same object

// Money operations
var balance = Money.USD(1000);
var payment = Money.USD(250);
var remaining = balance.Subtract(payment);
Console.WriteLine($"After payment: {remaining}");  // USD 750.00
```

Also update the Domain csproj to be runnable temporarily:

```bash
# Add OutputType to make it runnable
dotnet add src/PaymentApp.Domain/PaymentApp.Domain.csproj package --version 10.0.0 Microsoft.NET.Sdk
```

Actually, let's do this differently — just edit the csproj:

Open `src/PaymentApp.Domain/PaymentApp.Domain.csproj` and temporarily add:

```xml
<PropertyGroup>
  <OutputType>Exe</OutputType>
  <!-- ... existing properties ... -->
</PropertyGroup>
```

Run it:

```bash
dotnet run --project src/PaymentApp.Domain
```

Expected output:

```
m1 == m2: True
m1 == m3: False
m1 unchanged: USD 100.00
u1 == u2: False
u1 == u3: True
After payment: USD 750.00
```

**Clean up:** Remove the `Program.cs` and the `<OutputType>Exe</OutputType>` line from the csproj — they were just for testing.

```bash
rm src/PaymentApp.Domain/Program.cs
```

---

## Exercise 2.4 — Add a base entity class

Most entities share common properties: `Id`, `CreatedAt`, `UpdatedAt`. Let's create a base class.

**Task:** Create a `BaseEntity` class that `User` can inherit from.

**Solution**

Create `src/PaymentApp.Domain/Entities/BaseEntity.cs`:

```csharp
namespace PaymentApp.Domain.Entities;

public abstract class BaseEntity
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
```

Update `User.cs` to inherit from it:

```csharp
namespace PaymentApp.Domain.Entities;

public class User : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public decimal Balance { get; set; }
    public string? DocumentPath { get; set; }
}
```

**Understanding the syntax:**

| Syntax | What it means |
|--------|---------------|
| `abstract class` | Cannot be instantiated directly — only subclasses can |
| `: BaseEntity` | Inheritance — `User` gets all properties from `BaseEntity` |
| `DateTime` | Built-in struct for date/time — a value type |
| `DateTime?` | Nullable value type — can be null |

**Note:** `Id` is now defined in `BaseEntity`, so we removed it from `User`.

---

## Exercise 2.5 — Create a constants file

Let's add some constants we'll use throughout the app.

**Task:** Create a constants class for default values.

**Solution**

Create `src/PaymentApp.Domain/Constants/PaymentDefaults.cs`:

```bash
mkdir -p src/PaymentApp.Domain/Constants
```

```csharp
namespace PaymentApp.Domain.Constants;

public static class PaymentDefaults
{
    public const decimal InitialBalance = 1000m;
    public const string DefaultCurrency = "USD";

    public static class TestUsers
    {
        public const string AliceEmail = "alice@bank.test";
        public const string BobEmail = "bob@bank.test";
        public const string CaraEmail = "cara@bank.test";
        public const string DefaultPassword = "Passw0rd!";
    }
}
```

**Understanding the syntax:**

| Syntax | What it means |
|--------|---------------|
| `static class` | Cannot be instantiated — only static members allowed |
| `const` | Compile-time constant — value is baked into the compiled code |
| Nested `static class` | Namespace-like grouping — accessed as `PaymentDefaults.TestUsers.AliceEmail` |

**`const` vs `static readonly`:**

| | `const` | `static readonly` |
|-|---------|-------------------|
| **Set when** | Compile time | Runtime (in static constructor) |
| **Can be** | Primitives, strings | Any type |
| **Changed in DLL** | All referencing assemblies must recompile | Just redeploy the DLL |

Use `const` for true constants (like π), `static readonly` for values that might change between deployments.

---

## Exercise 2.6 — Build and verify

**Task:** Build the entire solution and verify there are no errors.

**Solution**

```bash
dotnet build
```

Expected output:

```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

If you see warnings about nullable reference types, that's expected — we've been explicit with `string?` where nulls are allowed.

---

## Exercise 2.7 — Explore LINQ with your domain types

Let's practice LINQ using our new `Money` type.

**Task:** Create a temporary script to practice LINQ operations.

**Solution**

Create a temporary `linq-practice.cs` file (using .NET 10's single-file script feature):

```csharp
#!/usr/bin/env dotnet

// Simulate some transfers
var transfers = new[]
{
    new { From = "Alice", To = "Bob", Amount = 300m, Status = "Completed" },
    new { From = "Bob", To = "Cara", Amount = 900m, Status = "Pending" },
    new { From = "Cara", To = "Alice", Amount = 150m, Status = "Completed" },
    new { From = "Alice", To = "Cara", Amount = 500m, Status = "Failed" },
};

// 1. Filter: only completed transfers
var completed = transfers.Where(t => t.Status == "Completed");
Console.WriteLine("Completed transfers:");
foreach (var t in completed)
    Console.WriteLine($"  {t.From} -> {t.To}: ${t.Amount}");

// 2. Map: extract just the amounts
var amounts = transfers.Select(t => t.Amount);
Console.WriteLine($"\nAll amounts: {string.Join(", ", amounts)}");

// 3. Reduce: sum of completed
var completedTotal = transfers
    .Where(t => t.Status == "Completed")
    .Sum(t => t.Amount);
Console.WriteLine($"\nCompleted total: ${completedTotal}");

// 4. Find: first transfer over $500
var big = transfers.FirstOrDefault(t => t.Amount > 500m);
Console.WriteLine($"\nFirst over $500: {big?.From} -> {big?.To}");

// 5. Sort: by amount descending
var sorted = transfers.OrderByDescending(t => t.Amount);
Console.WriteLine("\nSorted by amount (desc):");
foreach (var t in sorted)
    Console.WriteLine($"  ${t.Amount}: {t.From} -> {t.To}");

// 6. Group: by status
var grouped = transfers.GroupBy(t => t.Status);
Console.WriteLine("\nGrouped by status:");
foreach (var group in grouped)
{
    Console.WriteLine($"  {group.Key}: {group.Count()} transfer(s)");
}
```

Run it:

```bash
dotnet run linq-practice.cs
```

Expected output:

```
Completed transfers:
  Alice -> Bob: $300
  Cara -> Alice: $150

All amounts: 300, 900, 150, 500

Completed total: $450

First over $500: Bob -> Cara

Sorted by amount (desc):
  $900: Bob -> Cara
  $500: Alice -> Cara
  $300: Alice -> Bob
  $150: Cara -> Alice

Grouped by status:
  Completed: 2 transfer(s)
  Pending: 1 transfer(s)
  Failed: 1 transfer(s)
```

**Clean up:**

```bash
rm linq-practice.cs
```

---

## What we built

| File | Purpose |
|------|---------|
| `Entities/BaseEntity.cs` | Base class with Id, CreatedAt, UpdatedAt |
| `Entities/User.cs` | User entity with Name, Email, PasswordHash, Balance, DocumentPath |
| `ValueObjects/Money.cs` | Immutable value object for monetary amounts |
| `Constants/PaymentDefaults.cs` | Application constants |

**Domain project structure:**

```
src/PaymentApp.Domain/
├── PaymentApp.Domain.csproj
├── Constants/
│   └── PaymentDefaults.cs
├── Entities/
│   ├── BaseEntity.cs
│   └── User.cs
└── ValueObjects/
    └── Money.cs
```

---

## Key takeaways

| Concept | C# | TypeScript |
|---------|-----|------------|
| Entity (mutable, identity matters) | `class` with `{ get; set; }` | `class` |
| Value object (immutable, value equality) | `readonly record struct` | Object with deep equality check |
| Nullable | `string?` | `string \| null` |
| Default value | `= string.Empty` | `= ""` |
| Inheritance | `: BaseClass` | `extends BaseClass` |
| Constants | `const` or `static readonly` | `const` |
| Static utility class | `static class` | Module with exported functions |

---

## Interview talking points

- "I use `decimal` for money, never `float` or `double`. Binary floating point can't represent 0.1 exactly, and you never want rounding errors in financial calculations."
- "Records give me value-based equality and immutability by default — perfect for DTOs and value objects."
- "`readonly record struct` is for small, immutable values that benefit from stack allocation. Two `Money` instances with the same value are equal, no matter where they came from."
- "The `with` expression is C#'s spread operator — it copies a record with specific properties changed, leaving the original untouched."

---

## Next: Topic 3

In Topic 3, we explore how .NET keeps types at runtime (unlike TypeScript's erasure). We'll add reflection-based utilities to our base entity class.
