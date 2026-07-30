# Topic 12: Advanced Patterns

> **What patterns do large .NET applications use, and when should I use them?**

This topic covers common architectural patterns you'll see in enterprise .NET applications. These are **concepts only** — understanding when and why to use them is more important than implementing them all.

---

## Clean Architecture

Clean Architecture organizes code into layers, with the most important code (business logic) at the center.

### The layers

```
┌─────────────────────────────────────────────────────────┐
│                     External                             │
│  (UI, Database, APIs, File System, etc.)                │
│  ┌─────────────────────────────────────────────────┐    │
│  │                Infrastructure                    │    │
│  │  (EF Core, HttpClient, File I/O)                │    │
│  │  ┌─────────────────────────────────────────┐    │    │
│  │  │             Application                  │    │    │
│  │  │  (Use cases, DTOs, Service interfaces)  │    │    │
│  │  │  ┌─────────────────────────────────┐    │    │    │
│  │  │  │           Domain                 │    │    │    │
│  │  │  │  (Entities, Value Objects,      │    │    │    │
│  │  │  │   Business Rules)               │    │    │    │
│  │  │  └─────────────────────────────────┘    │    │    │
│  │  └─────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### The dependency rule

**Inner layers never know about outer layers.**

| Layer | Depends on | Never depends on |
|-------|------------|------------------|
| Domain | Nothing | Application, Infrastructure |
| Application | Domain | Infrastructure |
| Infrastructure | Application, Domain | — |
| API/UI | All layers | — |

### PaymentApp follows this pattern

```
PaymentApp.Domain        → No dependencies
PaymentApp.Application   → Depends on Domain
PaymentApp.Infrastructure → Depends on Application, Domain
PaymentApp.Api           → Depends on all
```

### Why use Clean Architecture?

| Benefit | Explanation |
|---------|-------------|
| Testable | Domain and Application layers have no database/HTTP dependencies |
| Flexible | Can swap databases or frameworks without changing business logic |
| Understandable | Clear where each type of code belongs |
| Maintainable | Changes in one layer don't affect others |

### When to use it?

| Project type | Use Clean Architecture? |
|--------------|------------------------|
| Small/simple API | Maybe overkill — simpler is fine |
| Medium/large API | Good fit |
| Long-lived project | Definitely worth it |
| Prototype/MVP | Probably not — move fast first |

---

## Repository Pattern

The Repository pattern hides database details behind an interface.

### Without repository (direct DbContext)

```csharp
public class UserService
{
    private readonly PaymentDbContext _db;

    public async Task<User> GetUserAsync(int id)
    {
        return await _db.Users.FirstOrDefaultAsync(u => u.Id == id);
    }
}
```

### With repository

```csharp
// Interface (in Application layer)
public interface IUserRepository
{
    Task<User?> GetByIdAsync(int id);
    Task<User?> GetByEmailAsync(string email);
    Task AddAsync(User user);
    Task SaveAsync();
}

// Implementation (in Infrastructure layer)
public class UserRepository : IUserRepository
{
    private readonly PaymentDbContext _db;

    public async Task<User?> GetByIdAsync(int id)
        => await _db.Users.FirstOrDefaultAsync(u => u.Id == id);

    // ... other methods
}

// Service uses the interface
public class UserService
{
    private readonly IUserRepository _users;

    public async Task<User> GetUserAsync(int id)
    {
        return await _users.GetByIdAsync(id);
    }
}
```

### Why use Repository?

| Benefit | Explanation |
|---------|-------------|
| Testable | Easy to mock `IUserRepository` in tests |
| Swappable | Can change from EF Core to Dapper without touching services |
| Centralized | All data access logic in one place |

### When NOT to use it?

Some argue Repository adds unnecessary complexity when using EF Core, because:
- EF Core's `DbSet<T>` is already a repository
- You lose EF Core features (LINQ flexibility)
- More code to maintain

**Pragmatic approach:** Use repositories for complex queries, but don't wrap every simple query.

---

## CQRS (Command Query Responsibility Segregation)

CQRS separates reading data (queries) from changing data (commands).

### Traditional approach

```
User ──────┐
           ├──► UserService ──► UserRepository ──► Database
Admin ─────┘
```

Same service handles both reads and writes.

### CQRS approach

```
Read (Queries)                Write (Commands)
     │                              │
     ▼                              ▼
QueryHandler                 CommandHandler
     │                              │
     ▼                              ▼
 Read Model                   Write Model
     │                              │
     ▼                              ▼
  Database                      Database
```

### Simple example

```csharp
// Query (read)
public record GetUserQuery(int Id);
public record GetUserResult(int Id, string Name, decimal Balance);

public class GetUserHandler
{
    public async Task<GetUserResult> Handle(GetUserQuery query)
    {
        // Optimized for reading — could be a different database
        var user = await _db.Users.AsNoTracking()
            .Where(u => u.Id == query.Id)
            .Select(u => new GetUserResult(u.Id, u.Name, u.Balance))
            .FirstOrDefaultAsync();
        return user;
    }
}

// Command (write)
public record TransferCommand(int PayerId, int PayeeId, decimal Amount);

public class TransferHandler
{
    public async Task Handle(TransferCommand command)
    {
        // All the business logic for transfers
        var payer = await _db.Users.FirstAsync(u => u.Id == command.PayerId);
        // ... validation, transfer, save
    }
}
```

### Why use CQRS?

| Benefit | Explanation |
|---------|-------------|
| Optimized reads | Query models can be denormalized (faster to read) |
| Clear intent | Commands and queries are separate, explicit |
| Scalability | Can scale reads and writes independently |
| Event sourcing | Natural fit with event-driven systems |

### When to use CQRS?

| Scenario | Use CQRS? |
|----------|----------|
| Simple CRUD | No — adds complexity with little benefit |
| Complex business logic | Maybe — if reads and writes are very different |
| High-scale systems | Yes — can optimize each side separately |
| Event-sourced systems | Yes — natural fit |

---

## MediatR (Mediator Pattern)

MediatR is a popular library that implements the mediator pattern. It routes requests to handlers.

```csharp
// Instead of calling services directly:
var user = await _userService.GetUserAsync(id);

// You send a request through MediatR:
var user = await _mediator.Send(new GetUserQuery(id));
```

### How it works

```
Controller ──► MediatR ──► Handler ──► Database
                 │
                 └── Finds the right handler for the request
```

### Why use MediatR?

| Benefit | Explanation |
|---------|-------------|
| Decoupling | Controllers don't know about handlers |
| Pipeline | Can add behaviors (logging, validation, caching) to all requests |
| Organization | One handler per operation, easy to find |

### When to use it?

- Large applications with many operations
- When you want a consistent request/handler pattern
- When you need cross-cutting concerns (logging, validation)

For small applications, direct service calls are simpler.

---

## Domain-Driven Design (DDD)

DDD is a way of thinking about complex software by focusing on the business domain.

### Key concepts

| Concept | What it means |
|---------|---------------|
| **Entity** | Has identity (User, Order) — same ID = same thing |
| **Value Object** | No identity (Money, Address) — same values = equal |
| **Aggregate** | Group of entities that change together |
| **Aggregate Root** | The "boss" entity that controls the aggregate |
| **Domain Event** | Something that happened (UserRegistered, MoneyTransferred) |
| **Repository** | Persists aggregates |
| **Domain Service** | Business logic that doesn't belong to one entity |

### Aggregate example

```
Order (Aggregate Root)
  │
  ├── OrderItem
  ├── OrderItem
  └── ShippingAddress (Value Object)
```

**Rules:**
- Only the Order can add/remove OrderItems
- Outside code gets OrderItems through the Order
- The repository saves/loads the entire Order

### In PaymentApp

```
User (Aggregate Root)
  │
  └── Balance (managed by Withdraw/Deposit methods)
```

- `User` is the aggregate root
- Balance can only be changed through `Withdraw()` and `Deposit()`
- Domain events track balance changes

### When to use DDD?

| Project complexity | Use DDD? |
|-------------------|----------|
| Simple CRUD | No — just use services |
| Medium complexity | Some concepts (entities, value objects) |
| Complex business rules | Yes — helps manage complexity |

---

## Middleware vs Filters

Both intercept requests, but at different levels.

### Middleware

Runs for **every request**, before routing:

```
Request ──► Middleware 1 ──► Middleware 2 ──► Router ──► Controller
                                                             │
Response ◄── Middleware 1 ◄── Middleware 2 ◄── Router ◄──────┘
```

```csharp
app.UseAuthentication();  // Middleware
app.UseAuthorization();   // Middleware
```

### Filters

Runs for **specific controllers/actions**, after routing:

```csharp
[Authorize]           // Filter
[HttpPost("transfer")]
public async Task Transfer(...) { }
```

### When to use each?

| Use case | Middleware or Filter? |
|----------|----------------------|
| Logging all requests | Middleware |
| Authentication | Middleware |
| Authorization on specific endpoints | Filter (`[Authorize]`) |
| Exception handling for API | Middleware |
| Validation for one endpoint | Filter or model validation |

---

## Event-Driven Architecture

Instead of calling services directly, you publish events and handlers react to them.

```
Traditional:
TransferService ──► EmailService.SendTransferNotification()
                ──► AuditService.LogTransfer()
                ──► AnalyticsService.TrackTransfer()

Event-Driven:
TransferService ──► Publish(TransferCompleted)
                         │
                         ├──► EmailHandler (sends email)
                         ├──► AuditHandler (logs)
                         └──► AnalyticsHandler (tracks)
```

### Benefits

| Benefit | Explanation |
|---------|-------------|
| Loose coupling | Transfer doesn't know about email, audit, etc. |
| Easy to add | New handlers don't change existing code |
| Async | Handlers can run in background |

### In PaymentApp

We added domain events (`UserBalanceChanged`), but didn't wire up handlers. In a larger system, these events could trigger:
- Notification emails
- Audit logging
- Real-time updates to other users

---

## Summary: When to use what

| Pattern | Use when |
|---------|----------|
| **Clean Architecture** | Medium-large applications, long-term projects |
| **Repository** | Complex queries, need to swap databases, better testing |
| **CQRS** | Very different read/write needs, high scale |
| **MediatR** | Large apps, want consistent request/handler pattern |
| **DDD** | Complex business rules, multiple domain experts |
| **Event-Driven** | Loose coupling, async processing, auditing |

---

## Interview talking points

- "I use Clean Architecture to keep business logic separate from infrastructure. The Domain layer has no external dependencies."
- "Repository pattern helps with testing — I can mock the repository instead of the database."
- "CQRS separates reads from writes. It's useful when read and write models are very different, but overkill for simple CRUD."
- "MediatR implements the mediator pattern. It decouples controllers from handlers and makes it easy to add cross-cutting concerns."
- "In DDD, aggregates are clusters of entities that change together. The aggregate root is the entry point."
- "These patterns add complexity. I use them when the benefits outweigh the costs — not for every project."

---

## Further reading

- **Clean Architecture** by Robert C. Martin (the book that started it)
- **Domain-Driven Design** by Eric Evans (the original DDD book)
- **CQRS Journey** by Microsoft (free, practical guide)
- **eShop sample** at github.com/dotnet/eShop (Microsoft's reference implementation)

---

## Congratulations!

You've completed the C#/.NET guide for TypeScript developers. You now understand:

1. ✅ How .NET differs from Node.js (runtime, threading, types)
2. ✅ C# language features (properties, records, async/await)
3. ✅ Building APIs with ASP.NET Core
4. ✅ Data access with EF Core
5. ✅ Concurrency and thread safety
6. ✅ Authentication with JWT
7. ✅ Docker deployment
8. ✅ Testing strategies
9. ✅ Advanced architectural patterns

**Next steps:**
- Build more projects
- Explore the eShop sample repository
- Read the books mentioned above
- Practice, practice, practice!
