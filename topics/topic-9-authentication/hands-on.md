# Topic 9: Hands On

> **The PaymentApp build:** Topic 5 the API, straight onto Postgres → Topic 6 EF unpacked + tests → Topic 7 the transfer race → Topic 8 Docker & ship → **Topic 9 (you are here): register, login, lock down** → Topic 10 the pipeline & the payment processor.

Build Concepts' changes first (JWT package, `Jwt` config, `ValidateCredentialsAsync`, login endpoint, `AddJwtBearer`, `[Authorize]` + ownership check). Run locally against the composed Postgres (`docker compose up -d db`) for 9.1–9.3; 9.4 composes everything. Try each exercise before reading its solution.

## Exercise 9.1 — Log in and read your own token

1. Register a fresh Alice, then log in as her. One curl each.
2. A JWT is three base64 chunks joined by dots. Decode the middle chunk and identify: `sub`, `name`, `iss`, `exp`. Match each to the exact line of your `Login` action that produced it.
3. Log in with a wrong password. What status and body come back — and why is the error message deliberately vague?

**Solution**

```bash
curl -X POST http://localhost:PORT/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@bank.test","password":"Passw0rd!"}'

curl -X POST http://localhost:PORT/v1/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@bank.test","password":"Passw0rd!"}'
# {"token":"eyJhbGciOiJIUzI1NiIs..."}
```

Decode the payload (or paste the token into jwt.io):

```bash
TOKEN=eyJ...   # the token value
echo $TOKEN | cut -d '.' -f2 | base64 --decode
# {"sub":"1","name":"Alice","email":"alice@bank.test","exp":1751800000,"iss":"paymentapp"}
```

`sub` ← `new Claim("sub", user.Id.ToString())`, `name` ← the name claim, `iss` ← the `issuer:` argument (from `Jwt:Issuer` config), `exp` ← `expires: DateTime.UtcNow.AddHours(1)`. **The payload is readable by anyone** — base64 is encoding, not encryption; the third chunk (the HMAC signature) is what makes it trustworthy. Never put secrets in claims.

3\. **401** with `{"error":"Invalid email or password."}`. Vague on purpose: "wrong password" vs "no such email" would let an attacker enumerate which emails have accounts. Small API, real security habit.

## Exercise 9.2 — Prove the signature matters

1. Call `GET /v1/accounts/balance` three ways: no token, with the real token, and with a **tampered** token — take your real token and change one character in the middle (payload) chunk. Predict the three responses first.
2. Look at the 401s' `WWW-Authenticate` header — what does the middleware tell you about *why* it refused?
3. Restart the app with a different signing key (`Jwt__Key="a-completely-different-32-char-key!!" dotnet run`) and use your old token. What happens, and what does that tell you about what a token *is*?

**Solution**

```bash
curl -i http://localhost:PORT/v1/accounts/balance
# 401 — WWW-Authenticate: Bearer                        (no token at all)

curl -i http://localhost:PORT/v1/accounts/balance -H "Authorization: Bearer $TOKEN"
# 200 — 1000  (YOUR balance, no userId in the URL anymore)

curl -i http://localhost:PORT/v1/accounts/balance -H "Authorization: Bearer ${TOKEN/A/B}"
# 401 — WWW-Authenticate: Bearer error="invalid_token"  (signature check failed)
```

The tampered token is the teaching moment: you changed one character of the *payload*, so the HMAC no longer matches — the middleware rejected it before any of your code ran. That's the entire trust model of JWTs in one curl: **the payload is plaintext; the signature makes it immutable.**

3\. Old token → 401 `invalid_token`. A JWT is only "valid" *relative to a key*: change the key and every outstanding token dies instantly. Two practical corollaries: rotating the key is the nuclear "log everyone out" button, and the key itself is the crown jewels — which is why 9.4 injects it as a secret env var instead of baking it into the image.

## Exercise 9.3 — Ownership: your money, not Bob's

1. Register Bob and log him in. As **Bob**, try to transfer $100 with `"payerUserId": 1` (Alice's id). Predict the status. Then do the honest version (`payerUserId` = Bob's own id) and confirm it works.
2. State the difference between the two failures you've now seen — the missing-token 401 and this one — in one sentence each.
3. Carry Topic 5's logging forward: include the *authenticated caller* in the large-transfer warning, and confirm the log line shows who really initiated it (not just what the body claimed).

**Solution**

```bash
BOB=$(curl -s -X POST http://localhost:PORT/v1/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@bank.test","password":"Passw0rd!"}' | jq -r .token)

curl -i -X POST http://localhost:PORT/v1/payments/transfer \
  -H "Authorization: Bearer $BOB" -H "Content-Type: application/json" \
  -d '{"payerUserId":1,"payeeUserId":2,"amount":100}'
# 403 Forbidden — the ownership check: token says sub=2, body says payer=1

curl -X POST http://localhost:PORT/v1/payments/transfer \
  -H "Authorization: Bearer $BOB" -H "Content-Type: application/json" \
  -d '{"payerUserId":2,"payeeUserId":1,"amount":100}'
# {"status":"completed"}
```

2\. **401** = authentication failed — the middleware couldn't establish *who* is calling (no/bad token). **403** = authorization failed — identity is proven, and the answer is still no (`Forbid()` from your payer-must-equal-caller check). Interviewers probe this pair constantly; you've now implemented both sides.

3\.

```csharp
if (request.Amount > 10_000)
    _logger.LogWarning("Large transfer by {Caller}: user {Payer} -> user {Payee}, amount {Amount}",
        User.Identity?.Name, request.PayerUserId, request.PayeeUserId, request.Amount);
```

`User.Identity?.Name` works because of the `NameClaimType = "name"` line — and unlike the request body, it can't be forged: it came through the signature. An audit trail keyed to the *token* identity rather than client-supplied fields is precisely what a payment-system reviewer looks for.

## Exercise 9.4 — Ship it locked

1. The composed app needs the signing key. Add `Jwt__Key` to the `api` service in `docker-compose.yml` (a different value than your dev `appsettings.json` one — prove the env var wins). `docker compose up --build`.
2. Full end-to-end against the container on port 8080: register → login → balance → transfer, all with curl.
3. Reasoning: your dev-machine token from 9.1 — will it work against the container? Why (not)? And why must `Jwt__Key` be *identical across replicas* the day you scale `api` to two?

**Solution**

1. In `docker-compose.yml`:

```yaml
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      ConnectionStrings__PaymentDb: "Host=db;Database=payapp;Username=payapp;Password=devpass"
      Jwt__Key: "compose-secret-key-32-chars-minimum!!"
      Jwt__Issuer: "paymentapp"
    depends_on:
      - db
```

(In real deployments that value comes from a secrets manager / k8s Secret, not the YAML — the *mechanism* is identical, which is the point of Topic 8's config layering.)

2:

```bash
curl -X POST http://localhost:8080/v1/register -H "Content-Type: application/json" \
  -d '{"name":"Cara","email":"cara@bank.test","password":"Passw0rd!"}'
TOKEN=$(curl -s -X POST http://localhost:8080/v1/login -H "Content-Type: application/json" \
  -d '{"email":"cara@bank.test","password":"Passw0rd!"}' | jq -r .token)
curl http://localhost:8080/v1/accounts/balance -H "Authorization: Bearer $TOKEN"    # 1000
```

3\. The 9.1 token **fails (401)** against the container: it was signed with the dev key, and the container validates with the compose key — same lesson as 9.2's key swap, now happening *between environments*, which is exactly where it bites real teams. And when `api` scales to two replicas, any replica may receive any request, so all of them must validate (and sign) with the same key — shared signing material is a *deployment* concern, not a code concern. (Follow the thread one step further — "what if many *different services* need to validate?" — and you've reinvented the separate identity server: one issuer, public-key validation everywhere. That's OpenIddict/Duende territory, the graduation path from this design.)

## Exercise 9.5 — Say it out loud (no code)

Interview drill — one or two sentences each, then check against the solutions:

1. Walk a request's life from `POST /v1/login` to an approved transfer, naming every check.
2. Why do we store a password *hash*, and what does the framework hasher give you that `sha256(password)` doesn't?
3. Your PM asks: "can we make tokens last 30 days so users stay logged in?"

**Solution**

1. "Login verifies the password against its hash and signs a JWT carrying `sub`/`name` with the server's key, expiring in an hour. On each request, the JwtBearer middleware verifies signature, expiry, and issuer, and builds `User` from the claims — before any controller code. `[Authorize]` returns 401 if that failed; then the transfer action compares the body's payer to the token's `sub` and returns 403 on mismatch; only then does the (Topic 7-serialized) money move."
2. "A hash can't be reversed into the password when the table leaks — and the framework hasher adds a per-user salt and thousands of iterations, so identical passwords hash differently and brute force is slow. Bare `sha256` has neither: rainbow tables and GPUs eat it."
3. "Long-lived access tokens can't be revoked — a stolen one works for 30 days, and we'd have no logout short of rotating the signing key for *everyone*. The standard answer is short access tokens plus a refresh token that *is* server-side revocable. That's more machinery than this app needs today, but that's the design conversation."

---

**The money is guarded — one topic left.** The app still does everything itself: validation buried in services, per-controller try/catch, and every balance mutation in-process. **Topic 10** rebuilds the plumbing the way real payment stacks do it: middleware, declarative validation, and an external payment processor called over HTTP — including the deadlock you'll cause on purpose.
