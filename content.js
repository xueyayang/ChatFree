// content.js - Injected into chat.deepseek.com
// Two modes:
//   Top-frame: provides ping, sync, chat (original behavior).
//   Iframe (embedded in ChatFree app): hides input, accepts forwarded input
//     via postMessage, still intercepts SSE for status reporting.

(function() {
  // Detect embed mode: window.name survives SPA navigations (most reliable),
  // with URL hash and referrer as fallbacks.
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

  // Skip non-embed iframes — only run in top frame OR our own embed iframe
  if (window.top !== window.self && !IS_EMBEDDED) return;

  // Guard against double injection in the same extension session.
  if (window._chatfree_cs_loaded) return;
  window._chatfree_cs_loaded = true;
  window._chatfree_injection_id = Math.random().toString(36).slice(2, 8);

  let sseActive = false;
  let activeRequestId = 0;
  let currentReader = null;
  let chatInProgress = false;

  const BACKEND_NAME = 'DeepSeek';
  let _embeddedInput = null; // cached input ref for embed mode (survives hiding)

  // ---- Helpers (used by both modes) ----
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

  // ---- Shared: find / fill / send input (used by both modes) ----

  function findInput(checkVisible) {
    if (checkVisible === undefined) checkVisible = true;
    // Always search for fresh DOM elements first — cached ref may be
    // detached after SPA navigation replaces the page content.
    const selectors = [
      'textarea[placeholder*="消息" i]',
      'textarea[placeholder*="问题" i]',
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
    // Fallback: cached element only if still attached to the live DOM
    if (!checkVisible && _embeddedInput && document.contains(_embeddedInput)) {
      return _embeddedInput;
    }
    return null;
  }

  function fillInput(input, message) {
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

    const inputRect = input.getBoundingClientRect();
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      if (!btn.offsetParent) continue;
      const rect = btn.getBoundingClientRect();
      if (Math.abs(rect.bottom - inputRect.bottom) < 150) {
        btn.click();
        if (await waitForSend(input, 'nearBtn')) { dbg(`trySend: nearBtn worked +${Date.now() - t0}ms`); return true; }
      }
    }

    for (const btn of allBtns) {
      if (!btn.offsetParent || !btn.querySelector('svg')) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.5 && rect.top < window.innerHeight) {
        btn.click();
        if (await waitForSend(input, 'svgBtn')) { dbg(`trySend: svgBtn worked +${Date.now() - t0}ms`); return true; }
      }
    }

    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      ctrlKey: true, bubbles: true, cancelable: true, composed: true
    }));
    if (await waitForSend(input, 'Ctrl+Enter')) { dbg(`trySend: Ctrl+Enter worked +${Date.now() - t0}ms`); return true; }

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

  // ---- Shared: SSE interception (used by both modes) ----
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
      if (url.includes('/chat/completion') && response.ok && response.body && !sseActive && activeRequestId > 0) {
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
          const elapsed = Date.now() - t0;
          dbg(`SSE: trailing silence (800ms) at +${elapsed}ms, forcing done (chunks=${chunkCount})`);
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
              const elapsed = Date.now() - t0;
              dbg(`SSE: [DONE] received at +${elapsed}ms (chunks=${chunkCount}, firstChunkAt=+${firstChunkAt - t0}ms)`);
              reader.cancel('done').catch(() => {});
              doneSignaled = true;
              break;
            }
            const data = JSON.parse(jsonStr);
            const result = extractSSEText(data, inResponse);
            if (result.text && requestId === activeRequestId) {
              chunkCount++;
              if (!firstChunkAt) firstChunkAt = Date.now();
              resetSilenceTimer();
              if (!IS_EMBEDDED) {
                chrome.runtime.sendMessage({ type: 'chunk', content: result.text, requestId }).catch(() => {});
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
        const elapsed = Date.now() - t0;
        dbg(`SSE: done sent +${elapsed}ms (${chunkCount} chunks, firstChunkAt=+${firstChunkAt ? firstChunkAt - t0 : '?'}ms, signaled=${doneSignaled})`);
        if (!IS_EMBEDDED) {
          chrome.runtime.sendMessage({ type: 'done', requestId }).catch(() => {});
        }
      }
      reportResponseDone();
    }
  }

  function extractSSEText(data, inResponse) {
    if (data.o === 'APPEND' && Array.isArray(data.v)) {
      const responseText = data.v.filter(f => f.type === 'RESPONSE').map(f => f.content || '').join('');
      return { text: responseText, enteredResponse: data.v.some(f => f.type === 'RESPONSE') };
    }
    if (data.o === 'APPEND' && typeof data.v === 'string' && data.p && data.p.endsWith('/content')) {
      return { text: inResponse ? data.v : '', enteredResponse: false };
    }
    if (data.v && typeof data.v === 'string') {
      return { text: inResponse ? data.v : '', enteredResponse: false };
    }
    return { text: '', enteredResponse: false };
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
      // The adapter is site-specific (modules/site-deepseek.js etc.)
      // and loaded before content.js via the manifest.
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

    // Re-hide the input area whenever SPA navigation replaces the DOM.
    // DeepSeek rewrites the page after the first message (new-chat → /a/chat/…).
    let _hideTimer = null;
    const _domObserver = new MutationObserver(() => {
      if (_hideTimer) clearTimeout(_hideTimer);
      _hideTimer = setTimeout(() => {
        _hideTimer = null;
        // Check if an unhidden textarea appeared (SPA replaced the old one)
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

        // Re-hide before sending — the MutationObserver may not have fired yet,
        // and a visible input would have the wrong layout position.
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

    // Start hiding input. Retry if DOM isn't ready yet.
    hideNativeInput();

    return; // Embed mode: don't set up chrome.runtime listeners
  }

  // ============================================================
  // MODE: Top-frame (original tab-based sync/chat)
  // ============================================================

  // ---- Message handler (chrome.runtime) ----
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
    const onChatPage = location.pathname.startsWith('/a/chat/');
    const sessionId = onChatPage ? location.pathname.split('/').pop() : null;
    const input = document.querySelector('textarea');
    return {
      url: location.href,
      pathname: location.pathname,
      hasChatSession: onChatPage,
      sessionId: sessionId,
      markdownCount: document.querySelectorAll('.ds-markdown').length,
      inputReady: !!(input && input.offsetParent !== null),
      sseInterceptorActive: window.fetch === window._chatfree_wrapper,
      title: document.title
    };
  }

  // ---- Sync conversation state ----
  function syncConversation() {
    const chatArea = findMainChatArea();
    const allMarkdown = [...chatArea.querySelectorAll('.ds-markdown')];

    const aiContainers = groupByAiContainer(allMarkdown);
    const A = aiContainers.length;

    const aiHtmls = aiContainers.map(c => {
      const blocks = [...c.querySelectorAll('.ds-markdown')];
      return blocks.map(b => b.innerHTML).join('');
    }).filter(Boolean);

    const conversation = buildConversation(aiContainers, chatArea);
    const Q = conversation.filter(m => m.role === 'user').length;

    const lastMd = allMarkdown.length > 0 ? allMarkdown[allMarkdown.length - 1] : null;
    const lastHtml = lastMd ? lastMd.innerHTML : '';
    const lastLen = lastHtml.length;
    const hasRegen = lastMd ? hasRegenerateButton(lastMd) : false;
    const streaming = lastMd && lastLen > 0 && !hasRegen;

    const totalPageMd = document.querySelectorAll('.ds-markdown').length;

    return {
      Q: Q,
      A: A,
      balanced: Q === A || Q === 0,
      streaming: streaming,
      lastMarkdownLength: lastLen,
      lastMarkdownText: lastHtml,
      hasRegenerateButton: hasRegen,
      sessionId: location.pathname.startsWith('/a/chat/') ? location.pathname.split('/').pop() : null,
      aiHtmls: aiHtmls,
      conversation: conversation,
      totalPageMarkdown: totalPageMd,
      chatAreaMarkdown: allMarkdown.length,
      injectionId: window._chatfree_injection_id || '?'
    };
  }

  function groupByAiContainer(markdownEls) {
    if (markdownEls.length === 0) return [];

    const byClass = new Set();
    for (const md of markdownEls) {
      const c =
        md.closest('[class*="ds_message"]') ||
        md.closest('[class*="answer"]') ||
        md.closest('[class*="response"]');
      if (c) byClass.add(c);
    }
    if (byClass.size > 0) return sortEls([...byClass]);

    const total = markdownEls.length;
    const groups = new Map();
    for (const md of markdownEls) {
      let container = md;
      let el = md;
      for (let i = 0; i < 8; i++) {
        const p = el.parentElement;
        if (!p || p === document.body) break;
        const n = p.querySelectorAll('.ds-markdown').length;
        if (n > 0 && n < total) container = p;
        if (n >= total) break;
        el = p;
      }
      if (!groups.has(container)) groups.set(container, []);
      groups.get(container).push(md);
    }
    return sortEls([...groups.keys()]);
  }

  function buildConversation(aiContainers, chatArea) {
    const conversation = [];
    const seenUserEls = new Set();

    for (const ai of aiContainers) {
      const userEl = findPrecedingUserMessage(ai, chatArea);
      if (userEl && !seenUserEls.has(userEl)) {
        seenUserEls.add(userEl);
        const text = (userEl.textContent || '').trim();
        if (text) conversation.push({ role: 'user', text: text });
      }

      const blocks = [...ai.querySelectorAll('.ds-markdown')];
      const html = blocks.map(b => b.innerHTML).join('');
      if (html) conversation.push({ role: 'assistant', html: html });
    }

    return conversation;
  }

  function findPrecedingUserMessage(aiContainer, chatArea) {
    let el = aiContainer;
    for (let i = 0; i < 8; i++) {
      const prev = el.previousElementSibling;
      if (!prev) {
        el = el.parentElement;
        if (!el || el === chatArea || el === document.body) break;
        continue;
      }
      const text = (prev.textContent || '').trim();
      if (text.length > 1 &&
          !prev.querySelector('.ds-markdown') &&
          !prev.querySelector('.ds-think-content')) {
        return prev;
      }
      el = prev;
    }
    return null;
  }

  function sortEls(elements) {
    return elements.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
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
      if (!el.querySelector('.ds-markdown')) continue;

      const scrollCandidates = el.querySelectorAll('[class*="scroll"]');
      let bestScroll = null;
      let bestCount = 0;
      for (const sc of scrollCandidates) {
        const count = sc.querySelectorAll('.ds-markdown').length;
        if (count > bestCount) {
          bestCount = count;
          bestScroll = sc;
        }
      }
      if (bestScroll) return bestScroll;

      let bestChild = null;
      bestCount = 0;
      for (const child of el.children) {
        const count = child.querySelectorAll('.ds-markdown').length;
        if (count > bestCount) {
          bestCount = count;
          bestChild = child;
        }
      }
      if (bestChild) return bestChild;
      return el;
    }

    let bestEl = document.body;
    let bestCount = 0;
    for (const div of document.querySelectorAll('div')) {
      if (!div.contains(input)) continue;
      const mdCount = div.querySelectorAll('.ds-markdown').length;
      if (mdCount > bestCount) {
        bestCount = mdCount;
        bestEl = div;
      }
    }
    return bestEl;
  }

  function hasRegenerateButton(nearElement) {
    const msgContainer =
      nearElement.closest('[class*="ds_message"]') ||
      nearElement.closest('[class*="message"]') ||
      nearElement.closest('[class*="answer"]') ||
      nearElement.closest('[class*="response"]') ||
      nearElement.parentElement;

    if (!msgContainer) return false;

    const buttons = msgContainer.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (!btn.offsetParent) continue;
      const text = (btn.textContent || '').trim();
      if (text === '重新回答' || text === '重新生成' || text === 'Regenerate' || text === 'Retry') return true;
      const aria = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').trim();
      if (aria && (aria.includes('重新') || aria.includes('regenerate'))) return true;
    }
    return false;
  }

  // ---- Init ----
  dbg('Content script loaded [' + window._chatfree_injection_id + '] on ' + location.href);
  installSSEInterceptor();
})();
