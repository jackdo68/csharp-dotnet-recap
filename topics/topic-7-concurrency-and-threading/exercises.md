# Topic 7: Exercises

Type in the lesson's `LoanThreading` program first and run it a few times — you need to *see* the buggy count wobble before the exercises mean anything.

## Exercise 7.1 — Quantify the race

Wrap section 3 (the buggy count) in a `for` loop that runs it 10 times, printing each result. On your machine: how many of the 10 runs were wrong, and did the wrongness vary? Explain, in two sentences, *mechanically* what happens when two threads execute `buggyCount++` at the same moment.

## Exercise 7.2 — Thread-safe totals

Extend the safe version: alongside the high-risk **count**, compute the **total of all scores above 50** using `Interlocked.Add(ref total, score)`. Run it 5 times and confirm the total is identical every run — the proof your code is thread-safe.

## Exercise 7.3 — Watch await hop threads

1. Sprinkle `Console.WriteLine($"... on thread {Environment.CurrentManagedThreadId}")` before and after the `await Task.Delay(200)` inside `FetchCreditScoreAsync`, and run the `Task.WhenAll` section. Do the before/after thread IDs match? How many distinct thread IDs served your 20 "requests"?
2. In one sentence: why is this observation impossible to make in Node?

## Exercise 7.4 — Choose the right tool

For each scenario, name the tool (`await`/`Task.WhenAll`, `Task.Run`, `Parallel.ForEach`, `Interlocked`, `lock`) and justify in one line:

1. Call the credit-bureau API for 50 applicants and collect the results.
2. Recalculate risk scores (heavy math) for 10,000 loans in a nightly job.
3. Increment a shared "loans processed" counter from that nightly job's workers.
4. Append to a shared `List<string>` audit log from multiple threads.
5. One PDF render (CPU-heavy, ~2s) requested inside a web request, without freezing the request thread.

## Exercise 7.5 — Async all the way down

Take your Topic 5/6 `LoanApp`: find every `await` between the controller action and EF Core, and confirm the chain is unbroken (controller `async Task<ActionResult<…>>` → service `async Task<…>` → `ToListAsync`). Then answer: if the service called `_db.LoanApplications.ToListAsync().Result` instead, what *category* of production incident are you courting under load?
