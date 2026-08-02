# Topic 7: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → **Fix transfer race condition** → .NET Standard Library → Authentication → Production

Topic 5 introduced the transfer endpoint with a race condition bug (discussed in Topic 7 concepts). This topic fixes it with `SemaphoreSlim` and adds a CPU-bound document upload feature.

**Prerequisites:** Complete Topic 6 hands-on (working PaymentApp API with PostgreSQL).

---

## Exercise 7.1 — Fix the transfer race condition

In Topic 5, we created `PaymentService.TransferAsync()` without concurrency protection. Two simultaneous transfers can read-modify-write the same balance, causing lost updates. Let's fix it.

**The bug (from Topic 5):**

```csharp
// PaymentService.cs — NO LOCKING (race condition!)
public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    var payer = await _db.Users.FirstOrDefaultAsync(u => u.Id == payerUserId);
    var payee = await _db.Users.FirstOrDefaultAsync(u => u.Id == payeeUserId);

    payer.Withdraw(amount);  // Read $1000, subtract $100 = $900
    payee.Deposit(amount);

    await _db.SaveChangesAsync();  // Write $900 — but another request already wrote $950!
}
```

**Task:** Update `PaymentService` to use `SemaphoreSlim` for safe concurrent transfers.

**Solution**

Update `src/PaymentApp.Infrastructure/Services/PaymentService.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Exceptions;
using PaymentApp.Infrastructure.Data;

namespace PaymentApp.Infrastructure.Services;

public class PaymentService : IPaymentService
{
    private readonly PaymentDbContext _db;

    // Static semaphore: one gate for all instances (service is scoped)
    // SemaphoreSlim(1, 1) = mutex — only one transfer at a time
    private static readonly SemaphoreSlim _transferGate = new(1, 1);

    public PaymentService(PaymentDbContext db)
    {
        _db = db;
    }

    public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
    {
        // Validation before acquiring the lock
        if (amount <= 0)
            throw InvalidTransferException.NegativeAmount(amount);

        if (payerUserId == payeeUserId)
            throw InvalidTransferException.SameUser();

        // Acquire the semaphore — only one transfer executes at a time
        await _transferGate.WaitAsync();
        try
        {
            // Now safe: no other transfer can read-modify-write concurrently
            var payer = await _db.Users.FirstOrDefaultAsync(u => u.Id == payerUserId)
                ?? throw new UserNotFoundException(payerUserId);

            var payee = await _db.Users.FirstOrDefaultAsync(u => u.Id == payeeUserId)
                ?? throw new UserNotFoundException(payeeUserId);

            // Domain logic handles validation and events
            payer.Withdraw(amount);
            payee.Deposit(amount);

            // One commit, both changes
            await _db.SaveChangesAsync();
        }
        finally
        {
            // ALWAYS release in finally — even if an exception is thrown
            _transferGate.Release();
        }
    }
}
```

**What changed:**

| Before (Topic 5) | After (Topic 7) |
|------------------|-----------------|
| No locking | `static SemaphoreSlim _transferGate` |
| Race condition possible | `await _transferGate.WaitAsync()` before critical section |
| No cleanup guarantee | `try`/`finally` ensures `Release()` |

**Understanding the fix:**

| Element | Why |
|---------|-----|
| `static SemaphoreSlim` | Service is scoped (new instance per request). Instance field would mean each request has its own gate → no protection. |
| `SemaphoreSlim(1, 1)` | Mutex — only 1 thread at a time. First `1` = initial count, second `1` = max count. |
| `await _transferGate.WaitAsync()` | Async wait — doesn't block the thread while waiting. |
| `try`/`finally` with `Release()` | Ensures the semaphore is released even if an exception occurs. |
| Validation before lock | Don't hold the lock while doing things that don't need protection. |

**Why not `lock`?** The critical section contains `await` statements. `lock` can't contain `await` — compiler error CS1996. `SemaphoreSlim` allows async critical sections.

**Why `static`?** The service is registered as `Scoped`, meaning each request gets a new instance. If the semaphore were an instance field, each request would have its own gate, providing no protection.

**Test the fix:**

```bash
# Build and run
dotnet build && dotnet run --project src/PaymentApp.Api

# Transfer $100 from Alice (ID 1) to Bob (ID 2)
curl -X POST http://localhost:5000/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":100}'

# Verify in database
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "Balance" FROM "Users";'
```

---

## Exercise 7.2 — Add document upload (CPU-bound work)

The document upload feature demonstrates proper handling of CPU-bound work. The scan operation is CPU-intensive (hashing, text analysis), so we use `Task.Run` to move it off the request thread.

**Task:** Add document upload functionality.

**Solution**

**Step 1:** Create a DTO for the scan result in `src/PaymentApp.Application/DTOs/DocumentDtos.cs`:

```csharp
namespace PaymentApp.Application.DTOs;

public record ScanResult(string FileName, int Words, string Sha256, bool Flagged);
```

**Step 2:** Add the interface in `src/PaymentApp.Application/Services/IDocumentService.cs`:

```csharp
using PaymentApp.Application.DTOs;

namespace PaymentApp.Application.Services;

public interface IDocumentService
{
    /// <summary>
    /// CPU-bound: hash and scan the document content.
    /// Call this with Task.Run to avoid blocking the request thread.
    /// </summary>
    ScanResult Scan(string fileName, byte[] content);

    /// <summary>
    /// I/O-bound: store the document on disk and update the user.
    /// </summary>
    Task StoreAsync(int userId, string fileName, byte[] content);
}
```

**Step 3:** Implement the service in `src/PaymentApp.Infrastructure/Services/DocumentService.cs`:

```csharp
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Services;
using PaymentApp.Domain.Exceptions;
using PaymentApp.Infrastructure.Data;

namespace PaymentApp.Infrastructure.Services;

public class DocumentService : IDocumentService
{
    private readonly PaymentDbContext _db;
    private readonly string _uploadDir;

    public DocumentService(PaymentDbContext db)
    {
        _db = db;
        _uploadDir = Path.Combine(AppContext.BaseDirectory, "uploads");
        Directory.CreateDirectory(_uploadDir);
    }

    // CPU-BOUND: No awaits — this method burns CPU cycles
    // The caller should use Task.Run to move this off the request thread
    public ScanResult Scan(string fileName, byte[] content)
    {
        // Hash the content (CPU-intensive)
        var hash = Convert.ToHexString(SHA256.HashData(content));

        // Parse as text
        var text = Encoding.UTF8.GetString(content);

        // Simulate CPU-heavy work (malware scan, OCR, etc.)
        // In production, this might be ML inference, image processing, etc.
        double signal = 0;
        for (int i = 0; i < 5_000_000; i++)
            signal += Math.Sqrt(i);

        // Analyze the text
        var words = text.Split(default(char[]?), StringSplitOptions.RemoveEmptyEntries).Length;
        var flagged = text.Contains("fraud", StringComparison.OrdinalIgnoreCase);

        return new ScanResult(fileName, words, hash, flagged);
    }

    // I/O-BOUND: Uses await — call normally with await
    public async Task StoreAsync(int userId, string fileName, byte[] content)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId)
            ?? throw new UserNotFoundException(userId);

        // Generate a unique filename
        var storedName = $"{userId}_{Guid.NewGuid():N}{Path.GetExtension(fileName)}";
        var filePath = Path.Combine(_uploadDir, storedName);

        // Write to disk (I/O)
        await File.WriteAllBytesAsync(filePath, content);

        // Update user record
        user.DocumentPath = storedName;
        await _db.SaveChangesAsync();
    }
}
```

**Step 4:** Add the controller in `src/PaymentApp.Api/Controllers/DocumentController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Services;
using PaymentApp.Domain.Exceptions;

namespace PaymentApp.Api.Controllers;

[ApiController]
[Route("v1/document")]
public class DocumentController : ControllerBase
{
    private readonly IDocumentService _documentService;

    public DocumentController(IDocumentService documentService)
    {
        _documentService = documentService;
    }

    [HttpPost("upload")]
    public async Task<ActionResult<ScanResult>> Upload(int userId, IFormFile file)
    {
        // Validate file type
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".txt")
            return BadRequest(new { error = "Only .txt files are accepted." });

        // I/O: read the uploaded bytes
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var bytes = ms.ToArray();

        // CPU: scan the document on a pool thread
        // Task.Run moves CPU-bound work off the request thread
        var result = await Task.Run(() => _documentService.Scan(file.FileName, bytes));

        // I/O: store on disk and update user
        try
        {
            await _documentService.StoreAsync(userId, file.FileName, bytes);
        }
        catch (UserNotFoundException ex)
        {
            return NotFound(new { code = ex.Code, message = ex.Message });
        }

        return Ok(result);
    }
}
```

**Understanding the code:**

| Line | Type | Tool | Why |
|------|------|------|-----|
| `await file.CopyToAsync(ms)` | I/O | `await` | Reading from network — thread returns to pool while waiting |
| `await Task.Run(() => _documentService.Scan(...))` | CPU | `Task.Run` | Hashing and analysis — moves to pool thread so request thread can serve other requests |
| `await _documentService.StoreAsync(...)` | I/O | `await` | Writing to disk and database — thread returns to pool |

**Step 5:** Register the service in `Program.cs`:

```csharp
builder.Services.AddScoped<IDocumentService, DocumentService>();
```

**Step 6:** Test the upload:

```bash
# Create a test file
echo "This is a test document with some text content." > test.txt

# Upload for user 1 (Alice)
curl -X POST "http://localhost:5000/v1/document/upload?userId=1" \
  -F "file=@test.txt"

# Expected response:
# {"fileName":"test.txt","words":9,"sha256":"...","flagged":false}

# Try with flagged content
echo "This document mentions fraud and suspicious activity." > flagged.txt
curl -X POST "http://localhost:5000/v1/document/upload?userId=1" \
  -F "file=@flagged.txt"

# Expected response:
# {"fileName":"flagged.txt","words":7,"sha256":"...","flagged":true}

# Verify in database
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "DocumentPath" FROM "Users" WHERE "Id" = 1;'

# Clean up
rm test.txt flagged.txt
```

---

## Exercise 7.3 — Understand the race condition (drill)

Before moving on, let's actually see the race condition that the semaphore prevents. This drill uses a standalone script to demonstrate the problem.

**Task:** Create a script that shows what happens without locking.

**Solution**

Create `test-race.cs`:

```csharp
#!/usr/bin/env dotnet

// Simulate the transfer race condition WITHOUT locking

int aliceBalance = 1000;
int bobBalance = 1000;

Console.WriteLine($"Before: Alice={aliceBalance}, Bob={bobBalance}, Total={aliceBalance + bobBalance}");

// Fire 50 concurrent "transfers" of $10 each
var tasks = Enumerable.Range(1, 50).Select(i => Task.Run(() =>
{
    // This is the RACE: read-modify-write without coordination
    var current = aliceBalance;           // READ
    Thread.Sleep(1);                       // Simulate work (increases race window)
    aliceBalance = current - 10;           // WRITE (based on stale read)
    bobBalance += 10;                      // Also racy
})).ToArray();

Task.WaitAll(tasks);

Console.WriteLine($"After:  Alice={aliceBalance}, Bob={bobBalance}, Total={aliceBalance + bobBalance}");
Console.WriteLine($"Expected: Alice=500, Bob=1500, Total=2000");

// If total != 2000, money was created or destroyed
if (aliceBalance + bobBalance != 2000)
    Console.WriteLine("❌ RACE CONDITION: Money was created or destroyed!");
else
    Console.WriteLine("✅ (Got lucky this time - try running again)");
```

Run it several times:

```bash
dotnet run test-race.cs
dotnet run test-race.cs
dotnet run test-race.cs
```

**Expected output (varies each run):**

```
Before: Alice=1000, Bob=1000, Total=2000
After:  Alice=870, Bob=1210, Total=2080
Expected: Alice=500, Bob=1500, Total=2000
❌ RACE CONDITION: Money was created or destroyed!
```

Sometimes it might show `Total=2000` (got lucky), but run it enough times and you'll see the race.

**Why this happens:**

| Step | Thread A | Thread B |
|------|----------|----------|
| 1 | Read `aliceBalance` = 900 | Read `aliceBalance` = 900 |
| 2 | Compute 900 - 10 = 890 | Compute 900 - 10 = 890 |
| 3 | Write 890 | Write 890 |
| Result | **One debit lost** | Total is now wrong |

**Clean up:**

```bash
rm test-race.cs
```

---

## Exercise 7.4 — Watch `await` hop threads

A key difference from Node: after `await`, you might be on a different thread. This is why `lock` can't contain `await`.

**Task:** Create a script that shows thread hopping.

**Solution**

Create `test-thread-hop.cs`:

```csharp
#!/usr/bin/env dotnet

async Task CheckAsync(int id)
{
    Console.WriteLine($"[{id}] BEFORE await: thread {Environment.CurrentManagedThreadId}");
    await Task.Delay(100);
    Console.WriteLine($"[{id}] AFTER  await: thread {Environment.CurrentManagedThreadId}");
}

Console.WriteLine("Starting 10 async operations...\n");

await Task.WhenAll(Enumerable.Range(1, 10).Select(CheckAsync));

Console.WriteLine("\nNotice: AFTER often runs on a different thread than BEFORE");
```

Run it:

```bash
dotnet run test-thread-hop.cs
```

**Expected output:**

```
Starting 10 async operations...

[1] BEFORE await: thread 1
[2] BEFORE await: thread 1
...
[10] BEFORE await: thread 1
[5] AFTER  await: thread 4    ← different thread!
[3] AFTER  await: thread 7    ← different thread!
[1] AFTER  await: thread 4
...

Notice: AFTER often runs on a different thread than BEFORE
```

**Key observations:**

| Observation | Explanation |
|-------------|-------------|
| All "BEFORE" on same thread | Code before `await` runs synchronously on the calling thread |
| "AFTER" scattered across threads | After `await`, any free pool thread picks up the continuation |

**Why this matters for `lock`:**

```csharp
lock (_gate)
{
    await SomethingAsync();  // ❌ CS1996: Cannot await in the body of a lock statement
}
```

`lock` must be released by the **same thread** that acquired it. After `await`, you might be on a **different thread**. The compiler prevents this bug with error CS1996.

**Clean up:**

```bash
rm test-thread-hop.cs
```

---

## Exercise 7.5 — Try `Interlocked` on decimal (drill)

`Interlocked` only works on `int`/`long`. Let's see what happens when you try it on `decimal`.

**Task:** Try to use `Interlocked.Add` on a decimal and observe the compiler error.

**Solution**

Create `test-interlocked.cs`:

```csharp
#!/usr/bin/env dotnet

// This works: int and long
int intCounter = 0;
long longCounter = 0L;

Interlocked.Increment(ref intCounter);
Interlocked.Add(ref longCounter, 100L);

Console.WriteLine($"int: {intCounter}, long: {longCounter}");

// This does NOT work: decimal
decimal decimalTotal = 0m;
// Interlocked.Add(ref decimalTotal, 100m);  // Uncomment to see error

Console.WriteLine(@"
Uncomment the line above to see:
  error CS1503: Argument 1: cannot convert from 'ref decimal' to 'ref int'

Why? decimal is 128 bits. CPU can only atomically swap 32 or 64 bits.
For decimal, you must use 'lock' or 'SemaphoreSlim'.
");
```

Run it:

```bash
dotnet run test-interlocked.cs
```

To see the actual error, uncomment the line and run again:

```
error CS1503: Argument 1: cannot convert from 'ref decimal' to 'ref int'
```

**This is why money (`decimal`) needs `SemaphoreSlim`** — there's no atomic operation for 128-bit values.

**Clean up:**

```bash
rm test-interlocked.cs
```

---

## Exercise 7.6 — Parallel document processing

When you have multiple CPU-bound tasks, `Parallel.For` spreads them across cores.

**Task:** Process multiple documents in parallel and measure the speedup.

**Solution**

Create `test-parallel.cs`:

```csharp
#!/usr/bin/env dotnet

using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

// Simulate CPU-heavy scan
string ScanDocument(byte[] content)
{
    var hash = Convert.ToHexString(SHA256.HashData(content));
    // Burn some CPU cycles
    double signal = 0;
    for (int i = 0; i < 2_000_000; i++) signal += Math.Sqrt(i);
    return hash;
}

// Create 8 test documents
var documents = Enumerable.Range(1, 8)
    .Select(i => Encoding.UTF8.GetBytes($"Document {i} content here"))
    .ToArray();

var results = new string[8];

// Sequential processing
var sw = Stopwatch.StartNew();
for (int i = 0; i < 8; i++)
    results[i] = ScanDocument(documents[i]);
var sequentialMs = sw.ElapsedMilliseconds;
Console.WriteLine($"Sequential: {sequentialMs}ms");

// Parallel processing
sw.Restart();
Parallel.For(0, 8, i =>
    results[i] = ScanDocument(documents[i]));
var parallelMs = sw.ElapsedMilliseconds;
Console.WriteLine($"Parallel:   {parallelMs}ms");

Console.WriteLine($"Speedup:    {(double)sequentialMs / parallelMs:F1}x");
Console.WriteLine($"Cores:      {Environment.ProcessorCount}");
```

Run it:

```bash
dotnet run test-parallel.cs
```

**Expected output (varies by machine):**

```
Sequential: 480ms
Parallel:   120ms
Speedup:    4.0x
Cores:      8
```

The speedup approaches the number of cores — true parallelism.

**This is impossible in Node's single-threaded model** — you'd need `worker_threads` to achieve the same effect.

**Clean up:**

```bash
rm test-parallel.cs
```

---

## Exercise 7.7 — Test concurrent transfers

Let's verify that our `SemaphoreSlim` protection actually works under load.

**Task:** Fire 50 concurrent transfers and verify balances are correct.

**Solution**

Make sure Alice and Bob both have $1,000:

```bash
# Reset the database
docker-compose down -v && docker-compose up -d
sleep 2

# Apply migrations and seed data
dotnet run --project src/PaymentApp.Api &
sleep 5

# Register Alice and Bob with $1000 each
curl -X POST http://localhost:5000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'

curl -X POST http://localhost:5000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@bank.test","password":"Passw0rd!"}'
```

Now fire 50 concurrent $10 transfers:

```bash
# Fire 50 concurrent transfers of $10 each (Alice → Bob)
for i in {1..50}; do
  curl -s -X POST http://localhost:5000/v1/payment/transfer \
    -H "Content-Type: application/json" \
    -d '{"payerUserId":1,"payeeUserId":2,"amount":10}' &
done
wait

# Check final balances
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "Balance" FROM "Users";'
```

**Expected result:**

```
 Id | Name  | Balance
----+-------+---------
  1 | Alice |  500.00
  2 | Bob   | 1500.00
```

- Alice: 1000 - (50 × 10) = 500 ✅
- Bob: 1000 + (50 × 10) = 1500 ✅
- Total: 2000 ✅

If the semaphore weren't there, you'd see Alice with more than $500 (lost debits = free money).

---

## Exercise 7.8 — Build and verify

**Task:** Ensure everything compiles and works.

**Solution**

```bash
dotnet build

# Verify transfer endpoint
curl -X POST http://localhost:5000/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":50}'

# Verify document upload
echo "Test document" > test.txt
curl -X POST "http://localhost:5000/v1/document/upload?userId=1" \
  -F "file=@test.txt"
rm test.txt
```

---

## What we built

| File | Change |
|------|--------|
| `Infrastructure/Services/PaymentService.cs` | Added `SemaphoreSlim` for race condition fix |
| `Application/DTOs/DocumentDtos.cs` | New — scan result type |
| `Application/Interfaces/IDocumentService.cs` | New — document service interface |
| `Infrastructure/Services/DocumentService.cs` | New — CPU scan + I/O store |
| `Api/Controllers/DocumentController.cs` | New — upload endpoint |

**Project structure update:**

```
src/PaymentApp.Application/
├── DTOs/
│   ├── AuthDtos.cs
│   ├── PaymentDtos.cs
│   └── DocumentDtos.cs (new)
└── Interfaces/
    ├── IAuthService.cs
    ├── IPaymentService.cs
    └── IDocumentService.cs (new)

src/PaymentApp.Infrastructure/
└── Services/
    ├── AuthService.cs
    ├── PaymentService.cs (updated with SemaphoreSlim)
    └── DocumentService.cs (new)

src/PaymentApp.Api/
└── Controllers/
    ├── AuthController.cs
    ├── PaymentController.cs
    └── DocumentController.cs (new)
```

---

## Key takeaways

| Concept | Tool | When to use |
|---------|------|-------------|
| **I/O-bound work** | `async/await` | DB calls, HTTP requests, file reads |
| **CPU-bound work** | `Task.Run` / `Parallel.For` | Hashing, scanning, processing |
| **Atomic int/long** | `Interlocked` | Simple counters |
| **Sync critical section** | `lock` | No `await` inside |
| **Async critical section** | `SemaphoreSlim` | Has `await` inside |
| **Many I/O calls** | `Task.WhenAll` | Fire all, await all |

---

## Interview talking points

- "I used `SemaphoreSlim` because the critical section contains `await` — `lock` would be a compiler error (CS1996)."
- "The semaphore is `static` because the service is scoped. An instance field would give each request its own gate, which protects nothing."
- "For document upload, I use `Task.Run` for the CPU-heavy scan but `await` for the I/O operations. Different tools for different work types."
- "The in-process semaphore works for a single replica. For multiple replicas, we'd need database-level locking — that's Topic 10."
- "After `await`, you might be on a different thread. That's why `lock` can't contain `await` — it must release on the same thread that acquired it."

---

## Limitations to address later

| Limitation | Current state | Fix in |
|------------|---------------|--------|
| Anyone can transfer anyone's money | `payerUserId` comes from request body | Topic 9: payer = authenticated caller |
| Single replica only | `SemaphoreSlim` is in-process | Topic 10: database locking |
| No authentication | All endpoints public | Topic 9: JWT authentication |

---

## Next: Topic 8

In Topic 8, we explore the .NET Standard Library — the common APIs for HTTP, JSON, async, streams, and files that every .NET developer uses daily.
