# Topic 5: Web API & Dependency Injection — batteries included

## The one question this topic answers

> **How does a real .NET service hang together — and why is dependency injection the organizing principle instead of an optional pattern?**

## The philosophy split

Node's philosophy: a minimal core, then *you assemble* the stack — Express, an ORM, validation, a test runner — and wire the pieces together yourself. .NET's philosophy: one platform **ships** the web framework (ASP.NET Core), the ORM (EF Core), config, logging, and — crucially — a built-in **dependency injection container** as the single organizing principle. You never `new` up a dependency: a class declares what it needs in its constructor, and the wiring is registered once at startup.

The other half is **convention over configuration**: controller classes auto-route from attributes, `IThing`/`Thing` pairs, the `Async` suffix, namespaces mirroring folders. More upfront structure than Node — but every unfamiliar .NET codebase looks broadly alike, which is exactly what you want when joining one.

## What we're building (Topics 5–10)

A small **payment service** — the app the rest of the course grows one topic at a time. It has **one** database model, `User`, and four endpoints across three controllers:

| Endpoint | Controller | Access | Arrives in |
|---|---|---|---|
| `POST /v1/auth/register` — name, email, password → new user | `AuthController` | public | **Topic 5** (returns a token from Topic 9) |
| `POST /v1/payment/transfer` — payer, payee, amount | `PaymentController` | public *for now* | **Topic 5** |
| `POST /v1/document/upload` — a `.txt`, stored on disk | `DocumentController` | private | Topic 7 |
| `POST /v1/auth/login` — email + password → JWT | `AuthController` | public | Topic 9 |

The whole domain is **one table**: a `User` with a name, email, hashed password, a `decimal Balance`, and a `File` (the name of an uploaded document). No separate `Account` table — the balance lives on the user, and there is deliberately **no get-balance endpoint** (you'd read it from the DB in a test). It lives in **PostgreSQL from day one**: you write the service once, against the real database, and Topic 6 unpacks how the data layer works.

> **The staged build.** Topic 5 register just *creates* the user (password hashed). Topic 7 adds document upload (the threading anchor) and exposes the race in transfer. Topic 8 ships it in Docker. Topic 9 adds login, JWT (register + login both return tokens), and the payer-is-you ownership check. Topic 10 rebuilds the plumbing production-style with an external processor reached via a `PaymentClient`.

## The shape of the app (essentials only — full code in Hands On)

Every layer is a small, single-purpose file. The dependency arrow points **downward**, and nothing ever `new`s up the thing below it — the container injects it:

```
Controllers  (HTTP shell)        AuthController · PaymentController
    │  depends on
Services     (business logic)    IAuthService/AuthService · IPaymentService/PaymentService
    │  depends on
Data         (DB session)        PaymentDbContext
    │  maps
Models       (domain + DTOs)     User · RegisterRequest · TransferRequest · UserResponse
```

**The one model** — a plain class that is *about to be* the database schema (Topic 3's runtime types are why no `schema.prisma` is needed):

```csharp
public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";   // NEVER the password itself
    public decimal Balance { get; set; }             // money = decimal. Always.
    public string? File { get; set; }                // uploaded doc filename (Topic 7)
}
```

**DTOs are `record`s** (Topic 2's rule — immutable data that flows). The response type is deliberately *not* the entity, so `PasswordHash` can't leak into JSON — the same reason your Node code never `res.json(userDoc)` straight from Mongo:

```csharp
public record RegisterRequest(string Name, string Email, string Password);
public record TransferRequest(int PayerUserId, int PayeeUserId, decimal Amount);
public record UserResponse(int Id, string Name, string Email);
```

**Two services, each behind an interface.** Controllers depend on the *interface*, never the concrete class — so tests can hand them a fake (Topic 6), and the container binds by the declared relationship (Topic 2's nominal typing):

```csharp
public interface IAuthService
{
    Task<User> RegisterAsync(RegisterRequest request);   // login/token added in Topic 9
}

public interface IPaymentService
{
    Task TransferAsync(int payerUserId, int payeeUserId, decimal amount);
}
```

**Controllers are thin HTTP shells** — they translate a service result (or a typed exception) into an HTTP status and get out of the way. The service *states what went wrong* with a typed exception (Topic 4); the controller *decides what that means in HTTP*:

```csharp
[ApiController]
[Route("v1/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _auth;
    public AuthController(IAuthService auth) => _auth = auth;   // constructor injection

    [HttpPost("register")]                       // POST /v1/auth/register
    public async Task<ActionResult<UserResponse>> Register(RegisterRequest request)
    {
        var user = await _auth.RegisterAsync(request);
        return CreatedAtAction(nameof(Register), new UserResponse(user.Id, user.Name, user.Email));
    }
}
```

The full `AuthController`, `PaymentController`, both services, the `PaymentDbContext`, and the `Program.cs` wiring are built end-to-end in **Hands On** — that's where you type the app in.

New syntax you'll meet across those files:

- `[ApiController]`, `[Route(...)]`, `[HttpPost]` — **attributes**: C#'s decorators, exactly NestJS's `@Controller()` / `@Post()`, in square brackets above the target.
- `: ControllerBase` / `: IAuthService` — the colon is `extends` and `implements` in one.
- `ActionResult<T>` — "either a `T` or any HTTP result like `NotFound()`" — how a nominal language expresses TS's union return.
- `=> _auth = auth;` — an expression-bodied constructor: the same one-liner arrow from Topic 2.
- `new { status = "completed" }` — an **anonymous type**: the one place C# allows an ad-hoc object literal.

## Dependency injection registration

The wiring lives in `Program.cs` and is read once at startup. This single block is the "assemble it yourself" of Express, done declaratively:

```csharp
builder.Services.AddControllers();
builder.Services.AddDbContext<PaymentDbContext>(o => o.UseNpgsql(connectionString));
builder.Services.AddScoped<IAuthService, AuthService>();       // "when asked for IAuthService, give AuthService"
builder.Services.AddScoped<IPaymentService, PaymentService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
```

## DI lifetimes (you will get asked this)

- **`AddScoped`** — one instance per HTTP request (the usual default).
- **`AddTransient`** — a new instance every time it's asked for.
- **`AddSingleton`** — one instance for the whole app lifetime.

Read the registrations through that lens — each chose deliberately:

| Registration | Lifetime | Why |
|---|---|---|
| `PaymentDbContext` | **scoped** | one DB session = one unit of work per request; sharing it app-wide would leak state between requests |
| `IAuthService` / `IPaymentService` | **scoped** | each holds the scoped `DbContext`, so it must not outlive one — a service's lifetime is bounded by its *shortest-lived* dependency |
| `IPasswordHasher<User>` | **singleton** | stateless and thread-safe — one instance serves everyone forever |

That second row has real teeth: a longer-lived service holding a shorter-lived dependency is a **captive dependency**, and the container refuses to build one — Hands On makes you trigger that refusal on purpose and read the error.

> **"Scoped" ≠ "a database connection per request."** The `DbContext` is a *session* — the change tracker and unit-of-work bookkeeping — and it's cheap; that's what's per-request. The physical Postgres connection is a separate layer with a shorter lifetime: EF Core rents one from Npgsql's **connection pool** only when it actually hits the DB (a query, `SaveChangesAsync`) and returns it the instant that operation finishes — not at the end of the request (a transaction is the exception; it holds one open). So concurrent requests each get their own `DbContext` but share a pool of ~100 reused connections — exactly like `pg`/Prisma, where each query borrows from a pool rather than opening a new `pg.Client`. (This is also *why* `DbContext` isn't thread-safe — one sequential session — while the pool underneath it is.)

### What's actually in memory while the app runs — two tiers

The lifetimes split everything into two tiers, and the split *is* the design:

- **Tier 1 — resident for the whole process** (built once at startup, disposed only at shutdown): the **container** itself, the **registrations** (the `interface → implementation + lifetime` *recipes* — the container keeps the recipe forever and mints instances from it), and every **singleton** — `IPasswordHasher<User>`, config, logging, `IHttpClientFactory`, and Npgsql's **connection pool with its live TCP connections**.
- **Tier 2 — created per request, released at request end**: the request **scope**, the **controller**, the **scoped** services (`DbContext`, `AuthService`, `PaymentService`), and any transients. When the response is sent, the scope is disposed — scoped `IDisposable`s get `Dispose()`d deterministically (the `DbContext` returns its connection to the pool), then the objects become garbage the GC reclaims later.

| Per request, freed after? | | Resident for app lifetime? | |
|---|---|---|---|
| controller instance | **yes** | the container | **no** (stays) |
| `AuthService` / `PaymentService` | **yes** | the registrations (recipes) | **no** (stays) |
| `PaymentDbContext` instance | **yes** (session ends) | singletons (hasher, config) | **no** (stays) |
| the DB *connection* it used | **no** — back to the pool | the connection pool + its sockets | **no** (stays) |

The trade in one line: you pay a fixed cost — the container, the recipes, and the singletons stay in memory — so that minting a fresh controller + service + `DbContext` per request is cheap and their resources release deterministically the moment the response is sent. **Node anchor:** your Express app already has this shape informally — a module-level `new Pool()` / singleton Prisma client lives for the process (Tier 1) while each handler's locals die per request (Tier 2); .NET just names the two tiers (`AddSingleton` vs `AddScoped`) and adds a deterministic `Dispose` at the request boundary.

> **Watch out:** fire-and-forget work that outlives the response (`_ = Task.Run(() => useTheDbContext())`) will hit `ObjectDisposedException` — the scope disposed the `DbContext` out from under it. The fix is a fresh scope via `IServiceScopeFactory`, which is exactly Topic 10's background-auditor pattern.

## Trace one request (so the magic is mechanical)

1. `POST /v1/payment/transfer` arrives; ASP.NET Core matches it to `PaymentController.Transfer`.
2. To build the controller, the container sees it needs `IPaymentService`; building *that* needs `PaymentDbContext` — it resolves the whole graph by reading constructor parameter *types at runtime* (Topic 3's runtime types making Topic 5's DI possible).
3. The JSON body is auto-deserialized into `TransferRequest` — Topic 4's boundary enforcement; `{"amount":"heaps"}` becomes an automatic 400 before your code runs.
4. `await _db...` frees the thread during the real SQL round-trip (Topic 7 explains where it goes).
5. The returned object is auto-serialized to JSON (camelCased for JS clients).

In Express you'd wire middleware and instantiate everything yourself. Here the wiring comes from registrations — more upfront structure, far less glue code.

## Interview talking points

- Constructor injection + the three lifetimes (`Scoped` vs `Transient` vs `Singleton`) — the most likely C#-specific question. Know the failure story: a **captive dependency** (singleton holding a scoped `DbContext`), caught by the container at startup.
- *Why* DI: loose coupling and testability — hand the service a fake database in tests (Topic 6 does exactly that), no module-mocking rituals.
- Controllers depend on interfaces, never concrete classes; the container binds by declared relationships (Topic 2's nominal typing).
- Attributes ≈ decorators; `[ApiController]` gives automatic model validation → 400s.
- Return DTOs, not entities — "so the password hash can't leak into JSON" is a senior-sounding sentence because it's a junior-shaped bug.
