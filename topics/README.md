# Guide — how this recap works

This is a C#/.NET recap for an experienced **Node.js + TypeScript** developer who needs to hold their own in .NET codebases and interviews within 2–3 days.

**The premise:** TypeScript and C# were designed by the same person (Anders Hejlsberg), so roughly 70% of the concepts are shared — types, generics, interfaces, `async/await`, arrow functions. You're not learning new ideas; you're learning new syntax, a different runtime, and a handful of genuinely different philosophies. This course skips what maps one-to-one and drills the **fundamental differences**.

## The misunderstanding to clear first

Most JS/TS developers carry a mental image of C# frozen around 2005: a verbose, ceremony-heavy Java clone for enterprise shops — `public static void Main`, XML config, IDEs the size of operating systems. That image is roughly two decades stale, and correcting it is half the ramp-up.

The uncomfortable historical truth runs the other way: **much of what you love about modern TS was in C# first.** `var` type inference and lambda arrow functions landed in C# 3.0 in 2007 — lambdas beat ES6's arrows by eight years. `async/await` didn't just arrive early in C#; it was *invented* there (C# 5, 2012), and JavaScript later adopted it wholesale. LINQ gave C# `filter`/`map`/`reduce` before JS had `.filter`/`.map`/`.reduce`. When TS added strict null checking, records-style immutability patterns, and discriminated narrowing, the two languages weren't diverging — they were converging, with the same person steering both.

So the honest mental model isn't "learning a foreign language." Charles Chen's article [*Building up from JavaScript to TypeScript to C# 10 and .NET*](https://blog.devgenius.io/building-up-from-javascript-to-typescript-to-c-10-and-net-6-669a70cd0a66) — a strong companion read for this course — frames it as a toy-brick progression: JS, TS, and C# are the same building system at increasing levels of precision, Duplo to Lego to Technic in his analogy. Each step up gives you smaller, more exact pieces and a higher ceiling; none of them throws away what your hands already know. Moving from TS to C# is the second step of a climb you already started when you moved from JS to TS — and if you've felt the pain that motivated *that* move (runtime surprises TS can't catch, `this` binding, an event loop that caps you at one core), Topics 3, 4, and 7 are precisely where C# keeps climbing past where TS has to stop.

Even Node's creator reached this conclusion: Ryan Dahl has spoken openly about Node's design regrets (it's why he built Deno). None of this makes Node bad — it makes "JS everywhere by default" a habit worth re-examining, which is presumably why you're here.

## The five big differences

Everything in this course hangs off five differences. Burn these in — they're the organizing story, and each one is where a topic lives:

| # | Difference | It's about | Covered in |
|---|---|---|---|
| 1 | Types are **kept at runtime**, not erased | underlying operation | Topic 3 |
| 2 | A **thread pool**, not an event loop | underlying operation | Topic 7 |
| 3 | **Nominal** typing, not structural | language philosophy | Topic 2 |
| 4 | **Typed exceptions**, not sentinels | failure philosophy | Topic 4 |
| 5 | **Batteries included + DI**, not assemble-it-yourself | ecosystem philosophy | Topics 5–6, 8–10 |

Topic 1 (platform & tooling) is the vocabulary you need before any of them. Topic 8 (production) is where differences #2 and #5 prove out in Docker — and where you earn the "when Node, when .NET" answer. Topics 9–10 are #5's final laps: auth, middleware, validation, outbound HTTP, and background work as platform features.

## The practice loop

Each topic has two pages, with **different jobs** — know which one you're on:

1. **Concepts — this is where the real code lives.** The concepts (every one mapped back to what you know from Node/TS) *and the build itself*: each new file of the app is introduced here, explained line by line. Don't just read it — **type the code in as you go**; by the end of a Concepts page the app has visibly grown. Every concept lands on a practical example: what it is, *when* to reach for it, and its real-world usage in the app.
2. **Hands On — do it on the PaymentApp.** Drills that prove, break, and stress what Concepts just built: produce the race condition, read the exact compiler error, watch the 401 become a 403. Occasionally one adds a small feature (a deposit endpoint) — but the topic's core machinery is always built in Concepts. Each task is followed by its full solution plus the interview talking point it was secretly teaching. Attempt each one before reading its solution; the differences only stick when the compiler yells at you.

This isn't a broad C#/.NET crash course — it's an experienced Node/TS developer learning the *nuances*, so **everything ties to one running example: the PaymentApp.** Topics 1–4 are small console programs in the payment domain (`Money`, `User`, `Transfer`, `TransferRequest`) — every example foreshadows the exact types Topic 5 builds. Topics 5–10 are one continuous build of the **Payment API** — a single `User` table (name, email, hashed password, `decimal` balance, uploaded-document filename) in Postgres, with four endpoints (`/v1/auth/register`, `/v1/auth/login`, `/v1/payment/transfer`, `/v1/document/upload`): **Topic 5** births it straight onto Postgres (via docker-compose) — written once, no throwaway in-memory phase → **Topic 6** unpacks what Topic 5 wired cookbook-style (DbContext, change tracking, migrations) and adds tests → **Topic 7** adds a CPU-bound document upload, then races the transfer endpoint, loses money, and fixes it → **Topic 8** containerizes and ships it (api + db in compose) → **Topic 9** adds register/login/JWT (both return tokens) and locks the money and document endpoints to their owners → **Topic 10** rebuilds the plumbing production-style: middleware, declarative validation, and an external Node **payment processor** (provided ready-made) that the API calls over HTTP via a `PaymentClient` — concurrent two-leg transfers, per-user locks, a deadlock produced on purpose, and a background auditor. Each topic starts exactly where the previous one left off — don't skip ahead.

You'll need **Docker Desktop** (or any docker daemon) from Topic 6 onward — Postgres and eventually the app itself run in containers; nothing database-shaped gets installed on your machine.

Don't copy-paste the code. Type it. The muscle memory of `{ get; set; }`, `:` for inheritance, and attribute brackets is half the value.

## The 2–3 day plan

- **Day 1:** Topics 1–4 (tooling, language, runtime types, errors). All console apps, fast feedback.
- **Day 2:** Topics 5–6 (the Web API with DI, built straight onto Postgres; then EF Core unpacked + tests). This is the "real .NET developer" day.
- **Day 3 (or the evening of Day 2):** Topic 7 (threading — the biggest genuine difference), then Topic 8 (ship it: publish, Docker, Kubernetes, and the when-Node-when-.NET answer).
- **Day 4 (optional but worth it):** Topic 9 — auth: password hashing, `/v1/auth/login` issuing JWTs, `[Authorize]`, and the payer-must-be-you ownership check. Then Topic 10 — the pipeline: middleware, validation attributes, `IHttpClientFactory` calling the Node payment processor, the deliberate deadlock, and the background auditor. Finish by re-reading the five differences table above and saying each one out loud with an example. That's your interview prep.

## Saying it in an interview

> "My deepest hands-on work is Node/TypeScript, but the concepts map cleanly — same designer as TypeScript, same async/await model, and LINQ mirrors the map/filter/reduce I use daily. The real differences I've drilled are the runtime — real threads, types that survive compilation — and the ecosystem philosophy: DI everywhere, batteries included. I ramp fast because I'm strong on the fundamentals underneath the language."
