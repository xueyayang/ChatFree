// modules/site-deepseek.js
// Site adapter: DeepSeek (chat.deepseek.com)
// Finds and hides the native input toolbar when embedded in an iframe.
//
// Interface (set on window.__ChatFreeSiteAdapter):
//   findInputContainer(textareaEl) → { el: HTMLElement, method: string } | null
//
// This is the swappable part — each target site provides its own adapter
// with the same interface.  The embedding infrastructure in content.js
// calls findInputContainer to locate the input chrome that should be
// moved off-screen.

(function() {
  window.__ChatFreeSiteAdapter = {
    name: 'deepseek',

    // Given a textarea element (the chat input), walk up the DOM to find
    // the ancestor container that represents the entire bottom input bar.
    // Returns { el, method } for logging, or null if nothing found
    // (caller falls back to hiding the textarea itself).
    findInputContainer(textareaEl) {
      // Primary: find the ancestor that also contains DeepSeek's toolbar
      // buttons.  DeepSeek uses stable design-system classes for these
      // (ds-toggle-button, ds-icon-button, ds-atom-button — the "ds-"
      // prefix is from DeepSeek's component library, not CSS-modules hash).
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

      // Fallback: geometry — container pinned to bottom of viewport.
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
