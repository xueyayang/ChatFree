using System.Runtime.InteropServices;

namespace InputServer;

static class NativeMethods
{
    // ── Structs ──────────────────────────────────────────
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUT
    {
        [FieldOffset(0)] public uint type;
        [FieldOffset(4)] public MOUSEINPUT mi;
        [FieldOffset(4)] public KEYBDINPUT ki;
    }

    // ── Constants ────────────────────────────────────────
    const uint INPUT_MOUSE    = 0;
    const uint INPUT_KEYBOARD = 1;

    const uint KEYEVENTF_KEYUP   = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP   = 0x0004;

    // ── Virtual Key Codes ────────────────────────────────
    const ushort VK_LSHIFT   = 0xA0;
    const ushort VK_LCONTROL = 0xA2;
    const ushort VK_LMENU    = 0xA4;
    const ushort VK_LWIN     = 0x5B;

    static readonly Dictionary<string, ushort> KeyToVk = new()
    {
        ["Enter"]  = 0x0D,
        ["Tab"]    = 0x09,
        ["Escape"] = 0x1B,
        ["Space"]  = 0x20,
        ["Backspace"] = 0x08,
        ["Delete"]  = 0x2E,
        ["Home"]    = 0x24,
        ["End"]     = 0x23,
        ["PageUp"]  = 0x21,
        ["PageDown"] = 0x22,
        ["Up"]      = 0x26,
        ["Down"]    = 0x28,
        ["Left"]    = 0x25,
        ["Right"]   = 0x27,

        // Letters
        ["A"]=0x41,["B"]=0x42,["C"]=0x43,["D"]=0x44,["E"]=0x45,
        ["F"]=0x46,["G"]=0x47,["H"]=0x48,["I"]=0x49,["J"]=0x4A,
        ["K"]=0x4B,["L"]=0x4C,["M"]=0x4D,["N"]=0x4E,["O"]=0x4F,
        ["P"]=0x50,["Q"]=0x51,["R"]=0x52,["S"]=0x53,["T"]=0x54,
        ["U"]=0x55,["V"]=0x56,["W"]=0x57,["X"]=0x58,["Y"]=0x59,
        ["Z"]=0x5A,

        // Digits
        ["0"]=0x30,["1"]=0x31,["2"]=0x32,["3"]=0x33,["4"]=0x34,
        ["5"]=0x35,["6"]=0x36,["7"]=0x37,["8"]=0x38,["9"]=0x39,

        // F-keys
        ["F1"]=0x70,["F2"]=0x71,["F3"]=0x72,["F4"]=0x73,["F5"]=0x74,
        ["F6"]=0x75,["F7"]=0x76,["F8"]=0x77,["F9"]=0x78,["F10"]=0x79,
        ["F11"]=0x7A,["F12"]=0x7B,
    };

    static readonly Dictionary<string, ushort> ModifierToVk = new()
    {
        ["Ctrl"]  = VK_LCONTROL,
        ["Alt"]   = VK_LMENU,
        ["Shift"] = VK_LSHIFT,
        ["Win"]   = VK_LWIN,
    };

    // ── P/Invoke ─────────────────────────────────────────
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint cInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int x, int y);

    // ── Public helpers ───────────────────────────────────
    public static ushort GetVk(string key)
    {
        if (key.Length == 1)
        {
            char c = key[0];
            if (c >= 'a' && c <= 'z') return (ushort)(c - 32); // 'a'..'z' → 'A'..'Z' VK
            if (c >= 'A' && c <= 'Z') return (ushort)c;
            if (c >= '0' && c <= '9') return (ushort)c;
        }
        if (KeyToVk.TryGetValue(key, out var vk)) return vk;
        throw new ArgumentException($"Unknown key: {key}");
    }

    public static ushort GetModifierVk(string mod)
    {
        if (ModifierToVk.TryGetValue(mod, out var vk)) return vk;
        throw new ArgumentException($"Unknown modifier: {mod}");
    }

    public static void SendKeyCombo(InputCommand cmd)
    {
        string[] mods = cmd.Modifiers ?? Array.Empty<string>();
        ushort keyVk = GetVk(cmd.Key!);

        int count = mods.Length * 2 + 2; // each mod: down + up; key: down + up
        var inputs = new INPUT[count];
        int i = 0;

        // Modifier keys down
        foreach (var mod in mods)
        {
            inputs[i++] = MakeKbInput(GetModifierVk(mod), 0);
        }
        // Main key down
        inputs[i++] = MakeKbInput(keyVk, 0);
        // Main key up
        inputs[i++] = MakeKbInput(keyVk, KEYEVENTF_KEYUP);
        // Modifier keys up (reverse order)
        for (int j = mods.Length - 1; j >= 0; j--)
        {
            inputs[i++] = MakeKbInput(GetModifierVk(mods[j]), KEYEVENTF_KEYUP);
        }

        uint result = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        if (result != inputs.Length)
            throw new InvalidOperationException($"SendInput failed: sent {result}/{inputs.Length}");
    }

    public static void SendUnicodeChar(char c)
    {
        var inputs = new INPUT[2];
        inputs[0] = MakeUnicodeInput(c, 0);
        inputs[1] = MakeUnicodeInput(c, KEYEVENTF_KEYUP);

        uint result = SendInput(2, inputs, Marshal.SizeOf<INPUT>());
        if (result != 2)
            throw new InvalidOperationException($"SendInput unicode failed for U+{(int)c:X4}");
    }

    public static void SendMouseClick(int x, int y)
    {
        SetCursorPos(x, y);

        var inputs = new INPUT[2];
        inputs[0] = MakeMouseInput(MOUSEEVENTF_LEFTDOWN);
        inputs[1] = MakeMouseInput(MOUSEEVENTF_LEFTUP);

        uint result = SendInput(2, inputs, Marshal.SizeOf<INPUT>());
        if (result != 2)
            throw new InvalidOperationException($"SendInput mouse click failed");
    }

    // ── Private helpers ──────────────────────────────────
    static INPUT MakeKbInput(ushort vk, uint flags) => new()
    {
        type = INPUT_KEYBOARD,
        ki = new KEYBDINPUT { wVk = vk, dwFlags = flags }
    };

    static INPUT MakeUnicodeInput(char c, uint flags) => new()
    {
        type = INPUT_KEYBOARD,
        ki = new KEYBDINPUT { wScan = c, dwFlags = KEYEVENTF_UNICODE | flags }
    };

    static INPUT MakeMouseInput(uint flags) => new()
    {
        type = INPUT_MOUSE,
        mi = new MOUSEINPUT { dwFlags = flags }
    };
}
