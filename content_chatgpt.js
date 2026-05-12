// content_chatgpt.js - Injected into chatgpt.com
// Strategy: manipulate ChatGPT's own UI to send messages and capture responses via SSE.

let observer = null;
let lastProcessedContent = '';
let streamingTarget = null;
let sseActive = false;
let activeRequestId = 0;
let currentReader = null;
let observerTimeout = null;

// ---- Message handler ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'chat') {
    doChatViaDOM(msg.message).catch(err => {
      chrome.runtime.sendMessage({ type: 'error', error: err.message }).catch(() => {});
    });
    sendResponse({ accepted: true });
  }
  return true;
});

// ---- Fetch/SSE interception ----
function installSSEInterceptor() {
  const originalFetch = window.fetch;
  const self = window;
  self._chatfree_originalFetch = originalFetch;

  self.fetch = async function(resource, options) {
    const url = typeof resource === 'string' ? resource : (resource.url || '');
    const response = await originalFetch.call(self, resource, options);

    if ((url.includes('backend-api/conversation') || url.includes('chat.openai.com')) &&
        response.ok && response.body && !sseActive && activeRequestId > 0) {
      const capturedId = activeRequestId;
      const clone = response.clone();
      processSSEStream(clone, capturedId).catch(() => {});
    }

    return response;
  };
}

async function processSSEStream(response, requestId) {
  const t0 = Date.now();
  sseActive = true;

  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (observerTimeout) {
    clearTimeout(observerTimeout);
    observerTimeout = null;
  }

  const reader = response.body.getReader();
  currentReader = reader;

  const decoder = new TextDecoder();
  let buffer = '';
  let hasContent = false;
  let doneSignaled = false;
  let silenceTimer = null;
  let firstChunkAt = 0;

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (requestId === activeRequestId && sseActive) {
        const elapsed = Date.now() - t0;
        console.log('[ChatFree:ChatGPT] SSE: trailing silence (800ms) at +' + elapsed + 'ms, forcing done (hasContent=' + hasContent + ')');
        reader.cancel('silence').catch(() => {});
        doneSignaled = true;
      }
    }, 800);
  }

  function dbgSSE(msg) {
    console.log('[ChatFree:ChatGPT] SSE: ' + msg);
    chrome.runtime.sendMessage({ type: 'debug', source: 'cs-chatgpt', message: msg, level: null }).catch(() => {});
  }

  try {
    resetSilenceTimer();
    dbgSSE('waiting for stream start...');
    while (true) {
      const { done, value } = await reader.read();
      if (done) { dbgSSE('reader done at +' + (Date.now() - t0) + 'ms'); break; }

      if (requestId !== activeRequestId) { dbgSSE('requestId mismatch, aborting'); break; }
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
            dbgSSE('[DONE] received at +' + elapsed + 'ms (firstChunkAt=+' + (firstChunkAt ? firstChunkAt - t0 : '?') + 'ms)');
            reader.cancel('done').catch(() => {});
            doneSignaled = true;
            break;
          }

          const data = JSON.parse(jsonStr);

          // ChatGPT SSE format: message with content parts
          if (data.message && data.message.content) {
            const content = data.message.content;
            if (content.parts && Array.isArray(content.parts)) {
              for (const part of content.parts) {
                if (typeof part === 'string' && part.length > 0 && requestId === activeRequestId) {
                  hasContent = true;
                  if (!firstChunkAt) firstChunkAt = Date.now();
                  resetSilenceTimer();
                  chrome.runtime.sendMessage({ type: 'chunk', content: part }).catch(() => {});
                }
              }
            }
          }
        } catch {}
      }
    }
  } finally {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (currentReader === reader) {
      currentReader = null;
    }
    sseActive = false;

    if (requestId === activeRequestId && hasContent) {
      const elapsed = Date.now() - t0;
      dbgSSE('done sent +' + elapsed + 'ms (firstChunkAt=+' + (firstChunkAt ? firstChunkAt - t0 : '?') + 'ms, signaled=' + doneSignaled + ')');
      chrome.runtime.sendMessage({ type: 'done' }).catch(() => {});
    }
  }
}

function dbgChat(msg) {
  console.log('[ChatFree:ChatGPT] ' + msg);
  chrome.runtime.sendMessage({ type: 'debug', source: 'cs-chatgpt', message: msg, level: null }).catch(() => {});
}

// ---- DOM manipulation for sending ----
async function doChatViaDOM(message) {
  const t0 = Date.now();
  // ---- Reset state for the new request ----
  activeRequestId++;
  const thisRequestId = activeRequestId;

  if (currentReader) {
    currentReader.cancel('superseded').catch(() => {});
    currentReader = null;
  }
  sseActive = false;

  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (observerTimeout) {
    clearTimeout(observerTimeout);
    observerTimeout = null;
  }
  lastProcessedContent = '';
  streamingTarget = null;

  // Find the input element
  const input = findInput();
  if (!input) {
    throw new Error('Could not find ChatGPT input on the page');
  }
  console.log('[ChatFree:ChatGPT] found input:', input.tagName, input.className);

  input.focus();
  await sleep(300);

  if (input.getAttribute('contenteditable') === 'true') {
    input.textContent = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.textContent = message;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    const nativeInputValueSetter =
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, message);
    } else {
      input.value = message;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  await sleep(300);
  dbgChat('doChat: input filled +' + (Date.now() - t0) + 'ms');

  // Start DOM observer as fallback
  startObservingResponse(thisRequestId);

  const tSend = Date.now();
  const sent = await trySend(input);
  if (!sent) {
    throw new Error('Failed to send ChatGPT message');
  }
  dbgChat('doChat: message sent +' + (Date.now() - t0) + 'ms (trySend took ' + (Date.now() - tSend) + 'ms, requestId=' + thisRequestId + ')');
}

function findInput() {
  const selectors = [
    '#prompt-textarea',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="Send" i]',
    'textarea[placeholder*="Message" i]',
    'textarea[placeholder*="ChatGPT" i]',
    '[data-id="root"] div[contenteditable="true"]',
    '[role="textbox"]',
    'textarea'
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    } catch {}
  }

  // Fallback: find any contenteditable div near the bottom of the page
  const editables = document.querySelectorAll('[contenteditable="true"]');
  for (const el of editables) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight * 0.5 && el.offsetParent !== null) {
      return el;
    }
  }

  return null;
}

function isInputCleared(input) {
  return input.getAttribute('contenteditable') === 'true'
    ? (input.textContent || '').trim() === ''
    : (input.value || '') === '';
}

async function waitForSend(input, label) {
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    if (isInputCleared(input) || input.disabled) {
      dbgChat(`waitForSend[${label}]: cleared after ${Date.now() - t0}ms (iter ${i + 1})`);
      return true;
    }
  }
  dbgChat(`waitForSend[${label}]: timeout after ${Date.now() - t0}ms`);
  return false;
}

async function trySend(input) {
  const t0 = Date.now();
  await sleep(200);

  // Method 1: Press Enter
  dbgChat('trying Enter key to send...');
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    bubbles: true, cancelable: true, composed: true
  }));
  if (await waitForSend(input, 'Enter')) { dbgChat('Enter key worked +' + (Date.now() - t0) + 'ms'); return true; }

  // Method 2: Search for send button
  dbgChat('searching for send button...');
  let el = input;
  for (let i = 0; i < 6; i++) {
    el = el.parentElement;
    if (!el) break;
    const btns = el.querySelectorAll('button');
    for (const btn of btns) {
      if (btn.offsetParent !== null) {
        const rect = btn.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        if (Math.abs(rect.bottom - inputRect.bottom) < 100) {
          dbgChat('clicking button: ' + btn.tagName + ' ' + (btn.className || '').slice(0, 60));
          btn.click();
          if (await waitForSend(input, 'nearBtn')) { dbgChat('nearBtn worked +' + (Date.now() - t0) + 'ms'); return true; }
        }
      }
    }
  }

  // Method 3: Scan all buttons with SVG in bottom half
  const allBtns = document.querySelectorAll('button');
  dbgChat('scanning ' + allBtns.length + ' buttons for SVG...');
  for (const btn of allBtns) {
    if (btn.querySelector('svg') && btn.offsetParent !== null) {
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.6) {
        btn.click();
        if (await waitForSend(input, 'svgBtn')) { dbgChat('svgBtn worked +' + (Date.now() - t0) + 'ms'); return true; }
      }
    }
  }

  dbgChat('all send methods failed +' + (Date.now() - t0) + 'ms');
  return false;
}

// ---- DOM observer (fallback) ----
function startObservingResponse(requestId) {
  lastProcessedContent = '';
  streamingTarget = null;

  if (observer) observer.disconnect();
  if (observerTimeout) clearTimeout(observerTimeout);

  observer = new MutationObserver(() => {
    if (sseActive || requestId !== activeRequestId) return;

    // ChatGPT marks messages with data-message-author-role
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    let latestAssistant = null;
    for (const msg of messages) {
      if (msg.textContent && msg.textContent.length > 0) {
        latestAssistant = msg;
      }
    }

    // Fallback: look for common patterns
    if (!latestAssistant) {
      const allMessages = document.querySelectorAll('[class*="message"], [class*="markdown"], [class*="prose"]');
      for (const msg of allMessages) {
        const text = msg.textContent || '';
        if (text.length > 10 && !text.includes(inputText())) {
          latestAssistant = msg;
        }
      }
    }

    if (requestId !== activeRequestId) return;

    if (latestAssistant && latestAssistant !== streamingTarget) {
      streamingTarget = latestAssistant;
      lastProcessedContent = '';
    }

    if (streamingTarget) {
      const newText = streamingTarget.textContent || '';
      const diff = newText.slice(lastProcessedContent.length);
      if (diff.length > 0) {
        chrome.runtime.sendMessage({ type: 'chunk', content: diff }).catch(() => {});
        lastProcessedContent = newText;
      }
    }
  });

  const chatContainer =
    document.querySelector('[class*="conversation"]') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body;

  observer.observe(chatContainer, {
    childList: true,
    subtree: true,
    characterData: true
  });

  observerTimeout = setTimeout(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (sseActive || requestId !== activeRequestId) return;
    if (lastProcessedContent.length > 0) {
      chrome.runtime.sendMessage({ type: 'done' }).catch(() => {});
    } else {
      chrome.runtime.sendMessage({ type: 'error', error: 'Response timeout (60s)' }).catch(() => {});
    }
  }, 60000);
}

function inputText() {
  const input = findInput();
  if (input) {
    return input.getAttribute('contenteditable') === 'true'
      ? (input.textContent || '')
      : (input.value || '');
  }
  return '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Install interceptor on load ----
installSSEInterceptor();
