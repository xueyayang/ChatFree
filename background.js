// background.js - ChatFree service worker
// Floating panel is auto-injected by content-ui.js on matching pages.
// Icon click toggles panel visibility on the active tab.

chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'toggle-panel' });
  } catch {
    // Content script not injected — open on an unsupported page, ignore
  }
});
