using System.Diagnostics;
using System.Text.Json;
using InputServer;

var builder = WebApplication.CreateSlimBuilder(args);
builder.WebHost.UseKestrel(o => o.ListenLocalhost(12306));

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default);
});

var app = builder.Build();

// CORS — required for extension pages/service worker to reach localhost
app.Use(async (ctx, next) => {
    ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
    ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    if (ctx.Request.Method == "OPTIONS")
    {
        ctx.Response.StatusCode = 204;
        return;
    }
    await next();
});

app.MapGet("/health", () =>
{
    LogSep();
    Console.WriteLine("GET /health");
    var resp = new ExecuteResponse(true) { Version = "0.1.0" };
    Console.WriteLine("  → 200 ok");
    return resp;
});

app.MapPost("/execute", async (HttpContext ctx) =>
{
    var sw = Stopwatch.StartNew();
    LogSep();

    var req = await JsonSerializer.DeserializeAsync(
        ctx.Request.Body,
        AppJsonContext.Default.ExecuteRequest,
        ctx.RequestAborted);

    var count = req?.Actions?.Length ?? 0;
    Console.WriteLine($"POST /execute | {count} actions");

    if (req == null || req.Actions == null || req.Actions.Length == 0)
    {
        ctx.Response.StatusCode = 400;
        ctx.Response.ContentType = "application/json";
        await JsonSerializer.SerializeAsync(
            ctx.Response.Body,
            new ExecuteResponse(false, "Missing or empty actions array"),
            AppJsonContext.Default.ExecuteResponse,
            ctx.RequestAborted);
        Console.WriteLine("  → 400 Missing or empty actions array");
        return;
    }

    var result = await InputExecutor.ExecuteAsync(req, ctx.RequestAborted);
    ctx.Response.ContentType = "application/json";
    await JsonSerializer.SerializeAsync(
        ctx.Response.Body,
        result,
        AppJsonContext.Default.ExecuteResponse,
        ctx.RequestAborted);

    sw.Stop();
    var status = result.Ok ? "200 ok" : $"200 error: {result.Error}";
    Console.WriteLine($"  → {status} ({sw.ElapsedMilliseconds}ms)");
});

static void LogSep()
{
    Console.WriteLine($"══════ {DateTime.Now:HH:mm:ss.fff} ══════");
}

Console.WriteLine("══════ Input Server listening on http://127.0.0.1:12306 ══════");
app.Run();
