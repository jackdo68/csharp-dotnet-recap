# Topic 8: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint + Document upload → **.NET Standard Library** → Authentication → Production

Topic 7 built document **upload** (the CPU-bound scan + storing the file). This topic exercises the everyday .NET standard library — JSON, files, streams, strings, dates, collections, and `HttpClient` — by **extending that real feature** rather than writing throwaway scripts. By the end, PaymentApp can attach JSON metadata to a document, stream it back to the caller, print an account statement, and call an external service.

**Prerequisites:** Complete Topic 7 hands-on (working transfer and document upload).

> **Why no `test-*.cs` scripts?** Every tool here is learned on the actual app. Isolated snippets are easy to forget; a feature you can `curl` sticks. The Node/TS ↔ .NET API mappings live in this topic's **Concepts** page — keep it open as a reference while you build.

---

## Exercise 8.1 — Attach JSON metadata to an uploaded document

**Task:** When a document is stored, also write a `.meta.json` sidecar file next to it — practising `System.Text.Json`, `File`, `Path`, and `DateTime` on real data.

**Solution**

**Step 1:** Add a `DocumentMetadata` record to `src/PaymentApp.Application/DTOs/DocumentDtos.cs` (alongside the existing `ScanResult`):

```csharp
namespace PaymentApp.Application.DTOs;

public record ScanResult(string FileName, int Words, string Sha256, bool Flagged);

// NEW — what we persist next to the stored file
public record DocumentMetadata(
    string OriginalName,
    string StoredName,
    long SizeBytes,
    string Sha256,
    int Words,
    bool Flagged,
    DateTime UploadedAtUtc);
```

**Step 2:** Update `IDocumentService` (`src/PaymentApp.Application/Interfaces/IDocumentService.cs`) — `StoreAsync` now takes the scan result and returns the metadata it wrote:

```csharp
using PaymentApp.Application.DTOs;

namespace PaymentApp.Application.Interfaces;

public interface IDocumentService
{
    ScanResult Scan(string fileName, byte[] content);

    // CHANGED: now records metadata and returns it
    Task<DocumentMetadata> StoreAsync(int userId, string fileName, byte[] content, ScanResult scan);
}
```

**Step 3:** Update `DocumentService` (`src/PaymentApp.Infrastructure/Services/DocumentService.cs`). Add the JSON options fields and rewrite `StoreAsync`:

```csharp
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Exceptions;
using PaymentApp.Infrastructure.Data;

namespace PaymentApp.Infrastructure.Services;

public class DocumentService : IDocumentService
{
    private readonly PaymentDbContext _db;
    private readonly string _uploadDir;

    // Write pretty, camelCase JSON (readable when you `cat` the sidecar).
    private static readonly JsonSerializerOptions _jsonWrite = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    // Web defaults are camelCase + case-insensitive — perfect for reading it back.
    private static readonly JsonSerializerOptions _jsonRead = new(JsonSerializerDefaults.Web);

    public DocumentService(PaymentDbContext db)
    {
        _db = db;
        _uploadDir = Path.Combine(AppContext.BaseDirectory, "uploads");
        Directory.CreateDirectory(_uploadDir);
    }

    // Scan(...) is unchanged from Topic 7 — omitted here for brevity.
    public ScanResult Scan(string fileName, byte[] content)
    {
        var hash = Convert.ToHexString(SHA256.HashData(content));
        var text = Encoding.UTF8.GetString(content);
        double signal = 0;
        for (int i = 0; i < 5_000_000; i++) signal += Math.Sqrt(i);
        var words = text.Split(default(char[]?), StringSplitOptions.RemoveEmptyEntries).Length;
        var flagged = text.Contains("fraud", StringComparison.OrdinalIgnoreCase);
        return new ScanResult(fileName, words, hash, flagged);
    }

    public async Task<DocumentMetadata> StoreAsync(int userId, string fileName, byte[] content, ScanResult scan)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId)
            ?? throw new UserNotFoundException(userId);

        var storedName = $"{userId}_{Guid.NewGuid():N}{Path.GetExtension(fileName)}";
        var filePath = Path.Combine(_uploadDir, storedName);
        await File.WriteAllBytesAsync(filePath, content);   // I/O: the file itself

        // Build metadata and serialize it to a sidecar: "<storedName>.meta.json"
        var meta = new DocumentMetadata(
            OriginalName: fileName,
            StoredName: storedName,
            SizeBytes: content.LongLength,
            Sha256: scan.Sha256,
            Words: scan.Words,
            Flagged: scan.Flagged,
            UploadedAtUtc: DateTime.UtcNow);       // always store timestamps in UTC

        var metaPath = filePath + ".meta.json";
        await File.WriteAllTextAsync(metaPath, JsonSerializer.Serialize(meta, _jsonWrite));

        user.DocumentPath = storedName;
        await _db.SaveChangesAsync();
        return meta;
    }
}
```

**Step 4:** Update the controller's `Upload` action (`src/PaymentApp.Api/Controllers/DocumentController.cs`) to pass the scan result through:

```csharp
// I/O: read the uploaded bytes (unchanged)
using var ms = new MemoryStream();
await file.CopyToAsync(ms);
var bytes = ms.ToArray();

// CPU: scan on a pool thread (unchanged)
var result = await Task.Run(() => _documentService.Scan(file.FileName, bytes));

// I/O: store the file AND its metadata; return the metadata to the caller
try
{
    var meta = await _documentService.StoreAsync(userId, file.FileName, bytes, result);
    return Ok(meta);
}
catch (UserNotFoundException ex)
{
    return NotFound(new { code = ex.Code, message = ex.Message });
}
```

**Test it:**

```bash
echo "This is a real document with some content." > test.txt
curl -X POST "http://localhost:5000/v1/document/upload?userId=1" -F "file=@test.txt"

# Inspect the sidecar the service just wrote (path printed in the response's storedName):
cat src/PaymentApp.Api/bin/Debug/net10.0/uploads/1_*.meta.json
rm test.txt
```

**Expected sidecar:**

```json
{
  "originalName": "test.txt",
  "storedName": "1_9f8c....txt",
  "sizeBytes": 43,
  "sha256": "A1B2...",
  "words": 8,
  "flagged": false,
  "uploadedAtUtc": "2026-08-04T09:15:22.13Z"
}
```

**What this taught:**

| Tool | Where it showed up |
|------|--------------------|
| `JsonSerializer.Serialize(obj, options)` | Writing the sidecar |
| `JsonNamingPolicy.CamelCase` / `WriteIndented` | `camelCase`, human-readable output |
| `File.WriteAllTextAsync` / `WriteAllBytesAsync` | Sidecar text + the file bytes |
| `Path.Combine`, string concat for `.meta.json` | Building paths portably |
| `DateTime.UtcNow` | Storing the timestamp in UTC |

**Interview talking point:** "I keep a JSON sidecar per file so the metadata travels with the document and stays human-readable. I serialize with camelCase + indentation for writing, and read back with `JsonSerializerDefaults.Web` so casing round-trips without extra config."

---

## Exercise 8.2 — Download the document with a stream

**Task:** Add `GET /v1/document/download` that reads the stored file **as a stream** (never buffering it fully in memory) and returns it, using the sidecar to restore the original filename.

**Solution**

**Step 1:** Add `OpenAsync` to `IDocumentService`:

```csharp
// Returns an open read-stream for the user's document + its metadata.
Task<(Stream Content, DocumentMetadata Meta)> OpenAsync(int userId);
```

**Step 2:** Implement it in `DocumentService`:

```csharp
public async Task<(Stream Content, DocumentMetadata Meta)> OpenAsync(int userId)
{
    var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId)
        ?? throw new UserNotFoundException(userId);

    if (string.IsNullOrEmpty(user.DocumentPath))
        throw new InvalidOperationException($"User {userId} has no document on file.");

    var filePath = Path.Combine(_uploadDir, user.DocumentPath);
    if (!File.Exists(filePath))
        throw new FileNotFoundException("Stored document is missing.", user.DocumentPath);

    // Read the sidecar back into the record (JSON -> object)
    var metaPath = filePath + ".meta.json";
    var meta = JsonSerializer.Deserialize<DocumentMetadata>(
        await File.ReadAllTextAsync(metaPath), _jsonRead)!;

    // Open a READ STREAM — the framework streams these bytes to the client and
    // disposes the stream for us. A 2 GB file uses a small buffer, not 2 GB of RAM.
    Stream content = File.OpenRead(filePath);
    return (content, meta);
}
```

**Step 3:** Add the `Download` action to `DocumentController`:

```csharp
[HttpGet("download")]
public async Task<IActionResult> Download(int userId)
{
    try
    {
        var (content, meta) = await _documentService.OpenAsync(userId);

        // File(...) returns a FileStreamResult: it streams `content` to the
        // response and sets Content-Disposition so the browser downloads it.
        return File(content, "application/octet-stream", meta.OriginalName);
    }
    catch (UserNotFoundException ex)
    {
        return NotFound(new { code = ex.Code, message = ex.Message });
    }
    catch (Exception ex) when (ex is FileNotFoundException or InvalidOperationException)
    {
        return NotFound(new { error = ex.Message });
    }
}
```

**Test it:**

```bash
# -OJ = save to a file, using the server's Content-Disposition filename
curl -OJ "http://localhost:5000/v1/document/download?userId=1"
# -> saves "test.txt" (the ORIGINAL name, restored from the sidecar)
```

**Buffer vs. stream — the point of this exercise:**

| Approach | Memory used | When |
|----------|-------------|------|
| `File.ReadAllBytesAsync` then return bytes | Whole file in RAM | Small files only |
| `File.OpenRead` + `File(stream, ...)` | One small buffer | Any size — the default for downloads |

**Interview talking point:** "For file downloads I return a `FileStreamResult` from `File.OpenRead`, not the whole byte array — the framework streams it and disposes the stream, so memory stays flat regardless of file size. That's the `Stream` ≈ Node `Readable` idea: data flows through, it isn't all held at once."

---

## Exercise 8.3 — Generate an account statement

**Task:** Add `GET /v1/document/statement` that builds a plain-text statement — the natural home for `string` formatting, `StringBuilder`, `DateTime`, and collections.

**Solution**

**Step 1:** Add to `IDocumentService`:

```csharp
Task<string> BuildStatementAsync(int userId, string? currency = null);
```

(The `currency` parameter is unused until Exercise 8.4 — leave it in the signature now.)

**Step 2:** Implement it in `DocumentService` (add `using System.Globalization;` at the top):

```csharp
public async Task<string> BuildStatementAsync(int userId, string? currency = null)
{
    var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId)
        ?? throw new UserNotFoundException(userId);

    var usd = CultureInfo.GetCultureInfo("en-US");

    // A small collection of label/value rows — iterated to render the body.
    var lines = new List<(string Label, string Value)>
    {
        ("Account holder", user.Name),
        ("Email", user.Email),
        ("Current balance", user.Balance.ToString("C", usd)),   // $1,000.00
        ("Document on file", string.IsNullOrEmpty(user.DocumentPath) ? "(none)" : user.DocumentPath),
    };

    // StringBuilder: build the report with one buffer, not string + string + ...
    var sb = new StringBuilder();
    sb.AppendLine("=== PaymentApp Account Statement ===");
    sb.AppendLine($"Generated: {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
    sb.AppendLine();
    foreach (var (label, value) in lines)
        sb.AppendLine($"{label,-18}: {value}");   // {,-18} left-pads the label to 18 cols
    sb.AppendLine();
    sb.AppendLine("Thank you for banking with PaymentApp.");
    return sb.ToString();
}
```

**Step 3:** Add the controller action:

```csharp
[HttpGet("statement")]
public async Task<IActionResult> Statement(int userId, string? currency = null)
{
    try
    {
        var text = await _documentService.BuildStatementAsync(userId, currency);
        return Content(text, "text/plain");
    }
    catch (UserNotFoundException ex)
    {
        return NotFound(new { code = ex.Code, message = ex.Message });
    }
}
```

**Test it:**

```bash
curl "http://localhost:5000/v1/document/statement?userId=1"
```

**Expected output:**

```
=== PaymentApp Account Statement ===
Generated: 2026-08-04 09:20:41 UTC

Account holder    : Alice
Email             : alice@bank.test
Current balance   : $1,000.00
Document on file  : 1_9f8c....txt

Thank you for banking with PaymentApp.
```

**What this taught:**

| Tool | Where it showed up |
|------|--------------------|
| `StringBuilder` + `AppendLine` | Building the multi-line report efficiently |
| `{value:C}` / `{label,-18}` | Currency formatting + alignment in interpolation |
| `DateTime.UtcNow:yyyy-MM-dd HH:mm:ss` | Formatting a timestamp |
| `List<(string, string)>` + `foreach` | Collecting and iterating line items |

**Interview talking point:** "For any string built in a loop I reach for `StringBuilder` — `+=` allocates a new string each iteration. And composite format items like `{label,-18}` handle alignment without manual padding."

---

## Exercise 8.4 — Call an external service with a typed HttpClient

This is the one that matters most: a **real** outbound call from PaymentApp, using the exact `IHttpClientFactory` + named-client pattern that Topic 10 reuses for the payment processor. We'll fetch a live exchange rate and show the balance in another currency on the statement.

**Task:** Build a typed `ExchangeRateClient`, register it as a named client, and use it to add a converted-balance line to the statement.

**Solution**

**Step 1:** Create `src/PaymentApp.Infrastructure/Clients/ExchangeRateClient.cs`:

```csharp
using System.Net.Http.Json;

namespace PaymentApp.Infrastructure.Clients;

public record FxRate(string From, string To, decimal Rate, DateOnly Date);

/// <summary>
/// Typed client over a named HttpClient (base URL configured in Program.cs).
/// This is the same shape Topic 10's PaymentProcessorClient uses.
/// </summary>
public class ExchangeRateClient
{
    private readonly HttpClient _client;

    public ExchangeRateClient(IHttpClientFactory factory)
    {
        _client = factory.CreateClient("fx");   // pre-configured named client
    }

    public async Task<FxRate> GetRateAsync(string from, string to)
    {
        // Frankfurter returns:
        // {"amount":1.0,"base":"USD","date":"2026-08-04","rates":{"EUR":0.92}}
        var body = await _client.GetFromJsonAsync<FrankfurterResponse>(
            $"latest?from={from}&to={to}");

        var rate = body!.Rates[to];             // Dictionary lookup
        return new FxRate(from, to, rate, DateOnly.Parse(body.Date));
    }

    // GetFromJsonAsync uses web defaults (case-insensitive) — maps the lowercase JSON.
    private record FrankfurterResponse(
        decimal Amount, string Base, string Date, Dictionary<string, decimal> Rates);
}
```

**Step 2:** Register the named client and the typed client in `Program.cs`:

```csharp
// Named HttpClient for the FX service. Same IHttpClientFactory pattern Topic 10
// reuses for the payment processor — one pooled handler, no socket exhaustion.
builder.Services.AddHttpClient("fx", client =>
{
    client.BaseAddress = new Uri("https://api.frankfurter.app/");
});

builder.Services.AddScoped<ExchangeRateClient>();
```

**Step 3:** Inject it into `DocumentService` and use it in the statement. Update the constructor:

```csharp
using PaymentApp.Infrastructure.Clients;   // add at the top

private readonly ExchangeRateClient _fx;

public DocumentService(PaymentDbContext db, ExchangeRateClient fx)
{
    _db = db;
    _fx = fx;
    _uploadDir = Path.Combine(AppContext.BaseDirectory, "uploads");
    Directory.CreateDirectory(_uploadDir);
}
```

Then add the conversion block inside `BuildStatementAsync`, just before building the `StringBuilder`:

```csharp
// Optional: convert the balance to another currency using the live rate.
if (!string.IsNullOrEmpty(currency) &&
    !currency.Equals("USD", StringComparison.OrdinalIgnoreCase))
{
    var fx = await _fx.GetRateAsync("USD", currency.ToUpperInvariant());
    var converted = user.Balance * fx.Rate;
    lines.Add(($"Balance ({fx.To})", $"{converted:N2} @ {fx.Rate} on {fx.Date:yyyy-MM-dd}"));
}
```

**Test it:**

```bash
curl "http://localhost:5000/v1/document/statement?userId=1&currency=EUR"
```

**Expected output (rate varies):**

```
=== PaymentApp Account Statement ===
Generated: 2026-08-04 09:24:03 UTC

Account holder    : Alice
Email             : alice@bank.test
Current balance   : $1,000.00
Document on file  : 1_9f8c....txt
Balance (EUR)     : 920.00 @ 0.92 on 2026-08-04

Thank you for banking with PaymentApp.
```

**What this taught:**

| Tool | Where it showed up |
|------|--------------------|
| `IHttpClientFactory` + named client | `CreateClient("fx")`, base URL set once in `Program.cs` |
| `GetFromJsonAsync<T>` | GET + deserialize in one call (web defaults, case-insensitive) |
| `Dictionary<string, decimal>` | Reading `rates` out of the JSON response |
| `DateOnly.Parse` | Turning the response's date string into a typed value |

**The Topic 10 link:** this named-client-plus-typed-wrapper is exactly what `PaymentProcessorClient` becomes — only the client name (`"processor"`), base URL (from config), and endpoints change. You've already built the pattern.

**Interview talking point:** "I never `new` an `HttpClient`. I register a named client via `IHttpClientFactory` so the base URL and handler are configured once and the connection pool is reused — otherwise you get socket exhaustion under load. The typed wrapper keeps deserialization and error handling in one place."

---

## Standard library cheat-sheet

You've now used the big ones on real code. Here's the rest of the everyday surface — reach for these anywhere, no throwaway scripts needed.

**Strings**

| Task | Code |
|------|------|
| Trim / case | `s.Trim()`, `s.ToLower()`, `s.ToUpper()` |
| Contains / find | `s.Contains("x")`, `s.IndexOf("x")` (−1 if absent) |
| Replace | `s.Replace("a", "b")` |
| Split / join | `s.Split(',')`, `string.Join("-", items)` |
| Format money / number | `{amount:C}` → `$1,000.00`, `{n:N2}` → `1,234.57` |

**DateTime**

| Task | Code |
|------|------|
| Now (store this) | `DateTime.UtcNow` |
| Format | `{d:yyyy-MM-dd}`, `{d:HH:mm:ss}`, `{d:o}` (ISO) |
| Parse safely | `DateTime.TryParse(s, out var d)` |
| Math | `d.AddDays(7)`, `later - earlier` → `TimeSpan` |

**Collections**

| Type | Use | Key ops |
|------|-----|---------|
| `List<T>` | Ordered (JS `Array`) | `Add`, `list[i]`, `Contains`, `Find`, `Count` |
| `Dictionary<K,V>` | Key/value (JS `Map`) | `dict[k] = v`, `TryGetValue`, `ContainsKey` |
| `HashSet<T>` | Unique (JS `Set`) | `Add` (false if dup), `Contains` — e.g. `new HashSet<string>(list)` dedupes |

---

## What we learned

| Tool | Purpose | Node.js equivalent | Built into |
|------|---------|--------------------|------------|
| `System.Text.Json` | Parse/create JSON | `JSON.parse` / `JSON.stringify` | Metadata sidecar (8.1) |
| `File` / `Path` | Read/write files, build paths | `fs` / `path` | Sidecar + statement (8.1, 8.3) |
| `Stream` | Handle data in chunks | `Readable` / `Writable` | Download (8.2) |
| `StringBuilder` | Build strings efficiently | — | Statement (8.3) |
| `DateTime` | Dates and times | `Date` | Timestamps (8.1, 8.3) |
| `List` / `Dictionary` / `HashSet` | Collections | `Array` / `Map` / `Set` | Statement + FX (8.3, 8.4) |
| `HttpClient` + `IHttpClientFactory` | HTTP requests | `fetch` / `axios` | FX client (8.4) |

---

## Interview talking points

- "I use `IHttpClientFactory` (named clients) instead of `new HttpClient()` to avoid socket exhaustion — the handler and base URL are configured once and pooled."
- "`System.Text.Json` is the built-in library. I write camelCase + indented and read with `JsonSerializerDefaults.Web` so casing round-trips."
- "For downloads I stream (`File.OpenRead` → `FileStreamResult`) instead of buffering — memory stays flat regardless of file size."
- "`StringBuilder` beats `+=` in loops; composite format items like `{label,-18}` and `{amount:C}` handle alignment and currency."
- "I store timestamps in UTC and format only for display."

---

## Next: Topic 9

In Topic 9, we add authentication (login and registration that returns JWT tokens) to PaymentApp and protect the transfer and document endpoints.
