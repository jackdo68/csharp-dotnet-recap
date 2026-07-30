# Topic 4: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → **Exceptions** → Web API + EF Core → EF Core deep dive → Transfer endpoint → Document upload → Authentication → Production

In this hands-on, you'll add domain exceptions to PaymentApp. These typed exceptions will make error handling clear and consistent throughout the application.

**Prerequisites:** Complete Topic 3 hands-on.

---

## Exercise 4.1 — Create the base domain exception

All domain exceptions should inherit from a common base. This lets us catch "any domain error" when needed.

**Task:** Create a base `DomainException` class.

**Solution**

Create the folder and base exception:

```bash
mkdir -p src/PaymentApp.Domain/Exceptions
```

Create `src/PaymentApp.Domain/Exceptions/DomainException.cs`:

```csharp
namespace PaymentApp.Domain.Exceptions;

/// <summary>
/// Base class for all domain exceptions.
/// Domain exceptions represent business rule violations.
/// </summary>
public abstract class DomainException : Exception
{
    public string Code { get; }

    protected DomainException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    protected DomainException(string code, string message, Exception innerException)
        : base(message, innerException)
    {
        Code = code;
    }
}
```

**Understanding the syntax:**

| Syntax | What it means |
|--------|---------------|
| `: Exception` | Inherits from the base Exception class |
| `abstract class` | Cannot be instantiated directly |
| `: base(message)` | Calls the parent constructor |
| `Code` property | Machine-readable error code for API responses |

**Why a Code property?**

HTTP responses need machine-readable error codes, not just human messages:
```json
{
  "code": "INSUFFICIENT_BALANCE",
  "message": "Cannot transfer $500 with balance of $100"
}
```

---

## Exercise 4.2 — Create specific domain exceptions

Let's create exceptions for specific business rule violations.

**Task:** Create exceptions for:
- User not found
- Insufficient balance
- Invalid transfer amount
- Duplicate email

**Solution**

Create `src/PaymentApp.Domain/Exceptions/UserNotFoundException.cs`:

```csharp
namespace PaymentApp.Domain.Exceptions;

public class UserNotFoundException : DomainException
{
    public int UserId { get; }

    public UserNotFoundException(int userId)
        : base("USER_NOT_FOUND", $"User with ID {userId} was not found")
    {
        UserId = userId;
    }

    public UserNotFoundException(string email)
        : base("USER_NOT_FOUND", $"User with email '{email}' was not found")
    {
    }
}
```

Create `src/PaymentApp.Domain/Exceptions/InsufficientBalanceException.cs`:

```csharp
namespace PaymentApp.Domain.Exceptions;

public class InsufficientBalanceException : DomainException
{
    public decimal CurrentBalance { get; }
    public decimal RequestedAmount { get; }

    public InsufficientBalanceException(decimal currentBalance, decimal requestedAmount)
        : base(
            "INSUFFICIENT_BALANCE",
            $"Cannot withdraw {requestedAmount:C} with balance of {currentBalance:C}")
    {
        CurrentBalance = currentBalance;
        RequestedAmount = requestedAmount;
    }
}
```

Create `src/PaymentApp.Domain/Exceptions/InvalidTransferException.cs`:

```csharp
namespace PaymentApp.Domain.Exceptions;

public class InvalidTransferException : DomainException
{
    public InvalidTransferException(string reason)
        : base("INVALID_TRANSFER", reason)
    {
    }

    public static InvalidTransferException NegativeAmount(decimal amount)
        => new($"Transfer amount must be positive, got {amount:C}");

    public static InvalidTransferException ZeroAmount()
        => new("Transfer amount cannot be zero");

    public static InvalidTransferException SameUser()
        => new("Cannot transfer to yourself");
}
```

Create `src/PaymentApp.Domain/Exceptions/DuplicateEmailException.cs`:

```csharp
namespace PaymentApp.Domain.Exceptions;

public class DuplicateEmailException : DomainException
{
    public string Email { get; }

    public DuplicateEmailException(string email)
        : base("DUPLICATE_EMAIL", $"A user with email '{email}' already exists")
    {
        Email = email;
    }
}
```

**Understanding the patterns:**

| Pattern | Example | Purpose |
|---------|---------|---------|
| Rich exception | `InsufficientBalanceException` with `CurrentBalance` property | Carry context for logging/display |
| Static factory | `InvalidTransferException.NegativeAmount()` | Readable creation + consistent messages |
| Constructor overloads | `UserNotFoundException(int)` vs `UserNotFoundException(string)` | Different lookup methods |

---

## Exercise 4.3 — Add validation to User entity

Let's add a method to the User entity that validates and performs a transfer, raising domain events and throwing exceptions as needed.

**Task:** Add `Withdraw` and `Deposit` methods to User.

**Solution**

Update `src/PaymentApp.Domain/Entities/User.cs`:

```csharp
using PaymentApp.Domain.Events;
using PaymentApp.Domain.Exceptions;

namespace PaymentApp.Domain.Entities;

public class User : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public decimal Balance { get; private set; }
    public string? DocumentPath { get; set; }

    /// <summary>
    /// Withdraws money from this user's balance.
    /// </summary>
    /// <exception cref="InsufficientBalanceException">
    /// Thrown when balance is insufficient.
    /// </exception>
    public void Withdraw(decimal amount)
    {
        if (amount <= 0)
            throw InvalidTransferException.NegativeAmount(amount);

        if (Balance < amount)
            throw new InsufficientBalanceException(Balance, amount);

        var oldBalance = Balance;
        Balance -= amount;

        AddDomainEvent(new UserBalanceChanged(Id, oldBalance, Balance));
    }

    /// <summary>
    /// Deposits money into this user's balance.
    /// </summary>
    public void Deposit(decimal amount)
    {
        if (amount <= 0)
            throw InvalidTransferException.NegativeAmount(amount);

        var oldBalance = Balance;
        Balance += amount;

        AddDomainEvent(new UserBalanceChanged(Id, oldBalance, Balance));
    }

    /// <summary>
    /// Sets the initial balance (for account creation).
    /// </summary>
    public void SetInitialBalance(decimal amount)
    {
        if (amount < 0)
            throw new ArgumentException("Initial balance cannot be negative", nameof(amount));

        Balance = amount;
    }
}
```

**Key changes:**

| Change | Why |
|--------|-----|
| `Balance { get; private set; }` | Only the entity controls balance changes |
| `Withdraw()` throws `InsufficientBalanceException` | Business rule enforced at domain level |
| Raises `UserBalanceChanged` event | Other parts of the system can react |

---

## Exercise 4.4 — Add a Result type (optional pattern)

For operations where failure is expected and normal (not exceptional), we can use a Result type instead of exceptions.

**Task:** Create a simple Result type.

**Solution**

Create `src/PaymentApp.Domain/Common/Result.cs`:

```bash
mkdir -p src/PaymentApp.Domain/Common
```

```csharp
namespace PaymentApp.Domain.Common;

/// <summary>
/// Represents the result of an operation that can succeed or fail.
/// Use for expected failures (validation). Use exceptions for exceptional failures.
/// </summary>
public class Result
{
    public bool IsSuccess { get; }
    public bool IsFailure => !IsSuccess;
    public string? Error { get; }

    protected Result(bool isSuccess, string? error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    public static Result Success() => new(true, null);
    public static Result Failure(string error) => new(false, error);

    public static Result<T> Success<T>(T value) => new(value, true, null);
    public static Result<T> Failure<T>(string error) => new(default!, false, error);
}

/// <summary>
/// Result with a value on success.
/// </summary>
public class Result<T> : Result
{
    public T Value { get; }

    internal Result(T value, bool isSuccess, string? error)
        : base(isSuccess, error)
    {
        Value = value;
    }

    public static implicit operator Result<T>(T value) => Success(value);
}
```

**When to use Result vs Exception:**

| Situation | Use |
|-----------|-----|
| User input validation | Result (failure is expected) |
| Business rule violation | Exception (violation is exceptional) |
| External service failure | Exception (with retry logic) |
| Parse might fail | TryParse pattern |

**Example usage:**

```csharp
// Result pattern
public Result<User> ValidateRegistration(string email, string password)
{
    if (string.IsNullOrEmpty(email))
        return Result.Failure<User>("Email is required");

    if (password.Length < 8)
        return Result.Failure<User>("Password must be at least 8 characters");

    // ... create user
    return user;  // implicit conversion to Result<User>
}

// vs Exception pattern
public void Register(string email, string password)
{
    // These throw if violated - exceptional case
    ArgumentException.ThrowIfNullOrEmpty(email);

    var user = new User { Email = email };
    // ...
}
```

---

## Exercise 4.5 — Test exception behavior

**Task:** Create a temporary test to verify exceptions work correctly.

**Solution**

Create `test-exceptions.cs`:

```csharp
#!/usr/bin/env dotnet
#r "src/PaymentApp.Domain/bin/Debug/net10.0/PaymentApp.Domain.dll"

using PaymentApp.Domain.Entities;
using PaymentApp.Domain.Exceptions;
using PaymentApp.Domain.Constants;

// Create a user with initial balance
var alice = new User
{
    Id = 1,
    Name = "Alice",
    Email = PaymentDefaults.TestUsers.AliceEmail
};
alice.SetInitialBalance(PaymentDefaults.InitialBalance);

Console.WriteLine($"Alice's balance: {alice.Balance:C}");

// Successful withdrawal
alice.Withdraw(250m);
Console.WriteLine($"After withdrawing $250: {alice.Balance:C}");

// Check domain events
Console.WriteLine($"\nDomain events raised: {alice.DomainEvents.Count}");
foreach (var evt in alice.DomainEvents)
{
    Console.WriteLine($"  - {evt.GetType().Name}");
}

// Try to overdraw
Console.WriteLine("\nAttempting to withdraw $1000...");
try
{
    alice.Withdraw(1000m);
}
catch (InsufficientBalanceException ex)
{
    Console.WriteLine($"Caught: {ex.Code}");
    Console.WriteLine($"Message: {ex.Message}");
    Console.WriteLine($"Balance was: {ex.CurrentBalance:C}");
    Console.WriteLine($"Requested: {ex.RequestedAmount:C}");
}

// Try negative amount
Console.WriteLine("\nAttempting to withdraw -$50...");
try
{
    alice.Withdraw(-50m);
}
catch (InvalidTransferException ex)
{
    Console.WriteLine($"Caught: {ex.Code}");
    Console.WriteLine($"Message: {ex.Message}");
}

// Multiple catch blocks by type
Console.WriteLine("\nDemonstrating catch by type:");
void TryOperation(Action operation, string description)
{
    try
    {
        operation();
        Console.WriteLine($"  {description}: Success");
    }
    catch (InsufficientBalanceException)
    {
        Console.WriteLine($"  {description}: Insufficient balance");
    }
    catch (InvalidTransferException)
    {
        Console.WriteLine($"  {description}: Invalid transfer");
    }
    catch (DomainException ex)
    {
        Console.WriteLine($"  {description}: Domain error - {ex.Code}");
    }
}

TryOperation(() => alice.Withdraw(10m), "Withdraw $10");
TryOperation(() => alice.Withdraw(10000m), "Withdraw $10000");
TryOperation(() => alice.Withdraw(0m), "Withdraw $0");
```

Build and run:

```bash
dotnet build src/PaymentApp.Domain
dotnet run test-exceptions.cs
```

Expected output:

```
Alice's balance: $1,000.00
After withdrawing $250: $750.00

Domain events raised: 1
  - UserBalanceChanged

Attempting to withdraw $1000...
Caught: INSUFFICIENT_BALANCE
Message: Cannot withdraw $1,000.00 with balance of $750.00
Balance was: $750.00
Requested: $1,000.00

Attempting to withdraw -$50...
Caught: INVALID_TRANSFER
Message: Transfer amount must be positive, got -$50.00

Demonstrating catch by type:
  Withdraw $10: Success
  Withdraw $10000: Insufficient balance
  Withdraw $0: Invalid transfer
```

**Clean up:**

```bash
rm test-exceptions.cs
```

---

## Exercise 4.6 — Build and verify

**Task:** Build the solution and verify everything compiles.

**Solution**

```bash
dotnet build
```

---

## What we built

| File | Purpose |
|------|---------|
| `Exceptions/DomainException.cs` | Base exception with Code property |
| `Exceptions/UserNotFoundException.cs` | User lookup failures |
| `Exceptions/InsufficientBalanceException.cs` | Overdraft attempts |
| `Exceptions/InvalidTransferException.cs` | Bad transfer parameters |
| `Exceptions/DuplicateEmailException.cs` | Registration conflicts |
| `Common/Result.cs` | Result type for expected failures |
| Updated `User.cs` | Withdraw/Deposit with validation |

**Domain project structure:**

```
src/PaymentApp.Domain/
├── Common/
│   └── Result.cs
├── Constants/
│   └── PaymentDefaults.cs
├── Entities/
│   ├── BaseEntity.cs
│   └── User.cs (updated)
├── Events/
│   ├── IDomainEvent.cs
│   └── UserEvents.cs
├── Exceptions/
│   ├── DomainException.cs
│   ├── DuplicateEmailException.cs
│   ├── InsufficientBalanceException.cs
│   ├── InvalidTransferException.cs
│   └── UserNotFoundException.cs
├── Utilities/
│   └── EntityDescriptor.cs
└── ValueObjects/
    └── Money.cs
```

---

## Key differences: C# vs TypeScript

| Aspect | C# | TypeScript |
|--------|-----|------------|
| **Exception types** | Catch by type, no instanceof | Must use instanceof checks |
| **Runtime enforcement** | JSON deserializer throws on mismatch | `as` casts are trust-based |
| **Parse failures** | `FormatException` at parse site | `NaN` drifts downstream |
| **Dictionary miss** | `KeyNotFoundException` | `undefined` |
| **TryParse pattern** | `out` parameter | No equivalent (return tuple) |

---

## Interview talking points

- "Domain exceptions carry business context — `InsufficientBalanceException` knows the current balance and requested amount."
- "We catch exceptions by type, not with instanceof checks. The runtime routes to the right catch block."
- "The Code property gives machine-readable error codes for API responses."
- "Expected failures use the Result pattern or TryParse; exceptional failures throw."
- "Domain logic enforces business rules at the entity level — Withdraw() can't overdraw, guaranteed."

---

## Next: Topic 5

In Topic 5, we build the Web API layer: controllers, DI registration, and EF Core database connection. The domain exceptions we created will translate to HTTP error responses.
