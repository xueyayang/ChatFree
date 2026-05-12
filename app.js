// app.js - ChatFree standalone page UI logic
// Working model: sync conversation from backend page, track Q/A balance.

// ---- Backend config ----
const BACKEND_LABELS = { deepseek: 'DeepSeek', chatgpt: 'ChatGPT' };
const BACKEND_URLS = { deepseek: 'https://chat.deepseek.com', chatgpt: 'https://chatgpt.com' };

// ---- Configure marked ----
const renderer = new marked.Renderer();
renderer.code = function({ text, lang }) {
  const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language: validLang }).value;
  return `<pre><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
};
marked.setOptions({ renderer, breaks: true, gfm: true });

const state = {
  backend: 'deepseek',
  loggedIn: false,
  mode: 'display',       // 'display' | 'waiting'
  syncedA: 0,            // last known markdown count from sync
  lastMdLen: 0,          // last markdown length (for diffing during streaming)
  pollTimer: null,       // polling interval in waiting mode
  requestId: 0,
  streaming: false,
  currentAiBubble: null,
  currentAiRawText: '',
  sendTime: 0,           // Date.now() when message was sent
  firstChunkTime: 0      // Date.now() when first chunk arrived
};

const $ = (sel) => document.querySelector(sel);

const messagesEl = $('#messages');
const inputEl = $('#message-input');
const sendBtn = $('#send-btn');
const syncBtn = $('#sync-btn');
const testBtn = $('#test-btn');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const typingEl = $('#typing-indicator');
const backendSelect = $('#backend-select');
const debugToggle = $('#debug-toggle');
const debugPanel = $('#debug-panel');
const debugLog = $('#debug-log');
const debugClear = $('#debug-clear');

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  backendSelect.addEventListener('change', onBackendChange);
  debugToggle.addEventListener('click', toggleDebugPanel);
  debugClear.addEventListener('click', clearDebugLog);
  testBtn.addEventListener('click', runTestPing);
  syncBtn.addEventListener('click', runSync);
  checkLoginStatus();
  renderEmptyState();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

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
  checkLoginStatus();
}

// ---- Background message listener ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'chunk') {
    if (state.streaming && msg.requestId === state.requestId) appendChunk(msg.content);
  } else if (msg.type === 'done') {
    if (state.streaming && msg.requestId === state.requestId) finishStreaming();
  } else if (msg.type === 'error') {
    if (state.streaming && msg.requestId === state.requestId) { finishStreaming(); appendError(msg.error); }
    appendDebug('bg', 'ERROR: ' + msg.error, 'err');
  } else if (msg.type === 'debug') {
    appendDebug(msg.source || 'bg', msg.message, msg.level);
  }
});

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
    </div>
  `;
}

function renderLoginHint() {
  const label = BACKEND_LABELS[state.backend];
  const url = BACKEND_URLS[state.backend];
  messagesEl.innerHTML = `
    <div class="login-hint">
      <div class="warn-icon">&#9888;</div>
      <p>Not logged into ${label}.</p>
      <p><a href="${url}" target="_blank">Open ${label}</a> and sign in, then reopen this page.</p>
    </div>
  `;
}

// ---- Sync: core of the new model ----
async function runSync() {
  if (!state.loggedIn) return;

  syncBtn.disabled = true;
  syncBtn.textContent = '...';
  appendDebug('app', 'Syncing with ' + state.backend + '...');

  try {
    const result = await chrome.runtime.sendMessage({ action: 'sync', backend: state.backend });

    if (result.error) {
      appendDebug('app', 'Sync failed: ' + result.error, 'err');
      renderPingResult(null, result.error);
      return;
    }

    const p = result.page || {};
    const conv = p.conversation || [];
    appendDebug('app', `Sync: Q=${p.Q} A=${p.A} msgs=${conv.length} balanced=${p.balanced} streaming=${p.streaming} lastLen=${p.lastMarkdownLength} inj=${p.injectionId || '?'} chatMd=${p.chatAreaMarkdown} pageMd=${p.totalPageMarkdown}`);

    state.syncedA = p.A;
    const lastHtml = p.aiHtmls && p.aiHtmls.length > 0 ? p.aiHtmls[p.aiHtmls.length - 1] : '';
    state.lastMdLen = lastHtml.length;

    renderFullConversation(p);

    if (p.streaming && !p.hasRegenerateButton) {
      // Last response is still streaming — enter waiting mode
      state.mode = 'waiting';
      updateStatusLine('waiting');
      appendDebug('app', 'Entering waiting mode, last block is streaming');
      startPolling();
    } else {
      state.mode = 'display';
      stopPolling();
      updateStatusLine('display');
      appendDebug('app', 'Sync complete (display mode)');
    }
  } catch (err) {
    appendDebug('app', 'Sync error: ' + err.message, 'err');
    renderPingResult(null, err.message);
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync';
  }
}

function renderFullConversation(p) {
  clearEmptyState();

  const conversation = p.conversation || [];
  if (conversation.length === 0) {
    renderEmptyState();
    return;
  }

  for (let i = 0; i < conversation.length; i++) {
    const m = conversation[i];
    if (m.role === 'user') {
      appendMessage('user', m.text || '');
    } else {
      const isLastAssistant = !conversation.slice(i + 1).some(x => x.role === 'assistant');
      appendAssistantHtml(m.html || '');

      if (isLastAssistant && p.streaming) {
        state.currentAiRawText = m.html || '';
      } else if (isLastAssistant) {
        state.currentAiBubble = null;
        state.currentAiRawText = '';
      }
    }
  }
}

// Render an assistant message with pre-rendered HTML (no markdown parsing).
function appendAssistantHtml(html) {
  clearEmptyState();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = html;

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  messagesEl.appendChild(msgDiv);

  state.currentAiBubble = bubble;
  scrollToBottom();
  return msgDiv;
}

function renderSyncSummary(p) {
  clearEmptyState();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'ping-result';
  const label = BACKEND_LABELS[state.backend];

  msgDiv.innerHTML = `
    <div class="ping-header ok">${label} — In Sync</div>
    <table class="ping-table">
      <tr><td>Questions</td><td>${p.Q}</td></tr>
      <tr><td>Answers</td><td>${p.A}</td></tr>
      <tr><td>Session</td><td>${escapeHtml(p.sessionId || 'N/A')}</td></tr>
    </table>
  `;

  messagesEl.appendChild(msgDiv);
  scrollToBottom();
}

function startPolling() {
  stopPolling();
  appendDebug('app', 'Polling started (every 1s)');
  state.pollTimer = setInterval(pollSync, 1000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function pollSync() {
  if (state.mode !== 'waiting') {
    stopPolling();
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({ action: 'sync', backend: state.backend });
    const p = result.page || {};

    // Replace the last bubble entirely with the latest HTML (no diff — HTML
    // can't be safely diffed with slice).
    const lastHtml = p.aiHtmls && p.aiHtmls.length > 0 ? p.aiHtmls[p.aiHtmls.length - 1] : '';
    if (lastHtml.length !== state.lastMdLen) {
      if (state.currentAiBubble) {
        state.currentAiBubble.innerHTML = lastHtml;
        state.currentAiRawText = lastHtml;
      }
      state.lastMdLen = lastHtml.length;
    }

    if (p.A > state.syncedA) {
      state.syncedA = p.A;
    }

    // Completion: regenerate button appeared, or streaming stopped + balanced
    if (p.hasRegenerateButton || (!p.streaming && p.balanced)) {
      appendDebug('app', 'Polling: complete (regen=' + p.hasRegenerateButton + ')');
      finishSyncStreaming();
    }
  } catch (err) {
    appendDebug('app', 'Poll error: ' + err.message, 'warn');
  }
}

function finishSyncStreaming() {
  state.mode = 'display';
  stopPolling();
  updateStatusLine('display');

  if (state.currentAiBubble) {
    state.currentAiBubble = null;
    state.currentAiRawText = '';
  }

  appendDebug('app', 'Streaming finished, back to display mode');
}

function updateStatusLine(mode) {
  const label = BACKEND_LABELS[state.backend];
  if (mode === 'waiting') {
    statusText.textContent = label + ' — Waiting...';
    statusDot.className = 'waiting';
  } else {
    statusText.textContent = label;
    statusDot.className = 'connected';
  }
}

// ---- Send message ----
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || !state.loggedIn || state.streaming) return;

  inputEl.value = '';
  state.streaming = true;
  state.sendTime = Date.now();
  state.firstChunkTime = 0;
  state.requestId++;
  const thisRequestId = state.requestId;
  sendBtn.disabled = true;
  inputEl.disabled = true;

  clearEmptyState();
  appendMessage('user', text);
  appendMessage('assistant', '');
  showTyping(true);
  state.mode = 'waiting';
  updateStatusLine('waiting');

  appendDebug('app', 'Sending to ' + state.backend + ' [req=' + thisRequestId + ']: "' + text.slice(0, 60) + (text.length > 60 ? '...' : '') + '"');

  try {
    await chrome.runtime.sendMessage({
      action: 'chat',
      backend: state.backend,
      message: text,
      requestId: thisRequestId
    });
    appendDebug('app', `Chat action acknowledged +${Date.now() - state.sendTime}ms, waiting for stream...`);
  } catch (err) {
    finishStreaming();
    appendError(`Failed to send: ${err.message}`);
    appendDebug('app', 'Send failed: ' + err.message, 'err');
  }
}

function appendMessage(role, text) {
  clearEmptyState();

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'U' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'assistant') {
    bubble.innerHTML = text ? marked.parse(text) : '';
    state.currentAiRawText = text;
  } else {
    bubble.textContent = text;
  }

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  messagesEl.appendChild(msgDiv);

  if (role === 'assistant') {
    state.currentAiBubble = bubble;
  }

  scrollToBottom();
  return msgDiv;
}

function appendChunk(chunk) {
  if (state.currentAiBubble) {
    if (!state.firstChunkTime) {
      state.firstChunkTime = Date.now();
      appendDebug('app', `First chunk received +${state.firstChunkTime - state.sendTime}ms after send`);
    }
    state.currentAiRawText += chunk;
    state.currentAiBubble.innerHTML = marked.parse(state.currentAiRawText);
    scrollToBottom();
  }
}

function finishStreaming() {
  const totalElapsed = Date.now() - state.sendTime;
  const firstChunkDelay = state.firstChunkTime ? state.firstChunkTime - state.sendTime : '?';
  appendDebug('app', `Stream finished: total=${totalElapsed}ms, firstChunkDelay=${firstChunkDelay}ms`);
  state.streaming = false;
  state.currentAiBubble = null;
  state.currentAiRawText = '';
  state.sendTime = 0;
  state.firstChunkTime = 0;
  sendBtn.disabled = false;
  inputEl.disabled = false;
  inputEl.focus();
  showTyping(false);
  state.mode = 'display';
  updateStatusLine('display');
}

function appendError(errMsg) {
  state.currentAiRawText = '';
  if (state.currentAiBubble) {
    state.currentAiBubble.textContent = `Error: ${errMsg}`;
    state.currentAiBubble.style.color = '#e5534b';
  }
}

function showTyping(show) {
  typingEl.classList.toggle('hidden', !show);
}

function clearEmptyState() {
  const empty = messagesEl.querySelector('.empty-state');
  const hint = messagesEl.querySelector('.login-hint');
  if (empty) empty.remove();
  if (hint) hint.remove();
}

function scrollToBottom() {
  const area = $('#chat-area');
  area.scrollTop = area.scrollHeight;
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
  clearEmptyState();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'ping-result';

  if (error) {
    msgDiv.innerHTML = `
      <div class="ping-header error">Connection Failed</div>
      <div class="ping-body">${escapeHtml(error)}</div>
    `;
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
      </table>
    `;
  }

  messagesEl.appendChild(msgDiv);
  scrollToBottom();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
