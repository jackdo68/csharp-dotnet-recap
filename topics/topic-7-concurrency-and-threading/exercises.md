# Topic 7: Exercises & Solutions

> **The PaymentApp build:** Topic 5 in-memory API → Topic 6 Postgres + tests → **Topic 7 (you are here): produce the transfer race in a console lab, then in the real API — and fix it** → Topic 8 Docker & ship → Topic 9 register, login, lock down → Topic 10 the pipeline & the payment processor.

Type in the lesson's `PayThreading` program first and run it a few times — you need to *see* the buggy numbers wobble before the exercises mean anything. 7.1–7.4 stay in the console lab; 7.5 returns to `PaymentApp` for the main event. Try each exercise before reading its solution.

## Exercise 7.1 — Quantify the race

Wrap section 3 (the buggy flagged count) in a `for` loop that runs it 10 times, printing each result. On your machine: how many of the 10 runs were wrong, and did the wrongness vary? Explain, in two sentences, *mechanically* what happens when two threads execute `buggyFlagged++` at the same moment.

**Solution**

```csharp
for (int run = 1; run <= 10; run++)
{
    int buggyFlagged = 0;
    Parallel.ForEach(paymentIds, id =>
    {
        var score = FraudScore(id);
        if (score > 50) buggyFlagged++;
    });
    Console.WriteLine($"Run {run}: {buggyFlagged}");
}
```

Typical output: mostly the correct value with occasional smaller numbers — different ones on different runs. (With only 20 items you may need more, e.g. `Range(1, 500)`, to see it reliably.)

**The mechanics:** `buggyFlagged++` is three operations — *read* the value into a register, *add* one, *write* it back. When threads A and B both read `5`, both compute `6`, and both write `6`, one increment is lost forever. It's the same lost-update anomaly two uncoordinated `UPDATE ... SET n = n + 1`-without-locking transactions would produce — which is why databases give you atomic increments and row locks, and why C# gives you `Interlocked` and `lock`.

## Exercise 7.2 — Thread-safe money

Extend section 5: alongside the flagged **count** (use `Interlocked.Increment`), accumulate the **total flagged amount** as a `decimal` (`amount = score * 10m`, say).

1. First try `Interlocked.Add(ref total, amount)` where `total` is `decimal`. Read the compiler error out loud.
2. Fix it with `lock`, run it 5 times, and confirm the total is identical every run.

**Solution**

1. There is no overload — the compiler refuses with **CS1503** (cannot convert `ref decimal` to `ref int`/`ref long`). `Interlocked` operates on types the CPU can swap in one instruction; a 128-bit `decimal` isn't one. **Money can't be lone-instruction atomic — it needs a critical section.** This dead end is the exercise.

2.

```csharp
int flagged = 0;
decimal totalFlagged = 0m;
var gate = new object();
Parallel.ForEach(paymentIds, id =>
{
    var score = FraudScore(id);
    if (score > 50)
    {
        Interlocked.Increment(ref flagged);   // int: atomic op is enough
        lock (gate)
        {
            totalFlagged += score * 10m;      // decimal: critical section required
        }
    }
});
Console.WriteLine($"Flagged: {flagged}, total: {totalFlagged}");
```

Same numbers, every run. Note the division of labor: the *cheapest sufficient tool* for each variable — atomic op for the counter, lock for the money. If count-and-total ever had to update as one indivisible unit, both would go inside the lock.

## Exercise 7.3 — Watch await hop threads

1. Sprinkle `Console.WriteLine($"... on thread {Environment.CurrentManagedThreadId}")` before and after the `await Task.Delay(200)` inside `FetchFxRateAsync`, and run the `Task.WhenAll` section. Do the before/after thread IDs match? How many distinct thread IDs served your 20 "requests"?
2. In one sentence: why is this observation impossible to make in Node — and what does it have to do with the lesson's CS1996 (`await` inside `lock`) compile error?

**Solution**

```csharp
async Task<decimal> FetchFxRateAsync(int paymentId)
{
    Console.WriteLine($"payment {paymentId} BEFORE await on thread {Environment.CurrentManagedThreadId}");
    await Task.Delay(200);
    Console.WriteLine($"payment {paymentId} AFTER  await on thread {Environment.CurrentManagedThreadId}");
    return 1.0m + (paymentId % 10) / 100m;
}
```

Typical result: all 20 "before" lines on one thread (the starts are synchronous until the first await), and the "after" lines scattered across **several different thread IDs** — the continuations resume on whatever pool thread is free.

**Why Node can't show this:** there is only one thread; every `await` continuation resumes on it via the event loop. And this hop is *exactly* why `lock` can't contain `await`: `lock` must be released by the thread that took it, but after an `await` you may be standing on a different thread. The compiler makes the impossible combination a compile error (CS1996) instead of a runtime heisenbug — and `SemaphoreSlim`, which doesn't care which thread releases it, is the escape hatch.

## Exercise 7.4 — Choose the right tool

For each scenario, name the tool (`await`/`Task.WhenAll`, `Task.Run`, `Parallel.ForEach`, `Interlocked`, `lock`, `SemaphoreSlim`) and justify in one line:

1. Call the FX-rate API for 50 currencies and collect the results.
2. Recompute fraud scores (heavy math) for 10,000 payments in a nightly job.
3. Increment a shared "payments processed" counter from that nightly job's workers.
4. Append to a shared `List<string>` audit log from multiple threads.
5. One PDF receipt render (CPU-heavy, ~2s) requested inside a web request, without freezing the request thread.
6. Ensure only one transfer at a time mutates balances — in a method full of `await _db...` calls.

**Solution**

1. **`Task.WhenAll`** — 50 network calls are I/O; start all, await all, zero extra threads. (`Promise.all`, verbatim.)
2. **`Parallel.ForEach`** — heavy math over a collection is the poster child for spreading across cores.
3. **`Interlocked.Increment`** — a single shared `int`; atomic op beats a lock for one operation.
4. **`lock`** — `List<T>.Add` is not thread-safe and not atomic; a critical section is required (or use a `ConcurrentBag`/`ConcurrentQueue` — knowing `System.Collections.Concurrent` exists is a bonus point).
5. **`Task.Run`** — one CPU-heavy job pushed off the request path: `var pdf = await Task.Run(() => RenderReceipt(payment));` frees the request thread while a pool thread grinds.
6. **`SemaphoreSlim(1,1)`** — the critical section contains `await`, so `lock` is a compile error; the async mutex is the tool. (Bonus if you added: "…within one process; across replicas it's the database's job.")

## Exercise 7.5 — Rob your own bank (the main event)

Back to `PaymentApp` — everything running as of Topic 6 (`docker compose up -d`, `dotnet run`).

1. Register fresh Alice and Bob (fresh DB or new emails). Total money in the system: $2,000.
2. Fire **50 concurrent** $10 transfers from Alice to Bob from your shell:

   ```bash
   for i in {1..50}; do
     curl -s -X POST http://localhost:PORT/v1/payments/transfer \
       -H "Content-Type: application/json" \
       -d '{"payerUserId":1,"payeeUserId":2,"amount":10}' > /dev/null &
   done; wait
   ```

3. Check both balances and add them up. Alice sent $500 — did Bob receive $500? Does the system still hold $2,000? Run it a few times.
4. Explain where the money went (or came from), pointing at the exact lines of `TransferAsync`.
5. Fix it with the lesson's `SemaphoreSlim(1,1)` gate, wipe the data (`docker compose down -v && docker compose up -d`, re-migrate), and re-run the attack. Verify conservation.
6. Two closing questions: why did Topic 6's conservation test never catch this? And why is the semaphore *not* the final answer once Topic 8 runs two replicas?

**Solution**

3–4. Typical result: Alice ends *above* $500 (lost debits — you printed money) and/or the total drifts from $2,000. The bug is the gap between these lines:

```csharp
var payer = await _db.Accounts.FirstOrDefaultAsync(...);   // READ  balance = 800
// ... another request reads 800 here too ...
if (payer.Balance < amount) ...                            // CHECK against stale 800
payer.Balance -= amount;                                   // MODIFY: both compute 790
await _db.SaveChangesAsync();                              // WRITE: both write 790 — one $10 debit vanished
```

Fifty overlapping requests, each read-check-modify-write on the same two rows with no coordination. It's exercise 7.1's `count++`, wearing your production code.

5. In `PaymentService`:

```csharp
private static readonly SemaphoreSlim _transferGate = new(1, 1);

public async Task TransferAsync(int payerUserId, int payeeUserId, decimal amount)
{
    if (amount <= 0) throw new ArgumentException("Amount must be positive.");

    await _transferGate.WaitAsync();
    try
    {
        var payer = await _db.Accounts.FirstOrDefaultAsync(a => a.UserId == payerUserId)
            ?? throw new KeyNotFoundException($"No account for user {payerUserId}.");
        var payee = await _db.Accounts.FirstOrDefaultAsync(a => a.UserId == payeeUserId)
            ?? throw new KeyNotFoundException($"No account for user {payeeUserId}.");

        if (payer.Balance < amount)
            throw new InvalidOperationException("Insufficient funds.");

        payer.Balance -= amount;
        payee.Balance += amount;
        await _db.SaveChangesAsync();
    }
    finally
    {
        _transferGate.Release();
    }
}
```

(`static` matters: the service is *scoped* — a new instance per request — so an instance field would give every request its own gate, guarding nothing. One `static` gate per process is the point. And it must be `SemaphoreSlim`, not `lock`: the body awaits — CS1996.)

Re-run the attack: Alice exactly $500, Bob exactly $1,500, total $2,000, every time.

6. **Why the test missed it:** unit tests call `TransferAsync` one at a time — the invariant holds under sequential use; the race only exists when calls *overlap*. (You can write a concurrency test — fire 50 `TransferAsync` tasks at one in-memory service with `Task.WhenAll` and assert conservation — but the in-memory provider's behaviour under concurrency differs from real Postgres, so treat it as a smoke test, not proof.)

**Why the semaphore isn't the end:** it serializes transfers *in this process*. Two replicas behind a load balancer each have their own gate — the race returns between them. Durable answer: push the coordination into the shared resource itself — a database transaction with row locks (`SELECT ... FOR UPDATE` — your Postgres knowledge, verbatim) or an optimistic concurrency token that turns the lost update into a retryable conflict. The in-process gate is correct *and* insufficient; knowing both halves of that sentence is the senior answer.

---

The app now moves money correctly under fire. **Topic 8** ships it: publish, Docker, compose, and the when-Node-when-.NET answer you'll actually be asked.
