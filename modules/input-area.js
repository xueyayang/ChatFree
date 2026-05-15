// modules/input-area.js
// Input area module — split layout: left preset rules panel, right textarea + buttons.
// Composes preset-panel.js and exposes composed text (rules + user input) for sending.
//
// Interface: createInputAreaModule({ container, state, utils })
//   → { init, getComposedText, clear, setEnabled, onSend, dom }

import { createPresetPanel } from './preset-panel.js';

export function createInputAreaModule({ container, state, utils }) {
  let inputEl, sendBtn, presetPanel;
  const sendCallbacks = [];

  function init() {
    buildUI();
    presetPanel = createPresetPanel({ container: document.getElementById('preset-panel') });
  }

  function buildUI() {
    container.innerHTML = `
      <div id="input-layout">
        <div id="preset-panel"></div>
        <div id="input-main">
          <textarea id="message-input" placeholder="Type a message..." disabled></textarea>
          <div id="input-buttons">
            <button id="send-btn" disabled>Send</button>
          </div>
        </div>
      </div>
    `;

    inputEl = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');

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

  const dom = {
    get inputEl() { return inputEl; },
    get sendBtn() { return sendBtn; },
  };

  return { init, getComposedText, clear, setEnabled, onSend, dom };
}
