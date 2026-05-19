// background.js - ChatFree service worker
// Handles login checks and extension lifecycle.

const BACKENDS = {
  deepseek: {
    base: 'https://chat.deepseek.com',
    checkLogin
  },
  chatgpt: {
    base: 'https://chatgpt.com',
    checkLogin: checkChatGPTLogin
  },
  doubao: {
    base: 'https://www.doubao.com',
    checkLogin: checkDoubaoLogin
  },
  qianwen: {
    base: 'https://www.qianwen.com',
    checkLogin: checkQianwenLogin
  },
  gemini: {
    base: 'https://gemini.google.com',
    checkLogin: checkGeminiLogin
  }
};

// Open standalone page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// ============================================================
// Partitioned Cookie Mirroring for cross-origin iframe embedding
//
// When sites like Qianwen are embedded in a cross-origin iframe,
// Chrome blocks third-party cookies. The site detects "not logged in"
// and triggers navigation → infinite reload loop.
//
// Solution: mirror first-party cookies as Partitioned cookies
// (CHIPS — Cookies Having Independent Partitioned State).
// Partitioned cookies are scoped to (top-level=extension, embedded=site),
// so they are available in the iframe but invisible to normal tabs.
//
// Lifecycle: active only while the ChatFree app page is connected via port.
// ============================================================

// Domains to mirror cookies for (add more sites as needed)
const MIRROR_DOMAINS = ['www.qianwen.com', 'tongyi.aliyun.com'];

// Port-based lifecycle
let _mirrorPorts = new Set();
let _mirrorActive = false;
let _mirrorDebounceTimer = null;

chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === 'chatfree-app') {
    _mirrorPorts.add(port);
    debug('bg', 'App port connected (' + _mirrorPorts.size + ' total)');
    if (!_mirrorActive) startCookieMirroring();

    port.onDisconnect.addListener(function() {
      _mirrorPorts.delete(port);
      debug('bg', 'App port disconnected (' + _mirrorPorts.size + ' remaining)');
      if (_mirrorPorts.size === 0) stopCookieMirroring();
    });

    port.postMessage({ type: 'cookie-mirror-status', active: true });
  }
});

async function startCookieMirroring() {
  _mirrorActive = true;
  debug('bg', 'Cookie mirroring STARTED');

  // Initial full sync
  await mirrorAllCookies();

  // Listen for cookie changes
  if (!chrome.cookies.onChanged.hasListener(_onMirrorCookieChanged)) {
    chrome.cookies.onChanged.addListener(_onMirrorCookieChanged);
  }
}

async function stopCookieMirroring() {
  _mirrorActive = false;
  debug('bg', 'Cookie mirroring STOPPED');

  if (_mirrorDebounceTimer) {
    clearTimeout(_mirrorDebounceTimer);
    _mirrorDebounceTimer = null;
  }

  if (chrome.cookies.onChanged.hasListener(_onMirrorCookieChanged)) {
    chrome.cookies.onChanged.removeListener(_onMirrorCookieChanged);
  }

  // Clean up partitioned copies
  await removeAllPartitionedCookies();
}

function _onMirrorCookieChanged(changeInfo) {
  if (!_mirrorActive) return;

  // Ignore partitioned cookie changes (our own writes)
  if (changeInfo.cookie.partitionKey) return;

  const domain = changeInfo.cookie.domain || '';
  if (!MIRROR_DOMAINS.some(function(d) {
    return domain === d || domain.endsWith('.' + d);
  })) return;

  // Debounce to batch rapid changes
  if (_mirrorDebounceTimer) clearTimeout(_mirrorDebounceTimer);
  _mirrorDebounceTimer = setTimeout(mirrorAllCookies, 1000);
}

async function mirrorAllCookies() {
  const partitionKey = { topLevelSite: self.location.origin };

  for (const domain of MIRROR_DOMAINS) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      let mirrored = 0;
      for (const c of cookies) {
        try {
          await chrome.cookies.set({
            url: 'https://' + domain.replace(/^\./, '') + (c.path || '/'),
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate,
            partitionKey
          });
          mirrored++;
        } catch (_) { /* individual cookie conflict — skip */ }
      }
      debug('bg', 'Cookie mirror: ' + domain + ' — ' + mirrored + '/' + cookies.length + ' cookies');
    } catch (e) {
      debug('bg', 'Cookie mirror failed for ' + domain + ': ' + e.message, 'err');
    }
  }
}

async function removeAllPartitionedCookies() {
  const partitionKey = { topLevelSite: self.location.origin };

  for (const domain of MIRROR_DOMAINS) {
    try {
      const cookies = await chrome.cookies.getAll({ domain, partitionKey });
      let removed = 0;
      for (const c of cookies) {
        try {
          await chrome.cookies.remove({
            url: 'https://' + domain.replace(/^\./, '') + (c.path || '/'),
            name: c.name,
            partitionKey
          });
          removed++;
        } catch (_) {}
      }
      if (removed) {
        debug('bg', 'Cookie mirror cleanup: ' + domain + ' — removed ' + removed + ' partitioned cookies');
      }
    } catch (_) { /* domain may have no partitioned cookies */ }
  }
}

// ---- Message dispatcher ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'checkLogin') {
    const backend = BACKENDS[msg.backend] || BACKENDS.deepseek;
    backend.checkLogin().then(result => sendResponse(result));
    return true;
  }

  if (msg.action === 'ping') {
    pingContentScript(msg.backend).then(result => sendResponse(result));
    return true;
  }

  // Forward debug messages from content scripts to app page
  if (msg.type === 'debug') {
    safeSend(msg);
    return false;
  }

  // Connectivity test for diagnostics
  if (msg.action === 'testConnectivity') {
    testConnectivity(msg.site).then(result => sendResponse(result));
    return true;
  }
});

// ---- Login detection ----
async function checkLogin() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'chat.deepseek.com' });
    const hasSession = cookies.some(c =>
      c.name === 'ds_session_id' ||
      c.name.includes('session') ||
      c.name.includes('token') ||
      (c.value && c.value.startsWith('eyJ'))
    );
    debug('bg', 'DeepSeek login check: ' + (hasSession ? 'connected' : 'disconnected') +
      ' (' + cookies.length + ' cookies)');
    return { loggedIn: hasSession };
  } catch (e) {
    debug('bg', 'DeepSeek login check failed: ' + e.message, 'err');
    return { loggedIn: false };
  }
}

async function checkChatGPTLogin() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'chatgpt.com' });
    const hasSession = cookies.some(c =>
      c.name.includes('__Secure-next-auth.session-token') ||
      c.name.includes('__Host-next-auth') ||
      c.name === 'oai-client-id' ||
      (c.name.includes('session') && c.value && c.value.length > 20)
    );
    debug('bg', 'ChatGPT login check: ' + (hasSession ? 'connected' : 'disconnected') +
      ' (' + cookies.length + ' cookies)');
    return { loggedIn: hasSession };
  } catch (e) {
    debug('bg', 'ChatGPT login check failed: ' + e.message, 'err');
    return { loggedIn: false };
  }
}

async function checkDoubaoLogin() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'www.doubao.com' });
    const hasSession = cookies.some(c =>
      c.name.includes('session') ||
      c.name.includes('token') ||
      c.name.includes('auth') ||
      c.name.includes('login') ||
      (c.name === 'passport_csrf_token') ||
      (c.value && c.value.length > 30 && c.name.includes('sid'))
    );
    debug('bg', 'Doubao login check: ' + (hasSession ? 'connected' : 'disconnected') +
      ' (' + cookies.length + ' cookies)');
    return { loggedIn: hasSession };
  } catch (e) {
    debug('bg', 'Doubao login check failed: ' + e.message, 'err');
    return { loggedIn: false };
  }
}

async function checkQianwenLogin() {
  try {
    let hasSession = false;
    // Check both domains — login state may be on either
    for (const domain of ['www.qianwen.com', 'tongyi.aliyun.com']) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        const ok = cookies.some(c =>
          c.name.includes('session') ||
          c.name.includes('token') ||
          c.name.includes('auth') ||
          c.name.includes('login') ||
          c.name.includes('aliyun') ||
          (c.name === 'tpa_trust_security') ||
          (c.value && c.value.length > 30 && c.name.includes('sid'))
        );
        debug('bg', 'Qianwen login check (' + domain + '): ' + (ok ? 'connected' : 'disconnected') +
          ' (' + cookies.length + ' cookies)');
        if (ok) hasSession = true;
      } catch (_) {}
    }
    return { loggedIn: hasSession };
  } catch (e) {
    debug('bg', 'Qianwen login check failed: ' + e.message, 'err');
    return { loggedIn: false };
  }
}

async function checkGeminiLogin() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'gemini.google.com' });
    const hasSession = cookies.some(c =>
      c.name.includes('SAPISID') ||
      c.name.includes('__Secure-1PAPISID') ||
      c.name.includes('__Secure-3PAPISID') ||
      c.name.includes('SSID') ||
      c.name.includes('SID') ||
      c.name.includes('HSID') ||
      c.name.includes('LSID') ||
      c.name.includes('APISID') ||
      (c.name === 'SID' && c.value && c.value.length > 20)
    );
    debug('bg', 'Gemini login check: ' + (hasSession ? 'connected' : 'disconnected') +
      ' (' + cookies.length + ' cookies)');
    return { loggedIn: hasSession };
  } catch (e) {
    debug('bg', 'Gemini login check failed: ' + e.message, 'err');
    return { loggedIn: false };
  }
}

// ---- Ping content script for diagnostics ----
async function pingContentScript(backend) {
  const cfg = BACKENDS[backend];
  if (!cfg) return { error: `Backend "${backend}" not supported` };

  try {
    const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
    if (tabs.length === 0) {
      return { error: `No ${backend} tab open`, hint: `Visit ${cfg.base} first` };
    }

    const scriptFile = backend === 'chatgpt' ? 'content_chatgpt.js'
                     : backend === 'doubao' ? 'content_doubao.js'
                     : backend === 'qianwen' ? 'content_qianwen.js'
                     : backend === 'gemini' ? 'content_gemini.js'
                     : 'content_deepseek.js';
    const result = await chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' });
    return { tabId: tabs[0].id, tabTitle: tabs[0].title, page: result };
  } catch (err) {
    if (err.message.includes('Could not establish connection') ||
        err.message.includes('receiving end does not exist')) {
      try {
        const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
        if (tabs.length === 0) return { error: `No ${backend} tab open` };

        const scriptFile = backend === 'chatgpt' ? 'content_chatgpt.js'
                         : backend === 'doubao' ? 'content_doubao.js'
                         : backend === 'qianwen' ? 'content_qianwen.js'
                         : backend === 'gemini' ? 'content_gemini.js'
                         : 'content_deepseek.js';
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: [scriptFile]
        });

        const result = await chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' });
        return { tabId: tabs[0].id, tabTitle: tabs[0].title, page: result, injected: true };
      } catch (e2) {
        return { error: e2.message };
      }
    }
    return { error: err.message };
  }
}

// ---- Helpers ----
function safeSend(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // App page might be closed; ignore
  }
}

// ---- Connectivity test for diagnostics ----
async function testConnectivity(site) {
  const urls = {
    deepseek: 'https://chat.deepseek.com/',
    chatgpt: 'https://chatgpt.com/',
    doubao: 'https://www.doubao.com/chat/',
    qianwen: 'https://www.qianwen.com/',
    gemini: 'https://gemini.google.com/app'
  };
  const url = urls[site];
  if (!url) return { error: 'Unknown site: ' + site };

  try {
    const t0 = Date.now();
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      // Don't send credentials — this is just a connectivity check
    });
    const elapsed = Date.now() - t0;
    const headers = {};
    resp.headers.forEach((v, k) => {
      if (['x-frame-options', 'content-security-policy', 'x-content-type-options'].includes(k.toLowerCase())) {
        headers[k] = v;
      }
    });
    return {
      status: resp.status,
      url: resp.url,
      elapsed: elapsed + 'ms',
      relevantHeaders: headers
    };
  } catch (err) {
    return { error: err.message };
  }
}

function debug(source, message, level) {
  safeSend({ type: 'debug', source, message, level: level || null });
}
