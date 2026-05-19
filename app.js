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
const siteIcons = document.querySelectorAll('.site-icon');
const inputArea = $('#input-area');
const debugToggle = $('#debug-toggle');
const debugPanel = $('#debug-panel');
const debugLog = $('#debug-log');

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  if (MODE_FLOATING) {
    document.body.classList.add('floating-mode');
  }

  restoreDebugLog();

  // Init input area module
  const inputModule = createInputAreaModule({ container: inputArea, state, utils });
  inputModule.init();

  // Site icon clicks — highlight selection
  siteIcons.forEach(icon => {
    icon.addEventListener('click', () => selectSite(icon.dataset.site));
  });

  // Site icon drag-to-reorder
  initIconDragReorder();

  // Debug panel (hidden by default in floating mode)
  if (MODE_FLOATING) {
    debugPanel.classList.add('hidden');
  }
  debugToggle.addEventListener('click', toggleDebugPanel);
  document.getElementById('debug-clear').addEventListener('click', clearDebugLog);
  document.getElementById('debug-copy').addEventListener('click', copyDebugLog);

  // Initial selection
  updateSiteIconStates();

  appendDebug('app', `Ready (${MODE_FLOATING ? 'floating' : 'popup'} mode, site=${state.activeSite})`);
});

// ---- Site selection ----
function selectSite(site) {
  state.activeSite = site;
  updateSiteIconStates();
  appendDebug('app', `Site selected: ${site}`);
}

function updateSiteIconStates() {
  siteIcons.forEach(icon => {
    icon.classList.toggle('active', icon.dataset.site === state.activeSite);
  });
}

// ---- Icon drag reorder ----
function initIconDragReorder() {
  const container = document.getElementById('site-icons');
  let dragSrc = null;

  const saved = localStorage.getItem('iconOrder');
  if (saved) {
    try {
      const order = JSON.parse(saved);
      order.forEach(site => {
        const icon = container.querySelector(`[data-site="${site}"]`);
        if (icon) container.appendChild(icon);
      });
    } catch (_) { /* ignore */ }
  }

  container.addEventListener('dragstart', (e) => {
    const icon = e.target.closest('.site-icon');
    if (!icon) return;
    dragSrc = icon;
    icon.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', icon.dataset.site);
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    container.querySelectorAll('.site-icon').forEach(el => {
      el.classList.remove('drag-target-left', 'drag-target-right');
    });

    const icon = e.target.closest('.site-icon');
    if (!icon || icon === dragSrc) return;

    const rect = icon.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) {
      icon.classList.add('drag-target-left');
    } else {
      icon.classList.add('drag-target-right');
    }
  });

  container.addEventListener('dragleave', (e) => {
    const icon = e.target.closest('.site-icon');
    if (icon && !icon.contains(e.relatedTarget)) {
      icon.classList.remove('drag-target-left', 'drag-target-right');
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.querySelectorAll('.site-icon').forEach(el => {
      el.classList.remove('drag-target-left', 'drag-target-right');
    });

    const icon = e.target.closest('.site-icon');
    if (!icon || !dragSrc || icon === dragSrc) return;

    const rect = icon.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) {
      container.insertBefore(dragSrc, icon);
    } else {
      container.insertBefore(dragSrc, icon.nextSibling);
    }

    saveIconOrder();
  });

  container.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    container.querySelectorAll('.site-icon').forEach(el => {
      el.classList.remove('drag-target-left', 'drag-target-right');
    });
    dragSrc = null;
  });
}

function saveIconOrder() {
  const container = document.getElementById('site-icons');
  const order = [];
  container.querySelectorAll('.site-icon').forEach(icon => {
    order.push(icon.dataset.site);
  });
  localStorage.setItem('iconOrder', JSON.stringify(order));
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
