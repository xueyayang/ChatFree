// modules/input-area.js
// Input area module — split layout: left preset rules panel, right textarea + buttons.
// Composes preset-panel.js and history-panel.js. Exposes composed text (rules + user input) for sending.
//
// Interface: createInputAreaModule({ container, state, utils })
//   → { init, getComposedText, clear, setEnabled, onSend, onHistoryResend, dom }

import { createPresetPanel } from './preset-panel.js';
import { createHistoryPanel } from './history-panel.js';

export function createInputAreaModule({ container, state, utils }) {
  let inputEl, sendBtn, presetPanel, historyPanel;
  const sendCallbacks = [];
  const historyResendCallbacks = [];

  function init() {
    buildUI();
    presetPanel = createPresetPanel({ container: document.getElementById('preset-panel') });

    const popover = document.getElementById('history-popover');
    const toggleBtn = document.getElementById('history-btn');
    historyPanel = createHistoryPanel({ container: popover, toggleBtn });
    historyPanel.init();

    historyPanel.onFill((text) => {
      inputEl.value = text;
      inputEl.focus();
    });

    historyPanel.onResend(({ entry, targetPanel }) => {
      if (entry.text) {
        historyResendCallbacks.forEach(cb => cb({ composedText: entry.text, targetPanel }));
        historyPanel.markResent(entry.timestamp);
      }
    });
  }

  function buildUI() {
    container.innerHTML = `
      <div id="input-layout">
        <div id="preset-panel"></div>
        <div id="input-main">
          <div id="input-wrapper">
            <textarea id="message-input" placeholder="Type a message..." disabled></textarea>
            <button id="history-btn" title="History (Ctrl+H)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
              </svg>
            </button>
            <button id="send-btn" disabled>Send</button>
          </div>
        </div>
      </div>
      <div id="history-popover"></div>
    `;

    inputEl = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');

    sendBtn.addEventListener('click', () => {
      const composed = getComposedText();
      if (composed) {
        sendCallbacks.forEach(cb => cb(composed));
        recordToHistory();
      }
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const composed = getComposedText();
        if (composed) {
          sendCallbacks.forEach(cb => cb(composed));
          recordToHistory();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        if (historyPanel) historyPanel.toggle();
      }
    });
  }

  function recordToHistory() {
    const composed = getComposedText();
    if (!composed || !historyPanel) return;
    const targetSite = state.activeSites[state.activePanel === 'left' ? 0 : 1] || '';
    historyPanel.record(composed, targetSite, state.activePanel);
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
  function onHistoryResend(callback) { historyResendCallbacks.push(callback); }

  const dom = {
    get inputEl() { return inputEl; },
    get sendBtn() { return sendBtn; },
  };

  return { init, getComposedText, clear, setEnabled, onSend, onHistoryResend, dom };
}
