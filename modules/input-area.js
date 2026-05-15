// modules/input-area.js
// Input area module — split layout: left preset rules panel, right textarea + buttons.
// Composes preset-panel.js and exposes composed text (rules + user input) for sending.
//
// Interface: createInputAreaModule({ container, state, utils })
//   → { init, getComposedText, clear, setEnabled, onSend, onSync, onTest, dom }

import { createPresetPanel } from './preset-panel.js';

export function createInputAreaModule({ container, state, utils }) {
  let inputEl, sendBtn, syncBtn, testBtn, presetPanel;
  const sendCallbacks = [];
  const syncCallbacks = [];
  const testCallbacks = [];

  function init() {
    buildUI();
    presetPanel = createPresetPanel({ container: document.getElementById('preset-panel') });
  }

  function buildUI() {
    container.innerHTML = `
      <div id="input-layout">
        <div id="preset-panel"></div>
        <div id="input-main">
          <textarea id="message-input" placeholder="Type a message..." rows="3" disabled></textarea>
          <div id="input-buttons">
            <button id="send-btn" disabled>Send</button>
            <button id="sync-btn" title="Reload iframe">Sync</button>
            <button id="test-btn" title="Test connection">Test</button>
          </div>
        </div>
      </div>
    `;

    inputEl = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    syncBtn = document.getElementById('sync-btn');
    testBtn = document.getElementById('test-btn');

    sendBtn.addEventListener('click', () => {
      const text = getComposedText();
      if (text) sendCallbacks.forEach(cb => cb(text));
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = getComposedText();
        if (text) sendCallbacks.forEach(cb => cb(text));
      }
    });

    syncBtn.addEventListener('click', () => {
      syncCallbacks.forEach(cb => cb());
    });

    testBtn.addEventListener('click', () => {
      testCallbacks.forEach(cb => cb());
    });
  }

  function getComposedText() {
    const userText = inputEl.value.trim();
    if (!userText) return '';

    const rulesText = presetPanel ? presetPanel.getActiveRulesText() : '';
    if (rulesText) {
      return rulesText + '\n\n' + userText;
    }
    return userText;
  }

  function clear() {
    inputEl.value = '';
  }

  function setEnabled(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
  }

  function onSend(callback) { sendCallbacks.push(callback); }
  function onSync(callback) { syncCallbacks.push(callback); }
  function onTest(callback) { testCallbacks.push(callback); }

  const dom = {
    get inputEl() { return inputEl; },
    get sendBtn() { return sendBtn; },
    get testBtn() { return testBtn; },
    get syncBtn() { return syncBtn; },
  };

  return { init, getComposedText, clear, setEnabled, onSend, onSync, onTest, dom };
}
