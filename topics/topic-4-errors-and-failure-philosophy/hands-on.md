# Topic 4: Hands On

Create a console app `PaymentErrors` (`dotnet new console -n PaymentErrors`). You'll need `using System.Text.Json;` for 4.2. Try each exercise before reading its solution.

## Exercise 4.1 — Parse vs TryParse

1. Call `int.Parse("300k")` with no try/catch and run it. Read the output: what exception type, and does the stack trace point at the parse site or somewhere downstream?
2. Wrap it in a try/catch that catches **only** `FormatException` and prints a friendly message.
3. Rewrite with `int.TryParse` and no try/catch at all. When would you choose each? (Think: user-typed form input vs a value that should always be valid.)

**Solution**

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

## Exercise 4.2 — The boundary enforcer (this is the big one)

You receive transfer JSON from an "API". Define `record TransferRequest(string To, decimal Amount);` — a DTO shape like the one Topic 5's `/v1/payment/transfer` endpoint binds.

1. Deserialize a **valid** payload: `{"To":"Bob","Amount":300}` and print the result.
2. Deserialize a **wrong-shaped** payload: `{"To":"Bob","Amount":"lots"}`. What exception, and what does its message tell you about *where* the mismatch is?
3. Now write out what your TS service would have done with the same two payloads and `as TransferRequest` — at what point would you have discovered the problem, and in which file?
4. Bonus: deserialize `{"to":"bob","amount":1}` (lowercase keys). What happens, and which `JsonSerializerOptions` setting explains web-API behaviour?

**Solution**

```csharp
using System.Text.Json;

record TransferRequest(string To, decimal Amount);

// 1. Valid — works:
var good = JsonSerializer.Deserialize<TransferRequest>(
    """{"To":"Bob","Amount":300}""");
Console.WriteLine($"{good!.To}: {good.Amount}");

// 2. Wrong shape:
var bad = JsonSerializer.Deserialize<TransferRequest>(
    """{"To":"Bob","Amount":"lots"}""");
// System.Text.Json.JsonException:
//   The JSON value could not be converted to System.Decimal.
//   Path: $.Amount | LineNumber: 0 | BytePositionInLine: 26.
```

The exception names the **property** (`$.Amount`), the expected type, and the position — at the boundary, before the bad data touches your code. (The `"""..."""` is a *raw string literal* — no escaping quotes, like backticks without interpolation.)

**3. The TS version:** `const transfer = await res.json() as TransferRequest` succeeds for both payloads. The bad one gives you `transfer.Amount === "lots"` — a string wearing a `decimal`'s badge. You discover it later: maybe `transfer.Amount * 1.01` → `NaN` in a fee calculation three modules away, maybe a corrupt DB row next week. The file in the stack trace is the *victim*, not the culprit. This is precisely the gap Zod fills — and here the deserializer just *is* Zod.

**4. Case sensitivity:** with default options the lowercase keys don't match, and (for a positional record) deserialization fails — or with a plain class you'd get defaults. ASP.NET Core's web defaults set `PropertyNameCaseInsensitive = true` (and emit camelCase), which is why controllers happily accept `{"to": ...}` from JS clients. Worth knowing the friendliness lives in *options*, not the language.

## Exercise 4.3 — Soft vs throwing lookups

Build `var transfers = new List<TransferRequest>();` (empty) and `var byId = new Dictionary<int, TransferRequest>();` (empty).

1. Trigger the throwing version of each lookup: `transfers.First()` and `byId[42]`. Note both exception types.
2. Rewrite both with the soft versions (`FirstOrDefault`, `TryGetValue`) and handle the miss.
3. One sentence: which behaviour is the TS default, and what do you have to opt into in each language to get the other?

**Solution**

```csharp
// 1. Throwing versions:
transfers.First();   // InvalidOperationException: Sequence contains no elements
byId[42];            // KeyNotFoundException: The given key '42' was not present.

// 2. Soft versions:
var first = transfers.FirstOrDefault();
if (first is null) Console.WriteLine("No transfers yet");

if (byId.TryGetValue(42, out var found))
    Console.WriteLine(found.To);
else
    Console.WriteLine("No transfer #42");
```

**3.** TS defaults to soft (`.find()` → `undefined`, `map["k"]` → `undefined`) and you opt into throwing by hand (`?? throw`, assertion functions). C# offers both but the *plain-looking* spelling (`First()`, `dict[k]`) throws — you opt into softness explicitly (`...OrDefault`, `Try...`). Each language's default reveals its philosophy.

## Exercise 4.4 — Catch by type

Write a method `ProcessPayload(string json)` that deserializes a `TransferRequest` and then validates `Amount > 0` (throw `ArgumentException` if not). Call it with three payloads — valid, malformed JSON, negative amount — and route each failure to a **different** catch block by exception type, no `if`/`instanceof` inside.

**Solution**

```csharp
using System.Text.Json;

void ProcessPayload(string json)
{
    var transfer = JsonSerializer.Deserialize<TransferRequest>(json)
                   ?? throw new ArgumentException("Payload was null");
    if (transfer.Amount <= 0)
        throw new ArgumentException($"Amount must be positive, got {transfer.Amount}");
    Console.WriteLine($"OK: {transfer.To} / {transfer.Amount}");
}

string[] payloads =
[
    """{"To":"Bob","Amount":300}""",
    """{not json at all}""",
    """{"To":"Bob","Amount":-5}""",       // Mallory tries a negative transfer to pull money
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
