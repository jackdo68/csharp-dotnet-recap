# Topic 9: Auth — Register, Login, JWT, [Authorize]

## The one question this topic answers

> **How do login, tokens, and authorization work natively in ASP.NET Core — and how does "whose money is it?" become code?**

The app ships (Topic 8), but anyone with curl can move anyone's money. This topic finishes the course by locking it down: `/v1/login` verifies a password and issues a **JWT**; `[Authorize]` gates the money endpoints; and the transfer endpoint enforces *ownership* — you can only send money that's yours. One more lap for difference **#5**: authentication is `AddAuthentication` + attributes and middleware, not a Passport strategy zoo.

The Node mapping up front:

| Node world | This topic |
|---|---|
| `jwt.sign(payload, secret)` in your `/login` route | the login action + `JwtSecurityToken` |
| `express-jwt` / `passport-jwt` middleware | `AddJwtBearer()` + `UseAuthentication()` |
| `req.user` (monkey-patched by middleware) | `User` (`ClaimsPrincipal`) — typed, request-scoped, built in |
| the JWT payload object | **claims** (`sub`, `name`, `email`) |
| `JWT_SECRET` in `.env` | `Jwt:Key` in config → `Jwt__Key` env var (Topic 8's machinery) |

**You arrive with:** the composed, race-free `PaymentApp`. **You leave with:** the final spec — `register` and `login` public, `transfer` and `balance` private, balance read from the token instead of the URL.

## How the pieces fit (60 seconds)

```
POST /v1/login  { email, password }
      └─► verify password hash  ─► build claims (sub=id, name)  ─► sign JWT with Jwt:Key ─► return token

GET /v1/accounts/balance   Authorization: Bearer eyJ...
      └─► JwtBearer middleware: verify signature + expiry with the SAME Jwt:Key
            └─► claims become User  ─► [Authorize] passes  ─► action reads sub  ─► that user's balance
```

One service is both **issuer and validator**, sharing one symmetric key. That's the honest small-system design (it's what most Express apps do with `jsonwebtoken`). The moment *several* services need to validate the same tokens, you graduate to a separate identity server signing with a private key (OpenIddict or Duende IdentityServer in .NET land, or hosted Auth0/Entra/Keycloak) — the validation code you write today barely changes, which is why this is the right first rung.

## Build it

```bash
cd PaymentApp
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
```

### Config — the signing key

`appsettings.json` gains:

```json
{
  "Jwt": {
    "Key": "dev-only-key-change-me-32-chars-min!!",
    "Issuer": "paymentapp"
  }
}
```

The key must be ≥ 32 chars (HMAC-SHA256). In compose/production it arrives as the `Jwt__Key` env var from a secret store — never committed. (The dev value in the JSON file is fine *because* the env var beats it — Topic 8, exercise 8.2.)

### The contract grows — `Services/IPaymentService.cs`

```csharp
Task<User?> ValidateCredentialsAsync(string email, string password);
```

And in `PaymentService`:

```csharp
public async Task<User?> ValidateCredentialsAsync(string email, string password)
{
    var user = await _db.Users.SingleOrDefaultAsync(u => u.Email == email);
    if (user is null) return null;

    var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, password);
    return result == PasswordVerificationResult.Failed ? null : user;
}
```

The hasher you've been using since Topic 5 finally pays out its second half: `HashPassword` at register, `VerifyHashedPassword` at login. You never stored, logged, or compared a plaintext password anywhere in five topics.

### The login endpoint — `Controllers/UsersController.cs`

```csharp
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

public record LoginRequest(string Email, string Password);      // in Models/Requests.cs

[HttpPost("login")]                          // POST /v1/login
public async Task<ActionResult> Login(LoginRequest request)
{
    var user = await _payments.ValidateCredentialsAsync(request.Email, request.Password);
    if (user is null)
        return Unauthorized(new { error = "Invalid email or password." });   // 401, deliberately vague

    var key = new SymmetricSecurityKey(
        Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));            // IConfiguration, injected
    var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

    var token = new JwtSecurityToken(
        issuer: _config["Jwt:Issuer"],
        claims:
        [
            new Claim("sub", user.Id.ToString()),                // subject = user id
            new Claim("name", user.Name),
            new Claim("email", user.Email),
        ],
        expires: DateTime.UtcNow.AddHours(1),                    // short-lived, on purpose
        signingCredentials: creds);

    return Ok(new { token = new JwtSecurityTokenHandler().WriteToken(token) });
}
```

(Inject `IConfiguration _config` through the constructor like any other dependency — the platform pre-registers it, same as `ILogger<T>` in Topic 5.)

This *is* `jwt.sign({ sub, name, email }, secret, { expiresIn: '1h' })` — same three parts, same base64, same signature; C# just hands you the pieces as typed objects.

### Validation — `Program.cs`

```csharp
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;    // keep OUR claim names ("sub"), not legacy XML URIs
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)),
            ValidateAudience = false,        // single-audience system — skipped for simplicity
            NameClaimType = "name",          // wires User.Identity.Name to our claim
        };
    });
builder.Services.AddAuthorization();

// ...after Build():
app.UseAuthentication();    // WHO are you — must come first
app.UseAuthorization();     // are you ALLOWED — then this
app.MapControllers();
```

`MapInboundClaims = false` is worth a sentence: by default the JWT handler renames incoming claims to ancient SOAP-era URIs (`http://schemas.xmlsoap.org/.../nameidentifier`). Turning that off keeps your token's `sub` spelled `"sub"` — one honest line instead of a mapping table you'd otherwise debug at 6pm.

### Lock the endpoints — attributes and ownership

```csharp
[Authorize]                                   // token required for EVERYTHING here
[ApiController]
[Route("v1/accounts")]
public class AccountsController : ControllerBase
{
    [HttpGet("balance")]                      // GET /v1/accounts/balance — final spec: no userId in URL
    public async Task<ActionResult<decimal>> GetBalance()
    {
        var userId = int.Parse(User.FindFirstValue("sub")!);   // WHO, from the verified token
        var balance = await _payments.GetBalanceAsync(userId);
        if (balance is null) return NotFound();
        return Ok(balance);
    }
}
```

```csharp
[Authorize]
[Route("v1/payments")]
public class PaymentsController : ControllerBase
{
    [HttpPost("transfer")]
    public async Task<ActionResult> Transfer(TransferRequest request)
    {
        // AUTHORIZATION beyond "logged in": you may only move YOUR money.
        var callerId = int.Parse(User.FindFirstValue("sub")!);
        if (request.PayerUserId != callerId)
            return Forbid();                  // 403: we know who you are — and no

        // ... the Topic 7 transfer, unchanged
    }
}
```

`UsersController`'s `register` and `login` stay public — either leave the controller unattributed, or mark just those actions `[AllowAnonymous]` if you put `[Authorize]` at controller level.

Two things to notice:

- **`User` is the verified token.** The middleware checked the signature before your action ran; `FindFirstValue("sub")` cannot be forged short of breaking HMAC. Compare `req.user` — same idea, but here it's typed, and an unauthenticated request never reaches you at all.
- **401 vs 403, now in your own code.** No/bad token → **401** from the middleware ("who are you?"). Valid token, wrong payer → **403** from your `Forbid()` ("I know exactly who you are — no"). This distinction is a standard interview probe.

## What changed across the API (final spec reached)

| Endpoint | Before | Now |
|---|---|---|
| `POST /v1/register` | public | public |
| `POST /v1/login` | — | public, issues JWT |
| `GET /v1/accounts/{userId}/balance` | public, anyone reads anyone | `GET /v1/accounts/balance` — private, *own* balance via `sub` |
| `POST /v1/payments/transfer` | public, anyone moves anyone's money | private + payer must equal caller |

## Interview talking points

- The middleware pair and its order: `UseAuthentication` (establish identity) before `UseAuthorization` (enforce policy) — reversing them is the classic everything-401s bug.
- 401 vs 403: authentication failure vs authorization failure — and show you *implemented* both (`[Authorize]` gave the 401s; the payer-ownership check gave the 403).
- Claims are the JWT payload with a typed API; `MapInboundClaims = false` + `NameClaimType` is the two-line fix for the legacy claim-name renaming everyone hits once.
- Passwords: framework hasher (salted, iterated) from day one; login is `VerifyHashedPassword`, never string comparison — and the login error stays vague on purpose.
- The growth path, unprompted: "symmetric key, self-issued is right for one service; multiple services sharing tokens is when I'd move issuing to an OIDC server — OpenIddict/Duende self-hosted, or Auth0/Entra — and the validation side of my code would barely change."
