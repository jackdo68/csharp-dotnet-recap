# Commands — the dotnet CLI cheat sheet

The `dotnet` CLI is `node` + `npm` + `npx` in one binary. Everything you do through npm scripts, you do through `dotnet` verbs.

## Daily driver

| Task | Node world | .NET world |
|---|---|---|
| Run the app | `node app.js` / `npm start` | `dotnet run` |
| Run a single file (no project) | `node script.js` | `dotnet run script.cs` (.NET 10+) |
| Compile only | `tsc` | `dotnet build` |
| Run tests | `npx jest` / `npm test` | `dotnet test` |
| Add a dependency | `npm install pkg` | `dotnet add package PkgName` |
| Reference a sibling project | `"workspaces"` / relative import | `dotnet add reference ../Other/Other.csproj` |
| Scaffold a project | `npm create ...` | `dotnet new <template> -n Name` |
| Watch mode | `nodemon` / `tsx watch` | `dotnet watch run` |
| Install a global tool | `npm i -g pkg` | `dotnet tool install --global pkg` |

## Scaffolding templates

```bash
dotnet new console -n Name                    # console app (a script playground)
dotnet new webapi --use-controllers -n Name   # Web API, controller style (what banks use)
dotnet new xunit -n Name                      # test project
dotnet new list                               # see all installed templates
```

## Entity Framework Core (the Prisma migrate equivalents)

```bash
dotnet tool install --global dotnet-ef    # one-time CLI install
dotnet ef migrations add <Name>           # create a migration from model changes
dotnet ef database update                 # apply pending migrations
dotnet ef migrations list                 # show migrations + applied status
```

## Useful inspection

```bash
dotnet --version          # SDK version (want 10.x)
dotnet --list-sdks        # all installed SDKs
dotnet nuget locals all --list   # where the package cache lives (no node_modules!)
```

## Single-file scripts (.NET 10+)

```csharp
#!/usr/bin/env dotnet
#:package Humanizer@2.14.1
using Humanizer;
Console.WriteLine("LoanApplication".Humanize());
```

```bash
chmod +x script.cs && ./script.cs     # runs like a shell script
dotnet project convert script.cs      # graduate it to a real project
```
