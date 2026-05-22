using System.Text.Json;
using InputServer;

var builder = WebApplication.CreateSlimBuilder(args);
builder.WebHost.UseKestrel(o => o.ListenLocalhost(12306));

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default);
});

var app = builder.Build();

app.MapGet("/health", () =>
{
    return new ExecuteResponse(true) { Version = "0.1.0" };
});

app.MapPost("/execute", async (HttpContext ctx) =>
{
    var req = await JsonSerializer.DeserializeAsync(
        ctx.Request.Body,
        AppJsonContext.Default.ExecuteRequest,
        ctx.RequestAborted);

    if (req == null || req.Actions == null || req.Actions.Length == 0)
    {
        ctx.Response.StatusCode = 400;
        ctx.Response.ContentType = "application/json";
        await JsonSerializer.SerializeAsync(
            ctx.Response.Body,
            new ExecuteResponse(false, "Missing or empty actions array"),
            AppJsonContext.Default.ExecuteResponse,
            ctx.RequestAborted);
        return;
    }

    var result = await InputExecutor.ExecuteAsync(req, ctx.RequestAborted);
    ctx.Response.ContentType = "application/json";
    await JsonSerializer.SerializeAsync(
        ctx.Response.Body,
        result,
        AppJsonContext.Default.ExecuteResponse,
        ctx.RequestAborted);
});

Console.WriteLine("Input Server listening on http://127.0.0.1:12306");
app.Run();
