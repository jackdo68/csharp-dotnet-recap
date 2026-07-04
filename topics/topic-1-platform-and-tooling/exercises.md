# Topic 1: Exercises & Solutions

Work inside your workspace folder (`~/csharp-recap`). These take ~30 minutes total. Try each exercise before reading its solution.

## Exercise 1.1 — Verify the toolchain

Install the SDK if you haven't (see **Setup**), then prove it's alive:

1. Print the SDK version. Confirm it's 10.x.
2. List all installed SDKs.
3. Find where the NuGet package cache lives on your machine (the "no node_modules" claim — verify it).

**Solution**

```bash
dotnet --version        # e.g. 10.0.x
dotnet --list-sdks
dotnet nuget locals all --list
# global-packages: /Users/<you>/.nuget/packages  ← the "no node_modules" answer
```

**Talking point:** packages are cached once per user and *referenced* by projects — repos stay light; there's nothing like a 500MB `node_modules` to install per project.

## Exercise 1.2 — Scaffold and dissect a project

1. Create a console app called `LoanBasics` and run it.
2. Open `LoanBasics.csproj` — identify the two things it declares (compare mentally to `package.json`: where are dependencies? where is the "engine" version?).
3. Run a build, then look inside `bin/Debug/` — find the compiled output. What file extension does your compiled program have?
4. Add a NuGet package (`Humanizer`) to the project and check what changed in the `.csproj`.

**Solution**

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

## Exercise 1.3 — A single-file loan script

1. Create a standalone file `loan-summary.cs` (no project) that prints a one-line loan summary, e.g. `Alice wants $300,000 at 5.75%`. Run it directly with the CLI.
2. Add a shebang line, `chmod +x` it, and run it as `./loan-summary.cs`.
3. Add the `Humanizer` package to the script with a `#:package` directive and use it (e.g. `"LoanApplication".Humanize()` → "Loan application").

**Solution**

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

## Exercise 1.4 — Graduate the script

Convert `loan-summary.cs` into a real project with the CLI (one command). Inspect what was generated — where did the `#:package` directive go?

**Solution**

```bash
dotnet project convert loan-summary.cs
```

This creates a folder with a `.csproj` and moves the code into it. The `#:package Humanizer@2.14.1` directive becomes a `<PackageReference>` in the `.csproj` — the script directive and the project element are the same declaration in two syntaxes.

**Talking point:** single-file C# (`dotnet run app.cs`, shebangs, `#:package`) landed in .NET 10 and gives the `node script.js` experience — but project-based development is still the norm in every production codebase.
