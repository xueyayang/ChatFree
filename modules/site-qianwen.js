// modules/site-qianwen.js
// Site adapter: 千问 / Qianwen (qianwen.com → tongyi.aliyun.com)
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
    name: 'qianwen',

    // -- Needs visible input for trySend button detection --
    needsVisibleInput: true,

    // -- Input selectors (tried in order) --
    inputSelectors: [
      'textarea[placeholder*="问题" i]',
      'textarea[placeholder*="消息" i]',
      'textarea[placeholder*="通义" i]',
      'textarea[placeholder*="message" i]',
      '#chat-input',
      '[contenteditable="true"][role="textbox"]',
      '[role="textbox"]',
      'textarea'
    ],

    // -- Find the input container to hide --
    // Three-tier fallback:
    //   L1 — ancestor with class markers (Alibaba Cloud Console / Tongyi patterns)
    //   L2 — geometry: ancestor pinned to viewport bottom
    //   L3 — return null, hideNativeInput falls back to hiding input only
    findInputContainer(textareaEl) {
      // L1: Alibaba Cloud Console / Tongyi class patterns
      let el = textareaEl;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el || el === document.body || el === document.documentElement) break;
        const cls = el.className || '';
        if (typeof cls === 'string' &&
            (cls.includes('chat-input') ||
             cls.includes('input-area') ||
             cls.includes('composer') ||
             cls.includes('chat-box') ||
             cls.includes('bottom-') ||
             cls.includes('footer'))) {
          return { el: el, method: 'struct(' + cls.slice(0, 30) + ')' };
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

      // L3: fallback — hide input only.
      return null;
    },

    // -- SSE: URL matching --
    // Tongyi Qianwen uses multiple streaming API patterns (OpenAI-compatible
    // plus Alibaba-specific endpoints).
    matchSSEUrl(url) {
      return url.includes('/api/') ||
             url.includes('/chat/') ||
             url.includes('/stream') ||
             url.includes('qianwen') ||
             url.includes('tongyi') ||
             url.includes('completion');
    },

    // -- SSE: text extraction --
    // Tries multiple known SSE data formats:
    //   OpenAI-style, DeepSeek-style, Alibaba Cloud service format, generic.
    extractSSEText(data) {
      // OpenAI-compatible: { choices: [{ delta: { content: '...' } }] }
      if (data.choices && Array.isArray(data.choices)) {
        const text = data.choices
          .map(c => (c.delta && c.delta.content) || c.content || '').join('');
        return { text, enteredResponse: text.length > 0 };
      }

      // Alibaba Cloud / Tongyi service format:
      //   { output: { text: '...' } } or { output: { choices: [...] } }
      if (data.output) {
        if (typeof data.output.text === 'string')
          return { text: data.output.text, enteredResponse: true };
        if (data.output.choices && Array.isArray(data.output.choices)) {
          const text = data.output.choices
            .map(c => (c.delta && c.delta.content) || c.content || c.message || '').join('');
          return { text, enteredResponse: text.length > 0 };
        }
        if (typeof data.output === 'string')
          return { text: data.output, enteredResponse: true };
      }

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

      // Generic: various content fields
      if (data.content && typeof data.content === 'string')
        return { text: data.content, enteredResponse: true };
      if (data.text && typeof data.text === 'string')
        return { text: data.text, enteredResponse: true };
      if (data.message && typeof data.message === 'string')
        return { text: data.message, enteredResponse: true };
      if (data.data && typeof data.data === 'string')
        return { text: data.data, enteredResponse: true };
      if (data.result && typeof data.result === 'string')
        return { text: data.result, enteredResponse: true };

      return { text: '', enteredResponse: false };
    }
  };
})();
