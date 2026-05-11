// background.js - ChatFree service worker
// Relays messages between popup and content script.

const DS_BASE = 'https://chat.deepseek.com';

// ---- Message dispatcher ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Messages FROM popup (commands)
  if (msg.action === 'checkLogin') {
    checkDeepSeekLogin().then(result => sendResponse(result));
    return true;
  }

  if (msg.action === 'chat') {
    forwardChatToContentScript(msg.message, msg.backend);
    return false;
  }

  // Messages FROM content script (stream events) — forward to popup
  if (msg.type === 'chunk' || msg.type === 'done' || msg.type === 'error') {
    safeSend(msg);
    return false;
  }
});

// ---- Login detection ----
async function checkDeepSeekLogin() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'chat.deepseek.com' });
    const hasSession = cookies.some(c =>
      c.name === 'ds_session_id' ||
      c.name.includes('session') ||
      c.name.includes('token') ||
      (c.value && c.value.startsWith('eyJ'))
    );
    console.log('[ChatFree] login check:', { cookieCount: cookies.length, hasSession });
    return { loggedIn: hasSession };
  } catch (e) {
    console.log('[ChatFree] login check error:', e.message);
    return { loggedIn: false };
  }
}

// ---- Forward chat to content script ----
async function forwardChatToContentScript(message, backend) {
  if (backend !== 'deepseek') {
    safeSend({ type: 'error', error: `Backend "${backend}" not yet supported` });
    return;
  }

  try {
    const tabs = await chrome.tabs.query({ url: `${DS_BASE}/*` });
    if (tabs.length === 0) {
      safeSend({ type: 'error', error: 'No DeepSeek tab open. Visit chat.deepseek.com first.' });
      return;
    }

    const tabId = tabs[0].id;
    console.log('[ChatFree] forwarding chat to content script in tab:', tabId);
    await chrome.tabs.sendMessage(tabId, { action: 'chat', message });
  } catch (err) {
    // If content script hasn't loaded yet, try injecting it
    if (err.message.includes('Could not establish connection') || err.message.includes('receiving end does not exist')) {
      console.log('[ChatFree] content script not ready, injecting...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: (await chrome.tabs.query({ url: `${DS_BASE}/*` }))[0].id },
          files: ['content.js']
        });
        // Retry sending
        const tabs = await chrome.tabs.query({ url: `${DS_BASE}/*` });
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
    // Popup might be closed; ignore
  }
}
