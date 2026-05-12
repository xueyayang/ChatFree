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

  if (msg.action === 'chat') {
    forwardChatToContentScript(msg.message, msg.backend);
    return false;
  }

  // Messages FROM content script (stream events) — forward to app page
  if (msg.type === 'chunk' || msg.type === 'done' || msg.type === 'error') {
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
    return { loggedIn: hasSession };
  } catch (e) {
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
    return { loggedIn: hasSession };
  } catch (e) {
    return { loggedIn: false };
  }
}

// ---- Forward chat to content script ----
async function forwardChatToContentScript(message, backend) {
  const cfg = BACKENDS[backend];
  if (!cfg) {
    safeSend({ type: 'error', error: `Backend "${backend}" not supported` });
    return;
  }

  try {
    const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
    if (tabs.length === 0) {
      safeSend({ type: 'error', error: `No ${backend} tab open. Visit ${cfg.base} first.` });
      return;
    }

    const tabId = tabs[0].id;
    await chrome.tabs.sendMessage(tabId, { action: 'chat', message });
  } catch (err) {
    // If content script hasn't loaded yet, try injecting it
    if (err.message.includes('Could not establish connection') || err.message.includes('receiving end does not exist')) {
      try {
        const tabs = await chrome.tabs.query({ url: `${cfg.base}/*` });
        const scriptFile = backend === 'chatgpt' ? 'content_chatgpt.js' : 'content.js';
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: [scriptFile]
        });
        await chrome.tabs.sendMessage(tabs[0].id, { action: 'chat', message });
      } catch (e2) {
        safeSend({ type: 'error', error: `Failed to connect: ${e2.message}` });
      }
    } else {
      safeSend({ type: 'error', error: err.message });
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
