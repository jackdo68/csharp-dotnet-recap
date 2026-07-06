# Topic 3: Hands On

Create a fresh console app `PaymentReflection` for these (`dotnet new console -n PaymentReflection`). Reuse the `Transfer` class and `Money` record from Topic 2. Try each exercise before reading its solution.

## Exercise 3.1 — Find the IL

1. Build the project (don't run it) and locate the compiled output.
2. Run the `.dll` directly: `dotnet bin/Debug/net10.0/PaymentReflection.dll`. Convince yourself the `.dll` *is* the program.
3. In one sentence: why can this same `.dll` run on a Windows machine?

**Solution**

```bash
dotnet build
ls bin/Debug/net10.0/          # PaymentReflection.dll + launcher
dotnet bin/Debug/net10.0/PaymentReflection.dll
```

Why it runs on Windows too: the `.dll` contains **IL, not machine code**. Each platform's CLR JIT-compiles the same IL to that machine's native code — portability lives one level below your program, exactly like the same `.js` file running in any V8.

## Exercise 3.2 — A model inspector

Write a method `void Inspect(Type t)` that prints a type's name and each property as `Name: TypeName`. Call it with `typeof(Transfer)` and `typeof(Money)`.

Then answer: how would you get this information in TypeScript at runtime? (Trick question — reason out why you can't.)

**Solution**

```csharp
void Inspect(Type t)
{
    Console.WriteLine($"== {t.Name} ==");
    foreach (var p in t.GetProperties())
        Console.WriteLine($"  {p.Name}: {p.PropertyType.Name}");
}

Inspect(typeof(Transfer));
Inspect(typeof(Money));
```

Output:

```
== Transfer ==
  From: String
  To: String
  Amount: Decimal
  Status: String
== Money ==
  Amount: Decimal
  Currency: String
```

**In TypeScript you can't** — not "it's hard", it's structurally impossible: the property *types* are erased by `tsc` and never exist at runtime. `Object.keys()` can list assigned keys of an instance, but the declared types are gone. Every TS workaround (Zod schemas, `reflect-metadata` decorators, codegen) is a way of *re-stating* the types in a form that survives to runtime. C# never loses them.

## Exercise 3.3 — Reified generics

1. Write a generic method `T MakeDefault<T>() where T : new()` that prints `typeof(T).Name` and returns a `new T()`. Call it for both your types. (`where T : new()` is a *generic constraint* — "T must have a parameterless constructor". TS has no equivalent because TS generics can't construct anything.)
2. Predict, then verify: what does `typeof(List<int>) == typeof(List<string>)` print? What would the "equivalent" TS question even be?

**Solution**

```csharp
T MakeDefault<T>() where T : new()
{
    Console.WriteLine($"T is {typeof(T).Name}");
    return new T();
}

var transfer = MakeDefault<Transfer>();   // "T is Transfer"
```

(`Money` has no parameterless constructor — positional records get a constructor requiring all values — so `MakeDefault<Money>()` fails the `new()` constraint at **compile time**. A generic constraint doing real work; if you hit this, nice catch.)

```csharp
Console.WriteLine(typeof(List<int>) == typeof(List<string>));   // False
```

`List<int>` and `List<string>` are two **distinct runtime types** — generics are reified. The TS equivalent question doesn't exist: at runtime both are just `Array`, because the type arguments were erased.

**Talking point:** "C# generics are reified, TS and Java generics are erased" — one sentence, senior signal.

## Exercise 3.4 — Runtime type tests

Fill a `List<object>` with a mixed bag: a `Transfer`, a `Money`, a `string`, an `int`. Loop over it and use `is` pattern matching to print a different line per type, including one property access on your own types (e.g. the transfer's amount). No casts, no `as`, no exceptions.

**Solution**

```csharp
var mixed = new List<object>
{
    new Transfer { From = "Alice", To = "Bob", Amount = 300m },
    new Money(500, "AUD"),
    "just a string",
    42,
};

foreach (var item in mixed)
{
    if (item is Transfer transfer)
        Console.WriteLine($"Transfer from {transfer.From}: ${transfer.Amount}");
    else if (item is Money money)
        Console.WriteLine($"Money: {money.Amount} {money.Currency}");
    else if (item is string s)
        Console.WriteLine($"String of length {s.Length}");
    else if (item is int n)
        Console.WriteLine($"Int: {n}");
}
```

`item is Transfer transfer` is a **real runtime type test** plus narrowing in one expression — the CLR checks the object's actual type metadata. The TS analogue (`instanceof` or a hand-written type-guard predicate) either only works for classes or is an unverified promise; here the runtime itself is the judge.
