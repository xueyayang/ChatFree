// modules/site-gemini.js
// Site adapter: Gemini (gemini.google.com/app)
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
    name: 'gemini',

    // -- Needs visible input for trySend button detection --
    needsVisibleInput: true,

    // -- Override: contenteditable div fill protocol --
    // Gemini uses a contenteditable div for rich-text input, similar to ChatGPT.
    fillInput: async function(input, message) {
      if (input.getAttribute('contenteditable') === 'true' ||
          input.tagName === 'DIV' || input.tagName === 'P') {
        input.textContent = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
        input.textContent = message;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      // Fallback: textarea / input
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
    },

    // -- Override: cleared detection for both contenteditable and textarea --
    isCleared: function(input) {
      if (input.getAttribute('contenteditable') === 'true' ||
          input.tagName === 'DIV' || input.tagName === 'P') {
        return (input.textContent || '').trim() === '';
      }
      return (input.value || '') === '';
    },

    // -- Input selectors (tried in order) --
    inputSelectors: [
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea div[contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Gemini" i]',
      '[role="textbox"]',
      'textarea'
    ],

    // -- Find the input container to hide --
    // Three-tier fallback:
    //   L1 — ancestor with Gemini layout class patterns
    //   L2 — geometry: ancestor pinned to viewport bottom
    //   L3 — return null, hideNativeInput falls back to hiding input only
    findInputContainer(textareaEl) {
      // L1: Google / Gemini class patterns
      let el = textareaEl;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el || el === document.body || el === document.documentElement) break;
        const cls = el.className || '';
        if (typeof cls === 'string' &&
            (cls.includes('input-area') ||
             cls.includes('chat-input') ||
             cls.includes('composer') ||
             cls.includes('query-bar') ||
             cls.includes('text-input') ||
             cls.includes('bottom-') ||
             cls.includes('footer') ||
             cls.includes('chat-container'))) {
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
    // Google Gemini uses streaming endpoints.
    matchSSEUrl(url) {
      return url.includes('/chat/') ||
             url.includes('/stream') ||
             url.includes('generateContent') ||
             url.includes('streamGenerateContent') ||
             url.includes('/v1beta/') ||
             url.includes('/v1/') ||
             url.includes('gemini.googleapis.com') ||
             url.includes('/api/');
    },

    // -- SSE: text extraction --
    // Google Gemini SSE format:
    //   { candidates: [{ content: { parts: [{ text: '...' }] } }] }
    // Also handles OpenAI-compatible (Gemini API compatibility mode) and generic.
    extractSSEText(data) {
      // Primary: Gemini native format
      // { candidates: [{ content: { parts: [{ text: '...' }] } }] }
      if (data.candidates && Array.isArray(data.candidates)) {
        const texts = [];
        for (const c of data.candidates) {
          if (c.content && c.content.parts && Array.isArray(c.content.parts)) {
            for (const p of c.content.parts) {
              if (typeof p.text === 'string') texts.push(p.text);
            }
          } else if (c.content && typeof c.content === 'string') {
            texts.push(c.content);
          }
        }
        const text = texts.join('');
        return { text, enteredResponse: text.length > 0 };
      }

      // OpenAI-compatible: { choices: [{ delta: { content: '...' } }] }
      if (data.choices && Array.isArray(data.choices)) {
        const text = data.choices
          .map(c => (c.delta && c.delta.content) || c.content || '').join('');
        return { text, enteredResponse: text.length > 0 };
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

      return { text: '', enteredResponse: false };
    }
  };
})();
