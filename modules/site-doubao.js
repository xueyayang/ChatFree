// modules/site-doubao.js
// Site adapter: Doubao / 豆包 (www.doubao.com)
// Finds and hides the native input toolbar when embedded in an iframe.
//
// Interface (set on window.__ChatFreeSiteAdapter):
//   findInputContainer(textareaEl) → { el: HTMLElement, method: string } | null

(function() {
  window.__ChatFreeSiteAdapter = {
    name: 'doubao',

    // Given a textarea element (the chat input), walk up the DOM to find
    // the ancestor that represents the entire bottom input bar.
    findInputContainer(textareaEl) {
      // Strategy 1: find the ancestor that has BOTH the textarea AND a
      // likely send button (button with no visible text = icon button).
      let el = textareaEl;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el || el === document.body || el === document.documentElement) break;

        const buttons = el.querySelectorAll('button');
        for (const btn of buttons) {
          // Icon-only submit button — no text content, usually contains SVG
          if (!btn.offsetParent) continue;
          const text = (btn.textContent || '').trim();
          if (text === '' && btn.querySelector('svg')) {
            return { el: el, method: 'struct(icon-btn)' };
          }
        }
      }

      // Strategy 2: geometry — container pinned to viewport bottom.
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
    }
  };
})();
