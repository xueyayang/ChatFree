// modules/nav-guard.js
// Runs in MAIN world at document_start — before any page JavaScript.
// Intercepts all navigation APIs with full stack traces to identify
// the anti-embedding trigger in Qianwen.
//
// Manifest: "world": "MAIN", "run_at": "document_start"
//
// This is NOT an injected <script> — it's loaded natively by the browser
// as a content script in the page's main world (MV3 feature).
// It CAN access Location.prototype before page scripts run.

(function() {
  var KEY = 'chatfree_main_nav_trace';
  var OLD_KEY = 'chatfree_main_nav_prev';
  var BLOCK_ENABLED = false;

  // --- CRITICAL: Save previous page's trace before we overwrite it ---
  try {
    var old = localStorage.getItem(KEY);
    if (old) {
      localStorage.setItem(OLD_KEY, old);
      localStorage.removeItem(KEY);
    }
  } catch (_) {}

  var traces = [];

  function record(method, extra) {
    var stack = '';
    try { throw new Error(); } catch (e) {
      stack = (e.stack || '').split('\n').slice(2, 8).join(' < ');
    }

    var entry = {
      t: Date.now(),
      m: method,
      a: String(extra || '').slice(0, 300),
      s: stack.slice(0, 600)
    };
    traces.push(entry);
    if (traces.length > 50) traces.splice(0, traces.length - 50);

    try { localStorage.setItem(KEY, JSON.stringify(traces)); } catch (_) {}

    try {
      if (document.documentElement) {
        var prev = document.documentElement.getAttribute('data-chatfree-nav') || '';
        var line = '|' + method + '@' + Date.now();
        if (prev.length < 4000) {
          document.documentElement.setAttribute('data-chatfree-nav', prev + line);
        }
      }
    } catch (_) {}
  }

  // Boot marker
  document.addEventListener('DOMContentLoaded', function() {
    try {
      document.documentElement.setAttribute('data-chatfree-mainworld', '1');
    } catch (_) {}
    record('nav-guard:DOMContentLoaded', '');

    // Enable blocking 5s after DOMContentLoaded (allows initial redirects through)
    setTimeout(function() {
      BLOCK_ENABLED = true;
      record('nav-guard:block-enabled', '');
    }, 5000);
  });

  // --- Self-test: verify Location.prototype override capability ---
  var _overrideTestPassed = false;
  try {
    var testKey = '__chatfree_test_' + Date.now();
    Location.prototype[testKey] = 42;
    if (window.location[testKey] === 42) {
      _overrideTestPassed = true;
    }
    delete Location.prototype[testKey];
  } catch (_) {}
  record('nav-guard:self-test', 'Location.prototype writable=' + _overrideTestPassed);

  // --- Strategy: brute-force navigation block ---
  // Since Location.prototype overrides may not work in Chrome,
  // we save the original methods FIRST (before page code touches them),
  // then later replace them with blocking wrappers.

  var _realReload = null;
  var _realReplace = null;
  var _realAssign = null;

  try { _realReload = Location.prototype.reload; } catch (_) {}
  try { _realReplace = Location.prototype.replace; } catch (_) {}
  try { _realAssign = Location.prototype.assign; } catch (_) {}

  // Also try to get href descriptor
  var _hrefDesc = null;
  try { _hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href'); } catch (_) {}

  // Install BLOCKING wrappers after DOM is ready
  function installBlockers() {
    record('nav-guard:install-blockers', '');

    // Method 1: Override via Object.defineProperty (more forceful than assignment)
    try {
      Object.defineProperty(Location.prototype, 'reload', {
        value: function() {
          record('BLOCKED:location.reload', '');
          // Don't call original — silently block
        },
        writable: true, configurable: true
      });
      record('nav-guard:blocker-reload-ok', '');
    } catch (_) {
      record('nav-guard:blocker-reload-FAIL', String(_).slice(0, 100));
    }

    try {
      Object.defineProperty(Location.prototype, 'replace', {
        value: function(url) {
          record('BLOCKED:location.replace', String(url || '').slice(0, 200));
        },
        writable: true, configurable: true
      });
      record('nav-guard:blocker-replace-ok', '');
    } catch (_) {
      record('nav-guard:blocker-replace-FAIL', String(_).slice(0, 100));
    }

    try {
      Object.defineProperty(Location.prototype, 'assign', {
        value: function(url) {
          record('BLOCKED:location.assign', String(url || '').slice(0, 200));
        },
        writable: true, configurable: true
      });
      record('nav-guard:blocker-assign-ok', '');
    } catch (_) {
      record('nav-guard:blocker-assign-FAIL', String(_).slice(0, 100));
    }

    // Method 2: Override href setter via Object.defineProperty
    if (_hrefDesc && _hrefDesc.set) {
      try {
        Object.defineProperty(Location.prototype, 'href', {
          get: _hrefDesc.get,
          set: function(val) {
            record('BLOCKED:location.href=', String(val || '').slice(0, 200));
            // Don't call original — silently block
          },
          configurable: true, enumerable: true
        });
        record('nav-guard:blocker-href-ok', '');
      } catch (_) {
        record('nav-guard:blocker-href-FAIL', String(_).slice(0, 100));
      }
    }

    // Method 3: Try intercepting on window.location instance directly
    try {
      Object.defineProperty(window, 'location', {
        get: function() { return window.location; },
        set: function(val) {
          record('BLOCKED:window.location=', String(val || '').slice(0, 200));
        },
        configurable: true
      });
      record('nav-guard:blocker-window-loc-ok', '');
    } catch (_) {
      record('nav-guard:blocker-window-loc-FAIL', String(_).slice(0, 100));
    }

    // Method 4: Intercept document.location
    try {
      var docLocDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'location') ||
                       Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'location');
      if (docLocDesc && docLocDesc.set) {
        Object.defineProperty(Document.prototype, 'location', {
          get: docLocDesc.get || function() { return window.location; },
          set: function(val) {
            record('BLOCKED:document.location=', String(val || '').slice(0, 200));
          },
          configurable: true, enumerable: true
        });
        record('nav-guard:blocker-doc-loc-ok', '');
      }
    } catch (_) {
      record('nav-guard:blocker-doc-loc-FAIL', String(_).slice(0, 100));
    }
  }

  // Install blockers after a short delay (allow initial redirects)
  setTimeout(installBlockers, 2000);

  // --- Detect meta refresh / meta CSP ---
  document.addEventListener('DOMContentLoaded', function() {
    try {
      var metas = document.querySelectorAll('meta[http-equiv]');
      for (var i = 0; i < metas.length; i++) {
        var m = metas[i];
        var he = (m.getAttribute('http-equiv') || '').toLowerCase();
        if (he === 'refresh') {
          record('meta:refresh', m.getAttribute('content') || '?');
        }
        if (he === 'content-security-policy') {
          record('meta:csp', (m.getAttribute('content') || '').slice(0, 300));
        }
      }
    } catch (_) {}
  });

  // --- beforeunload (trace only — DON'T block with returnValue, causes UX prompt) ---
  window.addEventListener('beforeunload', function(e) {
    record('beforeunload:MAIN', window.location.href);
    try { localStorage.setItem(KEY, JSON.stringify(traces)); } catch (_) {}
  });

  // Periodic backup
  setInterval(function() {
    if (traces.length > 0) {
      try { localStorage.setItem(KEY, JSON.stringify(traces)); } catch (_) {}
    }
  }, 2000);

  record('nav-guard:init', '');
})();
