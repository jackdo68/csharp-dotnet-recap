# Topic 8: .NET Standard Library

> **What common tools does .NET give me for everyday tasks like HTTP calls, JSON, files, and text?**

Every programming platform comes with built-in tools for common tasks. In Node.js, you have `fs` for files, `fetch` for HTTP, and `JSON.parse` for JSON. .NET has its own set of built-in tools. This topic covers the ones you'll use most often.

---

## The big picture

| Task | Node.js | .NET |
|------|---------|------|
| HTTP calls | `fetch` or `axios` | `HttpClient` |
| JSON | `JSON.parse` / `JSON.stringify` | `System.Text.Json` |
| Read/write files | `fs.readFile` / `fs.writeFile` | `File.ReadAllText` / `File.WriteAllText` |
| Work with text | `string` methods | `string` methods + `StringBuilder` |
| Date and time | `Date` | `DateTime` and `DateTimeOffset` |
| Collections (lists, dictionaries) | `Array`, `Map`, `Set` | `List<T>`, `Dictionary<K,V>`, `HashSet<T>` |
| Streams (reading/writing data in chunks) | `Readable`, `Writable` | `Stream` |

---

## HttpClient — making HTTP calls

In Node.js, you use `fetch` or libraries like `axios`. In .NET, you use `HttpClient`.

### Basic usage

```csharp
// Create an HttpClient (a tool for making HTTP requests)
var client = new HttpClient();

// Make a GET request (fetch data from a URL)
var response = await client.GetAsync("https://api.example.com/users");

// Read the response body as text
var json = await response.Content.ReadAsStringAsync();

Console.WriteLine(json);
```

### The problem with `new HttpClient()`

**Don't create a new `HttpClient` for each request.** This causes a problem called "socket exhaustion" (your computer runs out of network connections).

```csharp
// ❌ BAD — creates too many connections
foreach (var url in urls)
{
    using var client = new HttpClient();  // Don't do this!
    var response = await client.GetAsync(url);
}

// ✅ GOOD — reuse one client
var client = new HttpClient();
foreach (var url in urls)
{
    var response = await client.GetAsync(url);
}
```

### The right way: IHttpClientFactory

In a web application, use `IHttpClientFactory` (a tool that creates and manages HttpClient instances for you):

```csharp
// In Program.cs — register the factory
builder.Services.AddHttpClient();

// In your service — inject the factory
public class MyService
{
    private readonly HttpClient _client;

    public MyService(IHttpClientFactory factory)
    {
        _client = factory.CreateClient();
    }

    public async Task<string> FetchDataAsync(string url)
    {
        var response = await _client.GetAsync(url);
        return await response.Content.ReadAsStringAsync();
    }
}
```

### Named clients (pre-configured HttpClient)

You can create named clients with settings already configured:

```csharp
// In Program.cs — create a named client called "github"
builder.Services.AddHttpClient("github", client =>
{
    client.BaseAddress = new Uri("https://api.github.com/");
    client.DefaultRequestHeaders.Add("User-Agent", "MyApp");
});

// In your service — get the pre-configured client by name
public class GitHubService
{
    private readonly HttpClient _client;

    public GitHubService(IHttpClientFactory factory)
    {
        _client = factory.CreateClient("github");
    }

    public async Task<string> GetReposAsync(string username)
    {
        // No need to specify the base URL — it's already set
        return await _client.GetStringAsync($"users/{username}/repos");
    }
}
```

### Comparison with Node.js

| Node.js | .NET |
|---------|------|
| `await fetch(url)` | `await client.GetAsync(url)` |
| `response.json()` | `await response.Content.ReadAsStringAsync()` then parse |
| `fetch(url, { method: 'POST', body: JSON.stringify(data) })` | `await client.PostAsJsonAsync(url, data)` |

---

## System.Text.Json — working with JSON

In Node.js, you use `JSON.parse()` and `JSON.stringify()`. In .NET, you use `System.Text.Json`.

### Parse JSON string to object

```csharp
using System.Text.Json;

// JSON string
var json = """{"name":"Alice","age":30}""";

// Parse to a C# object
var user = JsonSerializer.Deserialize<User>(json);
// "Deserialize" means "convert from JSON text to a C# object"

Console.WriteLine(user.Name);  // Alice
```

### Convert object to JSON string

```csharp
var user = new User { Name = "Bob", Age = 25 };

// Convert to JSON string
var json = JsonSerializer.Serialize(user);
// "Serialize" means "convert from a C# object to JSON text"

Console.WriteLine(json);  // {"Name":"Bob","Age":25}
```

### Customize JSON output

```csharp
var options = new JsonSerializerOptions
{
    // Use camelCase (like JavaScript) instead of PascalCase
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,

    // Pretty print (add spaces and newlines)
    WriteIndented = true
};

var json = JsonSerializer.Serialize(user, options);
// {"name":"Bob","age":25}  — notice lowercase "name" and "age"
```

### Handle different property names

When the JSON uses different names than your C# class:

```csharp
public class User
{
    // The JSON has "user_name" but we want to call it "Name" in C#
    [JsonPropertyName("user_name")]
    public string Name { get; set; }

    // The JSON has "created_at" but we want to call it "CreatedAt" in C#
    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; }
}
```

### Comparison with Node.js

| Node.js | .NET |
|---------|------|
| `JSON.parse(text)` | `JsonSerializer.Deserialize<T>(text)` |
| `JSON.stringify(obj)` | `JsonSerializer.Serialize(obj)` |
| No type safety | Type-safe (you specify the target type `<T>`) |

---

## File operations — reading and writing files

In Node.js, you use the `fs` module. In .NET, you use the `System.IO` namespace (a collection of file-related tools).

### Read a file

```csharp
// Read entire file as a string
var content = await File.ReadAllTextAsync("data.txt");

// Read file as lines (returns an array of strings)
var lines = await File.ReadAllLinesAsync("data.txt");

// Read file as bytes (raw data)
var bytes = await File.ReadAllBytesAsync("image.png");
```

### Write a file

```csharp
// Write a string to a file (creates or overwrites)
await File.WriteAllTextAsync("output.txt", "Hello, World!");

// Write lines to a file
var lines = new[] { "Line 1", "Line 2", "Line 3" };
await File.WriteAllLinesAsync("output.txt", lines);

// Write bytes to a file
await File.WriteAllBytesAsync("output.bin", byteArray);
```

### Check if file/folder exists

```csharp
// Check if a file exists
if (File.Exists("config.json"))
{
    var config = await File.ReadAllTextAsync("config.json");
}

// Check if a folder exists
if (Directory.Exists("uploads"))
{
    // folder exists
}

// Create a folder (does nothing if it already exists)
Directory.CreateDirectory("uploads");
```

### Work with file paths

```csharp
// Combine path parts (handles / or \ automatically)
var path = Path.Combine("uploads", "user123", "photo.jpg");
// Result: "uploads/user123/photo.jpg" (on Mac/Linux)
// Result: "uploads\\user123\\photo.jpg" (on Windows)

// Get just the filename
var name = Path.GetFileName("/path/to/file.txt");  // "file.txt"

// Get the file extension
var ext = Path.GetExtension("photo.jpg");  // ".jpg"

// Get the folder part
var dir = Path.GetDirectoryName("/path/to/file.txt");  // "/path/to"
```

### Comparison with Node.js

| Node.js | .NET |
|---------|------|
| `await fs.readFile('file.txt', 'utf8')` | `await File.ReadAllTextAsync("file.txt")` |
| `await fs.writeFile('file.txt', data)` | `await File.WriteAllTextAsync("file.txt", data)` |
| `fs.existsSync('file.txt')` | `File.Exists("file.txt")` |
| `path.join('a', 'b', 'c')` | `Path.Combine("a", "b", "c")` |
| `path.basename('/path/file.txt')` | `Path.GetFileName("/path/file.txt")` |

---

## Strings and StringBuilder

C# strings work mostly like JavaScript strings. They are immutable (unchangeable) — when you "modify" a string, you're actually creating a new one.

### Common string operations

```csharp
var text = "  Hello, World!  ";

// Remove spaces from start and end
text.Trim();                    // "Hello, World!"

// Convert case
text.ToLower();                 // "  hello, world!  "
text.ToUpper();                 // "  HELLO, WORLD!  "

// Check content
text.Contains("World");         // true
text.StartsWith("  Hello");     // true
text.EndsWith("!  ");           // true

// Find position (returns -1 if not found)
text.IndexOf("World");          // 9

// Replace text
text.Replace("World", "C#");    // "  Hello, C#!  "

// Split into array
"a,b,c".Split(',');             // ["a", "b", "c"]

// Join array into string
string.Join("-", new[] {"a", "b", "c"});  // "a-b-c"
```

### String interpolation (inserting values into strings)

```csharp
var name = "Alice";
var age = 30;

// Use $ before the string to enable interpolation
var message = $"Hello, {name}! You are {age} years old.";
// "Hello, Alice! You are 30 years old."

// You can include expressions
var message2 = $"Next year you'll be {age + 1}.";
// "Next year you'll be 31."
```

### StringBuilder — for building long strings

When you need to build a string by appending many pieces, use `StringBuilder`. It's much faster than using `+` repeatedly.

```csharp
// ❌ SLOW — creates a new string each time
var result = "";
for (int i = 0; i < 1000; i++)
{
    result += $"Line {i}\n";  // Creates 1000 strings!
}

// ✅ FAST — uses one StringBuilder
var sb = new StringBuilder();
for (int i = 0; i < 1000; i++)
{
    sb.AppendLine($"Line {i}");  // Appends to same buffer
}
var result = sb.ToString();  // Convert to string at the end
```

### Comparison with Node.js

| Node.js | .NET |
|---------|------|
| `str.trim()` | `str.Trim()` |
| `str.toLowerCase()` | `str.ToLower()` |
| `str.includes("x")` | `str.Contains("x")` |
| `str.split(",")` | `str.Split(',')` |
| `arr.join("-")` | `string.Join("-", arr)` |
| `` `Hello ${name}` `` | `$"Hello {name}"` |

---

## DateTime — working with dates and times

In Node.js, you use `Date`. In .NET, you use `DateTime` or `DateTimeOffset`.

### Create dates

```csharp
// Current date and time
var now = DateTime.Now;           // Local time (your computer's timezone)
var utcNow = DateTime.UtcNow;     // UTC time (no timezone)

// Specific date
var birthday = new DateTime(1990, 5, 15);           // May 15, 1990
var withTime = new DateTime(1990, 5, 15, 14, 30, 0); // 2:30 PM
```

### Format dates

```csharp
var date = new DateTime(2024, 12, 25, 14, 30, 0);

date.ToString("yyyy-MM-dd");           // "2024-12-25"
date.ToString("dd/MM/yyyy");           // "25/12/2024"
date.ToString("MMMM d, yyyy");         // "December 25, 2024"
date.ToString("HH:mm:ss");             // "14:30:00"
date.ToString("yyyy-MM-ddTHH:mm:ssZ"); // "2024-12-25T14:30:00Z" (ISO format)
```

### Parse dates from strings

```csharp
// Parse a date string
var date = DateTime.Parse("2024-12-25");

// Try to parse (returns false if invalid, doesn't crash)
if (DateTime.TryParse("not a date", out var result))
{
    Console.WriteLine(result);
}
else
{
    Console.WriteLine("Invalid date");
}
```

### Date math

```csharp
var today = DateTime.Today;  // Today at midnight

// Add time
var tomorrow = today.AddDays(1);
var nextWeek = today.AddDays(7);
var nextMonth = today.AddMonths(1);
var nextYear = today.AddYears(1);
var laterToday = today.AddHours(5).AddMinutes(30);

// Difference between dates
var diff = nextWeek - today;  // Returns a TimeSpan
Console.WriteLine(diff.TotalDays);  // 7
```

### UTC vs Local time

Always store dates in UTC (a universal time standard) and convert to local time for display:

```csharp
// Store in UTC
var storedAt = DateTime.UtcNow;

// Convert to local for display
var localTime = storedAt.ToLocalTime();
```

### Comparison with Node.js

| Node.js | .NET |
|---------|------|
| `new Date()` | `DateTime.Now` or `DateTime.UtcNow` |
| `date.toISOString()` | `date.ToString("o")` or `date.ToString("yyyy-MM-ddTHH:mm:ssZ")` |
| `date.getTime()` (milliseconds) | `date.Ticks` (100-nanosecond intervals) |
| `Date.parse("2024-01-01")` | `DateTime.Parse("2024-01-01")` |

---

## Collections — Lists, Dictionaries, Sets

.NET has generic collections (collections where you specify the type of items they hold).

### List<T> — like JavaScript Array

```csharp
// Create a list of strings
var names = new List<string> { "Alice", "Bob", "Charlie" };

// Add items
names.Add("Diana");

// Access by index
var first = names[0];  // "Alice"

// Check if contains
names.Contains("Bob");  // true

// Find items
var found = names.Find(n => n.StartsWith("C"));  // "Charlie"

// Remove items
names.Remove("Bob");

// Loop through
foreach (var name in names)
{
    Console.WriteLine(name);
}

// Get count
var count = names.Count;  // 3
```

### Dictionary<K, V> — like JavaScript Map or object

```csharp
// Create a dictionary (key-value pairs)
var ages = new Dictionary<string, int>
{
    ["Alice"] = 30,
    ["Bob"] = 25
};

// Add or update
ages["Charlie"] = 35;

// Get value
var aliceAge = ages["Alice"];  // 30

// Check if key exists (safer)
if (ages.TryGetValue("Diana", out var dianaAge))
{
    Console.WriteLine(dianaAge);
}
else
{
    Console.WriteLine("Diana not found");
}

// Check if key exists
ages.ContainsKey("Bob");  // true

// Loop through
foreach (var pair in ages)
{
    Console.WriteLine($"{pair.Key} is {pair.Value} years old");
}
```

### HashSet<T> — unique items only (like JavaScript Set)

```csharp
// Create a set (no duplicates allowed)
var uniqueNames = new HashSet<string> { "Alice", "Bob" };

// Add (returns false if already exists)
uniqueNames.Add("Charlie");  // true (added)
uniqueNames.Add("Alice");    // false (already exists)

// Check if contains
uniqueNames.Contains("Bob");  // true

// Count
var count = uniqueNames.Count;  // 3
```

### Comparison with Node.js

| Node.js | .NET |
|---------|------|
| `const arr = []` | `var list = new List<T>()` |
| `arr.push(x)` | `list.Add(x)` |
| `arr.length` | `list.Count` |
| `arr.includes(x)` | `list.Contains(x)` |
| `new Map()` | `new Dictionary<K, V>()` |
| `map.get(key)` | `dict[key]` or `dict.TryGetValue(key, out var val)` |
| `new Set()` | `new HashSet<T>()` |

---

## Streams — reading and writing data in chunks

Streams are for handling large data without loading everything into memory at once. Think of a stream like a water pipe — data flows through it.

### When to use streams

| Situation | Use |
|-----------|-----|
| Small file (< few MB) | `File.ReadAllTextAsync()` — simple |
| Large file (100+ MB) | Streams — read in chunks |
| Network data | Streams — data arrives over time |
| Copying files | Streams — don't load entire file into memory |

### Reading a file with streams

```csharp
// Open a file for reading
using var stream = File.OpenRead("largefile.txt");
using var reader = new StreamReader(stream);

// Read line by line (memory efficient)
string? line;
while ((line = await reader.ReadLineAsync()) != null)
{
    Console.WriteLine(line);
}
```

### Copying data between streams

```csharp
// Copy one file to another
using var source = File.OpenRead("input.txt");
using var destination = File.Create("output.txt");

await source.CopyToAsync(destination);
```

### The `using` keyword

`using` ensures the stream is closed properly when you're done, even if an error occurs:

```csharp
// This:
using var stream = File.OpenRead("file.txt");
// ... use stream ...
// Stream is automatically closed when the variable goes out of scope

// Is similar to this in JavaScript:
// try { ... } finally { stream.close(); }
```

---

## Interview talking points

- "I use `IHttpClientFactory` instead of creating `HttpClient` directly to avoid socket exhaustion (running out of network connections)."
- "`System.Text.Json` is the built-in JSON library. I use `[JsonPropertyName]` when the JSON property names don't match my C# property names."
- "For file operations, I use the async versions (`ReadAllTextAsync`, `WriteAllTextAsync`) to avoid blocking the thread."
- "`StringBuilder` is faster than string concatenation (using `+`) when building strings in a loop."
- "I always store dates in UTC and convert to local time only for display."
- "Streams are for large data. For small files, `File.ReadAllTextAsync()` is simpler."
