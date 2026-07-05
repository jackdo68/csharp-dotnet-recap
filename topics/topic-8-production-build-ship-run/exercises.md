# Topic 8: Exercises & Solutions

> **The PaymentApp build:** Topic 5 the API, straight onto Postgres → Topic 6 EF unpacked + tests → Topic 7 the transfer race → **Topic 8 (you are here): Docker & ship** → Topic 9 register, login, lock down → Topic 10 the pipeline & the payment processor.

These ship the `PaymentApp` you've been building since Topic 5. You'll need Docker running (you have it since Topic 5 — the Postgres container). The compose file from Topic 5 grows a second service here. Try each exercise before reading its solution.

## Exercise 8.1 — Publish and inspect the artifact

1. Run a plain `dotnet publish -c Release -o publish` on `PaymentApp` and look inside the output folder. Find your program, and identify which files are *yours* vs *dependencies*.
2. Run the published app directly (no `dotnet run`) and hit an endpoint (Postgres from Topic 5 must be up: `docker compose up -d`).
3. Compare sizes: publish again with `--self-contained -o publish-sc` and `du -sh` both folders. Explain the difference in one sentence — which one needs the runtime image and which could run on a bare distro?

**Solution**

```bash
dotnet publish -c Release -o publish
ls publish/
# PaymentApp.dll         ← your program (IL, Topic 3)
# PaymentApp.deps.json   ← dependency manifest
# appsettings.json       ← config ships alongside
# Npgsql.dll, Microsoft.EntityFrameworkCore.dll, ... ← NuGet deps, copied out of the global cache

dotnet publish/PaymentApp.dll     # runs without the project — this is what the container runs
curl http://localhost:5000/v1/account/1/balance

dotnet publish -c Release --self-contained -o publish-sc
du -sh publish publish-sc
# publish:     ~5 MB      ← framework-dependent: needs a runtime on the machine
# publish-sc:  ~70+ MB    ← self-contained: the runtime is IN the folder
```

Framework-dependent is the Docker default (the `aspnet` base image *is* the runtime); self-contained trades size for running anywhere — even a distroless image with no .NET installed.

**Talking point:** "publish output is IL DLLs plus a deps manifest — the container runs `dotnet PaymentApp.dll`, it never sees my source." Contrast with Node, where the container runs your actual `.js` source files.

## Exercise 8.2 — Health checks and env-var config

The containerized app (8.3) will need both of these — build them now, while everything still runs locally.

1. Add a health endpoint at `/healthz` (two lines — no package install). Verify with curl.
2. Topic 5 hardcoded the connection string in `Program.cs`. Move it into `appsettings.json` under `ConnectionStrings:PaymentDb` and read it with `builder.Configuration.GetConnectionString("PaymentDb")`. Confirm the app still works.
3. Now prove env vars win **without touching any file**: start the app with the password overridden to something wrong, and watch the first request fail. What's the exact env-var name, and what does `__` mean in it?

**Solution**

`Program.cs`:

```csharp
builder.Services.AddHealthChecks();
// ...
app.MapHealthChecks("/healthz");
```

```bash
curl http://localhost:PORT/healthz    # Healthy
```

`appsettings.json`:

```json
{
  "ConnectionStrings": {
    "PaymentDb": "Host=localhost;Database=payapp;Username=payapp;Password=devpass"
  }
}
```

```csharp
builder.Services.AddDbContext<PaymentDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("PaymentDb")));
```

The override — `__` (double underscore) is how env vars spell the `:` hierarchy:

```bash
ConnectionStrings__PaymentDb="Host=localhost;Database=payapp;Username=payapp;Password=WRONG" \
  dotnet run
# app starts fine (config isn't validated at startup)...
curl http://localhost:PORT/v1/account/1/balance
# → 500: Npgsql "password authentication failed for user 'payapp'"
```

The failure is the proof: the env var **beat** `appsettings.json` — no dotenv, no config library, no rebuild. The configuration system layers env vars over the JSON files out of the box. In Kubernetes this exact mechanism is how a Secret becomes the connection string (`env: - name: ConnectionStrings__PaymentDb, valueFrom: secretKeyRef: ...`), and in 8.3 it's how the containerized app finds Postgres.

**Talking point:** "config is a layered system — JSON file, environment-specific JSON, env vars, each overriding the last. The `__` separator is the env-var spelling of the `:` path."

## Exercise 8.3 — Containerize PaymentApp

1. Write a `.dockerignore` (what are the two directories that *must* be in it, and why?).
2. Write the multi-stage Dockerfile: SDK image to publish, `aspnet` image to run.
3. Build it, then run it **standalone**: `docker run --rm -p 8080:8080 paymentapp`, and curl a balance. It fails — read the error and explain why `localhost` lies inside a container.
4. Fix it properly: grow Topic 5's `docker-compose.yml` with an `api` service so the app and Postgres share a network, and point the app at the database with the env var from 8.2. `docker compose up --build`, then curl.

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
COPY PaymentApp.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "PaymentApp.dll"]
```

3\. The standalone run starts fine, but the first request 500s with Npgsql `Connection refused` on `localhost:5432`. Inside a container, `localhost` **is the container** — the app is knocking on its own door looking for Postgres. Your Mac's `localhost:5432` (where the compose Postgres listens) is a different network namespace entirely. (Two gotchas you also just dodged: since .NET 8 the `aspnet` image listens on **8080**, not 80, and runs as a non-root `app` user.)

4\. The fix is the compose network — containers in one compose file reach each other **by service name**. `docker-compose.yml` becomes:

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: payapp
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: payapp
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      ConnectionStrings__PaymentDb: "Host=db;Database=payapp;Username=payapp;Password=devpass"
    depends_on:
      - db

volumes:
  pgdata:
```

`Host=db` — the service name is the hostname. The env var from 8.2 overrides `appsettings.json`'s `Host=localhost` without rebuilding anything; the image is environment-agnostic, which is the whole point.

```bash
docker compose up --build
curl http://localhost:8080/v1/account/1/balance     # your existing users — same volume, same data
```

(Your Topics 5–6 migrations already created the schema in the `pgdata` volume, so it just works. In real deployments, migrations run as a CI step or init container — not on app startup.)

**Talking point:** the layer-cache trick — `COPY *.csproj` + `restore` before `COPY . .` — is the same optimization as `COPY package*.json` + `npm ci`. And "the image is environment-agnostic; config comes from the environment" is twelve-factor language that lands in any interview, Node or .NET.

## Exercise 8.4 — Graceful shutdown, observed

1. Add a deliberately slow endpoint: `GET /v1/payments/slow` that awaits 5 seconds then returns (you know how — Topic 7).
2. `docker compose up --build`, curl the slow endpoint, and while it's hanging, run `docker compose stop api` from another terminal.
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
curl http://localhost:8080/v1/payments/slow     # hangs...

# terminal 2, while it hangs:
docker compose stop api

# terminal 1, ~seconds later:
finished politely                                # the in-flight request COMPLETED

# api logs:
# info: Microsoft.Hosting.Lifetime[0]  Application is shutting down...
```

`docker compose stop` sends SIGTERM; the ASP.NET Core host catches it, stops accepting new connections, lets in-flight requests drain (default grace ~30s — matching k8s's default `terminationGracePeriodSeconds` of 30), then exits. The Node version of this behaviour is a hand-rolled `process.on('SIGTERM')` + `server.close()` + connection-tracking dance that every team writes slightly differently — here it's the host's job. For a *payment* API this is more than tidiness: killing a transfer mid-flight is exactly the class of incident Topic 7 taught you to fear. During a k8s rolling deploy this is the difference between zero dropped requests and a spike of 502s.

**Talking point:** "rolling deploys drop no requests by default — the host drains on SIGTERM" — difference #5 again, wearing production clothes.

## Exercise 8.5 — Choose the stack

For each system, pick **Node** or **.NET** and justify in one line (there are defensible answers both ways for some — the justification is the exercise):

1. A BFF for a Next.js frontend, sharing the TS types for `TransferRequest` end to end.
2. The **fraud-scoring engine**: rules evaluation + heavy math on every transfer, p99 under 50 ms, 3,000 req/s.
3. A lambda that fires when a statement PDF lands in S3 and stamps it with a watermark.
4. The bank's payment platform: REST API + nightly settlement batch + scheduled statements, one team, ten-year horizon.
5. A WebSocket gateway fanning out payment notifications to 100k connected browsers — it transforms nothing, just routes messages.

**Solution**

1. **Node** — sharing the actual TS types across frontend and BFF removes a whole class of drift; the BFF is thin I/O, Node's home turf.
2. **.NET** — CPU in the request path at high RPS is the textbook case: real parallelism across cores (difference #2), `decimal` for the money math, no worker_threads choreography.
3. **Node** — cold-start-sensitive, tiny, I/O-bound: exactly where .NET's JIT startup tax hurts most (AOT is the .NET counter-argument, but Node is the path of least resistance).
4. **.NET** — API + background jobs + scheduling in one process and one DI container (differences #5 and #2 together); ten-year bank horizon is the ecosystem's home turf.
5. **Both defensible** — the strongest interview answer. Node: pure I/O fan-out, zero CPU per message, mature socket ecosystem. .NET: SignalR is built in and one process holds all 100k connections across every core. What you're being tested on is the *reasoning*, not the letter.

**Talking point:** "for standard CRUD, both are fine and the team decides; the architecture decides when CPU enters the request path, or when one process needs to be a whole platform." Partisanship reads junior; trade-offs read senior.

---

**The app ships — one thing left.** It's still wide open: anyone with curl can move anyone's money. **Topic 9** adds register-and-login for real — password verification, JWTs, and `[Authorize]` locking the money endpoints to their owners.
