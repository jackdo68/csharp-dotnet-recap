# Topic 5: Web API & Dependency Injection — batteries included

## The one question this topic answers

> **How does a real .NET service hang together — and why is dependency injection the organizing principle instead of an optional pattern?**

## The philosophy split

Node's philosophy: a minimal core, then *you assemble* the stack — Express, an ORM, validation, a test runner — and wire the pieces together yourself. .NET's philosophy: one platform **ships** the web framework (ASP.NET Core), the ORM (EF Core), config, logging, and — crucially — a built-in **dependency injection container** as the single organizing principle. You never `new` up a dependency: a class declares what it needs in its constructor, and the wiring is registered once at startup.

The other half is **convention over configuration**: `LoansController` auto-routes to `api/loans`, `IThing`/`Thing` pairs, the `Async` suffix, namespaces mirroring folders. More upfront structure than Node — but every unfamiliar .NET codebase looks broadly alike, which is exactly what you want when joining one.

## Build it: the Loan Application API

```bash
dotnet new webapi --use-controllers -n LoanApp
cd LoanApp
dotnet run    # note the port, Ctrl+C to stop
rm Controllers/WeatherForecastController.cs WeatherForecast.cs 2>/dev/null
```

(`--use-controllers` gives the classic controller style — what banks use and interviewers expect — rather than minimal APIs, which are Express-style route lambdas.)

### The domain model — `Models/LoanApplication.cs`

```csharp
namespace LoanApp.Models;

public class LoanApplication
{
    public int Id { get; set; }
    public string ApplicantName { get; set; } = "";
    public decimal Amount { get; set; }
    public string Status { get; set; } = "Pending";
}
```

### The request DTO — `Models/CreateLoanRequest.cs`

```csharp
namespace LoanApp.Models;

// The shape the client sends us. No Id/Status — the server owns those.
public record CreateLoanRequest(string ApplicantName, decimal Amount);
```

Class for the entity (mutable state), record for the DTO (immutable data) — the Topic 2 rule earning its keep.

### The contract — `Services/ILoanService.cs`

```csharp
using LoanApp.Models;

namespace LoanApp.Services;

// The contract. Controllers depend on THIS, not the concrete class.
public interface ILoanService
{
    Task<List<LoanApplication>> GetAllAsync();
    Task<LoanApplication?> GetByIdAsync(int id);
    Task<LoanApplication> CreateAsync(CreateLoanRequest request);
}
```

### A first implementation — `Services/LoanService.cs`

In-memory for now; Topic 6 swaps in a real database *without touching the controller* — that's the payoff of the interface.

```csharp
using LoanApp.Models;

namespace LoanApp.Services;

public class LoanService : ILoanService
{
    private readonly List<LoanApplication> _loans = new();
    private int _nextId = 1;

    public Task<List<LoanApplication>> GetAllAsync()
    {
        // No real awaiting yet, so wrap the value in a completed Task.
        return Task.FromResult(_loans);   // Task.FromResult = Promise.resolve
    }

    public Task<LoanApplication?> GetByIdAsync(int id)
    {
        var loan = _loans.FirstOrDefault(l => l.Id == id);  // LINQ .find()
        return Task.FromResult(loan);
    }

    public Task<LoanApplication> CreateAsync(CreateLoanRequest request)
    {
        var loan = new LoanApplication
        {
            Id = _nextId++,
            ApplicantName = request.ApplicantName,
            Amount = request.Amount,
            Status = "Pending"
        };
        _loans.Add(loan);
        return Task.FromResult(loan);
    }
}
```

(`private readonly List<...> _loans` — underscore prefix for private fields; `readonly` = the *reference* can't be reassigned, like `const`.)

### The controller — `Controllers/LoansController.cs`

```csharp
using LoanApp.Models;
using LoanApp.Services;
using Microsoft.AspNetCore.Mvc;

namespace LoanApp.Controllers;

[ApiController]                 // enables model validation + nice defaults
[Route("api/[controller]")]    // [controller] => "loans" (class name minus 'Controller')
public class LoansController : ControllerBase
{
    private readonly ILoanService _loanService;

    // Constructor injection: .NET hands us the service automatically.
    public LoansController(ILoanService loanService)
    {
        _loanService = loanService;
    }

    [HttpGet]                                   // GET /api/loans
    public async Task<ActionResult<List<LoanApplication>>> GetAll()
    {
        var loans = await _loanService.GetAllAsync();
        return Ok(loans);                       // 200 + JSON body
    }

    [HttpGet("{id}")]                           // GET /api/loans/5
    public async Task<ActionResult<LoanApplication>> GetById(int id)
    {
        var loan = await _loanService.GetByIdAsync(id);
        if (loan is null) return NotFound();    // 404
        return Ok(loan);
    }

    [HttpPost]                                  // POST /api/loans
    public async Task<ActionResult<LoanApplication>> Create(CreateLoanRequest request)
    {
        var loan = await _loanService.CreateAsync(request);
        // 201 Created + a Location header pointing at the new resource
        return CreatedAtAction(nameof(GetById), new { id = loan.Id }, loan);
    }
}
```

Unpacking the new syntax:

- `[ApiController]`, `[Route(...)]`, `[HttpGet]` — **attributes**: C#'s decorators. If you've seen NestJS, they're exactly `@Controller()` / `@Get(':id')`, written in square brackets above the target.
- `: ControllerBase` — the colon is `extends` and `implements` in one (base class first, then interfaces).
- `ActionResult<T>` — "either a `T` or any HTTP result like `NotFound()`": how a nominal language expresses TS's union return.
- `nameof(GetById)` — compile-time string `"GetById"`, refactor-safe.
- `new { id = loan.Id }` — an **anonymous type**: the one place C# allows an ad-hoc object literal; used for route values.

### Wire it up — `Program.cs`

```csharp
using LoanApp.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// 👇 THIS is dependency injection registration.
// "When something asks for ILoanService, give it a LoanService."
// Singleton here because our store is an in-memory list — one instance
// for the whole app, or the data vanishes between requests.
builder.Services.AddSingleton<ILoanService, LoanService>();

var app = builder.Build();

app.MapControllers();

app.Run();
```

## DI lifetimes (you will get asked this)

- **`AddScoped`** — one instance per HTTP request (the usual default).
- **`AddTransient`** — a new instance every time it's asked for.
- **`AddSingleton`** — one instance for the whole app lifetime.

We used `AddSingleton` above only because the service *is* the data store right now — with `AddScoped`, every request would get a fresh empty list. Once a real database holds the data (Topic 6), the service switches to the usual `AddScoped`. The exercises make you watch this go wrong.

## Trace one request (so the magic is mechanical)

1. `POST /api/loans` arrives; ASP.NET Core matches it to `LoansController.Create`.
2. To build the controller, the DI container sees the constructor needs `ILoanService`, looks up the registration, and injects a `LoanService`. It reads the constructor's parameter *types at runtime* — Topic 3's runtime types making Topic 5's DI possible.
3. The JSON body is auto-deserialized into `CreateLoanRequest` — Topic 4's boundary enforcement; mismatched payloads become automatic 400s.
4. `await` frees the thread during real I/O (Topic 7 explains where it goes).
5. The returned object is auto-serialized to JSON.

In Express you'd wire middleware and instantiate everything yourself. Here the wiring comes from registrations — more upfront structure, far less glue code.

## Interview talking points

- Constructor injection + the three lifetimes (`Scoped` vs `Transient` vs `Singleton`) — the most likely C#-specific question. Know a failure story: a singleton holding per-request state.
- *Why* DI: loose coupling and testability — swap the real service for a fake in tests (Topic 6 does exactly that).
- Controllers depend on interfaces, never concrete classes; the container binds by declared relationships (Topic 2's nominal typing).
- Attributes ≈ decorators; `[ApiController]` gives automatic model validation → 400s.
