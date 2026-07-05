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
- **Properties `{ get; set; }`** — in a TS class you'd write `amount: number`. C#'s `public int Amount { get; set; }` declares a *property*: a hidden backing field plus auto-generated getter/setter. Used like a field (`app.Amount = 5`), but can later grow logic without changing callers. The `= "";` after it is a default value. (Unpacked fully in the next section — this one is worth slowing down for.)
- **Object initializer** — `new LoanApplication { ApplicantName = "Alice" }` *looks* like a TS object literal but isn't: it calls the constructor, then assigns those properties. You can only set members that exist on the declared type — no ad-hoc shapes.
- **`new()` with no type name** — "target-typed new": inside a `List<LoanApplication>`, the compiler knows the element type, so `new() { ... }` omits it.
- **Records** — `record Money(decimal Amount, string Currency);` generates a constructor, read-only properties, `ToString`, and **value-based equality**: two `Money` objects with the same values are equal (classes compare by reference, like JS objects). `with { Amount = 250_000 }` is C#'s spread-update: `{ ...money, amount: 250_000 }`.
- **`List<T>`** — your everyday JS array: `.Add()`, `.Count`, grows dynamically. Fixed-size arrays (`int[]`) exist but `List<T>` is the default.
- **LINQ** — `.Where`/`.Select`/`.Sum`/`.Aggregate` = `.filter`/`.map`/`.reduce`. Also `.FirstOrDefault(pred)` = `.find(pred)`, `.OrderByDescending(...)` = sort. Same idea, different names — you'll be fluent in an hour. (Full vocabulary and the two things it does that array methods can't: two sections down.)
- **`Task` vs `Promise`** — same concept: `Task` = `Promise<void>`, `Task<T>` = `Promise<T>`. Async method names end in `Async` by convention.
- **Local functions** — a function declared mid-file works like a hoisted named `function` in JS: callable before its declaration.
- **Value types vs reference types** — `int`, `bool`, `decimal`, `struct` are *value types*: assignment copies (like JS primitives). `class` instances are *reference types*: assignment shares (like JS objects). Matters for threading (Topic 7) and `int?`.

## Properties unpacked — what `{ get; set; }` actually is

`{ get; set; }` is shorthand. It's called an **auto-property**, and the compiler expands it to a hidden field plus two methods:

```csharp
// What you write:
public int Amount { get; set; }

// What the compiler generates:
private int _amount;                    // the hidden "backing field"
public int Amount
{
    get { return _amount; }             // getter method
    set { _amount = value; }            // setter method — 'value' is the right-hand side of an assignment
}
```

So `app.Amount = 5` really calls a setter *method*, and `var x = app.Amount` calls the getter. It only *looks* like field access.

**What if you drop the `{ get; set; }`?** `public int Amount;` still compiles — but it's now a **field**, not a property: a raw variable with no methods in between. Callers can't tell the difference (`app.Amount = 5` works either way), but idiomatic C# never exposes public fields, for three practical reasons:

- **Serializers skip fields.** `System.Text.Json`, ASP.NET Core model binding, and EF Core mapping all work on *properties* by default. Make `Amount` a field and your API silently returns `{}` for it — a classic week-one bug.
- **Interfaces can only demand properties**, never fields: `interface ILoan { decimal Amount { get; } }` is legal; a field version isn't.
- **Swapping a field for a property later is a breaking change** (they're different things in the compiled IL), so you can't quietly upgrade. Starting with a property keeps the door open.

That door matters because a property can later grow logic without any call site changing:

```csharp
private decimal _amount;
public decimal Amount
{
    get => _amount;
    set => _amount = value >= 0 ? value
        : throw new ArgumentException("Amount can't be negative");
}
// app.Amount = -5 now throws — every existing caller got validation for free
```

The TS mapping: `amount: number` in a TS class is the *field* version, and TS's `get amount() { ... }` / `set amount(v) { ... }` accessors are the *longhand property* version. What TS lacks is the one-line auto-property — you either take a plain field or hand-write both accessors plus the `_amount` backing field. C# made the good-practice version as cheap as the lazy version, which is why everything in C# is `{ get; set; }`.

Variants you'll meet immediately:

```csharp
public int Id { get; }                       // get-only: assignable ONLY in the constructor, immutable after
public string Status { get; init; }          // get + init: settable at construction time (records use this)
public decimal Repayment => Amount * 1.05m;  // no storage at all — computed on every read (a TS getter)
```

(One edge case: `public int Amount { }` with an empty block is a compile error — a property must declare at least one accessor. Both, get-only, or no braces at all — which is a field.)

## LINQ unpacked — more than renamed array methods

LINQ (**L**anguage **IN**tegrated **Q**uery) is a set of extension methods in `System.Linq` that work on any sequence (`IEnumerable<T>`) — lists, arrays, dictionaries, EF Core query results, anything iterable. The everyday vocabulary, mapped:

| JS/TS array method | LINQ | Notes |
|---|---|---|
| `.filter(fn)` | `.Where(fn)` | |
| `.map(fn)` | `.Select(fn)` | |
| `.flatMap(fn)` | `.SelectMany(fn)` | |
| `.reduce(fn, seed)` | `.Aggregate(seed, fn)` | seed's type drives inference — `0m` for decimals |
| `.find(fn)` | `.FirstOrDefault(fn)` | plain `.First(fn)` **throws** on no match (Topic 4) |
| `.some(fn)` | `.Any(fn)` | `.Any()` with no args = "is it non-empty?" |
| `.every(fn)` | `.All(fn)` | |
| `.includes(x)` | `.Contains(x)` | |
| `.sort(cmp)` | `.OrderBy(fn)` / `.OrderByDescending(fn)` | key selector, not comparator; chain `.ThenBy` for tie-breaks; **doesn't mutate** |
| `.slice(0, n)` | `.Take(n)` / `.Skip(n)` | pagination is `Skip(page * size).Take(size)` |
| hand-rolled `reduce` | `.Sum(fn)` / `.Min` / `.Max` / `.Average` / `.Count(fn)` | the aggregations JS makes you build yourself |
| `Object.groupBy` | `.GroupBy(fn)` | |
| `[...new Set(xs)]` | `.Distinct()` | |
| `Object.fromEntries` | `.ToDictionary(keyFn, valFn)` | |
| — | `.ToList()` / `.ToArray()` | materialize the pipeline (see below) |

Two things LINQ does that JS array methods don't:

**1. Deferred execution.** `Where`/`Select`/`OrderBy` don't loop — they build a pipeline description. Nothing runs until something *consumes* it (`foreach`, `.ToList()`, `.Sum()`):

```csharp
var bigLoans = apps.Where(a => a.Amount > 500_000);   // nothing has executed yet
apps.Add(jumboLoan);                                   // added AFTER the query was written...
Console.WriteLine(bigLoans.Count());                   // ...still counted — the query runs HERE
```

In JS, each `.filter().map()` step eagerly allocates a whole intermediate array. A LINQ chain streams each element through the entire pipeline with no intermediates — `.filter().map().slice(0, 3)` over a million rows does a million iterations twice in JS; the LINQ version stops after three survivors. The flip side: enumerate a query twice and it *executes* twice — `.ToList()` when you need the results pinned down.

**2. The same query can run somewhere else.** Because a lambda passed to LINQ can be captured as an *expression tree* (data describing the code, not just a function pointer — Topic 3's runtime types again), a provider can translate it. That's Topic 6's punchline: `_db.LoanApplications.Where(l => l.Status == "Approved")` doesn't filter in memory — EF Core turns that exact C# into `WHERE Status = 'Approved'` in SQL. Prisma can't do this with a JS callback (`prisma.loan.findMany` takes a JSON-ish filter object instead, precisely because a JS arrow function is opaque at runtime).

One curiosity you'll see in older code: LINQ also has a SQL-ish *query syntax* — `from a in apps where a.Amount > 500_000 select a.ApplicantName`. It compiles to exactly the method calls above; modern codebases overwhelmingly use method syntax, so read it if you meet it, don't write it.

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
