# Topic 5: Web API & Dependency Injection

> **How does a real .NET service hang together — and why is DI the organizing principle?**

## Node vs .NET philosophy

| Node | .NET |
|------|------|
| Minimal core, you assemble the stack | Batteries included (web, ORM, config, logging) |
| You wire dependencies yourself | Built-in DI container wires everything |
| Freedom to choose | Convention over configuration |

**Key .NET conventions:**
- Controller classes auto-route from attributes
- `IThing`/`Thing` interface pairs
- `Async` suffix on async methods
- Namespaces mirror folders

## What we're building (Topics 5–10)

A **PaymentApp** — one table, four endpoints:

| Endpoint | Controller | Topic |
|----------|------------|-------|
| `POST /v1/auth/register` | `AuthController` | 5 |
| `POST /v1/payment/transfer` | `PaymentController` | 5 |
| `POST /v1/document/upload` | `DocumentController` | 7 |
| `POST /v1/auth/login` | `AuthController` | 9 |

**The `User` model:**
- `Id`, `Name`, `Email`, `PasswordHash`, `Balance` (decimal), `File` (uploaded doc)
- No separate `Account` table — balance lives on the user
- PostgreSQL from day one

**The staged build:**

| Topic | Adds |
|-------|------|
| 5 | Register (creates user), Transfer |
| 7 | Document upload, exposes race condition |
| 8 | Docker deployment |
| 9 | Login, JWT, ownership checks |
| 10 | External processor via `PaymentClient` |

## App structure

```
Controllers  →  Services  →  DbContext  →  Models
(HTTP shell)    (logic)      (DB session)   (domain)
```

Dependencies point downward. Nothing ever `new`s up the layer below — the container injects it.

### The model (no schema file needed — types are the schema)

```csharp
public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";  // NEVER the password itself
    public decimal Balance { get; set; }            // money = decimal
    public string? File { get; set; }               // uploaded doc (Topic 7)
}
```

### DTOs are `record`s (immutable data that flows)

```csharp
public record RegisterRequest(string Name, string Email, string Password);
public record TransferRequest(int PayerUserId, int PayeeUserId, decimal Amount);
public record UserResponse(int Id, string Name, string Email);  // no PasswordHash!
```

### Services behind interfaces (for testability)

```csharp
public interface IAuthService
{
    Task<User> RegisterAsync(RegisterRequest request);
}

public interface IPaymentService
{
    Task TransferAsync(int payerUserId, int payeeUserId, decimal amount);
}
```

### Controllers are thin HTTP shells

```csharp
[ApiController]
[Route("v1/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _auth;
    public AuthController(IAuthService auth) => _auth = auth;  // constructor injection

    [HttpPost("register")]
    public async Task<ActionResult<UserResponse>> Register(RegisterRequest request)
    {
        var user = await _auth.RegisterAsync(request);
        return CreatedAtAction(nameof(Register), new UserResponse(user.Id, user.Name, user.Email));
    }
}
```

### What is `ActionResult<T>`?

A wrapper that lets you return **either** a success response (the `T`) **or** an HTTP error — without changing the return type:

```csharp
public async Task<ActionResult<UserResponse>> Register(RegisterRequest request)
{
    // Return the actual object → 200 OK with JSON body
    return Ok(new UserResponse(...));

    // Or return errors
    return BadRequest(new { error = "Invalid email" });  // 400
    return NotFound();                                    // 404
    return Forbid();                                      // 403
    return CreatedAtAction(...);                          // 201
}
```

In TypeScript/Express, you'd do `res.status(400).json({...})` — same idea, different spelling. The `ActionResult<T>` return type tells Swagger what the success shape looks like (`UserResponse`), while still allowing error responses.

**Common `ControllerBase` helper methods:**

| Method | HTTP Status | When to use |
|--------|-------------|-------------|
| `Ok(value)` | 200 | Success with data |
| `CreatedAtAction(action, value)` | 201 | Resource created — includes `Location` header |
| `NoContent()` | 204 | Success, no body |
| `BadRequest(value)` | 400 | Invalid input |
| `NotFound()` | 404 | Resource doesn't exist |
| `Forbid()` | 403 | Not allowed |
| `Unauthorized()` | 401 | Not authenticated |

### Where does a request bind from? (body / route / query)

The `Register(RegisterRequest request)` above never says *where* `request` comes from — `[ApiController]` **infers** the source from the parameter's type and the route template:

| Parameter | Inferred source | Attribute | Wire location |
|-----------|-----------------|-----------|---------------|
| Complex type (`record`/class) | body | `[FromBody]` (implied) | JSON body |
| Simple type matching a `{token}` | route | `[FromRoute]` | `/users/{id}` |
| Any other simple type | query | `[FromQuery]` | `?page=2` |
| `IFormFile` | form | `[FromForm]` | multipart |

So a `RegisterRequest` record → JSON body, `camelCase` on the wire (`Password` ⇄ `password`). An action can mix all three:

```csharp
// POST /v1/payment/users/1/transfer?idempotencyKey=abc-123
// body: { "payeeUserId": 2, "amount": 100.00 }
[HttpPost("users/{payerUserId}/transfer")]
public IActionResult Transfer(
    int payerUserId,                    // [FromRoute] — name matches {payerUserId}
    [FromQuery] string idempotencyKey,  // query string
    TransferBody body)                  // [FromBody] — complex type, inferred
```

Two rules: **only one `[FromBody]` per action** (the body stream deserializes once), and **never** put secrets like `Password` in route/query (URLs get logged and cached) — that's why the auth DTOs are body-bound.

> **Node/TS anchor:** this is Express's `req.body` / `req.params` / `req.query`, or NestJS's `@Body()` / `@Param()` / `@Query()` — same three sources. The C# nicety: `[ApiController]` infers the common cases, so you drop the `@Body()`/`@Param()` boilerplate. Without `[ApiController]` there's no inference and you write `[FromBody]` yourself.

### New syntax cheat sheet

| C# | Meaning | Node/TS equivalent |
|----|---------|-------------------|
| `[ApiController]` | Attribute (decorator) | `@Controller()` in NestJS |
| `: ControllerBase` | Inheritance | `extends` |
| `: IAuthService` | Interface implementation | `implements` |
| `ActionResult<T>` | T or HTTP result | Union return type |
| `new { x = 1 }` | Anonymous type | Object literal |

## DI registration

All wiring lives in `Program.cs`, read once at startup:

```csharp
builder.Services.AddControllers();
builder.Services.AddDbContext<PaymentDbContext>(o => o.UseNpgsql(connectionString));
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPaymentService, PaymentService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
```

Those five lines are **two different kinds of method**, and it matters:

| Category | Methods here | What it registers |
|----------|--------------|-------------------|
| **Lifetime primitives** | `AddScoped`, `AddSingleton` (and `AddTransient`) | *One* service + how long its instance lives |
| **Feature bundles** | `AddControllers`, `AddDbContext` | *Many* registrations + config, built on top of the primitives |

- `AddScoped<IAuthService, AuthService>()` is a primitive — one service, one lifetime.
- `AddDbContext<PaymentDbContext>(…)` is a bundle that **internally calls `AddScoped`** (Scoped is its default) and also wires up `DbContextOptions` with your provider/connection string. That's *why* `DbContext` shows up under Scoped below — `AddDbContext` **is** a scoped registration, it just doesn't say so on the tin.
- `AddControllers()` isn't a lifetime registration at all — it turns on the whole MVC subsystem (routing, model binding, JSON). And the twist: your controllers are **not** registered in the container by default; a per-request *controller activator* creates them (pulling their constructor deps from DI). So a controller behaves "new per request" through a different mechanism than `AddScoped`.

> **Node/TS anchor:** the primitives are NestJS's `@Injectable({ scope })` — one provider, one lifetime. The bundles are the module `imports` (`TypeOrmModule.forRoot()`, `JwtModule.register()`) — a feature module that registers a pile of providers with sensible lifetimes for you. `AddDbContext` speaks "scoped"; `AddControllers` speaks "wire up MVC."

## DI lifetimes (interview favorite)

| Lifetime | Meaning | Use for |
|----------|---------|---------|
| `AddScoped` | One instance per HTTP request | DbContext, services |
| `AddTransient` | New instance every time | Lightweight, stateless helpers |
| `AddSingleton` | One instance for app lifetime | Stateless, thread-safe utilities |

**PaymentApp choices:**

| Registration | Lifetime | Why |
|--------------|----------|-----|
| `PaymentDbContext` | Scoped | One DB session per request |
| `AuthService`, `PaymentService` | Scoped | Hold scoped DbContext |
| `IPasswordHasher<User>` | Singleton | Stateless, thread-safe |

⚠️ **Captive dependency:** A singleton holding a scoped service = error. The container catches this at startup.

**DbContext ≠ connection:**
- `DbContext` (scoped) = session + change tracker — cheap, per-request
- Connection = borrowed from pool only during actual DB calls, returned immediately
- Same as `pg`/Prisma connection pooling

## Memory: two tiers

| Tier 1 — App lifetime | Tier 2 — Per request |
|-----------------------|----------------------|
| Container + registrations | Controller instance |
| Singletons (hasher, config) | Scoped services (AuthService, PaymentService) |
| Connection pool + TCP sockets | DbContext instance |

**The trade-off:** Fixed cost (Tier 1 stays in memory) so that minting fresh per-request objects is cheap and resources release immediately when the response is sent.

**Node equivalent:** Module-level `new Pool()` / Prisma client = Tier 1. Handler locals = Tier 2.

⚠️ **Fire-and-forget trap:**

```csharp
_ = Task.Run(() => useTheDbContext());  // ❌ DbContext disposed after response
```

Fix: Create a fresh scope via `IServiceScopeFactory` (Topic 10).

## Request lifecycle

| Step | What happens |
|------|--------------|
| 1 | `POST /v1/payment/transfer` arrives |
| 2 | ASP.NET matches route → `PaymentController.Transfer` |
| 3 | Container builds controller → needs `IPaymentService` → needs `DbContext` (resolves whole graph via runtime types) |
| 4 | JSON body → `TransferRequest` (invalid JSON = automatic 400) |
| 5 | `await _db...` frees thread during DB round-trip |
| 6 | Return object → JSON (camelCased) |

## Interview talking points

- **Three lifetimes:** Scoped (per-request), Transient (every time), Singleton (app lifetime). Know the captive dependency failure.
- **Why DI:** Loose coupling + testability. Hand services a fake DB in tests (Topic 6).
- **Controllers:** Depend on interfaces, not concrete classes. Container binds by declared types.
- **Attributes:** `[ApiController]` = automatic model validation → 400s. Same as NestJS decorators.
- **DTOs vs entities:** Return DTOs so password hash can't leak into JSON.
