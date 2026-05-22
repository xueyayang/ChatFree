// content-ui.js — Floating ChatFree panel injected into AI platform pages.
// Default: a draggable ball in bottom-right corner. Click to open compose panel.
// Enter copies and restores the ball.

(function () {
  'use strict';

  const PANEL_H = 160;  // ~6 lines of text

  // ---- Only inject once ----
  if (document.getElementById('chatfree-container')) return;

  // ---- Ball ----
  const ball = document.createElement('div');
  ball.id = 'chatfree-ball';
  ball.title = 'ChatFree — Click to compose';
  ball.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>`;

  // ---- Panel container ----
  const container = document.createElement('div');
  container.id = 'chatfree-container';

  // Drag handle
  const handle = document.createElement('div');
  handle.id = 'chatfree-handle';
  container.appendChild(handle);

  // Iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'chatfree-iframe';
  iframe.src = chrome.runtime.getURL('index.html?mode=floating');
  iframe.setAttribute('allow', 'clipboard-write');
  container.appendChild(iframe);

  document.body.appendChild(ball);
  document.body.appendChild(container);

  // ---- Inject styles ----
  const style = document.createElement('style');
  style.textContent = `
    /* -- Ball -- */
    #chatfree-ball {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #1a1d23;
      border: 1.5px solid #2d323c;
      color: #808896;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2147483647;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04);
      transition: transform 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s;
      user-select: none;
    }

    #chatfree-ball:hover {
      transform: scale(1.08);
      border-color: #06b6d4;
      color: #06b6d4;
      box-shadow: 0 6px 24px rgba(0,0,0,0.5), 0 0 18px rgba(6,182,212,0.25);
    }

    #chatfree-ball:active {
      transform: scale(0.95);
    }

    #chatfree-ball.hidden {
      display: none;
    }

    /* -- Panel container -- */
    #chatfree-container {
      position: fixed;
      left: 0;
      right: 0;
      width: 100%;
      height: ${PANEL_H}px;
      z-index: 2147483646;
      border-radius: 12px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
      overflow: hidden;
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      transition: box-shadow 0.2s;
    }

    #chatfree-container.visible {
      display: flex;
      flex-direction: column;
    }

    #chatfree-container.dragging {
      box-shadow: 0 14px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(6,182,212,0.2);
      transition: none;
    }

    /* -- Drag handle -- */
    #chatfree-handle {
      flex-shrink: 0;
      height: 8px;
      background: #21252e;
      cursor: grab;
      border-bottom: 1px solid #2d323c;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #chatfree-handle:hover {
      background: #282e38;
    }

    #chatfree-handle:active {
      cursor: grabbing;
    }

    #chatfree-handle::after {
      content: '';
      width: 32px;
      height: 3px;
      border-radius: 2px;
      background: #3a3f4b;
    }

    #chatfree-container.dragging #chatfree-handle {
      cursor: grabbing;
    }

    /* -- Iframe -- */
    #chatfree-iframe {
      flex: 1;
      width: 100%;
      border: none;
      background: #1a1d23;
    }
  `;
  document.head.appendChild(style);

  // ---- State ----
  let panelVisible = false;
  let ballVisible = true;
  let panelY = 0;
  let hasBeenDragged = false;

  // ---- Drag state ----
  let dragging = false;
  let dragStartY = 0;
  let dragStartTop = 0;

  // ---- Position panel ----
  function centerPanel() {
    panelY = Math.max(0, (window.innerHeight - PANEL_H) / 2);
    applyPosition();
  }

  function applyPosition() {
    container.style.top = panelY + 'px';
  }

  function clampPosition() {
    panelY = Math.max(0, Math.min(panelY, window.innerHeight - PANEL_H));
  }

  // ---- Show / Hide ----
  function showPanel() {
    if (panelVisible) return;
    if (!hasBeenDragged) centerPanel();
    clampPosition();
    applyPosition();
    container.classList.add('visible');
    panelVisible = true;
    ball.classList.add('hidden');
    ballVisible = false;
    // Auto-focus the textarea inside the iframe
    setTimeout(() => {
      iframe.contentWindow.postMessage({ type: 'chatfree-focus' }, '*');
    }, 150);
  }

  function hidePanel() {
    if (!panelVisible) return;
    container.classList.remove('visible');
    panelVisible = false;
    ball.classList.remove('hidden');
    ballVisible = true;
  }

  // ---- Focus the AI platform's chat input ----
  function focusPageInput() {
    // Try to find the chat input on the page using common selectors
    const selectors = [
      'textarea[placeholder*="消息" i]',
      'textarea[placeholder*="问题" i]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="Send" i]',
      'textarea[placeholder*="input" i]',
      '#chat-input',
      '[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea',
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) {
          el.focus();
          return;
        }
      } catch { /* invalid selector, skip */ }
    }
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           el.offsetWidth > 0 &&
           el.offsetHeight > 0;
  }

  // ---- Drag handlers ----
  function onHandleMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    dragStartY = e.clientY;
    dragStartTop = panelY;
    container.classList.add('dragging');
  }

  function onMouseMove(e) {
    if (!dragging) return;
    const dy = e.clientY - dragStartY;
    panelY = dragStartTop + dy;
    clampPosition();
    applyPosition();
    if (Math.abs(dy) > 3) {
      hasBeenDragged = true;
    }
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    container.classList.remove('dragging');
  }

  // ---- Events ----
  ball.addEventListener('click', showPanel);
  handle.addEventListener('mousedown', onHandleMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  window.addEventListener('resize', () => {
    if (!hasBeenDragged) {
      centerPanel();
    } else {
      clampPosition();
      applyPosition();
    }
  });

  // ---- postMessage from iframe ----
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'chatfree-collapse') {
      hidePanel();
    }
    if (e.data && e.data.type === 'chatfree-focus-input') {
      focusPageInput();
    }
  });

  // ---- Toggle via extension icon click ----
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle-panel') {
      if (panelVisible) {
        hidePanel();
      } else if (ballVisible) {
        showPanel();
      } else {
        ballVisible = true;
        ball.classList.remove('hidden');
      }
    }
  });

  // ---- Init ----
  centerPanel();
})();
