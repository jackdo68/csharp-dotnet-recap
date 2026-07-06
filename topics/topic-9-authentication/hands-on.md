# Topic 9: Hands On

> **The PaymentApp build:** Topic 5 the API, straight onto Postgres → Topic 6 EF unpacked + tests → Topic 7 the transfer race → Topic 8 Docker & ship → **Topic 9 (you are here): register, login, lock down** → Topic 10 the pipeline & the payment processor.

Build the auth feature (9.0), then run the drills. Run locally against the composed Postgres (`docker compose up -d db`) for 9.1–9.3; 9.4 composes everything.

## Exercise 9.0 — Build auth

```bash
cd PaymentApp
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
```

**`appsettings.json`** gains the signing key (≥ 32 chars):

```json
{
  "Jwt": { "Key": "dev-only-key-change-me-32-chars-min!!", "Issuer": "paymentapp" }
}
```

**`Services/IAuthService.cs`** grows two members (login + token):

```csharp
public interface IAuthService
{
    Task<User> RegisterAsync(RegisterRequest request);
    Task<User?> ValidateCredentialsAsync(string email, string password);
    string CreateToken(User user);
}
```

**`Services/AuthService.cs`** — inject `IConfiguration` for the key; add the two methods:

```csharp
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PaymentApp.Data;
using PaymentApp.Models;

namespace PaymentApp.Services;

public class AuthService : IAuthService
{
    private readonly PaymentDbContext _db;
    private readonly IPasswordHasher<User> _hasher;
    private readonly IConfiguration _config;

    public AuthService(PaymentDbContext db, IPasswordHasher<User> hasher, IConfiguration config)
    {
        _db = db; _hasher = hasher; _config = config;
    }

    public async Task<User> RegisterAsync(RegisterRequest request)   // unchanged from Topic 5
    {
        var user = new User { Name = request.Name, Email = request.Email, Balance = 1000m };
        user.PasswordHash = _hasher.HashPassword(user, request.Password);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        return user;
    }

    public async Task<User?> ValidateCredentialsAsync(string email, string password)
    {
        var user = await _db.Users.SingleOrDefaultAsync(u => u.Email == email);
        if (user is null) return null;
        var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, password);
        return result == PasswordVerificationResult.Failed ? null : user;
    }

    public string CreateToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            claims:
            [
                new Claim("sub", user.Id.ToString()),
                new Claim("name", user.Name),
                new Claim("email", user.Email),
            ],
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
```

**`Controllers/AuthController.cs`** — both endpoints return a token (`record LoginRequest(string Email, string Password);` in `Models/Requests.cs`):

```csharp
[ApiController]
[Route("v1/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _auth;
    public AuthController(IAuthService auth) => _auth = auth;

    [HttpPost("register")]                       // POST /v1/auth/register
    public async Task<ActionResult> Register(RegisterRequest request)
    {
        try
        {
            var user = await _auth.RegisterAsync(request);
            return Ok(new { token = _auth.CreateToken(user) });    // register now hands back a token
        }
        catch (DbUpdateException) { return Conflict(new { error = "That email is already registered." }); }
    }

    [HttpPost("login")]                          // POST /v1/auth/login
    public async Task<ActionResult> Login(LoginRequest request)
    {
        var user = await _auth.ValidateCredentialsAsync(request.Email, request.Password);
        if (user is null) return Unauthorized(new { error = "Invalid email or password." });  // 401, vague
        return Ok(new { token = _auth.CreateToken(user) });
    }
}
```

**`Program.cs`** — register JWT validation and the middleware pair (order matters):

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;    // keep OUR claim names ("sub")
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)),
            ValidateAudience = false,
            NameClaimType = "name",
        };
    });
builder.Services.AddAuthorization();
// ...after Build():
app.UseAuthentication();    // WHO are you — first
app.UseAuthorization();     // are you ALLOWED — then
```

**Lock the endpoints.** Add `[Authorize]` to `PaymentController` and `DocumentController`; in `Transfer`, enforce ownership; in `Upload`, take `userId` from the token instead of the query:

```csharp
// PaymentController.Transfer, first lines:
var callerId = int.Parse(User.FindFirstValue("sub")!);
if (request.PayerUserId != callerId) return Forbid();          // 403

// DocumentController.Upload signature + first line:
public async Task<ActionResult<ScanResult>> Upload(IFormFile file)   // no more userId param
{
    var userId = int.Parse(User.FindFirstValue("sub")!);
    // ... unchanged
}
```

## Exercise 9.1 — Log in and read your own token

1. Register a fresh Alice (now returns a token), then log in as her.
2. A JWT is three base64 chunks joined by dots. Decode the middle chunk and identify `sub`, `name`, `iss`, `exp`. Match each to the exact line of `CreateToken` that produced it.
3. Log in with a wrong password. What status and body — and why is the message deliberately vague?

**Solution**

```bash
curl -X POST http://localhost:PORT/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'
# {"token":"eyJhbGciOiJIUzI1NiIs..."}   ← register hands back a token now

curl -X POST http://localhost:PORT/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@bank.test","password":"Passw0rd!"}'
# {"token":"eyJhbGciOiJIUzI1NiIs..."}
```

Decode the payload (or paste into jwt.io):

```bash
TOKEN=eyJ...
echo $TOKEN | cut -d '.' -f2 | base64 --decode
# {"sub":"1","name":"Alice","email":"alice@bank.test","exp":1751800000,"iss":"paymentapp"}
```

`sub` ← `new Claim("sub", user.Id.ToString())`, `name` ← the name claim, `iss` ← the `issuer:` argument (from `Jwt:Issuer`), `exp` ← `expires: DateTime.UtcNow.AddHours(1)`. **The payload is readable by anyone** — base64 is encoding, not encryption; the third chunk (the HMAC signature) is what makes it trustworthy. Never put secrets in claims.

3\. **401** with `{"error":"Invalid email or password."}`. Vague on purpose: "wrong password" vs "no such email" would let an attacker enumerate which emails have accounts.

## Exercise 9.2 — Prove the signature matters

The protected endpoint is now `POST /v1/payment/transfer`. Register Alice and Bob first (grab Alice's token).

1. Call transfer three ways: no token, real token, and a **tampered** token (change one character in the middle chunk). Predict the three responses.
2. Look at the 401s' `WWW-Authenticate` header — what does the middleware tell you about *why* it refused?
3. Restart with a different signing key (`Jwt__Key="a-completely-different-32-char-key!!" dotnet run`) and reuse the old token. What happens, and what does that tell you about what a token *is*?

**Solution**

```bash
curl -i -X POST http://localhost:PORT/v1/payment/transfer \
  -H "Content-Type: application/json" -d '{"payerUserId":1,"payeeUserId":2,"amount":10}'
# 401 — WWW-Authenticate: Bearer                        (no token — refused before your code runs)

curl -i -X POST http://localhost:PORT/v1/payment/transfer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":10}'
# 200 — {"status":"completed"}   (Alice's token, Alice is the payer)

curl -i -X POST http://localhost:PORT/v1/payment/transfer \
  -H "Authorization: Bearer ${TOKEN/A/B}" -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":10}'
# 401 — WWW-Authenticate: Bearer error="invalid_token"  (signature check failed)
```

The tampered token is the teaching moment: you changed one character of the *payload*, so the HMAC no longer matches — the middleware rejected it before any of your code ran. That's the whole trust model in one curl: **the payload is plaintext; the signature makes it immutable.**

3\. Old token → 401 `invalid_token`. A JWT is only "valid" *relative to a key*: change the key and every outstanding token dies instantly. Two corollaries: rotating the key is the nuclear "log everyone out" button, and the key is the crown jewels — which is why 9.4 injects it as a secret env var instead of baking it into the image.

## Exercise 9.3 — Ownership: your money, not Bob's

1. Log in as **Bob**. Try to transfer $100 with `"payerUserId": 1` (Alice's id). Predict the status. Then do the honest version (`payerUserId` = Bob's own id) and confirm it works.
2. State the difference between the missing-token 401 and this failure, one sentence each.
3. Carry Topic 5's logging forward: include the *authenticated caller* in the large-transfer warning.

**Solution**

```bash
BOB=$(curl -s -X POST http://localhost:PORT/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@bank.test","password":"Passw0rd!"}' | jq -r .token)

curl -i -X POST http://localhost:PORT/v1/payment/transfer \
  -H "Authorization: Bearer $BOB" -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":100}'
# 403 Forbidden — the ownership check: token says sub=2, body says payer=1

curl -X POST http://localhost:PORT/v1/payment/transfer \
  -H "Authorization: Bearer $BOB" -H "Content-Type: application/json" \
  -d '{"payerUserId":2,"payeeUserId":1,"amount":100}'
# {"status":"completed"}
```

2\. **401** = authentication failed — the middleware couldn't establish *who* is calling (no/bad token). **403** = authorization failed — identity is proven, and the answer is still no (`Forbid()` from your payer-must-equal-caller check). Interviewers probe this pair constantly; you've now implemented both sides.

3\.

```csharp
if (request.Amount > 10_000)
    _logger.LogWarning("Large transfer by {Caller}: user {Payer} -> user {Payee}, amount {Amount}",
        User.Identity?.Name, request.PayerUserId, request.PayeeUserId, request.Amount);
```

`User.Identity?.Name` works because of `NameClaimType = "name"` — and unlike the request body, it can't be forged: it came through the signature. An audit trail keyed to the *token* identity rather than client-supplied fields is exactly what a payment-system reviewer looks for.

## Exercise 9.4 — Ship it locked

1. Add `Jwt__Key` to the `api` service in `docker-compose.yml` (a *different* value than dev `appsettings.json` — prove the env var wins). `docker compose up --build`.
2. Full end-to-end against the container on 8080: register → login → upload a private document with the token → confirm `User.File` was set.
3. Reasoning: your dev-machine token from 9.1 — will it work against the container? Why must `Jwt__Key` be *identical across replicas* the day you scale `api` to two?

**Solution**

1. In `docker-compose.yml` under `api`:

```yaml
    environment:
      ConnectionStrings__PaymentDb: "Host=db;Database=payapp;Username=payapp;Password=devpass"
      Jwt__Key: "compose-secret-key-32-chars-minimum!!"
      Jwt__Issuer: "paymentapp"
```

(In real deployments that value comes from a secrets manager / k8s Secret, not the YAML — the *mechanism* is identical, the point of Topic 8's config layering.)

2:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/v1/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Cara","email":"cara@bank.test","password":"Passw0rd!"}' | jq -r .token)

printf 'cara kyc: clean' > kyc.txt
curl -X POST http://localhost:8080/v1/document/upload \
  -H "Authorization: Bearer $TOKEN" -F "file=@kyc.txt"      # no userId — it comes from the token
# {"fileName":"kyc.txt","words":3,"sha256":"...","flagged":false}

docker compose exec db psql -U payapp -d payapp -c 'SELECT "Name","File" FROM "Users";'
# Cara | 3_....txt   ← the private upload landed on the caller's own record
```

3\. The 9.1 token **fails (401)** against the container: it was signed with the dev key, and the container validates with the compose key — same lesson as 9.2's key swap, now happening *between environments*, which is exactly where it bites real teams. And when `api` scales to two replicas, any replica may receive any request, so all must validate (and sign) with the same key — shared signing material is a *deployment* concern, not a code concern. (Follow it one step further — "what if many *different services* need to validate?" — and you've reinvented the separate identity server: one issuer, public-key validation everywhere. OpenIddict/Duende territory.)

## Exercise 9.5 — Say it out loud (no code)

Interview drill — one or two sentences each, then check against the solutions:

1. Walk a request's life from `POST /v1/auth/login` to an approved transfer, naming every check.
2. Why do we store a password *hash*, and what does the framework hasher give you that `sha256(password)` doesn't?
3. Your PM asks: "can we make tokens last 30 days so users stay logged in?"

**Solution**

1. "Login verifies the password against its hash and signs a JWT carrying `sub`/`name` with the server's key, expiring in an hour. On each request the JwtBearer middleware verifies signature, expiry, and issuer, and builds `User` from the claims — before any controller code. `[Authorize]` returns 401 if that failed; then the transfer action compares the body's payer to the token's `sub` and returns 403 on mismatch; only then does the (Topic 7-serialized) money move."
2. "A hash can't be reversed into the password when the table leaks — and the framework hasher adds a per-user salt and thousands of iterations, so identical passwords hash differently and brute force is slow. Bare `sha256` has neither: rainbow tables and GPUs eat it."
3. "Long-lived access tokens can't be revoked — a stolen one works for 30 days, and we'd have no logout short of rotating the signing key for *everyone*. The standard answer is short access tokens plus a refresh token that *is* server-side revocable. More machinery than this app needs today, but that's the design conversation."

---

**The money is guarded — one topic left.** The app still does everything itself: validation buried in services, per-controller try/catch, and every balance mutation in-process. **Topic 10** rebuilds the plumbing the way real payment stacks do it: middleware, declarative validation, and an external payment processor called over HTTP — including the deadlock you'll cause on purpose.
