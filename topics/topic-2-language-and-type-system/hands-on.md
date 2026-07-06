# Topic 2: Hands On

Work in the `PaymentBasics` console project from Topic 1 (or scaffold a fresh one). Type the Concepts page's `Program.cs` in first — these exercises extend it. Try each exercise before reading its solution.

## Exercise 2.1 — LINQ fluency

Using the `transfers` list from Concepts:

1. Print the sender (`From`) of the **largest** transfer.
2. Print all sender names joined with `", "` — but only transfers under $500, sorted by amount ascending.
3. Compute the **average** *completed* amount two ways: with the built-in LINQ method, and manually with `.Aggregate` (your `reduce`).

**Solution**

```csharp
// 1. Largest transfer
var biggest = transfers.OrderByDescending(t => t.Amount).First();
Console.WriteLine($"Biggest: {biggest.From} (${biggest.Amount})");

// 2. Under $500, ascending, joined
var small = transfers
    .Where(t => t.Amount < 500m)
    .OrderBy(t => t.Amount)
    .Select(t => t.From);
Console.WriteLine(string.Join(", ", small));   // Cara, Alice

// 3. Average completed — built-in, then Aggregate
var avg = transfers.Where(t => t.Status == "Completed").Average(t => t.Amount);

var completed = transfers.Where(t => t.Status == "Completed").ToList();
var avgManual = completed.Aggregate(0m, (acc, t) => acc + t.Amount) / completed.Count;

Console.WriteLine($"{avg} == {avgManual}");    // 225 == 225
```

Note `Aggregate(0m, ...)` — the seed must be `decimal` (`0m`), or the lambda won't type-check against `t.Amount`. Literal suffixes doing real work.

## Exercise 2.2 — Records vs classes

1. Create two `Money` records with identical values. Compare them with `==` and print the result. Then create two `Transfer` **class** instances with identical values and compare with `==`. Explain the difference in one sentence.
2. Use `with` to produce a copy of a `Money` in a different currency. Confirm the original is unchanged.
3. Try to mutate a record property (`money.Amount = 1m;`). What does the compiler say?

**Solution**

```csharp
var m1 = new Money(300m, "AUD");
var m2 = new Money(300m, "AUD");
Console.WriteLine(m1 == m2);   // True — records compare by VALUE

var t1 = new Transfer { From = "Alice", To = "Bob", Amount = 1m };
var t2 = new Transfer { From = "Alice", To = "Bob", Amount = 1m };
Console.WriteLine(t1 == t2);   // False — classes compare by REFERENCE (like JS objects)

var aud = new Money(300m, "AUD");
var usd = aud with { Currency = "USD" };
Console.WriteLine($"{aud.Currency} / {usd.Currency}");   // AUD / USD — original untouched
```

Mutating a positional-record property (`money.Amount = 1m;`) fails with **CS8852**: init-only — settable only during construction or in a `with` expression. Records are immutable by default; that's why they're the DTO tool — every request/response DTO in Topic 5 is a `record`.

## Exercise 2.3 — Feel the nominal typing

1. Declare two records with **identical shapes**: `record TransferRequest(string To, decimal Amount);` and `record RefundRequest(string To, decimal Amount);`. Write a method `void Submit(TransferRequest req)` and try to pass it a `RefundRequest`. Read the compiler error out loud — in TS this would be legal.
2. Declare `interface IRiskChecker { int Score(decimal amount); }` and a class `BasicRiskChecker` that has a matching `Score` method but does **not** declare `: IRiskChecker`. Try `IRiskChecker checker = new BasicRiskChecker();`. Then fix it by declaring the interface. This is the "explicit implementation" difference — TS would have accepted the shape match. (This is the same fraud-scoring idea Topic 7 makes CPU-bound.)
3. Make two branded IDs — `record UserId(int Value);` and `record PaymentId(int Value);` — and confirm the compiler refuses to let one stand in for the other. (In the app both are just `int`s — passing a payment id where a user id belongs is a real bug this makes impossible.)

**Solution**

```csharp
record TransferRequest(string To, decimal Amount);
record RefundRequest(string To, decimal Amount);

void Submit(TransferRequest req) => Console.WriteLine($"Transferring ${req.Amount} to {req.To}");

Submit(new RefundRequest("Bob", 1m));
// ❌ CS1503: cannot convert from 'RefundRequest' to 'TransferRequest'
// Identical shape is irrelevant — only the declared type matters.
```

```csharp
interface IRiskChecker { int Score(decimal amount); }

class BasicRiskChecker            // no ': IRiskChecker'
{
    public int Score(decimal amount) => amount > 10_000m ? 80 : 20;
}

IRiskChecker checker = new BasicRiskChecker();
// ❌ CS0266: cannot implicitly convert 'BasicRiskChecker' to 'IRiskChecker'
// Fix: class BasicRiskChecker : IRiskChecker { ... } — the declaration IS the relationship.
```

```csharp
record UserId(int Value);
record PaymentId(int Value);

void Refund(PaymentId payment) { }
Refund(new UserId(42));           // ❌ CS1503 — branded types, no hack required
```

**Talking point:** "TS asks *does it have the right shape?* C# asks *did you declare it as that thing?* The cost is mapping between look-alike DTOs; the payoff is that a `UserId` can never silently stand in for a `PaymentId`."

## Exercise 2.4 — Nullability

1. Declare `string? memo = null;` (a transfer's optional memo) and try `memo.Length`. What does the compiler tell you (warning, not error)?
2. Silence it three ways: a `??` fallback, an `is not null` check, and `?.`. Which reads best to you?

**Solution**

```csharp
string? memo = null;
Console.WriteLine(memo.Length);
// ⚠️ CS8602: Dereference of a possibly null reference — a warning; it still compiles.
// (Many teams turn on <WarningsAsErrors>nullable</WarningsAsErrors> to make it a hard stop.)

// Three fixes:
Console.WriteLine((memo ?? "").Length);            // fallback
if (memo is not null) Console.WriteLine(memo.Length);  // narrowing — like a TS type guard
Console.WriteLine(memo?.Length ?? 0);              // optional chaining
```

The `is not null` check *narrows* the type for the rest of the block, exactly like TS control-flow narrowing. Same mental model, same habits.
