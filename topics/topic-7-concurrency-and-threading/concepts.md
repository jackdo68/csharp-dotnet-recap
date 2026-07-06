# Topic 7: Concurrency & Threading

> **What changes when my code can genuinely run on many threads at once?**

## The core difference

| Node | .NET |
|------|------|
| One thread + event loop | Thread pool (many threads) |
| Concurrency only | Concurrency + parallelism |
| CPU work blocks everything | CPU work runs on multiple cores |
| After `await`, same thread resumes | After `await`, **any** thread may resume |

## The one rule (interview favorite)

| Work type | Examples | Use | Why |
|-----------|----------|-----|-----|
| **I/O-bound** | DB call, HTTP request, file read | `async/await` | No thread needed — same as Node |
| **CPU-bound** | Hashing, scanning, image processing | `Task.Run` / `Parallel` | Spread across cores |

**Common mistakes:**
- `Task.Run` for I/O → wastes a thread
- `await` alone for heavy CPU → blocks that thread

## PaymentApp example: `/v1/document/upload`

A user uploads a KYC document (a `.txt` for us):

| Step | Type | Tool |
|------|------|------|
| Read uploaded bytes | I/O | `await file.CopyToAsync()` |
| Hash + scan content | CPU | `Task.Run(() => Scan(...))` |
| Write to disk | I/O | `await StoreAsync()` |

**The CPU-bound scan** (no awaits — burns a core):

```csharp
public ScanResult Scan(string fileName, byte[] content)
{
    var hash = Convert.ToHexString(SHA256.HashData(content));
    var text = Encoding.UTF8.GetString(content);
    // ... CPU-heavy work ...
    return new ScanResult(fileName, words, hash, flagged);
}
```

**The endpoint** (mixes I/O and CPU correctly):

```csharp
[HttpPost("upload")]
public async Task<ActionResult<ScanResult>> Upload(int userId, IFormFile file)
{
    using var ms = new MemoryStream();
    await file.CopyToAsync(ms);                   // I/O: await
    var bytes = ms.ToArray();

    var result = await Task.Run(() => _documents.Scan(file.FileName, bytes));  // CPU: Task.Run
    await _documents.StoreAsync(userId, bytes);   // I/O: await
    return Ok(result);
}
```

### Node reflex to unlearn

In Node, CPU work blocks *the* event loop — you must offload to `worker_threads`.

In .NET:
- Each request runs on a pool thread (not *the* thread)
- One CPU-heavy request doesn't block others
- `Task.Run` doesn't "unblock the server" — it just moves work to another pool thread

### How the thread pool actually works

**No, it doesn't spawn a new thread per request.**

| Aspect | How it works |
|--------|--------------|
| Pool size | Starts at ~1 thread per core. Grows on demand. |
| Reuse | Threads are **reused**. Finished request → thread returns to pool. |
| Max threads | Default ~32,767. In practice, OS/memory limits hit first. |
| Growth rate | Adds ~1-2 threads/second when pool is exhausted (slow on purpose). |
| Shrink | Idle threads retire after ~15–20 seconds. |

**The key insight:** Threads are expensive to create (~1MB stack each). The pool avoids this by **reusing** them.

### Thread pool vs event loop — trade-offs

| | Node (event loop) | .NET (thread pool) |
|-|-------------------|-------------------|
| **Memory per connection** | ~tens of KB | ~1MB per thread |
| **Max concurrent requests** | Very high (limited by memory) | Limited by thread pool size |
| **CPU-bound work** | Blocks everything | Runs on other threads |
| **Context switching** | None (one thread) | Yes (OS switches threads) |
| **Best for** | Many I/O-bound connections | Mixed I/O + CPU workloads |

**Why .NET can still handle thousands of requests:**
- During `await`, the thread returns to the pool (no thread held during I/O)
- Only requests actively executing code hold a thread
- Same trick as Node — just with many threads instead of one

⚠️ **The danger:** If all threads are blocked (e.g., `.Result` calls or slow sync code), the pool is exhausted → requests queue up → timeouts.

**When `Task.Run` actually helps:** batches across cores.

```csharp
// Scan 8 documents across all cores — takes ~1 document's time, not 8
Parallel.For(0, contents.Length, i =>
    results[i] = _documents.Scan(contents[i].FileName, contents[i].Bytes));
```

This is true parallelism — impossible on Node's single thread.

## Race conditions

Two threads touching the same variable = race condition.

**The bug:** `flagged++` is actually three operations:

```
Thread A: read 5 → add 1 → write 6
Thread B: read 5 → add 1 → write 6  ← both wrote 6, one increment lost
```

**The fixes:**

| Fix | Use when | Example |
|-----|----------|---------|
| `Interlocked` | Single `int`/`long` operation | `Interlocked.Increment(ref flagged)` |
| `lock` | Multi-step critical section (sync only) | `lock (gate) { ... }` |
| `SemaphoreSlim` | Critical section with `await` | See below |

### The money bug

Your `TransferAsync` has the same problem:

```csharp
var payer = await _db.Users.FirstOrDefaultAsync(...);  // READ  balance = 800
// ... another request reads 800 here too ...
if (payer.Balance < amount) ...                         // CHECK stale 800
payer.Balance -= amount;                                // MODIFY: both compute 790
await _db.SaveChangesAsync();                           // WRITE: both write 790 — one debit lost
```

**Why simple fixes don't work:**
- `Interlocked` — only works on `int`/`long`, not `decimal`
- `lock` — can't contain `await` (compiler error CS1996)

## Task vs Promise — where the analogy breaks

Topic 2 said `Task<T>` ≈ `Promise<T>`. That's true for daily code. Here's where it stops being true:

| Behavior | Promise | Task |
|----------|---------|------|
| Await already-resolved value | Always defers (microtask queue) | **Synchronous** — no hop, keeps running |
| Continuation runs on | The one event-loop thread | **Any** pool thread |
| Blocking on it | Impossible — no other thread | Possible (`.Result`) — but don't |
| CPU work on another core | Never (without workers) | Yes — `Task.Run` |
| Cancellation | `AbortController` (bolted on) | `CancellationToken` (built in) |

### Key implications

**1. `async` is elidable** — pass-through methods can skip the keyword:

```csharp
// With async: builds a state machine
public async Task<T> GetAsync() => await _inner.GetAsync();

// Without async: same contract, no state machine
public Task<T> GetAsync() => _inner.GetAsync();
```

⚠️ **But never elide around `using`/`try`:**

```csharp
public Task<string> FetchAsync()
{
    using var client = MakeClient();
    return client.GetStringAsync(_url);  // ❌ client disposed while request in flight
}
```

**2. Same I/O layer, different continuation model**

Both use the same OS async I/O (epoll/kqueue/IOCP). The difference is *who runs your next line*:
- Node: the one event-loop thread
- .NET: any free pool thread

This is why `lock` can't contain `await` (CS1996) — thread that took the lock may not be the thread that releases it.

## The async mutex: `SemaphoreSlim`

`lock` can't contain `await` (CS1996). The fix: `SemaphoreSlim(1, 1)`.

```csharp
private static readonly SemaphoreSlim _transferGate = new(1, 1);  // 1 slot = mutex

public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    await _transferGate.WaitAsync();   // async "lock"
    try
    {
        // read-check-modify — now one-at-a-time
    }
    finally
    {
        _transferGate.Release();       // ALWAYS release
    }
}
```

| Sync | Async |
|------|-------|
| `lock (gate) { ... }` | `await _gate.WaitAsync(); try { ... } finally { _gate.Release(); }` |

⚠️ **Limitation:** `SemaphoreSlim` only works **within one process**. Multiple API replicas = each has its own gate = race returns. Production fix: database row locks (`SELECT ... FOR UPDATE`) or optimistic concurrency.

## Tool cheat sheet

| Tool | Use for | Node equivalent |
|------|---------|-----------------|
| `async/await` + `Task.WhenAll` | Many I/O calls at once | `Promise.all` |
| `Task.Run(() => ...)` | One CPU job off request thread | `worker_threads` |
| `Parallel.For` | CPU work over a collection, across cores | — (no equivalent) |
| `Interlocked` | Atomic `int`/`long` updates | — |
| `lock` | Sync critical section | mutex |
| `SemaphoreSlim(1,1)` | Async critical section (with `await`) | mutex |

## The deadlock rule

Never use `.Result` or `.Wait()`:

```csharp
var result = ScanAsync(bytes).Result;  // ❌ can deadlock
var result = await ScanAsync(bytes);   // ✅ always
```

**Rule:** async all the way down. Once one method is `async`, its callers should be too.

## Interview talking points

- **Thread pool:** Not a new thread per request. Pool starts at ~1 per core, reuses threads. During `await`, thread returns to pool.
- **Concurrency vs parallelism:** Node has concurrency; .NET has both. `await` can resume on a different thread.
- **I/O vs CPU rule:** Reading files = I/O (`await`). Hashing/scanning = CPU (`Task.Run`/`Parallel`).
- **The nuance:** In ASP.NET there's no event loop to "unblock" — `Task.Run` doesn't add throughput. It pays off when parallelizing a *batch* across cores.
- **Task ≠ Promise:**
  - Completed Tasks await synchronously (no microtask hop)
  - Continuations run on any pool thread
  - `async` is elidable — but never around `using`/`try`
- **Under the hood:** Both runtimes use the same OS async I/O (epoll/kqueue/IOCP). The difference is who runs the continuation: one thread (Node) vs any pool thread (.NET).
- **Race fixes:** `Interlocked` (ints), `lock` (sync), `SemaphoreSlim` (async). `await` inside `lock` = CS1996.
- **Scaling caveat:** In-process locks don't survive multiple replicas. Production fix: database row locks or optimistic concurrency.
- **Golden rule:** Never `.Result`/`.Wait()` — async all the way down.
