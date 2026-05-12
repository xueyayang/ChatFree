// content.js - Injected into chat.deepseek.com
// Provides: ping (diagnostics), sync (read conversation state), chat (send message).

(function() {
  // Skip iframes — each frame gets its own injection but we only want the top frame
  if (window.top !== window.self) return;
  // Guard against double injection in the same extension session.
  // window properties reset when extension is reloaded (isolated world recreated).
  if (window._chatfree_cs_loaded) return;
  window._chatfree_cs_loaded = true;
  window._chatfree_injection_id = Math.random().toString(36).slice(2, 8);

  let sseActive = false;
  let activeRequestId = 0;
  let currentReader = null;
  let chatInProgress = false;

  function dbg(msg, level) {
    chrome.runtime.sendMessage({ type: 'debug', source: 'cs', message: msg, level: level || null }).catch(() => {});
  }

  // ---- Message handler ----
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

  // ---- Sync conversation state (core of the new model) ----
  function syncConversation() {
    const chatArea = findMainChatArea();
    const allMarkdown = [...chatArea.querySelectorAll('.ds-markdown')];

    // Group .ds-markdown elements by their AI response container.
    // DeepSeek uses multiple .ds-markdown blocks per AI response (one per
    // paragraph / code block), so counting them directly overcounts.
    const aiContainers = groupByAiContainer(allMarkdown);
    const A = aiContainers.length;

    // Extract full HTML of each AI response by joining the innerHTML of all
    // .ds-markdown blocks that belong to that container. This preserves
    // formatting (code highlighting, tables, bold, etc.).
    const aiHtmls = aiContainers.map(c => {
      const blocks = [...c.querySelectorAll('.ds-markdown')];
      return blocks.map(b => b.innerHTML).join('');
    }).filter(Boolean);

    // Count user messages by finding the TOC in the right sidebar (most
    // reliable — DeepSeek extracts questions from the conversation) or by
    // matching user-message elements to AI response containers.
    const Q = countUserMessagesV2(aiContainers, chatArea, allMarkdown);

    // Last markdown block in main chat — use innerHTML to preserve formatting
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
      totalPageMarkdown: totalPageMd,
      chatAreaMarkdown: allMarkdown.length,
      injectionId: window._chatfree_injection_id || '?'
    };
  }

  // Group .ds-markdown elements by their containing AI response.
  // Multiple .ds-markdown blocks in the same AI answer share a common
  // ancestor (the message container); this deduplicates them.
  function groupByAiContainer(markdownEls) {
    if (markdownEls.length === 0) return [];

    // Strategy 1: use known DeepSeek message container class
    const byClass = new Set();
    for (const md of markdownEls) {
      const c =
        md.closest('[class*="ds_message"]') ||
        md.closest('[class*="answer"]') ||
        md.closest('[class*="response"]');
      if (c) byClass.add(c);
    }
    if (byClass.size > 0) return sortEls([...byClass]);

    // Strategy 2: walk up from each .ds-markdown; stop at the ancestor
    // whose parent would include ALL chat-area .ds-markdown blocks.
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

  // Count user messages: first try the right-side TOC (DeepSeek extracts
  // questions into a table-of-contents sidebar that the user confirmed is
  // accurate), then fall back to locating user-message DOM elements.
  function countUserMessagesV2(aiContainers, chatArea, allMarkdown) {
    // Strategy 1: right-side TOC — a narrow panel fixed to the right that
    // lists every user question as a clickable nav item.
    const tocQ = countTocItems();
    if (tocQ > 0) return tocQ;

    // Strategy 2: for each AI container, walk previous siblings to find a
    // user-message element (text, no .ds-markdown inside).
    let userCount = 0;
    for (const ai of aiContainers) {
      let el = ai;
      for (let i = 0; i < 5; i++) {
        const prev = el.previousElementSibling;
        if (!prev) { el = el.parentElement; if (!el || el === chatArea) break; continue; }
        const text = (prev.textContent || '').trim();
        if (text.length > 1 &&
            !prev.querySelector('.ds-markdown') &&
            !prev.querySelector('.ds-think-content')) {
          userCount++;
          break;
        }
        el = prev;
      }
    }
    if (userCount > 0) return userCount;

    // Strategy 3: assume 1:1 with AI responses
    return aiContainers.length;
  }

  // Count TOC (table of contents) items in the right sidebar.
  // DeepSeek's TOC is a narrow right-side panel that appears on hover and
  // lists every user question. Each item links/scrolls to its question.
  function countTocItems() {
    // DeepSeek renders TOC items as clickable elements in a right-side
    // panel. Try several selectors that match observed DOM patterns.
    const candidates = [
      '[class*="toc"] a, [class*="toc"] [role="button"]',
      '[class*="outline"] a, [class*="outline"] [role="button"]',
      '[class*="directory"] a, [class*="directory"] [role="button"]',
      '[class*="catalog"] a, [class*="catalog"] [role="button"]',
      '[class*="sidebar"] [class*="toc"] a',
      '[class*="sidebar"] [class*="outline"] a',
      '[class*="nav"] a[href*="#"]',
      '[class*="Toc"] a, [class*="Toc"] [role="button"]',
      '[class*="side"] [class*="list"] > *',
    ];
    for (const sel of candidates) {
      try {
        const items = document.querySelectorAll(sel);
        if (items.length > 0) {
          // Filter to only items that contain reasonable text (a question)
          const filtered = [...items].filter(el => {
            const text = (el.textContent || '').trim();
            return text.length > 2 && text.length < 300;
          });
          if (filtered.length > 0) return filtered.length;
        }
      } catch {}
    }

    // Also try: find the rightmost fixed/absolute panel (the TOC sidebar)
    // and count its interactive child elements.
    try {
      const allDivs = document.querySelectorAll('div');
      let bestPanel = null, bestScore = 0;
      for (const div of allDivs) {
        const style = window.getComputedStyle(div);
        if (style.position === 'fixed' || style.position === 'absolute') {
          const rect = div.getBoundingClientRect();
          // Right-side panel: right edge near viewport right, reasonable width
          if (rect.right >= window.innerWidth - 60 && rect.width > 40 && rect.width < 400) {
            const links = div.querySelectorAll('a, [role="button"], [role="link"]');
            if (links.length > bestScore) {
              bestScore = links.length;
              bestPanel = div;
            }
          }
        }
      }
      if (bestPanel && bestScore > 0) {
        const items = bestPanel.querySelectorAll('a, [role="button"], [role="link"]');
        const filtered = [...items].filter(el => {
          const text = (el.textContent || '').trim();
          return text.length > 2 && text.length < 300;
        });
        if (filtered.length > 0) return filtered.length;
      }
    } catch {}

    return 0;
  }

  // Sort elements by DOM order (top-to-bottom).
  function sortEls(elements) {
    return elements.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  // Find the main conversation area (center column), excluding sidebars.
  function findMainChatArea() {
    const input = document.querySelector('textarea');
    if (!input) return document.body;

    // Strategy: DeepSeek layout is flex/grid with left sidebar, center column,
    // right sidebar. Walk up from textarea to find the flex/grid item (column)
    // that contains the textarea — that's the center column. Then scope all
    // queries to only that column, excluding sidebars.

    // Step 1: walk up to find the column — the first ancestor that is a direct
    // child of a flex/grid container AND contains .ds-markdown.
    let el = input;
    for (let i = 0; i < 12; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;

      const parent = el.parentElement;
      if (!parent) continue;
      const parentStyle = window.getComputedStyle(parent);
      if (parentStyle.display !== 'flex' && parentStyle.display !== 'grid') continue;
      if (!el.querySelector('.ds-markdown')) continue;

      // 'el' is a flex/grid item (a column) that contains the textarea and
      // at least one .ds-markdown. This should be the center chat column.
      // Step 2: within this column, find the scrollable message container.
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

      // Step 3: no scroll child — look for the direct child with most .ds-markdown.
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

    // Fallback: find element with most .ds-markdown that also contains the input.
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

  // ---- Send message via DOM (kept for chat action) ----
  async function doChatViaDOM(message, requestId) {
    installSSEInterceptor();

    activeRequestId = requestId;
    if (currentReader) {
      currentReader.cancel('superseded').catch(() => {});
      currentReader = null;
    }
    sseActive = false;

    const input = findInput();
    if (!input) throw new Error('Could not find DeepSeek chat input');

    input.focus();
    fillInput(input, message);
    await sleep(300);

    const sent = await trySend(input);
    if (!sent) throw new Error('Failed to send message');
    dbg('Message sent (requestId=' + requestId + ')');
  }

  function findInput() {
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
        if (el && el.offsetParent !== null) return el;
      } catch {}
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

  async function trySend(input) {
    const SEND_WAIT = 1500;
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
    await sleep(SEND_WAIT);
    if (input.value === '' || input.disabled) return true;

    const inputRect = input.getBoundingClientRect();
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      if (!btn.offsetParent) continue;
      const rect = btn.getBoundingClientRect();
      if (Math.abs(rect.bottom - inputRect.bottom) < 150) {
        btn.click();
        await sleep(SEND_WAIT);
        if (input.value === '' || input.disabled) return true;
      }
    }

    for (const btn of allBtns) {
      if (!btn.offsetParent || !btn.querySelector('svg')) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.5 && rect.top < window.innerHeight) {
        btn.click();
        await sleep(SEND_WAIT);
        if (input.value === '' || input.disabled) return true;
      }
    }

    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      ctrlKey: true, bubbles: true, cancelable: true, composed: true
    }));
    await sleep(SEND_WAIT);
    if (input.value === '' || input.disabled) return true;

    for (const btn of allBtns) {
      if (!btn.offsetParent || btn.disabled) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.55 && rect.top < window.innerHeight) {
        btn.click();
        await sleep(SEND_WAIT);
        if (input.value === '' || input.disabled) return true;
      }
    }

    return false;
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
    sseActive = true;
    const reader = response.body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();
    let buffer = '', chunkCount = 0, inResponse = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (requestId !== activeRequestId) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          if (requestId !== activeRequestId) break;
          try {
            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            const data = JSON.parse(jsonStr);
            const result = extractSSEText(data, inResponse);
            if (result.text && requestId === activeRequestId) {
              chunkCount++;
              chrome.runtime.sendMessage({ type: 'chunk', content: result.text, requestId }).catch(() => {});
            }
            if (result.enteredResponse) inResponse = true;
          } catch {}
        }
      }
    } finally {
      if (currentReader === reader) currentReader = null;
      sseActive = false;
      if (requestId === activeRequestId && chunkCount > 0) {
        dbg(`SSE: stream done (${chunkCount} chunks)`);
        chrome.runtime.sendMessage({ type: 'done', requestId }).catch(() => {});
      }
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---- Init ----
  dbg('Content script loaded [' + window._chatfree_injection_id + '] on ' + location.href);
  installSSEInterceptor();
})();
