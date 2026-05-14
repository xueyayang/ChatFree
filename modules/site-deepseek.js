// modules/site-deepseek.js
// Site adapter: DeepSeek (chat.deepseek.com)
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
    name: 'deepseek',

    // -- Input selectors (tried in order) --
    inputSelectors: [
      'textarea[placeholder*="消息" i]',
      'textarea[placeholder*="问题" i]',
      'textarea[placeholder*="message" i]',
      '#chat-input',
      '[role="textbox"]',
      'textarea'
    ],

    // -- Find the input container to hide --
    // Walk up from the textarea to find the entire bottom input bar
    // (toolbar + textarea).  Returns { el, method } for logging, or null
    // to fall back to hiding the textarea itself.
    findInputContainer(textareaEl) {
      // Primary: ancestor containing DeepSeek's design-system toolbar
      // buttons.  The "ds-" prefix is from DeepSeek's component library,
      // not CSS-modules hashes — stable across deploys.
      let el = textareaEl;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el || el === document.body || el === document.documentElement) break;
        if (el.querySelector('.ds-toggle-button') ||
            el.querySelector('.ds-icon-button') ||
            el.querySelector('.ds-atom-button')) {
          return { el: el, method: 'struct(ds-buttons)' };
        }
      }

      // Fallback: geometry — container pinned to viewport bottom.
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

      return null;
    },

    // -- SSE: URL matching --
    matchSSEUrl(url) {
      return url.includes('/chat/completion');
    },

    // -- SSE: text extraction --
    // DeepSeek SSE format: { o: "APPEND", v: [{ type: "RESPONSE", content: "..." }] }
    extractSSEText(data) {
      if (data.o === 'APPEND' && Array.isArray(data.v)) {
        const responseText = data.v
          .filter(f => f.type === 'RESPONSE')
          .map(f => f.content || '').join('');
        return {
          text: responseText,
          enteredResponse: data.v.some(f => f.type === 'RESPONSE')
        };
      }
      if (data.o === 'APPEND' && typeof data.v === 'string' &&
          data.p && data.p.endsWith('/content')) {
        return { text: data.v, enteredResponse: false };
      }
      if (data.v && typeof data.v === 'string') {
        return { text: data.v, enteredResponse: false };
      }
      return { text: '', enteredResponse: false };
    }
  };
})();
