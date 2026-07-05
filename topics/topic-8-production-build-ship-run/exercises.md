# Topic 8: Exercises & Solutions

These extend the `LoanApp` API from Topics 5–6. You'll need Docker Desktop (or another docker daemon) running for 8.2–8.4. Try each exercise before reading its solution.

## Exercise 8.1 — Publish and inspect the artifact

1. Run a plain `dotnet publish -c Release -o publish` on `LoanApp` and look inside the output folder. Find your program, and identify which files are *yours* vs *dependencies*.
2. Run the published app directly (no `dotnet run`) and hit an endpoint.
3. Compare sizes: publish again with `--self-contained -o publish-sc` and `du -sh` both folders. Explain the difference in one sentence — which one needs the runtime image and which could run on a bare distro?

**Solution**

```bash
dotnet publish -c Release -o publish
ls publish/
# LoanApp.dll            ← your program (IL, Topic 3)
# LoanApp.deps.json      ← dependency manifest
# appsettings.json       ← config ships alongside
# Microsoft.EntityFrameworkCore.dll etc. ← NuGet deps, copied out of the global cache

dotnet publish/LoanApp.dll     # runs without the project — this is what the container runs
curl http://localhost:5000/api/loans

dotnet publish -c Release --self-contained -o publish-sc
du -sh publish publish-sc
# publish:     ~5 MB      ← framework-dependent: needs a runtime on the machine
# publish-sc:  ~70+ MB    ← self-contained: the runtime is IN the folder
```

Framework-dependent is the Docker default (the `aspnet` base image *is* the runtime); self-contained trades size for running anywhere — even a distroless image with no .NET installed.

**Talking point:** "publish output is IL DLLs plus a deps manifest — the container runs `dotnet LoanApp.dll`, it never sees my source." Contrast with Node, where the container runs your actual `.js` source files.

## Exercise 8.2 — Containerize LoanApp

1. Write a `.dockerignore` (what are the two directories that *must* be in it, and why?).
2. Write the multi-stage Dockerfile: SDK image to publish, `aspnet` image to run.
3. Build and run it. Gotcha hunt: which port does the container listen on, and what happens to `loans.db` when you `docker rm` the container?

**Solution**

`.dockerignore`:

```
bin/
obj/
```

Without it, your local `bin/`/`obj/` (built on macOS, possibly Debug) get COPY'd in and collide with the container's own restore/build — the classic "works on my machine, weird in Docker" source. Same reason `node_modules` goes in Node's `.dockerignore`.

`Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY LoanApp.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "LoanApp.dll"]
```

```bash
docker build -t loanapp .
docker run --rm -p 8080:8080 loanapp
curl http://localhost:8080/api/loans     # [] — alive!
```

The gotchas: the `aspnet` image (since .NET 8) listens on **8080** and runs as non-root — mapping `-p 80:80` gets you nothing. And `loans.db` is written *inside* the container's filesystem, so it vanishes with the container — in real deployments the connection string points at a database server, not a file next to the DLL (which 8.3 fixes the config for).

**Talking point:** the layer-cache trick — `COPY *.csproj` + `restore` before `COPY . .` — is the same optimization as `COPY package*.json` + `npm ci`. Saying "I structure Dockerfiles so dependency layers cache" is stack-independent seniority.

## Exercise 8.3 — Health checks and env-var config

1. Add a health endpoint at `/healthz` (two lines — no package install). Verify with curl.
2. Move the SQLite connection string into `appsettings.json` under `ConnectionStrings:LoanDb` (and read it with `builder.Configuration.GetConnectionString("LoanDb")`).
3. Now override it **from outside**: run the container with an env var that redirects the database to `/tmp/other.db`, without rebuilding the image. What's the exact env-var name?

**Solution**

`Program.cs`:

```csharp
builder.Services.AddHealthChecks();
// ...
app.MapHealthChecks("/healthz");
```

```bash
curl http://localhost:8080/healthz    # Healthy
```

`appsettings.json`:

```json
{
  "ConnectionStrings": {
    "LoanDb": "Data Source=loans.db"
  }
}
```

```csharp
builder.Services.AddDbContext<LoanDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("LoanDb")));
```

The override — `__` (double underscore) is how env vars spell the `:` hierarchy:

```bash
docker run --rm -p 8080:8080 \
  -e ConnectionStrings__LoanDb="Data Source=/tmp/other.db" \
  loanapp
```

No dotenv, no config library, no rebuild: the configuration system layers env vars **over** `appsettings.json` out of the box. In Kubernetes this is exactly how a Secret becomes the connection string — `env: - name: ConnectionStrings__LoanDb, valueFrom: secretKeyRef: ...`.

**Talking point:** "config is a layered system — JSON file, environment-specific JSON, env vars, each overriding the last. The `__` separator is the env-var spelling of the `:` path."

## Exercise 8.4 — Graceful shutdown, observed

1. Add a deliberately slow endpoint: `GET /api/loans/slow` that awaits 5 seconds then returns (you know how — Topic 7).
2. Start the container, curl the slow endpoint, and while it's hanging, `docker stop` the container from another terminal.
3. Watch both terminals. Did your in-flight request complete or die? What did the app log? Which Node boilerplate did you just *not* write?

**Solution**

Controller:

```csharp
[HttpGet("slow")]
public async Task<ActionResult<string>> Slow()
{
    await Task.Delay(5000);
    return Ok("finished politely");
}
```

The observation:

```bash
# terminal 1:
curl http://localhost:8080/api/loans/slow     # hangs...

# terminal 2, while it hangs:
docker stop <container>

# terminal 1, ~seconds later:
finished politely                              # the in-flight request COMPLETED

# container logs:
# info: Microsoft.Hosting.Lifetime[0]  Application is shutting down...
```

`docker stop` sends SIGTERM; the ASP.NET Core host catches it, stops accepting new connections, lets in-flight requests drain (default grace ~30s, k8s default `terminationGracePeriodSeconds` is 30 too — they're designed to fit), then exits. The Node version of this behaviour is a hand-rolled `process.on('SIGTERM')` + `server.close()` + connection-tracking dance that every team writes slightly differently — here it's the host's job. During a k8s rolling deploy this is the difference between zero dropped requests and a spike of 502s.

**Talking point:** "rolling deploys drop no requests by default — the host drains on SIGTERM" — difference #5 again, wearing production clothes.

## Exercise 8.5 — Choose the stack

For each system, pick **Node** or **.NET** and justify in one line (there are defensible answers both ways for some — the justification is the exercise):

1. A BFF for a Next.js frontend, sharing the TS types for `LoanApplication` end to end.
2. The loan **decision engine**: rules evaluation + amortization math, p99 under 50 ms, 3,000 req/s.
3. A lambda that fires when a document lands in S3 and stamps it with a watermark.
4. The bank's loan-servicing platform: REST API + nightly interest batch + scheduled statements, one team, ten-year horizon.
5. A WebSocket gateway fanning out loan-status notifications to 100k connected browsers — it transforms nothing, just routes messages.

**Solution**

1. **Node** — sharing the actual TS types across frontend and BFF removes a whole class of drift; the BFF is thin I/O, Node's home turf.
2. **.NET** — CPU in the request path at high RPS is the textbook case: real parallelism across cores (difference #2), `decimal` for the math, no worker_threads choreography.
3. **Node** — cold-start-sensitive, tiny, I/O-bound: exactly where .NET's JIT startup tax hurts most (AOT is the .NET counter-argument, but Node is the path of least resistance).
4. **.NET** — API + background jobs + scheduling in one process and one DI container (differences #5 and #2 together); ten-year bank horizon is the ecosystem's home turf.
5. **Both defensible** — the strongest interview answer. Node: pure I/O fan-out, zero CPU per message, mature socket ecosystem. .NET: SignalR is built in and one process holds all 100k connections across every core. What you're being tested on is the *reasoning*, not the letter.

**Talking point:** "for standard CRUD, both are fine and the team decides; the architecture decides when CPU enters the request path, or when one process needs to be a whole platform." Partisanship reads junior; trade-offs read senior.

---

**Course complete.** Re-read the five big differences in the [Guide](../../guide/) and say each one out loud with the example you just built — including the one you can now say about production: "no pm2, the host drains SIGTERM, and the runtime sizes itself to the pod." That's the interview prep.
