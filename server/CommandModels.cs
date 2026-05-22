using System.Text.Json.Serialization;

namespace InputServer;

public record InputCommand(
    string Type,
    string? Key,
    string[]? Modifiers,
    string? Text,
    int X,
    int Y,
    int Ms
);

public record ExecuteRequest(InputCommand[] Actions);

public record ExecuteResponse(bool Ok, string? Error = null)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Version { get; set; }
}

[JsonSourceGenerationOptions(PropertyNameCaseInsensitive = true)]
[JsonSerializable(typeof(ExecuteRequest))]
[JsonSerializable(typeof(ExecuteResponse))]
internal partial class AppJsonContext : JsonSerializerContext { }
