# Topic 7: Hands On

> **The PaymentApp build:** Topic 5 the API, straight onto Postgres → Topic 6 EF unpacked + tests → **Topic 7 (you are here): a CPU-bound `/v1/document/upload`, then produce the transfer race in the real API — and fix it** → Topic 8 Docker & ship → Topic 9 register, login, lock down → Topic 10 the pipeline & the payment processor.

Build the document feature (7.0), drill the threading mechanics on it (7.1–7.4), then rob your own bank on `TransferAsync` (7.5). Try each exercise before reading its solution.

## Exercise 7.0 — Build the document feature

Add the CPU-bound `.txt` upload to `PaymentApp`. Full code:

**`Services/DocumentService.cs`** — a pure-CPU `Scan` plus the I/O that persists the file:

```csharp
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Data;

namespace PaymentApp.Services;

public record ScanResult(string FileName, int Words, string Sha256, bool Flagged);

public class DocumentService
{
    private readonly PaymentDbContext _db;
    private readonly string _dir = Path.Combine(AppContext.BaseDirectory, "uploads");

    public DocumentService(PaymentDbContext db)
    {
        _db = db;
        Directory.CreateDirectory(_dir);
    }

    // CPU-BOUND: hash + scan the text. No awaits — this burns a core.
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

    // I/O-BOUND: store the .txt on disk and record its name on the user.
    public async Task StoreAsync(int userId, byte[] content)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId)
            ?? throw new KeyNotFoundException($"No user {userId}.");

        var stored = $"{userId}_{Guid.NewGuid():N}.txt";
        await File.WriteAllBytesAsync(Path.Combine(_dir, stored), content);   // System.IO.File
        user.File = stored;                                                   // the User.File column
        await _db.SaveChangesAsync();
    }
}
```

**`Controllers/DocumentController.cs`**:

```csharp
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Services;

namespace PaymentApp.Controllers;

[ApiController]
[Route("v1/document")]
public class DocumentController : ControllerBase
{
    private readonly DocumentService _documents;
    public DocumentController(DocumentService documents) => _documents = documents;

    [HttpPost("upload")]                              // POST /v1/document/upload  (multipart/form-data)
    public async Task<ActionResult<ScanResult>> Upload(int userId, IFormFile file)
    {
        if (Path.GetExtension(file.FileName).ToLowerInvariant() != ".txt")
            return BadRequest(new { error = "Only .txt files are accepted." });

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);                                     // I/O: bytes off the wire
        var bytes = ms.ToArray();

        var result = await Task.Run(() => _documents.Scan(file.FileName, bytes));  // CPU on a pool thread
        try { await _documents.StoreAsync(userId, bytes); }                        // I/O: disk + User.File
        catch (KeyNotFoundException ex) { return NotFound(new { error = ex.Message }); }
        return Ok(result);
    }
}
```

Register it in `Program.cs` — **scoped**, because it holds the scoped `DbContext`: `builder.Services.AddScoped<DocumentService>();`. Then upload a file (Topic 9 makes this private and takes `userId` from the token):

```bash
printf 'alice statement: no fraud here' > kyc.txt
curl -X POST "http://localhost:PORT/v1/document/upload?userId=1" -F "file=@kyc.txt"
# {"fileName":"kyc.txt","words":5,"sha256":"...","flagged":true}
docker compose exec db psql -U payapp -d payapp -c 'SELECT "Id","File" FROM "Users" WHERE "Id"=1;'
#  Id |            File
#  ---+---------------------------------
#   1 | 1_9af3....txt   ← filename saved; the bytes are on disk under uploads/
```

(`flagged` is `true` because the text contains "fraud". A non-`.txt` upload returns **400**; `userId=999` returns **404**.)

## Exercise 7.1 — See the scan race

**Goal:** Watch `count++` lose increments under `Parallel.For`.

**Steps:**
1. Create 500 synthetic `.txt` documents
2. Use `Parallel.For` with plain `count++` inside
3. Run 10 times, print each count

**Solution**

```csharp
using System.Text;
using PaymentApp.Services;

var scanner = new DocumentService(db);          // Scan doesn't touch the db
var docs = Enumerable.Range(1, 500)
    .Select(i => (Name: $"doc{i}.txt", Bytes: Encoding.UTF8.GetBytes($"user {i} statement clean")))
    .ToList();

for (int run = 1; run <= 10; run++)
{
    int processed = 0;
    Parallel.For(0, docs.Count, i =>
    {
        scanner.Scan(docs[i].Name, docs[i].Bytes);
        processed++;                     // ❌ UNSAFE — read-modify-write across threads
    });
    Console.WriteLine($"Run {run}: {processed} / 500");
}
```

**Expected output:**
```
Run 1: 500 / 500
Run 2: 498 / 500   ← lost 2
Run 3: 500 / 500
Run 4: 497 / 500   ← lost 3
...
```

Mostly 500, but occasional smaller numbers — different each run. That flakiness *is* the race.

**Why it happens:**

| Step | Thread A | Thread B |
|------|----------|----------|
| 1 | Read `processed` = 40 | Read `processed` = 40 |
| 2 | Compute 40 + 1 = 41 | Compute 40 + 1 = 41 |
| 3 | Write 41 | Write 41 |
| Result | **One increment lost** | |

`count++` = read + add + write (3 operations). Two threads can interleave → lost update. Same bug as `UPDATE SET n = n + 1` without locking.

## Exercise 7.2 — Thread-safe totals (and why `decimal` is different)

**Goal:** Learn that `Interlocked` doesn't work for `decimal` — you need `lock`.

**Steps:**
1. Extend 7.1 to also track:
   - `totalWords` (long)
   - `totalScore` (decimal) = `words * 0.5m`
2. Try `Interlocked.Add(ref totalScore, score)` — read the compiler error
3. Fix with `lock`, run 5 times, confirm identical results

**Solution**

**Step 2 — the error:**
```
CS1503: cannot convert 'ref decimal' to 'ref int' (or 'ref long')
```

`Interlocked` only works on types the CPU can swap atomically (32/64 bits). `decimal` is 128 bits → no atomic op → **must use `lock`**.

**Step 3 — the fix:**

```csharp
int processed = 0;
long totalWords = 0;
decimal totalScore = 0m;
var gate = new object();

Parallel.For(0, docs.Count, i =>
{
    var r = scanner.Scan(docs[i].Name, docs[i].Bytes);
    Interlocked.Increment(ref processed);           // int: atomic op
    Interlocked.Add(ref totalWords, r.Words);       // long: atomic op
    lock (gate) { totalScore += r.Words * 0.5m; }   // decimal: lock required
});
Console.WriteLine($"{processed} docs, {totalWords} words, score {totalScore}");
```

Same numbers every run. Use the **cheapest sufficient tool**:

| Type | Tool | Why |
|------|------|-----|
| `int`, `long` | `Interlocked` | CPU can swap in one instruction |
| `decimal` | `lock` | 128 bits, no atomic op exists |

**Key insight:** This is why `TransferAsync` (7.5) can't use `Interlocked` — money is `decimal`.

## Exercise 7.3 — Watch await hop threads

**Goal:** See that code after `await` can run on a *different* thread.

**Steps:**
1. Write `async Task CheckSanctionsAsync(int id)` that logs thread ID before and after `await Task.Delay(200)`
2. Fire 20 of them with `Task.WhenAll`
3. Compare before/after thread IDs

**Solution**

```csharp
async Task CheckSanctionsAsync(int id)
{
    Console.WriteLine($"check {id} BEFORE await on thread {Environment.CurrentManagedThreadId}");
    await Task.Delay(200);
    Console.WriteLine($"check {id} AFTER  await on thread {Environment.CurrentManagedThreadId}");
}

await Task.WhenAll(Enumerable.Range(1, 20).Select(CheckSanctionsAsync));
```

**Expected output:**
```
check 1 BEFORE await on thread 1
check 2 BEFORE await on thread 1
...
check 20 BEFORE await on thread 1
check 5 AFTER  await on thread 4   ← different thread!
check 3 AFTER  await on thread 7   ← different thread!
check 1 AFTER  await on thread 4
...
```

| Observation | Explanation |
|-------------|-------------|
| All "BEFORE" on same thread | Starts are synchronous until first `await` |
| "AFTER" scattered across threads | Continuations resume on any free pool thread |

**Why this matters:**

| | Node | .NET |
|-|------|------|
| Threads | 1 | Many (thread pool) |
| After `await` | Same thread (event loop) | **Any** pool thread |

This is why `lock` can't contain `await`:
- `lock` must release on the **same thread** that acquired it
- After `await`, you might be on a **different thread**
- Compiler error **CS1996** prevents this bug
- **Fix:** Use `SemaphoreSlim` — it doesn't care which thread releases it

## Exercise 7.4 — Choose the right tool

**Goal:** Match scenarios to tools: `Task.WhenAll`, `Task.Run`, `Parallel.For`, `Interlocked`, `lock`, `SemaphoreSlim`.

**Scenarios:**
1. Read 8 uploaded files off the request
2. Hash + scan those 8 documents (heavy CPU)
3. Increment shared "documents scanned today" counter
4. Append `ScanResult` to shared `List<ScanResult>` from multiple threads
5. Render one PDF (CPU-heavy, ~2s) while keeping request cancellable
6. Ensure only one transfer mutates balances — method has `await _db...` calls

**Solution**

| # | Tool | Why |
|---|------|-----|
| 1 | `Task.WhenAll` | I/O-bound; start all, await all, no extra threads (= `Promise.all`) |
| 2 | `Parallel.For` | Heavy CPU over collection → spread across cores |
| 3 | `Interlocked.Increment` | Single `int`; atomic op beats lock |
| 4 | `lock` | `List<T>.Add` not thread-safe (or use `ConcurrentBag`) |
| 5 | `Task.Run` | Push CPU job off request thread → keeps `CancellationToken` responsive |
| 6 | `SemaphoreSlim(1,1)` | Critical section has `await` → `lock` is compile error (CS1996) |

**Key rule:** If the critical section contains `await`, use `SemaphoreSlim`, not `lock`.

## Exercise 7.5 — Rob your own bank (the main event)

**Goal:** Produce the transfer race, then fix it with `SemaphoreSlim`.

**Setup:** `docker compose up -d`, `dotnet run` (Topics 5–6 state).

**Steps:**

| Step | Action |
|------|--------|
| 1 | Register fresh Alice and Bob. Total: $2,000 |
| 2 | Fire 50 concurrent $10 transfers Alice → Bob |
| 3 | Check balances — does total still = $2,000? |
| 4 | Explain where money went/came from |
| 5 | Fix with `SemaphoreSlim`, reset DB, re-test |
| 6 | Answer: why didn't tests catch this? Why isn't semaphore the final answer? |

**Step 2 — the attack:**

```bash
for i in {1..50}; do
  curl -s -X POST http://localhost:PORT/v1/payment/transfer \
    -H "Content-Type: application/json" \
    -d '{"payerUserId":1,"payeeUserId":2,"amount":10}' > /dev/null &
done; wait
```

**Step 3 — check balances:**

```bash
docker compose exec db psql -U payapp -d payapp -c 'SELECT "Id","Balance" FROM "Users";'
```

**Typical result:** Alice > $500 (lost debits), total ≠ $2,000. You printed money.

---

**Step 4 — why it happens:**

```csharp
var payer = await _db.Users.FirstOrDefaultAsync(...);   // READ  balance = 800
// ... another request ALSO reads 800 here ...
if (payer.Balance < amount) ...                         // CHECK against stale 800
payer.Balance -= amount;                                // MODIFY: both compute 790
await _db.SaveChangesAsync();                           // WRITE: both write 790
                                                        // ❌ One $10 debit lost!
```

Same bug as 7.1's `processed++` — read-modify-write without coordination.

---

**Step 5 — the fix:**

```csharp
private static readonly SemaphoreSlim _transferGate = new(1, 1);  // static = one gate per process

public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    if (amount <= 0) throw new ArgumentException("Amount must be positive.");

    await _transferGate.WaitAsync();
    try
    {
        var payer = await _db.Users.FirstOrDefaultAsync(u => u.Id == payerUserId)
            ?? throw new KeyNotFoundException($"No user {payerUserId}.");
        var payee = await _db.Users.FirstOrDefaultAsync(u => u.Id == payeeUserId)
            ?? throw new KeyNotFoundException($"No user {payeeUserId}.");

        if (payer.Balance < amount)
            throw new InvalidOperationException("Insufficient funds.");

        payer.Balance -= amount;
        payee.Balance += amount;
        await _db.SaveChangesAsync();
    }
    finally
    {
        _transferGate.Release();
    }
}
```

**Why `static`?** Service is scoped (new instance per request). Instance field → each request gets own gate → guards nothing.

**Why `SemaphoreSlim`?** Body has `await` → `lock` is compile error (CS1996).

**Reset and re-test:**
```bash
docker compose down -v && docker compose up -d
# re-migrate, register Alice/Bob, run attack again
```

**Result:** Alice = $500, Bob = $1,500, total = $2,000. Every time.

---

**Step 6 — closing questions:**

| Question | Answer |
|----------|--------|
| Why didn't tests catch it? | Tests run one transfer at a time. Race only exists when calls **overlap**. |
| Why isn't semaphore the final answer? | It only guards **this process**. Two replicas = two gates = race returns. |

**Production fix:** Push coordination to the database:
- `SELECT ... FOR UPDATE` (row locks)
- Or optimistic concurrency (version column)

The semaphore is **correct** (for one process) **and insufficient** (for multiple replicas). Knowing both halves = senior answer.

---

The app now scans documents across cores and moves money correctly under fire. **Topic 8** ships it: publish, Docker, compose, and the when-Node-when-.NET answer you'll actually be asked.
