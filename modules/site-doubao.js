// modules/site-doubao.js
// Site adapter: Doubao / 豆包 (www.doubao.com)
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
    name: 'doubao',

    // -- Needs visible input for trySend button detection --
    needsVisibleInput: true,

    // -- Input selectors (tried in order) --
    inputSelectors: [
      '.semi-input-textarea',
      'textarea[placeholder*="发消息" i]',
      'textarea[placeholder*="消息" i]',
      'textarea[placeholder*="message" i]',
      '#chat-input',
      '[role="textbox"]',
      'textarea'
    ],

    // -- Find the input container to hide --
    // Three-tier fallback:
    //   L1 — ancestor with flex-col-reverse (stable Tailwind layout marker)
    //   L2 — geometry: ancestor pinned to viewport bottom
    //   L3 — return null, hideNativeInput falls back to hiding textarea only
    findInputContainer(textareaEl) {
      // L1: flex-col-reverse is the stable Tailwind class marking Doubao's
      //     bottom input area container (toolbar + textarea).
      let el = textareaEl;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el || el === document.body || el === document.documentElement) break;
        if (el.classList.contains('flex-col-reverse')) {
          return { el: el, method: 'struct(flex-col-reverse)' };
        }
      }

      // L2: geometry — container pinned to viewport bottom.
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

      // L3: fallback — hide textarea only.
      return null;
    },

    // -- SSE: URL matching --
    // ByteDance / Doubao uses multiple streaming API patterns.
    matchSSEUrl(url) {
      return url.includes('/api/') ||
             url.includes('/chat/') ||
             url.includes('/stream') ||
             url.includes('doubao') ||
             url.includes('ark');
    },

    // -- SSE: text extraction --
    // Tries multiple known SSE data formats.
    extractSSEText(data) {
      // DeepSeek-style: { o: 'APPEND', v: [...] }
      if (data.o === 'APPEND' && Array.isArray(data.v)) {
        const text = data.v
          .filter(f => f.type === 'RESPONSE')
          .map(f => f.content || '').join('');
        return { text, enteredResponse: text.length > 0 };
      }
      if (data.o === 'APPEND' && typeof data.v === 'string') {
        return { text: data.v, enteredResponse: true };
      }
      // OpenAI-style: { choices: [{ delta: { content: '...' } }] }
      if (data.choices && Array.isArray(data.choices)) {
        const text = data.choices
          .map(c => (c.delta && c.delta.content) || c.content || '').join('');
        return { text, enteredResponse: text.length > 0 };
      }
      // Generic: various content fields
      if (data.content && typeof data.content === 'string')
        return { text: data.content, enteredResponse: true };
      if (data.text && typeof data.text === 'string')
        return { text: data.text, enteredResponse: true };
      if (data.message && typeof data.message === 'string')
        return { text: data.message, enteredResponse: true };
      if (data.data && typeof data.data === 'string')
        return { text: data.data, enteredResponse: true };
      if (typeof data.v === 'string')
        return { text: data.v, enteredResponse: true };
      return { text: '', enteredResponse: false };
    }
  };
})();
