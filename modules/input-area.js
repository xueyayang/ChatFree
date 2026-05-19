// modules/input-area.js
// Input area module — preset rules panel + textarea + copy/send buttons.
// Composes messages and copies to clipboard (no iframe injection).
//
// Interface: createInputAreaModule({ container, state, utils })
//   → { init, getComposedText, clear, setEnabled, dom }

import { createPresetPanel } from './preset-panel.js';
import { createHistoryPanel } from './history-panel.js';

export function createInputAreaModule({ container, state, utils }) {
  let inputEl, sendBtn, copyBtn, presetPanel, historyPanel;
  let copyFeedbackTimer = null;

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

    historyPanel.onResend(({ entry }) => {
      if (entry.text) {
        inputEl.value = entry.text;
        inputEl.focus();
      }
    });
  }

  function buildUI() {
    container.innerHTML = `
      <div id="input-layout">
        <div id="preset-panel"></div>
        <div id="input-main">
          <div id="input-wrapper">
            <textarea id="message-input" placeholder="Type a message..."></textarea>
            <button id="history-btn" title="History (Ctrl+H)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
              </svg>
            </button>
            <button id="copy-btn" title="Copy to clipboard">Copy</button>
            <button id="send-btn" title="Copy to clipboard">Send</button>
          </div>
        </div>
      </div>
      <div id="history-popover"></div>
    `;

    inputEl = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    copyBtn = document.getElementById('copy-btn');

    copyBtn.addEventListener('click', () => {
      copyComposed();
    });

    sendBtn.addEventListener('click', () => {
      copyComposed();
      recordToHistory();
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        copyComposed();
        recordToHistory();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        if (historyPanel) historyPanel.toggle();
      }
    });
  }

  function copyComposed() {
    const text = getComposedText();
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      showCopyFeedback();
      if (utils.appendDebug) {
        utils.appendDebug('app', `Copied ${text.length} chars to clipboard`);
      }
    }).catch(() => {
      if (utils.appendDebug) {
        utils.appendDebug('app', 'Clipboard write failed', 'err');
      }
    });
  }

  function showCopyFeedback() {
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copied');
    copyFeedbackTimer = setTimeout(() => {
      copyBtn.textContent = 'Copy';
      copyBtn.classList.remove('copied');
      copyFeedbackTimer = null;
    }, 1500);
  }

  function recordToHistory() {
    const composed = getComposedText();
    if (!composed || !historyPanel) return;
    historyPanel.record(composed, state.activeSite || '', 'left');
  }

  function getComposedText() {
    const userText = inputEl.value.trim();
    if (!userText) return '';
    const rulesText = presetPanel ? presetPanel.getActiveRulesText() : '';
    if (rulesText) {
      return userText + '\n\n' + rulesText;
    }
    return userText;
  }

  function clear() {
    inputEl.value = '';
  }

  function setEnabled(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
    copyBtn.disabled = !enabled;
  }

  const dom = {
    get inputEl() { return inputEl; },
    get sendBtn() { return sendBtn; },
    get copyBtn() { return copyBtn; }
  };

  return { init, getComposedText, clear, setEnabled, dom };
}
