// modules/sync-embed.js
// Embed-based sync module: loads the target page in an iframe and forwards
// input from the plugin to the embedded page. No parsing, no rendering —
// the target page handles everything natively.
//
// Interface: createEmbedSyncModule({ state, dom, utils }) → { init, sync, send, stop }
//
// Required dom keys:
//   containerEl (where to put the iframe), inputEl, sendBtn, statusDot, statusText
// Required utils keys:
//   appendDebug

export function createEmbedSyncModule({ state, dom, utils }) {
  const { appendDebug } = utils;

  let _iframe = null;
  let _ready = false;
  let _sendInProgress = false;

  const BACKEND_URLS = {
    deepseek: 'https://chat.deepseek.com/',
    chatgpt: 'https://chatgpt.com/',
    doubao: 'https://www.doubao.com/chat/'
  };

  // ---- Public ----
  function init() {
    dom.inputEl.disabled = true;
    dom.sendBtn.disabled = true;
    createIframe();
    setupPostMessageListener();
  }

  function stop() {
    if (_iframe) {
      _iframe.remove();
      _iframe = null;
    }
    _ready = false;
  }

  async function sync() {
    if (!_iframe) {
      createIframe();
      return;
    }
    // Reload the iframe to re-sync
    appendDebug('app', 'Reloading embed iframe...');
    _ready = false;
    dom.inputEl.disabled = true;
    dom.sendBtn.disabled = true;
    _iframe.src = _iframe.src;
  }

  async function send(text) {
    if (!text || !_ready || _sendInProgress) return;

    _sendInProgress = true;
    dom.sendBtn.disabled = true;
    dom.inputEl.disabled = true;
    const t0 = Date.now();
    appendDebug('app', 'Embed: forwarding "' + text.slice(0, 60) + (text.length > 60 ? '...' : '') + '"');

    try {
      _iframe.contentWindow.postMessage({
        type: 'chatfree-forward-input',
        text: text
      }, '*');

      // Re-enable input after a short delay (the embedded page handles sending)
      setTimeout(() => {
        _sendInProgress = false;
        dom.sendBtn.disabled = false;
        dom.inputEl.disabled = false;
        dom.inputEl.value = '';
        dom.inputEl.focus();
        appendDebug('app', `Embed: input forwarded +${Date.now() - t0}ms`);
      }, 800);

    } catch (err) {
      appendDebug('app', 'Embed send error: ' + err.message, 'err');
      _sendInProgress = false;
      dom.sendBtn.disabled = false;
      dom.inputEl.disabled = false;
    }
  }

  // ---- Internal ----
  function createIframe() {
    // Remove old iframe if present
    if (_iframe) { _iframe.remove(); _iframe = null; }

    const url = BACKEND_URLS[state.backend] || BACKEND_URLS.deepseek;
    _iframe = document.createElement('iframe');
    _iframe.id = 'embed-frame';
    _iframe.name = 'chatfree_embed_v1';  // survives SPA navigations
    _iframe.src = url + '#chatfree-embed';
    _iframe.setAttribute('allow', 'clipboard-write');

    dom.containerEl.appendChild(_iframe);
    appendDebug('app', 'Embed iframe created: ' + url);

    // Monitor iframe load
    _iframe.addEventListener('load', () => {
      appendDebug('app', 'Embed iframe loaded');
      // Give content script time to initialize
      setTimeout(checkEmbedReady, 1500);
    });

    _iframe.addEventListener('error', () => {
      appendDebug('app', 'Embed iframe failed to load', 'err');
    });

    updateStatus('loading');
  }

  function checkEmbedReady() {
    // The content script in the iframe sends a ready signal via postMessage
    // If we haven't received it yet, try pinging
    if (!_ready) {
      try {
        _iframe.contentWindow.postMessage({ type: 'chatfree-ping' }, '*');
      } catch (_) {}
    }
  }

  function setupPostMessageListener() {
    window.addEventListener('message', (event) => {
      // Messages from iframe content script
      if (!_iframe || event.source !== _iframe.contentWindow) return;
      if (!event.data || typeof event.data.type !== 'string') return;

      const msg = event.data;

      if (msg.type === 'chatfree-ready') {
        _ready = true;
        dom.inputEl.disabled = false;
        dom.sendBtn.disabled = false;
        dom.inputEl.placeholder = 'Type a message...';
        updateStatus('connected');
        appendDebug('app', 'Embed: content script ready — input hidden, plugin input active');
      }

      else if (msg.type === 'chatfree-log-msg') {
        appendDebug('cs', msg.text, msg.level || null);
      }

      else if (msg.type === 'chatfree-sent') {
        appendDebug('app', 'Embed: content script confirmed send');
      }

      else if (msg.type === 'chatfree-error') {
        appendDebug('app', 'Embed error from cs: ' + msg.text, 'err');
        _sendInProgress = false;
        dom.sendBtn.disabled = false;
        dom.inputEl.disabled = false;
      }

      else if (msg.type === 'chatfree-response-start') {
        appendDebug('app', 'Embed: response streaming started');
      }

      else if (msg.type === 'chatfree-response-done') {
        appendDebug('app', 'Embed: response streaming finished');
      }
    });
  }

  function updateStatus(mode) {
    const label = dom.backendLabel || 'AI';
    if (mode === 'loading') {
      dom.statusDot.className = 'waiting';
      dom.statusText.textContent = label + ' — Loading...';
    } else if (mode === 'connected') {
      dom.statusDot.className = 'connected';
      dom.statusText.textContent = label + ' (embed)';
    } else {
      dom.statusDot.className = 'disconnected';
      dom.statusText.textContent = label + ' — Disconnected';
    }
  }

  // ---- Public API ----
  return { init, sync, send, stop };
}
