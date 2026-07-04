# Topic 1: Solutions

## 1.1 — Verify the toolchain

```bash
dotnet --version        # e.g. 10.0.x
dotnet --list-sdks
dotnet nuget locals all --list
# global-packages: /Users/<you>/.nuget/packages  ← the "no node_modules" answer
```

**Talking point:** packages are cached once per user and *referenced* by projects — repos stay light; there's nothing like a 500MB `node_modules` to install per project.

## 1.2 — Scaffold and dissect

```bash
dotnet new console -n LoanBasics
cd LoanBasics
dotnet run
```

`LoanBasics.csproj` declares (at minimum) the **target framework** (`<TargetFramework>net10.0</TargetFramework>` — the "engine" version, but enforced, not advisory like `"engines"` in package.json) and the **output type**. Dependencies appear as `<PackageReference>` elements once you add one.

```bash
dotnet build
ls bin/Debug/net10.0/
# LoanBasics.dll  ← your program: IL bytecode, run by the CLR
# (plus a native launcher binary `LoanBasics` on macOS)

dotnet add package Humanizer
```

After adding: the `.csproj` gains `<PackageReference Include="Humanizer" Version="..." />` — the whole diff. No lockfile clutter in the project folder (the lock/restore data goes to `obj/`).

**The compiled output is a `.dll`** — IL bytecode, not machine code. Topic 3 digs into what that means.

## 1.3 — Single-file loan script

`loan-summary.cs`:

```csharp
#!/usr/bin/env dotnet
#:package Humanizer@2.14.1
using Humanizer;

var applicant = "Alice";
decimal amount = 300_000;
decimal rate = 5.75m;

Console.WriteLine($"{applicant} wants ${amount:N0} at {rate}%");
Console.WriteLine("LoanApplication".Humanize());   // "Loan application"
```

```bash
dotnet run loan-summary.cs     # direct run
chmod +x loan-summary.cs
./loan-summary.cs              # shebang run
```

(`{amount:N0}` is a format specifier — thousands separators, no decimals. TS equivalent: `amount.toLocaleString()`.)

## 1.4 — Graduate the script

```bash
dotnet project convert loan-summary.cs
```

This creates a folder with a `.csproj` and moves the code into it. The `#:package Humanizer@2.14.1` directive becomes a `<PackageReference>` in the `.csproj` — the script directive and the project element are the same declaration in two syntaxes.

**Talking point:** single-file C# (`dotnet run app.cs`, shebangs, `#:package`) landed in .NET 10 and gives the `node script.js` experience — but project-based development is still the norm in every production codebase.
