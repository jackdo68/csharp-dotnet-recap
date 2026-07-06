# Topic 7: Concurrency & Threading — a thread pool, not an event loop

## The one question this topic answers

> **What changes when my code can genuinely run on many threads at once — and when do I use `async/await` vs real threads?**

This is the biggest genuine difference from Node, so it's worth doing by hand. Node gives you **one thread** and an event loop: concurrency, never parallelism (without worker threads). The CLR schedules your code across a **pool of real threads**: CPU work genuinely runs on multiple cores at once, and after an `await`, your method may resume **on a different thread** than it started on.

And it's not academic — this topic touches `PaymentApp` in two places, one per half of the rule below:

- A new **`/v1/document/upload`** endpoint (verify a customer's KYC document): reading the file and storing it is I/O, but hashing and scanning it is **CPU-bound** — the poster child for real threads.
- Your existing **`TransferAsync`** is a **read-check-modify on shared money**. Under one thread (Node) that's safe between awaits; under a thread pool it's a bug you already shipped. This topic makes you produce it, watch money vanish, and fix it.

**The one rule that matters (and the classic interview trap):**

- **I/O-bound work** (DB call, HTTP request, reading the uploaded bytes) → `async/await`. No extra thread needed; identical to Node.
- **CPU-bound work** (hashing, scanning, fraud scoring, image processing) → `Task.Run` / `Parallel` to spread across threads.

Using `Task.Run` for I/O wastes a thread; using `await` alone for heavy CPU work still occupies that one thread. Knowing which is which is the whole game.

## CPU-bound work in the app: `/v1/document/upload`

A payment app verifies people — a user uploads a KYC document (a `.txt` for us). Reading the upload and writing it to disk is **I/O**; *scanning* its contents (hash for integrity, keyword/malware scan, later OCR) is **CPU-bound**. This is where real threads finally earn their keep, and where a Node reflex needs correcting. The full `DocumentService` + `DocumentController` are in Hands On; here's the essential shape.

`DocumentService.Scan` is the pure-CPU core — no awaits, it burns a core:

```csharp
public record ScanResult(string FileName, int Words, string Sha256, bool Flagged);

// CPU-BOUND: hash + scan the text.
public ScanResult Scan(string fileName, byte[] content)
{
    var hash = Convert.ToHexString(SHA256.HashData(content));
    var text = Encoding.UTF8.GetString(content);

    double signal = 0;                                   // pretend malware/OCR scan — real CPU cost
    for (int i = 0; i < 5_000_000; i++) signal += Math.Sqrt(i);

    var words = text.Split(default(char[]?), StringSplitOptions.RemoveEmptyEntries).Length;
    var flagged = text.Contains("fraud", StringComparison.OrdinalIgnoreCase);
    return new ScanResult(fileName, words, hash, flagged);
}
```

The endpoint wraps that CPU core in I/O — read the upload, **scan** it, then **store the `.txt` on disk and save its name on the user**:

```csharp
[HttpPost("upload")]                              // POST /v1/document/upload  (multipart/form-data)
public async Task<ActionResult<ScanResult>> Upload(int userId, IFormFile file)
{
    using var ms = new MemoryStream();
    await file.CopyToAsync(ms);                   // I/O: pull bytes off the wire (await — no thread burned)
    var bytes = ms.ToArray();

    var result = await Task.Run(() => _documents.Scan(file.FileName, bytes));   // CPU: on a pool thread
    await _documents.StoreAsync(userId, bytes);   // I/O: write to disk + set User.File + SaveChanges
    return Ok(result);
}
```

`DocumentService` is registered **scoped** (`AddScoped<DocumentService>()`) because it holds the scoped `DbContext` (Topic 5's lifetime rule). (Topic 9 makes this endpoint private and takes `userId` from the token instead of the query.)

**The Node reflex to unlearn.** In Node, CPU work in a handler blocks *the* event-loop thread, stalling every other request — so you offload to a `worker_thread` or a separate service. The instinct is "get CPU work off the loop." **There is no single loop here to block.** Every request already runs on its own thread-pool thread; one CPU-heavy request occupies one pool thread while others keep serving on the rest. So the honest nuance about that `Task.Run`:

- It does **not** add throughput or "unblock the server" the way it would in Node — there's nothing to unblock. It moves the CPU work from the request's pool thread to *another* pool thread and lets the first `await` back. On a pure API that's often a wash, and cargo-culting `Task.Run` around everything is a real anti-pattern.
- Where it genuinely pays off is a request that must stay responsive to *cancellation* or interleave other awaits while the CPU job runs — and, more importantly, the case below: **many** CPU jobs in one request.

**Where real threads actually win: a batch, across cores.** Upload ten pages and scan them at once — this is CPU work over a collection, the textbook case for `Parallel`:

```csharp
[HttpPost("upload-batch")]
public async Task<ActionResult<ScanResult[]>> UploadBatch(List<IFormFile> files)
{
    // Read all files (I/O) concurrently — Promise.all, verbatim.
    var contents = await Task.WhenAll(files.Select(async f =>
    {
        using var ms = new MemoryStream();
        await f.CopyToAsync(ms);
        return (f.FileName, Bytes: ms.ToArray());
    }));

    // Scan them (CPU) across every core at once — no Node equivalent without worker pools.
    var results = new ScanResult[contents.Length];
    Parallel.For(0, contents.Length, i =>
        results[i] = _documents.Scan(contents[i].FileName, contents[i].Bytes));

    return Ok(results);
}
```

On a multi-core machine, scanning eight documents takes ~one document's time, not eight. That is parallelism — genuinely impossible on Node's single thread, and the reason CPU work is the half of the rule that changes.

## The race condition — the same bug, now on money

Parallelism has a price: the moment two threads touch the *same* variable, you have a race. Watch a shared counter — "how many documents did we flag?":

```csharp
int flagged = 0;
Parallel.For(0, contents.Length, i =>
{
    if (_documents.Scan(contents[i].FileName, contents[i].Bytes).Flagged)
        flagged++;                 // ❌ UNSAFE across threads — loses increments
});
```

`flagged++` is three operations — *read*, *add one*, *write back*. Two threads read `5`, both compute `6`, both write `6`: one increment vanishes. The fixes, cheapest first:

```csharp
// Fix A: Interlocked — one atomic CPU instruction. Ints/longs only.
if (result.Flagged) Interlocked.Increment(ref flagged);

// Fix B: lock — a mutex for a bigger critical section (needed for anything Interlocked can't do).
var gate = new object();
lock (gate) { flagged++; }         // one thread inside the braces at a time
```

Now the same bug, on the thing that matters — **money**. Your `TransferAsync` from Topics 5–6:

```csharp
var payer = await _db.Users.FirstOrDefaultAsync(u => u.Id == payerUserId);  // READ  balance = 800
// ... an overlapping request reads 800 here too ...
if (payer.Balance < amount) ...                                              // CHECK stale 800
payer.Balance -= amount;                                                     // MODIFY: both compute 790
await _db.SaveChangesAsync();                                                // WRITE: both write 790 — one debit lost
```

`payer.Balance -= amount` is the exact `flagged++` read-modify-write, wearing your production code. Fifty overlapping transfers and money is created or destroyed. Two extra problems over the counter, though:

- **`Interlocked` can't help.** There is no `Interlocked.Add(ref decimal, ...)` — `Interlocked` only speaks the `int`/`long` sizes a CPU can swap in one instruction. A 128-bit `decimal` isn't one; money math *must* be a critical section, not a lone atomic op.
- **The critical section contains `await`** (`await _db...`) — and that, as the next section shows, is exactly where `lock` breaks.

You'll produce this race against the real endpoint in Hands On, then fix it with the async mutex below.

## Task vs Promise — where the analogy finally breaks

Topic 2 told you `Task<T>` = `Promise<T>`, and for daily code that's the right mental model. This topic's machinery is exactly where it stops being true. Four breaks, each with a practical consequence:

### 1. `async` is a compiler instruction, not part of the method's contract

In both languages, marking a function `async` makes the compiler rewrite it into a **state machine**: an object that remembers the local variables and *which await it's parked at*, with a resume method the runtime calls when the awaited thing finishes. (V8 does the same desugaring to JS async functions — this part is shared machinery.)

The consequence C# makes visible: callers only see the return type (`Task<string>`), so a method that merely *forwards* a task doesn't need the keyword at all:

```csharp
// With async: compiler builds a state machine just to unwrap and re-wrap the task
public async Task<ScanResult> ScanAsync(byte[] b) => await Task.Run(() => _documents.Scan("x", b));

// Without async ("elided"): same contract to callers, no state machine allocated —
// you hand back the inner Task itself and step out of the chain
public Task<ScanResult> ScanAsync(byte[] b) => Task.Run(() => _documents.Scan("x", b));
```

JS has the identical move (`return fetch(url)` vs `return await fetch(url)`), but in C# the difference is more than style — the state machine is a real allocation and real indirection, so pass-through elision is a genuine (micro-)optimization.

**The production-real caveat — when elision is a bug:** the keyword changes *when the rest of your method runs*. With `async`, a `finally`/`using` wrapping the await runs when the *work* completes; elided, it runs when the method *returns the Task* — which is immediately:

```csharp
public Task<string> FetchAsync()
{
    using var client = MakeClient();
    return client.GetStringAsync(_url);   // ❌ client is DISPOSED while the request is in flight
}
// the async version of the same method is correct — Dispose waits for the await
```

Guidance worth repeating in an interview: default to `async`/`await`; elide only when the body is literally one `return`, with no `using`, no `try`, no code after the call.

### 2. Awaiting something already finished doesn't yield — Promises always do

`await Promise.resolve(1)` *always* defers: the continuation goes to the microtask queue and runs on a later tick, even though the value is right there. `await` on an already-completed `Task` takes the **synchronous fast path**: no suspension, no scheduling, same thread, keep executing — the state machine checks `IsCompleted` first and only parks if it must. Where it matters: a method that usually hits a warm cache (`Task.FromResult(cached)`) costs essentially nothing per call in .NET, while the Node equivalent pays a microtask hop every time. Small per call; visible at hot-path scale — and occasionally surprising, because code you *thought* was asynchronous ran to completion before the caller's next line.

### 3. Who runs your next line: THE thread vs *a* thread

Underneath, the runtimes are more alike than the folklore suggests: both do I/O with the same OS machinery (epoll/kqueue/IOCP) — neither parks a thread per request. The fork is upstairs, at continuation time. In Node, completed I/O queues your continuation for the **one** thread — that's the event loop, and it's why `state.balance += x` between awaits needs no lock and why one CPU-heavy continuation starves every other request. In .NET, completed I/O hands your continuation to **whichever pool thread is free** — that's Hands On 7.3's hopping thread IDs, the reason `lock` can't contain `await` (CS1996), and the reason this topic's races exist at all. Same I/O layer, opposite concurrency contract.

### 4. `.Result` exists because there's another thread to block

You literally cannot block on a Promise — there's no second thread to do the waiting, so the language never grew the API. .NET has threads, so `Task` grew `.Result`/`.Wait()` — and with them the deadlock/starvation class below. A good interview line: "the footgun exists *because* the capability exists; Node avoided the bug by not having the machine."

The cheat sheet:

| | `Promise` | `Task` |
|---|---|---|
| Future value, chainable, awaitable | yes | yes |
| `async` keyword | implementation detail (state machine) | same — and elidable on pass-throughs |
| Await an already-settled one | always defers a microtask | synchronous fast path |
| Continuation runs on | the one thread, via the event loop | any thread-pool thread |
| Can carry CPU work on another core | never | yes — `Task.Run` |
| Blocking on it | impossible | possible (`.Result`) — and forbidden by convention |
| Cancellation | `AbortController`, bolted on | `CancellationToken`, threaded through every API |

## The async mutex — when the critical section contains `await`

`lock` has a hard limitation you hit the moment you guard *database* work — like the `TransferAsync` critical section above:

```csharp
lock (gate)
{
    var payer = await _db.Users.FirstOrDefaultAsync(...);   // ❌ CS1996
}
// error CS1996: Cannot await in the body of a lock statement
```

The compiler refuses — an `await` can resume on a *different thread* (you'll prove this in Hands On 7.3), and `lock` is thread-affine: the thread that takes it must release it. The async-compatible mutex is **`SemaphoreSlim(1, 1)`**:

```csharp
private static readonly SemaphoreSlim _transferGate = new(1, 1);   // 1 slot = a mutex

public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    await _transferGate.WaitAsync();       // async "lock" — waits without blocking a thread
    try
    {
        // read-check-modify on the two balances, now genuinely one-at-a-time
    }
    finally
    {
        _transferGate.Release();           // ALWAYS release — hence try/finally
    }
}
```

Hands On 7.5 applies exactly this to `PaymentApp`. One honest caveat to carry with it: a `SemaphoreSlim` serializes transfers **within one process**. Run two replicas of the API (Topic 8's world) and each has its own gate — the race returns *between* processes. The production-grade answer lives where the shared state lives: the **database** — a transaction with row locking (`SELECT ... FOR UPDATE`, which your Postgres experience already knows) or optimistic concurrency tokens. The in-process gate is still worth having and still worth teaching: it's the same reasoning, one level up from `lock`. (Topic 10 replaces it with per-user ordered locks plus the processor's atomic `UPDATE`.)

## What each tool is for

| Tool | Use it for | Your Node equivalent |
|---|---|---|
| `async/await` + `Task.WhenAll` | many **I/O** calls at once (read the uploaded files, hit the DB) | `Promise.all` |
| `Task.Run(() => ...)` | push one **CPU** job (a document scan) off the request thread | worker threads (with far more ceremony) |
| `Parallel.For` / `Parallel.ForEachAsync` | **CPU** work over a collection (a batch of documents), across cores | — |
| `Interlocked` | atomic `int`/`long` counter updates (flagged-doc count) | atomic operations |
| `lock` | protect a multi-step critical section (sync only) | mutex |
| `SemaphoreSlim(1,1)` | a critical section that contains `await` (the transfer) | mutex, again — Node never needed the distinction |

💡 **Your edge:** `lock` and `SemaphoreSlim` are the same shared-state problem you already know from Postgres row locking/MVCC and Redis's single-threaded model — just at the language level. Say that in an interview and you sound senior, not new.

## The deadlock gotcha (name this if asked)

Never block on async with `.Result` or `.Wait()`:

```csharp
var result = ScanAsync(bytes).Result;    // ❌ can deadlock, freezes threads
var result = await ScanAsync(bytes);     // ✅ always
```

Rule of thumb: **async all the way down** — once one method is `async`, its callers should be too. (In Node this rule needs no enforcement: there's no `.Result` because there's no other thread to block.)

## Interview talking points

- Concurrency vs parallelism: Node has the former; .NET has both. `await` can resume on a different thread.
- I/O vs CPU, stated crisply — the classic trap. Reading the upload is I/O (`await`); hashing/scanning it is CPU (`Task.Run` / `Parallel`). And the sharp correction: in ASP.NET there's no single event loop to "unblock," so `Task.Run` around CPU work doesn't add throughput the way offloading does in Node — real threads pay off when you parallelize a *batch* across cores.
- Task ≠ Promise where it counts: completed Tasks await synchronously (no forced microtask hop), continuations run on any pool thread, and `async` is an implementation detail — a pass-through method can return the Task directly and skip the state machine. Never elide around `using`/`try`, though: the cleanup would run while the work is still in flight.
- Both runtimes do I/O with the same OS machinery (epoll/kqueue/IOCP); the difference is who runs the continuation — the one event-loop thread vs any pool thread. Saying it this way shows you understand the layer *below* the folklore.
- Race conditions: `flagged++` and `balance += x` are read-modify-write; fixes are `Interlocked` (atomic op, ints only), `lock` (sync critical section), `SemaphoreSlim(1,1)` (async critical section — because `await` inside `lock` is CS1996, a compile error).
- In-process locks don't survive horizontal scaling; the durable fix for money is the database — transactions with row locks or concurrency tokens. Tie it to MVCC for the senior flourish.
- Never `.Result`/`.Wait()` — async all the way down.
