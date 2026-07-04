# Guide — how this recap works

This is a C#/.NET recap for an experienced **Node.js + TypeScript** developer who needs to hold their own in .NET codebases and interviews within 2–3 days.

**The premise:** TypeScript and C# were designed by the same person (Anders Hejlsberg), so roughly 70% of the concepts are shared — types, generics, interfaces, `async/await`, arrow functions. You're not learning new ideas; you're learning new syntax, a different runtime, and a handful of genuinely different philosophies. This course skips what maps one-to-one and drills the **fundamental differences**.

## The five big differences

Everything in this course hangs off five differences. Burn these in — they're the organizing story, and each one is where a topic lives:

| # | Difference | It's about | Covered in |
|---|---|---|---|
| 1 | Types are **kept at runtime**, not erased | underlying operation | Topic 3 |
| 2 | A **thread pool**, not an event loop | underlying operation | Topic 7 |
| 3 | **Nominal** typing, not structural | language philosophy | Topic 2 |
| 4 | **Typed exceptions**, not sentinels | failure philosophy | Topic 4 |
| 5 | **Batteries included + DI**, not assemble-it-yourself | ecosystem philosophy | Topics 5–6 |

Topic 1 (platform & tooling) is the vocabulary you need before any of them.

## The practice loop

Each topic has three pages:

1. **Lesson** — the concepts, every one mapped back to what you know from Node/TS. Read it top to bottom.
2. **Exercises** — hands-on tasks. Topics 1–4 use small console programs; Topics 5–7 build and extend a real **Loan Application API** (the same app grows across the topics). Do them — the differences only stick when the compiler yells at you.
3. **Solutions** — full working code plus the interview talking point each exercise was secretly teaching.

Don't copy-paste the code. Type it. The muscle memory of `{ get; set; }`, `:` for inheritance, and attribute brackets is half the value.

## The 2–3 day plan

- **Day 1:** Topics 1–4 (tooling, language, runtime types, errors). All console apps, fast feedback.
- **Day 2:** Topics 5–6 (the Web API with DI, then EF Core + tests). This is the "real .NET developer" day.
- **Day 3 (or the evening of Day 2):** Topic 7 (threading — the biggest genuine difference), then re-read the five differences table above and say each one out loud with an example. That's your interview prep.

## Saying it in an interview

> "My deepest hands-on work is Node/TypeScript, but the concepts map cleanly — same designer as TypeScript, same async/await model, and LINQ mirrors the map/filter/reduce I use daily. The real differences I've drilled are the runtime — real threads, types that survive compilation — and the ecosystem philosophy: DI everywhere, batteries included. I ramp fast because I'm strong on the fundamentals underneath the language."
