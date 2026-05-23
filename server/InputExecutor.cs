using System.Diagnostics;

namespace InputServer;

static class InputExecutor
{
    public static async Task<ExecuteResponse> ExecuteAsync(ExecuteRequest req, CancellationToken ct = default)
    {
        try
        {
            var idx = 0;
            var total = req.Actions.Length;
            foreach (var action in req.Actions)
            {
                idx++;
                var asw = Stopwatch.StartNew();

                switch (action.Type)
                {
                    case "key":
                        NativeMethods.SendKeyCombo(action);
                        asw.Stop();
                        Console.WriteLine($"  [{idx}/{total}] key {KeyDesc(action)} → ok ({asw.ElapsedMilliseconds}ms)");
                        break;

                    case "type":
                        if (action.Text == null)
                        {
                            Console.WriteLine($"  [{idx}/{total}] type <null> → skipped");
                            break;
                        }
                        foreach (char c in action.Text)
                        {
                            NativeMethods.SendUnicodeChar(c);
                        }
                        asw.Stop();
                        Console.WriteLine($"  [{idx}/{total}] type \"{Truncate(action.Text)}\" → ok ({asw.ElapsedMilliseconds}ms)");
                        break;

                    case "click":
                        NativeMethods.SendMouseClick(action.X, action.Y);
                        asw.Stop();
                        Console.WriteLine($"  [{idx}/{total}] click ({action.X},{action.Y}) → ok ({asw.ElapsedMilliseconds}ms)");
                        break;

                    case "wait":
                        await Task.Delay(action.Ms > 0 ? action.Ms : 0, ct);
                        asw.Stop();
                        Console.WriteLine($"  [{idx}/{total}] wait {action.Ms}ms → ok ({asw.ElapsedMilliseconds}ms)");
                        break;

                    default:
                        Console.WriteLine($"  [{idx}/{total}] {action.Type} → unknown type");
                        return new ExecuteResponse(false, $"Unknown action type: {action.Type}");
                }
            }
            return new ExecuteResponse(true);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  → exception: {ex.Message}");
            return new ExecuteResponse(false, ex.Message);
        }
    }

    static string KeyDesc(InputCommand action)
    {
        var mods = action.Modifiers is { Length: > 0 } ? string.Join("+", action.Modifiers) + "+" : "";
        return mods + action.Key;
    }

    static string Truncate(string s, int max = 40)
    {
        if (s.Length <= max) return s;
        return s[..max] + "...";
    }
}
