// app.js - ChatFree standalone page UI logic
// Uses pluggable sync modules: text-sync (read & render) or embed (iframe).
//
// Sync module interface:
//   { init(), sync(), send(text), stop() }
//
// Modules receive: { state, dom, utils }

import { createTextSyncModule } from './modules/sync-text.js';
import { createEmbedSyncModule } from './modules/sync-embed.js';

// ---- Configure marked ----
const markedLib = globalThis.marked;
const hljsLib = globalThis.hljs;
const renderer = new markedLib.Renderer();
renderer.code = function({ text, lang }) {
  const validLang = lang && hljsLib.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljsLib.highlight(text, { language: validLang }).value;
  return `<pre><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
};
markedLib.setOptions({ renderer, breaks: true, gfm: true });

// ---- Backend config ----
const BACKEND_LABELS = { deepseek: 'DeepSeek', chatgpt: 'ChatGPT', doubao: '豆包' };
const BACKEND_URLS = { deepseek: 'https://chat.deepseek.com', chatgpt: 'https://chatgpt.com', doubao: 'https://www.doubao.com/chat/' };

// ---- Shared state ----
const state = {
  backend: 'deepseek',
  moduleType: 'embed',
  loggedIn: false,
  mode: 'display',
  syncedA: 0,
  lastMdLen: 0,
  pollTimer: null,
  requestId: 0,
  streaming: false,
  currentAiBubble: null,
  currentAiRawText: '',
  sendTime: 0,
  firstChunkTime: 0
};

const $ = (sel) => document.querySelector(sel);

// ---- DOM refs ----
const messagesEl = $('#messages');
const embedArea = $('#embed-area');
const chatArea = $('#chat-area');
const inputEl = $('#message-input');
const sendBtn = $('#send-btn');
const syncBtn = $('#sync-btn');
const testBtn = $('#test-btn');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const typingEl = $('#typing-indicator');
const backendSelect = $('#backend-select');
const moduleSelect = $('#module-select');
const debugToggle = $('#debug-toggle');
const debugPanel = $('#debug-panel');
const debugLog = $('#debug-log');
const debugClear = $('#debug-clear');

// Shared DOM bundle for modules
const dom = {
  get messagesEl() { return messagesEl; },
  get inputEl() { return inputEl; },
  get sendBtn() { return sendBtn; },
  get syncBtn() { return syncBtn; },
  get statusDot() { return statusDot; },
  get statusText() { return statusText; },
  get typingEl() { return typingEl; },
  get chatArea() { return chatArea; },
  get backendLabel() { return BACKEND_LABELS[state.backend]; },
  // Embed-specific
  get containerEl() { return embedArea; }
};

// Shared utilities for modules
const utils = {
  appendDebug,
  clearEmptyState,
  marked: markedLib
};

// ---- Active sync module ----
let syncModule = null;

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  backendSelect.addEventListener('change', onBackendChange);
  moduleSelect.addEventListener('change', onModuleChange);
  debugToggle.addEventListener('click', toggleDebugPanel);
  debugClear.addEventListener('click', clearDebugLog);
  testBtn.addEventListener('click', runTestPing);
  syncBtn.addEventListener('click', () => { if (syncModule) syncModule.sync(); });
  sendBtn.addEventListener('click', () => { if (syncModule) syncModule.send(inputEl.value.trim()); });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (syncModule) syncModule.send(inputEl.value.trim());
    }
  });

  // Always set up the chrome.runtime message listener (for debug, login checks etc.)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'debug') {
      appendDebug(msg.source || 'bg', msg.message, msg.level);
    }
  });

  state.moduleType = moduleSelect.value;
  await checkLoginStatus();
  await loadModule();
});

// ---- Module management ----
async function loadModule() {
  // Stop previous module
  if (syncModule) {
    syncModule.stop();
    syncModule = null;
  }

  // Reset UI
  embedArea.classList.add('hidden');
  chatArea.style.display = '';
  inputEl.disabled = true;
  sendBtn.disabled = true;
  syncBtn.disabled = true;

  // Create new module
  const type = state.moduleType;
  appendDebug('app', 'Loading ' + type + ' module for ' + state.backend);

  if (type === 'embed') {
    syncModule = createEmbedSyncModule({ state, dom, utils });
    chatArea.style.display = 'none';
    embedArea.classList.remove('hidden');
    syncModule.init();
    // Embed has its own login flow (user logs in within iframe)
    inputEl.disabled = false;
    sendBtn.disabled = false;
    syncBtn.disabled = false;
    statusDot.className = 'waiting';
    statusText.textContent = BACKEND_LABELS[state.backend] + ' — Loading...';
  } else {
    syncModule = createTextSyncModule({ state, dom, utils });
    syncModule.init();
    renderEmptyState();
    if (state.loggedIn) {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      syncBtn.disabled = false;
      inputEl.placeholder = 'Type a message...';
      updateLoginStatus(true);
    } else {
      updateLoginStatus(false);
    }
  }
}

async function onModuleChange() {
  stopPolling();
  state.moduleType = moduleSelect.value;
  state.mode = 'display';
  state.syncedA = 0;
  state.lastMdLen = 0;
  state.streaming = false;
  state.currentAiBubble = null;
  state.currentAiRawText = '';
  state.sendTime = 0;
  state.firstChunkTime = 0;
  appendDebug('app', 'Module switched to ' + state.moduleType);
  await loadModule();
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
  stopPolling();
  state.backend = backendSelect.value;
  state.loggedIn = false;
  state.mode = 'display';
  state.syncedA = 0;
  state.lastMdLen = 0;
  state.streaming = false;
  state.currentAiBubble = null;
  state.currentAiRawText = '';
  state.sendTime = 0;
  state.firstChunkTime = 0;
  inputEl.disabled = true;
  sendBtn.disabled = true;
  syncBtn.disabled = true;
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
    updateLoginStatus(resp.loggedIn);
  } catch {
    updateLoginStatus(false);
  }
}

function updateLoginStatus(loggedIn) {
  state.loggedIn = loggedIn;
  // In embed mode, login status is handled by the iframe
  if (state.moduleType === 'embed') return;

  const label = BACKEND_LABELS[state.backend];
  statusDot.className = loggedIn ? 'connected' : 'disconnected';
  statusText.textContent = loggedIn ? label : 'Disconnected';
  inputEl.disabled = !loggedIn;
  sendBtn.disabled = !loggedIn;
  syncBtn.disabled = !loggedIn;

  if (!loggedIn) {
    inputEl.placeholder = `Log in to ${label} first...`;
    renderLoginHint();
  } else {
    inputEl.placeholder = 'Type a message...';
    if (messagesEl.children.length === 0 || messagesEl.querySelector('.login-hint')) {
      renderEmptyState();
    }
  }
}

// ---- Render helpers ----
function renderEmptyState() {
  messagesEl.innerHTML = `
    <div class="empty-state">
      <div class="icon">&#128172;</div>
      <p>Click Sync to load conversation from ${BACKEND_LABELS[state.backend]}</p>
    </div>`;
}

function renderLoginHint() {
  const label = BACKEND_LABELS[state.backend];
  const url = BACKEND_URLS[state.backend];
  messagesEl.innerHTML = `
    <div class="login-hint">
      <div class="warn-icon">&#9888;</div>
      <p>Not logged into ${label}.</p>
      <p><a href="${url}" target="_blank">Open ${label}</a> and sign in, then reopen this page.</p>
    </div>`;
}

function clearEmptyState() {
  const empty = messagesEl.querySelector('.empty-state');
  const hint = messagesEl.querySelector('.login-hint');
  if (empty) empty.remove();
  if (hint) hint.remove();
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

// ---- Test button ----
async function runTestPing() {
  testBtn.disabled = true;
  testBtn.textContent = '...';

  appendDebug('app', 'Pinging ' + state.backend + '...');

  try {
    const result = await chrome.runtime.sendMessage({ action: 'ping', backend: state.backend });

    if (result.error) {
      appendDebug('app', 'Ping FAILED: ' + result.error, 'err');
      renderPingResult(null, result.error);
    } else {
      const p = result.page || {};
      appendDebug('app', 'Ping OK: ' + p.url + ' session=' + (p.sessionId || 'none') + ' md=' + p.markdownCount);
      renderPingResult(result, null);
    }
  } catch (err) {
    appendDebug('app', 'Ping error: ' + err.message, 'err');
    renderPingResult(null, err.message);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test';
  }
}

function renderPingResult(result, error) {
  if (state.moduleType === 'embed') {
    // In embed mode, ping results go to debug only
    return;
  }
  clearEmptyState();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'ping-result';

  if (error) {
    msgDiv.innerHTML = `
      <div class="ping-header error">Connection Failed</div>
      <div class="ping-body">${escapeHtml(error)}</div>`;
  } else {
    const p = result.page || {};
    msgDiv.innerHTML = `
      <div class="ping-header ok">Page Connected</div>
      <table class="ping-table">
        <tr><td>Tab</td><td>${escapeHtml(result.tabTitle || '')} (id=${result.tabId})</td></tr>
        <tr><td>URL</td><td>${escapeHtml(p.url || '')}</td></tr>
        <tr><td>Session</td><td>${p.hasChatSession ? escapeHtml(p.sessionId || '') : 'None'}</td></tr>
        <tr><td>Markdown</td><td>${p.markdownCount || 0}</td></tr>
        <tr><td>Input</td><td>${p.inputReady ? 'Ready' : 'Not found'}</td></tr>
        <tr><td>SSE</td><td>${p.sseInterceptorActive ? 'Active' : 'Not active'}</td></tr>
        ${result.injected ? '<tr><td>Note</td><td>Content script freshly injected</td></tr>' : ''}
      </table>`;
  }

  messagesEl.appendChild(msgDiv);
  $('#chat-area').scrollTop = $('#chat-area').scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
