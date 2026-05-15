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
  }
};

// Open standalone page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
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
                     : 'content.js';
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
                         : 'content.js';
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

function debug(source, message, level) {
  safeSend({ type: 'debug', source, message, level: level || null });
}
