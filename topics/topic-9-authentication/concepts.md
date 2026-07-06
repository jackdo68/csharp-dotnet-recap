# Topic 9: Auth — Register, Login, JWT, [Authorize]

## The one question this topic answers

> **How do login, tokens, and authorization work natively in ASP.NET Core — and how does "whose money is it?" become code?**

The app ships (Topic 8), but anyone with curl can move anyone's money. This topic locks it down: `/v1/auth/register` and `/v1/auth/login` both issue a **JWT**; `[Authorize]` gates the money and document endpoints; and the transfer endpoint enforces *ownership* — you can only send money that's yours. One more lap for difference **#5**: authentication is `AddAuthentication` + attributes and middleware, not a Passport strategy zoo.

The Node mapping up front:

| Node world | This topic |
|---|---|
| `jwt.sign(payload, secret)` in your `/login` route | `AuthService.CreateToken` + `JwtSecurityToken` |
| `express-jwt` / `passport-jwt` middleware | `AddJwtBearer()` + `UseAuthentication()` |
| `req.user` (monkey-patched by middleware) | `User` (`ClaimsPrincipal`) — typed, request-scoped, built in |
| the JWT payload object | **claims** (`sub`, `name`, `email`) |
| `JWT_SECRET` in `.env` | `Jwt:Key` in config → `Jwt__Key` env var (Topic 8's machinery) |

**You arrive with:** the composed, race-free `PaymentApp`. **You leave with:** the final spec — `register` and `login` both return a token; `transfer` and `document/upload` private; the caller's id comes from the **token**, never the request body or URL.

## How the pieces fit (60 seconds)

```
POST /v1/auth/login  { email, password }
      └─► verify password hash ─► build claims (sub=id, name) ─► sign JWT with Jwt:Key ─► return token
(POST /v1/auth/register does the same — creates the user, then issues a token immediately.)

POST /v1/payment/transfer   Authorization: Bearer eyJ...   { payeeUserId, amount }
      └─► JwtBearer middleware: verify signature + expiry with the SAME Jwt:Key
            └─► claims become User ─► [Authorize] passes ─► action reads sub as the PAYER
                  └─► payer can only ever be the caller — ownership enforced
```

One service is both **issuer and validator**, sharing one symmetric key. That's the honest small-system design (it's what most Express apps do with `jsonwebtoken`). The moment *several* services need to validate the same tokens, you graduate to a separate identity server signing with a private key (OpenIddict or Duende IdentityServer in .NET land, or hosted Auth0/Entra/Keycloak) — the validation code you write today barely changes, which is why this is the right first rung.

## The essentials (full code in Hands On)

```bash
cd PaymentApp
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
```

**The signing key** lives in config (`appsettings.json` → `Jwt:Key`, ≥ 32 chars for HMAC-SHA256). In compose/production it arrives as the `Jwt__Key` env var from a secret store — never committed. The dev value in JSON is fine *because* the env var beats it (Topic 8, exercise 8.2).

**Login verifies the hash** — `AuthService` finally cashes in the hasher's second half. `HashPassword` at register (Topic 5), `VerifyHashedPassword` at login; no plaintext password was ever stored, logged, or compared:

```csharp
public async Task<User?> ValidateCredentialsAsync(string email, string password)
{
    var user = await _db.Users.SingleOrDefaultAsync(u => u.Email == email);
    if (user is null) return null;
    var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, password);
    return result == PasswordVerificationResult.Failed ? null : user;
}
```

**Issuing the token** is `jwt.sign({ sub, name, email }, secret, { expiresIn: '1h' })` — same three parts, same base64, same signature; C# hands you the pieces as typed objects. Both register and login call one `AuthService.CreateToken(user)`:

```csharp
public string CreateToken(User user)
{
    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
    var token = new JwtSecurityToken(
        issuer: _config["Jwt:Issuer"],
        claims:
        [
            new Claim("sub", user.Id.ToString()), new Claim("name", user.Name),
            new Claim("email", user.Email),
        ],
        expires: DateTime.UtcNow.AddHours(1),                              // short-lived on purpose
        signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
    return new JwtSecurityTokenHandler().WriteToken(token);
}
```

**Validation is registered once** in `Program.cs` (`AddAuthentication().AddJwtBearer(...)` with the same `Jwt:Key`, then the middleware pair). The one line worth calling out: `MapInboundClaims = false`, which keeps your token's `sub` spelled `"sub"` instead of being renamed to an ancient SOAP-era URI — one honest line instead of a mapping table you'd debug at 6pm. And the order is load-bearing:

```csharp
app.UseAuthentication();    // WHO are you — must come first
app.UseAuthorization();     // are you ALLOWED — then this
```

**Locking the endpoints** is `[Authorize]` plus, for money, an *ownership* check. The caller's id comes from the verified token — it cannot be forged short of breaking HMAC, so the payer is never trusted from the body:

```csharp
[Authorize]
[Route("v1/payment")]
public class PaymentController : ControllerBase
{
    [HttpPost("transfer")]
    public async Task<ActionResult> Transfer(TransferRequest request)
    {
        var callerId = int.Parse(User.FindFirstValue("sub")!);   // WHO, from the token
        if (request.PayerUserId != callerId)
            return Forbid();                  // 403: we know who you are — and no
        // ... the Topic 7 transfer, unchanged
    }
}
```

`DocumentController` gets the same treatment — `[Authorize]`, and the upload takes `userId` from the token instead of the query string (`var userId = int.Parse(User.FindFirstValue("sub")!);`). `AuthController`'s `register`/`login` stay public (`[AllowAnonymous]`, or just leave the controller unattributed).

Two things to notice:

- **`User` is the verified token.** The middleware checked the signature before your action ran; `FindFirstValue("sub")` cannot be forged. Compare `req.user` — same idea, but typed, and an unauthenticated request never reaches you at all.
- **401 vs 403, in your own code.** No/bad token → **401** from the middleware ("who are you?"). Valid token, wrong payer → **403** from your `Forbid()` ("I know exactly who you are — no"). This distinction is a standard interview probe.

## What changed across the API (final spec reached)

| Endpoint | Before | Now |
|---|---|---|
| `POST /v1/auth/register` | public, returns the user | public, **returns a JWT** |
| `POST /v1/auth/login` | — | public, returns a JWT |
| `POST /v1/payment/transfer` | public, anyone moves anyone's money | private + payer must equal caller |
| `POST /v1/document/upload` | open, `userId` in the query | private + `userId` from the token |

## Interview talking points

- The middleware pair and its order: `UseAuthentication` (establish identity) before `UseAuthorization` (enforce policy) — reversing them is the classic everything-401s bug.
- 401 vs 403: authentication failure vs authorization failure — and show you *implemented* both (`[Authorize]` gave the 401s; the payer-ownership check gave the 403).
- Claims are the JWT payload with a typed API; `MapInboundClaims = false` + `NameClaimType` is the two-line fix for the legacy claim-name renaming everyone hits once.
- Passwords: framework hasher (salted, iterated) from day one; login is `VerifyHashedPassword`, never string comparison — and the login error stays vague on purpose.
- Never trust the payer from the body — derive identity from the verified token. "The body says who they *claim* to be; the token says who they *are*" is the ownership check in one sentence.
- The growth path, unprompted: "symmetric key, self-issued is right for one service; multiple services sharing tokens is when I'd move issuing to an OIDC server — OpenIddict/Duende self-hosted, or Auth0/Entra — and the validation side of my code would barely change."
