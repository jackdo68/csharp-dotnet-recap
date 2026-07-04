# Topic 2: Exercises & Solutions

Work in the `LoanBasics` console project from Topic 1 (or scaffold a fresh one). Type the lesson's `Program.cs` in first — these exercises extend it. Try each exercise before reading its solution.

## Exercise 2.1 — LINQ fluency

Using the `apps` list from the lesson:

1. Print the applicant with the **largest** loan amount.
2. Print all applicant names joined with `", "` — but only those with amounts under $500k, sorted by amount ascending.
3. Compute the **average** approved amount two ways: with the built-in LINQ method, and manually with `.Aggregate` (your `reduce`).

**Solution**

```csharp
// 1. Largest loan
var biggest = apps.OrderByDescending(a => a.Amount).First();
Console.WriteLine($"Biggest: {biggest.ApplicantName} (${biggest.Amount})");

// 2. Under 500k, ascending, joined
var small = apps
    .Where(a => a.Amount < 500_000)
    .OrderBy(a => a.Amount)
    .Select(a => a.ApplicantName);
Console.WriteLine(string.Join(", ", small));   // Cara, Alice

// 3. Average approved — built-in, then Aggregate
var avg = apps.Where(a => a.Status == "Approved").Average(a => a.Amount);

var approved = apps.Where(a => a.Status == "Approved").ToList();
var avgManual = approved.Aggregate(0m, (acc, a) => acc + a.Amount) / approved.Count;

Console.WriteLine($"{avg} == {avgManual}");
```

Note `Aggregate(0m, ...)` — the seed must be `decimal` (`0m`), or the lambda won't type-check against `a.Amount`. Literal suffixes doing real work.

## Exercise 2.2 — Records vs classes

1. Create two `Money` records with identical values. Compare them with `==` and print the result. Then create two `LoanApplication` **class** instances with identical values and compare with `==`. Explain the difference in one sentence.
2. Use `with` to produce a copy of a `Money` in a different currency. Confirm the original is unchanged.
3. Try to mutate a record property (`money.Amount = 1;`). What does the compiler say?

**Solution**

```csharp
var m1 = new Money(300_000, "AUD");
var m2 = new Money(300_000, "AUD");
Console.WriteLine(m1 == m2);   // True — records compare by VALUE

var a1 = new LoanApplication { ApplicantName = "Alice", Amount = 1 };
var a2 = new LoanApplication { ApplicantName = "Alice", Amount = 1 };
Console.WriteLine(a1 == a2);   // False — classes compare by REFERENCE (like JS objects)

var aud = new Money(300_000, "AUD");
var usd = aud with { Currency = "USD" };
Console.WriteLine($"{aud.Currency} / {usd.Currency}");   // AUD / USD — original untouched
```

Mutating a positional-record property (`money.Amount = 1;`) fails with **CS8852**: init-only — settable only during construction or in a `with` expression. Records are immutable by default; that's why they're the DTO tool.

## Exercise 2.3 — Feel the nominal typing

1. Declare two records with **identical shapes**: `record CreateLoanRequest(string Name, decimal Amount);` and `record UpdateLoanRequest(string Name, decimal Amount);`. Write a method `void Submit(CreateLoanRequest req)` and try to pass it an `UpdateLoanRequest`. Read the compiler error out loud — in TS this would be legal.
2. Declare `interface IRiskChecker { int Score(decimal amount); }` and a class `BasicRiskChecker` that has a matching `Score` method but does **not** declare `: IRiskChecker`. Try `IRiskChecker checker = new BasicRiskChecker();`. Then fix it by declaring the interface. This is the "explicit implementation" difference — TS would have accepted the shape match.
3. Make two branded IDs — `record CustomerId(int Value);` and `record AccountId(int Value);` — and confirm the compiler refuses to let one stand in for the other.

**Solution**

```csharp
record CreateLoanRequest(string Name, decimal Amount);
record UpdateLoanRequest(string Name, decimal Amount);

void Submit(CreateLoanRequest req) => Console.WriteLine($"Submitted {req.Name}");

Submit(new UpdateLoanRequest("Bob", 1));
// ❌ CS1503: cannot convert from 'UpdateLoanRequest' to 'CreateLoanRequest'
// Identical shape is irrelevant — only the declared type matters.
```

```csharp
interface IRiskChecker { int Score(decimal amount); }

class BasicRiskChecker            // no ': IRiskChecker'
{
    public int Score(decimal amount) => amount > 500_000 ? 80 : 20;
}

IRiskChecker checker = new BasicRiskChecker();
// ❌ CS0266: cannot implicitly convert 'BasicRiskChecker' to 'IRiskChecker'
// Fix: class BasicRiskChecker : IRiskChecker { ... } — the declaration IS the relationship.
```

```csharp
record CustomerId(int Value);
record AccountId(int Value);

void Charge(AccountId account) { }
Charge(new CustomerId(42));      // ❌ CS1503 — branded types, no hack required
```

**Talking point:** "TS asks *does it have the right shape?* C# asks *did you declare it as that thing?* The cost is mapping between look-alike DTOs; the payoff is that a `CustomerId` can never silently stand in for an `AccountId`."

## Exercise 2.4 — Nullability

1. Declare `string? middleName = null;` and try `middleName.Length`. What does the compiler tell you (warning, not error)?
2. Silence it three ways: a `??` fallback, an `is not null` check, and `?.`. Which reads best to you?

**Solution**

```csharp
string? middleName = null;
Console.WriteLine(middleName.Length);
// ⚠️ CS8602: Dereference of a possibly null reference — a warning; it still compiles.
// (Many teams turn on <WarningsAsErrors>nullable</WarningsAsErrors> to make it a hard stop.)

// Three fixes:
Console.WriteLine((middleName ?? "").Length);            // fallback
if (middleName is not null) Console.WriteLine(middleName.Length);  // narrowing — like a TS type guard
Console.WriteLine(middleName?.Length ?? 0);              // optional chaining
```

The `is not null` check *narrows* the type for the rest of the block, exactly like TS control-flow narrowing. Same mental model, same habits.
