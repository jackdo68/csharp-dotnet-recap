# Topic 8: Hands On

> **The PaymentApp build:** Solution structure → Domain models → Runtime utilities → Exceptions → Web API + EF Core → EF Core deep dive → Transfer endpoint + Document upload → **.NET Standard Library** → Authentication → Production

This topic doesn't add new features to PaymentApp. Instead, we practice the common .NET tools (HttpClient, JSON, files, etc.) that you'll use in every .NET project.

**Prerequisites:** Complete Topic 7 hands-on (working transfer and document upload).

---

## Exercise 8.1 — Make HTTP calls with HttpClient

**Task:** Create a script that fetches data from a public API.

**Solution**

Create `test-http.cs`:

```csharp
#!/usr/bin/env dotnet

using System.Text.Json;

// Create an HttpClient (a tool for making web requests)
var client = new HttpClient();

// Fetch a random joke from a public API
Console.WriteLine("Fetching a random joke...\n");

var response = await client.GetAsync("https://official-joke-api.appspot.com/random_joke");

// Check if the request succeeded
if (response.IsSuccessStatusCode)
{
    // Read the response body as text
    var json = await response.Content.ReadAsStringAsync();
    Console.WriteLine($"Raw JSON: {json}\n");

    // Parse the JSON into a C# object
    var joke = JsonSerializer.Deserialize<Joke>(json);
    Console.WriteLine($"Setup: {joke.setup}");
    Console.WriteLine($"Punchline: {joke.punchline}");
}
else
{
    Console.WriteLine($"Request failed with status: {response.StatusCode}");
}

// Define the shape of the joke data
// (The API returns JSON with lowercase property names)
record Joke(string setup, string punchline);
```

Run it:

```bash
dotnet run test-http.cs
```

**Expected output:**

```
Fetching a random joke...

Raw JSON: {"type":"general","setup":"Why did the coffee file a police report?","punchline":"It got mugged.","id":123}

Setup: Why did the coffee file a police report?
Punchline: It got mugged.
```

**What's happening:**

| Step | What it does |
|------|--------------|
| `new HttpClient()` | Creates a tool for making web requests |
| `GetAsync(url)` | Sends a GET request (fetches data from the URL) |
| `response.IsSuccessStatusCode` | Checks if the request succeeded (status 200-299) |
| `ReadAsStringAsync()` | Reads the response body as text |
| `JsonSerializer.Deserialize<T>()` | Converts JSON text into a C# object |

**Clean up:**

```bash
rm test-http.cs
```

---

## Exercise 8.2 — Work with JSON

**Task:** Practice converting between JSON and C# objects.

**Solution**

Create `test-json.cs`:

```csharp
#!/usr/bin/env dotnet

using System.Text.Json;

// --- Part 1: Convert C# object to JSON ---
Console.WriteLine("=== C# to JSON ===\n");

var user = new User("Alice", "alice@example.com", 30);
var json = JsonSerializer.Serialize(user);
Console.WriteLine($"Default: {json}");
// Output: {"Name":"Alice","Email":"alice@example.com","Age":30}

// With pretty printing (easier to read)
var options = new JsonSerializerOptions { WriteIndented = true };
var prettyJson = JsonSerializer.Serialize(user, options);
Console.WriteLine($"\nPretty:\n{prettyJson}");

// With camelCase (like JavaScript)
var camelOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = true
};
var camelJson = JsonSerializer.Serialize(user, camelOptions);
Console.WriteLine($"\ncamelCase:\n{camelJson}");
// Output: {"name":"Alice","email":"alice@example.com","age":30}


// --- Part 2: Convert JSON to C# object ---
Console.WriteLine("\n=== JSON to C# ===\n");

var jsonInput = """
{
    "name": "Bob",
    "email": "bob@example.com",
    "age": 25
}
""";

// Need to tell it to ignore case (JSON has "name", C# has "Name")
var parseOptions = new JsonSerializerOptions
{
    PropertyNameCaseInsensitive = true
};

var parsedUser = JsonSerializer.Deserialize<User>(jsonInput, parseOptions);
Console.WriteLine($"Parsed: {parsedUser.Name}, {parsedUser.Email}, {parsedUser.Age}");


// --- Part 3: Handle missing or extra properties ---
Console.WriteLine("\n=== Missing/Extra Properties ===\n");

var incompleteJson = """{"name": "Charlie"}""";
var partialUser = JsonSerializer.Deserialize<User>(incompleteJson, parseOptions);
Console.WriteLine($"Missing props: Name={partialUser.Name}, Email={partialUser.Email ?? "null"}, Age={partialUser.Age}");
// Missing properties get default values (null for string, 0 for int)


// Define the User type
record User(string Name, string? Email, int Age);
```

Run it:

```bash
dotnet run test-json.cs
```

**Key points:**

| Option | What it does |
|--------|--------------|
| `WriteIndented = true` | Adds spaces and newlines (easier to read) |
| `PropertyNamingPolicy = JsonNamingPolicy.CamelCase` | Uses `camelCase` like JavaScript instead of `PascalCase` |
| `PropertyNameCaseInsensitive = true` | Matches "name" to "Name" when parsing |

**Clean up:**

```bash
rm test-json.cs
```

---

## Exercise 8.3 — Read and write files

**Task:** Practice file operations.

**Solution**

Create `test-files.cs`:

```csharp
#!/usr/bin/env dotnet

// --- Part 1: Write files ---
Console.WriteLine("=== Writing Files ===\n");

// Write a simple text file
await File.WriteAllTextAsync("hello.txt", "Hello, World!");
Console.WriteLine("Created hello.txt");

// Write multiple lines
var lines = new[] { "Line 1", "Line 2", "Line 3" };
await File.WriteAllLinesAsync("lines.txt", lines);
Console.WriteLine("Created lines.txt");


// --- Part 2: Read files ---
Console.WriteLine("\n=== Reading Files ===\n");

// Read entire file as one string
var content = await File.ReadAllTextAsync("hello.txt");
Console.WriteLine($"hello.txt contains: {content}");

// Read file as array of lines
var readLines = await File.ReadAllLinesAsync("lines.txt");
Console.WriteLine($"lines.txt has {readLines.Length} lines:");
foreach (var line in readLines)
{
    Console.WriteLine($"  - {line}");
}


// --- Part 3: Check if files/folders exist ---
Console.WriteLine("\n=== Checking Existence ===\n");

Console.WriteLine($"hello.txt exists: {File.Exists("hello.txt")}");
Console.WriteLine($"missing.txt exists: {File.Exists("missing.txt")}");

// Create a folder
Directory.CreateDirectory("test-folder");
Console.WriteLine($"test-folder exists: {Directory.Exists("test-folder")}");


// --- Part 4: Work with paths ---
Console.WriteLine("\n=== Path Operations ===\n");

// Combine path parts (handles / and \ for you)
var fullPath = Path.Combine("folder", "subfolder", "file.txt");
Console.WriteLine($"Combined path: {fullPath}");

// Get filename from path
var fileName = Path.GetFileName("/users/alice/documents/report.pdf");
Console.WriteLine($"Filename: {fileName}");

// Get extension
var extension = Path.GetExtension("photo.jpg");
Console.WriteLine($"Extension: {extension}");

// Get folder part
var folder = Path.GetDirectoryName("/users/alice/documents/report.pdf");
Console.WriteLine($"Directory: {folder}");


// --- Cleanup ---
Console.WriteLine("\n=== Cleanup ===\n");
File.Delete("hello.txt");
File.Delete("lines.txt");
Directory.Delete("test-folder");
Console.WriteLine("Cleaned up test files and folders");
```

Run it:

```bash
dotnet run test-files.cs
```

**Expected output:**

```
=== Writing Files ===

Created hello.txt
Created lines.txt

=== Reading Files ===

hello.txt contains: Hello, World!
lines.txt has 3 lines:
  - Line 1
  - Line 2
  - Line 3

=== Checking Existence ===

hello.txt exists: True
missing.txt exists: False
test-folder exists: True

=== Path Operations ===

Combined path: folder/subfolder/file.txt
Filename: report.pdf
Extension: .jpg
Directory: /users/alice/documents

=== Cleanup ===

Cleaned up test files and folders
```

**Clean up:**

```bash
rm test-files.cs
```

---

## Exercise 8.4 — String operations and StringBuilder

**Task:** Practice common string operations.

**Solution**

Create `test-strings.cs`:

```csharp
#!/usr/bin/env dotnet

using System.Text;  // Needed for StringBuilder

// --- Part 1: Common string operations ---
Console.WriteLine("=== String Operations ===\n");

var text = "  Hello, World!  ";

Console.WriteLine($"Original: '{text}'");
Console.WriteLine($"Trim (remove spaces): '{text.Trim()}'");
Console.WriteLine($"ToLower: '{text.ToLower()}'");
Console.WriteLine($"ToUpper: '{text.ToUpper()}'");
Console.WriteLine($"Replace 'World' with 'C#': '{text.Replace("World", "C#")}'");
Console.WriteLine($"Contains 'World': {text.Contains("World")}");
Console.WriteLine($"StartsWith '  Hello': {text.StartsWith("  Hello")}");
Console.WriteLine($"IndexOf 'World': {text.IndexOf("World")}");


// --- Part 2: Split and Join ---
Console.WriteLine("\n=== Split and Join ===\n");

var csv = "apple,banana,cherry";
var fruits = csv.Split(',');
Console.WriteLine($"Split '{csv}' by comma:");
foreach (var fruit in fruits)
{
    Console.WriteLine($"  - {fruit}");
}

var joined = string.Join(" | ", fruits);
Console.WriteLine($"Joined with ' | ': {joined}");


// --- Part 3: String interpolation ---
Console.WriteLine("\n=== String Interpolation ===\n");

var name = "Alice";
var balance = 1234.567m;

// Basic interpolation
Console.WriteLine($"Hello, {name}!");

// With expressions
Console.WriteLine($"Next year you'll be... wait, we don't have age.");

// Formatting numbers
Console.WriteLine($"Balance: {balance:N2}");      // 1,234.57 (number with 2 decimals)
Console.WriteLine($"Balance: {balance:C}");       // $1,234.57 (currency)
Console.WriteLine($"Balance: {balance:F4}");      // 1234.5670 (fixed 4 decimals)


// --- Part 4: StringBuilder for building long strings ---
Console.WriteLine("\n=== StringBuilder ===\n");

// Bad way: concatenation in a loop (slow, creates many strings)
var badResult = "";
for (int i = 0; i < 5; i++)
{
    badResult += $"Line {i}\n";  // Creates a new string each time!
}
Console.WriteLine("Concatenation result:");
Console.WriteLine(badResult);

// Good way: StringBuilder (fast, reuses one buffer)
var sb = new StringBuilder();
for (int i = 0; i < 5; i++)
{
    sb.AppendLine($"Line {i}");  // Appends to same buffer
}
var goodResult = sb.ToString();  // Convert to string at the end
Console.WriteLine("StringBuilder result:");
Console.WriteLine(goodResult);

Console.WriteLine("(Results are the same, but StringBuilder is faster for large strings)");
```

Run it:

```bash
dotnet run test-strings.cs
```

**Key points:**

| Format | Example | Output |
|--------|---------|--------|
| `{value:N2}` | `{1234.5:N2}` | 1,234.50 (number with commas) |
| `{value:C}` | `{1234.5:C}` | $1,234.50 (currency) |
| `{value:F2}` | `{1234.5:F2}` | 1234.50 (fixed decimals) |
| `{date:yyyy-MM-dd}` | `{DateTime.Now:yyyy-MM-dd}` | 2024-12-25 |

**Clean up:**

```bash
rm test-strings.cs
```

---

## Exercise 8.5 — DateTime operations

**Task:** Practice working with dates and times.

**Solution**

Create `test-datetime.cs`:

```csharp
#!/usr/bin/env dotnet

// --- Part 1: Creating dates ---
Console.WriteLine("=== Creating Dates ===\n");

// Current date/time
var now = DateTime.Now;
var utcNow = DateTime.UtcNow;
var today = DateTime.Today;  // Today at midnight

Console.WriteLine($"Now (local time): {now}");
Console.WriteLine($"Now (UTC time):   {utcNow}");
Console.WriteLine($"Today:            {today}");

// Specific date
var birthday = new DateTime(1990, 5, 15);  // May 15, 1990
var withTime = new DateTime(1990, 5, 15, 14, 30, 0);  // 2:30 PM
Console.WriteLine($"\nBirthday:   {birthday}");
Console.WriteLine($"With time:  {withTime}");


// --- Part 2: Formatting dates ---
Console.WriteLine("\n=== Formatting Dates ===\n");

var date = new DateTime(2024, 12, 25, 14, 30, 45);

Console.WriteLine($"Default:     {date}");
Console.WriteLine($"yyyy-MM-dd:  {date:yyyy-MM-dd}");
Console.WriteLine($"dd/MM/yyyy:  {date:dd/MM/yyyy}");
Console.WriteLine($"Long date:   {date:MMMM d, yyyy}");
Console.WriteLine($"Time only:   {date:HH:mm:ss}");
Console.WriteLine($"ISO format:  {date:o}");


// --- Part 3: Parsing dates (converting text to date) ---
Console.WriteLine("\n=== Parsing Dates ===\n");

var dateText = "2024-12-25";
var parsed = DateTime.Parse(dateText);
Console.WriteLine($"Parsed '{dateText}': {parsed}");

// Safe parsing (doesn't crash if invalid)
if (DateTime.TryParse("not a date", out var result))
{
    Console.WriteLine($"Parsed successfully: {result}");
}
else
{
    Console.WriteLine("'not a date' could not be parsed");
}


// --- Part 4: Date math ---
Console.WriteLine("\n=== Date Math ===\n");

var startDate = DateTime.Today;
Console.WriteLine($"Today:      {startDate:yyyy-MM-dd}");
Console.WriteLine($"Tomorrow:   {startDate.AddDays(1):yyyy-MM-dd}");
Console.WriteLine($"Next week:  {startDate.AddDays(7):yyyy-MM-dd}");
Console.WriteLine($"Next month: {startDate.AddMonths(1):yyyy-MM-dd}");
Console.WriteLine($"Next year:  {startDate.AddYears(1):yyyy-MM-dd}");

// Difference between dates
var futureDate = startDate.AddDays(30);
var difference = futureDate - startDate;  // Returns a TimeSpan
Console.WriteLine($"\nDays until {futureDate:yyyy-MM-dd}: {difference.TotalDays}");


// --- Part 5: UTC vs Local ---
Console.WriteLine("\n=== UTC vs Local ===\n");

var utc = DateTime.UtcNow;
var local = utc.ToLocalTime();

Console.WriteLine($"UTC time:   {utc}");
Console.WriteLine($"Local time: {local}");
Console.WriteLine($"Difference: {(local - utc).TotalHours} hours");

Console.WriteLine("\n💡 Tip: Always store dates in UTC, convert to local only for display.");
```

Run it:

```bash
dotnet run test-datetime.cs
```

**Common date format codes:**

| Code | Meaning | Example |
|------|---------|---------|
| `yyyy` | 4-digit year | 2024 |
| `MM` | 2-digit month | 12 |
| `dd` | 2-digit day | 25 |
| `HH` | 24-hour hour | 14 |
| `mm` | Minutes | 30 |
| `ss` | Seconds | 45 |
| `MMMM` | Full month name | December |
| `ddd` | Short day name | Wed |

**Clean up:**

```bash
rm test-datetime.cs
```

---

## Exercise 8.6 — Collections (List, Dictionary, HashSet)

**Task:** Practice using collections.

**Solution**

Create `test-collections.cs`:

```csharp
#!/usr/bin/env dotnet

// --- Part 1: List<T> (like JavaScript Array) ---
Console.WriteLine("=== List<T> ===\n");

var names = new List<string> { "Alice", "Bob", "Charlie" };
Console.WriteLine($"Initial: [{string.Join(", ", names)}]");

// Add items
names.Add("Diana");
Console.WriteLine($"After Add: [{string.Join(", ", names)}]");

// Access by index
Console.WriteLine($"First item: {names[0]}");
Console.WriteLine($"Last item: {names[^1]}");  // ^1 means "from the end"

// Check if contains
Console.WriteLine($"Contains 'Bob': {names.Contains("Bob")}");

// Find items
var startsWithC = names.Find(n => n.StartsWith("C"));
Console.WriteLine($"First name starting with C: {startsWithC}");

// Remove items
names.Remove("Bob");
Console.WriteLine($"After Remove: [{string.Join(", ", names)}]");

// Count
Console.WriteLine($"Count: {names.Count}");


// --- Part 2: Dictionary<K, V> (like JavaScript Map or object) ---
Console.WriteLine("\n=== Dictionary<K, V> ===\n");

var ages = new Dictionary<string, int>
{
    ["Alice"] = 30,
    ["Bob"] = 25
};

Console.WriteLine("Initial:");
foreach (var pair in ages)
{
    Console.WriteLine($"  {pair.Key}: {pair.Value}");
}

// Add or update
ages["Charlie"] = 35;
ages["Alice"] = 31;  // Update existing
Console.WriteLine($"\nAfter updates: Alice={ages["Alice"]}, Charlie={ages["Charlie"]}");

// Safe access (TryGetValue)
if (ages.TryGetValue("Diana", out var dianaAge))
{
    Console.WriteLine($"Diana's age: {dianaAge}");
}
else
{
    Console.WriteLine("Diana not found");
}

// Check if key exists
Console.WriteLine($"Contains 'Bob': {ages.ContainsKey("Bob")}");


// --- Part 3: HashSet<T> (unique items only, like JavaScript Set) ---
Console.WriteLine("\n=== HashSet<T> ===\n");

var uniqueNames = new HashSet<string> { "Alice", "Bob" };
Console.WriteLine($"Initial: [{string.Join(", ", uniqueNames)}]");

// Add (returns false if already exists)
var added1 = uniqueNames.Add("Charlie");
var added2 = uniqueNames.Add("Alice");  // Already exists
Console.WriteLine($"Added Charlie: {added1}");
Console.WriteLine($"Added Alice again: {added2}");
Console.WriteLine($"After adds: [{string.Join(", ", uniqueNames)}]");

// Check if contains
Console.WriteLine($"Contains 'Bob': {uniqueNames.Contains("Bob")}");

// Useful for removing duplicates
var listWithDuplicates = new List<string> { "a", "b", "a", "c", "b" };
var unique = new HashSet<string>(listWithDuplicates);
Console.WriteLine($"\nDuplicates removed: [{string.Join(", ", unique)}]");
```

Run it:

```bash
dotnet run test-collections.cs
```

**Quick reference:**

| Task | List | Dictionary | HashSet |
|------|------|------------|---------|
| Add item | `list.Add(x)` | `dict[key] = value` | `set.Add(x)` |
| Get item | `list[0]` | `dict[key]` | — |
| Check exists | `list.Contains(x)` | `dict.ContainsKey(k)` | `set.Contains(x)` |
| Remove | `list.Remove(x)` | `dict.Remove(key)` | `set.Remove(x)` |
| Count | `list.Count` | `dict.Count` | `set.Count` |

**Clean up:**

```bash
rm test-collections.cs
```

---

## Exercise 8.7 — Use HttpClient in PaymentApp (optional)

If you want to practice `HttpClient` in a real context, here's how to add it to PaymentApp. This prepares us for Topic 10 where we'll call an external payment processor.

**Task:** Create a simple client wrapper for calling external APIs.

**Solution**

Create `src/PaymentApp.Infrastructure/Clients/ExternalApiClient.cs`:

```csharp
using System.Text.Json;

namespace PaymentApp.Infrastructure.Clients;

/// <summary>
/// A simple wrapper for calling external APIs.
/// This shows how to use IHttpClientFactory properly.
/// </summary>
public class ExternalApiClient
{
    private readonly HttpClient _client;
    private readonly JsonSerializerOptions _jsonOptions;

    public ExternalApiClient(IHttpClientFactory factory)
    {
        _client = factory.CreateClient();
        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        };
    }

    public async Task<T?> GetAsync<T>(string url)
    {
        var response = await _client.GetAsync(url);
        response.EnsureSuccessStatusCode();  // Throws if status is not 2xx

        var json = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<T>(json, _jsonOptions);
    }

    public async Task<TResponse?> PostAsync<TRequest, TResponse>(string url, TRequest data)
    {
        var response = await _client.PostAsJsonAsync(url, data);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<TResponse>(json, _jsonOptions);
    }
}
```

Register in `Program.cs`:

```csharp
// Add HttpClient factory
builder.Services.AddHttpClient();

// Register our client
builder.Services.AddScoped<ExternalApiClient>();
```

This is a simple example. In Topic 10, we'll create a more complete client for the payment processor.

---

## What we learned

| Tool | Purpose | Node.js equivalent |
|------|---------|-------------------|
| `HttpClient` | Make HTTP requests | `fetch` or `axios` |
| `System.Text.Json` | Parse and create JSON | `JSON.parse` / `JSON.stringify` |
| `File` class | Read and write files | `fs` module |
| `Path` class | Work with file paths | `path` module |
| `StringBuilder` | Build long strings efficiently | — |
| `DateTime` | Work with dates and times | `Date` |
| `List<T>` | Ordered collection | `Array` |
| `Dictionary<K,V>` | Key-value pairs | `Map` or object |
| `HashSet<T>` | Unique items | `Set` |

---

## Interview talking points

- "I use `IHttpClientFactory` instead of `new HttpClient()` to avoid socket exhaustion (running out of network connections)."
- "`System.Text.Json` is the built-in JSON library. It's faster than Newtonsoft.Json for most use cases."
- "For small files, I use `File.ReadAllTextAsync()`. For large files, I use streams to avoid loading everything into memory."
- "`StringBuilder` is important when building strings in loops — each `+` creates a new string, which is slow."
- "I store all dates in UTC and only convert to local time when displaying to users."

---

## Next: Topic 9

In Topic 9, we add authentication (login and registration that returns JWT tokens) to PaymentApp and protect the transfer and document endpoints.
