# Topic 1: Exercises

Work inside your workspace folder (`~/csharp-recap`). These take ~30 minutes total.

## Exercise 1.1 — Verify the toolchain

Install the SDK if you haven't (see **Setup**), then prove it's alive:

1. Print the SDK version. Confirm it's 10.x.
2. List all installed SDKs.
3. Find where the NuGet package cache lives on your machine (the "no node_modules" claim — verify it).

## Exercise 1.2 — Scaffold and dissect a project

1. Create a console app called `LoanBasics` and run it.
2. Open `LoanBasics.csproj` — identify the two things it declares (compare mentally to `package.json`: where are dependencies? where is the "engine" version?).
3. Run a build, then look inside `bin/Debug/` — find the compiled output. What file extension does your compiled program have?
4. Add a NuGet package (`Humanizer`) to the project and check what changed in the `.csproj`.

## Exercise 1.3 — A single-file loan script

1. Create a standalone file `loan-summary.cs` (no project) that prints a one-line loan summary, e.g. `Alice wants $300,000 at 5.75%`. Run it directly with the CLI.
2. Add a shebang line, `chmod +x` it, and run it as `./loan-summary.cs`.
3. Add the `Humanizer` package to the script with a `#:package` directive and use it (e.g. `"LoanApplication".Humanize()` → "Loan application").

## Exercise 1.4 — Graduate the script

Convert `loan-summary.cs` into a real project with the CLI (one command). Inspect what was generated — where did the `#:package` directive go?
