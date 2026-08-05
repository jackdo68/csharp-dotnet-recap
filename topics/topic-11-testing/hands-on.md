# Topic 11: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint + Document upload → .NET Standard Library → Authentication → Production → **Testing**

This topic adds automated tests to PaymentApp to ensure it works correctly.

**Prerequisites:** Complete Topic 10 hands-on (Dockerized PaymentApp).

---

## Exercise 11.1 — Create a test project

**Task:** Create a test project for the Domain layer.

**Solution**

```bash
# Create the tests folder
mkdir -p tests

# Create a test project
dotnet new xunit -n PaymentApp.Domain.Tests -o tests/PaymentApp.Domain.Tests

# Add reference to the Domain project
dotnet add tests/PaymentApp.Domain.Tests reference src/PaymentApp.Domain

# Add the test project to the solution
dotnet sln add tests/PaymentApp.Domain.Tests
```

**What we created:**

| File | Purpose |
|------|---------|
| `tests/PaymentApp.Domain.Tests/` | Test project folder |
| `PaymentApp.Domain.Tests.csproj` | Project file with xUnit packages |
| `UnitTest1.cs` | Example test file (we'll replace this) |

---

## Exercise 11.2 — Write tests for the User entity

**Task:** Test the `Withdraw` and `Deposit` methods on the User entity.

**Solution**

Delete the example test file:

```bash
rm tests/PaymentApp.Domain.Tests/UnitTest1.cs
```

Create `tests/PaymentApp.Domain.Tests/Entities/UserTests.cs`:

```csharp
using PaymentApp.Domain.Entities;
using PaymentApp.Domain.Exceptions;
using Xunit;

namespace PaymentApp.Domain.Tests.Entities;

public class UserTests
{
    private User CreateUser(decimal balance = 1000m)
    {
        var user = new User
        {
            Id = 1,
            Name = "Test User",
            Email = "test@example.com",
            PasswordHash = "hash",
            CreatedAt = DateTime.UtcNow
        };
        user.SetInitialBalance(balance);
        return user;
    }

    // ========================================
    // Withdraw tests
    // ========================================

    [Fact]
    public void Withdraw_SufficientBalance_ReducesBalance()
    {
        // Arrange — set up the test
        var user = CreateUser(1000m);

        // Act — do the thing we're testing
        user.Withdraw(100m);

        // Assert — check the result
        Assert.Equal(900m, user.Balance);
    }

    [Fact]
    public void Withdraw_ExactBalance_SetsBalanceToZero()
    {
        var user = CreateUser(100m);

        user.Withdraw(100m);

        Assert.Equal(0m, user.Balance);
    }

    [Fact]
    public void Withdraw_InsufficientBalance_ThrowsException()
    {
        var user = CreateUser(50m);

        // Assert.Throws checks that the code throws the expected exception
        var ex = Assert.Throws<InsufficientBalanceException>(
            () => user.Withdraw(100m));

        // Check the exception details
        Assert.Equal(50m, ex.CurrentBalance);
        Assert.Equal(100m, ex.RequestedAmount);
    }

    [Fact]
    public void Withdraw_NegativeAmount_ThrowsException()
    {
        var user = CreateUser(1000m);

        Assert.Throws<InvalidTransferException>(
            () => user.Withdraw(-50m));
    }

    [Fact]
    public void Withdraw_ZeroAmount_ThrowsException()
    {
        var user = CreateUser(1000m);

        Assert.Throws<InvalidTransferException>(
            () => user.Withdraw(0m));
    }

    // ========================================
    // Deposit tests
    // ========================================

    [Fact]
    public void Deposit_PositiveAmount_IncreasesBalance()
    {
        var user = CreateUser(1000m);

        user.Deposit(500m);

        Assert.Equal(1500m, user.Balance);
    }

    [Fact]
    public void Deposit_NegativeAmount_ThrowsException()
    {
        var user = CreateUser(1000m);

        Assert.Throws<InvalidTransferException>(
            () => user.Deposit(-100m));
    }

    // ========================================
    // SetInitialBalance tests
    // ========================================

    [Fact]
    public void SetInitialBalance_PositiveAmount_SetsBalance()
    {
        var user = new User();

        user.SetInitialBalance(500m);

        Assert.Equal(500m, user.Balance);
    }

    [Fact]
    public void SetInitialBalance_NegativeAmount_ThrowsException()
    {
        var user = new User();

        Assert.Throws<ArgumentException>(
            () => user.SetInitialBalance(-100m));
    }

    // ========================================
    // Domain events tests
    // ========================================

    [Fact]
    public void Withdraw_Success_RaisesDomainEvent()
    {
        var user = CreateUser(1000m);

        user.Withdraw(100m);

        // Check that a domain event was raised
        Assert.Single(user.DomainEvents);
    }

    [Fact]
    public void Deposit_Success_RaisesDomainEvent()
    {
        var user = CreateUser(1000m);

        user.Deposit(100m);

        Assert.Single(user.DomainEvents);
    }
}
```

Run the tests:

```bash
dotnet test tests/PaymentApp.Domain.Tests
```

**Expected output:**

```
Passed!  - Failed:     0, Passed:    11, Skipped:     0, Total:    11
```

---

## Exercise 11.3 — Test with multiple inputs using [Theory]

**Task:** Test multiple scenarios with `[Theory]` instead of writing separate tests.

**Solution**

Add this test class to `UserTests.cs` or create a separate file:

```csharp
public class UserWithdrawTheoryTests
{
    private User CreateUser(decimal balance)
    {
        var user = new User { Id = 1, Name = "Test", Email = "t@t.com", PasswordHash = "h" };
        user.SetInitialBalance(balance);
        return user;
    }

    // [Theory] runs the same test with different inputs
    // [InlineData] provides the inputs

    [Theory]
    [InlineData(1000, 100, 900)]   // Starting 1000, withdraw 100, expect 900
    [InlineData(1000, 1000, 0)]    // Starting 1000, withdraw 1000, expect 0
    [InlineData(500, 250, 250)]    // Starting 500, withdraw 250, expect 250
    [InlineData(100, 1, 99)]       // Starting 100, withdraw 1, expect 99
    public void Withdraw_ValidAmount_ReturnsExpectedBalance(
        decimal startingBalance,
        decimal withdrawAmount,
        decimal expectedBalance)
    {
        // Arrange
        var user = CreateUser(startingBalance);

        // Act
        user.Withdraw(withdrawAmount);

        // Assert
        Assert.Equal(expectedBalance, user.Balance);
    }

    [Theory]
    [InlineData(100, 101)]    // Can't withdraw more than you have
    [InlineData(50, 100)]     // Can't withdraw more than you have
    [InlineData(0, 1)]        // Can't withdraw from empty account
    public void Withdraw_InsufficientBalance_ThrowsException(
        decimal startingBalance,
        decimal withdrawAmount)
    {
        var user = CreateUser(startingBalance);

        Assert.Throws<InsufficientBalanceException>(
            () => user.Withdraw(withdrawAmount));
    }
}
```

Run the tests again:

```bash
dotnet test tests/PaymentApp.Domain.Tests
```

---

## Exercise 11.4 — Test the Money value object

**Task:** Test the Money value object's operations.

**Solution**

Create `tests/PaymentApp.Domain.Tests/ValueObjects/MoneyTests.cs`:

```csharp
using PaymentApp.Domain.ValueObjects;
using Xunit;

namespace PaymentApp.Domain.Tests.ValueObjects;

public class MoneyTests
{
    [Fact]
    public void Add_SameCurrency_ReturnsCombinedAmount()
    {
        var a = Money.USD(100);
        var b = Money.USD(50);

        var result = a.Add(b);

        Assert.Equal(150m, result.Amount);
        Assert.Equal("USD", result.Currency);
    }

    [Fact]
    public void Add_DifferentCurrency_ThrowsException()
    {
        var usd = Money.USD(100);
        var aud = Money.AUD(50);

        Assert.Throws<InvalidOperationException>(
            () => usd.Add(aud));
    }

    [Fact]
    public void Subtract_SameCurrency_ReturnsRemainder()
    {
        var a = Money.USD(100);
        var b = Money.USD(30);

        var result = a.Subtract(b);

        Assert.Equal(70m, result.Amount);
    }

    [Fact]
    public void Subtract_DifferentCurrency_ThrowsException()
    {
        var usd = Money.USD(100);
        var aud = Money.AUD(30);

        Assert.Throws<InvalidOperationException>(
            () => usd.Subtract(aud));
    }

    [Fact]
    public void Zero_ReturnsZeroAmount()
    {
        var zero = Money.Zero("USD");

        Assert.Equal(0m, zero.Amount);
        Assert.Equal("USD", zero.Currency);
    }

    [Fact]
    public void Equality_SameValues_AreEqual()
    {
        var a = Money.USD(100);
        var b = Money.USD(100);

        Assert.Equal(a, b);
        Assert.True(a == b);
    }

    [Fact]
    public void Equality_DifferentAmounts_AreNotEqual()
    {
        var a = Money.USD(100);
        var b = Money.USD(200);

        Assert.NotEqual(a, b);
    }

    [Fact]
    public void ToString_FormatsCorrectly()
    {
        var money = Money.USD(1234.56m);

        var result = money.ToString();

        Assert.Contains("USD", result);
        Assert.Contains("1,234.56", result);
    }
}
```

---

## Exercise 11.5 — Create an integration test project

**Task:** Create a test project for API integration tests.

**Solution**

```bash
# Create the test project
dotnet new xunit -n PaymentApp.Api.Tests -o tests/PaymentApp.Api.Tests

# Add references
dotnet add tests/PaymentApp.Api.Tests reference src/PaymentApp.Api
dotnet add tests/PaymentApp.Api.Tests reference src/PaymentApp.Domain
dotnet add tests/PaymentApp.Api.Tests reference src/PaymentApp.Application

# Add testing packages
dotnet add tests/PaymentApp.Api.Tests package Microsoft.AspNetCore.Mvc.Testing
dotnet add tests/PaymentApp.Api.Tests package Microsoft.EntityFrameworkCore.InMemory

# Add to solution
dotnet sln add tests/PaymentApp.Api.Tests
```

---

## Exercise 11.6 — Write an integration test

**Task:** Test the register endpoint with a real HTTP request.

**Solution**

First, delete the example test:

```bash
rm tests/PaymentApp.Api.Tests/UnitTest1.cs
```

Create `tests/PaymentApp.Api.Tests/Controllers/AuthControllerTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PaymentApp.Infrastructure.Data;
using Xunit;

namespace PaymentApp.Api.Tests.Controllers;

public class AuthControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;
    private readonly WebApplicationFactory<Program> _factory;

    public AuthControllerTests(WebApplicationFactory<Program> factory)
    {
        // Configure the test server to use an in-memory database
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                // Remove the real database
                var descriptor = services.SingleOrDefault(
                    d => d.ServiceType == typeof(DbContextOptions<PaymentDbContext>));
                if (descriptor != null)
                    services.Remove(descriptor);

                // Add in-memory database for testing
                services.AddDbContext<PaymentDbContext>(options =>
                    options.UseInMemoryDatabase("TestDb_" + Guid.NewGuid()));
            });
        });

        _client = _factory.CreateClient();
    }

    [Fact]
    public async Task Register_ValidRequest_ReturnsToken()
    {
        // Arrange
        var request = new
        {
            name = "Test User",
            email = $"test-{Guid.NewGuid()}@example.com",
            password = "Passw0rd!"
        };

        // Act
        var response = await _client.PostAsJsonAsync("/v1/auth/register", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.NotNull(body);
        Assert.NotEmpty(body.Token);
    }

    [Fact]
    public async Task Register_DuplicateEmail_ReturnsConflict()
    {
        // Arrange — register once
        var email = $"duplicate-{Guid.NewGuid()}@example.com";
        var request = new { name = "Test", email, password = "Passw0rd!" };

        await _client.PostAsJsonAsync("/v1/auth/register", request);

        // Act — try to register again with same email
        var response = await _client.PostAsJsonAsync("/v1/auth/register", request);

        // Assert
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Login_ValidCredentials_ReturnsToken()
    {
        // Arrange — register first
        var email = $"login-test-{Guid.NewGuid()}@example.com";
        var password = "Passw0rd!";
        await _client.PostAsJsonAsync("/v1/auth/register", new { name = "Test", email, password });

        // Act — login
        var response = await _client.PostAsJsonAsync("/v1/auth/login", new { email, password });

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.NotNull(body);
        Assert.NotEmpty(body.Token);
    }

    [Fact]
    public async Task Login_InvalidPassword_ReturnsUnauthorized()
    {
        // Arrange — register
        var email = $"wrong-pass-{Guid.NewGuid()}@example.com";
        await _client.PostAsJsonAsync("/v1/auth/register", new { name = "Test", email, password = "Passw0rd!" });

        // Act — login with wrong password
        var response = await _client.PostAsJsonAsync("/v1/auth/login", new { email, password = "WrongPassword!" });

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private record TokenResponse(string Token);
}
```

**Important:** You need to make `Program` accessible to the test project. Add this to `src/PaymentApp.Api/Program.cs` at the very end:

```csharp
// Make Program visible to test projects
public partial class Program { }
```

Run the tests:

```bash
dotnet test tests/PaymentApp.Api.Tests
```

---

## Exercise 11.7 — Run all tests

**Task:** Run all tests in the solution.

**Solution**

```bash
# Run all tests
dotnet test

# Run with more detail
dotnet test --verbosity normal

# Run only failed tests (on re-run)
dotnet test --filter "FullyQualifiedName~Failed"
```

---

## Exercise 11.8 — Build and verify

**Task:** Make sure everything compiles and tests pass.

**Solution**

```bash
# Build the entire solution
dotnet build

# Run all tests
dotnet test
```

**Expected output:**

```
Passed!  - Failed:     0, Passed:   XX, Skipped:     0
```

---

## What we built

| File | Purpose |
|------|---------|
| `tests/PaymentApp.Domain.Tests/` | Unit tests for Domain layer |
| `tests/PaymentApp.Api.Tests/` | Integration tests for API |
| `UserTests.cs` | Tests for User entity |
| `MoneyTests.cs` | Tests for Money value object |
| `AuthControllerTests.cs` | Tests for auth endpoints |

**Test project structure:**

```
tests/
├── PaymentApp.Domain.Tests/
│   ├── Entities/
│   │   └── UserTests.cs
│   └── ValueObjects/
│       └── MoneyTests.cs
└── PaymentApp.Api.Tests/
    └── Controllers/
        └── AuthControllerTests.cs
```

---

## Key takeaways

| Concept | What it means |
|---------|---------------|
| `[Fact]` | Marks a single test case |
| `[Theory]` + `[InlineData]` | Run same test with different inputs |
| `Assert.Equal()` | Check that two values are equal |
| `Assert.Throws<T>()` | Check that code throws an exception |
| Unit test | Test one thing in isolation |
| Integration test | Test multiple parts together |
| In-memory database | Fast fake database for testing |

---

## Recap

- "I use xUnit because it's the modern standard. `[Fact]` is like Jest's `it()`, and `[Theory]` is like `test.each()`."
- "I follow Arrange-Act-Assert: set up the test, do the action, check the result."
- "For unit tests, I use in-memory databases or mocks so tests run fast without real infrastructure."
- "Integration tests use a real HTTP client against a test server to verify the full request flow."
- "The naming convention `MethodName_Scenario_ExpectedResult` makes test names self-documenting."

---

## Next: Topic 12

In Topic 12, we cover advanced patterns and architecture concepts that are common in large .NET applications (concepts only, no hands-on code).
