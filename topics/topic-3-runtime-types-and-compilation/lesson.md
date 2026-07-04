# Topic 3: Runtime Types & Compilation — kept, not erased

## The one question this topic answers

> **What actually happens between my source file and it running — and why does it matter that C# types survive the trip?**

This is the deepest difference between the two stacks, and two other differences (nominal typing's runtime enforcement, and the error philosophy in Topic 4) are downstream of it.

## The two pipelines

```
TypeScript:  .ts ──tsc (types ERASED)──▶ .js ──V8 parses + JITs──▶ machine code
C#:          .cs ──Roslyn (types KEPT)──▶ IL bytecode in a .dll ──CLR JITs──▶ machine code
```

- **TS:** `tsc` type-checks, then *erases*: V8 only ever sees plain JS, and your types don't exist while the program runs. Every runtime behaviour is JS behaviour.
- **C#:** the compiler (Roslyn) emits **IL** (intermediate-language bytecode) into a `.dll`, *with all type information intact*. The CLR JIT-compiles IL to machine code as it runs. `dotnet run` = compile + execute in one command.
- There's no "looser language underneath" that C# erases into — a compile error means there is no program. No `@ts-ignore`-and-run-anyway.

## What runtime types buy you

**1. Reflection — running code can inspect types.**

```csharp
var t = typeof(LoanApplication);
foreach (var p in t.GetProperties())
    Console.WriteLine($"{p.Name}: {p.PropertyType.Name}");
// ApplicantName: String
// Amount: Decimal
// Status: String
```

Try that in TS: `Object.keys(new LoanApplication())` gives you keys only if the instance has assigned values, and *never* gives you the declared types — they're gone. This isn't a party trick; it's the mechanism the whole platform runs on:

- **EF Core** (Topic 6) reads your model classes at runtime to build tables and SQL — no schema file, no codegen step.
- **The DI container** (Topic 5) reads constructor signatures at runtime to decide what to inject — no `emitDecoratorMetadata` tricks like NestJS needs.
- **The JSON deserializer** (Topic 4) checks incoming data against your record's real types — a built-in Zod.

**2. Real generics — `T` exists at runtime.**

```csharp
void Describe<T>() => Console.WriteLine($"T is {typeof(T).Name}");
Describe<LoanApplication>();   // "T is LoanApplication"
```

In TS, `typeof T` inside a generic function is meaningless — the type parameter never reaches the runtime. In C#, `Set<LoanApplication>()` in EF Core uses its type argument at runtime to find the right table.

**3. Runtime type checks that are actually checks.**

```csharp
object thing = GetSomething();
if (thing is LoanApplication loan)      // real runtime test + narrowing in one
    Console.WriteLine(loan.Amount);
```

`is` performs a genuine runtime type test (TS's `instanceof` works only for classes; `is`-style predicates for shapes are hand-written and unverified). The pattern `thing is LoanApplication loan` tests *and* declares a narrowed variable — TS narrowing, but backed by the runtime.

## What's in the .dll

`dotnet build` produces `bin/Debug/net10.0/YourApp.dll` — IL bytecode plus metadata describing every type, member, and signature. That metadata is why decompilers can reconstruct near-perfect C# from a shipped `.dll` (and why obfuscators exist), and it's what reflection reads. The `.dll` is portable: the same file runs on macOS, Linux, and Windows, because the CLR on each platform does the final JIT to native code — same story as JS being portable across V8 installs, one level down.

## The cost side (be honest in interviews)

- **Startup:** compile-then-JIT means slower cold starts than `node`; .NET counters this with caching and, where needed, AOT (ahead-of-time) compilation.
- **Flexibility:** you can't monkey-patch types at runtime or duck-type your way past the type system the way JS metaprogramming can. `dynamic` exists as an escape hatch; using it is a code smell.

## Interview talking points

- "TS types are erased at compile time; C# types are preserved in IL and enforced by the CLR" — the one-sentence version.
- Reflection is why EF Core, DI, and JSON serialization need no codegen or schema files.
- C# generics are *reified* (real at runtime); TS/Java generics are *erased*. Using the word "reified" correctly is a senior signal.
- The `.dll` is portable IL, JIT-compiled per platform by the CLR — "like the JVM story, and like V8 one level down."
