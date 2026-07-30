# Topic 9: Authentication

> **How do login, tokens, and "who owns this money?" work in code?**

This topic adds security to PaymentApp: users log in, get a token (a digital pass), and use it to prove who they are on every request.

---

## What is a JWT?

A JWT (JSON Web Token, pronounced "jot") is a string that proves who you are. It looks like this:

```
eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxIiwibmFtZSI6IkFsaWNlIn0.dBjftJeZ4CVP
```

It has three parts separated by dots:

| Part | What it contains |
|------|------------------|
| Header | How the token is signed (the algorithm used) |
| Payload | Your data: user ID, name, when it expires |
| Signature | Proof that the server created this token |

**Important:** The payload is **not encrypted** — anyone can read it. The signature just proves it wasn't changed. Never put passwords or secrets in a JWT.

---

## How login works

```
1. User sends: email + password
2. Server checks: is this password correct?
3. Server creates: a JWT with the user's info
4. Server returns: the JWT
5. User saves: the JWT (usually in localStorage or a cookie)
```

For every future request:

```
1. User sends: the request + the JWT in the header
2. Server checks: is this JWT valid? (signature ok? not expired?)
3. If valid: the server knows who the user is and processes the request
4. If invalid: the server returns 401 (Unauthorized)
```

---

## Node.js to .NET comparison

| Node.js | .NET |
|---------|------|
| `jwt.sign(payload, secret)` | `new JwtSecurityToken(...) + WriteToken()` |
| `express-jwt` or `passport-jwt` | `AddJwtBearer()` middleware |
| `req.user` | `User` (a built-in property on controllers) |
| JWT payload | Claims (key-value pairs like `sub`, `name`, `email`) |
| `JWT_SECRET` in `.env` | `Jwt:Key` in config or `Jwt__Key` env variable |

---

## The key concepts

### Claims (data inside the token)

Claims are pieces of information about the user stored in the token:

```csharp
// These become the JWT payload
new Claim("sub", "123"),      // "sub" = subject = user ID
new Claim("name", "Alice"),   // the user's name
new Claim("email", "alice@example.com")
```

Standard claim names:

| Claim | Short for | Meaning |
|-------|-----------|---------|
| `sub` | Subject | The user's unique ID |
| `name` | Name | The user's display name |
| `email` | Email | The user's email |
| `exp` | Expires | When the token stops working (a timestamp) |
| `iss` | Issuer | Who created this token (your app's name) |

### Authentication vs Authorization

These are different things:

| Term | Question it answers | HTTP status when it fails |
|------|---------------------|---------------------------|
| **Authentication** | "Who are you?" | 401 Unauthorized |
| **Authorization** | "Are you allowed to do this?" | 403 Forbidden |

**Example:**
- You try to transfer money without a token → 401 (we don't know who you are)
- You try to transfer Alice's money but you're Bob → 403 (we know who you are, but no)

### Ownership check

The most important security rule in PaymentApp:

```
You can only transfer YOUR OWN money.
```

This means:
- The request body might say `payerUserId: 1`
- But we ignore that — we get the real user ID from the token
- If they don't match → 403 Forbidden

```csharp
// The token says who you REALLY are (can't be faked)
var realUserId = int.Parse(User.FindFirstValue("sub")!);

// The request body says who you CLAIM to be
var claimedUserId = request.PayerUserId;

// If they don't match, reject the request
if (realUserId != claimedUserId)
    return Forbid();  // 403
```

---

## Password hashing

**Never store passwords as plain text.** Instead, store a "hash" (a scrambled version that can't be reversed).

```csharp
// When the user registers: hash the password
user.PasswordHash = _hasher.HashPassword(user, "Passw0rd!");
// Result: "AQAAAAIAAYagAAAAE..." (unreadable)

// When the user logs in: verify the password
var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, "Passw0rd!");
// Result: Success or Failed
```

**Why not just use SHA256?**

| `SHA256(password)` | .NET Password Hasher |
|-------------------|----------------------|
| Same password → same hash | Same password → different hash each time (uses a "salt") |
| Fast to crack | Slow on purpose (many iterations) |
| Rainbow table attacks work | Rainbow tables don't work |

The .NET hasher adds:
- **Salt**: Random bytes mixed with the password, so "password123" hashes differently for each user
- **Iterations**: Hashes the result thousands of times, so cracking is slow

---

## The code structure

### Creating a token

```csharp
public string CreateToken(User user)
{
    // The secret key (must be at least 32 characters)
    var key = new SymmetricSecurityKey(
        Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));

    // Create the token
    var token = new JwtSecurityToken(
        issuer: _config["Jwt:Issuer"],     // Who made this token
        claims: [
            new Claim("sub", user.Id.ToString()),
            new Claim("name", user.Name),
            new Claim("email", user.Email),
        ],
        expires: DateTime.UtcNow.AddHours(1),  // Valid for 1 hour
        signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256)
    );

    // Convert to string
    return new JwtSecurityTokenHandler().WriteToken(token);
}
```

### Setting up validation in Program.cs

```csharp
// Tell ASP.NET how to validate tokens
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;  // Keep claim names as-is
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)),
            ValidateAudience = false,
        };
    });

// Add the middleware (ORDER MATTERS!)
app.UseAuthentication();   // Check: who are you? (must be first)
app.UseAuthorization();    // Check: are you allowed? (must be second)
```

**Common mistake:** If you swap the order of `UseAuthentication` and `UseAuthorization`, nothing will work correctly.

### Protecting endpoints

```csharp
[Authorize]  // This endpoint requires a valid token
[HttpPost("transfer")]
public async Task<ActionResult> Transfer(TransferRequest request)
{
    // Get the user ID from the token (not from the request!)
    var userId = int.Parse(User.FindFirstValue("sub")!);

    // Check: is this their own money?
    if (request.PayerUserId != userId)
        return Forbid();  // 403 — not your money!

    // Continue with the transfer...
}
```

---

## What changes in PaymentApp

| Endpoint | Before | After |
|----------|--------|-------|
| `POST /v1/auth/register` | Returns user info | Returns a JWT token |
| `POST /v1/auth/login` | Doesn't exist | Returns a JWT token |
| `POST /v1/payment/transfer` | Anyone can call it | Requires token + ownership check |
| `POST /v1/document/upload` | Takes `userId` from URL | Gets `userId` from token |

---

## Why vague error messages?

When login fails, we say:

```json
{"error": "Invalid email or password."}
```

Not:
- "That email doesn't exist" — tells attacker which emails are registered
- "Wrong password" — confirms the email exists

Being vague protects your users.

---

## Interview talking points

- **Middleware order:** `UseAuthentication` must come before `UseAuthorization`. Swapping them breaks everything.
- **401 vs 403:** 401 = "who are you?" (no/bad token). 403 = "I know who you are, but no" (ownership check failed).
- **Claims:** The data inside the JWT. `User.FindFirstValue("sub")` gets the user ID.
- **Token trust:** The payload is readable by anyone, but the signature proves it wasn't changed.
- **Password hashing:** Use the framework hasher, not raw SHA256. It adds salt and iterations.
- **Ownership:** "The request says who they claim to be; the token says who they really are."
