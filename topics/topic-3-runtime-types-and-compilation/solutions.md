# Topic 3: Solutions

## 3.1 — Find the IL

```bash
dotnet build
ls bin/Debug/net10.0/          # LoanReflection.dll + launcher
dotnet bin/Debug/net10.0/LoanReflection.dll
```

Why it runs on Windows too: the `.dll` contains **IL, not machine code**. Each platform's CLR JIT-compiles the same IL to that machine's native code — portability lives one level below your program, exactly like the same `.js` file running in any V8.

## 3.2 — A model inspector

```csharp
void Inspect(Type t)
{
    Console.WriteLine($"== {t.Name} ==");
    foreach (var p in t.GetProperties())
        Console.WriteLine($"  {p.Name}: {p.PropertyType.Name}");
}

Inspect(typeof(LoanApplication));
Inspect(typeof(Money));
```

Output:

```
== LoanApplication ==
  ApplicantName: String
  Amount: Decimal
  Status: String
== Money ==
  Amount: Decimal
  Currency: String
```

**In TypeScript you can't** — not "it's hard", it's structurally impossible: the property *types* are erased by `tsc` and never exist at runtime. `Object.keys()` can list assigned keys of an instance, but the declared types are gone. Every TS workaround (Zod schemas, `reflect-metadata` decorators, codegen) is a way of *re-stating* the types in a form that survives to runtime. C# never loses them.

## 3.3 — Reified generics

```csharp
T MakeDefault<T>() where T : new()
{
    Console.WriteLine($"T is {typeof(T).Name}");
    return new T();
}

var loan = MakeDefault<LoanApplication>();   // "T is LoanApplication"
```

(`Money` has no parameterless constructor — positional records get a constructor requiring all values — so `MakeDefault<Money>()` fails the `new()` constraint at **compile time**. A generic constraint doing real work; if you hit this, nice catch.)

```csharp
Console.WriteLine(typeof(List<int>) == typeof(List<string>));   // False
```

`List<int>` and `List<string>` are two **distinct runtime types** — generics are reified. The TS equivalent question doesn't exist: at runtime both are just `Array`, because the type arguments were erased.

**Talking point:** "C# generics are reified, TS and Java generics are erased" — one sentence, senior signal.

## 3.4 — Runtime type tests

```csharp
var mixed = new List<object>
{
    new LoanApplication { ApplicantName = "Alice", Amount = 300_000 },
    new Money(500, "AUD"),
    "just a string",
    42,
};

foreach (var item in mixed)
{
    if (item is LoanApplication loan)
        Console.WriteLine($"Loan for {loan.ApplicantName}: ${loan.Amount}");
    else if (item is Money money)
        Console.WriteLine($"Money: {money.Amount} {money.Currency}");
    else if (item is string s)
        Console.WriteLine($"String of length {s.Length}");
    else if (item is int n)
        Console.WriteLine($"Int: {n}");
}
```

`item is LoanApplication loan` is a **real runtime type test** plus narrowing in one expression — the CLR checks the object's actual type metadata. The TS analogue (`instanceof` or a hand-written type-guard predicate) either only works for classes or is an unverified promise; here the runtime itself is the judge.
