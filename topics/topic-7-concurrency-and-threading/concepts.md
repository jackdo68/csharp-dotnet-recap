# Topic 7: Concurrency & Threading

> **What changes when my code can genuinely run on many threads at once?**

This topic explains why .NET's threading model is fundamentally different from Node's. You'll learn how to write correct concurrent code.

---

## The core difference

| Node | .NET |
|------|------|
| One thread + event loop | Thread pool (many threads) |
| Concurrency only | Concurrency + parallelism |
| CPU work blocks everything | CPU work runs on multiple cores |
| After `await`, same thread resumes | After `await`, **any** thread may resume |

**What "concurrency vs parallelism" means:**

| Term | Definition | Example |
|------|------------|---------|
| **Concurrency** | Multiple tasks in progress (interleaved on one core) | Node handling 1000 HTTP requests |
| **Parallelism** | Multiple tasks running simultaneously (on multiple cores) | .NET scanning 8 documents across 8 cores |

Node has concurrency (many tasks, one thread). .NET has both (many tasks, many threads).

---

## The thread pool: how it actually works

**No, it doesn't spawn a new thread per request.**

| Aspect | How it works |
|--------|--------------|
| Pool size | Starts at ~1 thread per core. Grows on demand. |
| Reuse | Threads are **reused**. Finished request → thread returns to pool. |
| Max threads | Default ~32,767. In practice, OS/memory limits hit first. |
| Growth rate | Adds ~1-2 threads/second when pool is exhausted (slow on purpose). |
| Shrink | Idle threads retire after ~15–20 seconds. |

**Why threads are reused:** Each thread costs ~1MB of memory (for its stack). Creating/destroying threads is expensive. The pool amortizes this cost.

**During `await`:** The thread returns to the pool. No thread is held while waiting for I/O. This is the same trick Node uses — just with many threads instead of one.

### Thread pool vs event loop — trade-offs

| | Node (event loop) | .NET (thread pool) |
|-|-------------------|-------------------|
| **Memory per connection** | ~tens of KB | ~1MB per thread |
| **Max concurrent requests** | Very high (limited by memory) | Limited by thread pool size |
| **CPU-bound work** | Blocks everything | Runs on other threads |
| **Context switching** | None (one thread) | Yes (OS switches threads) |
| **Best for** | Many I/O-bound connections | Mixed I/O + CPU workloads |

:::caution
If all threads are blocked (`.Result` calls or slow sync code), the pool is exhausted. Requests queue up. Timeouts follow.
:::

---

## The one rule (interview favorite)

| Work type | Examples | Use | Why |
|-----------|----------|-----|-----|
| **I/O-bound** | DB call, HTTP request, file read | `async/await` | No thread needed — same as Node |
| **CPU-bound** | Hashing, scanning, image processing | `Task.Run` / `Parallel` | Spread across cores |

**Common mistakes:**

| Mistake | Why it's wrong |
|---------|----------------|
| `Task.Run` for I/O | Wastes a thread — the work is waiting, not computing |
| `await` alone for heavy CPU | Blocks that thread — no parallelism |

---

## PaymentApp example: `/v1/document/upload`

A user uploads a document. The endpoint does three things:

| Step | Type | Tool |
|------|------|------|
| Read uploaded bytes | I/O | `await file.CopyToAsync()` |
| Hash + scan content | CPU | `Task.Run(() => Scan(...))` |
| Write to disk | I/O | `await File.WriteAllBytesAsync()` |

**The CPU-bound scan** (no awaits — burns a core):

```csharp
public ScanResult Scan(string fileName, byte[] content)
{
    var hash = Convert.ToHexString(SHA256.HashData(content));
    var text = Encoding.UTF8.GetString(content);
    // CPU-heavy work: word count, malware detection, etc.
    var words = text.Split(default(char[]?), StringSplitOptions.RemoveEmptyEntries).Length;
    var flagged = text.Contains("fraud", StringComparison.OrdinalIgnoreCase);
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

    var result = await Task.Run(() => _service.Scan(file.FileName, bytes));  // CPU: Task.Run
    await _service.StoreAsync(userId, bytes);     // I/O: await
    return Ok(result);
}
```

### Node reflex to unlearn

| | TypeScript/Node | C# |
|---|----------------|-----|
| `await` on I/O | OS does it, event loop waits | OS does it, thread released |
| `await` on CPU work | No other thread exists | `Task.Run` → another pool thread |

In Node, CPU work blocks *the* event loop — you must offload to `worker_threads`.

In .NET:
- Each request runs on a pool thread (not *the* thread)
- One CPU-heavy request doesn't block others
- `Task.Run` doesn't "unblock the server" — it just moves work to another pool thread

**When `Task.Run` actually helps:** batches across cores.

```csharp
// Scan 8 documents across all cores — takes ~1 document's time, not 8
var results = new ScanResult[8];
Parallel.For(0, 8, i =>
    results[i] = _service.Scan(files[i].Name, files[i].Bytes));
```

This is true parallelism — impossible on Node's single thread.

---

## Race conditions

Two threads touching the same variable cause a **race condition**.

**The bug:** `counter++` is actually three operations:

```
Thread A: read 5 → add 1 → write 6
Thread B: read 5 → add 1 → write 6  ← both wrote 6, one increment lost
```

This is called **read-modify-write** — the most common source of race conditions.

### The money bug (why this matters)

The transfer endpoint has the same bug:

```csharp
var payer = await _db.Users.FirstOrDefaultAsync(...);  // READ  balance = 800
// ... another request ALSO reads 800 here ...
if (payer.Balance < amount) ...                         // CHECK stale 800
payer.Balance -= amount;                                // MODIFY: both compute 790
await _db.SaveChangesAsync();                           // WRITE: both write 790
                                                        // ❌ One $10 debit lost!
```

Same bug as `counter++` — read-modify-write without coordination.

:::danger
You can print money.
:::

---

## The three fixes

| Fix | Use when | Works with `await`? |
|-----|----------|---------------------|
| `Interlocked` | Single `int`/`long` operation | N/A (no critical section) |
| `lock` | Multi-step critical section | ❌ No — compiler error CS1996 |
| `SemaphoreSlim` | Critical section with `await` | ✅ Yes |

### 1. `Interlocked` — atomic operations

For single `int`/`long` operations only:

```csharp
int counter = 0;

// ❌ Race condition
counter++;

// ✅ Atomic — no race
Interlocked.Increment(ref counter);
```

**Limitation:** Only works on `int`/`long`. No `decimal` support — **money needs `lock` or `SemaphoreSlim`**.

### 2. `lock` — sync critical section

For multi-step operations **without** `await`:

```csharp
private readonly object _gate = new();

public void AddToTotal(decimal amount)
{
    lock (_gate)
    {
        // Only one thread at a time in here
        _total += amount;
        _count++;
    }
}
```

**Real-world uses:**

| Use case | Example |
|----------|---------|
| In-memory cache | `lock (_cache) { _cache[key] = value; }` |
| Lazy initialization | `lock (_gate) { _instance ??= new Service(); }` |
| Accumulating results | `lock (_results) { _results.Add(item); }` |
| Thread-safe counters | When you need multiple operations (read + check + update) |

:::caution
`lock` can't contain `await` — compiler error CS1996. After `await`, a different thread may resume. But `lock` must be released by the same thread that acquired it.
:::

### 3. `SemaphoreSlim` — async critical section

For critical sections **with** `await`:

```csharp
private static readonly SemaphoreSlim _gate = new(1, 1);
//                                               │  └── max count (max threads that can ever hold it)
//                                               └───── initial count (available slots at start)
```

| Constructor | Meaning |
|-------------|---------|
| `new(1, 1)` | Mutex — only 1 thread at a time |
| `new(3, 3)` | Allow up to 3 concurrent threads |
| `new(0, 1)` | Start locked — first `WaitAsync` blocks until someone calls `Release` |

```csharp
public async Task TransferAsync(...)
{
    await _gate.WaitAsync();   // async "lock"
    try
    {
        var payer = await _db.Users.FirstOrDefaultAsync(...);
        // ... safe to read-check-modify here ...
        await _db.SaveChangesAsync();
    }
    finally
    {
        _gate.Release();       // ALWAYS release in finally
    }
}
```

**Real-world uses:**

| Use case | Why `SemaphoreSlim` | Example |
|----------|---------------------|---------|
| DB transactions | Contains `await _db.SaveChangesAsync()` | `new(1, 1)` — one write at a time |
| Rate limiting | Limit concurrent API calls | `new(5, 5)` — max 5 in flight |
| Resource pooling | Limit concurrent connections | `new(10, 10)` — 10 connections |
| File access | Async file I/O | `new(1, 1)` — one writer at a time |

**The rule:**
- Has `await` inside? → `SemaphoreSlim`
- No `await`? → `lock` (simpler, slightly faster)

:::note
`SemaphoreSlim` only works **within one process**. With multiple API replicas, each one has its own gate, so the race returns. The production fix is database row locks (`SELECT ... FOR UPDATE`) or optimistic concurrency — Topic 10 covers this.
:::

---

## Task vs Promise — where the analogy breaks

Topic 2 said `Task<T>` ≈ `Promise<T>`. That's true for daily code. Here's where it stops being true:

| Behavior | Promise | Task |
|----------|---------|------|
| Await already-resolved value | Always defers (microtask queue) | **Synchronous** — no hop, keeps running |
| Continuation runs on | The one event-loop thread | **Any** pool thread |
| Blocking on it | Impossible — no other thread | Possible (`.Result`) — but don't |
| CPU work on another core | Never (without workers) | Yes — `Task.Run` |
| Cancellation | `AbortController` (bolted on) | `CancellationToken` (built in) |

### What is a state machine?

When you write `async`, the compiler transforms your method into a **state machine** — a class that tracks where to resume after each `await`.

```csharp
public async Task<string> GetDataAsync()
{
    var user = await _db.GetUserAsync();     // pause point 1
    var orders = await _db.GetOrdersAsync(); // pause point 2
    return $"{user.Name}: {orders.Count}";
}
```

**What the compiler generates (simplified):**

```csharp
class GetDataAsyncStateMachine
{
    int _state = 0;          // which pause point are we at?
    User _user;              // local variables survive across pauses

    void MoveNext()
    {
        switch (_state)
        {
            case 0:  // start → pause point 1
                _state = 1;
                _db.GetUserAsync()...  // schedule continuation
                return;
            case 1:  // pause point 1 → pause point 2
                _user = result;
                _state = 2;
                _db.GetOrdersAsync()...
                return;
            case 2:  // done
                SetResult($"{_user.Name}: ...");
                return;
        }
    }
}
```

Each `await` = a pause point. The state machine remembers where you were and resumes there when the Task completes.

### `async` is elidable

Pass-through methods can skip the keyword — avoids state machine overhead:

```csharp
// With async: builds a state machine (unnecessary)
public async Task<T> GetAsync() => await _inner.GetAsync();

// Without async: no state machine — just returns the Task directly
public Task<T> GetAsync() => _inner.GetAsync();
```

**But never elide around `using`/`try`:**

```csharp
public Task<string> FetchAsync()
{
    using var client = MakeClient();
    return client.GetStringAsync(_url);  // ❌ client disposed while request in flight
}
```

### Same I/O layer, different continuation model

Both use the same OS async I/O (epoll/kqueue/IOCP). The difference is *who runs your next line*:

| | Node | .NET |
|-|------|------|
| After `await` resumes on | The one event-loop thread | Any free pool thread |

This is why `lock` can't contain `await` (CS1996) — the thread that took the lock may not be the thread that releases it.

---

## The golden rule: async all the way down

Once one method is `async`, callers should be too.

### What are `.Result` and `.Wait()`?

These are **blocking** methods on `Task` — they don't exist in TypeScript/JavaScript because there's no way to block the single thread.

| Method | On | Does |
|--------|-----|------|
| `.Result` | `Task<T>` | Blocks until complete, returns `T` |
| `.Wait()` | `Task` | Blocks until complete, returns nothing |
| `.GetAwaiter().GetResult()` | Both | Same as above, but doesn't wrap exceptions in `AggregateException` |

```csharp
// These three do the same thing — block the current thread
var user = _db.GetUserAsync().Result;
var user = _db.GetUserAsync().GetAwaiter().GetResult();
_db.SaveChangesAsync().Wait();
```

**How it works:** Your thread stops and waits. Meanwhile, another thread pool thread completes the async operation. When it's done, your thread wakes up and continues.

This is impossible in Node — there's no "another thread" to do the work.

### Why you should almost never use them

```csharp
// ❌ BAD — blocks a thread, can deadlock
public User GetUser()
{
    return _db.GetUserAsync().Result;  // DON'T DO THIS
}

// ✅ GOOD — async all the way
public async Task<User> GetUserAsync()
{
    return await _db.GetUserAsync();
}
```

**Why `.Result` / `.Wait()` is dangerous:**

| Problem | What happens |
|---------|--------------|
| Thread blocked | Pool thread sits waiting instead of doing other work |
| Deadlock risk | In some contexts, the continuation needs the blocked thread → deadlock |
| Pool exhaustion | Many blocked threads → no threads left → requests queue up |

**In TypeScript, blocking is impossible** — there's no other thread to do the work while you block. `.Result` only exists because C# has multiple threads.

**When `.Result` is acceptable (rare):**

| Context | Why it's OK |
|---------|-------------|
| `Main()` before .NET 6 | `Main` couldn't be async (now it can) |
| Console app one-off scripts | No thread pool to exhaust |
| Test setup/teardown | Some test frameworks need sync methods |

**The pattern:**

```
Controller (async) → Service (async) → Repository (async) → DbContext (async)
     ↓                    ↓                   ↓                    ↓
  await               await               await                await
```

---

## Tool cheat sheet

| Tool | Use for | Node equivalent |
|------|---------|-----------------|
| `async/await` + `Task.WhenAll` | Many I/O calls at once | `Promise.all` |
| `Task.Run(() => ...)` | One CPU job off request thread | `worker_threads` |
| `Parallel.For` | CPU work over a collection, across cores | — (no equivalent) |
| `Interlocked` | Atomic `int`/`long` updates | — |
| `lock` | Sync critical section | mutex |
| `SemaphoreSlim(1,1)` | Async critical section (with `await`) | mutex |

---

## Recap

- **Thread pool:** Not a new thread per request. Pool starts at ~1 per core, reuses threads. During `await`, thread returns to pool.
- **Concurrency vs parallelism:** Node has concurrency; .NET has both. `await` can resume on a different thread.
- **I/O vs CPU rule:** Reading files = I/O (`await`). Hashing/scanning = CPU (`Task.Run`/`Parallel`).
- **The nuance:** In ASP.NET there's no event loop to "unblock" — `Task.Run` doesn't add throughput. It pays off when parallelizing a *batch* across cores.
- **State machine:** `async` makes the compiler generate a state machine to track pause points. Eliding `async` on pass-through methods avoids this overhead — but never elide around `using`/`try`.
- **Task ≠ Promise:** Completed Tasks await synchronously (no microtask hop). Continuations run on any pool thread.
- **Under the hood:** Both runtimes use the same OS async I/O (epoll/kqueue/IOCP). The difference is who runs the continuation: one thread (Node) vs any pool thread (.NET).
- **Race fixes:** `Interlocked` (ints), `lock` (sync), `SemaphoreSlim` (async). `await` inside `lock` = CS1996.
- **Scaling caveat:** In-process locks don't survive multiple replicas. Production fix: database row locks or optimistic concurrency.
- **Golden rule:** Never `.Result`/`.Wait()` — async all the way down. Blocks thread, risks deadlock, exhausts pool.
