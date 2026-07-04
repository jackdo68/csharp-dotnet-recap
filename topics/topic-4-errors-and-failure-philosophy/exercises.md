# Topic 4: Exercises

Create a console app `LoanErrors` (`dotnet new console -n LoanErrors`). You'll need `using System.Text.Json;` for 4.2.

## Exercise 4.1 — Parse vs TryParse

1. Call `int.Parse("300k")` with no try/catch and run it. Read the output: what exception type, and does the stack trace point at the parse site or somewhere downstream?
2. Wrap it in a try/catch that catches **only** `FormatException` and prints a friendly message.
3. Rewrite with `int.TryParse` and no try/catch at all. When would you choose each? (Think: user-typed form input vs a value that should always be valid.)

## Exercise 4.2 — The boundary enforcer (this is the big one)

You receive loan JSON from an "API". Define `record LoanRequest(string ApplicantName, decimal Amount);`

1. Deserialize a **valid** payload: `{"ApplicantName":"Alice","Amount":300000}` and print the result.
2. Deserialize a **wrong-shaped** payload: `{"ApplicantName":"Alice","Amount":"lots"}`. What exception, and what does its message tell you about *where* the mismatch is?
3. Now write out what your TS service would have done with the same two payloads and `as LoanRequest` — at what point would you have discovered the problem, and in which file?
4. Bonus: deserialize `{"applicantName":"alice","amount":1}` (lowercase keys). What happens, and which `JsonSerializerOptions` setting explains web-API behaviour?

## Exercise 4.3 — Soft vs throwing lookups

Build `var loans = new List<LoanRequest>();` (empty) and `var byId = new Dictionary<int, LoanRequest>();` (empty).

1. Trigger the throwing version of each lookup: `loans.First()` and `byId[42]`. Note both exception types.
2. Rewrite both with the soft versions (`FirstOrDefault`, `TryGetValue`) and handle the miss.
3. One sentence: which behaviour is the TS default, and what do you have to opt into in each language to get the other?

## Exercise 4.4 — Catch by type

Write a method `ProcessPayload(string json)` that deserializes a `LoanRequest` and then validates `Amount > 0` (throw `ArgumentException` if not). Call it with three payloads — valid, malformed JSON, negative amount — and route each failure to a **different** catch block by exception type, no `if`/`instanceof` inside.
