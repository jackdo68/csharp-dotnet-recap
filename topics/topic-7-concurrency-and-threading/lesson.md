# Topic 7: Concurrency & Threading — a thread pool, not an event loop

## The one question this topic answers

> **What changes when my code can genuinely run on many threads at once — and when do I use `async/await` vs real threads?**

This is the biggest genuine difference from Node, so it's worth doing by hand. Node gives you **one thread** and an event loop: concurrency, never parallelism (without worker threads). The CLR schedules your code across a **pool of real threads**: CPU work genuinely runs on multiple cores at once, and after an `await`, your method may resume **on a different thread** than it started on.

And it's not academic for this course: your `PaymentApp.TransferAsync` is a **read-check-modify on shared money**. Under one thread (Node) that's safe between awaits; under a thread pool it's a bug you already shipped. This topic makes you produce it, watch money vanish, and fix it — the exercises end back in the real API.

**The one rule that matters (and the classic interview trap):**

- **I/O-bound work** (DB call, HTTP request, file read) → `async/await`. No extra thread needed; identical to Node.
- **CPU-bound work** (hashing, scoring, image processing) → `Task.Run` / `Parallel` to spread across threads.

Using `Task.Run` for I/O wastes a thread; using `await` alone for heavy CPU work still blocks that one thread. Knowing which is which is the whole game.

## The lab — read every comment, then run it

A console sandbox first (races are easier to see without HTTP in the way):

```bash
dotnet new console -n PayThreading
cd PayThreading
```

Full `Program.cs`:

```csharp
using System.Diagnostics;

// A batch of payment IDs to fraud-check.
var paymentIds = Enumerable.Range(1, 20).ToList();

// ---- A fake CPU-bound job (pretend this is heavy scoring) ----
int FraudScore(int paymentId)
{
    // Busy-work to simulate real CPU cost (~50ms of actual computation).
    double x = 0;
    for (int i = 0; i < 5_000_000; i++) x += Math.Sqrt(i);
    return (paymentId * 7) % 100;   // a pretend score 0–99
}

// ---- 1) Sequential: one after another (like a plain for-loop) ----
var sw = Stopwatch.StartNew();
foreach (var id in paymentIds) FraudScore(id);
sw.Stop();
Console.WriteLine($"Sequential: {sw.ElapsedMilliseconds} ms");

// ---- 2) Parallel: spread the batch across CPU cores ----
sw.Restart();
Parallel.ForEach(paymentIds, id => FraudScore(id));
sw.Stop();
Console.WriteLine($"Parallel:   {sw.ElapsedMilliseconds} ms  (faster on a multi-core machine)");

// ---- 3) The race condition (this is the bug to understand) ----
// Many threads doing 'count++' at once step on each other. count++ is
// really read-modify-write — not atomic — so updates get lost.
int buggyFlagged = 0;
Parallel.ForEach(paymentIds, id =>
{
    var score = FraudScore(id);
    if (score > 50) buggyFlagged++;      // UNSAFE across threads
});
Console.WriteLine($"Buggy flagged count: {buggyFlagged}  (may be wrong/varies each run)");

// ---- 4) Fix A: Interlocked = atomic increment (all-or-nothing) ----
int safeFlagged = 0;
Parallel.ForEach(paymentIds, id =>
{
    var score = FraudScore(id);
    if (score > 50) Interlocked.Increment(ref safeFlagged);   // atomic, thread-safe
});
Console.WriteLine($"Safe flagged count: {safeFlagged}  (correct every run)");

// ---- 5) Fix B: lock = a mutex for a bigger critical section ----
// The SAME bug, but on money. decimal has NO Interlocked support —
// read-modify-write on a balance MUST be a critical section.
decimal buggyBalance = 0m;
decimal safeBalance = 0m;
var gate = new object();   // the lock object
Parallel.ForEach(Enumerable.Range(1, 500), _ =>
{
    buggyBalance += 10m;             // UNSAFE: loses deposits

    lock (gate)                      // only one thread inside at a time
    {
        safeBalance += 10m;          // the protected critical section
    }
});
Console.WriteLine($"Buggy balance: {buggyBalance}  (should be 5000, usually isn't)");
Console.WriteLine($"Safe balance:  {safeBalance}   (5000 every run)");

// ---- 6) I/O-bound work: await, DON'T use threads ----
async Task<decimal> FetchFxRateAsync(int paymentId)
{
    await Task.Delay(200);           // pretend network call (no thread burned)
    return 1.0m + (paymentId % 10) / 100m;
}

var tasks = paymentIds.Select(id => FetchFxRateAsync(id));    // start all
var rates = await Task.WhenAll(tasks);                        // await all at once
Console.WriteLine($"Fetched {rates.Length} FX rates concurrently (~200ms total, not 4s)");
```

Run it several times (`dotnet run`). Watch the **buggy numbers wobble between runs** while the safe ones stay correct. That flakiness *is* a race condition — seeing it once makes the concept stick, because it's a bug class your Node code structurally could not have. And section 5 is your `TransferAsync` in miniature: `balance += x` is the same read-modify-write as `payer.Balance -= amount`.

## New pieces in that file

- `Enumerable.Range(1, 20)` — `Array.from({length: 20}, (_, i) => i + 1)`.
- `Stopwatch` — `performance.now()` as an object: `StartNew()`, `Stop()`, `ElapsedMilliseconds`.
- `ref safeFlagged` — passes the variable itself *by reference*, so `Interlocked.Increment` mutates the caller's variable, not a copy. Needed because `int` is a value type (Topic 2). JS has no equivalent; primitives always copy.
- `lock (gate) { ... }` — a built-in mutex statement: one thread inside the block at a time, everyone else queues at the brace. The target is any shared object used as the key — by convention a dedicated `new object()`.
- **`Interlocked` only speaks `int`/`long`** — there is no `Interlocked.Add(ref decimal, ...)` overload. Money math can't be a lone atomic instruction; it needs a critical section. That's not a library gap, it's the nature of the type — and it's why section 5 exists.

## The async mutex — when the critical section contains `await`

`lock` has a hard limitation you hit the moment you guard *database* work:

```csharp
lock (gate)
{
    var payer = await _db.Accounts.FirstOrDefaultAsync(...);   // ❌ CS1996
}
// error CS1996: Cannot await in the body of a lock statement
```

The compiler refuses — an `await` can resume on a *different thread* (you'll prove this in exercise 7.3), and `lock` is thread-affine: the thread that takes it must release it. The async-compatible mutex is **`SemaphoreSlim(1, 1)`**:

```csharp
private static readonly SemaphoreSlim _transferGate = new(1, 1);   // 1 slot = a mutex

public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    await _transferGate.WaitAsync();       // async "lock" — waits without blocking a thread
    try
    {
        // read-check-modify, now genuinely one-at-a-time
    }
    finally
    {
        _transferGate.Release();           // ALWAYS release — hence try/finally
    }
}
```

Exercise 7.5 applies exactly this to `PaymentApp`. One honest caveat to carry with it: a `SemaphoreSlim` serializes transfers **within one process**. Run two replicas of the API (Topic 8's world) and each has its own gate — the race returns *between* processes. The production-grade answer lives where the shared state lives: the **database** — a transaction with row locking (`SELECT ... FOR UPDATE`, which your Postgres experience already knows) or optimistic concurrency tokens. The in-process gate is still worth having and still worth teaching: it's the same reasoning, one level up from `lock`.

## What each tool is for

| Tool | Use it for | Your Node equivalent |
|---|---|---|
| `async/await` + `Task.WhenAll` | many **I/O** calls at once | `Promise.all` |
| `Task.Run(() => ...)` | push one **CPU** job to a background thread | worker threads (with far more ceremony) |
| `Parallel.ForEach` | **CPU** work over a collection, across cores | — |
| `Interlocked` | atomic `int`/`long` counter updates | atomic operations |
| `lock` | protect a multi-step critical section (sync only) | mutex |
| `SemaphoreSlim(1,1)` | a critical section that contains `await` | mutex, again — Node never needed the distinction |

💡 **Your edge:** `lock` and `SemaphoreSlim` are the same shared-state problem you already know from Postgres row locking/MVCC and Redis's single-threaded model — just at the language level. Say that in an interview and you sound senior, not new.

## The deadlock gotcha (name this if asked)

Never block on async with `.Result` or `.Wait()`:

```csharp
var rate = FetchFxRateAsync(1).Result;    // ❌ can deadlock, freezes threads
var rate = await FetchFxRateAsync(1);     // ✅ always
```

Rule of thumb: **async all the way down** — once one method is `async`, its callers should be too. (In Node this rule needs no enforcement: there's no `.Result` because there's no other thread to block.)

## Interview talking points

- Concurrency vs parallelism: Node has the former; .NET has both. `await` can resume on a different thread.
- The I/O vs CPU rule, stated crisply — it's the classic trap question.
- Race conditions: `count++` and `balance += x` are read-modify-write; fixes are `Interlocked` (atomic op, ints only), `lock` (sync critical section), `SemaphoreSlim(1,1)` (async critical section — because `await` inside `lock` is CS1996, a compile error).
- In-process locks don't survive horizontal scaling; the durable fix for money is the database — transactions with row locks or concurrency tokens. Tie it to MVCC for the senior flourish.
- Never `.Result`/`.Wait()` — async all the way down.
