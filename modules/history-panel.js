// modules/history-panel.js
// Floating history popover — stores sent messages in localStorage ring buffer.
// Double-click item → fill textarea. "Resend→" button → fill + send immediately.
//
// Interface: createHistoryPanel({ container, toggleBtn })
//   → { init, record, show, hide, toggle, isVisible, onFill, onResend }

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
    } catch (_) { /* storage full, drop oldest */ }
  }

  function record(text, targetSite) {
    if (!text) return;
    if (entries.length > 0 && entries[0].text === text && entries[0].targetSite === targetSite) return;

    entries.unshift({ text, timestamp: Date.now(), targetSite });
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

    list.innerHTML = entries.map((entry, i) => {
      const time = new Date(entry.timestamp).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit'
      });
      const preview = entry.text.length > 70 ? entry.text.slice(0, 70) + '…' : entry.text;
      const siteLabel = entry.targetSite || '';
      return `
        <div class="history-item" data-index="${i}">
          <span class="history-time">${time}</span>
          ${siteLabel ? `<span class="history-site">${esc(siteLabel)}</span>` : ''}
          <span class="history-text" title="${esc(entry.text)}">${esc(preview)}</span>
          <button class="history-resend" data-index="${i}">Resend→</button>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('dblclick', () => {
        const i = parseInt(item.dataset.index);
        if (entries[i]) {
          fillCallbacks.forEach(cb => cb(entries[i].text));
          hide();
        }
      });
    });

    list.querySelectorAll('.history-resend').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(btn.dataset.index);
        if (entries[i]) {
          resendCallbacks.forEach(cb => cb(entries[i].text));
          hide();
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

  return { init, record, show, hide, toggle, isVisible, onFill, onResend };
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
