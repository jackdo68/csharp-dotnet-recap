# Setup

Get a working C#/.NET toolchain on macOS (~15 minutes), plus how this repo and its site work.

## 1. Install the .NET SDK

```bash
# Homebrew is easiest
brew install --cask dotnet-sdk

# Verify — you want 10.x
dotnet --version
```

If `dotnet --version` prints something like `10.0.x`, you're set. (No Homebrew? Download the macOS installer from https://dotnet.microsoft.com/download and run it.)

Unlike Node, the SDK is the whole toolchain: compiler, runtime, package manager, test runner. There's no separate npm/npx to install.

## 2. VS Code extension

Install the **C# Dev Kit** extension (publisher: Microsoft) from the Extensions panel. It gives you IntelliSense, debugging, and test running — the equivalent of your TS tooling.

## 3. Docker (needed from Topic 6 on)

Topics 6–9 run PostgreSQL — and eventually the app itself — in containers via `docker compose`. If you don't already have it:

```bash
brew install --cask docker     # Docker Desktop; or use OrbStack/colima if you prefer
docker compose version         # verify
```

Nothing to configure now; Topic 6 supplies the compose file.

## 4. Make a workspace folder for the exercises

```bash
mkdir ~/csharp-recap && cd ~/csharp-recap
```

All exercises assume this folder. Each topic tells you exactly what to scaffold inside it.

## About this repo

```
topics/       ← the course content (source of truth): lesson / exercises (with solutions) per topic
COMMANDS.md   ← the dotnet CLI cheat sheet
site/         ← the Astro (Starlight) site that renders it all
```

The site syncs `topics/` into its content directory at build time, so **edit the markdown in `topics/`, not in `site/src/content/`**. The site isn't run locally — it exists to be deployed.

### Deployment

Pushing to `main` triggers the GitHub Actions workflow in `.github/workflows/deploy.yml`, which builds the site and deploys it to GitHub Pages at **https://jackdo68.github.io/csharp-dotnet-recap/**. One-time repo setting: Settings → Pages → Source → **GitHub Actions**.
