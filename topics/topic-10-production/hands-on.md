# Topic 10: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint + Document upload → .NET Standard Library → Authentication → **Production**

Topic 9 added authentication. This topic packages PaymentApp for production using Docker.

**Prerequisites:** Complete Topic 9 hands-on (working authentication).

---

## Exercise 10.1 — Create the Dockerfile

**Task:** Create a Dockerfile that builds and runs PaymentApp.

**Solution**

Create `Dockerfile` in the root folder (same level as `PaymentApp.sln`):

```dockerfile
# ==================================================
# Stage 1: Build
# ==================================================
# Use the SDK image (has compilers and build tools)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project files first (for better caching)
# If these don't change, Docker won't re-download packages
COPY *.sln .
COPY src/PaymentApp.Domain/*.csproj src/PaymentApp.Domain/
COPY src/PaymentApp.Application/*.csproj src/PaymentApp.Application/
COPY src/PaymentApp.Infrastructure/*.csproj src/PaymentApp.Infrastructure/
COPY src/PaymentApp.Api/*.csproj src/PaymentApp.Api/

# Restore packages (download dependencies)
RUN dotnet restore

# Copy all source code
COPY . .

# Build the app in Release mode
# -c Release = Release configuration (optimized)
# -o /app/publish = output to /app/publish folder
RUN dotnet publish src/PaymentApp.Api -c Release -o /app/publish

# ==================================================
# Stage 2: Runtime
# ==================================================
# Use the smaller runtime image (no compilers needed)
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app

# Copy the built app from the build stage
COPY --from=build /app/publish .

# Create a folder for uploads
RUN mkdir -p /app/uploads

# Tell ASP.NET to listen on port 8080
ENV ASPNETCORE_URLS=http://+:8080

# Document that we're using port 8080
EXPOSE 8080

# Run the app
ENTRYPOINT ["dotnet", "PaymentApp.Api.dll"]
```

**What each part does:**

| Line | What it does |
|------|--------------|
| `FROM ... AS build` | Start the build stage using the SDK image |
| `COPY *.csproj` | Copy project files (for package restore caching) |
| `RUN dotnet restore` | Download all NuGet packages |
| `RUN dotnet publish` | Compile the app and output to /app/publish |
| `FROM ... aspnet` | Start the runtime stage (smaller image) |
| `COPY --from=build` | Copy the built app from the build stage |
| `ENTRYPOINT` | The command to run when the container starts |

---

## Exercise 10.2 — Create .dockerignore

**Task:** Create a .dockerignore file to exclude unnecessary files.

**Solution**

Create `.dockerignore` in the root folder:

```
# Build outputs
bin/
obj/

# IDE files
.vs/
.vscode/
*.user

# Git
.git/
.gitignore

# Documentation
*.md

# Docker files (we're already in Docker!)
Dockerfile
docker-compose*.yml
.dockerignore

# Test files
tests/

# Scripts
*.sh
```

This makes the build faster by not copying unnecessary files.

---

## Exercise 10.3 — Create docker-compose.yml

**Task:** Create a docker-compose file that runs the database and API together.

**Solution**

Create `docker-compose.yml` in the root folder:

```yaml
version: '3.8'

services:
  # PostgreSQL database
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: payapp
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: payapp
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U payapp -d payapp"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Our API
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      # Database connection string
      # IMPORTANT: Use "db" as the host, not "localhost"
      # "db" is the service name, and Docker creates a network where services can find each other
      ConnectionStrings__PaymentDb: "Host=db;Database=payapp;Username=payapp;Password=devpass"

      # JWT settings (different from dev for security)
      Jwt__Key: "docker-compose-secret-key-at-least-32-chars!"
      Jwt__Issuer: "paymentapp"
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - uploads:/app/uploads

# Named volumes (persist data between restarts)
volumes:
  db_data:
  uploads:
```

**Understanding the settings:**

| Setting | What it does |
|---------|--------------|
| `image: postgres:16` | Use the official PostgreSQL 16 image |
| `environment: POSTGRES_*` | Set up the database user and password |
| `ports: "5432:5432"` | Make the database accessible from your machine |
| `volumes: db_data` | Keep database data when the container restarts |
| `build: .` | Build the image from the current folder (using Dockerfile) |
| `depends_on` | Wait for the database to be ready before starting the API |
| `ConnectionStrings__PaymentDb` | Override the connection string from appsettings.json |

---

## Exercise 10.4 — Add auto-migration

**Task:** Make the app automatically apply database migrations when it starts.

**Solution**

Update `src/PaymentApp.Api/Program.cs` to add migration at startup:

```csharp
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PaymentApp.Application.Services;
using PaymentApp.Domain.Entities;
using PaymentApp.Infrastructure.Data;
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
builder.Services.AddScoped<ITransferService, TransferService>();
builder.Services.AddScoped<IDocumentService, DocumentService>();

// Add HTTP client factory
builder.Services.AddHttpClient();

// Add health checks
builder.Services.AddHealthChecks()
    .AddNpgSql(builder.Configuration.GetConnectionString("PaymentDb")!);

// JWT Authentication setup
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
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

var app = builder.Build();

// =============================================
// Apply database migrations automatically
// =============================================
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    // Wait for database to be ready (important in Docker)
    var maxRetries = 10;
    var delay = TimeSpan.FromSeconds(2);

    for (int i = 0; i < maxRetries; i++)
    {
        try
        {
            logger.LogInformation("Checking database connection (attempt {Attempt}/{Max})...", i + 1, maxRetries);
            await db.Database.CanConnectAsync();
            logger.LogInformation("Database connected. Applying migrations...");
            await db.Database.MigrateAsync();
            logger.LogInformation("Migrations applied successfully.");
            break;
        }
        catch (Exception ex)
        {
            logger.LogWarning("Database not ready: {Message}. Retrying in {Seconds}s...", ex.Message, delay.TotalSeconds);
            if (i == maxRetries - 1) throw;
            await Task.Delay(delay);
        }
    }
}

// Configure middleware
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthentication();
app.UseAuthorization();

// Health check endpoint
app.MapHealthChecks("/health");

app.MapControllers();

app.Run();
```

**Note:** You also need to add the health check NuGet package:

```bash
dotnet add src/PaymentApp.Api package AspNetCore.HealthChecks.NpgSql
```

---

## Exercise 10.5 — Build and run with Docker

**Task:** Build and run the complete application using Docker.

**Solution**

```bash
# Build and start everything
docker-compose up --build

# Or run in background
docker-compose up --build -d
```

You should see:
1. Database starting
2. API building
3. Migrations running
4. API listening on port 8080

**Test it:**

```bash
# Health check
curl http://localhost:8080/health
# Should return: Healthy

# Register a user
curl -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'

# Check the database
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "Email", "Balance" FROM "Users";'
```

---

## Exercise 10.6 — Understand the localhost lie

**Task:** Understand why we use `Host=db` instead of `Host=localhost`.

**Explanation**

When you run `docker-compose up`, Docker creates a private network. Each service gets a hostname matching its name:

```
┌─────────────────────────────────────────────┐
│  Docker Network                              │
│                                              │
│   ┌─────────┐          ┌─────────┐          │
│   │   db    │          │   api   │          │
│   │         │◄─────────│         │          │
│   │ :5432   │  Host=db │ :8080   │          │
│   └─────────┘          └─────────┘          │
│                                              │
└─────────────────────────────────────────────┘
         ▲                      ▲
         │                      │
    port 5432              port 8080
         │                      │
    ┌────┴──────────────────────┴────┐
    │       Your Machine              │
    │       localhost                 │
    └─────────────────────────────────┘
```

**From your machine:**
- `localhost:5432` → reaches the database
- `localhost:8080` → reaches the API

**From inside the API container:**
- `localhost` → means inside the API container (nothing there!)
- `db` → reaches the database container

This is why we use `Host=db` in the connection string.

---

## Exercise 10.7 — Test the complete flow

**Task:** Test the full application running in Docker.

**Solution**

```bash
# Make sure everything is running
docker-compose up -d

# Wait for it to start
sleep 5

# 1. Check health
echo "=== Health Check ==="
curl -s http://localhost:8080/health

# 2. Register Alice
echo -e "\n\n=== Register Alice ==="
ALICE_TOKEN=$(curl -s -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Token: ${ALICE_TOKEN:0:50}..."

# 3. Register Bob
echo -e "\n\n=== Register Bob ==="
BOB_TOKEN=$(curl -s -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@bank.test","password":"Passw0rd!"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Token: ${BOB_TOKEN:0:50}..."

# 4. Alice transfers to Bob
echo -e "\n\n=== Transfer $100 from Alice to Bob ==="
curl -s -X POST http://localhost:8080/v1/payment/transfer \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":100}'

# 5. Check balances
echo -e "\n\n=== Check Balances ==="
docker-compose exec db psql -U payapp -d payapp \
  -c 'SELECT "Id", "Name", "Balance" FROM "Users";'
```

**Expected output:**

```
=== Health Check ===
Healthy

=== Register Alice ===
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzd...

=== Register Bob ===
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzd...

=== Transfer $100 from Alice to Bob ===
{"payerUserId":1,"payerNewBalance":900.00,...}

=== Check Balances ===
 Id | Name  | Balance
----+-------+---------
  1 | Alice |  900.00
  2 | Bob   | 1100.00
```

---

## Exercise 10.8 — View logs

**Task:** Learn how to view and troubleshoot container logs.

**Solution**

```bash
# View all logs
docker-compose logs

# View only API logs
docker-compose logs api

# Follow logs in real-time (like tail -f)
docker-compose logs -f api

# View last 50 lines
docker-compose logs --tail 50 api
```

---

## Exercise 10.9 — Clean up

**Task:** Stop the containers and clean up.

**Solution**

```bash
# Stop containers (keeps data)
docker-compose down

# Stop containers AND delete data
docker-compose down -v

# Remove built images too
docker-compose down -v --rmi all
```

---

## Exercise 10.10 — Build and verify

**Task:** Make sure everything works.

**Solution**

```bash
# Clean start
docker-compose down -v

# Build and run
docker-compose up --build -d

# Wait for startup
sleep 10

# Test
curl http://localhost:8080/health

# Clean up
docker-compose down
```

---

## What we built

| File | Purpose |
|------|---------|
| `Dockerfile` | Instructions for building the app image |
| `.dockerignore` | Files to exclude from the build |
| `docker-compose.yml` | Run database + API together |
| Updated `Program.cs` | Auto-migration + health checks |

---

## Project structure (final)

```
PaymentApp/
├── Dockerfile              (NEW)
├── .dockerignore           (NEW)
├── docker-compose.yml      (NEW)
├── PaymentApp.sln
└── src/
    ├── PaymentApp.Domain/
    │   ├── Common/
    │   ├── Constants/
    │   ├── Entities/
    │   ├── Events/
    │   ├── Exceptions/
    │   ├── Utilities/
    │   └── ValueObjects/
    ├── PaymentApp.Application/
    │   ├── DTOs/
    │   └── Services/
    ├── PaymentApp.Infrastructure/
    │   ├── Data/
    │   └── Services/
    └── PaymentApp.Api/
        └── Controllers/
```

---

## Key takeaways

| Concept | What it means |
|---------|---------------|
| Multi-stage build | Build with SDK, run with smaller runtime image |
| docker-compose | Run multiple containers together |
| Service names | Use `db` not `localhost` for container-to-container |
| Environment variables | Override config: `Jwt__Key` overrides `Jwt:Key` |
| Health checks | Let load balancers know if your app is healthy |
| Volumes | Persist data between container restarts |

---

## Interview talking points

- "I use multi-stage builds to keep production images small — SDK for build, runtime for deployment."
- "docker-compose is for local dev. In production, I'd use Kubernetes or ECS."
- "The 'localhost lie' — inside a container, localhost means the container itself. I use service names instead."
- "Environment variables override appsettings.json. I use `__` for nested keys: `Jwt__Key` overrides `Jwt:Key`."
- "Health checks tell the orchestrator if my app is ready to receive traffic."

---

## PaymentApp is complete!

You've built a complete payment API:
- ✅ User registration and login with JWT
- ✅ Password hashing
- ✅ Money transfers with concurrency protection
- ✅ Document upload with CPU-bound processing
- ✅ PostgreSQL database with EF Core
- ✅ Docker containerization

---

## Next: Topic 11

In Topic 11, we add automated tests to ensure PaymentApp works correctly and stays working as we make changes.
