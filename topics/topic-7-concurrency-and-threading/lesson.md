# Topic 7: Concurrency & Threading — a thread pool, not an event loop

## The one question this topic answers

> **What changes when my code can genuinely run on many threads at once — and when do I use `async/await` vs real threads?**

This is the biggest genuine difference from Node, so it's worth doing by hand. Node gives you **one thread** and an event loop: concurrency, never parallelism (without worker threads). The CLR schedules your code across a **pool of real threads**: CPU work genuinely runs on multiple cores at once, and after an `await`, your method may resume **on a different thread** than it started on.

**The one rule that matters (and the classic interview trap):**

- **I/O-bound work** (DB call, HTTP request, file read) → `async/await`. No extra thread needed; identical to Node.
- **CPU-bound work** (hashing, scoring, image processing) → `Task.Run` / `Parallel` to spread across threads.

Using `Task.Run` for I/O wastes a thread; using `await` alone for heavy CPU work still blocks that one thread. Knowing which is which is the whole game.

## The lab — read every comment, then run it

```bash
dotnet new console -n LoanThreading
cd LoanThreading
```

Full `Program.cs`:

```csharp
using System.Diagnostics;

// A batch of loan IDs to risk-check.
var loanIds = Enumerable.Range(1, 20).ToList();

// ---- A fake CPU-bound job (pretend this is heavy scoring) ----
int RiskScore(int loanId)
{
    // Busy-work to simulate real CPU cost (~50ms of actual computation).
    double x = 0;
    for (int i = 0; i < 5_000_000; i++) x += Math.Sqrt(i);
    return (loanId * 7) % 100;   // a pretend score 0–99
}

// ---- 1) Sequential: one after another (like a plain for-loop) ----
var sw = Stopwatch.StartNew();
foreach (var id in loanIds) RiskScore(id);
sw.Stop();
Console.WriteLine($"Sequential: {sw.ElapsedMilliseconds} ms");

// ---- 2) Parallel: spread the batch across CPU cores ----
sw.Restart();
Parallel.ForEach(loanIds, id => RiskScore(id));
sw.Stop();
Console.WriteLine($"Parallel:   {sw.ElapsedMilliseconds} ms  (faster on a multi-core machine)");

// ---- 3) The race condition (this is the bug to understand) ----
// Many threads doing 'count++' at once step on each other. count++ is
// really read-modify-write — not atomic — so updates get lost.
int buggyCount = 0;
Parallel.ForEach(loanIds, id =>
{
    var score = RiskScore(id);
    if (score > 50) buggyCount++;      // UNSAFE across threads
});
Console.WriteLine($"Buggy high-risk count: {buggyCount}  (may be wrong/varies each run)");

// ---- 4) Fix A: Interlocked = atomic increment (all-or-nothing) ----
int safeCount = 0;
Parallel.ForEach(loanIds, id =>
{
    var score = RiskScore(id);
    if (score > 50) Interlocked.Increment(ref safeCount);   // atomic, thread-safe
});
Console.WriteLine($"Safe high-risk count: {safeCount}  (correct every run)");

// ---- 5) Fix B: lock = a mutex for a bigger critical section ----
// A plain List<T> is NOT thread-safe, so guard writes with a lock.
var highRiskLoans = new List<int>();
var gate = new object();   // the lock object
Parallel.ForEach(loanIds, id =>
{
    var score = RiskScore(id);
    if (score > 50)
    {
        lock (gate)                  // only one thread inside at a time
        {
            highRiskLoans.Add(id);   // the protected critical section
        }
    }
});
Console.WriteLine($"High-risk loans collected: {highRiskLoans.Count}");

// ---- 6) I/O-bound work: await, DON'T use threads ----
async Task<int> FetchCreditScoreAsync(int loanId)
{
    await Task.Delay(200);           // pretend network call (no thread burned)
    return (loanId * 13) % 100;
}

var tasks = loanIds.Select(id => FetchCreditScoreAsync(id));  // start all
var scores = await Task.WhenAll(tasks);                        // await all at once
Console.WriteLine($"Fetched {scores.Length} credit scores concurrently (~200ms total, not 4s)");
```

Run it several times (`dotnet run`). Watch the **buggy count wobble between runs** while the safe count stays correct. That flakiness *is* a race condition — seeing it once makes the concept stick, because it's a bug class your Node code structurally could not have.

## New pieces in that file

- `Enumerable.Range(1, 20)` — `Array.from({length: 20}, (_, i) => i + 1)`.
- `Stopwatch` — `performance.now()` as an object: `StartNew()`, `Stop()`, `ElapsedMilliseconds`.
- `ref safeCount` — passes the variable itself *by reference*, so `Interlocked.Increment` mutates the caller's variable, not a copy. Needed because `int` is a value type (Topic 2). JS has no equivalent; primitives always copy.
- `lock (gate) { ... }` — a built-in mutex statement: one thread inside the block at a time, everyone else queues at the brace. The target is any shared object used as the key — by convention a dedicated `new object()`.

## What each tool is for

| Tool | Use it for | Your Node equivalent |
|---|---|---|
| `async/await` + `Task.WhenAll` | many **I/O** calls at once | `Promise.all` |
| `Task.Run(() => ...)` | push one **CPU** job to a background thread | worker threads (with far more ceremony) |
| `Parallel.ForEach` | **CPU** work over a collection, across cores | — |
| `Interlocked` | atomic counter updates | atomic operations |
| `lock` | protect a multi-step critical section | mutex |

💡 **Your edge:** `lock` and `Interlocked` are the same shared-state problem you already know from Postgres row locking/MVCC and Redis's single-threaded model — just at the language level. Say that in an interview and you sound senior, not new.

## The deadlock gotcha (name this if asked)

Never block on async with `.Result` or `.Wait()`:

```csharp
var score = FetchCreditScoreAsync(1).Result;    // ❌ can deadlock, freezes threads
var score = await FetchCreditScoreAsync(1);     // ✅ always
```

Rule of thumb: **async all the way down** — once one method is `async`, its callers should be too. (In Node this rule needs no enforcement: there's no `.Result` because there's no other thread to block.)

## Interview talking points

- Concurrency vs parallelism: Node has the former; .NET has both. `await` can resume on a different thread.
- The I/O vs CPU rule, stated crisply — it's the classic trap question.
- Race conditions: `count++` is read-modify-write; fixes are `Interlocked` (atomic op) or `lock` (critical section). Tie it to MVCC/Redis for the senior flourish.
- Never `.Result`/`.Wait()` — async all the way down.
