# Topic 1: Hands On

> **The PaymentApp build:** **Solution structure** → Domain models → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint → Document upload → Authentication → Production

In this hands-on, you'll create the PaymentApp solution with Clean Architecture structure. By the end, you'll have four projects wired together correctly — the foundation for everything we build in Topics 2–10.

## Exercise 1.1 — Verify the toolchain

Before we start, confirm your environment is ready.

**Task:**
1. Print the SDK version. Confirm it's 10.x.
2. List all installed SDKs.
3. Find where the NuGet package cache lives on your machine.

**Solution**

```bash
dotnet --version        # e.g. 10.0.100
dotnet --list-sdks
dotnet nuget locals all --list
# global-packages: /Users/<you>/.nuget/packages  ← the "no node_modules" answer
```

**Why this matters:** The global cache is why .NET repos are lightweight. Packages download once and are shared across all projects. No 500MB folders to clone or delete.

---

## Exercise 1.2 — Create the solution

A solution (`.sln`) groups multiple projects together. Think of it as a monorepo root.

**Task:** Create a new solution called `PaymentApp` in a folder of your choice.

**Solution**

```bash
mkdir PaymentApp
cd PaymentApp
dotnet new sln -n PaymentApp
```

This creates `PaymentApp.sln` — an XML file that will list all our projects. Open it if you're curious; it's mostly GUIDs and paths.

---

## Exercise 1.3 — Create the four projects

We're using Clean Architecture with four layers. Each layer is a separate project:

| Project | Purpose | Type |
|---------|---------|------|
| `PaymentApp.Domain` | Entities, value objects, domain exceptions | Class library |
| `PaymentApp.Application` | Use cases, interfaces, DTOs | Class library |
| `PaymentApp.Infrastructure` | EF Core DbContext, external services | Class library |
| `PaymentApp.Api` | Controllers, DI wiring, entry point | Web API |

**Task:** Create all four projects and add them to the solution.

**Solution**

```bash
# Create projects
dotnet new classlib -n PaymentApp.Domain -o src/PaymentApp.Domain
dotnet new classlib -n PaymentApp.Application -o src/PaymentApp.Application
dotnet new classlib -n PaymentApp.Infrastructure -o src/PaymentApp.Infrastructure
dotnet new webapi -n PaymentApp.Api -o src/PaymentApp.Api --use-controllers

# Add all to solution
dotnet sln add src/PaymentApp.Domain/PaymentApp.Domain.csproj
dotnet sln add src/PaymentApp.Application/PaymentApp.Application.csproj
dotnet sln add src/PaymentApp.Infrastructure/PaymentApp.Infrastructure.csproj
dotnet sln add src/PaymentApp.Api/PaymentApp.Api.csproj
```

**What happened:**
- `classlib` creates a library project (compiles to a DLL, can't run on its own)
- `webapi --use-controllers` creates an API project with controller-based routing
- `-o src/...` puts projects in a `src/` subfolder (common convention)
- `dotnet sln add` registers each project in the solution file

Your folder structure now looks like:

```
PaymentApp/
├── PaymentApp.sln
└── src/
    ├── PaymentApp.Domain/
    │   ├── PaymentApp.Domain.csproj
    │   └── Class1.cs              ← delete this
    ├── PaymentApp.Application/
    │   ├── PaymentApp.Application.csproj
    │   └── Class1.cs              ← delete this
    ├── PaymentApp.Infrastructure/
    │   ├── PaymentApp.Infrastructure.csproj
    │   └── Class1.cs              ← delete this
    └── PaymentApp.Api/
        ├── PaymentApp.Api.csproj
        ├── Program.cs
        ├── appsettings.json
        └── Controllers/
            └── WeatherForecastController.cs  ← delete this
```

**Clean up the scaffolded files:**

```bash
rm src/PaymentApp.Domain/Class1.cs
rm src/PaymentApp.Application/Class1.cs
rm src/PaymentApp.Infrastructure/Class1.cs
rm src/PaymentApp.Api/Controllers/WeatherForecastController.cs
rm src/PaymentApp.Api/WeatherForecast.cs
```

---

## Exercise 1.4 — Wire up project references

Clean Architecture has strict dependency rules:

```
Domain ← Application ← Infrastructure
                    ← Api
```

- **Domain** has no dependencies (pure business logic)
- **Application** depends on Domain (uses domain types)
- **Infrastructure** depends on Application (implements interfaces)
- **Api** depends on Application and Infrastructure (wires everything)

**Task:** Add the project references so dependencies flow correctly.

**Solution**

```bash
# Application references Domain
dotnet add src/PaymentApp.Application/PaymentApp.Application.csproj \
  reference src/PaymentApp.Domain/PaymentApp.Domain.csproj

# Infrastructure references Application (and transitively Domain)
dotnet add src/PaymentApp.Infrastructure/PaymentApp.Infrastructure.csproj \
  reference src/PaymentApp.Application/PaymentApp.Application.csproj

# Api references both Application and Infrastructure
dotnet add src/PaymentApp.Api/PaymentApp.Api.csproj \
  reference src/PaymentApp.Application/PaymentApp.Application.csproj

dotnet add src/PaymentApp.Api/PaymentApp.Api.csproj \
  reference src/PaymentApp.Infrastructure/PaymentApp.Infrastructure.csproj
```

**Verify:** Open `src/PaymentApp.Application/PaymentApp.Application.csproj`. You should see:

```xml
<ItemGroup>
  <ProjectReference Include="..\PaymentApp.Domain\PaymentApp.Domain.csproj" />
</ItemGroup>
```

**Why this structure matters:**

| Rule | Why |
|------|-----|
| Domain has no dependencies | Business logic doesn't change when you swap databases |
| Application owns interfaces | Infrastructure implements them, not the other way |
| Api is just the entry point | Swap it for a CLI or worker without touching business logic |

This is **Dependency Inversion** — high-level modules (Domain, Application) don't depend on low-level modules (Infrastructure). Both depend on abstractions.

---

## Exercise 1.5 — Build the solution

**Task:** Build all projects and verify everything compiles.

**Solution**

```bash
dotnet build
```

You should see:

```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

If you see errors about missing references, double-check Exercise 1.4.

---

## Exercise 1.6 — Run the API

**Task:** Run the API project and verify it starts.

**Solution**

```bash
dotnet run --project src/PaymentApp.Api
```

You'll see output like:

```
info: Microsoft.Hosting.Lifetime[14]
      Now listening on: http://localhost:5000
info: Microsoft.Hosting.Lifetime[0]
      Application started. Press Ctrl+C to shut down.
```

Open `http://localhost:5000` in your browser — you'll get a 404 (no routes yet). That's expected.

Press `Ctrl+C` to stop.

---

## Exercise 1.7 — Examine Program.cs

The API entry point is `src/PaymentApp.Api/Program.cs`. Let's understand what's there.

**Task:** Read through Program.cs and identify:
1. Where services are registered (DI container)
2. Where the HTTP pipeline is configured
3. Where the app starts listening

**Solution**

Open `src/PaymentApp.Api/Program.cs`:

```csharp
var builder = WebApplication.CreateBuilder(args);

// 1. SERVICE REGISTRATION (DI container)
// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddOpenApi();

var app = builder.Build();

// 2. HTTP PIPELINE (middleware)
// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

// 3. START LISTENING
app.Run();
```

**The two-phase pattern:**

| Phase | What happens | Node equivalent |
|-------|--------------|-----------------|
| `builder.Services.Add...` | Register services in DI container | Setting up dependencies before `app.listen()` |
| `app.Use...` / `app.Map...` | Configure HTTP middleware pipeline | `app.use()` in Express |
| `app.Run()` | Start the server | `app.listen(port)` |

This pattern — configure services, configure pipeline, run — is the same in every ASP.NET Core app. Topic 5 goes deep on DI registration.

---

## Exercise 1.8 — Create placeholder files

Let's create empty files in each project so we have somewhere to put code in Topic 2.

**Task:** Create the following folder structure and empty files:

```
src/PaymentApp.Domain/
└── Entities/
    └── .gitkeep

src/PaymentApp.Application/
└── Interfaces/
    └── .gitkeep

src/PaymentApp.Infrastructure/
└── Data/
    └── .gitkeep

src/PaymentApp.Api/
└── Controllers/
    └── .gitkeep
```

**Solution**

```bash
mkdir -p src/PaymentApp.Domain/Entities
mkdir -p src/PaymentApp.Application/Interfaces
mkdir -p src/PaymentApp.Infrastructure/Data
mkdir -p src/PaymentApp.Api/Controllers

touch src/PaymentApp.Domain/Entities/.gitkeep
touch src/PaymentApp.Application/Interfaces/.gitkeep
touch src/PaymentApp.Infrastructure/Data/.gitkeep
touch src/PaymentApp.Api/Controllers/.gitkeep
```

**Why .gitkeep?** Git doesn't track empty folders. A `.gitkeep` file (the name is a convention) ensures the folder structure is committed.

---

## Exercise 1.9 — Verify the final structure

**Task:** Run `tree` or `ls -R` to verify your structure matches the expected layout.

**Solution**

```bash
tree -I 'bin|obj' .
# or
find . -type f -name '*.csproj' -o -name '*.cs' -o -name '*.json' | head -20
```

Expected structure:

```
PaymentApp/
├── PaymentApp.sln
└── src/
    ├── PaymentApp.Domain/
    │   ├── PaymentApp.Domain.csproj
    │   └── Entities/
    ├── PaymentApp.Application/
    │   ├── PaymentApp.Application.csproj
    │   └── Interfaces/
    ├── PaymentApp.Infrastructure/
    │   ├── PaymentApp.Infrastructure.csproj
    │   └── Data/
    └── PaymentApp.Api/
        ├── PaymentApp.Api.csproj
        ├── Program.cs
        ├── appsettings.json
        ├── appsettings.Development.json
        └── Controllers/
```

---

## What we built

| Component | Purpose |
|-----------|---------|
| `PaymentApp.sln` | Groups all projects |
| `PaymentApp.Domain` | Will hold `User` entity, `Money` value object, exceptions |
| `PaymentApp.Application` | Will hold service interfaces, DTOs |
| `PaymentApp.Infrastructure` | Will hold EF Core DbContext, repositories |
| `PaymentApp.Api` | Will hold controllers, DI registration |

**Dependencies flow inward:** Api → Infrastructure → Application → Domain. Domain knows nothing about the outside world.

---

## Recap

- "I used Clean Architecture with four layers — Domain at the center with no dependencies, Application for use cases, Infrastructure for external concerns, and Api as the entry point."
- "Project references are compile-time enforced — if I accidentally reference Infrastructure from Domain, the build fails."
- "The solution file groups projects like a monorepo. Each project compiles to its own DLL."
- "`dotnet build` at the solution level builds everything in dependency order automatically."

---

## Next: Topic 2

In Topic 2, we add the domain models: the `User` entity and `Money` value object. We'll explore C# syntax for properties, records, and value types — all through the lens of "how is this different from TypeScript?"
