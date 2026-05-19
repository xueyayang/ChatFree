// modules/content-core.js
// Shared content-script infrastructure for ChatFree embed mode.
//
// Loaded AFTER the site adapter (modules/site-*.js) which sets
// window.__ChatFreeSiteAdapter, and BEFORE the per-site content script.
//
// Exposes window.__ChatFreeCore with a single entry point:
//   Core.init(backendName) — starts the embed mode machinery.

(function() {
  // ============================================================
  // Embed detection
  // ============================================================
  var IS_EMBEDDED = false;
  var embedReason = 'top-level';
  if (window.top !== window.self) {
    try { IS_EMBEDDED = window.name === 'chatfree_embed_v1'; if (IS_EMBEDDED) embedReason = 'window.name'; } catch (_) {}
    if (!IS_EMBEDDED) {
      try { IS_EMBEDDED = window.location.hash.includes('chatfree-embed'); if (IS_EMBEDDED) embedReason = 'hash'; } catch (_) {}
    }
    if (!IS_EMBEDDED) {
      try { IS_EMBEDDED = document.referrer.startsWith('chrome-extension://'); if (IS_EMBEDDED) embedReason = 'referrer'; } catch (_) {}
    }
  }

  // Helper: log once we have a working dbg function (set after adapter check)
  var _earlyLogs = [];
  function earlyLog(msg, level) { _earlyLogs.push({ msg: msg, level: level }); }
  earlyLog('[DIAG] Step 1: embed detection — embedded=' + IS_EMBEDDED + ' reason=' + embedReason + ' top=' + (window.top !== window.self) + ' name=' + (function(){try{return window.name}catch(_){return 'err'}})());

  // Skip non-embed iframes
  if (window.top !== window.self && !IS_EMBEDDED) return;

  // ============================================================
  // Adapter reference (set by modules/site-*.js loaded before us)
  // ============================================================
  earlyLog('[DIAG] Step 2: checking adapter — found=' + !!(window.__ChatFreeSiteAdapter) + ' keys=' + (window.__ChatFreeSiteAdapter ? Object.keys(window.__ChatFreeSiteAdapter).join(',') : 'none'));

  var A = window.__ChatFreeSiteAdapter;
  if (!A) {
    console.error('[ChatFree] Site adapter not found. Load modules/site-*.js first.');
    if (IS_EMBEDDED) {
      try { window.parent.postMessage({ type: 'chatfree-log-msg', text: '[DIAG] FATAL: Site adapter not found', level: 'err' }, '*'); } catch (_) {}
    }
    return;
  }

  // Guard against double injection
  if (window._chatfree_cs_loaded) {
    earlyLog('[DIAG] Step 2b: double-injection guard triggered — already loaded (id=' + window._chatfree_injection_id + ')');
    return;
  }
  window._chatfree_cs_loaded = true;
  window._chatfree_injection_id = Math.random().toString(36).slice(2, 8);

  // Flush early logs now that we know the adapter name
  var diagPrefix = A.name.toUpperCase();

  // ============================================================
  // Module-level state
  // ============================================================
  var sseActive = false;
  var activeRequestId = 0;
  var currentReader = null;
  var _embeddedInput = null;
  var _hiddenEl = null;
  var _hideStyleEl = null;
  var _initPhase = 'start';

  // ============================================================
  // localStorage log buffer (for offline diagnostics)
  // ============================================================
  var LOCAL_LOG_KEY = 'chatfree_diag_log';
  var LOCAL_LOG_MAX = 200;
  var _localLog = [];
  try {
    var saved = localStorage.getItem(LOCAL_LOG_KEY);
    if (saved) _localLog = JSON.parse(saved);
  } catch (_) {}

  function localLog(msg, level) {
    var entry = { t: Date.now(), m: '[' + diagPrefix + '] ' + msg, l: level || null };
    _localLog.push(entry);
    if (_localLog.length > LOCAL_LOG_MAX) _localLog.splice(0, _localLog.length - LOCAL_LOG_MAX);
    try { localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(_localLog)); } catch (_) {}
  }

  // ============================================================
  // Helpers
  // ============================================================
  function dbg(msg, level) {
    // Flush early logs on first call
    if (_earlyLogs) {
      var pending = _earlyLogs;
      _earlyLogs = null;
      for (var i = 0; i < pending.length; i++) dbg(pending[i].msg, pending[i].level);
    }
    localLog(msg, level);
    if (IS_EMBEDDED) {
      try {
        window.parent.postMessage({
          type: 'chatfree-log-msg', text: '[' + diagPrefix + '] ' + msg, level: level || null
        }, '*');
      } catch (_) {}
    } else {
      try {
        chrome.runtime.sendMessage({
          type: 'debug', source: 'cs-' + A.name, message: msg, level: level || null
        }).catch(function() {});
      } catch (_) {}
    }
  }

  function reportReady() {
    if (IS_EMBEDDED) {
      try { window.parent.postMessage({ type: 'chatfree-ready' }, '*'); } catch (_) {}
    }
  }

  function reportResponseStart() {
    if (IS_EMBEDDED) {
      try { window.parent.postMessage({ type: 'chatfree-response-start' }, '*'); } catch (_) {}
    }
  }

  function reportResponseDone() {
    if (IS_EMBEDDED) {
      try { window.parent.postMessage({ type: 'chatfree-response-done' }, '*'); } catch (_) {}
    }
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  // ============================================================
  // Pluggable input helpers
  // ============================================================
  var fillInput = A.fillInput || defaultFillInput;
  var isCleared = A.isCleared || defaultIsCleared;
  var trySend   = A.trySend   || defaultTrySend;

  function defaultFillInput(input, message) {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      var nativeSetter =
        (Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') || {}).set ||
        (Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') || {}).set;
      if (nativeSetter) {
        nativeSetter.call(input, message);
      } else {
        input.value = message;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function defaultIsCleared(input) {
    return (input.value || '') === '';
  }

  function defaultTrySend(input, helpers) {
    return (async function() {
      var waitForSend = helpers.waitForSend;
      var slp = helpers.sleep;
      var log = helpers.dbg;
      var t0 = Date.now();
      await slp(200);

      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true
      }));
      input.dispatchEvent(new KeyboardEvent('keypress', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true
      }));
      var sent = await waitForSend(input, 'Enter');
      if (sent) { log('trySend: Enter worked +' + (Date.now() - t0) + 'ms'); return true; }

      var inputRect = input.getBoundingClientRect();
      var allBtns = document.querySelectorAll('button');
      for (var bi = 0; bi < allBtns.length; bi++) {
        var btn = allBtns[bi];
        if (!btn.offsetParent || btn.disabled) continue;
        var rect = btn.getBoundingClientRect();
        if (Math.abs(rect.bottom - inputRect.bottom) < 150) {
          btn.click();
          sent = await waitForSend(input, 'nearBtn');
          if (sent) { log('trySend: nearBtn worked +' + (Date.now() - t0) + 'ms'); return true; }
        }
      }

      for (bi = 0; bi < allBtns.length; bi++) {
        btn = allBtns[bi];
        if (!btn.offsetParent || !btn.querySelector('svg')) continue;
        rect = btn.getBoundingClientRect();
        if (rect.bottom > window.innerHeight * 0.5 && rect.top < window.innerHeight) {
          btn.click();
          sent = await waitForSend(input, 'svgBtn');
          if (sent) { log('trySend: svgBtn worked +' + (Date.now() - t0) + 'ms'); return true; }
        }
      }

      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        ctrlKey: true, bubbles: true, cancelable: true, composed: true
      }));
      sent = await waitForSend(input, 'Ctrl+Enter');
      if (sent) { log('trySend: Ctrl+Enter worked +' + (Date.now() - t0) + 'ms'); return true; }

      for (bi = 0; bi < allBtns.length; bi++) {
        btn = allBtns[bi];
        if (!btn.offsetParent || btn.disabled) continue;
        rect = btn.getBoundingClientRect();
        if (rect.bottom > window.innerHeight * 0.55 && rect.top < window.innerHeight) {
          btn.click();
          sent = await waitForSend(input, 'bottomBtn');
          if (sent) { log('trySend: bottomBtn worked +' + (Date.now() - t0) + 'ms'); return true; }
        }
      }

      log('trySend: all methods failed +' + (Date.now() - t0) + 'ms');
      return false;
    })();
  }

  function waitForSend(input, label) {
    return (async function() {
      var t0 = Date.now();
      for (var i = 0; i < 10; i++) {
        await sleep(200);
        if (isCleared(input) || input.disabled) {
          dbg('waitForSend[' + label + ']: cleared after ' + (Date.now() - t0) + 'ms (iter ' + (i + 1) + ')');
          return true;
        }
      }
      dbg('waitForSend[' + label + ']: timeout after ' + (Date.now() - t0) + 'ms');
      return false;
    })();
  }

  // ============================================================
  // Input: find
  // ============================================================
  function findInput(checkVisible) {
    if (checkVisible === undefined) checkVisible = true;
    var selectors = A.inputSelectors || ['textarea'];
    var tried = [];
    for (var i = 0; i < selectors.length; i++) {
      var sel = selectors[i];
      try {
        var el = document.querySelector(sel);
        var visible = el && el.offsetParent !== null;
        tried.push(sel + (el ? (visible ? '(✓v)' : '(✓h)') : '(✗)'));
        if (el && (!checkVisible || visible)) {
          if (!checkVisible) _embeddedInput = el;
          return el;
        }
      } catch (_) {}
    }
    dbg('[DIAG] findInput(' + checkVisible + ') tried: ' + tried.join(' → '));
    if (!checkVisible && _embeddedInput && document.contains(_embeddedInput)) {
      dbg('[DIAG] findInput: using cached _embeddedInput (tag=' + _embeddedInput.tagName + ')');
      return _embeddedInput;
    }
    return null;
  }

  // ============================================================
  // doChatViaDOM
  // ============================================================
  function doChatViaDOM(message, requestId) {
    return (async function() {
      var t0 = Date.now();
      installSSEInterceptor();

      activeRequestId = requestId;
      if (currentReader) {
        currentReader.cancel('superseded').catch(function() {});
        currentReader = null;
      }
      sseActive = false;

      var input = findInput(IS_EMBEDDED ? false : true);
      if (!input) throw new Error('Could not find ' + A.name + ' chat input');

      var needsRestore = false;
      var restoreIsCSS = false;
      if (IS_EMBEDDED && A.needsVisibleInput) {
        if (A.hideSelector && _hideStyleEl) {
          needsRestore = true;
          restoreIsCSS = true;
          _hideStyleEl.disabled = true;
        } else if (_hiddenEl) {
          needsRestore = true;
          var props = ['position', 'left', 'top', 'width', 'height', 'overflow'];
          for (var ri = 0; ri < props.length; ri++) {
            _hiddenEl.style.removeProperty(props[ri]);
          }
        }
      }

      try {
        input.focus();
        await fillInput(input, message);
        await sleep(300);
        dbg('doChat: input filled +' + (Date.now() - t0) + 'ms');

        var tSend = Date.now();
        var sent = await trySend(input, { waitForSend: waitForSend, sleep: sleep, dbg: dbg });
        if (!sent) throw new Error('Failed to send message');
        dbg('doChat: message sent +' + (Date.now() - t0) + 'ms (trySend took ' + (Date.now() - tSend) + 'ms, requestId=' + requestId + ')');
      } finally {
        if (needsRestore) {
          if (restoreIsCSS) {
            _hideStyleEl.disabled = false;
          } else {
            var HIDE_STYLES = {
              position: 'fixed', left: '-9999px', top: '-9999px',
              width: '1px', height: '1px', overflow: 'hidden'
            };
            var keys = Object.keys(HIDE_STYLES);
            for (var ki = 0; ki < keys.length; ki++) {
              _hiddenEl.style.setProperty(keys[ki], HIDE_STYLES[keys[ki]], 'important');
            }
          }
        }
      }
    })();
  }

  // ============================================================
  // SSE interception
  // ============================================================
  function installSSEInterceptor() {
    var self = window;
    if (self._chatfree_originalFetch) {
      if (self.fetch === self._chatfree_wrapper) return;
    }
    var originalFetch = self.fetch;
    self._chatfree_originalFetch = originalFetch;

    function wrapper(resource, options) {
      return (async function() {
        var url = typeof resource === 'string' ? resource : (resource.url || '');
        var response = await originalFetch.call(self, resource, options);

        if (A.matchSSEUrl(url) && response.ok && response.body &&
            !sseActive && activeRequestId > 0) {
          var capturedId = activeRequestId;
          dbg('SSE stream detected (requestId=' + capturedId + ')');
          var clone = response.clone();
          processSSEStream(clone, capturedId).catch(function() {});
        }
        return response;
      })();
    }

    self._chatfree_wrapper = wrapper;
    self.fetch = wrapper;
  }

  function processSSEStream(response, requestId) {
    return (async function() {
      var t0 = Date.now();
      sseActive = true;
      reportResponseStart();
      var reader = response.body.getReader();
      currentReader = reader;
      var decoder = new TextDecoder();
      var buffer = '', chunkCount = 0, inResponse = false, doneSignaled = false;
      var silenceTimer = null;
      var firstChunkAt = 0;

      function resetSilenceTimer() {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(function() {
          if (requestId === activeRequestId && sseActive) {
            dbg('SSE: trailing silence (800ms) at +' + (Date.now() - t0) + 'ms, forcing done');
            reader.cancel('silence').catch(function() {});
            doneSignaled = true;
          }
        }, 800);
      }

      try {
        resetSilenceTimer();
        dbg('SSE: waiting for stream start...');
        while (true) {
          var res = await reader.read();
          if (res.done) { dbg('SSE: reader done at +' + (Date.now() - t0) + 'ms'); break; }
          if (requestId !== activeRequestId) { dbg('SSE: requestId mismatch, aborting'); break; }
          if (doneSignaled) break;

          buffer += decoder.decode(res.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (var li = 0; li < lines.length; li++) {
            var line = lines[li];
            if (!line.startsWith('data:')) continue;
            if (requestId !== activeRequestId) break;
            try {
              var jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;
              if (jsonStr === '[DONE]') {
                dbg('SSE: [DONE] at +' + (Date.now() - t0) + 'ms (chunks=' + chunkCount + ')');
                reader.cancel('done').catch(function() {});
                doneSignaled = true;
                break;
              }
              var data = JSON.parse(jsonStr);
              var result = A.extractSSEText(data);
              if (result.text && requestId === activeRequestId) {
                chunkCount++;
                if (!firstChunkAt) firstChunkAt = Date.now();
                resetSilenceTimer();
                if (!IS_EMBEDDED) {
                  chrome.runtime.sendMessage({
                    type: 'chunk', content: result.text, requestId: requestId
                  }).catch(function() {});
                }
              }
              if (result.enteredResponse) inResponse = true;
            } catch (_) {}
          }
        }
      } finally {
        if (silenceTimer) clearTimeout(silenceTimer);
        if (currentReader === reader) currentReader = null;
        sseActive = false;
        if (requestId === activeRequestId && chunkCount > 0) {
          dbg('SSE: done +' + (Date.now() - t0) + 'ms (' + chunkCount + ' chunks)');
          if (!IS_EMBEDDED) {
            chrome.runtime.sendMessage({ type: 'done', requestId: requestId }).catch(function() {});
          }
        }
        reportResponseDone();
      }
    })();
  }

  // ============================================================
  // Embed mode: hide native input chrome
  // ============================================================
  var _lastHideTime = 0;

  function hideNativeInput() {
    _initPhase = 'hide';
    dbg('[DIAG] Step 3: hideNativeInput() called, finding input...');
    var input = findInput(false);
    if (!input) {
      _initPhase = 'retry';
      dbg('[DIAG] Step 3: input not found yet, retrying in 500ms...', 'warn');
      setTimeout(hideNativeInput, 500);
      return;
    }

    _embeddedInput = input;
    dbg('[DIAG] Step 4: input found — tag=' + input.tagName + ' id=' + (input.id || '(none)') + ' class=' + ((input.className || '').toString().slice(0, 50)) + ' contentEditable=' + input.getAttribute('contenteditable'));

    var container = (A.findInputContainer) ? (A.findInputContainer(input) || {}) : {};
    var el = container.el;
    var method = container.method;

    if (!el) { el = input; method = 'input(fallback)'; }

    _hiddenEl = el;
    dbg('[DIAG] Step 5: hiding container — tag=' + el.tagName + ' method=' + method + ' class=' + ((el.className || '').toString().slice(0, 50)));

    if (A.hideSelector) {
      var hideCSS = A.hideCSS || 'position:fixed !important;left:-9999px !important;top:-9999px !important;width:1px !important;height:1px !important;overflow:hidden !important';
      if (!_hideStyleEl) {
        _hideStyleEl = document.createElement('style');
        _hideStyleEl.id = 'chatfree-hide-style';
        _hideStyleEl.textContent = A.hideSelector + ' { ' + hideCSS + ' }';
        (document.head || document.documentElement).appendChild(_hideStyleEl);
      }
      _hideStyleEl.disabled = false;
      dbg('[DIAG] hideCSS strategy: ' + hideCSS.slice(0, 80));
    } else {
      var HIDE_STYLES = {
        position: 'fixed', left: '-9999px', top: '-9999px',
        width: '1px', height: '1px', overflow: 'hidden'
      };
      var keys = Object.keys(HIDE_STYLES);
      for (var ki = 0; ki < keys.length; ki++) {
        el.style.setProperty(keys[ki], HIDE_STYLES[keys[ki]], 'important');
      }
    }
    _lastHideTime = Date.now();
    _initPhase = 'hidden';
    dbg('[DIAG] Step 6: container hidden, reporting ready');
    reportReady();
    _initPhase = 'reported';
    installSSEInterceptor();
    _initPhase = 'complete';
    dbg('[DIAG] Step 7: SSE interceptor installed, init complete');
  }

  // ============================================================
  // beforeunload — capture navigation trigger
  // ============================================================
  window.addEventListener('beforeunload', function() {
    var navType = '';
    try { navType = (performance.getEntriesByType('navigation')[0] || {}).type || ''; } catch (_) {}
    dbg('[NAV] beforeunload phase=' + _initPhase + ' navType=' + navType + ' url=' + location.href, 'warn');
  });

  // ============================================================
  // SPA re-hide observer
  // ============================================================
  var _hideTimer = null;
  var _domObserver = new MutationObserver(function(mutations) {
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = setTimeout(function() {
      _hideTimer = null;

      var sinceLast = Date.now() - _lastHideTime;
      if (sinceLast < 3000) {
        dbg('[DIAG] MutationObserver: skip — too soon (' + sinceLast + 'ms)');
        return;
      }

      if (A.hideSelector && _hideStyleEl && !_hideStyleEl.disabled) {
        dbg('[DIAG] MutationObserver: skip — CSS rule active');
        return;
      }

      var visibleInput = findInput(true);
      if (visibleInput && document.contains(visibleInput)) {
        var rect = visibleInput.getBoundingClientRect();
        var onScreen = rect.width > 0 && rect.height > 0 &&
                       rect.bottom > 0 && rect.top < window.innerHeight;
        if (!onScreen) {
          dbg('[DIAG] MutationObserver: skip — input off-screen (rect=' +
              Math.round(rect.left) + ',' + Math.round(rect.top) + ' ' +
              Math.round(rect.width) + 'x' + Math.round(rect.height) + ')');
          return;
        }

        var reasons = [];
        for (var mi = 0; mi < mutations.length; mi++) {
          var m = mutations[mi];
          if (m.addedNodes.length) reasons.push('added=' + m.addedNodes.length);
          if (m.removedNodes.length) reasons.push('removed=' + m.removedNodes.length);
          if (m.type === 'attributes') reasons.push('attr:' + m.attributeName + '@' + (m.target.tagName || '?'));
        }
        dbg('Embed: ON-SCREEN input, re-hiding. Trigger: ' + (reasons.join(', ') || 'unknown'));
        _lastHideTime = Date.now();
        hideNativeInput();
      }
    }, 300);
  });
  _domObserver.observe(document.body, { childList: true, subtree: true, attributes: true });

  // ============================================================
  // postMessage listener
  // ============================================================
  window.addEventListener('message', function(event) {
    return (async function() {
      if (!event.data || typeof event.data.type !== 'string') return;

      if (event.data.type === 'chatfree-forward-input') {
        var text = (event.data.text || '').trim();
        if (!text) return;

        hideNativeInput();
        dbg('Embed: received forwarded input: "' + text.slice(0, 60) + (text.length > 60 ? '...' : '') + '"');

        try {
          await doChatViaDOM(text, Date.now());
          try { window.parent.postMessage({ type: 'chatfree-sent' }, '*'); } catch (_) {}
        } catch (err) {
          dbg('Embed: send failed: ' + err.message, 'err');
          try { window.parent.postMessage({ type: 'chatfree-error', text: err.message }, '*'); } catch (_) {}
        }
      }

      if (event.data.type === 'chatfree-ping') {
        hideNativeInput();
        try { window.parent.postMessage({ type: 'chatfree-pong' }, '*'); } catch (_) {}
      }

      if (event.data.type === 'chatfree-diagnose') {
        runDiagnose();
      }

      if (event.data.type === 'chatfree-dump-log') {
        try {
          window.parent.postMessage({ type: 'chatfree-dump-log-result', log: _localLog }, '*');
        } catch (_) {}
      }
    })();
  });

  function runDiagnose() {
    var report = {
      adapter: A.name,
      embedded: IS_EMBEDDED,
      embedReason: embedReason,
      injectionId: window._chatfree_injection_id,
      url: location.href,
      topWindow: (function(){try{return window.top !== window.self}catch(_){return 'cross-origin'}})(),
      frameName: (function(){try{return window.name}catch(_){return 'err'}})()
    };

    dbg('[DIAG] ====== Full Diagnostic ======');
    dbg('[DIAG] Adapter: ' + report.adapter);
    dbg('[DIAG] Embedded: ' + report.embedded + ' (' + report.embedReason + ')');
    dbg('[DIAG] Injection ID: ' + report.injectionId);
    dbg('[DIAG] URL: ' + report.url);
    dbg('[DIAG] Init phase: ' + _initPhase);

    var visInput = findInput(true);
    var hidInput = findInput(false);
    dbg('[DIAG] Visible input: ' + (visInput ? visInput.tagName + '#' + (visInput.id||'') : 'NOT FOUND'));
    dbg('[DIAG] Hidden input: ' + (hidInput ? hidInput.tagName + '#' + (hidInput.id||'') : 'NOT FOUND'));
    dbg('[DIAG] _hideStyleEl: ' + (_hideStyleEl ? 'present disabled=' + _hideStyleEl.disabled : 'null'));
    dbg('[DIAG] _lastHideTime: ' + (Date.now() - _lastHideTime) + 'ms ago');
    dbg('[DIAG] Fetch wrapped: ' + (window.fetch === window._chatfree_wrapper));

    try {
      window.parent.postMessage({ type: 'chatfree-diagnose-result', report: report }, '*');
    } catch (_) {}

    dbg('[DIAG] ====== End Diagnostic ======');
  }

  // ============================================================
  // Init
  // ============================================================
  _initPhase = 'init';
  dbg('Init complete [id=' + window._chatfree_injection_id + '] url=' + location.href + ' site=' + A.name + ' embedded=' + IS_EMBEDDED + ' reason=' + embedReason);
  hideNativeInput();
})();
