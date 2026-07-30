# Topic 1: Platform & Tooling — dotnet vs node

## The one question this topic answers

> **What exactly are C#, .NET, and `dotnet` — and how does the toolchain map onto node/npm?**

Get these three words straight first, because interviewers use them precisely.

## The three-layer stack

".NET" is really two things that Node bundles into one. Here's how they map:

| Layer | Node world | .NET world |
|---|---|---|
| **The language** you write | JavaScript / TypeScript | C# |
| **The runtime** that executes code | V8 + libuv (inside Node) | the **CLR** (Common Language Runtime) |
| **The standard library** | Node APIs (`fs`, `http`, `crypto`…) | the **Base Class Library** (`System.*`) |
| **The CLI / toolchain** | `node` + `npm` + `npx` | the `dotnet` CLI |
| **The web framework** | Express / Fastify (installed) | ASP.NET Core (built into the platform) |

**The one-liner:** C# is the language, .NET is the runtime + platform it runs on, and `dotnet` is the CLI that drives it all.

### What is the CLR exactly?

The CLR (Common Language Runtime) is .NET's execution engine. Think of it as what V8 is to JavaScript, but with key differences:

| Aspect | V8 (Node) | CLR (.NET) |
|--------|-----------|------------|
| **Input** | JavaScript source code | IL bytecode (compiled C#) |
| **Compilation** | JIT during execution | JIT during execution (same) |
| **Memory management** | Garbage collection | Garbage collection (same) |
| **Threading** | Single thread + event loop | Thread pool (multiple real threads) |
| **Type information** | Erased at runtime | Preserved at runtime |

The CLR is multi-language — it runs anything that compiles to its bytecode (C#, F#, VB.NET). So ".NET : C#" is like "JVM : Java", whereas Node only ever runs JavaScript.

### What is the BCL?

The Base Class Library (BCL) is .NET's standard library — the `System.*` namespaces that come built-in. It's like Node's core modules (`fs`, `http`, `path`, `crypto`) but much larger:

| Node module | .NET namespace |
|-------------|----------------|
| `fs` | `System.IO` |
| `http` | `System.Net.Http` |
| `path` | `System.IO.Path` |
| `crypto` | `System.Security.Cryptography` |
| `stream` | `System.IO.Stream` |
| `util.promisify` | Built into `Task`-based APIs |

We cover these in depth in Topic 8 (.NET Standard Library).

## Project anatomy

Scaffold a project and look inside:

```bash
dotnet new console -n HelloWorld
cd HelloWorld
dotnet run          # prints Hello, World!
```

What's in the folder (vs a Node project):

| File/Folder | Purpose | Node equivalent |
|-------------|---------|-----------------|
| `HelloWorld.csproj` | Project file (XML) | `package.json` |
| `Program.cs` | Entry point | `index.js` |
| `bin/` | Compiled output | `dist/` |
| `obj/` | Intermediate build files | Cache folders |

**What's NOT there:** `node_modules`. NuGet packages live in a per-user global cache (`~/.nuget/packages`), referenced by the project, never copied in.

### The csproj file explained

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
```

| Element | What it does | package.json equivalent |
|---------|--------------|-------------------------|
| `Sdk` attribute | Which build system to use | (implicit in npm) |
| `OutputType` | `Exe` = runnable, `Library` = DLL | `"type": "module"` |
| `TargetFramework` | .NET version | `"engines": { "node": ">=18" }` |
| `ImplicitUsings` | Auto-import common namespaces | (no equivalent) |
| `Nullable` | Enable null-safety warnings | `"strict": true` in tsconfig |

Dependencies appear as `<PackageReference>` elements:

```xml
<ItemGroup>
  <PackageReference Include="Humanizer" Version="2.14.1" />
</ItemGroup>
```

### The biggest workflow shift: no file imports

In Node/TypeScript, you import specific files:

```typescript
import { PaymentService } from './services/payment';
import { User } from '../models/user';
```

In C#, **you never import files.** Every `.cs` file in the project compiles together automatically. The `using` directive imports *namespaces* (a named group of types), never file paths:

```csharp
using PaymentApp.Domain.Entities;  // imports all types in this namespace
```

| Node/TS | C# |
|---------|-----|
| Import specific files | All files compile together |
| `import { X } from './path'` | `using Namespace;` |
| Barrel files (`index.ts`) | Namespaces |
| Path aliases (`@/services`) | Project references |

**Why this matters:** No relative-path spaghetti, no barrel files, no circular dependency headaches. Organization is by namespace, and the compiler finds the files itself.

## Solutions and projects

Node has one `package.json` per project. .NET has two levels:

| Concept | Purpose | Node equivalent |
|---------|---------|-----------------|
| **Project** (`.csproj`) | One compilable unit | One `package.json` |
| **Solution** (`.sln`) | Groups multiple projects | Monorepo root |

A real application typically has multiple projects in one solution:

```
PaymentApp.sln
├── PaymentApp.Domain/           # Core business logic
├── PaymentApp.Application/      # Use cases, DTOs
├── PaymentApp.Infrastructure/   # Database, external services
└── PaymentApp.Api/              # Web API entry point
```

Projects reference each other with `<ProjectReference>`:

```xml
<!-- In PaymentApp.Api.csproj -->
<ItemGroup>
  <ProjectReference Include="..\PaymentApp.Application\PaymentApp.Application.csproj" />
</ItemGroup>
```

This is like npm workspaces, but with compile-time enforcement: if Api references Application, Application can't reference Api back — the compiler will error.

## The dotnet CLI

The `dotnet` CLI is `node` + `npm` in one binary:

| Task | Node | .NET |
|---|---|---|
| Run | `node app.js` | `dotnet run` |
| Compile only | `tsc` | `dotnet build` |
| Add dependency | `npm install pkg` | `dotnet add package PkgName` |
| Test | `npx jest` | `dotnet test` |
| Watch mode | `nodemon` | `dotnet watch run` |
| Scaffold | `npm create ...` | `dotnet new <template>` |
| Create solution | (manual) | `dotnet new sln` |
| Add project to solution | (manual) | `dotnet sln add <project>` |

(The full cheat sheet is on the **Commands** page.)

## NuGet — npm for .NET

NuGet is the package ecosystem: [nuget.org](https://www.nuget.org) is the public registry.

| Aspect | npm | NuGet |
|--------|-----|-------|
| Registry | npmjs.com | nuget.org |
| Config file | `package.json` | `.csproj` |
| Add package | `npm install lodash` | `dotnet add package Humanizer` |
| Lock file | `package-lock.json` | `packages.lock.json` (opt-in) |
| Package location | `node_modules/` per project | `~/.nuget/packages` (global cache) |
| Post-clone install | `npm install` | Nothing (auto-restores on build) |

### Why the global cache matters

In Node, every project copies packages into its own `node_modules`. Clone three projects using lodash, get three copies. Delete `node_modules` to "clean up", wait minutes to reinstall.

In .NET, packages download once to `~/.nuget/packages`. Every project references them from there. Benefits:

- **Repos stay light** — no 500MB folders to clone
- **No post-clone install** — dependencies restore automatically on first build
- **Disk space** — one copy per version, shared across all projects

### Packages ship compiled

A `.nupkg` (NuGet package) is a zip of already-compiled DLLs. There's no install-time build step, no `postinstall` scripts. The compiler just links against the assembly.

## Single-file scripts (new in .NET 10)

For quick scripts, you don't need a project. A single `.cs` file runs directly:

```bash
echo 'Console.WriteLine("Hello!");' > hello.cs
dotnet run hello.cs
```

**With packages** — the `#:package` directive replaces `package.json`:

```csharp
#:package Humanizer@2.14.1
using Humanizer;
Console.WriteLine("TransferRequest".Humanize());  // "Transfer request"
```

**Shebang support** — make it executable:

```csharp
#!/usr/bin/env dotnet
Console.WriteLine("I'm a script!");
```

```bash
chmod +x script.cs
./script.cs
```

**Graduate to a project:**

```bash
dotnet project convert script.cs
```

**Caveat:** This is new in .NET 10 (late 2025). Most codebases and interviewers won't know it. Treat it as scripting convenience — real work uses projects.

## Why .NET 10?

This course uses .NET 10, the current LTS (Long Term Support) release. Key features we use:

| Feature | What it enables |
|---------|-----------------|
| File-scoped namespaces | One less level of indentation |
| Top-level statements | No `Main` method boilerplate |
| Single-file scripts | `dotnet run app.cs` |
| `#:package` directive | NuGet in scripts |
| Global usings | Common namespaces auto-imported |
| Nullable reference types | Null-safety by default |

## Interview talking points

- "C# is the language, .NET is the runtime and platform, `dotnet` is the CLI" — say it exactly like that.
- The CLR is to C# what the JVM is to Java; Node by contrast runs only JS.
- No file imports: code is organized by **namespace**, all `.cs` files in a project compile together.
- Dependencies live in a global NuGet cache — there is no `node_modules` to weigh down a repo.
- Solutions group multiple projects; projects reference each other with compile-time dependency enforcement.
- ASP.NET Core is built into the platform — it's not a third-party framework like Express.
