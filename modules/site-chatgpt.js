// modules/site-chatgpt.js
// Site adapter: ChatGPT (chatgpt.com)
// Provides all site-specific behaviour for the shared content-core.
//
// Interface: window.__ChatFreeSiteAdapter
//   name: string
//   inputSelectors: string[]
//   findInputContainer(textareaEl) → { el, method } | null
//   matchSSEUrl(url): boolean
//   extractSSEText(data): { text: string, enteredResponse: boolean }

(function() {
  window.__ChatFreeSiteAdapter = {
    name: 'chatgpt',

    // -- Needs visible input for trySend button detection --
    needsVisibleInput: true,

    // -- Override: contenteditable div fill protocol --
    // ChatGPT uses a contenteditable div (not textarea), which needs
    // clear → sleep → set → input+change to trigger React handlers.
    fillInput: async function(input, message) {
      input.textContent = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      input.textContent = message;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },

    // -- Override: contenteditable cleared detection --
    // contenteditable divs have no .value — check textContent instead.
    isCleared: function(input) {
      return (input.textContent || '').trim() === '';
    },

    // -- Input selectors (tried in order) --
    inputSelectors: [
      '#prompt-textarea',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Send" i]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="ChatGPT" i]',
      '[role="textbox"]',
      'textarea'
    ],

    // -- Find the input container to hide --
    // ChatGPT wraps the input area in a form or a bottom-anchored container.
    findInputContainer(textareaEl) {
      // L1: find the enclosing <form> — ChatGPT uses a form for the input area
      let el = textareaEl;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el || el === document.body || el === document.documentElement) break;
        if (el.tagName === 'FORM') {
          return { el: el, method: 'struct(form)' };
        }
      }

      // L2: find ancestor with common ChatGPT layout class patterns
      el = textareaEl;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el || el === document.body || el === document.documentElement) break;
        const cls = el.className || '';
        if (typeof cls === 'string' &&
            (cls.includes('composer') ||
             cls.includes('input-area') ||
             cls.includes('chat-input'))) {
          return { el: el, method: 'struct(' + cls.slice(0, 30) + ')' };
        }
      }

      // L3: geometry — container pinned to viewport bottom
      el = textareaEl;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el || el === document.body || el === document.documentElement) break;
        const rect = el.getBoundingClientRect();
        if (rect.bottom >= window.innerHeight - 30 &&
            rect.height < window.innerHeight * 0.5) {
          return { el: el, method: 'geo(bottom)' };
        }
      }

      // L4: fallback — hide the input itself
      return null;
    },

    // -- SSE: URL matching --
    matchSSEUrl(url) {
      return url.includes('backend-api/conversation') ||
             url.includes('/conversation');
    },

    // -- SSE: text extraction --
    // ChatGPT SSE format: { message: { content: { parts: [...] } } }
    // Also handles OpenAI-style: { choices: [{ delta: { content: ... } }] }
    extractSSEText(data) {
      // Primary: ChatGPT conversation SSE format
      if (data.message && data.message.content) {
        const content = data.message.content;
        if (content.parts && Array.isArray(content.parts)) {
          const text = content.parts.filter(p => typeof p === 'string').join('');
          return { text: text, enteredResponse: text.length > 0 };
        }
        if (typeof content === 'string' && content.length > 0) {
          return { text: content, enteredResponse: true };
        }
      }

      // OpenAI-compatible: { choices: [{ delta: { content: '...' } }] }
      if (data.choices && Array.isArray(data.choices)) {
        const text = data.choices
          .map(c => (c.delta && c.delta.content) || c.content || '').join('');
        return { text, enteredResponse: text.length > 0 };
      }

      // Generic fallbacks
      if (data.content && typeof data.content === 'string')
        return { text: data.content, enteredResponse: true };
      if (data.text && typeof data.text === 'string')
        return { text: data.text, enteredResponse: true };
      if (data.message && typeof data.message === 'string')
        return { text: data.message, enteredResponse: true };
      if (data.data && typeof data.data === 'string')
        return { text: data.data, enteredResponse: true };

      return { text: '', enteredResponse: false };
    }
  };
})();
