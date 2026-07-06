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

The batch case counts flagged documents with `Parallel.For`. To *watch* the counter race without wrestling multipart uploads, exercise the real `DocumentService.Scan` directly in a scratch `Program.cs` (a test harness — the exact method the endpoint uses; pass a throwaway context or extract `Scan` to test it in isolation).

1. Build 500 synthetic `.txt` documents and count how many are "processed" with a plain `count++` inside `Parallel.For`. Run it 10 times, printing each count.
2. How many runs printed less than 500? Explain, *mechanically*, what happens when two threads hit `count++` at the same instant.

**Solution**

```csharp
using System.Text;
using PaymentApp.Services;

var scanner = new DocumentService(db);          // any PaymentDbContext; Scan doesn't touch it
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

Typical output: mostly `500`, with occasional smaller numbers — different ones each run. That flakiness *is* the race, and it's a bug class your Node code structurally could not have.

**The mechanics:** `processed++` is three operations — *read* into a register, *add one*, *write back*. When threads A and B both read `40`, both compute `41`, and both write `41`, one increment is lost forever. It's the same lost-update anomaly two uncoordinated `UPDATE ... SET n = n + 1`-without-locking transactions produce — which is why databases give you atomic increments and row locks, and why C# gives you `Interlocked` and `lock`.

## Exercise 7.2 — Thread-safe totals (and why `decimal` is different)

Extend 7.1: alongside the processed **count**, accumulate the total **words scanned** as a `long`, and a total **risk score** as a `decimal` (`score = result.Words * 0.5m`).

1. Fix the count with `Interlocked.Increment`. Then try `Interlocked.Add(ref totalScore, score)` where `totalScore` is `decimal`. Read the compiler error out loud.
2. Fix the decimal total with `lock`, run 5 times, confirm it's identical every run.

**Solution**

1. There is no overload — the compiler refuses with **CS1503** (cannot convert `ref decimal` to `ref int`/`ref long`). `Interlocked` operates on types the CPU can swap in one instruction; a 128-bit `decimal` isn't one. **Money-shaped math can't be lone-instruction atomic — it needs a critical section.** This dead end is the exercise, and it's exactly why `TransferAsync` (7.5) can't be fixed with `Interlocked`.

2.

```csharp
int processed = 0;
long totalWords = 0;
decimal totalScore = 0m;
var gate = new object();

Parallel.For(0, docs.Count, i =>
{
    var r = scanner.Scan(docs[i].Name, docs[i].Bytes);
    Interlocked.Increment(ref processed);           // int: atomic op is enough
    Interlocked.Add(ref totalWords, r.Words);       // long: also atomic
    lock (gate) { totalScore += r.Words * 0.5m; }   // decimal: critical section required
});
Console.WriteLine($"{processed} docs, {totalWords} words, score {totalScore}");
```

Same numbers, every run. Note the division of labor: the *cheapest sufficient tool* per variable — atomic op for the counters, lock for the decimal.

## Exercise 7.3 — Watch await hop threads

The document endpoint will later call an outbound sanctions check per user (Topic 10's processor is the same shape). Simulate one and watch the thread pool.

1. Write `async Task CheckSanctionsAsync(int id)` that logs the thread before and after an `await Task.Delay(200)`, then fire 20 of them with `Task.WhenAll`. Do the before/after thread IDs match? How many distinct threads served the 20 "checks"?
2. In one sentence: why is this observation impossible in Node — and what does it have to do with the `await`-inside-`lock` compile error (CS1996)?

**Solution**

```csharp
async Task CheckSanctionsAsync(int id)
{
    Console.WriteLine($"check {id} BEFORE await on thread {Environment.CurrentManagedThreadId}");
    await Task.Delay(200);                       // pretend outbound call — no thread burned
    Console.WriteLine($"check {id} AFTER  await on thread {Environment.CurrentManagedThreadId}");
}

await Task.WhenAll(Enumerable.Range(1, 20).Select(CheckSanctionsAsync));
```

Typical result: all 20 "before" lines on one thread (the starts are synchronous until the first await), and the "after" lines scattered across **several different thread IDs** — the continuations resume on whatever pool thread is free.

**Why Node can't show this:** there is only one thread; every `await` continuation resumes on it via the event loop. And this hop is *exactly* why `lock` can't contain `await`: `lock` must be released by the thread that took it, but after an `await` you may be standing on a different thread. The compiler makes the impossible combination a compile error (CS1996) instead of a runtime heisenbug — and `SemaphoreSlim`, which doesn't care which thread releases it, is the escape hatch.

## Exercise 7.4 — Choose the right tool

For each scenario, name the tool (`await`/`Task.WhenAll`, `Task.Run`, `Parallel.For`, `Interlocked`, `lock`, `SemaphoreSlim`) and justify in one line:

1. Read 8 uploaded files off the request and collect their bytes.
2. Hash + scan those 8 documents (heavy CPU) as fast as possible in one request.
3. Increment a shared "documents scanned today" counter from the parallel scan.
4. Append each `ScanResult` to a shared `List<ScanResult>` audit log from multiple threads.
5. One PDF receipt render (CPU-heavy, ~2s) inside a web request, keeping the request cancellable while it runs.
6. Ensure only one transfer at a time mutates balances — in a method full of `await _db...` calls.

**Solution**

1. **`Task.WhenAll`** — reading files off the wire is I/O; start all, await all, zero extra threads. (`Promise.all`, verbatim.)
2. **`Parallel.For`** — heavy CPU over a collection is the poster child for spreading across cores; one request, many cores.
3. **`Interlocked.Increment`** — a single shared `int`; atomic op beats a lock for one operation.
4. **`lock`** — `List<T>.Add` is not thread-safe and not atomic; a critical section is required (or a `ConcurrentBag`/`ConcurrentQueue` — knowing `System.Collections.Concurrent` exists is a bonus point).
5. **`Task.Run`** — push the one CPU job off the request thread so the handler can honor the `CancellationToken` while a pool thread grinds: `await Task.Run(() => RenderReceipt(payment), ct);`. (Note the honest nuance from Concepts: this is about *responsiveness*, not throughput — there's no event loop to unblock.)
6. **`SemaphoreSlim(1,1)`** — the critical section contains `await`, so `lock` is a compile error; the async mutex is the tool. (Bonus if you added: "…within one process; across replicas it's the database's job.")

## Exercise 7.5 — Rob your own bank (the main event)

Back to `PaymentApp` — everything running as of Topics 5–6 (`docker compose up -d`, `dotnet run`).

1. Register fresh Alice and Bob (fresh DB or new emails). Total money in the system: $2,000.
2. Fire **50 concurrent** $10 transfers from Alice to Bob from your shell:

   ```bash
   for i in {1..50}; do
     curl -s -X POST http://localhost:PORT/v1/payment/transfer \
       -H "Content-Type: application/json" \
       -d '{"payerUserId":1,"payeeUserId":2,"amount":10}' > /dev/null &
   done; wait
   ```

3. Read both balances from Postgres and add them up. Alice sent $500 — did Bob receive $500? Does the system still hold $2,000? Run it a few times.
4. Explain where the money went (or came from), pointing at the exact lines of `TransferAsync`.
5. Fix it with Concepts' `SemaphoreSlim(1,1)` gate, wipe the data (`docker compose down -v && docker compose up -d`, re-migrate), and re-run the attack. Verify conservation.
6. Two closing questions: why did Topic 6's conservation test never catch this? And why is the semaphore *not* the final answer once Topic 8 runs two replicas?

**Solution**

3–4. Typical result: Alice ends *above* $500 (lost debits — you printed money) and/or the total drifts from $2,000. The bug is the gap between these lines:

```csharp
var payer = await _db.Users.FirstOrDefaultAsync(u => u.Id == payerUserId);   // READ  balance = 800
// ... another request reads 800 here too ...
if (payer.Balance < amount) ...                                              // CHECK against stale 800
payer.Balance -= amount;                                                     // MODIFY: both compute 790
await _db.SaveChangesAsync();                                                // WRITE: both write 790 — one $10 debit vanished
```

Fifty overlapping requests, each read-check-modify-write on the same two rows with no coordination. It's exercise 7.1's `processed++`, wearing your production code.

5. In `PaymentService`:

```csharp
private static readonly SemaphoreSlim _transferGate = new(1, 1);

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

(`static` matters: the service is *scoped* — a new instance per request — so an instance field would give every request its own gate, guarding nothing. One `static` gate per process is the point. And it must be `SemaphoreSlim`, not `lock`: the body awaits — CS1996.)

Re-run the attack: Alice exactly $500, Bob exactly $1,500, total $2,000, every time.

6. **Why the test missed it:** unit tests call `TransferAsync` one at a time — the invariant holds under sequential use; the race only exists when calls *overlap*. (You can write a concurrency test — fire 50 `TransferAsync` tasks at one in-memory service with `Task.WhenAll` and assert conservation — but the in-memory provider's behaviour under concurrency differs from real Postgres, so treat it as a smoke test, not proof.)

**Why the semaphore isn't the end:** it serializes transfers *in this process*. Two replicas behind a load balancer each have their own gate — the race returns between them. Durable answer: push the coordination into the shared resource itself — a database transaction with row locks (`SELECT ... FOR UPDATE` — your Postgres knowledge, verbatim) or an optimistic concurrency token that turns the lost update into a retryable conflict. The in-process gate is correct *and* insufficient; knowing both halves of that sentence is the senior answer.

---

The app now scans documents across cores and moves money correctly under fire. **Topic 8** ships it: publish, Docker, compose, and the when-Node-when-.NET answer you'll actually be asked.
