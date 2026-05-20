// content-ui.js — Floating ChatFree panel injected into AI platform pages.
// Collapses to a small tab at bottom. Expands on hover. Pinnable.

(function () {
  'use strict';

  const HANDLE_H = 30;
  const PANEL_H = 388;       // iframe height (panel minus handle)
  const TOTAL_H = HANDLE_H + PANEL_H;  // 418px
  const BOTTOM_HIDDEN = -PANEL_H;      // -388px (only handle visible)

  // ---- Only inject once ----
  if (document.getElementById('chatfree-container')) return;

  // ---- Build DOM ----
  const container = document.createElement('div');
  container.id = 'chatfree-container';

  const handle = document.createElement('div');
  handle.id = 'chatfree-handle';
  handle.innerHTML = `
    <span id="chatfree-handle-label">ChatFree</span>
    <button id="chatfree-pin-btn" title="Pin open">&#128204;</button>
  `;

  const iframe = document.createElement('iframe');
  iframe.id = 'chatfree-iframe';
  iframe.src = chrome.runtime.getURL('index.html?mode=floating');
  iframe.setAttribute('allow', 'clipboard-write');

  container.appendChild(handle);
  container.appendChild(iframe);
  document.body.appendChild(container);

  // ---- Inject styles ----
  const style = document.createElement('style');
  style.textContent = `
    #chatfree-container {
      position: fixed;
      bottom: ${BOTTOM_HIDDEN}px;
      left: 0;
      width: 100%;
      height: ${TOTAL_H}px;
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      transition: bottom 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    }

    #chatfree-container.expanded {
      bottom: 0 !important;
    }

    #chatfree-handle {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      height: ${HANDLE_H}px;
      min-height: ${HANDLE_H}px;
      flex-shrink: 0;
      background: #21252e;
      border: 1px solid #2d323c;
      border-bottom: none;
      border-radius: 10px 10px 0 0;
      cursor: pointer;
      user-select: none;
    }

    #chatfree-handle-label {
      font-size: 12px;
      font-weight: 700;
      color: #99a1b3;
      letter-spacing: 0.3px;
    }

    #chatfree-pin-btn {
      position: absolute;
      right: 8px;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1px solid #3a3f4b;
      border-radius: 4px;
      background: transparent;
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      color: #808896;
    }

    #chatfree-pin-btn:hover {
      border-color: #539bf5;
      color: #e1e5eb;
    }

    #chatfree-pin-btn.pinned {
      background: #2d5a3d;
      border-color: #36854d;
      color: #7ee787;
    }

    #chatfree-iframe {
      flex: 1;
      width: 100%;
      border: 1px solid #2d323c;
      border-top: none;
      border-radius: 0 0 10px 10px;
      background: #1a1d23;
    }
  `;
  document.head.appendChild(style);

  // ---- State ----
  let pinned = false;
  let hovered = false;
  const pinBtn = handle.querySelector('#chatfree-pin-btn');

  function isExpanded() { return pinned || hovered; }

  function applyState() {
    container.classList.toggle('expanded', isExpanded());
    container.style.bottom = isExpanded() ? '0px' : BOTTOM_HIDDEN + 'px';
  }

  // ---- Hover behavior ----
  handle.addEventListener('mouseenter', () => {
    hovered = true;
    applyState();
  });

  container.addEventListener('mouseleave', (e) => {
    if (!container.contains(e.relatedTarget)) {
      hovered = false;
      applyState();
    }
  });

  // Fallback: track mouse on document to catch if iframe swallows leave event
  document.addEventListener('mousemove', (e) => {
    if (!hovered && !pinned) return;
    const rect = container.getBoundingClientRect();
    const inContainer = e.clientX >= rect.left && e.clientX <= rect.right &&
                        e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inContainer && !pinned) {
      hovered = false;
      applyState();
    } else if (inContainer && !hovered) {
      hovered = true;
      applyState();
    }
  });

  // ---- Pin ----
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pinned = !pinned;
    pinBtn.classList.toggle('pinned', pinned);
    pinBtn.title = pinned ? 'Unpin' : 'Pin open';
    pinBtn.innerHTML = pinned ? '&#128204;' : '&#128204;';
    if (pinned) {
      hovered = true;
    }
    applyState();
  });

  // ---- postMessage from iframe ----
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'chatfree-pin') {
      pinned = e.data.pinned;
      pinBtn.classList.toggle('pinned', pinned);
      applyState();
    }
    if (e.data && e.data.type === 'chatfree-collapse') {
      pinned = false;
      hovered = false;
      pinBtn.classList.remove('pinned');
      applyState();
    }
  });

  // ---- Toggle via extension icon click ----
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle-panel') {
      if (isExpanded()) {
        pinned = false;
        hovered = false;
        pinBtn.classList.remove('pinned');
      } else {
        hovered = true;
      }
      applyState();
    }
  });

  // Initial state: collapsed
  applyState();
})();
