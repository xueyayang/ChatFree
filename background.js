// background.js - ChatFree service worker
// Relays messages between app page and content scripts.

const BACKENDS = {
  deepseek: {
    base: 'https://chat.deepseek.com',
    checkLogin
  },
  chatgpt: {
    base: 'https://chatgpt.com',
    checkLogin: checkChatGPTLogin
  }
};

// Open standalone page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// ---- Message dispatcher ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Messages FROM app page (commands)
  if (msg.action === 'checkLogin') {
    const backend = BACKENDS[msg.backend] || BACKENDS.deepseek;
    backend.checkLogin().then(result => sendResponse(result));
    return true;
  }

  if (msg.action === 'ping') {
    pingContentScript(msg.backend).then(result => sendResponse(result));
    return true;
  }

  if (msg.action === 'sync') {
    syncContentScript(msg.backend).then(result => sendResponse(result));
    return true;
  }

  if (msg.action === 'chat') {
    forwardChatToContentScript(msg.message, msg.backend, msg.requestId);
    return false;
  }

  // Messages FROM content script (stream events & debug) — forward to app page
  if (msg.type === 'chunk' || msg.type === 'done' || msg.type === 'error' || msg.type === 'debug') {
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

// ---- Ping content script for diagnostics ----
async function pingContentScript(backend) {
  const cfg = BACKENDS[backend];
  if (!cfg) return { error: `Backend "${backend}" not supported` };

  try {
    const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
    if (tabs.length === 0) {
      return { error: `No ${backend} tab open`, hint: `Visit ${cfg.base} first` };
    }

    const result = await chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' });
    return { tabId: tabs[0].id, tabTitle: tabs[0].title, page: result };
  } catch (err) {
    // Content script not loaded — try injecting then ping
    if (err.message.includes('Could not establish connection') || err.message.includes('receiving end does not exist')) {
      try {
        const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
        if (tabs.length === 0) {
          return { error: `No ${backend} tab open` };
        }

        const scriptFile = backend === 'chatgpt' ? 'content_chatgpt.js' : 'content.js';
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

// ---- Sync conversation state from content script ----
async function syncContentScript(backend) {
  const cfg = BACKENDS[backend];
  if (!cfg) return { error: `Backend "${backend}" not supported` };

  try {
    const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
    if (tabs.length === 0) return { error: `No ${backend} tab open` };

    const pageState = await chrome.tabs.sendMessage(tabs[0].id, { action: 'sync' });
    return { tabId: tabs[0].id, page: pageState };
  } catch (err) {
    if (err.message.includes('Could not establish connection') || err.message.includes('receiving end does not exist')) {
      try {
        const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
        if (tabs.length === 0) return { error: `No ${backend} tab open` };

        const scriptFile = backend === 'chatgpt' ? 'content_chatgpt.js' : 'content.js';
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: [scriptFile]
        });

        const pageState = await chrome.tabs.sendMessage(tabs[0].id, { action: 'sync' });
        return { tabId: tabs[0].id, page: pageState, injected: true };
      } catch (e2) {
        return { error: e2.message };
      }
    }
    return { error: err.message };
  }
}

// ---- Forward chat to content script ----
async function forwardChatToContentScript(message, backend, requestId) {
  const cfg = BACKENDS[backend];
  if (!cfg) {
    const errMsg = `Backend "${backend}" not supported`;
    safeSend({ type: 'error', error: errMsg, requestId });
    debug('bg', errMsg, 'err');
    return;
  }

  debug('bg', `Querying tabs for ${cfg.base}/*`);

  try {
    const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
    debug('bg', `Found ${tabs.length} tab(s) for ${backend}: ` +
      tabs.map(t => `id=${t.id} title="${(t.title || '').slice(0, 40)}"`).join(', '));

    if (tabs.length === 0) {
      const errMsg = `No ${backend} tab open. Visit ${cfg.base} first.`;
      safeSend({ type: 'error', error: errMsg, requestId });
      debug('bg', errMsg, 'err');
      return;
    }

    const tabId = tabs[0].id;
    debug('bg', `Sending chat message to tab ${tabId}`);
    await chrome.tabs.sendMessage(tabId, { action: 'chat', message, requestId });
    debug('bg', `Message delivered to tab ${tabId}`);
  } catch (err) {
    debug('bg', `Send attempt failed: ${err.message}`, 'warn');

    // If content script hasn't loaded yet, try injecting it
    if (err.message.includes('Could not establish connection') || err.message.includes('receiving end does not exist')) {
      try {
        const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
        const scriptFile = backend === 'chatgpt' ? 'content_chatgpt.js' : 'content.js';
        debug('bg', `Injecting ${scriptFile} into tab ${tabs[0].id}`);
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: [scriptFile]
        });
        debug('bg', `Injection OK, re-sending message to tab ${tabs[0].id}`);
        await chrome.tabs.sendMessage(tabs[0].id, { action: 'chat', message, requestId });
        debug('bg', `Message delivered after injection to tab ${tabs[0].id}`);
      } catch (e2) {
        const errMsg = `Failed to connect: ${e2.message}`;
        safeSend({ type: 'error', error: errMsg, requestId });
        debug('bg', errMsg, 'err');
      }
    } else {
      const errMsg = err.message;
      safeSend({ type: 'error', error: errMsg, requestId });
      debug('bg', errMsg, 'err');
    }
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
