// content_doubao.js - Injected into www.doubao.com
// Two modes:
//   Top-frame: provides ping, sync, chat.
//   Iframe (embedded in ChatFree app): hides input, accepts forwarded input
//     via postMessage, still intercepts SSE for status reporting.

(function() {
  // Detect embed mode
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

  if (window.top !== window.self && !IS_EMBEDDED) return;

  if (window._chatfree_cs_loaded) return;
  window._chatfree_cs_loaded = true;
  window._chatfree_injection_id = Math.random().toString(36).slice(2, 8);

  let sseActive = false;
  let activeRequestId = 0;
  let currentReader = null;
  let chatInProgress = false;

  const BACKEND_NAME = 'Doubao';
  let _embeddedInput = null;

  // ---- Helpers ----
  function dbg(msg, level) {
    if (IS_EMBEDDED) {
      try {
        window.parent.postMessage({
          type: 'chatfree-log-msg', text: msg, level: level || null
        }, '*');
      } catch (_) {}
    } else {
      chrome.runtime.sendMessage({ type: 'debug', source: 'cs', message: msg, level: level || null }).catch(() => {});
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

  // ---- Find / fill / send input ----

  function findInput(checkVisible) {
    if (checkVisible === undefined) checkVisible = true;
    // Doubao uses: <textarea placeholder="发消息..."> — React controlled.
    const selectors = [
      'textarea[placeholder*="发消息" i]',
      'textarea[placeholder*="消息" i]',
      'textarea[placeholder*="message" i]',
      '#chat-input',
      '[role="textbox"]',
      'textarea'
    ];
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

  function fillInput(input, message) {
    // Doubao uses React — must use native value setter + input event
    // to trigger React's onChange handler and update state.
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
    } else if (input.getAttribute('contenteditable') === 'true') {
      input.textContent = message;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  async function waitForSend(input, label) {
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      await sleep(200);
      if (input.value === '' || input.disabled) {
        dbg(`waitForSend[${label}]: cleared after ${Date.now() - t0}ms (iter ${i + 1})`);
        return true;
      }
    }
    dbg(`waitForSend[${label}]: timeout after ${Date.now() - t0}ms`);
    return false;
  }

  async function trySend(input) {
    const t0 = Date.now();
    await sleep(200);

    // Enter key — primary trigger for Doubao
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true
    }));
    input.dispatchEvent(new KeyboardEvent('keypress', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true
    }));
    if (await waitForSend(input, 'Enter')) { dbg(`trySend: Enter worked +${Date.now() - t0}ms`); return true; }

    // Nearby buttons (send button is next to textarea in the same bar)
    const inputRect = input.getBoundingClientRect();
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      if (!btn.offsetParent || btn.disabled) continue;
      const rect = btn.getBoundingClientRect();
      if (Math.abs(rect.bottom - inputRect.bottom) < 150) {
        btn.click();
        if (await waitForSend(input, 'nearBtn')) { dbg(`trySend: nearBtn worked +${Date.now() - t0}ms`); return true; }
      }
    }

    // Icon-only buttons (likely send button) anywhere in bottom half
    for (const btn of allBtns) {
      if (!btn.offsetParent || !btn.querySelector('svg')) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.5 && rect.top < window.innerHeight) {
        btn.click();
        if (await waitForSend(input, 'svgBtn')) { dbg(`trySend: svgBtn worked +${Date.now() - t0}ms`); return true; }
      }
    }

    // Ctrl+Enter alternative
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      ctrlKey: true, bubbles: true, cancelable: true, composed: true
    }));
    if (await waitForSend(input, 'Ctrl+Enter')) { dbg(`trySend: Ctrl+Enter worked +${Date.now() - t0}ms`); return true; }

    // Any bottom-half button
    for (const btn of allBtns) {
      if (!btn.offsetParent || btn.disabled) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.55 && rect.top < window.innerHeight) {
        btn.click();
        if (await waitForSend(input, 'bottomBtn')) { dbg(`trySend: bottomBtn worked +${Date.now() - t0}ms`); return true; }
      }
    }

    dbg(`trySend: all methods failed +${Date.now() - t0}ms`);
    return false;
  }

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
    if (!input) throw new Error('Could not find ' + BACKEND_NAME + ' chat input');

    input.focus();
    fillInput(input, message);
    await sleep(300);
    dbg(`doChat: input filled +${Date.now() - t0}ms`);

    const tSend = Date.now();
    const sent = await trySend(input);
    if (!sent) throw new Error('Failed to send message');
    dbg(`doChat: message sent +${Date.now() - t0}ms (trySend took ${Date.now() - tSend}ms, requestId=${requestId})`);
  }

  // ---- SSE interception ----
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

      // Doubao SSE: match common ByteDance/Doubao streaming API patterns.
      // Known patterns: /api/chat, /chat/stream, /api/v1/..., etc.
      const isSSE = (
        url.includes('/api/') || url.includes('/chat/') || url.includes('/stream') ||
        url.includes('doubao') || url.includes('ark')
      ) && response.ok && response.body;

      if (isSSE && !sseActive && activeRequestId > 0) {
        const capturedId = activeRequestId;
        dbg(`SSE stream detected (requestId=${capturedId}, url=${url.slice(0, 80)})`);
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
              dbg(`SSE: [DONE] at +${Date.now() - t0}ms (chunks=${chunkCount})`);
              reader.cancel('done').catch(() => {});
              doneSignaled = true;
              break;
            }
            const data = JSON.parse(jsonStr);
            const text = extractSSEText(data, inResponse);
            if (text && requestId === activeRequestId) {
              chunkCount++;
              if (!firstChunkAt) firstChunkAt = Date.now();
              resetSilenceTimer();
              if (!IS_EMBEDDED) {
                chrome.runtime.sendMessage({ type: 'chunk', content: text, requestId }).catch(() => {});
              }
            }
            if (text) inResponse = true;
          } catch {}
        }
      }
    } finally {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (currentReader === reader) currentReader = null;
      sseActive = false;
      if (requestId === activeRequestId && chunkCount > 0) {
        dbg(`SSE: done +${Date.now() - t0}ms (${chunkCount} chunks)`);
        if (!IS_EMBEDDED) {
          chrome.runtime.sendMessage({ type: 'done', requestId }).catch(() => {});
        }
      }
      reportResponseDone();
    }
  }

  // Adaptive SSE text extraction — tries multiple known formats.
  function extractSSEText(data, _inResponse) {
    // DeepSeek-style: { o: 'APPEND', v: [...] }
    if (data.o === 'APPEND' && Array.isArray(data.v)) {
      return data.v.filter(f => f.type === 'RESPONSE').map(f => f.content || '').join('');
    }
    if (data.o === 'APPEND' && typeof data.v === 'string') return data.v;
    // OpenAI-style: { choices: [{ delta: { content: '...' } }] }
    if (data.choices && Array.isArray(data.choices)) {
      return data.choices.map(c => (c.delta && c.delta.content) || c.content || '').join('');
    }
    // ByteDance/Doubao-style: { content/text/message }
    if (data.content && typeof data.content === 'string') return data.content;
    if (data.text && typeof data.text === 'string') return data.text;
    if (data.message && typeof data.message === 'string') return data.message;
    if (data.data && typeof data.data === 'string') return data.data;
    // Generic: first string value
    if (typeof data.v === 'string') return data.v;
    return '';
  }

  // ============================================================
  // MODE: Embed (iframe within ChatFree app page)
  // ============================================================
  if (IS_EMBEDDED) {
    dbg('Content script loaded in embed mode [' + window._chatfree_injection_id + ']');

    function hideNativeInput() {
      const input = findInput(false);
      if (!input) {
        setTimeout(hideNativeInput, 500);
        return;
      }

      _embeddedInput = input;

      // Delegate to the site adapter for container detection.
      const adapter = window.__ChatFreeSiteAdapter;
      let { el, method } = (adapter && adapter.findInputContainer)
        ? (adapter.findInputContainer(input) || {})
        : {};

      if (!el) {
        el = input;
        method = 'input(fallback)';
      }

      el.style.cssText = 'position:fixed !important;left:-9999px !important;top:-9999px !important;' +
                         'width:1px !important;height:1px !important;overflow:hidden !important;';
      dbg('Embed: hid ' + method + ' ' + el.tagName + '.' + (el.className || '').slice(0, 40));
      reportReady();
      installSSEInterceptor();
    }

    // Re-hide after SPA navigation replaces the DOM.
    let _hideTimer = null;
    const _domObserver = new MutationObserver(() => {
      if (_hideTimer) clearTimeout(_hideTimer);
      _hideTimer = setTimeout(() => {
        _hideTimer = null;
        const visibleInput = document.querySelector('textarea');
        if (visibleInput && visibleInput.offsetParent !== null && document.contains(visibleInput)) {
          dbg('Embed: new visible input detected after DOM change, re-hiding');
          hideNativeInput();
        }
      }, 300);
    });
    _domObserver.observe(document.body, { childList: true, subtree: true });

    // Listen for forwarded input from the parent ChatFree page
    window.addEventListener('message', async (event) => {
      if (!event.data || typeof event.data.type !== 'string') return;

      if (event.data.type === 'chatfree-forward-input') {
        const text = (event.data.text || '').trim();
        if (!text) return;

        hideNativeInput();
        dbg('Embed: received forwarded input: "' + text.slice(0, 60) + (text.length > 60 ? '...' : '') + '"');

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

    hideNativeInput();
    return;
  }

  // ============================================================
  // MODE: Top-frame (original tab-based sync/chat)
  // ============================================================

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse(capturePageState());
      return true;
    }

    if (msg.action === 'sync') {
      sendResponse(syncConversation());
      return true;
    }

    if (msg.action === 'chat') {
      if (chatInProgress) {
        sendResponse({ accepted: false });
        return true;
      }
      const requestId = msg.requestId || 0;
      chatInProgress = true;
      doChatViaDOM(msg.message, requestId)
        .catch(err => {
          dbg('doChatViaDOM error: ' + err.message, 'err');
          chrome.runtime.sendMessage({ type: 'error', error: err.message, requestId }).catch(() => {});
        })
        .finally(() => { chatInProgress = false; });
      sendResponse({ accepted: true });
      return true;
    }
  });

  // ---- Page state (ping) ----
  function capturePageState() {
    const onChatPage = location.pathname.startsWith('/chat/');
    const input = document.querySelector('textarea');
    return {
      url: location.href,
      pathname: location.pathname,
      hasChatSession: onChatPage,
      sessionId: onChatPage ? location.pathname.split('/').pop() : null,
      markdownCount: document.querySelectorAll('[class*="markdown"]').length,
      inputReady: !!(input && input.offsetParent !== null),
      sseInterceptorActive: window.fetch === window._chatfree_wrapper,
      title: document.title
    };
  }

  // ---- Sync conversation state ----
  function syncConversation() {
    const chatArea = findMainChatArea();
    // Doubao likely uses generic markdown classes or data attributes.
    // Try multiple common patterns.
    const msgEls = [
      ...chatArea.querySelectorAll('[class*="markdown"]'),
      ...chatArea.querySelectorAll('[class*="message"]'),
      ...chatArea.querySelectorAll('[class*="content"]')
    ];

    // Deduplicate and sort
    const seen = new Set();
    const unique = [];
    for (const el of msgEls) {
      if (!seen.has(el)) { seen.add(el); unique.push(el); }
    }

    const conversation = buildConversation(unique, chatArea);
    const Q = conversation.filter(m => m.role === 'user').length;
    const A = conversation.filter(m => m.role === 'assistant').length;

    return {
      Q: Q,
      A: A,
      balanced: Q === A || Q === 0,
      streaming: false,
      lastMarkdownLength: 0,
      lastMarkdownText: '',
      hasRegenerateButton: false,
      sessionId: location.pathname.startsWith('/chat/') ? location.pathname.split('/').pop() : null,
      aiHtmls: [],
      conversation: conversation,
      totalPageMarkdown: unique.length,
      chatAreaMarkdown: unique.length,
      injectionId: window._chatfree_injection_id || '?'
    };
  }

  function buildConversation(msgEls, chatArea) {
    const conversation = [];
    for (const el of msgEls) {
      const text = (el.textContent || '').trim();
      if (!text || text.length < 2) continue;
      // Heuristic: user messages are typically shorter and appear before AI
      const isUser = text.length < 200 && !el.querySelector('pre') && !el.querySelector('[class*="code"]');
      conversation.push({
        role: isUser ? 'user' : 'assistant',
        text: isUser ? text : '',
        html: isUser ? '' : el.innerHTML
      });
    }
    return conversation;
  }

  function findMainChatArea() {
    const input = document.querySelector('textarea');
    if (!input) return document.body;

    let el = input;
    for (let i = 0; i < 12; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;

      const parent = el.parentElement;
      if (!parent) continue;
      const parentStyle = window.getComputedStyle(parent);
      if (parentStyle.display !== 'flex' && parentStyle.display !== 'grid') continue;

      // This flex/grid child contains the textarea — find the scrollable sibling
      // that holds the conversation content.
      const scrollCandidates = el.querySelectorAll('[class*="scroll"]');
      let bestScroll = null, bestCount = 0;
      for (const sc of scrollCandidates) {
        const count = sc.children.length;
        if (count > bestCount) { bestCount = count; bestScroll = sc; }
      }
      if (bestScroll) return bestScroll;

      // Find the sibling with the most content
      for (const sibling of parent.children) {
        if (sibling === el) continue;
        if (sibling.children.length > 5) return sibling;
      }
      return el;
    }

    return document.body;
  }

  // ---- Init ----
  dbg('Content script loaded [' + window._chatfree_injection_id + '] on ' + location.href);
  installSSEInterceptor();
})();
