# Topic 9: Authentication

> **How do login, tokens, and authorization work — and how does "whose money is it?" become code?**

## Node → .NET mapping

| Node | .NET |
|------|------|
| `jwt.sign(payload, secret)` | `JwtSecurityToken` + `WriteToken()` |
| `express-jwt` / `passport-jwt` | `AddJwtBearer()` + `UseAuthentication()` |
| `req.user` | `User` (`ClaimsPrincipal`) — typed, built in |
| JWT payload object | Claims (`sub`, `name`, `email`) |
| `JWT_SECRET` in `.env` | `Jwt:Key` in config → `Jwt__Key` env var |

## The flow

```
Login:   email/password → verify hash → build claims → sign JWT → return token
Request: Bearer token   → verify signature → claims become User → [Authorize] passes
```

**Key point:** One service is both issuer and validator (symmetric key). When multiple services need to validate → move to identity server (Auth0/Keycloak/OpenIddict).

## Implementation

**1. Add package:**
```bash
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
```

**2. Validate credentials:**
```csharp
public async Task<User?> ValidateCredentialsAsync(string email, string password)
{
    var user = await _db.Users.SingleOrDefaultAsync(u => u.Email == email);
    if (user is null) return null;
    var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, password);
    return result == PasswordVerificationResult.Failed ? null : user;
}
```

**3. Issue token:**
```csharp
public string CreateToken(User user)
{
    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
    var token = new JwtSecurityToken(
        issuer: _config["Jwt:Issuer"],
        claims: [
            new Claim("sub", user.Id.ToString()),
            new Claim("name", user.Name),
            new Claim("email", user.Email),
        ],
        expires: DateTime.UtcNow.AddHours(1),
        signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
    return new JwtSecurityTokenHandler().WriteToken(token);
}
```

**4. Register validation in `Program.cs`:**
```csharp
app.UseAuthentication();    // WHO are you — must come first
app.UseAuthorization();     // are you ALLOWED — then this
```

⚠️ **Gotcha:** Set `MapInboundClaims = false` to keep `"sub"` as `"sub"` (not renamed to SOAP-era URI).

**5. Lock endpoints + ownership check:**
```csharp
[Authorize]
[HttpPost("transfer")]
public async Task<ActionResult> Transfer(TransferRequest request)
{
    var callerId = int.Parse(User.FindFirstValue("sub")!);  // from token
    if (request.PayerUserId != callerId)
        return Forbid();   // 403
    // ... transfer logic
}
```

## Key concepts

| Concept | Details |
|---------|---------|
| `User` | The verified token — `FindFirstValue("sub")` cannot be forged |
| 401 | No/bad token — "who are you?" |
| 403 | Valid token, wrong permissions — "I know who you are — no" |
| Ownership | Never trust payer from body — derive from token |

## Final API spec

| Endpoint | Before | Now |
|----------|--------|-----|
| `POST /v1/auth/register` | Returns user | Returns JWT |
| `POST /v1/auth/login` | — | Returns JWT |
| `POST /v1/payment/transfer` | Anyone moves anyone's money | Private + payer = caller |
| `POST /v1/document/upload` | `userId` in query | Private + `userId` from token |

## Interview talking points

- **Middleware order:** `UseAuthentication` before `UseAuthorization`. Reversing = everything 401s.
- **401 vs 403:** Authentication failure vs authorization failure. `[Authorize]` = 401. Ownership check = 403.
- **Claims:** JWT payload with typed API. `MapInboundClaims = false` keeps claim names intact.
- **Passwords:** Framework hasher (salted, iterated). `VerifyHashedPassword`, never string comparison.
- **Ownership:** "The body says who they *claim* to be; the token says who they *are*."
- **Growth path:** Symmetric key for one service. Multiple services → identity server (Auth0/OpenIddict).
