# Topic 2: Language & Type System — nominal, not structural

## The one question this topic answers

> **What does daily C# syntax look like, and where does its type system genuinely differ from TypeScript's?**

Most of the syntax maps directly: arrow functions, generics, `async/await`, `??`, `?.` — all there, nearly identical. This lesson covers the constructs that **don't** exist in TS, then the philosophy split that explains most of them: nominal typing.

## The tour — read every comment

This is a full `Program.cs` for a console app. Type it in (don't paste), run it with `dotnet run`:

```csharp
// ---- Variables & types ----
// 'var' = inferred type (like TS 'const x ='). Type is still fixed at compile time.
var applicantName = "Jack";        // string
int loanAmount = 500_000;          // int (underscores are just readability)
decimal interestRate = 5.75m;      // 'm' = decimal, use for money (never float/double for $)
bool isApproved = false;

// String interpolation: $"..." is TS's `...${x}...`
Console.WriteLine($"{applicantName} wants ${loanAmount} at {interestRate}%");

// ---- Nullability ----
// string? means "can be null". Without ?, the compiler warns you if it might be null.
string? middleName = null;
Console.WriteLine(middleName ?? "no middle name");   // ?? is the same as TS

// ---- A class (reference type) ----
var app1 = new LoanApplication
{
    ApplicantName = "Alice",
    Amount = 300_000,
    Status = "Pending"
};

// ---- A record (great for data / immutable models) ----
var money = new Money(300_000, "AUD");
var cheaper = money with { Amount = 250_000 };  // 'with' copies + changes one field
Console.WriteLine($"{money.Amount} -> {cheaper.Amount}");

// ---- LINQ: your map/filter/reduce ----
var apps = new List<LoanApplication>
{
    new() { ApplicantName = "Alice", Amount = 300_000, Status = "Approved" },
    new() { ApplicantName = "Bob",   Amount = 900_000, Status = "Pending"  },
    new() { ApplicantName = "Cara",  Amount = 150_000, Status = "Approved" },
};

// .Where = filter, .Select = map, .Sum = reduce
var approvedTotal = apps
    .Where(a => a.Status == "Approved")   // arrow functions look identical
    .Select(a => a.Amount)
    .Sum();
Console.WriteLine($"Approved total: ${approvedTotal}");

// ---- async/await ----
await FakeSaveAsync(app1);
Console.WriteLine("Saved!");

// A local async function. Task = Promise<void>. Task<T> = Promise<T>.
async Task FakeSaveAsync(LoanApplication app)
{
    await Task.Delay(500);   // like `await new Promise(r => setTimeout(r, 500))`
    Console.WriteLine($"Saving {app.ApplicantName}...");
}

// ---- Type definitions live at the bottom (or in their own files) ----

// A class: mutable, reference type. { get; set; } = an auto-property (getter+setter).
class LoanApplication
{
    public string ApplicantName { get; set; } = "";
    public int Amount { get; set; }
    public string Status { get; set; } = "Pending";
}

// A record: concise, value-based equality, immutable by default. Perfect for DTOs.
record Money(decimal Amount, string Currency);
```

## New syntax unpacked

Every construct above that has no TS equivalent, mapped to what you know:

- **Numeric literal suffixes** — TS has one `number` type; C# has many, and a literal carries a type: `5.75` is a `double`, `5.75m` is a `decimal`, `500_000` is an `int`. The `m` isn't decoration — without it, `5.75` won't assign to a `decimal` at all. **Always `decimal` for money.**
- **Nullability `string?`** — same idea as TS with `strictNullChecks`: plain `string` means "never null", `string?` means "nullable". `??` and `?.` work exactly as in TS. Difference: it's a compiler warning system on top of the type, not a separate union type like `string | null`.
- **Properties `{ get; set; }`** — in a TS class you'd write `amount: number`. C#'s `public int Amount { get; set; }` declares a *property*: a hidden backing field plus auto-generated getter/setter. Used like a field (`app.Amount = 5`), but can later grow logic without changing callers. The `= "";` after it is a default value.
- **Object initializer** — `new LoanApplication { ApplicantName = "Alice" }` *looks* like a TS object literal but isn't: it calls the constructor, then assigns those properties. You can only set members that exist on the declared type — no ad-hoc shapes.
- **`new()` with no type name** — "target-typed new": inside a `List<LoanApplication>`, the compiler knows the element type, so `new() { ... }` omits it.
- **Records** — `record Money(decimal Amount, string Currency);` generates a constructor, read-only properties, `ToString`, and **value-based equality**: two `Money` objects with the same values are equal (classes compare by reference, like JS objects). `with { Amount = 250_000 }` is C#'s spread-update: `{ ...money, amount: 250_000 }`.
- **`List<T>`** — your everyday JS array: `.Add()`, `.Count`, grows dynamically. Fixed-size arrays (`int[]`) exist but `List<T>` is the default.
- **LINQ** — `.Where`/`.Select`/`.Sum`/`.Aggregate` = `.filter`/`.map`/`.reduce`. Also `.FirstOrDefault(pred)` = `.find(pred)`, `.OrderByDescending(...)` = sort. Same idea, different names — you'll be fluent in an hour.
- **`Task` vs `Promise`** — same concept: `Task` = `Promise<void>`, `Task<T>` = `Promise<T>`. Async method names end in `Async` by convention.
- **Local functions** — a function declared mid-file works like a hoisted named `function` in JS: callable before its declaration.
- **Value types vs reference types** — `int`, `bool`, `decimal`, `struct` are *value types*: assignment copies (like JS primitives). `class` instances are *reference types*: assignment shares (like JS objects). Matters for threading (Topic 7) and `int?`.

## Namespaces — how code finds other code

```csharp
namespace LoanApp.Models;   // file-scoped: applies to the whole file

public class LoanApplication { /* ... */ }
```

`namespace X;` puts every type in the file into that named group; other files say `using LoanApp.Models;` to see them — the *namespace*, never a file path. Conventions: namespace mirrors the folder (`Models/` → `LoanApp.Models`), one public type per file, file named after the type.

## The philosophy split: nominal typing, not structural

TS is structural — "static duck typing": anything with the right properties *is* the type, no matter how it was declared. C# is nominal: compatibility comes from the **declared name and declared relationships**, and two types with byte-for-byte identical shapes are still completely unrelated.

Where this bites (and helps) day to day:

- **No object literals.** There's no `const x = { name: "Jack" }` — every shape must be declared first. When you miss literals, a one-line `record` is the cure.
- **Interfaces are implemented explicitly.** In TS, a class satisfies an interface just by having matching methods. In C#, `LoanService` is an `ILoanService` **only** because it declares `: ILoanService` — delete that clause and compilation fails even though every method still matches. (Convention: every interface is named with an `I` prefix.) DI (Topic 5) binds by these declared relationships, never by shape.
- **No assignment between look-alikes.** Two DTOs with identical fields still can't be passed for each other — you map field-by-field (the AutoMapper library exists purely to ease this friction).
- **The flip side is a feature:** accidental substitution is impossible. A `CustomerId` and an `AccountId` can both wrap an `int` and never be confused — what TS needs the "branded types" hack for, C# gives you by default.

One more TS habit to drop: C# interfaces are used almost only as *behaviour contracts* (methods to implement), not to describe plain data shapes — classes and records do that job.

## Interview talking points

- Records vs classes: records for immutable data/DTOs (value equality, `with`), classes for entities with behaviour/mutable state.
- `decimal` for money — never `float`/`double`. Saying this unprompted signals fintech experience.
- Nominal vs structural: "TS asks *does it have the right shape?* C# asks *did you declare it as that thing?*" — and the branded-types-for-free upside.
- The `:` symbol is both `extends` and `implements`: base class first, then interfaces.
