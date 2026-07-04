# Topic 5: Exercises

Build the API from the lesson first (type it in — models, interface, service, controller, `Program.cs`), then extend it.

## Exercise 5.1 — Prove it works

Run the app and, from another terminal (swap `PORT`):

```bash
curl -X POST http://localhost:PORT/api/loans \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"Alice","amount":300000}'

curl http://localhost:PORT/api/loans
curl http://localhost:PORT/api/loans/1
curl -i http://localhost:PORT/api/loans/999
```

Confirm: 201 with a `Location` header on create; 404 (not an error page, not a crash) for loan 999. Also send `{"applicantName":"Bob","amount":"heaps"}` — what status comes back, and which lesson concept produced it?

## Exercise 5.2 — Break it with the wrong lifetime

1. Change the registration to `AddScoped<ILoanService, LoanService>()`. Restart, POST a loan, then GET the list. What happens, and why exactly?
2. Now reason: with `AddSingleton`, the controller is still created per request — so why does the data survive?
3. Put it back to `AddSingleton`. In one sentence each, name a dependency you'd register as scoped, transient, and singleton in a real service.

## Exercise 5.3 — The approve endpoint

Add `PUT /api/loans/{id}/approve` that sets `Status = "Approved"`:

1. Add `Task<LoanApplication?> ApproveAsync(int id)` to the interface and implement it in the service (return `null` if the id doesn't exist).
2. Add the controller action with the right attribute. 404 for a missing loan, 200 with the updated loan otherwise.
3. Verify with curl: create → approve → get, and approve a nonexistent id.

## Exercise 5.4 — A second injected dependency

Inject ASP.NET Core's built-in `ILogger<LoansController>` into the controller alongside the loan service (add a constructor parameter — no registration needed; the platform pre-registers logging). Log a warning whenever a loan over $1,000,000 is created. Watch it appear in the `dotnet run` console output.

What does it tell you that you never registered `ILogger<T>` yourself?
