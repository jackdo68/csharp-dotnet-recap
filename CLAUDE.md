# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A comprehensive C#/.NET learning guide for an experienced **Node.js + TypeScript developer** (the repo owner). The guide is detailed, easy to follow, and strips away jargon — breaking down complex concepts into small, digestible explanations. It uses TypeScript comparisons as mental anchors while going deep into .NET mechanics.

The whole course ties to **one** running example, the **PaymentApp** — built incrementally from Topic 1 through Topic 10. Every hands-on section contributes to the same application. There is no throwaway code: we build things once, correctly.

**Topics 1–10**: One continuous build of the **PaymentApp**, starting with project setup and ending with a production-ready containerized API:

| Topic | Focus | PaymentApp Adds |
|-------|-------|-----------------|
| 1 | Platform & Tooling | Solution structure (Clean Architecture: Domain, Application, Infrastructure, Api) |
| 2 | Language & Type System | Domain models (`User` entity, `Money` value object) |
| 3 | Runtime Types | Reflection utilities, base entity classes |
| 4 | Errors & Exceptions | Domain exceptions, Result pattern |
| 5 | Web API + DI + EF Core | Controllers, DI wiring, Postgres, migrations, register endpoint |
| 6 | EF Core Deep Dive | Change tracking internals, advanced queries, transactions |
| 7 | Concurrency & Threading | Transfer endpoint with proper locking from day one |
| 8 | .NET Standard Library | Document upload (File, Stream, JSON, HttpClient) |
| 9 | Authentication | Login, JWT, `[Authorize]`, ownership checks |
| 10 | Production | Docker, health checks, configuration |

**Topics 11–12**: Deep dives that stand alone:

| Topic | Focus | Hands-on |
|-------|-------|----------|
| 11 | Testing | Unit, integration, functional tests for PaymentApp |
| 12 | Advanced Patterns | **Concepts only** — CQRS, MediatR, domain events (diagrams + philosophy, no code) |

This is **docs only** — the repo contains no runnable application code, just the course markdown and the Astro site that renders it. It deploys to GitHub Pages via CI and is not run locally.

The published site: https://jackdo68.github.io/csharp-dotnet-recap/

## Architecture

```
topics/       ← SOURCE OF TRUTH: course markdown (concepts.md + hands-on.md per topic)
topics/README.md  ← becomes the site's "Guide" page
COMMANDS.md   ← becomes the site's "Commands" page (dotnet CLI cheat sheet)
README.md     ← becomes the site's "Setup" page
site/         ← Astro Starlight site that renders it all
```

- `site/scripts/sync-content.mjs` copies the markdown into `site/src/content/docs/` at build time, deriving the page title from the first `#` heading and adding sidebar order/labels (`concepts` → 1, labeled "Concepts"; `hands-on` → 2, labeled "Hands On").
- **Never edit `site/src/content/docs/topic-*` or the generated `guide.md`/`commands.md`/`setup.md`** — they're gitignored build artifacts; edit the files in `topics/` and the repo root instead. The only hand-maintained page in the content dir is `index.mdx` (the landing page).
- Deployment: push to `main` → `.github/workflows/deploy.yml` builds and deploys to GitHub Pages. The Astro config's `base` is `/csharp-dotnet-recap` — internal links in `index.mdx` must use `${import.meta.env.BASE_URL}`.

## Adding or renaming a topic

A topic is a folder `topics/topic-N-<slug>/` containing exactly `concepts.md` and `hands-on.md` (solutions live inline in Hands On). The sync script picks up `topic-*` folders automatically, but **two files reference topics by hand** and must be updated in the same change:

1. `site/astro.config.mjs` — the sidebar group (`label` + `autogenerate.directory`)
2. `site/src/content/docs/index.mdx` — the topic's `<LinkCard>`

Also keep in sync:

- The **build-line banner** (blockquote at the top of each `hands-on.md` for Topics 1–10: "**The PaymentApp build:** …") — one chain, bolded segment per page. Every page's banner must list all segments with the current topic bolded.
- Topic cross-references inside Concepts pages ("Topic 3", "Topic 7") are plain text — grep for the topic number when renumbering.

## Content conventions (the important part)

### This is a learning project — explain every step

Every exercise step and every solution carries a clear explanation of *why*, not just *what* — the reader should never execute a command or paste code they can't account for. Keep things simple **but practical**: prefer teaching through real production failure modes (a race condition that loses money, an env var silently beating a config file, `localhost` lying inside a container, a signing-key rotation logging everyone out) over toy abstractions. If a simplification is used (password grant, in-process locks, shared DB), say so explicitly and name the production-grade alternative.

### Teach the machine, not just the API — *why* Node does X vs *how* .NET does it

The reader wants the layer *below* the syntax. When there's a behavioral difference, explain the underlying runtime mechanism on both sides, not just the two APIs: Node's single thread + event loop + microtask queue vs the CLR's real thread pool; V8 desugaring async into state machines vs Roslyn doing the same; both using the same OS async I/O (epoll/kqueue/IOCP) but handing the continuation to *the* event-loop thread vs *any* pool thread. The best moments in the course correct an over-simplification the reader already believes ("I thought a `Task` was just a `Promise`") — so when an earlier topic gives a useful-but-lossy analogy (`Task` = `Promise`), a later topic must explicitly break it down (completed Tasks await synchronously, continuations hop threads, `async` is an elidable state-machine detail, `.Result` exists only because a second thread exists). Prefer mechanism ("the continuation resumes on a free pool thread") over folklore ("C# is multi-threaded"). Topic 7 is the anchor for this; the EF unit-of-work / staged-writes material in Topic 6 (`Add` = `git add`, `SaveChanges` = commit; id is 0 until flush) is the same instinct applied to the data layer.

### The audience rule — compare against strict TypeScript, not plain JavaScript

The reader is a strong TS developer. Never credit C# with catching something that **strict TS also catches at compile time** (typo'd properties, wrong argument types, unhandled null). The honest and correct framing: compile-time safety carries over ~1:1; the real differences are at **runtime**, where TS types are erased and trust-based while C# types are enforced. Comparisons to plain-JS *runtime semantics* (reference sharing, primitives copying) are fine — TS is JS at runtime.

### Every concept maps to something the reader knows

No C# construct is introduced cold. Each one gets its Node/TS anchor: `Task.FromResult` ≈ `Promise.resolve`, attributes ≈ NestJS decorators, `record` ≈ the missing object literal, EF Core ≈ Prisma, `[Theory]` ≈ `test.each`, `AddJwtBearer` ≈ `express-jwt`. When adding content, find the mapping first; if there is no equivalent (e.g. `out` params, `lock`, `SemaphoreSlim`, reified generics), say so explicitly — "no TS equivalent" is itself the teaching point.

### The five-big-differences spine

Every topic hangs off one of the five differences tabled in `topics/README.md` (runtime types, thread pool, nominal typing, typed exceptions, batteries+DI). New content should state which difference it belongs to and cross-reference related topics ("Topic 3's runtime types make Topic 5's DI possible").

### Page structure — and the role split (load-bearing)

The two pages have **different jobs**, and content must respect the split:

- **`concepts.md` — theory, explanation, and the Node/TS comparison.** This is where a concept is *explained*: what it is, the mechanism below the syntax, when to use it, and how it compares to Node/TypeScript. It **may** carry code — but only **essential/illustrative snippets** that make the point (a `Models.cs` shape, the signature of `AuthController`, the one line that matters), not the whole app built line-by-line. Starts with `# Topic N: <name>`, then "The one question this topic answers" as a blockquote, then the concepts (comparison tables, short annotated snippets), ends with **Interview talking points**. Every concept ties to the PaymentApp.
- **`hands-on.md` — the full solution the topic covers.** The complete, copy-pasteable code for the topic's machinery lives here: whole files (`Models.cs`, `AuthController.cs`, `AuthService.cs`, `Program.cs` wiring) plus the drills that prove, break, and stress it. Titled `# Topic N: Hands On`; Topics 1–10 open with the build-line banner blockquote. Numbered `Exercise N.M` sections: the task first, then a `**Solution**` block with full working code, expected output/errors, and the explanation + interview talking point it was secretly teaching. The reader builds the app *from Hands On*.
- **Topics without hands-on (e.g., Topic 12):** Some topics are concepts-only — they explain advanced patterns with diagrams and philosophy but don't modify PaymentApp. These topics have `concepts.md` only, no `hands-on.md`.

Code style in examples: money is always `decimal`, async methods end in `Async`, private fields `_camelCase`, comparisons presented as both bullets and a table when substantial.

### The PaymentApp (Topics 1–10)

**Project structure** (Clean Architecture from Topic 1):
```
PaymentApp/
├── PaymentApp.Domain/           # Entities, value objects, domain exceptions
├── PaymentApp.Application/      # Use cases, interfaces, DTOs
├── PaymentApp.Infrastructure/   # EF Core DbContext, external services
└── PaymentApp.Api/              # Controllers, DI wiring, Program.cs
```

**One DB model**: `User` (Id, Name, Email, PasswordHash, Balance [decimal], DocumentPath [string]). **No `Account` table** — balance lives on `User`. Users Alice/Bob/Cara with `*@bank.test` emails and password `Passw0rd!`; every new user starts with **$1,000** balance.

**Four endpoints** across **three controllers**:
- **`AuthController`** → `IAuthService`: `POST /v1/auth/register` (Topic 5) and `POST /v1/auth/login` (Topic 9, returns JWT).
- **`PaymentController`** → `IPaymentService`: `POST /v1/payment/transfer` (Topic 7, with proper locking from day one).
- **`DocumentController`** → `IDocumentService`: `POST /v1/document/upload` (Topic 8, demonstrates File/Stream APIs).

**Build-once philosophy**: We don't introduce broken code to fix later. Transfer is built with proper concurrency handling in Topic 7. Auth is wired correctly in Topic 9. Each topic adds new functionality without rewriting previous work.

Postgres credentials `payapp`/`devpass`. Don't introduce unrelated example domains.

### Reference repositories

Two production-grade repos inform the advanced patterns discussed in Topic 12:

- **eShop** (`/Users/jackdo/source-code/eShop`) — Microsoft's reference microservices app. Demonstrates MediatR pipeline, domain events, outbox pattern, Minimal APIs.
- **CleanArchitectureTemplate** (`/Users/jackdo/source-code/CleanArchitectureTemplate`) — Jason Taylor's Clean Architecture template. Demonstrates CQRS, FluentValidation, pipeline behaviors, domain events.

These repos are **reference only** — PaymentApp intentionally stays simpler. Topic 12 explains these patterns conceptually with diagrams, pointing to these repos for real-world examples.

### Accuracy notes

- Content is written against **.NET 10** (SDK 10.x): file-scoped namespaces, top-level statements, single-file `dotnet run app.cs` + `#:package` (new in .NET 10 — flagged as such in Topic 1).
- Exercise flows and error messages (exception types, `CSxxxx` codes like CS8618/CS0535/CS1996, Postgres `23505`) are load-bearing teaching content — verify before changing them.

**Markdown policy reminder:** only create or edit `.md` files when the user explicitly asks (per global instructions).
