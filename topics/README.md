# Guide — how this course works

A comprehensive C#/.NET guide for an experienced **Node.js + TypeScript** developer. This isn't a quick recap — it's a detailed, easy-to-follow journey through .NET, breaking down complex concepts into digestible pieces while using TypeScript as your mental anchor.

**The premise:**
- TypeScript and C# were designed by the same person (Anders Hejlsberg)
- ~70% of concepts are shared: types, generics, interfaces, `async/await`, arrow functions
- You're not learning new ideas — just new syntax, a different runtime, and a few different philosophies
- This course goes deep on the **fundamental differences** that matter in production

## The misunderstanding to clear first

Most JS/TS developers picture C# as 2005-era Java: verbose, ceremony-heavy, `public static void Main`, XML config. That image is two decades stale.

**The truth:** Much of what you love about modern TS was in C# first.

| Feature | C# | JS/TS |
|---------|-----|-------|
| `var` type inference | 2007 (C# 3.0) | ES6 2015 |
| Lambda arrow functions | 2007 (C# 3.0) | ES6 2015 |
| `async/await` | 2012 (C# 5) — **invented here** | ES2017 |
| `filter`/`map`/`reduce` | LINQ 2007 | `.filter`/`.map`/`.reduce` later |

When TS added strict null checking, records-style immutability, and discriminated narrowing — the languages were **converging**, not diverging. Same person steering both.

**The mental model:** Not "learning a foreign language." It's the second step of a climb you started when you moved from JS to TS. Charles Chen's article [*Building up from JavaScript to TypeScript to C# 10 and .NET*](https://blog.devgenius.io/building-up-from-javascript-to-typescript-to-c-10-and-net-6-669a70cd0a66) frames it as Duplo → Lego → Technic: same building system, increasing precision.

If you've felt the pain that motivated JS → TS (runtime surprises, `this` binding, single-threaded ceiling), Topics 3, 4, and 7 are where C# keeps climbing past where TS stops.

## The five big differences

Everything in this course hangs off five differences. Burn these in — they're the organizing story:

| # | Difference | It's about | Covered in |
|---|---|---|---|
| 1 | Types are **kept at runtime**, not erased | underlying operation | Topic 3 |
| 2 | A **thread pool**, not an event loop | underlying operation | Topic 7 |
| 3 | **Nominal** typing, not structural | language philosophy | Topic 2 |
| 4 | **Typed exceptions**, not sentinels | failure philosophy | Topic 4 |
| 5 | **Batteries included + DI**, not assemble-it-yourself | ecosystem philosophy | Topics 5–6, 8–10 |

## The PaymentApp — one continuous build

Everything ties to **one running example**: the **PaymentApp**. You start building it in Topic 1 and finish with a production-ready containerized API in Topic 10. Don't skip ahead — each topic starts where the previous ended.

| Topic | Focus | What You Build |
|-------|-------|----------------|
| **1** | Platform & Tooling | Solution structure (4 projects: Domain, Application, Infrastructure, Api) |
| **2** | Language & Type System | Domain models: `User` entity, `Money` value object |
| **3** | Runtime Types | Base entity classes, reflection utilities |
| **4** | Errors & Exceptions | Domain exceptions, Result pattern |
| **5** | Web API + DI + EF Core | Controllers, DI wiring, Postgres, migrations, register endpoint |
| **6** | EF Core Deep Dive | Change tracking internals, advanced queries, transactions |
| **7** | Concurrency & Threading | Transfer endpoint with proper locking |
| **8** | .NET Standard Library | Document upload (File, Stream, JSON, HttpClient) |
| **9** | Authentication | Login, JWT, `[Authorize]`, ownership checks |
| **10** | Production | Docker, health checks, configuration |
| **11** | Testing | Unit, integration, functional tests |
| **12** | Advanced Patterns | *Concepts only* — CQRS, MediatR, domain events |

**Project structure** (Clean Architecture from Topic 1):
```
PaymentApp/
├── PaymentApp.Domain/           # Entities, value objects, domain exceptions
├── PaymentApp.Application/      # Use cases, interfaces, DTOs
├── PaymentApp.Infrastructure/   # EF Core DbContext, external services
└── PaymentApp.Api/              # Controllers, DI wiring, Program.cs
```

**The User table:** Id, Name, Email, PasswordHash, Balance (`decimal`), DocumentPath.

**Four endpoints:**
- `POST /v1/auth/register` — create user (Topic 5)
- `POST /v1/auth/login` — return JWT (Topic 9)
- `POST /v1/payment/transfer` — move money between users (Topic 7)
- `POST /v1/document/upload` — upload a document file (Topic 8)

**Requirements:**
- **.NET 10 SDK** — install from [dotnet.microsoft.com](https://dotnet.microsoft.com/download)
- **Docker Desktop** (or any docker daemon) from Topic 5 onward
- **Don't copy-paste** — type the code. Muscle memory of `{ get; set; }` and `:` for inheritance is half the value.

## Page structure

Each topic has two pages:

| Page | Purpose |
|------|---------|
| **Concepts** | Theory, explanation, Node/TS comparison. Essential code snippets only. |
| **Hands On** | Full working code. Build the app step by step. Solutions with explanations. |

**Exception:** Topic 12 (Advanced Patterns) is concepts-only — diagrams and philosophy, no code changes to PaymentApp.

## Saying it in an interview

> "I'm a Node/TypeScript developer who's gone deep on .NET. The concepts map cleanly — same designer, same async/await model, LINQ mirrors map/filter/reduce. The real differences I've internalized are the runtime — real threads, types that survive compilation — and the ecosystem philosophy: DI everywhere, batteries included. I've built a full Clean Architecture API from scratch, so I understand both the patterns and the practical trade-offs."
