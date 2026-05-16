// modules/history-panel.js
// Floating history popover — stores sent messages in localStorage ring buffer.
// Double-click item → fill textarea. Resend button → send to opposite panel.
// Thin vertical indicator lights show which side(s) each message was sent to.
//
// Interface: createHistoryPanel({ container, toggleBtn })
//   → { init, record, show, hide, toggle, isVisible, onFill, onResend, markResent }

const STORAGE_KEY = 'chatfree_history';
const MAX_ENTRIES = 100;

export function createHistoryPanel({ container, toggleBtn }) {
  let visible = false;
  let entries = [];
  const fillCallbacks = [];
  const resendCallbacks = [];

  function init() {
    load();
    buildUI();
    bindEvents();
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      entries = raw ? JSON.parse(raw) : [];
    } catch (_) {
      entries = [];
    }
  }

  function save() {
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (_) { /* storage full */ }
  }

  function record(text, targetSite, targetPanel) {
    if (!text) return;
    if (entries.length > 0 && entries[0].text === text && entries[0].targetPanel === targetPanel) return;

    entries.unshift({ text, timestamp: Date.now(), targetSite, targetPanel, resentTo: null });
    save();
    if (visible) render();
  }

  function markResent(timestamp) {
    const entry = entries.find(e => e.timestamp === timestamp);
    if (!entry) return;
    entry.resentTo = entry.targetPanel === 'left' ? 'right' : 'left';
    save();
    if (visible) render();
  }

  function buildUI() {
    container.innerHTML = `
      <div id="history-header">
        <span>History</span>
        <button id="history-clear" title="Clear all">Clear</button>
      </div>
      <div id="history-list"></div>
    `;
  }

  function bindEvents() {
    container.querySelector('#history-clear').addEventListener('click', () => {
      entries = [];
      save();
      render();
    });

    toggleBtn.addEventListener('click', toggle);

    document.addEventListener('click', (e) => {
      if (visible && !container.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
        hide();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && visible) {
        hide();
        toggleBtn.focus();
      }
    });
  }

  function render() {
    const list = container.querySelector('#history-list');
    if (!list) return;

    if (entries.length === 0) {
      list.innerHTML = '<div class="history-empty">No history yet</div>';
      return;
    }

    list.innerHTML = entries.map((entry, _i) => {
      const time = new Date(entry.timestamp).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit'
      });
      const preview = entry.text.length > 60 ? entry.text.slice(0, 60) + '…' : entry.text;
      const siteLabel = entry.targetSite || '';
      const sentLeft = entry.targetPanel === 'left' || entry.resentTo === 'left';
      const sentRight = entry.targetPanel === 'right' || entry.resentTo === 'right';
      const sentToBoth = sentLeft && sentRight;
      return `
        <div class="history-item" data-ts="${entry.timestamp}">
          <span class="history-time">${time}</span>
          ${siteLabel ? `<span class="history-site">${esc(siteLabel)}</span>` : ''}
          <span class="history-text" title="${esc(entry.text)}">${esc(preview)}</span>
          <span class="history-lights">
            <span class="history-light left${sentLeft ? ' on' : ''}"></span>
            <span class="history-light right${sentRight ? ' on' : ''}"></span>
          </span>
          ${sentToBoth ? '' : `<button class="history-resend" data-ts="${entry.timestamp}">↗</button>`}
        </div>
      `;
    }).join('');

    list.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('dblclick', () => {
        const ts = parseInt(item.dataset.ts);
        const entry = entries.find(e => e.timestamp === ts);
        if (entry) {
          fillCallbacks.forEach(cb => cb(entry.text));
          hide();
        }
      });
    });

    list.querySelectorAll('.history-resend').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ts = parseInt(btn.dataset.ts);
        const entry = entries.find(e => e.timestamp === ts);
        if (entry) {
          const opposite = entry.targetPanel === 'left' ? 'right' : 'left';
          resendCallbacks.forEach(cb => cb({ entry, targetPanel: opposite }));
        }
      });
    });
  }

  function show() {
    visible = true;
    container.style.display = 'flex';
    toggleBtn.classList.add('active');
    render();
  }

  function hide() {
    visible = false;
    container.style.display = 'none';
    toggleBtn.classList.remove('active');
  }

  function toggle() {
    visible ? hide() : show();
  }

  function isVisible() { return visible; }

  function onFill(cb) { fillCallbacks.push(cb); }
  function onResend(cb) { resendCallbacks.push(cb); }

  return { init, record, show, hide, toggle, isVisible, onFill, onResend, markResent };
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
