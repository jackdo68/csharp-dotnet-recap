# Topic 10: Hands On

> **The PaymentApp build:** Topic 5 the API, straight onto Postgres → Topic 6 EF unpacked + tests → Topic 7 the transfer race → Topic 8 Docker & ship → Topic 9 register, login, lock down → **Topic 10 (you are here): the pipeline & the payment processor.**

Set up Concepts' pieces first: the `payment-processor/` folder (copy Concepts' three files — that service is provided, not an exercise), then the PaymentApp changes (DataAnnotations, exception middleware, typed client, `UserLocks`, orchestrated transfer, auditor). For 10.1–10.6 run things locally against the composed Postgres (`docker compose up -d db`); the closer composes all three. Try each exercise before reading its solution.

## Exercise 10.1 — Stand up the processor and talk to it directly

1. `cd payment-processor && npm install && node server.js`. In another terminal, hit `/v1/withdraw` and `/v1/deposit` directly for a user that exists (you need the db up and a registered user from earlier topics — or register one via PaymentApp).
2. Drive it to both failure modes: withdraw more than the balance, and withdraw from user 999.
3. Look closely at a success response: what *JavaScript type* is `balance`, and why did the `pg` library make that choice?

**Solution**

```bash
curl -X POST http://localhost:4000/v1/withdraw \
  -H "Content-Type: application/json" -d '{"userId":1,"amount":100}'
# {"balance":"900.00"}

curl -i -X POST http://localhost:4000/v1/withdraw \
  -H "Content-Type: application/json" -d '{"userId":1,"amount":999999}'
# 400 {"error":"Insufficient funds"}

curl -i -X POST http://localhost:4000/v1/withdraw \
  -H "Content-Type: application/json" -d '{"userId":999,"amount":10}'
# 404 {"error":"No user 999"}

curl -X POST http://localhost:4000/v1/deposit \
  -H "Content-Type: application/json" -d '{"userId":1,"amount":100}'
# {"balance":"1000.00"} — back where we started
```

3\. `balance` is a **string** (`"900.00"`), not a number. `pg` refuses to parse Postgres `numeric` into a JS `number` because `number` is a float64 — it cannot hold arbitrary-precision decimals without silent loss. Your own ecosystem just restated the course's oldest rule (money is `decimal`, Topic 2) from the other side: JS *has no* decimal, so the driver hands you a string and makes the problem yours. On the .NET side the same column arrives as an actual `decimal`. (Real processors sidestep the whole question with integer minor units — cents.)

Also worth noticing: the "insufficient funds" 400 came from `rowCount === 0` on the atomic `UPDATE ... WHERE "Balance" >= $1` — the check and the debit are **one statement**. There is no window between them. Hold that thought until 10.5.

## Exercise 10.2 — Declarative validation (the zod layer)

1. Add Concepts' DataAnnotations to `RegisterRequest` and `TransferRequest`, and delete the now-redundant `amount <= 0` throw from the service. Where did that rule *go*?
2. Fire bad payloads at register and transfer: 1-character name, `not-an-email`, 6-character password, amount `0`, amount `-5`. Read one response body carefully — what structure do the errors come back in?
3. The three-layer drill: for each of these transfer payloads, name **which layer** rejects it — deserialization (Topic 4), DataAnnotations (this exercise), or business rules (service/processor):
   `{"amount":"heaps"}` · `{"amount":0}` · `{"amount":50}` with a broke payer · `{"amount":50}` payer == payee.

**Solution**

1. The rule moved from an imperative throw buried in a method to a **declaration on the DTO** — visible in the type, enforced by `[ApiController]` *before the action runs*, documented automatically. Same migration you'd do moving hand-rolled `if (!body.amount)` checks into a zod schema.

2.

```bash
curl -i -X POST http://localhost:PORT/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"A","email":"not-an-email","password":"short"}'
# 400 — problem-details body:
# "errors": {
#   "Name":     ["The field Name must be a string or array type with a minimum length of '2'."],
#   "Email":    ["The Email field is not a valid e-mail address."],
#   "Password": ["The field Password must be a string or array type with a minimum length of '8'."]
# }
```

**Per-field, all failures at once** — one round trip tells the client everything wrong, exactly like `zod.flatten()`. Your controller contains zero lines of this.

3. The drill:

| Payload | Rejected by | Why |
|---|---|---|
| `"amount":"heaps"` | **deserialization** | a string can't become `decimal` — Topic 4's `JsonException` → automatic 400 naming `$.amount` |
| `"amount":0` | **DataAnnotations** | fails `[Range(0.01, ...)]` — the request alone answers this, no state needed |
| broke payer | **business rule (processor)** | needs *state* (the balance) — the atomic UPDATE's `rowCount === 0` → 400 via the typed client's exception |
| payer == payee | **business rule (service)** | needs *two fields compared* — the `InvalidOperationException` in `TransferAsync` |

The senior version of this answer: "validation lives at the layer that has the information to decide."

## Exercise 10.3 — Your own middleware

1. Add Concepts' inline timing middleware and the `ExceptionMappingMiddleware`. Register the exception mapper **first** in the pipeline, then timing, then auth. Why does the mapper have to be first?
2. Delete the try/catch from `PaymentController.Transfer` and `DocumentController.Upload`. Re-run the failure curls from Topic 5's exercise 5.1 — confirm the statuses are identical to before.
3. Watch the timing middleware's output — including for a request that *failed*. What does the logged status tell you about middleware ordering?

**Solution**

1. Middleware wraps everything registered *after* it — the pipeline is an onion, `next()` all the way down and responses bubbling back up, exactly Express. The exception mapper can only catch exceptions from middleware and endpoints **downstream of itself**, so it goes first (outermost). Put it after auth and an exception in the auth layer escapes it.

2. Same behavior, radically better shape:

```bash
curl -i -X POST .../v1/payment/transfer ... -d '{"payerUserId":1,"payeeUserId":999,"amount":10}'
# 404 {"status":404,"error":"No user 999"}   ← thrown by the typed client,
#                                                          caught by the MIDDLEWARE
```

The exception→status table now exists **once**, in one file, instead of copy-pasted per action. Controllers are down to their happy path. This is Topic 4's catch-by-type promoted to infrastructure — and it's what `UseExceptionHandler` / `IExceptionHandler` do in framework form; you've now built the mechanism they wrap.

3. The timing line logs `404`/`400` statuses too — because the exception mapper is *outside* the timing middleware... wait, it's registered before, so timing is *inside* the mapper: the exception passes **through** timing's `await next()` un-caught, timing's stopwatch line never runs for that request. Flip the two registrations (timing first, mapper second) and the timing line appears for failures as well — with the mapped status, because by the time the response bubbles back out through timing, the mapper has already written it. **Middleware order is program logic**, not configuration — the same lesson as Topic 9's `UseAuthentication` before `UseAuthorization`, now observed in your own code.

## Exercise 10.4 — The typed client and the concurrent saga

1. Wire Concepts' `PaymentClient` (registration + config key), replace `TransferAsync`'s EF mutations with the lock + `Task.WhenAll` + compensation orchestration, and delete the old static `SemaphoreSlim`. With the processor running, do a normal transfer end to end and confirm balances via psql (`SELECT "Name","Balance" FROM "Users";`).
2. Now break the downstream: **stop the processor** (Ctrl+C) and fire a transfer. What status does the caller get, and which piece of today's code chose it?
3. Force a one-leg failure: transfer to a payee that doesn't exist. Trace what happened to the payer's money — step by step, from your app's log lines and the balances.

**Solution**

1. The registration is the part to internalize:

```csharp
builder.Services.AddHttpClient<PaymentClient>(client =>
    client.BaseAddress = new Uri(builder.Configuration["PaymentProcessor:BaseUrl"]!));
```

`AddHttpClient<T>` does three jobs at once: registers `PaymentClient` in DI (constructor-inject it like anything else), gives it a factory-managed `HttpClient` (pooled sockets — never `new HttpClient()` per request, the .NET analogue of reusing a keep-alive agent), and scopes the config to *this* client only.

2. **502** `{"status":502,"error":"Payment processor unavailable."}`. The chain: `HttpClient` throws `HttpRequestException` (connection refused) → it flies out of `TransferAsync` → the **exception middleware** maps it to 502 Bad Gateway. Nobody wrote a try/catch in the controller; the pipeline owned it. 502 (not 500) is the honest status: "*my* dependency failed," which tells the caller — and your alerting — where to look.

3. The one-leg failure, traced:

```
withdraw(alice, 50)  → 200, balance drops to 950     ← leg 1 SUCCEEDED
deposit(999, 50)     → 404                            ← leg 2 FAILED
Task.WhenAll         → throws KeyNotFoundException (via the typed client's translation)
catch:  withdraw.IsCompletedSuccessfully == true
        → deposit(alice, 50)  → 200, balance back to 1000    ← COMPENSATION
throw   → middleware → 404 {"error":"No user 999"}
```

Alice's balance dipped to 950 *and came back* — if you're quick with a second terminal you can catch the dip, which is exactly why the per-user locks exist (10.5): between the dip and the compensation, that user's balance is a lie, and no other transfer should read it.

## Exercise 10.5 — Deadlock on purpose (the best five minutes of the course)

1. **Sabotage the lock order first**: in `LockPairAsync`, change the ordered acquisition to naive payer-first (lock `userIdA` then `userIdB`, no sorting). Register Alice and Bob fresh.
2. Hammer both directions at once:

   ```bash
   for i in {1..25}; do
     curl -s -X POST http://localhost:PORT/v1/payment/transfer \
       -H "Authorization: Bearer $ALICE" -H "Content-Type: application/json" \
       -d '{"payerUserId":1,"payeeUserId":2,"amount":1}' > /dev/null &
     curl -s -X POST http://localhost:PORT/v1/payment/transfer \
       -H "Authorization: Bearer $BOB" -H "Content-Type: application/json" \
       -d '{"payerUserId":2,"payeeUserId":1,"amount":1}' > /dev/null &
   done; wait
   ```

   What happens — and what do the timing-middleware logs (10.3) *stop* doing?
3. Explain the mechanics in two sentences, restore the ascending-id ordering, re-run, and confirm every request completes.
4. Finally, re-run **Topic 7's original attack** (50 concurrent one-direction transfers) and verify conservation: totals exact, every run — now with *no* app-level global gate and the correctness anchored in the processor's SQL.

**Solution**

2. Some requests complete; then the app goes quiet. Curls hang until timeout; the timing middleware logs simply **stop appearing** — requests go in, nothing comes out. The API isn't crashed, isn't busy, isn't logging errors. It's *waiting forever*, which monitors and log-based alerts are notoriously bad at seeing. (Meanwhile Kestrel keeps accepting connections that will never finish — under real load this cascades into thread-pool and connection exhaustion.)

3. **The mechanics:** an Alice→Bob request acquires Alice's gate and then waits for Bob's; simultaneously a Bob→Alice request acquires Bob's and waits for Alice's — a circular wait that no timeout in our code breaks. A race condition (Topic 7) gives you wrong numbers; a deadlock gives you *silence*. The fix is a **global acquisition order** — everyone locks the lower user id first, so the cycle cannot form:

```csharp
var (first, second) = userIdA < userIdB ? (userIdA, userIdB) : (userIdB, userIdA);
```

One comparison. That's the entire distance between "passed code review" and "paged at 3am." Re-run the two-direction hammer: all 50 complete, timing logs flow continuously.

4. Conservation holds — alice + bob total exact after every run. Note what's *not* in the picture anymore: Topic 7's single global `SemaphoreSlim` (which serialized *all* transfers — Alice→Bob blocked Cara→Dave for no reason). The per-user gates serialize only transfers touching the *same* users, and the balance math itself is anchored in the processor's atomic `UPDATE`, which is the layer that would still hold with ten API replicas.

**Talking point:** "I've produced a deadlock deliberately and fixed it with lock ordering" — then explain per-user gates vs one global lock as a *throughput* decision. Concurrency answers that mention both correctness and throughput read as lived experience.

## Exercise 10.6 — The auditor in the background

1. Add Concepts' `SettlementAuditor` and register it. Before running: predict what happens if you inject `PaymentDbContext` directly into its constructor instead of `IServiceScopeFactory`. Then try it — read the actual error.
2. Run the 10.5 attack while watching the auditor's log line across a few ticks. What should it print every time, and what would a drift mean?
3. `docker compose stop api` (or Ctrl+C locally) — what does the auditor do during shutdown, and which Topic 8 machinery is reaching into your loop?

**Solution**

1. The app **fails at startup** with `InvalidOperationException: Cannot consume scoped service 'PaymentDbContext' from singleton 'IHostedService'`. The DI container validates the lifetime graph before serving a single request — a *singleton* holding a *scoped* service would secretly extend that DbContext's life to the whole app (the exact captive-dependency crash you read in exercise 5.2, now wearing a hosted-service disguise). The fix is the pattern in Concepts: inject `IServiceScopeFactory`, create a fresh scope per tick, resolve the DbContext inside it. This startup error is one of the most-Googled in ASP.NET Core; you've now read it on purpose.

2. `AUDIT: total money in system = 2000.0` — the same number, tick after tick, *while* 50 concurrent transfers hammer the API. That's the reconciliation invariant: transfers move money, they never create or destroy it. A drift means a one-legged transfer escaped compensation — which is why real payment companies run exactly this job (against yesterday's ledger, at much larger scale) and page someone when it's nonzero.

3. On SIGTERM the host cancels `stoppingToken`; `Task.Delay(..., stoppingToken)` throws `TaskCanceledException` immediately (no 30-second wait), `ExecuteAsync` unwinds, and the host logs a clean shutdown — the auditor participates in Topic 8's graceful-shutdown drain like any request. A Node cron worker gets this behavior only if you hand-wired the SIGTERM plumbing; here the `CancellationToken` convention carries it through every layer, including yours.

---

**Course complete — the whole system, one compose file up.** `docker compose up --build` at the workspace root: Postgres, the Node payment processor (single writer of money, atomic SQL), and the .NET API — validated at three layers, authenticated with JWTs, orchestrating concurrent two-leg sagas under per-user locks, watched by an in-process auditor, draining politely on SIGTERM. Every line of it you typed (except the processor — that one's your home turf) and can explain. Re-read the five big differences in the [Guide](../../guide/) one last time; you now have a production-shaped war story for each.
