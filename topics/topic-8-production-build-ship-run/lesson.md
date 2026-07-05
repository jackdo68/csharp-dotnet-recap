# Topic 8: Production — Build, Ship, Run

## The one question this topic answers

> **How does a .NET API get into a container and onto Kubernetes, how does it behave there compared to a Node service — and when would you honestly pick each?**

This topic hangs off two of the five big differences at once: **#5 batteries included** (health checks, config, graceful shutdown are platform features, not npm packages) and **#2 the thread pool** (one process uses every core — which changes how you scale). Topic 1's `dotnet publish` vocabulary and Topic 5's `LoanApp` are the raw material.

## From source to artifact

`npm run build` produces JS files that still need `node` and `node_modules` at runtime. `dotnet publish` has three output modes — a dial Node doesn't have:

| Mode | Command | What ships | Node analogue |
|---|---|---|---|
| **Framework-dependent** (default) | `dotnet publish -c Release` | your DLLs only; needs the runtime installed | `dist/` + "needs node installed" |
| **Self-contained** | `... --self-contained` | your DLLs **+ the whole runtime** (~70 MB) | `pkg`/single-executable builds, but first-class |
| **Native AOT** | `... -p:PublishAot=true` | one native binary, no JIT, no runtime | none — this is the thing Node can't do |

`-c Release` matters: without it you ship a `Debug` build (no optimizations, like shipping unminified dev output). AOT's trade-off: tiny image and near-zero cold start, but no runtime reflection — which Topic 3 told you EF Core and JSON serialization lean on (they need source-generator alternatives). Treat AOT as a tool for serverless and CLIs, not the default.

## The Dockerfile — same pattern, compiled twist

You already write multi-stage Dockerfiles for Node. The .NET one is structurally identical:

```dockerfile
# ---- build stage ----                        # Node equivalent:
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build # FROM node:22 AS build
WORKDIR /src
COPY LoanApp.csproj .                           # COPY package*.json .
RUN dotnet restore                              # RUN npm ci        ← same layer-cache trick!
COPY . .
RUN dotnet publish -c Release -o /app           # RUN npm run build

# ---- runtime stage ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0       # FROM node:22-slim
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "LoanApp.dll"]            # CMD ["node", "dist/main.js"]
```

Point by point:

- **`sdk` vs `aspnet` images** — the SDK image (compilers, ~800 MB) builds; the `aspnet` image (runtime only, ~220 MB) runs. Exactly your `node:22` vs `node:22-slim` split, but the runtime image can't even compile — a security feature, not just a size one.
- **The restore layer-cache trick carries over 1:1** — copy only the `.csproj` first, restore, then copy source. Dependency layers rebuild only when the `.csproj` changes, same as `package*.json`.
- **No `node_modules` problem** — packages restore into the build stage; the runtime stage gets compiled DLLs. There's nothing like "800 MB of node_modules in the image" to prune, and you still want a `.dockerignore` with `bin/` and `obj/` (your local build artifacts would confuse the container build).
- **Two gotchas, .NET 8+:** the `aspnet` image listens on **port 8080** (not 80) and runs as a **non-root `app` user** by default. `docker run -p 8080:8080` and you're fine; blindly mapping port 80 gets you a connection refused and a confused half hour.

## Kubernetes — the platform already speaks it

K8s doesn't know it's running .NET — same Deployment/Service YAML you'd write for Node. What differs is how much of the *checklist* the platform covers without a package:

| Production need | Node | ASP.NET Core |
|---|---|---|
| Liveness/readiness endpoints | `express-healthcheck` or hand-rolled | `builder.Services.AddHealthChecks(); app.MapHealthChecks("/healthz");` — built in |
| Graceful shutdown on SIGTERM | `process.on('SIGTERM')` + drain by hand | the host catches SIGTERM, stops accepting, drains in-flight requests — built in |
| Config from env vars | `dotenv` + `process.env` glue | config system binds env vars over `appsettings.json` automatically; `__` maps to `:` (`ConnectionStrings__Default` overrides `ConnectionStrings:Default`) |
| Container resource awareness | V8 heap flags by hand (`--max-old-space-size`) | runtime reads **cgroup limits**: thread pool and GC size themselves to the pod's CPU/memory limits, not the node's |

And the big operational difference, straight from Topic 7: **there is no pm2, no cluster mode, no "one replica per core."** A Node pod uses one core; getting sixteen cores means sixteen processes and something to shepherd them. One .NET process already saturates every core the pod grants. You still run multiple replicas — for rolling deploys and resilience — but replica count is a reliability decision, not a CPU-math decision.

## Performance, honestly

- **Throughput:** Kestrel (the built-in server — there's no nginx-in-front requirement) sits near the top of the TechEmpower benchmarks; several-fold typical Node throughput on identical hardware is the normal finding, and the gap *widens* when requests do CPU work, because that work spreads across cores in-process instead of blocking the event loop.
- **Cold start — Node wins.** JIT compilation means first-response takes visibly longer than `node dist/main.js`. Irrelevant for a long-running API; real for serverless. That's what AOT and ReadyToRun exist to fix.
- **Memory baseline is higher** — a hello-world API idles tens of MB above its Node equivalent. At pod-fleet scale that's a line item; per service it's noise.

The one-sentence version: .NET trades slower startup for much higher steady-state ceiling; Node trades the ceiling for instant start and one language everywhere.

## Production debugging — the `dotnet-*` trio

Local debugging you already have: F5 in VS Code, and breakpoints survive `await` across thread hops (set one after an `await` in `LoanApp` and check the thread ID — Topic 7 live in the debugger).

Against a *live* process — including inside a container — three CLI tools attach without restarting anything:

| Tool | What it does | Node analogue |
|---|---|---|
| `dotnet-counters monitor` | live metrics: requests/s, GC, thread pool queue length | `node --inspect` + watching chrome://inspect |
| `dotnet-trace collect` | CPU sampling → flame graphs | clinic.js / `--prof` |
| `dotnet-dump collect` | heap snapshot of a running process | `heapdump`, but no restart and no instrumentation baked in beforehand |

The thread-pool-queue-length counter is the one to remember: it's the metric that catches Topic 7's `.Result` starvation *before* the pager goes off.

## When Node, when .NET — the honest table

| Pick **Node** when | Pick **.NET** when |
|---|---|
| Serverless / cold-start sensitive | Long-running, high-throughput APIs |
| Sharing types and code with a TS frontend (BFF, SSR) | CPU work in the request path (PDF render, scoring, crypto) |
| Thin I/O pass-through gateway | Background jobs inside the same process — no separate worker fleet |
| Team is JS-native and the product is iterating fast | Runtime type enforcement at the boundary matters (money, compliance — Topic 3) |
| The npm long tail has your exact obscure library | You're reaching for pm2/cluster/worker_threads gymnastics anyway |

For standard CRUD both are fine and the *team* decides. The architecture decides when CPU enters the request path, or when one process needs to be a whole platform. Saying "both are fine for CRUD" out loud is itself a senior signal — it shows you're not a partisan.

## Interview talking points

- "The Dockerfile is the same multi-stage pattern as Node — SDK image builds, `aspnet` runtime image runs, and the `.csproj`-first copy gives the same layer caching as `package.json`-first."
- "No pm2, no cluster mode: one .NET process uses every core, so replica count is about resilience, not CPU math. The runtime is cgroup-aware — it sizes the thread pool and GC to the pod's limits."
- "Health checks, SIGTERM draining, and env-var config are platform features, not packages" — difference #5 wearing its production clothes.
- ".NET trades cold-start for steady-state throughput; that's why AOT exists and why I'd still reach for Node in a cold-start-sensitive lambda."
- Know the `dotnet-counters` / `dotnet-trace` / `dotnet-dump` names — mentioning thread-pool queue length as the starvation early-warning metric lands very well.
