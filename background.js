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
// Cookie injection for iframe embedding (PORT-BASED)
// Rules are ONLY active while the ChatFree app page is open.
// When the app page closes (port disconnects), rules are removed.
// This prevents interference with normal browser tabs.
// ============================================================

const COOKIE_INJECT_CONFIG = {
  qianwen:   { domains: ['www.qianwen.com', 'tongyi.aliyun.com', '.aliyun.com'], patterns: ['*://*.aliyun.com/*', '*://www.qianwen.com/*'] },
  doubao:    { domains: ['www.doubao.com', '.doubao.com'],                               patterns: ['*://www.doubao.com/*', '*://*.doubao.com/*'] },
  deepseek:  { domains: ['chat.deepseek.com', '.deepseek.com'],                          patterns: ['*://chat.deepseek.com/*', '*://*.deepseek.com/*'] },
  chatgpt:   { domains: ['chatgpt.com', '.chatgpt.com'],                                 patterns: ['*://chatgpt.com/*', '*://*.chatgpt.com/*'] },
  gemini:    { domains: ['gemini.google.com', '.google.com'],                            patterns: ['*://gemini.google.com/*'] }
};

const COOKIE_RULE_BASE_ID = 1000;
let _cookieRulesActive = false;
let _cookieRefreshTimer = null;
let _cookiePorts = new Set();

async function getAllCookiesForDomains(domains) {
  const results = [];
  for (const domain of domains) {
    try { const c = await chrome.cookies.getAll({ domain }); results.push(...c); } catch (_) {}
  }
  return results;
}

function buildCookieHeader(cookies) {
  if (!cookies.length) return '';
  return cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
}

async function updateCookieInjectionRules() {
  // Remove all existing cookie rules
  try {
    const oldRules = await chrome.declarativeNetRequest.getSessionRules();
    const oldIds = oldRules
      .filter(function(r) { return r.id >= COOKIE_RULE_BASE_ID && r.id < COOKIE_RULE_BASE_ID + 100; })
      .map(function(r) { return r.id; });
    if (oldIds.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: oldIds });
    }
  } catch (_) {}

  if (!_cookieRulesActive) return;

  const rules = [];
  let nextRuleId = COOKIE_RULE_BASE_ID;

  for (const site of Object.keys(COOKIE_INJECT_CONFIG)) {
    const cfg = COOKIE_INJECT_CONFIG[site];
    const cookies = await getAllCookiesForDomains(cfg.domains);
    const cookieHeader = buildCookieHeader(cookies);

    if (!cookieHeader) {
      debug('bg', 'Cookie inject: ' + site + ' — no cookies, skipping');
      continue;
    }

    for (const pattern of cfg.patterns) {
      rules.push({
        id: nextRuleId++,
        priority: 10,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Cookie', operation: 'set', value: cookieHeader }]
        },
        condition: {
          urlFilter: pattern,
          resourceTypes: ['sub_frame', 'xmlhttprequest']  // NOT main_frame — don't affect normal tabs
        }
      });
    }

    debug('bg', 'Cookie inject: ' + site + ' — ' + cookies.length + ' cookies, ' + cookieHeader.length + ' chars');
  }

  if (rules.length) {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
      debug('bg', 'Cookie inject: ' + rules.length + ' rules active');
    } catch (err) {
      debug('bg', 'Cookie inject: DNR update failed: ' + err.message, 'err');
    }
  }
}

function startCookieInjection() {
  if (_cookieRulesActive) return;
  _cookieRulesActive = true;
  debug('bg', 'Cookie injection ENABLED (app page connected)');
  updateCookieInjectionRules();

  // Refresh every 30 seconds while active
  _cookieRefreshTimer = setInterval(updateCookieInjectionRules, 30000);

  // Also refresh on cookie change
  if (chrome.cookies && chrome.cookies.onChanged) {
    if (!chrome.cookies.onChanged.hasListener(_onCookieChanged)) {
      chrome.cookies.onChanged.addListener(_onCookieChanged);
    }
  }
}

function stopCookieInjection() {
  _cookieRulesActive = false;
  debug('bg', 'Cookie injection DISABLED (app page disconnected)');
  if (_cookieRefreshTimer) { clearInterval(_cookieRefreshTimer); _cookieRefreshTimer = null; }

  // Remove all cookie rules
  updateCookieInjectionRules();
}

function _onCookieChanged(changeInfo) {
  if (!_cookieRulesActive) return;
  const cd = changeInfo.cookie.domain || '';
  const interesting = Object.values(COOKIE_INJECT_CONFIG).some(function(cfg) {
    return cfg.domains.some(function(d) {
      return cd.includes(d.replace(/^\./, '')) || d.includes(cd.replace(/^\./, ''));
    });
  });
  if (interesting) {
    if (_onCookieChanged._timer) clearTimeout(_onCookieChanged._timer);
    _onCookieChanged._timer = setTimeout(updateCookieInjectionRules, 2000);
  }
}

// ---- Port-based lifecycle management ----
chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === 'chatfree-app') {
    _cookiePorts.add(port);
    debug('bg', 'App port connected (' + _cookiePorts.size + ' total)');
    startCookieInjection();

    port.onDisconnect.addListener(function() {
      _cookiePorts.delete(port);
      debug('bg', 'App port disconnected (' + _cookiePorts.size + ' remaining)');
      if (_cookiePorts.size === 0) {
        stopCookieInjection();
      }
    });

    // Send current status
    port.postMessage({ type: 'cookie-inject-status', active: true });
  }
});

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
