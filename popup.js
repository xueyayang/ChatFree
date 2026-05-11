// popup.js - ChatFree side panel UI logic

// ---- Configure marked ----
const renderer = new marked.Renderer();
renderer.code = function({ text, lang }) {
  const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language: validLang }).value;
  return `<pre><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
};
marked.setOptions({ renderer, breaks: true, gfm: true });

const state = {
  backend: 'deepseek',   // 'deepseek' | 'chatgpt' (ChatGPT for later milestone)
  loggedIn: false,
  streaming: false,
  currentAiBubble: null,
  currentAiRawText: ''
};

const $ = (sel) => document.querySelector(sel);

const messagesEl = $('#messages');
const inputEl = $('#message-input');
const sendBtn = $('#send-btn');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const typingEl = $('#typing-indicator');

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
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

// ---- Background message listener ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'chunk') {
    appendChunk(msg.content);
  } else if (msg.type === 'done') {
    finishStreaming();
  } else if (msg.type === 'error') {
    finishStreaming();
    appendError(msg.error);
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
  statusDot.className = loggedIn ? 'connected' : 'disconnected';
  statusText.textContent = loggedIn ? 'DeepSeek' : 'Disconnected';
  inputEl.disabled = !loggedIn;
  sendBtn.disabled = !loggedIn;

  if (!loggedIn) {
    inputEl.placeholder = 'Log in to DeepSeek first...';
    renderLoginHint();
  } else {
    inputEl.placeholder = 'Type a message...';
    if (messagesEl.children.length === 0 || messagesEl.querySelector('.login-hint')) {
      renderEmptyState();
    }
  }
}

// ---- Render ----
function renderEmptyState() {
  messagesEl.innerHTML = `
    <div class="empty-state">
      <div class="icon">&#128172;</div>
      <p>Start a conversation with DeepSeek</p>
    </div>
  `;
}

function renderLoginHint() {
  messagesEl.innerHTML = `
    <div class="login-hint">
      <div class="warn-icon">&#9888;</div>
      <p>Not logged into DeepSeek.</p>
      <p><a href="https://chat.deepseek.com" target="_blank">Open DeepSeek</a> and sign in, then reopen this panel.</p>
    </div>
  `;
}

// ---- Send message ----
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || !state.loggedIn || state.streaming) return;

  inputEl.value = '';
  state.streaming = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;

  clearEmptyState();
  appendMessage('user', text);
  appendMessage('assistant', ''); // placeholder
  showTyping(true);

  try {
    await chrome.runtime.sendMessage({
      action: 'chat',
      backend: state.backend,
      message: text
    });
  } catch (err) {
    finishStreaming();
    appendError(`Failed to send: ${err.message}`);
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
    state.currentAiRawText += chunk;
    state.currentAiBubble.innerHTML = marked.parse(state.currentAiRawText);
    scrollToBottom();
  }
}

function finishStreaming() {
  state.streaming = false;
  state.currentAiBubble = null;
  state.currentAiRawText = '';
  sendBtn.disabled = false;
  inputEl.disabled = false;
  inputEl.focus();
  showTyping(false);
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
