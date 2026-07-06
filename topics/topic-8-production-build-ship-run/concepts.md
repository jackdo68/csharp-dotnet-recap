# Topic 8: Production — Build, Ship, Run

> **How does a .NET API get into a container — and how does it behave compared to Node?**

## Build modes

| Mode | Command | What ships | Node equivalent |
|------|---------|------------|-----------------|
| Framework-dependent | `dotnet publish -c Release` | DLLs only (needs runtime) | `dist/` + `node` |
| Self-contained | `--self-contained` | DLLs + runtime (~70 MB) | `pkg` builds |
| Native AOT | `-p:PublishAot=true` | One native binary | — (Node can't do this) |

**Notes:**
- Always use `-c Release` (otherwise you ship debug build)
- AOT = tiny image, fast cold start, but no reflection (EF Core needs source generators)

## Dockerfile

Same multi-stage pattern as Node:

```dockerfile
# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build    # ≈ node:22
WORKDIR /src
COPY PaymentApp.csproj .                           # ≈ package*.json
RUN dotnet restore                                 # ≈ npm ci (layer cache!)
COPY . .
RUN dotnet publish -c Release -o /app              # ≈ npm run build

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0          # ≈ node:22-slim
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "PaymentApp.dll"]
```

**Key differences from Node:**

| Aspect | Node | .NET |
|--------|------|------|
| Build image | `node:22` (~900 MB) | `sdk:10.0` (~800 MB) |
| Runtime image | `node:22-slim` (~200 MB) | `aspnet:10.0` (~220 MB) |
| Layer cache trick | `package*.json` first | `.csproj` first |
| Runtime artifacts | `node_modules` (huge) | Compiled DLLs (small) |

**Gotchas (.NET 8+):**
- Default port is **8080** (not 80)
- Runs as **non-root user** by default

## Kubernetes / Production features

Same Deployment/Service YAML as Node. The difference is what's built in:

| Need | Node | ASP.NET Core |
|------|------|--------------|
| Health endpoints | `express-healthcheck` | `AddHealthChecks()` + `MapHealthChecks("/healthz")` |
| Graceful shutdown | `process.on('SIGTERM')` + manual drain | Built in — stops accepting, drains in-flight |
| Config from env vars | `dotenv` + `process.env` | Automatic — `__` maps to `:` in config |
| Resource awareness | Manual V8 flags | Reads cgroup limits automatically |

**The big difference:** No pm2, no cluster mode.
- Node: 1 process = 1 core. 16 cores = 16 processes.
- .NET: 1 process uses all cores. Replicas are for resilience, not CPU math.

## Performance

| Aspect | Node | .NET |
|--------|------|------|
| Throughput | Good | Higher (several-fold on CPU work) |
| Cold start | Fast | Slower (JIT) — AOT fixes this |
| Memory baseline | Lower | Higher (~tens of MB more) |

**One-liner:** .NET trades slower startup for higher steady-state ceiling.

## Production debugging

| Tool | What it does | Node equivalent |
|------|--------------|-----------------|
| `dotnet-counters monitor` | Live metrics (requests/s, GC, thread pool) | `node --inspect` |
| `dotnet-trace collect` | CPU sampling → flame graphs | clinic.js |
| `dotnet-dump collect` | Heap snapshot (no restart) | `heapdump` |

**Key metric:** Thread-pool queue length — catches `.Result` starvation before the pager fires.

## When to use each

| Pick Node | Pick .NET |
|-----------|-----------|
| Serverless / cold-start sensitive | Long-running, high-throughput APIs |
| Sharing types with TS frontend (BFF, SSR) | CPU work in request path (PDF, crypto) |
| Thin I/O gateway | Background jobs in same process |
| Team is JS-native, iterating fast | Runtime type enforcement matters (money) |
| npm has your exact library | Already reaching for pm2/cluster/workers |

**For standard CRUD:** Both are fine — team decides. Saying this shows you're not a partisan.

## Interview talking points

- **Dockerfile:** Same multi-stage pattern. `.csproj`-first = `package.json`-first layer caching.
- **Scaling:** No pm2/cluster. One process uses all cores. Replicas are for resilience.
- **Batteries included:** Health checks, SIGTERM draining, env-var config are built in.
- **Trade-off:** .NET = slower cold start, higher steady-state. Node = instant start, lower ceiling.
- **Debugging:** `dotnet-counters`, `dotnet-trace`, `dotnet-dump`. Thread-pool queue length = starvation warning.
