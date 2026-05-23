// app.js - ChatFree compose-and-copy assistant
// Two modes: popup (standalone window) and floating (injected via iframe into AI platforms).
// Compose messages with preset rules, copy to clipboard, paste manually.

import { createInputAreaModule } from './modules/input-area.js';

// ---- localStorage debug log ----
const DEBUG_LOG_KEY = 'chatfree_app_log';
const DEBUG_LOG_MAX = 500;

// ---- Mode detection ----
const MODE_FLOATING = new URLSearchParams(location.search).get('mode') === 'floating';

// ---- State ----
const state = {
  activeSite: detectSite()  // which site icon is selected (for history tracking)
};

function detectSite() {
  if (MODE_FLOATING) {
    try {
      const parentUrl = document.referrer || '';
      if (parentUrl.includes('chat.deepseek.com')) return 'deepseek';
      if (parentUrl.includes('chatgpt.com')) return 'chatgpt';
      if (parentUrl.includes('doubao.com')) return 'doubao';
      if (parentUrl.includes('qianwen.com') || parentUrl.includes('tongyi.aliyun.com')) return 'qianwen';
      if (parentUrl.includes('gemini.google.com')) return 'gemini';
    } catch (_) {}
  }
  return 'deepseek';
}

const $ = (sel) => document.querySelector(sel);

// ---- DOM refs ----
const inputArea = $('#input-area');
const debugPanel = $('#debug-panel');
const debugLog = $('#debug-log');
let debugToggle = null;

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  if (MODE_FLOATING) {
    document.body.classList.add('floating-mode');
  }

  restoreDebugLog();

  // Init input area module
  const inputModule = createInputAreaModule({ container: inputArea, state, utils });
  inputModule.init();

  // Debug panel (hidden by default in floating mode)
  if (MODE_FLOATING) {
    debugPanel.classList.add('hidden');
  }
  const debugToggleEl = $('#debug-toggle');
  if (debugToggleEl) {
    debugToggle = debugToggleEl;
    debugToggle.addEventListener('click', toggleDebugPanel);
  }
  document.getElementById('debug-clear').addEventListener('click', clearDebugLog);
  document.getElementById('debug-copy').addEventListener('click', copyDebugLog);

  // Debug test buttons
  const sc = inputModule.serverClient();
  document.querySelectorAll('.dbt-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const test = btn.dataset.test;
      btn.classList.add('testing');
      try {
        await runDebugTest(test, sc);
      } finally {
        btn.classList.remove('testing');
      }
    });
  });

  // Debug panel resize (drag top edge)
  const debugResize = document.getElementById('debug-resize');
  const DEBUG_MIN_H = 100;
  let dbgResizing = false, dbgStartY = 0, dbgStartH = 0;
  debugResize.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dbgResizing = true;
    dbgStartY = e.clientY;
    dbgStartH = debugPanel.offsetHeight;
    debugPanel.classList.add('resizing');
  });
  document.addEventListener('mousemove', (e) => {
    if (!dbgResizing) return;
    const dy = e.clientY - dbgStartY;
    const h = Math.max(DEBUG_MIN_H, dbgStartH - dy);
    debugPanel.style.height = h + 'px';
    debugPanel.style.maxHeight = 'none';
  });
  document.addEventListener('mouseup', () => {
    if (!dbgResizing) return;
    dbgResizing = false;
    debugPanel.classList.remove('resizing');
  });

  appendDebug('app', `Ready (${MODE_FLOATING ? 'floating' : 'popup'} mode, site=${state.activeSite})`);
});

async function runDebugTest(test, sc) {
  switch (test) {
    case 'health': {
      appendDebug('test', 'GET /health ...');
      const ok = await sc.checkHealth();
      const d = sc.lastDiag();
      const info = JSON.stringify({ status: d?.status, body: d?.body, error: d?.error });
      appendDebug('test', `health → ${info}`, ok ? '' : 'err');
      break;
    }
    case 'wait': {
      appendDebug('test', 'POST /execute wait 500ms ...');
      const r = await sc.sendActions([{ type: 'wait', ms: 500 }]);
      appendDebug('test', `wait → ${JSON.stringify(r)}`, r.ok ? '' : 'err');
      break;
    }
    case 'type': {
      appendDebug('test', 'POST /execute type "Hello ChatFree" ...');
      const r = await sc.sendActions([{ type: 'type', text: 'Hello ChatFree' }]);
      appendDebug('test', `type → ${JSON.stringify(r)}`, r.ok ? '' : 'err');
      break;
    }
    case 'paste': {
      appendDebug('test', 'POST /execute Ctrl+V ...');
      const r = await sc.sendActions([{ type: 'key', key: 'V', modifiers: ['Ctrl'] }]);
      appendDebug('test', `paste → ${JSON.stringify(r)}`, r.ok ? '' : 'err');
      break;
    }
    case 'full': {
      appendDebug('test', 'pasteAndSubmit: focus → paste → Enter ...');
      window.parent.postMessage({ type: 'chatfree-focus-input' }, '*');
      await new Promise(r => setTimeout(r, 350));
      const r = await sc.pasteAndSubmit();
      appendDebug('test', `full → ${JSON.stringify(r)}`, r.ok ? '' : 'err');
      break;
    }
    case 'focus': {
      appendDebug('test', 'postMessage chatfree-focus-input');
      window.parent.postMessage({ type: 'chatfree-focus-input' }, '*');
      break;
    }
    case 'collapse': {
      appendDebug('test', 'postMessage chatfree-collapse');
      window.parent.postMessage({ type: 'chatfree-collapse' }, '*');
      break;
    }
  }
}

// ---- Debug panel ----
function toggleDebugPanel() {
  const visible = debugPanel.classList.toggle('hidden');
  debugToggle.classList.toggle('active', !visible);
}

function restoreDebugLog() {
  try {
    const raw = localStorage.getItem(DEBUG_LOG_KEY);
    if (!raw) return;
    const logs = JSON.parse(raw);
    if (!logs.length) return;
    if (debugLog.querySelector('.debug-empty')) debugLog.innerHTML = '';
    logs.forEach(({ t, s, m, l }) => {
      const time = new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const entry = document.createElement('div');
      entry.className = 'debug-entry' + (l ? ' ' + l : '');
      const timeEl = document.createElement('span');
      timeEl.className = 'debug-time';
      timeEl.textContent = time;
      const srcEl = document.createElement('span');
      srcEl.className = 'debug-source ' + s;
      srcEl.textContent = s;
      const msgEl = document.createElement('span');
      msgEl.className = 'debug-msg';
      msgEl.textContent = m;
      entry.appendChild(timeEl);
      entry.appendChild(srcEl);
      entry.appendChild(msgEl);
      debugLog.appendChild(entry);
    });
    debugLog.scrollTop = debugLog.scrollHeight;
  } catch (_) {}
}

function clearDebugLog() {
  debugLog.innerHTML = '<div class="debug-empty">Log cleared</div>';
  try { localStorage.removeItem(DEBUG_LOG_KEY); } catch (_) {}
}

function copyDebugLog() {
  const entries = debugLog.querySelectorAll('.debug-entry');
  const lines = [];
  entries.forEach(entry => {
    const time = entry.querySelector('.debug-time')?.textContent || '';
    const source = entry.querySelector('.debug-source')?.textContent || '';
    const msg = entry.querySelector('.debug-msg')?.textContent || '';
    lines.push(`${time} [${source}] ${msg}`);
  });
  const text = lines.join('\n');
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      appendDebug('app', 'Debug log copied to clipboard');
    }).catch(() => {
      appendDebug('app', 'Failed to copy debug log', 'err');
    });
  }
}

function appendDebug(source, msg, level) {
  if (debugLog.querySelector('.debug-empty')) debugLog.innerHTML = '';

  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const entry = document.createElement('div');
  entry.className = 'debug-entry' + (level ? ' ' + level : '');

  const timeEl = document.createElement('span');
  timeEl.className = 'debug-time';
  timeEl.textContent = time;

  const srcEl = document.createElement('span');
  srcEl.className = 'debug-source ' + source;
  srcEl.textContent = source;

  const msgEl = document.createElement('span');
  msgEl.className = 'debug-msg';
  msgEl.textContent = msg;

  entry.appendChild(timeEl);
  entry.appendChild(srcEl);
  entry.appendChild(msgEl);
  debugLog.appendChild(entry);

  debugLog.scrollTop = debugLog.scrollHeight;

  while (debugLog.children.length > 200) {
    debugLog.firstElementChild.remove();
  }

  try {
    const logs = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || '[]');
    const entry = { t: Date.now(), s: source, m: msg };
    if (level) entry.l = level;
    logs.push(entry);
    if (logs.length > DEBUG_LOG_MAX) logs.splice(0, logs.length - DEBUG_LOG_MAX);
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(logs));
  } catch (_) {}
}

// ---- Utilities ----
const utils = {
  appendDebug
};
