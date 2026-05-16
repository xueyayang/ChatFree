// modules/content-core.js
// Shared content-script infrastructure for ChatFree embed mode.
//
// Loaded AFTER the site adapter (modules/site-*.js) which sets
// window.__ChatFreeSiteAdapter, and BEFORE the per-site content script.
//
// Exposes window.__ChatFreeCore with a single entry point:
//   Core.init(backendName) — starts the embed mode machinery.

(function() {
  // ============================================================
  // Embed detection
  // ============================================================
  let IS_EMBEDDED = false;
  if (window.top !== window.self) {
    try { IS_EMBEDDED = window.name === 'chatfree_embed_v1'; } catch (_) {}
    if (!IS_EMBEDDED) {
      try { IS_EMBEDDED = window.location.hash.includes('chatfree-embed'); } catch (_) {}
    }
    if (!IS_EMBEDDED) {
      try { IS_EMBEDDED = document.referrer.startsWith('chrome-extension://'); } catch (_) {}
    }
  }

  // Skip non-embed iframes
  if (window.top !== window.self && !IS_EMBEDDED) return;

  // ============================================================
  // Adapter reference (set by modules/site-*.js loaded before us)
  // ============================================================
  const A = window.__ChatFreeSiteAdapter;
  if (!A) {
    console.error('[ChatFree] Site adapter not found. Load modules/site-*.js first.');
    return;
  }

  // Guard against double injection
  if (window._chatfree_cs_loaded) return;
  window._chatfree_cs_loaded = true;
  window._chatfree_injection_id = Math.random().toString(36).slice(2, 8);

  // ============================================================
  // Module-level state
  // ============================================================
  let sseActive = false;
  let activeRequestId = 0;
  let currentReader = null;
  let _embeddedInput = null;
  let _hiddenEl = null;

  // ============================================================
  // Helpers
  // ============================================================
  function dbg(msg, level) {
    if (IS_EMBEDDED) {
      try {
        window.parent.postMessage({
          type: 'chatfree-log-msg', text: msg, level: level || null
        }, '*');
      } catch (_) {}
    } else {
      chrome.runtime.sendMessage({
        type: 'debug', source: 'cs', message: msg, level: level || null
      }).catch(() => {});
    }
  }

  function reportReady() {
    if (IS_EMBEDDED) {
      try { window.parent.postMessage({ type: 'chatfree-ready' }, '*'); } catch (_) {}
    }
  }

  function reportResponseStart() {
    if (IS_EMBEDDED) {
      try { window.parent.postMessage({ type: 'chatfree-response-start' }, '*'); } catch (_) {}
    }
  }

  function reportResponseDone() {
    if (IS_EMBEDDED) {
      try { window.parent.postMessage({ type: 'chatfree-response-done' }, '*'); } catch (_) {}
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // Pluggable input helpers — resolved once from adapter or default
  // ============================================================
  const fillInput = A.fillInput || defaultFillInput;
  const isCleared = A.isCleared || defaultIsCleared;
  const trySend   = A.trySend   || defaultTrySend;

  // ---- Default: fill input (textarea / input[type=text]) ----
  async function defaultFillInput(input, message) {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const nativeSetter =
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, message);
      } else {
        input.value = message;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // ---- Default: detect cleared input (textarea / input) ----
  function defaultIsCleared(input) {
    return (input.value || '') === '';
  }

  // ---- Default: trigger send (Enter → buttons → Ctrl+Enter → bottom buttons) ----
  async function defaultTrySend(input, helpers) {
    const { waitForSend, sleep: slp, dbg: log } = helpers;
    const t0 = Date.now();
    await slp(200);

    // Enter key — primary trigger for most chat UIs
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true
    }));
    input.dispatchEvent(new KeyboardEvent('keypress', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true
    }));
    if (await waitForSend(input, 'Enter')) { log('trySend: Enter worked +' + (Date.now() - t0) + 'ms'); return true; }

    // Nearby visible, enabled buttons
    const inputRect = input.getBoundingClientRect();
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      if (!btn.offsetParent || btn.disabled) continue;
      const rect = btn.getBoundingClientRect();
      if (Math.abs(rect.bottom - inputRect.bottom) < 150) {
        btn.click();
        if (await waitForSend(input, 'nearBtn')) { log('trySend: nearBtn worked +' + (Date.now() - t0) + 'ms'); return true; }
      }
    }

    // SVG icon buttons in the bottom half (common send-button pattern)
    for (const btn of allBtns) {
      if (!btn.offsetParent || !btn.querySelector('svg')) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.5 && rect.top < window.innerHeight) {
        btn.click();
        if (await waitForSend(input, 'svgBtn')) { log('trySend: svgBtn worked +' + (Date.now() - t0) + 'ms'); return true; }
      }
    }

    // Ctrl+Enter alternative
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      ctrlKey: true, bubbles: true, cancelable: true, composed: true
    }));
    if (await waitForSend(input, 'Ctrl+Enter')) { log('trySend: Ctrl+Enter worked +' + (Date.now() - t0) + 'ms'); return true; }

    // Any bottom-half enabled button (last resort)
    for (const btn of allBtns) {
      if (!btn.offsetParent || btn.disabled) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.55 && rect.top < window.innerHeight) {
        btn.click();
        if (await waitForSend(input, 'bottomBtn')) { log('trySend: bottomBtn worked +' + (Date.now() - t0) + 'ms'); return true; }
      }
    }

    log('trySend: all methods failed +' + (Date.now() - t0) + 'ms');
    return false;
  }

  // ---- waitForSend polls isCleared (resolved from adapter) ----
  async function waitForSend(input, label) {
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      await sleep(200);
      if (isCleared(input) || input.disabled) {
        dbg(`waitForSend[${label}]: cleared after ${Date.now() - t0}ms (iter ${i + 1})`);
        return true;
      }
    }
    dbg(`waitForSend[${label}]: timeout after ${Date.now() - t0}ms`);
    return false;
  }

  // ============================================================
  // Input: find
  // ============================================================
  function findInput(checkVisible) {
    if (checkVisible === undefined) checkVisible = true;
    const selectors = A.inputSelectors || ['textarea'];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && (!checkVisible || el.offsetParent !== null)) {
          if (!checkVisible) _embeddedInput = el;
          return el;
        }
      } catch {}
    }
    if (!checkVisible && _embeddedInput && document.contains(_embeddedInput)) {
      return _embeddedInput;
    }
    return null;
  }

  // ============================================================
  // doChatViaDOM — orchestrates fill + send
  // ============================================================
  async function doChatViaDOM(message, requestId) {
    const t0 = Date.now();
    installSSEInterceptor();

    activeRequestId = requestId;
    if (currentReader) {
      currentReader.cancel('superseded').catch(() => {});
      currentReader = null;
    }
    sseActive = false;

    const input = findInput(IS_EMBEDDED ? false : true);
    if (!input) throw new Error('Could not find ' + A.name + ' chat input');

    // Some sites (Doubao) need the input visible for geometry-based button
    // detection in trySend. We must restore the element that was actually
    // hidden (_hiddenEl, which may be a container ancestor) — not just the
    // textarea.  Otherwise getBoundingClientRect() returns offscreen coords
    // inherited from the still-hidden container.
    let prevCss = null;
    if (IS_EMBEDDED && A.needsVisibleInput && _hiddenEl) {
      prevCss = _hiddenEl.style.cssText;
      _hiddenEl.style.cssText = '';
    }

    try {
      input.focus();
      await fillInput(input, message);
      await sleep(300);
      dbg(`doChat: input filled +${Date.now() - t0}ms`);

      const tSend = Date.now();
      const sent = await trySend(input, { waitForSend, sleep, dbg });
      if (!sent) throw new Error('Failed to send message');
      dbg(`doChat: message sent +${Date.now() - t0}ms (trySend took ${Date.now() - tSend}ms, requestId=${requestId})`);
    } finally {
      if (prevCss !== null) {
        _hiddenEl.style.cssText = prevCss;
      }
    }
  }

  // ============================================================
  // SSE interception
  // ============================================================
  function installSSEInterceptor() {
    const self = window;
    if (self._chatfree_originalFetch) {
      if (self.fetch === self._chatfree_wrapper) return;
    }
    const originalFetch = self.fetch;
    self._chatfree_originalFetch = originalFetch;

    const wrapper = async function(resource, options) {
      const url = typeof resource === 'string' ? resource : (resource.url || '');
      const response = await originalFetch.call(self, resource, options);

      if (A.matchSSEUrl(url) && response.ok && response.body &&
          !sseActive && activeRequestId > 0) {
        const capturedId = activeRequestId;
        dbg(`SSE stream detected (requestId=${capturedId})`);
        const clone = response.clone();
        processSSEStream(clone, capturedId).catch(() => {});
      }
      return response;
    };

    self._chatfree_wrapper = wrapper;
    self.fetch = wrapper;
  }

  async function processSSEStream(response, requestId) {
    const t0 = Date.now();
    sseActive = true;
    reportResponseStart();
    const reader = response.body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();
    let buffer = '', chunkCount = 0, inResponse = false, doneSignaled = false;
    let silenceTimer = null;
    let firstChunkAt = 0;

    function resetSilenceTimer() {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (requestId === activeRequestId && sseActive) {
          dbg(`SSE: trailing silence (800ms) at +${Date.now() - t0}ms, forcing done`);
          reader.cancel('silence').catch(() => {});
          doneSignaled = true;
        }
      }, 800);
    }

    try {
      resetSilenceTimer();
      dbg(`SSE: waiting for stream start...`);
      while (true) {
        const { done, value } = await reader.read();
        if (done) { dbg(`SSE: reader done at +${Date.now() - t0}ms`); break; }
        if (requestId !== activeRequestId) { dbg(`SSE: requestId mismatch, aborting`); break; }
        if (doneSignaled) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          if (requestId !== activeRequestId) break;
          try {
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            if (jsonStr === '[DONE]') {
              dbg(`SSE: [DONE] at +${Date.now() - t0}ms (chunks=${chunkCount}, firstChunkAt=+${firstChunkAt ? firstChunkAt - t0 : '?'}ms)`);
              reader.cancel('done').catch(() => {});
              doneSignaled = true;
              break;
            }
            const data = JSON.parse(jsonStr);
            const result = A.extractSSEText(data);
            if (result.text && requestId === activeRequestId) {
              chunkCount++;
              if (!firstChunkAt) firstChunkAt = Date.now();
              resetSilenceTimer();
              if (!IS_EMBEDDED) {
                chrome.runtime.sendMessage({
                  type: 'chunk', content: result.text, requestId
                }).catch(() => {});
              }
            }
            if (result.enteredResponse) inResponse = true;
          } catch {}
        }
      }
    } finally {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (currentReader === reader) currentReader = null;
      sseActive = false;
      if (requestId === activeRequestId && chunkCount > 0) {
        dbg(`SSE: done +${Date.now() - t0}ms (${chunkCount} chunks, firstChunkAt=+${firstChunkAt ? firstChunkAt - t0 : '?'}ms, signaled=${doneSignaled})`);
        if (!IS_EMBEDDED) {
          chrome.runtime.sendMessage({ type: 'done', requestId }).catch(() => {});
        }
      }
      reportResponseDone();
    }
  }

  // ============================================================
  // Embed mode: hide native input chrome
  // ============================================================
  function hideNativeInput() {
    const input = findInput(false);
    if (!input) {
      setTimeout(hideNativeInput, 500);
      return;
    }

    _embeddedInput = input;

    let { el, method } = (A.findInputContainer)
      ? (A.findInputContainer(input) || {})
      : {};

    if (!el) {
      el = input;
      method = 'input(fallback)';
    }

    _hiddenEl = el;

    el.style.cssText = 'position:fixed !important;left:-9999px !important;top:-9999px !important;' +
                       'width:1px !important;height:1px !important;overflow:hidden !important;';
    dbg('Embed: hid ' + method + ' ' + el.tagName + '.' + (el.className || '').slice(0, 40));
    reportReady();
    installSSEInterceptor();
  }

  // ============================================================
  // Embed mode: SPA re-hide observer
  // ============================================================
  let _hideTimer = null;
  const _domObserver = new MutationObserver(() => {
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = setTimeout(() => {
      _hideTimer = null;
      const visibleInput = findInput(true);
      if (visibleInput && document.contains(visibleInput)) {
        dbg('Embed: new visible input detected after DOM change, re-hiding');
        hideNativeInput();
      }
    }, 300);
  });
  _domObserver.observe(document.body, { childList: true, subtree: true });

  // ============================================================
  // Embed mode: postMessage listener (receive forwarded input)
  // ============================================================
  window.addEventListener('message', async (event) => {
    if (!event.data || typeof event.data.type !== 'string') return;

    if (event.data.type === 'chatfree-forward-input') {
      const text = (event.data.text || '').trim();
      if (!text) return;

      hideNativeInput();
      dbg('Embed: received forwarded input: "' +
          text.slice(0, 60) + (text.length > 60 ? '...' : '') + '"');

      try {
        await doChatViaDOM(text, Date.now());
        try {
          window.parent.postMessage({ type: 'chatfree-sent' }, '*');
        } catch (_) {}
      } catch (err) {
        dbg('Embed: send failed: ' + err.message, 'err');
        try {
          window.parent.postMessage({ type: 'chatfree-error', text: err.message }, '*');
        } catch (_) {}
      }
    }

    if (event.data.type === 'chatfree-ping') {
      hideNativeInput();
    }
  });

  // ============================================================
  // Init
  // ============================================================
  dbg('Content script loaded [' + window._chatfree_injection_id +
      '] on ' + location.href + ' (site=' + A.name + ')');
  hideNativeInput();
})();
