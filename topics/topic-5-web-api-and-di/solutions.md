# Topic 5: Solutions

## 5.1 — Prove it works

- `POST` returns **201** with `Location: .../api/loans/1` (from `CreatedAtAction`) and the created loan as JSON.
- `GET /api/loans/999` returns **404** from `return NotFound();` — a typed HTTP outcome, not an exception or crash.
- `{"amount":"heaps"}` returns **400** with a problem-details body naming `$.amount` — `[ApiController]` + the deserializer rejecting the payload at the boundary (Topic 4's `JsonException`, translated to HTTP automatically). You wrote zero validation code.

## 5.2 — Break it with the wrong lifetime

1. With `AddScoped`, **GET returns `[]` even right after a successful POST.** Each HTTP request gets its own DI scope, so each request gets a *fresh* `LoanService` — a brand-new empty `List<>`. The POST's service instance (and its data) is garbage once that request ends.
2. With `AddSingleton`, the controller is still built per request, but the container hands *every* controller the **same one** `LoanService` instance — so the list lives as long as the app.
3. Typical answers:
   - **Scoped:** the EF Core `DbContext` — one unit-of-work per request (Topic 6).
   - **Transient:** a cheap, stateless helper — e.g. a validator or a `RiskScoreCalculator`.
   - **Singleton:** something expensive and thread-safe shared by everyone — an `HttpClient`-based API client, a cache, configuration.

**Talking point:** "a singleton holding per-request state" is the classic DI bug — you just built it on purpose (inverted: scoped holding app-wide state). Interviewers love this story.

## 5.3 — The approve endpoint

`Services/ILoanService.cs` — add:

```csharp
Task<LoanApplication?> ApproveAsync(int id);
```

`Services/LoanService.cs` — add:

```csharp
public Task<LoanApplication?> ApproveAsync(int id)
{
    var loan = _loans.FirstOrDefault(l => l.Id == id);
    if (loan is not null) loan.Status = "Approved";
    return Task.FromResult(loan);
}
```

`Controllers/LoansController.cs` — add:

```csharp
[HttpPut("{id}/approve")]                       // PUT /api/loans/5/approve
public async Task<ActionResult<LoanApplication>> Approve(int id)
{
    var loan = await _loanService.ApproveAsync(id);
    if (loan is null) return NotFound();
    return Ok(loan);
}
```

```bash
curl -X POST http://localhost:PORT/api/loans -H "Content-Type: application/json" \
  -d '{"applicantName":"Alice","amount":300000}'
curl -X PUT http://localhost:PORT/api/loans/1/approve      # 200, status "Approved"
curl -X PUT http://localhost:PORT/api/loans/99/approve -i  # 404
```

Note what you did *not* touch: `Program.cs`. The registration maps the interface to the class once; growing the interface is invisible to the wiring.

## 5.4 — A second injected dependency

```csharp
public class LoansController : ControllerBase
{
    private readonly ILoanService _loanService;
    private readonly ILogger<LoansController> _logger;

    public LoansController(ILoanService loanService, ILogger<LoansController> logger)
    {
        _loanService = loanService;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult<LoanApplication>> Create(CreateLoanRequest request)
    {
        if (request.Amount > 1_000_000)
            _logger.LogWarning("Jumbo loan requested: {Applicant} wants {Amount}",
                request.ApplicantName, request.Amount);

        var loan = await _loanService.CreateAsync(request);
        return CreatedAtAction(nameof(GetById), new { id = loan.Id }, loan);
    }
    // ... rest unchanged
}
```

(The `{Applicant}` placeholders are **structured logging** — named properties, not string interpolation; log aggregators index them. Use this, not `$"..."`, in log calls.)

**What it tells you:** the platform pre-registers dozens of services (logging, config, `HttpClientFactory`, hosting) in the same container your own services go into. "Batteries included" isn't a list of libraries — it's one container everything shares. You added a constructor parameter and the wiring came from the platform.
