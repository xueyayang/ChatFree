// content.js - Injected into chat.deepseek.com
// Strategy: manipulate the DeepSeek page's own UI to send messages and capture responses.
// This bypasses all API auth, PoW, and WAF issues.

let observer = null;
let lastProcessedContent = '';
let streamingTarget = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'chat') {
    doChatViaDOM(msg.message).catch(err => {
      chrome.runtime.sendMessage({ type: 'error', error: err.message }).catch(() => {});
    });
    sendResponse({ accepted: true });
  }
  return true;
});

async function doChatViaDOM(message) {
  // Step 1: Ensure we're on the right page — navigate to / if needed
  if (!location.pathname.startsWith('/a/chat/')) {
    // Go to main page and wait for it to load
    console.log('[ChatFree] navigating to chat page...');
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await sleep(2000);
  }

  // Step 2: Find the input element
  const input = findInput();
  if (!input) {
    throw new Error('Could not find DeepSeek chat input on the page');
  }
  console.log('[ChatFree] found input:', input.tagName, input.className);

  // Step 3: Focus and clear the input, then type the message
  input.focus();

  // Use React-friendly approach: set native value and dispatch events
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Type character by character for React to register
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, message);
    } else {
      input.value = message;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.getAttribute('contenteditable') === 'true') {
    input.textContent = message;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  await sleep(300);

  // Step 4: Start observing BEFORE sending
  startObservingResponse();

  // Step 5: Try methods to send the message
  const sent = await trySend(input);
  if (!sent) {
    throw new Error('Failed to send message - no send method worked');
  }
  console.log('[ChatFree] message sent');
}

function findInput() {
  // DeepSeek uses a specific textarea structure
  const selectors = [
    'textarea[placeholder*="消息" i]',       // Chinese: message
    'textarea[placeholder*="问题" i]',       // Chinese: question
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="question" i]',
    '#chat-input',
    '[data-testid="chat-input"]',
    '[role="textbox"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea'                               // fallback
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el; // visible
    } catch {}
  }

  return null;
}

async function trySend(input) {
  await sleep(200);

  // Method 1: Press Enter (most reliable)
  console.log('[ChatFree] trying Enter key to send...');
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    bubbles: true, cancelable: true, composed: true
  }));
  input.dispatchEvent(new KeyboardEvent('keypress', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    bubbles: true, cancelable: true, composed: true
  }));
  await sleep(500);

  // Check if message was sent (input should be cleared or disabled)
  if (input.value === '' || input.disabled) {
    console.log('[ChatFree] Enter key worked - input cleared');
    return true;
  }

  // Method 2: Look for send button more aggressively
  console.log('[ChatFree] Enter didn\'t work, searching for button...');

  // Walk up from textarea
  let el = input;
  for (let i = 0; i < 6; i++) {
    el = el.parentElement;
    if (!el) break;
    const btns = el.querySelectorAll('button, [role="button"], div[class*="send"], span[class*="send"]');
    for (const btn of btns) {
      if (btn.offsetParent !== null) {
        // Check if it looks like a send button (near the textarea, small, with icon)
        const rect = btn.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        if (Math.abs(rect.bottom - inputRect.bottom) < 100) {
          console.log('[ChatFree] clicking send button:', btn.tagName, btn.className.slice(0, 60));
          btn.click();
          await sleep(500);
          if (input.value === '' || input.disabled) {
            console.log('[ChatFree] button click worked');
            return true;
          }
        }
      }
    }
  }

  // Method 3: Try to find and click any button with an SVG inside, in entire document
  const allBtns = document.querySelectorAll('button');
  console.log('[ChatFree] scanning', allBtns.length, 'buttons on page...');
  for (const btn of allBtns) {
    if (btn.querySelector('svg') && btn.offsetParent !== null) {
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.6) {
        // Log button details for debugging
        console.log('[ChatFree] trying button:', {
          class: btn.className?.slice(0, 60),
          ariaLabel: btn.getAttribute('aria-label'),
          title: btn.title,
          rect: [rect.x, rect.y, rect.width, rect.height]
        });
        btn.click();
        await sleep(500);
        if (input.value === '' || input.disabled) return true;
      }
    }
  }

  // Method 4: Try Ctrl+Enter or Cmd+Enter
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    ctrlKey: true, bubbles: true, cancelable: true, composed: true
  }));

  return false;
}

function startObservingResponse() {
  lastProcessedContent = '';
  streamingTarget = null;

  if (observer) observer.disconnect();

  observer = new MutationObserver(() => {
    // Look for the most recent assistant message in the chat
    const messages = document.querySelectorAll('[class*="message"]');
    console.log('[ChatFree] DOM check: found', messages.length, 'message elements');

    // Find the last assistant message
    let latestAssistant = null;
    for (const msg of messages) {
      // DeepSeek marks assistant messages with specific data or class patterns
      const text = msg.textContent || '';
      if (text.length > 0 &&
          (msg.getAttribute('data-role') === 'assistant' ||
           msg.className.includes('assistant') ||
           msg.className.includes('bot') ||
           msg.className.includes('ai') ||
           msg.className.includes('response') ||
           // Or look for messages that aren't the user's
           !msg.className.includes('user') && text.length > 10)) {
        latestAssistant = msg;
      }
    }

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

    // Check if streaming is complete (look for "FINISHED" status or stop button disappearance)
    const stopBtn = document.querySelector('[data-testid="stop-button"], button[aria-label*="stop" i], button[aria-label*="停止" i]');
    const hasLoading = document.querySelector('[class*="loading"], [class*="streaming"], [class*="generating"]');

    if (!stopBtn && !hasLoading && streamingTarget && lastProcessedContent.length > 50) {
      // Assume complete - no stop button means generation finished
      console.log('[ChatFree] streaming appears complete');
      observer.disconnect();
      chrome.runtime.sendMessage({ type: 'done' }).catch(() => {});
    }
  });

  // Observe the main chat container, or fall back to body
  const chatContainer =
    document.querySelector('[class*="chat"] [class*="message"]')?.closest('[class*="chat"]') ||
    document.querySelector('[class*="conversation"]') ||
    document.querySelector('main') ||
    document.body;

  observer.observe(chatContainer, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // Fallback: timeout after 60 seconds
  setTimeout(() => {
    if (observer) {
      observer.disconnect();
      if (lastProcessedContent.length > 0) {
        chrome.runtime.sendMessage({ type: 'done' }).catch(() => {});
      } else {
        chrome.runtime.sendMessage({ type: 'error', error: 'Response timeout (60s)' }).catch(() => {});
      }
    }
  }, 60000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
