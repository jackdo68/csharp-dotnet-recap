# Topic 11: Testing

> **How do I write tests in .NET, and what are the common patterns?**

This topic covers testing in .NET. You'll learn the frameworks, how to write different types of tests, and how to test code that depends on databases or external services.

---

## Why test?

Tests help you:
- Know your code works before you ship it
- Catch bugs when you change something (regression testing)
- Document how your code should behave
- Refactor with confidence

---

## Node.js to .NET comparison

| Node.js | .NET |
|---------|------|
| Jest, Mocha, Vitest | xUnit, NUnit, MSTest |
| `describe` / `it` | `[Fact]` / `[Theory]` |
| `expect(x).toBe(y)` | `Assert.Equal(y, x)` |
| `jest.mock()` | Moq, NSubstitute |
| `beforeEach` / `afterEach` | Constructor / `IDisposable` |
| `test.each([...])` | `[Theory]` with `[InlineData]` |

---

## The test frameworks

.NET has three main test frameworks. They all work similarly:

| Framework | Style | Popular for |
|-----------|-------|-------------|
| **xUnit** | Modern, clean | Most new projects |
| **NUnit** | Older, feature-rich | Many existing projects |
| **MSTest** | Microsoft's framework | Enterprise, Visual Studio |

This guide uses xUnit because it's the most common in modern .NET.

---

## Test project structure

Test projects are separate from your main code:

```
PaymentApp/
├── src/
│   ├── PaymentApp.Domain/
│   ├── PaymentApp.Application/
│   ├── PaymentApp.Infrastructure/
│   └── PaymentApp.Api/
└── tests/                          ← Test projects
    ├── PaymentApp.Domain.Tests/    ← Tests for Domain
    ├── PaymentApp.Application.Tests/
    └── PaymentApp.Api.Tests/       ← Integration tests
```

---

## Writing basic tests

### A simple test

```csharp
using Xunit;

public class CalculatorTests
{
    [Fact]  // This marks a test method
    public void Add_TwoNumbers_ReturnsSum()
    {
        // Arrange — set up the test
        var calculator = new Calculator();

        // Act — do the thing you're testing
        var result = calculator.Add(2, 3);

        // Assert — check the result
        Assert.Equal(5, result);
    }
}
```

:::tip
**Test naming convention:** `MethodName_Scenario_ExpectedResult`
:::

### Multiple test cases with [Theory]

Instead of writing many similar tests, use `[Theory]`:

```csharp
public class CalculatorTests
{
    // [Fact] = one test case
    // [Theory] = multiple test cases

    [Theory]
    [InlineData(2, 3, 5)]    // 2 + 3 = 5
    [InlineData(0, 0, 0)]    // 0 + 0 = 0
    [InlineData(-1, 1, 0)]   // -1 + 1 = 0
    public void Add_TwoNumbers_ReturnsSum(int a, int b, int expected)
    {
        var calculator = new Calculator();
        var result = calculator.Add(a, b);
        Assert.Equal(expected, result);
    }
}
```

This runs the same test three times with different inputs.

---

## Common assertions

```csharp
// Equality
Assert.Equal(expected, actual);
Assert.NotEqual(expected, actual);

// Null checks
Assert.Null(obj);
Assert.NotNull(obj);

// Boolean
Assert.True(condition);
Assert.False(condition);

// Exceptions
Assert.Throws<InvalidOperationException>(() => DoSomething());
var ex = Assert.Throws<ArgumentException>(() => DoSomething());
Assert.Equal("message", ex.Message);

// Collections
Assert.Empty(list);
Assert.Contains(item, list);
Assert.Single(list);
Assert.Collection(list,
    item => Assert.Equal("first", item),
    item => Assert.Equal("second", item));
```

---

## Mocking (faking dependencies)

When testing, you often need to replace real dependencies with fake ones. This practice is called *mocking*.

### Why mock?

| Real dependency | Problem | Solution |
|-----------------|---------|----------|
| Database | Slow, needs setup | Mock the repository |
| HTTP API | Unreliable, costs money | Mock the client |
| File system | Creates files | Mock the file service |
| Current time | Changes | Mock the clock |

### Using Moq (the most popular mocking library)

```csharp
using Moq;
using Xunit;

public class PaymentServiceTests
{
    [Fact]
    public async Task TransferAsync_SufficientBalance_Succeeds()
    {
        // Arrange — create a mock repository
        var mockDb = new Mock<IUserRepository>();

        // Set up the mock to return specific users
        mockDb.Setup(db => db.GetByIdAsync(1))
              .ReturnsAsync(new User { Id = 1, Balance = 1000m });
        mockDb.Setup(db => db.GetByIdAsync(2))
              .ReturnsAsync(new User { Id = 2, Balance = 500m });

        var service = new PaymentService(mockDb.Object);

        // Act
        var result = await service.TransferAsync(1, 2, 100m);

        // Assert
        Assert.True(result.Success);

        // Verify the mock was called
        mockDb.Verify(db => db.SaveAsync(), Times.Once);
    }
}
```

### Common mock setups

```csharp
// Return a value
mock.Setup(x => x.GetUser(1)).Returns(user);
mock.Setup(x => x.GetUserAsync(1)).ReturnsAsync(user);

// Throw an exception
mock.Setup(x => x.GetUser(999)).Throws<NotFoundException>();

// Match any argument
mock.Setup(x => x.GetUser(It.IsAny<int>())).Returns(user);

// Callback when called
mock.Setup(x => x.Save(It.IsAny<User>()))
    .Callback<User>(u => savedUser = u);

// Verify it was called
mock.Verify(x => x.Save(It.IsAny<User>()), Times.Once);
mock.Verify(x => x.Delete(1), Times.Never);
```

---

## Types of tests

### Unit tests

Test one piece of code in *isolation* — no database, no HTTP:

```csharp
public class UserTests
{
    [Fact]
    public void Withdraw_SufficientBalance_ReducesBalance()
    {
        // Arrange
        var user = new User { Balance = 1000m };

        // Act
        user.Withdraw(100m);

        // Assert
        Assert.Equal(900m, user.Balance);
    }

    [Fact]
    public void Withdraw_InsufficientBalance_ThrowsException()
    {
        var user = new User { Balance = 50m };

        Assert.Throws<InsufficientBalanceException>(
            () => user.Withdraw(100m));
    }
}
```

### Integration tests

Test multiple parts working together (real database, real HTTP):

```csharp
public class AuthControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public AuthControllerTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Register_ValidRequest_ReturnsToken()
    {
        // Arrange
        var request = new { name = "Test", email = "test@test.com", password = "Passw0rd!" };
        var content = new StringContent(
            JsonSerializer.Serialize(request),
            Encoding.UTF8,
            "application/json");

        // Act
        var response = await _client.PostAsync("/v1/auth/register", content);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("token", body);
    }
}
```

---

## Test setup and cleanup

### Constructor and Dispose (like beforeEach/afterEach)

```csharp
public class MyTests : IDisposable
{
    private readonly MyService _service;
    private readonly Mock<IDatabase> _mockDb;

    // Runs before each test (like beforeEach)
    public MyTests()
    {
        _mockDb = new Mock<IDatabase>();
        _service = new MyService(_mockDb.Object);
    }

    // Runs after each test (like afterEach)
    public void Dispose()
    {
        // Clean up resources
    }

    [Fact]
    public void Test1() { /* uses _service */ }

    [Fact]
    public void Test2() { /* uses fresh _service */ }
}
```

### Shared fixture (like beforeAll)

```csharp
// Shared fixture — created once, shared across all tests
public class DatabaseFixture : IDisposable
{
    public DatabaseFixture()
    {
        // Set up database once
    }

    public void Dispose()
    {
        // Clean up once
    }
}

// Use IClassFixture to share it
public class MyTests : IClassFixture<DatabaseFixture>
{
    private readonly DatabaseFixture _fixture;

    public MyTests(DatabaseFixture fixture)
    {
        _fixture = fixture;
    }
}
```

---

## Testing async code

```csharp
[Fact]
public async Task GetUserAsync_ExistingUser_ReturnsUser()
{
    // Arrange
    var mockRepo = new Mock<IUserRepository>();
    mockRepo.Setup(r => r.GetByIdAsync(1))
            .ReturnsAsync(new User { Id = 1, Name = "Alice" });

    var service = new UserService(mockRepo.Object);

    // Act
    var result = await service.GetUserAsync(1);

    // Assert
    Assert.NotNull(result);
    Assert.Equal("Alice", result.Name);
}
```

---

## Running tests

```bash
# Run all tests
dotnet test

# Run tests in a specific project
dotnet test tests/PaymentApp.Domain.Tests

# Run with verbose output
dotnet test --verbosity normal

# Run a specific test
dotnet test --filter "FullyQualifiedName~Withdraw_SufficientBalance"

# Generate code coverage report
dotnet test --collect:"XPlat Code Coverage"
```

---

## Test organization tips

### One test class per class being tested

```
PaymentApp.Domain/
└── Entities/
    └── User.cs

PaymentApp.Domain.Tests/
└── Entities/
    └── UserTests.cs
```

### Group related tests

```csharp
public class UserTests
{
    public class WithdrawTests
    {
        [Fact]
        public void SufficientBalance_ReducesBalance() { }

        [Fact]
        public void InsufficientBalance_ThrowsException() { }
    }

    public class DepositTests
    {
        [Fact]
        public void PositiveAmount_IncreasesBalance() { }

        [Fact]
        public void NegativeAmount_ThrowsException() { }
    }
}
```

---

## Recap

- "I use xUnit for testing because it's the modern standard in .NET. The concepts are similar to Jest — `[Fact]` is like `it()`, `[Theory]` is like `test.each()`."
- "I mock dependencies with Moq. For example, I mock the database repository so unit tests run fast and don't need a real database."
- "Unit tests test one thing in isolation. Integration tests test multiple parts together, often with a real database."
- "I follow the Arrange-Act-Assert pattern: set up the test, do the action, check the result."
- "The naming convention `MethodName_Scenario_ExpectedResult` makes it clear what each test covers."
