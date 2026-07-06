# Topic 1: Hands On

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

1. Create a console app called `PaymentBasics` and run it.
2. Open `PaymentBasics.csproj` — identify the two things it declares (compare mentally to `package.json`: where are dependencies? where is the "engine" version?).
3. Run a build, then look inside `bin/Debug/` — find the compiled output. What file extension does your compiled program have?
4. Add a NuGet package (`Humanizer`) to the project and check what changed in the `.csproj`.

**Solution**

```bash
dotnet new console -n PaymentBasics
cd PaymentBasics
dotnet run
```

`PaymentBasics.csproj` declares (at minimum) the **target framework** (`<TargetFramework>net10.0</TargetFramework>` — the "engine" version, but enforced, not advisory like `"engines"` in package.json) and the **output type**. Dependencies appear as `<PackageReference>` elements once you add one.

```bash
dotnet build
ls bin/Debug/net10.0/
# PaymentBasics.dll  ← your program: IL bytecode, run by the CLR
# (plus a native launcher binary `PaymentBasics` on macOS)

dotnet add package Humanizer
```

After adding: the `.csproj` gains `<PackageReference Include="Humanizer" Version="..." />` — the whole diff. No lockfile clutter in the project folder (the lock/restore data goes to `obj/`).

**The compiled output is a `.dll`** — IL bytecode, not machine code. Topic 3 digs into what that means.

## Exercise 1.3 — A single-file payment script

1. Create a standalone file `transfer-summary.cs` (no project) that prints a one-line transfer summary, e.g. `Alice sends $250.00 to Bob`. Run it directly with the CLI. (These names — Alice, Bob, a `decimal` amount — are the exact players Topic 5's `PaymentApp` transfer endpoint uses.)
2. Add a shebang line, `chmod +x` it, and run it as `./transfer-summary.cs`.
3. Add the `Humanizer` package to the script with a `#:package` directive and use it (e.g. `"TransferRequest".Humanize()` → "Transfer request").

**Solution**

`transfer-summary.cs`:

```csharp
#!/usr/bin/env dotnet
#:package Humanizer@2.14.1
using Humanizer;

var from = "Alice";
var to = "Bob";
decimal amount = 250m;              // money is ALWAYS decimal in this course — never double

Console.WriteLine($"{from} sends ${amount:N2} to {to}");
Console.WriteLine("TransferRequest".Humanize());   // "Transfer request"
```

```bash
dotnet run transfer-summary.cs     # direct run
chmod +x transfer-summary.cs
./transfer-summary.cs              # shebang run
```

(`{amount:N2}` is a format specifier — thousands separators, two decimals. TS equivalent: `amount.toLocaleString()`. Why `decimal` and not `double`? Topic 2 explains — binary floating point can't represent `0.1` exactly, and you never round money wrong twice.)

## Exercise 1.4 — Graduate the script

Convert `transfer-summary.cs` into a real project with the CLI (one command). Inspect what was generated — where did the `#:package` directive go?

**Solution**

```bash
dotnet project convert transfer-summary.cs
```

This creates a folder with a `.csproj` and moves the code into it. The `#:package Humanizer@2.14.1` directive becomes a `<PackageReference>` in the `.csproj` — the script directive and the project element are the same declaration in two syntaxes.

**Talking point:** single-file C# (`dotnet run app.cs`, shebangs, `#:package`) landed in .NET 10 and gives the `node script.js` experience — but project-based development is still the norm in every production codebase.
