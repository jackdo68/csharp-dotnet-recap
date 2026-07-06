# Guide — how this recap works

A C#/.NET recap for an experienced **Node.js + TypeScript** developer. Goal: hold your own in .NET codebases and interviews within 2–3 days.

**The premise:**
- TypeScript and C# were designed by the same person (Anders Hejlsberg)
- ~70% of concepts are shared: types, generics, interfaces, `async/await`, arrow functions
- You're not learning new ideas — just new syntax, a different runtime, and a few different philosophies
- This course skips what maps 1:1 and drills the **fundamental differences**

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

Everything in this course hangs off five differences. Burn these in — they're the organizing story, and each one is where a topic lives:

| # | Difference | It's about | Covered in |
|---|---|---|---|
| 1 | Types are **kept at runtime**, not erased | underlying operation | Topic 3 |
| 2 | A **thread pool**, not an event loop | underlying operation | Topic 7 |
| 3 | **Nominal** typing, not structural | language philosophy | Topic 2 |
| 4 | **Typed exceptions**, not sentinels | failure philosophy | Topic 4 |
| 5 | **Batteries included + DI**, not assemble-it-yourself | ecosystem philosophy | Topics 5–6, 8–10 |

**Topic map:**
- **Topic 1** = vocabulary before all of them
- **Topic 8** = where #2 and #5 prove out in Docker (the "when Node, when .NET" answer)
- **Topics 9–10** = #5's final laps: auth, middleware, validation, outbound HTTP, background work

## The practice loop

Each topic has two pages with **different jobs**:

| Page | Purpose |
|------|---------|
| **Concepts** | Theory + the build itself. Code introduced line by line. **Type the code as you go.** |
| **Hands On** | Drills that prove, break, and stress what Concepts built. Solution + interview point after each. |

**Concepts** = what the concept is, when to use it, and real usage in the app.
**Hands On** = produce the race, read the compiler error, watch 401 become 403. Try before reading solution.

### The PaymentApp

Everything ties to **one running example**. Don't skip ahead — each topic starts where the previous ended.

**Topics 1–4:** Console programs in the payment domain (`Money`, `User`, `Transfer`) — foreshadowing Topic 5's types.

**Topics 5–10:** One continuous build of the **Payment API**:

| Topic | Adds |
|-------|------|
| 5 | API straight onto Postgres (docker-compose). One `User` table. |
| 6 | Unpacks EF Core (DbContext, migrations) + adds tests |
| 7 | CPU-bound document upload. Races the transfer, loses money, fixes it |
| 8 | Containerizes and ships (api + db in compose) |
| 9 | Login, JWT, `[Authorize]`, ownership checks |
| 10 | Middleware, validation, `PaymentClient` calling Node processor, background auditor |

**The User table:** name, email, hashed password, `decimal` balance, uploaded-document filename.

**Four endpoints:** `/v1/auth/register`, `/v1/auth/login`, `/v1/payment/transfer`, `/v1/document/upload`

**Requirements:**
- **Docker Desktop** (or any docker daemon) from Topic 6 onward
- **Don't copy-paste** — type the code. Muscle memory of `{ get; set; }` and `:` for inheritance is half the value.

## The 2–3 day plan

| Day | Topics | Focus |
|-----|--------|-------|
| 1 | 1–4 | Tooling, language, runtime types, errors. All console apps. |
| 2 | 5–6 | Web API with DI on Postgres. EF Core unpacked + tests. **"Real .NET developer" day.** |
| 3 | 7–8 | Threading (biggest difference). Ship it: Docker, compose, when-Node-when-.NET. |
| 4 (optional) | 9–10 | Auth (JWT, `[Authorize]`, ownership). Pipeline (middleware, validation, `PaymentClient`). |

**Finish:** Re-read the five differences table. Say each one out loud with an example. That's your interview prep.

## Saying it in an interview

> "My deepest hands-on work is Node/TypeScript, but the concepts map cleanly — same designer, same async/await model, LINQ mirrors map/filter/reduce. The real differences I've drilled are the runtime — real threads, types that survive compilation — and the ecosystem philosophy: DI everywhere, batteries included. I ramp fast because I'm strong on the fundamentals underneath the language."
