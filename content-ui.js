// content-ui.js — Floating ChatFree panel injected into AI platform pages.
// Compact bar always visible at page bottom. Toggleable via extension icon.

(function () {
  'use strict';

  const PANEL_H = 70;  // ~2 lines of text

  // ---- Only inject once ----
  if (document.getElementById('chatfree-container')) return;

  // ---- Build DOM ----
  const container = document.createElement('div');
  container.id = 'chatfree-container';

  const iframe = document.createElement('iframe');
  iframe.id = 'chatfree-iframe';
  iframe.src = chrome.runtime.getURL('index.html?mode=floating');
  iframe.setAttribute('allow', 'clipboard-write');

  container.appendChild(iframe);
  document.body.appendChild(container);

  // ---- Inject styles ----
  const style = document.createElement('style');
  style.textContent = `
    #chatfree-container {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      height: ${PANEL_H}px;
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    #chatfree-container.hidden {
      display: none;
    }

    #chatfree-iframe {
      width: 100%;
      height: 100%;
      border: 1px solid #2d323c;
      border-radius: 10px 10px 0 0;
      background: #1a1d23;
    }
  `;
  document.head.appendChild(style);

  // ---- State ----
  let visible = true;

  // ---- Toggle via extension icon click ----
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle-panel') {
      visible = !visible;
      container.classList.toggle('hidden', !visible);
    }
  });

  // ---- postMessage from iframe ----
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'chatfree-pin') {
      // no-op: pin removed
    }
    if (e.data && e.data.type === 'chatfree-collapse') {
      // no-op: panel stays visible
    }
  });
})();
