# Topic 1: Platform & Tooling — dotnet vs node

## The one question this topic answers

> **What exactly are C#, .NET, and `dotnet` — and how does the toolchain map onto node/npm?**

Get these three words straight first, because interviewers use them precisely. ".NET" is really two things that Node bundles into one:

| Layer | Node world | .NET world |
|---|---|---|
| **The language** you write | JavaScript / TypeScript | C# |
| **The runtime** that executes code | V8 + libuv (inside Node) | the **CLR** (Common Language Runtime) |
| **The standard library** | Node APIs (`fs`, `http`, `crypto`…) | the **Base Class Library** (`System.*`) |
| **The CLI / toolchain** | `node` + `npm` + `npx` | the `dotnet` CLI |
| **The web framework** | Express / Fastify (installed) | ASP.NET Core (built into the platform) |

The one-liner: **C# is the language, .NET is the runtime + platform it runs on, and `dotnet` is the CLI that drives it all.**

One nuance: .NET is multi-language — the CLR runs anything that compiles to its bytecode (C#, F#, VB.NET), so ".NET : C#" is like "the JVM : Java", whereas Node only ever runs JS.

## Project anatomy — and the biggest workflow shift

Scaffold a project and look inside:

```bash
dotnet new console -n PaymentBasics
cd PaymentBasics
dotnet run          # prints Hello, World!
```

What's in the folder (vs a Node project):

- **`PaymentBasics.csproj`** — your `package.json`, but XML: dependencies, target framework, build settings.
- **`Program.cs`** — source code. Modern C# allows top-level statements: script-style code with no boilerplate `Main` method.
- **`bin/` and `obj/`** — build output, like `dist/`. Git-ignore them.
- **No `node_modules`** — NuGet packages live in a per-user global cache (`~/.nuget/packages`), referenced by the project, never copied in.

Here's the big mental shift: **you never import your own files.** Every `.cs` file in the project compiles together automatically. `using Xyz;` at the top of a file imports a *namespace* (a named group of types), never a file path. There is no `import { PaymentService } from './services/payment'` equivalent — organization is by namespace (Topic 2 covers the conventions), and the compiler finds the files itself. No relative-path import spaghetti, no barrel files, no path aliases.

## The dotnet CLI is node + npm in one binary

| Task | Node | .NET |
|---|---|---|
| Run | `node app.js` | `dotnet run` (compiles, then runs) |
| Compile only | `tsc` | `dotnet build` |
| Add dependency | `npm install pkg` | `dotnet add package PkgName` |
| Test | `npx jest` | `dotnet test` |
| Watch mode | `nodemon` | `dotnet watch run` |
| Scaffold | `npm create ...` | `dotnet new <template> -n Name` |

(The full cheat sheet is on the **Commands** page.)

## NuGet — npm for .NET

NuGet is the package ecosystem: [nuget.org](https://www.nuget.org) is the public registry, and the `dotnet` CLI is the client (there's no separate `npm`-style tool to install). The pieces map one-to-one:

| Node world | .NET world |
|---|---|
| npm registry (npmjs.com) | NuGet registry (nuget.org) |
| `dependencies` in `package.json` | `<PackageReference>` entries in the `.csproj` |
| `npm install lodash` | `dotnet add package Humanizer` |
| `package-lock.json` | `packages.lock.json` (opt-in — exact versions in the `.csproj` usually suffice) |
| `node_modules/` per project | one global cache: `~/.nuget/packages`, shared by every project |
| `npm install` after clone | nothing — restore runs automatically inside `dotnet build` / `dotnet run` |

Running `dotnet add package Humanizer` edits the `.csproj` for you:

```xml
<ItemGroup>
  <PackageReference Include="Humanizer" Version="2.14.1" />
</ItemGroup>
```

Two differences worth internalizing:

- **One cache per machine, not one folder per project.** Each package version downloads once into `~/.nuget/packages`; every project references it from there at build time. No 500 MB folder to delete, nothing package-related to `.gitignore`, and cloning a repo is instant because dependencies were never in it.
- **Packages ship compiled, not as source.** A `.nupkg` is a zip of already-compiled DLLs plus metadata. There's no install-time build/transpile step (and no `postinstall` scripts) — the compiler just links against the assembly.

## Single-file scripts — the `node script.js` experience

You always need the SDK installed (C# has no pre-installed runtime, same as JS needs Node), but since .NET 10 you **don't** need a project. A single `.cs` file runs directly:

```bash
echo 'Console.WriteLine("Hello from one file!");' > hello.cs
dotnet run hello.cs
```

Two extras that complete the Node-like scripting feel:

**Shebang support** — make a `.cs` file executable like a shell script:

```csharp
#!/usr/bin/env dotnet
Console.WriteLine("I'm a C# script");
```

**NuGet packages without a project** — a `#:package` directive replaces `package.json` for one-off scripts:

```csharp
#:package Humanizer@2.14.1
using Humanizer;
Console.WriteLine("TransferRequest".Humanize());   // "Transfer request"
```

If a script grows up, `dotnet project convert hello.cs` turns it into a normal project.

Caveats: this is new in .NET 10 (late 2025) — many tutorials and interviewers won't know it exists, so treat it as a scripting convenience, not the norm. First run is slower than `node` (it's compiling; later runs are cached). Real work — multiple files, tests, web APIs — uses projects, and the `.csproj` world is what you'll see in any bank codebase.

## Interview talking points

- "C# is the language, .NET is the runtime and platform, `dotnet` is the CLI" — say it exactly like that.
- The CLR is to C# what the JVM is to Java; Node by contrast runs only JS.
- No file imports: code is organized by **namespace**, all `.cs` files in a project compile together.
- Dependencies live in a global NuGet cache — there is no `node_modules` to weigh down a repo.
