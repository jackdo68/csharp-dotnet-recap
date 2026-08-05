# Topic 3: Hands On

> **The PaymentApp build:** Solution structure → Domain models → **Runtime utilities** → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint → Document upload → Authentication → Production

In this hands-on, you'll explore how .NET preserves types at runtime. We'll add some utility code to PaymentApp that leverages reflection, and understand why this is impossible in TypeScript.

**Prerequisites:** Complete Topic 2 hands-on (you should have `User` entity and `Money` value object).

---

## Exercise 3.1 — Find the compiled IL

Before adding code, let's see what `dotnet build` actually produces.

**Task:**
1. Build the Domain project
2. Find the compiled `.dll`
3. Run it directly (even though it's a library, this proves the `.dll` is real IL)

**Solution**

```bash
dotnet build src/PaymentApp.Domain

# Find the output
ls src/PaymentApp.Domain/bin/Debug/net10.0/
# PaymentApp.Domain.dll
# PaymentApp.Domain.deps.json
# PaymentApp.Domain.pdb (debug symbols)
```

The `.dll` contains IL (Intermediate Language) bytecode with all type information preserved. You can't "run" a class library directly, but you can inspect it:

```bash
# Show the IL metadata (requires .NET SDK)
dotnet tool install -g dotnet-ildasm 2>/dev/null || true
dotnet ildasm src/PaymentApp.Domain/bin/Debug/net10.0/PaymentApp.Domain.dll --output:domain.il
head -50 domain.il
```

You'll see your types — `User`, `Money`, `BaseEntity` — described in IL with full type information. This metadata is what makes reflection possible.

---

## Exercise 3.2 — Add an entity metadata helper

Let's create a utility that inspects entities at runtime. This is the kind of code that powers EF Core and serializers.

**Task:** Create a static helper that can describe any entity's properties.

**Solution**

Create `src/PaymentApp.Domain/Utilities/EntityDescriptor.cs`:

```bash
mkdir -p src/PaymentApp.Domain/Utilities
```

```csharp
using System.Reflection;

namespace PaymentApp.Domain.Utilities;

public static class EntityDescriptor
{
    /// <summary>
    /// Returns a description of all public properties on a type.
    /// This is how EF Core discovers your model — no schema files needed.
    /// </summary>
    public static IEnumerable<PropertyInfo> GetProperties<T>() where T : class
    {
        return typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance);
    }

    /// <summary>
    /// Returns property names and their types as strings.
    /// </summary>
    public static IEnumerable<(string Name, string TypeName)> Describe<T>() where T : class
    {
        return GetProperties<T>()
            .Select(p => (p.Name, p.PropertyType.Name));
    }

    /// <summary>
    /// Gets a property value by name at runtime.
    /// This is how serializers work — they read/write properties dynamically.
    /// </summary>
    public static object? GetValue<T>(T entity, string propertyName) where T : class
    {
        var prop = typeof(T).GetProperty(propertyName);
        return prop?.GetValue(entity);
    }

    /// <summary>
    /// Sets a property value by name at runtime.
    /// </summary>
    public static void SetValue<T>(T entity, string propertyName, object? value) where T : class
    {
        var prop = typeof(T).GetProperty(propertyName);
        prop?.SetValue(entity, value);
    }
}
```

**Understanding the reflection API:**

| Method | What it does |
|--------|--------------|
| `typeof(T)` | Gets the `Type` object for T — this is the runtime type information |
| `GetProperties()` | Returns all properties defined on the type |
| `BindingFlags` | Filter for public, private, instance, static members |
| `PropertyInfo` | Metadata about a single property — name, type, getter, setter |
| `GetValue(obj)` | Reads the property value from an instance |
| `SetValue(obj, val)` | Writes a value to the property on an instance |

**Why this is impossible in TypeScript:**

```typescript
// TypeScript - this doesn't work
function describe<T>(): PropertyInfo[] {
  // ERROR: T doesn't exist at runtime
  // There's no typeof(T) equivalent
  // The type parameter is erased by tsc
}
```

In TS, you'd need:
- A Zod schema (re-stating the type)
- `reflect-metadata` decorators (re-stating the type)
- Code generation (extracting types at build time)

C# never loses the type information, so reflection just... works.

---

## Exercise 3.3 — Test the descriptor

**Task:** Create a temporary test to verify the descriptor works.

**Solution**

Create a temporary `test-reflection.cs` script:

```csharp
#!/usr/bin/env dotnet

// Add reference to our Domain project
#r "src/PaymentApp.Domain/bin/Debug/net10.0/PaymentApp.Domain.dll"

using PaymentApp.Domain.Entities;
using PaymentApp.Domain.Utilities;

// Describe User entity
Console.WriteLine("== User Properties ==");
foreach (var (name, typeName) in EntityDescriptor.Describe<User>())
{
    Console.WriteLine($"  {name}: {typeName}");
}

// Create a user and read/write via reflection
var user = new User
{
    Name = "Alice",
    Email = "alice@bank.test",
    Balance = 1000m
};

Console.WriteLine($"\nOriginal balance: {EntityDescriptor.GetValue(user, "Balance")}");

EntityDescriptor.SetValue(user, "Balance", 500m);
Console.WriteLine($"After reflection set: {user.Balance}");

// Show that we can work with any entity
Console.WriteLine("\n== BaseEntity Properties (inherited) ==");
foreach (var (name, typeName) in EntityDescriptor.Describe<User>())
{
    if (name is "Id" or "CreatedAt" or "UpdatedAt")
        Console.WriteLine($"  {name}: {typeName} (from BaseEntity)");
}
```

Build and run:

```bash
dotnet build src/PaymentApp.Domain
dotnet run test-reflection.cs
```

Expected output:

```
== User Properties ==
  Id: Int32
  CreatedAt: DateTime
  UpdatedAt: Nullable`1
  Name: String
  Email: String
  PasswordHash: String
  Balance: Decimal
  DocumentPath: String

Original balance: 1000
After reflection set: 500

== BaseEntity Properties (inherited) ==
  Id: Int32 (from BaseEntity)
  CreatedAt: DateTime (from BaseEntity)
  UpdatedAt: Nullable`1 (from BaseEntity)
```

**Clean up:**

```bash
rm test-reflection.cs
```

---

## Exercise 3.4 — Add domain events infrastructure

Domain events are a pattern where entities emit events about what happened to them. The infrastructure uses reflection to dispatch events to handlers. Let's set up the base.

**Task:** Create domain event interfaces in the Domain project.

**Solution**

Create `src/PaymentApp.Domain/Events/IDomainEvent.cs`:

```bash
mkdir -p src/PaymentApp.Domain/Events
```

```csharp
namespace PaymentApp.Domain.Events;

/// <summary>
/// Marker interface for domain events.
/// Events describe something that happened in the domain.
/// </summary>
public interface IDomainEvent
{
    DateTime OccurredAt { get; }
}

/// <summary>
/// Base record for domain events with automatic timestamp.
/// </summary>
public abstract record DomainEvent : IDomainEvent
{
    public DateTime OccurredAt { get; } = DateTime.UtcNow;
}
```

Create `src/PaymentApp.Domain/Events/UserEvents.cs`:

```csharp
namespace PaymentApp.Domain.Events;

public record UserRegistered(int UserId, string Email) : DomainEvent;

public record UserBalanceChanged(int UserId, decimal OldBalance, decimal NewBalance) : DomainEvent;
```

**Why use `record` for events?**

Events are immutable facts about what happened. Records give us:
- Immutability by default
- Value-based equality
- Nice `ToString()` for logging
- `with` expressions if we need to copy with changes

---

## Exercise 3.5 — Add domain events to BaseEntity

Entities can raise domain events that will be collected and dispatched later (typically by the infrastructure layer after saving).

**Task:** Add a domain events collection to `BaseEntity`.

**Solution**

Update `src/PaymentApp.Domain/Entities/BaseEntity.cs`:

```csharp
using PaymentApp.Domain.Events;

namespace PaymentApp.Domain.Entities;

public abstract class BaseEntity
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    // Domain events that occurred on this entity
    private readonly List<IDomainEvent> _domainEvents = new();
    public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents.AsReadOnly();

    protected void AddDomainEvent(IDomainEvent domainEvent)
    {
        _domainEvents.Add(domainEvent);
    }

    public void ClearDomainEvents()
    {
        _domainEvents.Clear();
    }
}
```

**Understanding the pattern:**

| Part | Purpose |
|------|---------|
| `_domainEvents` | Private list that only the entity can add to |
| `DomainEvents` | Public read-only view for infrastructure to collect |
| `AddDomainEvent()` | Protected method — only the entity and subclasses can raise events |
| `ClearDomainEvents()` | Called after events are dispatched |

**How this uses runtime types:**

The infrastructure (we'll add it in Topic 5/6) will:
1. Use reflection to find all entities with domain events
2. Dispatch each event to its handler based on the event's runtime type
3. This is the same pattern MediatR uses

---

## Exercise 3.6 — Reified generics demo

Let's demonstrate that C# generics are "reified" — they exist at runtime, unlike TypeScript generics which are erased.

**Task:** Add a generic factory method to `BaseEntity`.

**Solution**

Add to `src/PaymentApp.Domain/Entities/BaseEntity.cs`:

```csharp
// Add this method to BaseEntity class

/// <summary>
/// Creates an instance of any entity type.
/// This works because T exists at runtime (reified generics).
/// In TypeScript, this is impossible — T is erased.
/// </summary>
public static T Create<T>() where T : BaseEntity, new()
{
    var entity = new T
    {
        CreatedAt = DateTime.UtcNow
    };

    Console.WriteLine($"Created entity of type: {typeof(T).Name}");
    return entity;
}
```

**Why `where T : BaseEntity, new()`?**

| Constraint | Meaning |
|------------|---------|
| `T : BaseEntity` | T must inherit from BaseEntity |
| `T : new()` | T must have a parameterless constructor |

These constraints are checked at **compile time** and enforced by the generic system. TypeScript has no equivalent because `T` doesn't exist at runtime to construct.

---

## Exercise 3.7 — Build and verify

**Task:** Build the solution and verify everything compiles.

**Solution**

```bash
dotnet build
```

Expected: `Build succeeded` with no errors.

---

## What we built

| File | Purpose |
|------|---------|
| `Utilities/EntityDescriptor.cs` | Reflection-based property inspector |
| `Events/IDomainEvent.cs` | Domain event interfaces |
| `Events/UserEvents.cs` | Concrete user-related events |
| Updated `BaseEntity.cs` | Domain events collection + generic factory |

**Domain project structure:**

```
src/PaymentApp.Domain/
├── Constants/
│   └── PaymentDefaults.cs
├── Entities/
│   ├── BaseEntity.cs (updated)
│   └── User.cs
├── Events/
│   ├── IDomainEvent.cs
│   └── UserEvents.cs
├── Utilities/
│   └── EntityDescriptor.cs
└── ValueObjects/
    └── Money.cs
```

---

## Key differences: C# vs TypeScript

| Aspect | C# (.NET) | TypeScript (Node) |
|--------|-----------|-------------------|
| **Types at runtime** | Preserved in IL | Erased by tsc |
| **`typeof(T)` in generics** | Works — T exists | Impossible — T is gone |
| **Reflection** | Built-in, comprehensive | Requires decorators/codegen |
| **Runtime type checks** | `is` pattern, real check | `instanceof` (classes only) |
| **Generic constraints** | Enforced at compile + runtime | Compile-time only, limited |

---

## Recap

- "TS types are erased at compile time; C# types are preserved in IL and enforced by the CLR."
- "Reflection is why EF Core can build database schemas from my models without codegen."
- "C# generics are *reified* — `typeof(T)` works at runtime. TS/Java generics are *erased*."
- "Using the word 'reified' correctly is a senior signal — it means the type exists at runtime."
- "Domain events use runtime type information for dispatch — each event goes to the right handler based on its actual type."

---

## Next: Topic 4

In Topic 4, we add domain exceptions and explore C#'s error handling philosophy: typed exceptions vs TypeScript's sentinel values.
