# Topic 4: Errors & Failure Philosophy — typed exceptions, not sentinels

## The one question this topic answers

> **When something goes wrong at runtime, what will I actually see in the logs — and how does it differ from a Node service?**

## Your compile-time experience carries over almost 1:1

Strict TS already catches what the C# compiler catches: typo'd property (`TS2551` ↔ `CS1061`), wrong argument type (`TS2345` ↔ `CS0029`), unhandled null (`TS2532` ↔ `CS8602`). The red squiggles feel identical. This topic is **not** about compile-time — you lose nothing there.

## The real difference: what happens when the types are wrong anyway

TS types are erased before the program runs (Topic 3), so they're a promise the runtime can't enforce — every `as`, `any`, `res.json()`, env var, and DB row is a spot where reality can diverge from the declared type. When it does, plain-JS behaviour takes over: `undefined` and `NaN` sentinels drifting through your code until something explodes far from the cause.

C# types are enforced *by the runtime*, so the lie gets caught **at the boundary**, as a typed exception naming the actual problem.

| The situation | TS + Node at runtime | C#/.NET at runtime |
|---|---|---|
| API JSON doesn't match your type | `res.json() as LoanResponse` — the compiler trusts you; the wrong shape drifts inward until `Cannot read properties of undefined` somewhere deep. This gap is the entire reason Zod exists | `JsonException` thrown at the deserialization boundary, naming the property — the deserializer is a built-in Zod |
| An escape hatch was wrong (`as` / `any`) | Nothing — the types are gone at runtime; sentinel errors surface later, elsewhere | A wrong cast throws `InvalidCastException` at the cast itself |
| `parseInt("abc")` | `NaN` — typed as `number`, compiles clean, silently poisons downstream math | `int.Parse` throws `FormatException` immediately (`int.TryParse` is the opt-in soft version) |
| Missing dictionary key | `record["missing"]` is typed `T` and returns `undefined` (unless you run `noUncheckedIndexedAccess`, which most codebases don't) | `dict["missing"]` throws `KeyNotFoundException` right there (`TryGetValue` is the soft version) |
| First match on an empty list | `.find()` honestly returns `T \| undefined` and strict mode forces the check — TS at its best | Your choice: `First()` throws, `FirstOrDefault()` returns `null` and the compiler nags you to check |
| Failed async work | `UnhandledPromiseRejection` if nothing awaited/caught it | `await` surfaces a typed exception (`TaskCanceledException`, `DbUpdateException`…); a fire-and-forget un-awaited `Task` can still vanish silently — same discipline needed |

## The exception vocabulary

The exceptions you'll actually meet, so log lines read as words, not noise:

- **`NullReferenceException`** — C#'s "cannot read properties of undefined". Still the #1 runtime error; the `string?` nullability system exists to squeeze it out.
- **`ArgumentNullException` / `ArgumentException`** — a guard clause caught bad input at a method boundary. Thrown *deliberately*, close to the cause. Idiom: `ArgumentNullException.ThrowIfNull(request);`
- **`InvalidOperationException`** — "you called this at the wrong time": `First()` on an empty sequence, mutating a collection mid-iteration.
- **`FormatException`**, **`InvalidCastException`**, **`KeyNotFoundException`**, **`JsonException`** — the boundary enforcers from the table above.
- **`TaskCanceledException` / `OperationCanceledException`** — async work cancelled or timed out.
- **`DbUpdateException`** — EF Core's constraint violation on save (Topic 6).

## try/catch — same shape, two upgrades

```csharp
try
{
    var loan = JsonSerializer.Deserialize<LoanApplication>(json);
}
catch (JsonException ex)                          // catch by TYPE — no 'if (e instanceof ...)'
{
    Console.WriteLine($"Bad payload: {ex.Message}");
}
catch (Exception ex) when (ex.Message.Contains("timeout"))   // 'when' filters — catch conditionally
{
    Console.WriteLine("Retryable");
}
```

Upgrade 1: **multiple catch blocks by exception type** — the runtime routes to the right one; no `instanceof` ladder inside a single catch. Upgrade 2: **`when` filters** for conditional catching.

## The Try-pattern and `out` parameters (new syntax)

The standard library's convention for "this might fail and that's normal" is a `bool` return plus an **`out` parameter** — a second return value written into a variable declared inline:

```csharp
if (int.TryParse(input, out var amount))
    Console.WriteLine($"Parsed {amount}");
else
    Console.WriteLine("Not a number — no exception thrown");
```

`out var amount` declares `amount` right in the call. TS has nothing like `out` (you'd return a tuple or `number | null`); it exists here for exactly this pattern. Pairs to know: `int.TryParse`/`int.Parse`, `dict.TryGetValue`/`dict[...]`, `FirstOrDefault`/`First`. **Expected failures → Try-pattern; exceptional failures → exceptions.** Choosing correctly is the everyday craft.

## Interview talking points

- "TS and C# give the same compile-time safety, but TS types are erased and trust-based while C#'s are enforced at runtime" — the one-liner.
- Zod/io-ts/class-validator exist because TS types vanish; the .NET deserializer, casts, and collections do that enforcement natively.
- Expected vs exceptional failure: Try-pattern vs exceptions — and name the pairs (`Parse`/`TryParse`, `First`/`FirstOrDefault`).
- `NullReferenceException` is still .NET's #1 runtime error; nullable reference types (`string?` + warnings) are the modern mitigation.
