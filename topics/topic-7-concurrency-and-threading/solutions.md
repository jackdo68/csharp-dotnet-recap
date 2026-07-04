# Topic 7: Solutions

## 7.1 — Quantify the race

```csharp
for (int run = 1; run <= 10; run++)
{
    int buggyCount = 0;
    Parallel.ForEach(loanIds, id =>
    {
        var score = RiskScore(id);
        if (score > 50) buggyCount++;
    });
    Console.WriteLine($"Run {run}: {buggyCount}");
}
```

Typical output: mostly the correct value with occasional smaller numbers — different ones on different runs. (With only 20 items you may need more items, e.g. `Range(1, 500)`, to see it reliably.)

**The mechanics:** `buggyCount++` is three operations — *read* the value into a register, *add* one, *write* it back. When threads A and B both read `5`, both compute `6`, and both write `6`, one increment is lost forever. It's the same lost-update anomaly two uncoordinated `UPDATE ... SET n = n + 1`-without-locking transactions would produce — which is why databases give you atomic increments and row locks, and why C# gives you `Interlocked` and `lock`.

## 7.2 — Thread-safe totals

```csharp
int safeCount = 0;
int total = 0;
Parallel.ForEach(loanIds, id =>
{
    var score = RiskScore(id);
    if (score > 50)
    {
        Interlocked.Increment(ref safeCount);
        Interlocked.Add(ref total, score);
    }
});
Console.WriteLine($"High-risk: {safeCount}, total score: {total}");
```

Same numbers, every run. Note each `Interlocked` call is atomic *individually* — if you ever needed count-and-total to update as one indivisible unit, that's when you'd graduate to a `lock` block around both.

## 7.3 — Watch await hop threads

```csharp
async Task<int> FetchCreditScoreAsync(int loanId)
{
    Console.WriteLine($"loan {loanId} BEFORE await on thread {Environment.CurrentManagedThreadId}");
    await Task.Delay(200);
    Console.WriteLine($"loan {loanId} AFTER  await on thread {Environment.CurrentManagedThreadId}");
    return (loanId * 13) % 100;
}
```

Typical result: all 20 "before" lines on one thread (the starts are synchronous until the first await), and the "after" lines scattered across **several different thread IDs** — the continuations resume on whatever pool thread is free.

**Why Node can't show this:** there is only one thread. Every `await` continuation resumes on that same thread via the event loop — the question "which thread am I on now?" has exactly one answer. This is also why Node code never needs `lock`: mutations between awaits can't interleave *simultaneously*. (Precise version to say out loud: .NET *console apps* resume on any pool thread; classic UI frameworks capture a context and resume on the UI thread — that context capture is exactly what makes `.Result` deadlock-prone there.)

## 7.4 — Choose the right tool

1. **`Task.WhenAll`** — 50 network calls are I/O; start all, await all, zero extra threads. (`Promise.all`, verbatim.)
2. **`Parallel.ForEach`** — heavy math over a collection is the poster child for spreading across cores.
3. **`Interlocked.Increment`** — a single shared counter; atomic op beats a lock for one operation.
4. **`lock`** — `List<T>.Add` is not thread-safe and not atomic; a critical section is required (or use a `ConcurrentBag`/`ConcurrentQueue` — knowing `System.Collections.Concurrent` exists is a bonus point).
5. **`Task.Run`** — one CPU-heavy job pushed off the request path: `var pdf = await Task.Run(() => RenderPdf(loan));` frees the request thread while a pool thread grinds.

## 7.5 — Async all the way down

The healthy chain in `LoanApp`:

```
LoansController.GetAll()  : async Task<ActionResult<List<LoanApplication>>>  — await service
LoanService.GetAllAsync() : async Task<List<LoanApplication>>                — await EF
_db.LoanApplications.ToListAsync()                                           — true async I/O
```

Every link awaits; no link calls `.Result`/`.Wait()`.

If the service used `.Result`: you're courting **thread-pool starvation**. Each in-flight request now *parks a pool thread* doing nothing while SQLite/SQL Server works — under load, requests queue up faster than blocked threads free up, latency spikes, and the service tips over even though CPU is idle. (The classic hard deadlock needs a captured synchronization context — old ASP.NET, UI apps — but starvation alone is enough to page you at 3am.) The fix is never cleverness; it's `await`, all the way down.

---

**Course complete.** Re-read the five big differences in the [Guide](../../guide/) and say each one out loud with the example you just built. That's the interview prep.
