// app.js - ChatFree standalone page UI logic
// Embed-only: loads AI platform in iframe, forwards input via postMessage.

import { createEmbedSyncModule } from './modules/sync-embed.js';
import { createInputAreaModule } from './modules/input-area.js';

// ---- Backend config ----
const BACKEND_LABELS = { deepseek: 'DeepSeek', chatgpt: 'ChatGPT', doubao: '豆包' };

// ---- Shared state ----
const state = {
  backend: 'deepseek',
  loggedIn: false,
  requestId: 0
};

const $ = (sel) => document.querySelector(sel);

// ---- DOM refs ----
const embedArea = $('#embed-area');
const inputArea = $('#input-area');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const backendSelect = $('#backend-select');
const debugToggle = $('#debug-toggle');
const debugPanel = $('#debug-panel');
const debugLog = $('#debug-log');
const debugClear = $('#debug-clear');

// Shared DOM bundle for modules (inputEl/sendBtn filled in after input module init)
const dom = {
  get inputEl() { return inputModule ? inputModule.dom.inputEl : null; },
  get sendBtn() { return inputModule ? inputModule.dom.sendBtn : null; },
  get statusDot() { return statusDot; },
  get statusText() { return statusText; },
  get backendLabel() { return BACKEND_LABELS[state.backend]; },
  get containerEl() { return embedArea; }
};

// Shared utilities for modules
const utils = {
  appendDebug
};

// ---- Active modules ----
let syncModule = null;
let inputModule = null;

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  // Init input area module (builds DOM, wires internal events)
  inputModule = createInputAreaModule({ container: inputArea, state, utils });
  inputModule.init();

  inputModule.onSend((text) => {
    if (syncModule) syncModule.send(text);
  });

  inputModule.onSync(() => {
    if (syncModule) syncModule.sync();
  });

  inputModule.onTest(runTestPing);

  backendSelect.addEventListener('change', onBackendChange);
  debugToggle.addEventListener('click', toggleDebugPanel);
  debugClear.addEventListener('click', clearDebugLog);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'debug') {
      appendDebug(msg.source || 'bg', msg.message, msg.level);
    }
  });

  await checkLoginStatus();
  await loadModule();
});

// ---- Module management ----
async function loadModule() {
  if (syncModule) {
    syncModule.stop();
    syncModule = null;
  }

  embedArea.classList.add('hidden');
  inputModule.setEnabled(false);

  appendDebug('app', 'Loading embed module for ' + state.backend);

  syncModule = createEmbedSyncModule({ state, dom, utils });
  syncModule.init();
  inputModule.setEnabled(true);
  statusDot.className = 'waiting';
  statusText.textContent = BACKEND_LABELS[state.backend] + ' — Loading...';
}

// ---- Debug panel ----
function toggleDebugPanel() {
  const visible = debugPanel.classList.toggle('hidden');
  debugToggle.classList.toggle('active', !visible);
}

function clearDebugLog() {
  debugLog.innerHTML = '<div class="debug-empty">Log cleared</div>';
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
}

// ---- Backend switching ----
async function onBackendChange() {
  state.backend = backendSelect.value;
  state.loggedIn = false;
  inputModule.setEnabled(false);
  statusDot.className = '';
  statusText.textContent = 'Checking...';
  appendDebug('app', 'Backend switched to ' + state.backend);
  await checkLoginStatus();
  await loadModule();
}

// ---- Login check ----
async function checkLoginStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'checkLogin', backend: state.backend });
    state.loggedIn = resp.loggedIn;
  } catch {
    state.loggedIn = false;
  }
}

// ---- Test button ----
async function runTestPing() {
  const btn = inputModule.dom.testBtn;
  btn.disabled = true;
  btn.textContent = '...';

  appendDebug('app', 'Pinging ' + state.backend + '...');

  try {
    const result = await chrome.runtime.sendMessage({ action: 'ping', backend: state.backend });

    if (result.error) {
      appendDebug('app', 'Ping FAILED: ' + result.error, 'err');
    } else {
      const p = result.page || {};
      appendDebug('app', 'Ping OK: ' + p.url + ' session=' + (p.sessionId || 'none') + ' md=' + p.markdownCount);
    }
  } catch (err) {
    appendDebug('app', 'Ping error: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
}
