// modules/server-client.js
// Client for communicating with input_server.exe (local HTTP server).
// Requests are relayed through the background service worker because MV3
// blocks direct fetch from extension iframes to http://127.0.0.1.
//
// Interface: createServerClient() → { checkHealth, sendActions, pasteAndSubmit, isAvailable, lastDiag }

const SERVER_URL = 'http://127.0.0.1:12306';
const RELAY_TIMEOUT = 6000;

async function relayToServer(method, path, body) {
  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'server-relay',
      method,
      url: `${SERVER_URL}${path}`,
      body,
    });
    return resp;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function createServerClient() {
  let _available = false;
  let _checked = false;
  let _lastDiag = null;

  async function checkHealth() {
    const resp = await relayToServer('GET', '/health');
    if (resp?.ok) {
      try {
        const data = JSON.parse(resp.body);
        const ok = data.ok === true || data.Ok === true;
        _available = ok;
        _checked = true;
        _lastDiag = { status: resp.status, body: resp.body, ok };
        return _available;
      } catch (e) {
        _lastDiag = { body: resp.body, error: e.message };
        _available = false;
        _checked = true;
        return false;
      }
    }
    _lastDiag = resp;
    _available = false;
    _checked = true;
    return false;
  }

  async function sendActions(actions) {
    if (!_available && !_checked) {
      await checkHealth();
    }
    if (!_available) return { ok: false, error: 'server unavailable' };

    const resp = await relayToServer('POST', '/execute', JSON.stringify({ actions }));
    if (resp?.ok) {
      try {
        const data = JSON.parse(resp.body);
        _lastDiag = { status: resp.status, body: resp.body, parsed: data };
        return data;
      } catch (e) {
        _lastDiag = { body: resp.body, error: e.message };
        return { ok: false, error: e.message };
      }
    }
    _available = false;
    _lastDiag = resp;
    return { ok: false, error: resp?.error || 'relay failed' };
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

  function lastDiag() {
    return _lastDiag;
  }

  return { checkHealth, sendActions, pasteAndSubmit, isAvailable, lastDiag };
}
