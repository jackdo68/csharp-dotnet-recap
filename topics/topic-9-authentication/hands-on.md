# Topic 9: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint + Document upload → .NET Standard Library → **Authentication** → Production

Topic 8 covered common .NET tools. This topic adds login and security to PaymentApp using JWT tokens.

**Prerequisites:** Complete Topic 7 hands-on (working transfer and document upload).

---

## Exercise 9.1 — Add the JWT package

**Task:** Add the authentication package to the API project.

**Solution**

```bash
cd /Users/jackdo/source-code/csharp-dotnet-recap
dotnet add src/PaymentApp.Api package Microsoft.AspNetCore.Authentication.JwtBearer
```

This package lets ASP.NET Core validate JWT tokens.

---

## Exercise 9.2 — Add JWT settings to configuration

**Task:** Add the secret key (used to sign tokens) to your configuration.

**Solution**

Update `src/PaymentApp.Api/appsettings.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "ConnectionStrings": {
    "PaymentDb": "Host=localhost;Database=payapp;Username=payapp;Password=devpass"
  },
  "Jwt": {
    "Key": "this-is-a-secret-key-at-least-32-characters-long!",
    "Issuer": "paymentapp"
  }
}
```

**Important:** The `Key` must be at least 32 characters. In production, you'd use an environment variable instead of putting it in the config file.

---

## Exercise 9.3 — Add login DTO

**Task:** Add a DTO (Data Transfer Object — a simple class for passing data) for login requests.

**Solution**

Add to `src/PaymentApp.Application/DTOs/AuthDtos.cs`:

```csharp
namespace PaymentApp.Application.DTOs;

public record RegisterRequest(string Name, string Email, string Password);

public record LoginRequest(string Email, string Password);

public record AuthResponse(string Token);

public record UserResponse(int Id, string Name, string Email, decimal Balance);
```

---

## Exercise 9.4 — Update the auth service interface

**Task:** Add methods for login and token creation to the auth service interface.

**Solution**

Update `src/PaymentApp.Application/Interfaces/IAuthService.cs`:

```csharp
using PaymentApp.Application.DTOs;
using PaymentApp.Domain.Entities;

namespace PaymentApp.Application.Interfaces;

public interface IAuthService
{
    /// <summary>
    /// Register a new user. Returns the created user.
    /// </summary>
    Task<User> RegisterAsync(RegisterRequest request);

    /// <summary>
    /// Check if the email and password are correct.
    /// Returns the user if valid, or null if invalid.
    /// </summary>
    Task<User?> ValidateCredentialsAsync(string email, string password);

    /// <summary>
    /// Create a JWT token for the user.
    /// </summary>
    string CreateToken(User user);
}
```

---

## Exercise 9.5 — Implement login and token creation

**Task:** Update the auth service to handle login and create tokens.

**Solution**

Update `src/PaymentApp.Infrastructure/Services/AuthService.cs`:

```csharp
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Constants;
using PaymentApp.Domain.Entities;
using PaymentApp.Domain.Exceptions;
using PaymentApp.Infrastructure.Data;

namespace PaymentApp.Infrastructure.Services;

public class AuthService : IAuthService
{
    private readonly PaymentDbContext _db;
    private readonly IPasswordHasher<User> _hasher;
    private readonly IConfiguration _config;

    public AuthService(
        PaymentDbContext db,
        IPasswordHasher<User> hasher,
        IConfiguration config)
    {
        _db = db;
        _hasher = hasher;
        _config = config;
    }

    public async Task<User> RegisterAsync(RegisterRequest request)
    {
        // Check if email already exists
        var exists = await _db.Users.AnyAsync(u => u.Email == request.Email);
        if (exists)
            throw new DuplicateEmailException(request.Email);

        // Create the user
        var user = new User
        {
            Name = request.Name,
            Email = request.Email,
            CreatedAt = DateTime.UtcNow
        };

        // Hash the password (never store plain text!)
        user.PasswordHash = _hasher.HashPassword(user, request.Password);

        // Set the starting balance
        user.SetInitialBalance(PaymentDefaults.InitialBalance);

        // Save to database
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return user;
    }

    public async Task<User?> ValidateCredentialsAsync(string email, string password)
    {
        // Find the user by email
        var user = await _db.Users.SingleOrDefaultAsync(u => u.Email == email);
        if (user == null)
            return null;  // User not found

        // Check if the password matches
        var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (result == PasswordVerificationResult.Failed)
            return null;  // Wrong password

        return user;
    }

    public string CreateToken(User user)
    {
        // Get the secret key from configuration
        var keyString = _config["Jwt:Key"]
            ?? throw new InvalidOperationException("Jwt:Key is not configured");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(keyString));

        // Create the token with user info (claims)
        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            claims:
            [
                new Claim("sub", user.Id.ToString()),   // sub = subject = user ID
                new Claim("name", user.Name),
                new Claim("email", user.Email),
            ],
            expires: DateTime.UtcNow.AddHours(1),      // Token expires in 1 hour
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256)
        );

        // Convert to string
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
```

**What each part does:**

| Method | What it does |
|--------|--------------|
| `ValidateCredentialsAsync` | Checks if email/password are correct |
| `CreateToken` | Creates a JWT string with user info |
| `VerifyHashedPassword` | Compares a plain password with a stored hash |

---

## Exercise 9.6 — Update the auth controller

**Task:** Update the controller to return tokens and add a login endpoint.

**Solution**

Update `src/PaymentApp.Api/Controllers/AuthController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Exceptions;

namespace PaymentApp.Api.Controllers;

[ApiController]
[Route("v1/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService)
    {
        _authService = authService;
    }

    /// <summary>
    /// Register a new user. Returns a JWT token.
    /// </summary>
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        try
        {
            var user = await _authService.RegisterAsync(request);
            var token = _authService.CreateToken(user);
            return Ok(new AuthResponse(token));
        }
        catch (DuplicateEmailException ex)
        {
            return Conflict(new { code = ex.Code, message = ex.Message });
        }
    }

    /// <summary>
    /// Login with email and password. Returns a JWT token.
    /// </summary>
    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var user = await _authService.ValidateCredentialsAsync(request.Email, request.Password);

        if (user == null)
        {
            // Be vague on purpose — don't reveal if email exists or password is wrong
            return Unauthorized(new { error = "Invalid email or password." });
        }

        var token = _authService.CreateToken(user);
        return Ok(new AuthResponse(token));
    }
}
```

---

## Exercise 9.7 — Configure JWT validation in Program.cs

**Task:** Set up ASP.NET Core to validate JWT tokens on incoming requests.

**Solution**

Update `src/PaymentApp.Api/Program.cs`:

```csharp
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Entities;
using PaymentApp.Infrastructure.Data;
using PaymentApp.Infrastructure.Clients;
using PaymentApp.Infrastructure.Services;

var builder = WebApplication.CreateBuilder(args);

// Add controllers
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Add database
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("PaymentDb")));

// Add password hasher
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();

// Add our services
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPaymentService, PaymentService>();
builder.Services.AddScoped<IDocumentService, DocumentService>();

// HTTP client for the FX service (Topic 8): named client + typed wrapper
builder.Services.AddHttpClient("fx", client =>
{
    client.BaseAddress = new Uri("https://api.frankfurter.app/");
});
builder.Services.AddScoped<ExchangeRateClient>();

// ============================================
// JWT Authentication setup
// ============================================
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Keep our claim names (don't rename "sub" to a long URI)
        options.MapInboundClaims = false;

        // How to validate tokens
        options.TokenValidationParameters = new TokenValidationParameters
        {
            // Check that the issuer matches
            ValidIssuer = builder.Configuration["Jwt:Issuer"],

            // Use this key to verify the signature
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)),

            // We're not using audience, so don't validate it
            ValidateAudience = false,

            // Use "name" claim for User.Identity.Name
            NameClaimType = "name",
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

// Configure middleware
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// IMPORTANT: Order matters!
// 1. Authentication (who are you?)
// 2. Authorization (are you allowed?)
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
```

---

## Exercise 9.8 — Protect the transfer endpoint

**Task:** Add authentication and ownership check to the transfer endpoint.

**Solution**

Update `src/PaymentApp.Api/Controllers/PaymentController.cs`:

```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Exceptions;

namespace PaymentApp.Api.Controllers;

[ApiController]
[Route("v1/payment")]
[Authorize]  // All endpoints in this controller require a valid token
public class PaymentController : ControllerBase
{
    private readonly IPaymentService _paymentService;

    public PaymentController(IPaymentService paymentService)
    {
        _paymentService = paymentService;
    }

    [HttpPost("transfer")]
    public async Task<ActionResult<TransferResponse>> Transfer(TransferRequest request)
    {
        // Get the REAL user ID from the token (can't be faked)
        var tokenUserId = int.Parse(User.FindFirstValue("sub")!);

        // Check: is this their own money?
        if (request.PayerUserId != tokenUserId)
        {
            // They're trying to transfer someone else's money!
            return Forbid();  // Returns 403
        }

        try
        {
            await _paymentService.TransferAsync(
                request.PayerUserId,
                request.PayeeUserId,
                request.Amount);

            return Ok(new TransferResponse("completed", 0, 0));
        }
        catch (UserNotFoundException ex)
        {
            return NotFound(new { code = ex.Code, message = ex.Message });
        }
        catch (InsufficientBalanceException ex)
        {
            return BadRequest(new { code = ex.Code, message = ex.Message });
        }
        catch (InvalidTransferException ex)
        {
            return BadRequest(new { code = ex.Code, message = ex.Message });
        }
    }
}
```

**The key security check:**

```csharp
var tokenUserId = int.Parse(User.FindFirstValue("sub")!);
if (request.PayerUserId != tokenUserId)
    return Forbid();
```

This ensures users can only transfer their own money.

---

## Exercise 9.9 — Protect the document upload endpoint

**Task:** Add authentication to document upload and get the user ID from the token.

**Solution**

Update `src/PaymentApp.Api/Controllers/DocumentController.cs`:

```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PaymentApp.Application.DTOs;
using PaymentApp.Application.Interfaces;
using PaymentApp.Domain.Exceptions;

namespace PaymentApp.Api.Controllers;

[ApiController]
[Route("v1/document")]
[Authorize]  // Every endpoint here requires a valid token
public class DocumentController : ControllerBase
{
    private readonly IDocumentService _documentService;

    public DocumentController(IDocumentService documentService)
    {
        _documentService = documentService;
    }

    // The user ID always comes from the token, never from the request.
    private int CurrentUserId => int.Parse(User.FindFirstValue("sub")!);

    /// <summary>Upload a document (Topic 7/8). User ID comes from the token.</summary>
    [HttpPost("upload")]
    public async Task<ActionResult<DocumentMetadata>> Upload(IFormFile file)
    {
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".txt")
            return BadRequest(new { error = "Only .txt files are accepted." });

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var bytes = ms.ToArray();

        // CPU-bound scan on a pool thread (Topic 7)
        var result = await Task.Run(() => _documentService.Scan(file.FileName, bytes));

        try
        {
            // Store the file + JSON metadata sidecar (Topic 8), return the metadata
            var meta = await _documentService.StoreAsync(CurrentUserId, file.FileName, bytes, result);
            return Ok(meta);
        }
        catch (UserNotFoundException ex)
        {
            return NotFound(new { code = ex.Code, message = ex.Message });
        }
    }

    /// <summary>Download your stored document (Topic 8), streamed back.</summary>
    [HttpGet("download")]
    public async Task<IActionResult> Download()
    {
        try
        {
            var (content, meta) = await _documentService.OpenAsync(CurrentUserId);
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

    /// <summary>Your account statement (Topic 8), optionally in another currency.</summary>
    [HttpGet("statement")]
    public async Task<IActionResult> Statement(string? currency = null)
    {
        try
        {
            var text = await _documentService.BuildStatementAsync(CurrentUserId, currency);
            return Content(text, "text/plain");
        }
        catch (UserNotFoundException ex)
        {
            return NotFound(new { code = ex.Code, message = ex.Message });
        }
    }
}
```

**Notice:** None of these endpoints take `userId` as a parameter anymore — they all read it from the token via `CurrentUserId`, so users can only ever touch their own account.

---

## Exercise 9.10 — Test the authentication flow

**Task:** Test the complete authentication flow.

**Solution**

```bash
# Make sure the API is running
dotnet build && dotnet run --project src/PaymentApp.Api &
sleep 5

# 1. Register Alice (returns a token)
ALICE_TOKEN=$(curl -s -X POST http://localhost:5000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo "Alice's token: $ALICE_TOKEN"

# 2. Try to access transfer WITHOUT a token (should fail with 401)
echo -e "\n--- No token: ---"
curl -s -X POST http://localhost:5000/v1/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":100}'
# Should return 401 Unauthorized

# 3. Register Bob
BOB_TOKEN=$(curl -s -X POST http://localhost:5000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@bank.test","password":"Passw0rd!"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo -e "\n\nBob's token: $BOB_TOKEN"

# 4. Alice transfers to Bob (should work)
echo -e "\n--- Alice transfers to Bob: ---"
curl -s -X POST http://localhost:5000/v1/payment/transfer \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":100}'
# Should return the transfer details

# 5. Bob tries to transfer Alice's money (should fail with 403)
echo -e "\n\n--- Bob tries to steal Alice's money: ---"
curl -s -X POST http://localhost:5000/v1/payment/transfer \
  -H "Authorization: Bearer $BOB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":100}'
# Should return 403 Forbidden

# 6. Login as Alice (get a fresh token)
echo -e "\n\n--- Login as Alice: ---"
curl -s -X POST http://localhost:5000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@bank.test","password":"Passw0rd!"}'
# Should return a new token

# 7. Login with wrong password
echo -e "\n\n--- Wrong password: ---"
curl -s -X POST http://localhost:5000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@bank.test","password":"wrong"}'
# Should return 401 with vague message
```

---

## Exercise 9.11 — Decode and understand the JWT

**Task:** Look inside a JWT to see what data it contains.

**Solution**

A JWT has three parts separated by dots. The middle part is the payload (base64 encoded).

```bash
# Get a token
TOKEN=$(curl -s -X POST http://localhost:5000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@bank.test","password":"Passw0rd!"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Decode the payload (the middle part)
echo $TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null
```

**Expected output (something like):**

```json
{"sub":"1","name":"Alice","email":"alice@bank.test","exp":1234567890,"iss":"paymentapp"}
```

| Field | Meaning | Where it comes from |
|-------|---------|---------------------|
| `sub` | User ID | `new Claim("sub", user.Id.ToString())` |
| `name` | User name | `new Claim("name", user.Name)` |
| `email` | User email | `new Claim("email", user.Email)` |
| `exp` | Expiration time | `expires: DateTime.UtcNow.AddHours(1)` |
| `iss` | Who issued it | `issuer: _config["Jwt:Issuer"]` |

**Remember:** Anyone can decode and read this data. The signature (third part) proves it wasn't changed, but the data itself is not secret.

---

## Exercise 9.12 — Build and verify

**Task:** Make sure everything compiles.

**Solution**

```bash
dotnet build
```

Verify all three cases work:
1. No token → 401
2. Valid token, own money → success
3. Valid token, someone else's money → 403

---

## What we built

| File | Purpose |
|------|---------|
| Updated `AuthDtos.cs` | Added `LoginRequest` and `AuthResponse` |
| Updated `IAuthService.cs` | Added `ValidateCredentialsAsync` and `CreateToken` |
| Updated `AuthService.cs` | Implemented login and token creation |
| Updated `AuthController.cs` | Added login endpoint, both return tokens |
| Updated `PaymentController.cs` | Added `[Authorize]` and ownership check |
| Updated `DocumentController.cs` | Added `[Authorize]`, gets user from token |
| Updated `Program.cs` | Added JWT authentication setup |

---

## Key takeaways

| Concept | What it means |
|---------|---------------|
| `[Authorize]` | This endpoint requires a valid token |
| `User.FindFirstValue("sub")` | Get the user ID from the token |
| 401 Unauthorized | No token or invalid token |
| 403 Forbidden | Valid token, but not allowed (ownership check failed) |
| Token payload | Can be read by anyone, not encrypted |
| Token signature | Proves the server created it, can't be faked |

---

## Recap

- "I use `[Authorize]` to require authentication, then check ownership by comparing the token's `sub` claim to the request body."
- "401 means authentication failed (who are you?). 403 means authorization failed (you're not allowed)."
- "The middleware order matters: `UseAuthentication` must come before `UseAuthorization`."
- "JWT payloads are readable but not forgeable. The signature proves the server created it."
- "I use vague error messages like 'Invalid email or password' to prevent attackers from learning which emails exist."

---

## Next: Topic 10

In Topic 10, we prepare PaymentApp for production: Docker, compose, environment variables, and calling an external payment processor.
