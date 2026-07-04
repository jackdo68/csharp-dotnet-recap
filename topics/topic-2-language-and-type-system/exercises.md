# Topic 2: Exercises

Work in the `LoanBasics` console project from Topic 1 (or scaffold a fresh one). Type the lesson's `Program.cs` in first — these exercises extend it.

## Exercise 2.1 — LINQ fluency

Using the `apps` list from the lesson:

1. Print the applicant with the **largest** loan amount.
2. Print all applicant names joined with `", "` — but only those with amounts under $500k, sorted by amount ascending.
3. Compute the **average** approved amount two ways: with the built-in LINQ method, and manually with `.Aggregate` (your `reduce`).

## Exercise 2.2 — Records vs classes

1. Create two `Money` records with identical values. Compare them with `==` and print the result. Then create two `LoanApplication` **class** instances with identical values and compare with `==`. Explain the difference in one sentence.
2. Use `with` to produce a copy of a `Money` in a different currency. Confirm the original is unchanged.
3. Try to mutate a record property (`money.Amount = 1;`). What does the compiler say?

## Exercise 2.3 — Feel the nominal typing

1. Declare two records with **identical shapes**: `record CreateLoanRequest(string Name, decimal Amount);` and `record UpdateLoanRequest(string Name, decimal Amount);`. Write a method `void Submit(CreateLoanRequest req)` and try to pass it an `UpdateLoanRequest`. Read the compiler error out loud — in TS this would be legal.
2. Declare `interface IRiskChecker { int Score(decimal amount); }` and a class `BasicRiskChecker` that has a matching `Score` method but does **not** declare `: IRiskChecker`. Try `IRiskChecker checker = new BasicRiskChecker();`. Then fix it by declaring the interface. This is the "explicit implementation" difference — TS would have accepted the shape match.
3. Make two branded IDs — `record CustomerId(int Value);` and `record AccountId(int Value);` — and confirm the compiler refuses to let one stand in for the other.

## Exercise 2.4 — Nullability

1. Declare `string? middleName = null;` and try `middleName.Length`. What does the compiler tell you (warning, not error)?
2. Silence it three ways: a `??` fallback, an `is not null` check, and `?.`. Which reads best to you?
