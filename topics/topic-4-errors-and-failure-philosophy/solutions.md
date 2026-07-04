# Topic 4: Solutions

## 4.1 — Parse vs TryParse

```csharp
// 1. Unhandled:
var n = int.Parse("300k");
// Unhandled exception. System.FormatException: The input string '300k' was not in a correct format.
//    at System.Number.ThrowFormatException[TChar](...)
//    at Program.<Main>$(String[] args) in .../Program.cs:line 2
// The trace points AT THE PARSE SITE — the cause, not a downstream symptom.

// 2. Catch only FormatException:
try { var amount = int.Parse("300k"); }
catch (FormatException) { Console.WriteLine("That's not a number — try again."); }

// 3. Try-pattern:
if (int.TryParse("300k", out var amount2))
    Console.WriteLine($"Got {amount2}");
else
    Console.WriteLine("Not a number — no exception, no try/catch.");
```

**When to choose:** user-typed input *failing is expected* → `TryParse`. A config value or DB column that should always be numeric *failing is exceptional* → `Parse`, and let the exception surface loudly. Contrast with TS: `parseInt("300k")` returns `300` (!) and `parseInt("abc")` returns `NaN` — both typed as `number`, both silent.

## 4.2 — The boundary enforcer

```csharp
using System.Text.Json;

record LoanRequest(string ApplicantName, decimal Amount);

// 1. Valid — works:
var good = JsonSerializer.Deserialize<LoanRequest>(
    """{"ApplicantName":"Alice","Amount":300000}""");
Console.WriteLine($"{good!.ApplicantName}: {good.Amount}");

// 2. Wrong shape:
var bad = JsonSerializer.Deserialize<LoanRequest>(
    """{"ApplicantName":"Alice","Amount":"lots"}""");
// System.Text.Json.JsonException:
//   The JSON value could not be converted to System.Decimal.
//   Path: $.Amount | LineNumber: 0 | BytePositionInLine: 33.
```

The exception names the **property** (`$.Amount`), the expected type, and the position — at the boundary, before the bad data touches your code. (The `"""..."""` is a *raw string literal* — no escaping quotes, like backticks without interpolation.)

**3. The TS version:** `const loan = await res.json() as LoanRequest` succeeds for both payloads. The bad one gives you `loan.Amount === "lots"` — a string wearing a `decimal`'s badge. You discover it later: maybe `loan.Amount * 1.05` → `NaN` in an interest calculation three modules away, maybe a corrupt DB row next week. The file in the stack trace is the *victim*, not the culprit. This is precisely the gap Zod fills — and here the deserializer just *is* Zod.

**4. Case sensitivity:** with default options the lowercase keys don't match, and (for a positional record) deserialization fails — or with a plain class you'd get defaults. ASP.NET Core's web defaults set `PropertyNameCaseInsensitive = true` (and emit camelCase), which is why controllers happily accept `{"applicantName": ...}` from JS clients. Worth knowing the friendliness lives in *options*, not the language.

## 4.3 — Soft vs throwing lookups

```csharp
// 1. Throwing versions:
loans.First();   // InvalidOperationException: Sequence contains no elements
byId[42];        // KeyNotFoundException: The given key '42' was not present.

// 2. Soft versions:
var first = loans.FirstOrDefault();
if (first is null) Console.WriteLine("No loans yet");

if (byId.TryGetValue(42, out var found))
    Console.WriteLine(found.ApplicantName);
else
    Console.WriteLine("No loan #42");
```

**3.** TS defaults to soft (`.find()` → `undefined`, `map["k"]` → `undefined`) and you opt into throwing by hand (`?? throw`, assertion functions). C# offers both but the *plain-looking* spelling (`First()`, `dict[k]`) throws — you opt into softness explicitly (`...OrDefault`, `Try...`). Each language's default reveals its philosophy.

## 4.4 — Catch by type

```csharp
using System.Text.Json;

void ProcessPayload(string json)
{
    var loan = JsonSerializer.Deserialize<LoanRequest>(json)
               ?? throw new ArgumentException("Payload was null");
    if (loan.Amount <= 0)
        throw new ArgumentException($"Amount must be positive, got {loan.Amount}");
    Console.WriteLine($"OK: {loan.ApplicantName} / {loan.Amount}");
}

string[] payloads =
[
    """{"ApplicantName":"Alice","Amount":300000}""",
    """{not json at all}""",
    """{"ApplicantName":"Mallory","Amount":-5}""",
];

foreach (var p in payloads)
{
    try
    {
        ProcessPayload(p);
    }
    catch (JsonException ex)          // malformed / mis-shaped payload
    {
        Console.WriteLine($"Rejected at the boundary: {ex.Message}");
    }
    catch (ArgumentException ex)      // valid shape, invalid business data
    {
        Console.WriteLine($"Validation failed: {ex.Message}");
    }
}
```

The runtime routes each failure to the right block by exception type — no `instanceof` ladder. In a real API (Topic 5) this same layering appears as: deserialization errors → automatic 400 from `[ApiController]`, business validation → your code's 4xx, unexpected exceptions → 500 from middleware.
