// modules/sync-text.js
// Text-based sync module: reads conversation from backend page via content
// script, renders locally with markdown. Handles streaming and polling.
//
// Interface: createTextSyncModule({ state, dom, utils }) → { init, sync, send, stop }
//
// Required dom keys:
//   messagesEl, inputEl, sendBtn, syncBtn, statusDot, statusText, typingEl, chatArea
// Required utils keys:
//   appendDebug, clearEmptyState, marked

export function createTextSyncModule({ state, dom, utils }) {
  const { appendDebug } = utils;

  let _onMessageCleanup = null;
  const _listeners = new Set(); // { type, fn } — used by app to forward messages

  // ---- Public ----
  function init() {
    // Listen for streaming events from content script (via background).
    const handler = (msg) => {
      if (msg.type === 'chunk') {
        if (state.streaming && msg.requestId === state.requestId) appendChunk(msg.content);
      } else if (msg.type === 'done') {
        if (state.streaming && msg.requestId === state.requestId) finishStreaming();
      } else if (msg.type === 'error') {
        if (state.streaming && msg.requestId === state.requestId) { finishStreaming(); appendError(msg.error); }
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    _onMessageCleanup = () => {
      try { chrome.runtime.onMessage.removeListener(handler); } catch (_) {}
    };
  }

  function stop() {
    stopPolling();
    if (_onMessageCleanup) { _onMessageCleanup(); _onMessageCleanup = null; }
  }

  // ---- Sync ----
  async function sync() {
    if (!state.loggedIn) return;

    dom.syncBtn.disabled = true;
    dom.syncBtn.textContent = '...';
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
      dom.syncBtn.disabled = false;
      dom.syncBtn.textContent = 'Sync';
    }
  }

  // ---- Send ----
  async function send(text) {
    if (!text || !state.loggedIn || state.streaming) return;

    state.streaming = true;
    state.sendTime = Date.now();
    state.firstChunkTime = 0;
    state.requestId++;
    const thisRequestId = state.requestId;
    dom.sendBtn.disabled = true;
    dom.inputEl.disabled = true;

    utils.clearEmptyState();
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

  // ---- Conversation rendering (local copy from sync) ----
  function renderFullConversation(p) {
    utils.clearEmptyState();

    const conversation = p.conversation || [];
    if (conversation.length === 0) {
      dom.messagesEl.innerHTML = `
        <div class="empty-state">
          <div class="icon">&#128172;</div>
          <p>No messages found on ${p.sessionId ? 'this session' : 'the page'}</p>
        </div>`;
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

  function appendAssistantHtml(html) {
    utils.clearEmptyState();

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
    dom.messagesEl.appendChild(msgDiv);

    state.currentAiBubble = bubble;
    scrollToBottom();
    return msgDiv;
  }

  // ---- Polling (waiting mode) ----
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
    const label = dom.backendLabel || 'AI';
    if (mode === 'waiting') {
      dom.statusText.textContent = label + ' — Waiting...';
      dom.statusDot.className = 'waiting';
    } else {
      dom.statusText.textContent = label;
      dom.statusDot.className = 'connected';
    }
  }

  // ---- Append messages to local display ----
  function appendMessage(role, text) {
    utils.clearEmptyState();

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? 'U' : 'AI';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'assistant') {
      bubble.innerHTML = text ? utils.marked.parse(text) : '';
      state.currentAiRawText = text;
    } else {
      bubble.textContent = text;
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    dom.messagesEl.appendChild(msgDiv);

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
      state.currentAiBubble.innerHTML = utils.marked.parse(state.currentAiRawText);
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
    dom.sendBtn.disabled = false;
    dom.inputEl.disabled = false;
    dom.inputEl.focus();
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
    dom.typingEl.classList.toggle('hidden', !show);
  }

  function scrollToBottom() {
    dom.chatArea.scrollTop = dom.chatArea.scrollHeight;
  }

  function renderPingResult(result, error) {
    utils.clearEmptyState();

    const msgDiv = document.createElement('div');
    msgDiv.className = 'ping-result';

    if (error) {
      msgDiv.innerHTML = `
        <div class="ping-header error">Sync Failed</div>
        <div class="ping-body">${escapeHtml(error)}</div>`;
    } else if (result && result.page) {
      const p = result.page;
      msgDiv.innerHTML = `
        <div class="ping-header ok">Synced</div>
        <table class="ping-table">
          <tr><td>Q</td><td>${p.Q}</td></tr>
          <tr><td>A</td><td>${p.A}</td></tr>
          <tr><td>Session</td><td>${p.sessionId || 'N/A'}</td></tr>
        </table>`;
    }

    dom.messagesEl.appendChild(msgDiv);
    scrollToBottom();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Public API ----
  return { init, sync, send, stop };
}
