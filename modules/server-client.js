// modules/server-client.js
// Client for communicating with input_server.exe (local HTTP server).
// Handles health checks and sending action sequences.
//
// Interface: createServerClient() → { checkHealth, sendActions, pasteAndSubmit, isAvailable }

const SERVER_URL = 'http://127.0.0.1:12306';

export function createServerClient() {
  let _available = false;
  let _checked = false;

  async function checkHealth() {
    try {
      const resp = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (!resp.ok) { _available = false; return false; }
      const data = await resp.json();
      _available = data.ok === true;
      _checked = true;
      return _available;
    } catch {
      _available = false;
      _checked = true;
      return false;
    }
  }

  async function sendActions(actions) {
    if (!_available && !_checked) {
      await checkHealth();
    }
    if (!_available) return { ok: false, error: 'server unavailable' };

    try {
      const resp = await fetch(`${SERVER_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
        signal: AbortSignal.timeout(5000),
      });
      return await resp.json();
    } catch (err) {
      _available = false; // mark unavailable so next call re-checks
      return { ok: false, error: err.message };
    }
  }

  async function pasteAndSubmit() {
    return sendActions([
      { type: 'key', key: 'V', modifiers: ['Ctrl'] },
      { type: 'wait', ms: 150 },
      { type: 'key', key: 'Enter' },
    ]);
  }

  function isAvailable() {
    return _available;
  }

  return { checkHealth, sendActions, pasteAndSubmit, isAvailable };
}
