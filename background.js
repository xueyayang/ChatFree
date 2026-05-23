// background.js - ChatFree service worker
// Floating panel is auto-injected by content-ui.js on matching pages.
// Icon click toggles panel visibility on the active tab.
// Also relays HTTP requests to the local input_server.exe.

chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'toggle-panel' });
  } catch {
    // Content script not injected — ignore
  }
});

// Relay requests to the local HTTP server (input_server.exe).
// Extension pages (including iframes) can't directly fetch http://127.0.0.1
// in MV3, so we proxy through the service worker which has host_permissions.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'server-relay') return;

  // Promise-based: return a Promise to keep the channel open and resolve with the result.
  const promise = (async () => {
    try {
      const opts = {
        method: msg.method,
        headers: msg.body ? { 'Content-Type': 'application/json' } : {},
        signal: AbortSignal.timeout(5000),
      };
      if (msg.body) opts.body = msg.body;

      console.debug('[bg] relay', msg.method, msg.url);
      const resp = await fetch(msg.url, opts);
      const body = await resp.text();
      console.debug('[bg] relay response', { status: resp.status, body });
      return { ok: true, status: resp.status, body };
    } catch (err) {
      console.debug('[bg] relay error', err.message);
      return { ok: false, status: 0, body: '', error: err.message };
    }
  })();

  return promise;
});
