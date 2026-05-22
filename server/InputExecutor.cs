namespace InputServer;

static class InputExecutor
{
    public static async Task<ExecuteResponse> ExecuteAsync(ExecuteRequest req, CancellationToken ct = default)
    {
        try
        {
            foreach (var action in req.Actions)
            {
                switch (action.Type)
                {
                    case "key":
                        NativeMethods.SendKeyCombo(action);
                        break;

                    case "type":
                        if (action.Text == null) break;
                        foreach (char c in action.Text)
                        {
                            NativeMethods.SendUnicodeChar(c);
                        }
                        break;

                    case "click":
                        NativeMethods.SendMouseClick(action.X, action.Y);
                        break;

                    case "wait":
                        await Task.Delay(action.Ms > 0 ? action.Ms : 0, ct);
                        break;

                    default:
                        return new ExecuteResponse(false, $"Unknown action type: {action.Type}");
                }
            }
            return new ExecuteResponse(true);
        }
        catch (Exception ex)
        {
            return new ExecuteResponse(false, ex.Message);
        }
    }
}
