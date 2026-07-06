# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A C#/.NET course site for an experienced **Node.js + TypeScript developer** (the repo owner). It deliberately does **not** cover all of C# — it covers the fundamental differences between C#/.NET and Node+TS, organized around "the five big differences" (see `topics/README.md`).

The whole course ties to **one** running example, the **PaymentApp** — this is not a broad C#/.NET crash course; it is an experienced Node/TS developer learning the *nuances* of C#/.NET, so every concept must land on a practical PaymentApp example (the concept, when to use it, and its real-world usage).

- **Topics 1–4**: language/runtime fundamentals via small console programs, all in the **payment domain** (`Money`, `User`, `Transfer`, `TransferRequest`) — every example foreshadows the exact types Topic 5's `PaymentApp` builds. No unrelated example domains.
- **Topics 5–10**: one continuous build of a **Payment API** (`PaymentApp`) — register, login, transfer, document upload; a **single `User` table** (balance on the user, no `Account`) in Postgres **from day one** (Topic 5 builds the service once, directly against EF/Postgres — there is deliberately no throwaway in-memory phase; Topic 6 unpacks EF and adds tests); a CPU-bound `/v1/document/upload` endpoint anchors Topic 7's threading (and persists the file); JWT auth (register+login return tokens) with the payer-is-caller ownership check in Topic 9; and in Topic 10 an external Node/Express **payment processor** (provided ready-made — the reader never writes it), reached through a `PaymentClient` `HttpClient` wrapper, that becomes the single writer of money via atomic conditional SQL. Final compose: db + processor + api. Each topic's Hands On starts exactly where the previous topic ended.

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

Also keep in sync when the 5–10 arc changes:

- The **build-line banner** (blockquote at the top of each `hands-on.md` for Topics 5–10: "**The PaymentApp build:** …") — one chain, bolded segment per page. Every page's banner must list all ten-arc segments with the current topic bolded.
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
- **`hands-on.md` — the full solution the topic covers.** The complete, copy-pasteable code for the topic's machinery lives here: whole files (`Models.cs`, `AuthController.cs`, `AuthService.cs`, `Program.cs` wiring) plus the drills that prove, break, and stress it (produce the race, read the exact compiler error, watch the 401 become a 403). Titled `# Topic N: Hands On`; Topics 5–10 open with the build-line banner blockquote. Numbered `Exercise N.M` sections: the task first, then a `**Solution**` block with full working code, expected output/errors, and the explanation + interview talking point it was secretly teaching. The reader builds the app *from Hands On*.

Code style in examples: money is always `decimal`, async methods end in `Async`, private fields `_camelCase`, comparisons presented as both bullets and a table when substantial.

### The Payment domain (Topics 5–10)

`PaymentApp` has **one DB model**: `User` (Id, Name, Email, Password [hashed], Balance [decimal], File [string — the filename of an uploaded `.txt`, stored on disk]). **There is no `Account` table** — balance lives on `User`; **there is no get-balance endpoint**. Users Alice/Bob/Cara with `*@bank.test` emails and password `Passw0rd!`; every new user starts with a **$1,000** balance.

Four endpoints across **three controllers**, backed by **three services** and **one client**:
- **`AuthController`** → `AuthService`: `POST /v1/auth/register` (hash password, save user, **return a JWT** — token issuance arrives in Topic 9; Topic 5's register just creates the user) and `POST /v1/auth/login` (return a JWT).
- **`PaymentController`** → `PaymentService`: `POST /v1/payment/transfer` (private; body `payerUserId`, `payeeUserId`, `amount`; from Topic 9 the payer is the authenticated caller).
- **`DocumentController`** → `DocumentService`: `POST /v1/document/upload` (private; accepts a `.txt` file, stores it on disk, saves the filename in `User.File`) — introduced in Topic 7 as the CPU-bound threading anchor.
- **`PaymentClient`** — a thin wrapper over `HttpClient` (via `IHttpClientFactory`) for the external Node/Express **processor** (port 4000), which owns `/v1/withdraw` + `/v1/deposit` and is the only writer of balances from Topic 10 on.

Postgres credentials `payapp`/`devpass`. The concurrency arc is load-bearing and staged: transfer is deliberately racy until Topic 7 (static `SemaphoreSlim` on `User.Balance`), which Topic 10 replaces with per-user ordered locks + the processor's atomic `UPDATE` — don't "fix" an earlier topic with a later topic's tool. The auth arc is staged too: Topic 5 register just creates the user (password hashed); Topic 9 adds login, JWT issuance (register+login both return tokens), `[Authorize]`, and the payer-is-caller ownership check on transfer/document. Don't introduce unrelated example domains.

### Accuracy notes

- Content is written against **.NET 10** (SDK 10.x): file-scoped namespaces, top-level statements, single-file `dotnet run app.cs` + `#:package` (new in .NET 10 — flagged as such in Topic 1).
- Exercise flows and error messages (exception types, `CSxxxx` codes like CS8618/CS0535/CS1996, Postgres `23505`) are load-bearing teaching content — verify before changing them.

**Markdown policy reminder:** only create or edit `.md` files when the user explicitly asks (per global instructions).
