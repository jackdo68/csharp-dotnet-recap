# Topic 3: Exercises

Create a fresh console app `LoanReflection` for these (`dotnet new console -n LoanReflection`). Reuse the `LoanApplication` class and `Money` record from Topic 2.

## Exercise 3.1 — Find the IL

1. Build the project (don't run it) and locate the compiled output.
2. Run the `.dll` directly: `dotnet bin/Debug/net10.0/LoanReflection.dll`. Convince yourself the `.dll` *is* the program.
3. In one sentence: why can this same `.dll` run on a Windows machine?

## Exercise 3.2 — A model inspector

Write a method `void Inspect(Type t)` that prints a type's name and each property as `Name: TypeName`. Call it with `typeof(LoanApplication)` and `typeof(Money)`.

Then answer: how would you get this information in TypeScript at runtime? (Trick question — reason out why you can't.)

## Exercise 3.3 — Reified generics

1. Write a generic method `T MakeDefault<T>() where T : new()` that prints `typeof(T).Name` and returns a `new T()`. Call it for both your types. (`where T : new()` is a *generic constraint* — "T must have a parameterless constructor". TS has no equivalent because TS generics can't construct anything.)
2. Predict, then verify: what does `typeof(List<int>) == typeof(List<string>)` print? What would the "equivalent" TS question even be?

## Exercise 3.4 — Runtime type tests

Fill a `List<object>` with a mixed bag: a `LoanApplication`, a `Money`, a `string`, an `int`. Loop over it and use `is` pattern matching to print a different line per type, including one property access on your own types (e.g. the loan's amount). No casts, no `as`, no exceptions.
