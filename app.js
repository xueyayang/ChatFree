// app.js - ChatFree standalone page UI logic
// Embed-only: loads AI platform in iframe, forwards input via postMessage.
// Supports dual-panel vertical split for viewing two sites simultaneously.

import { createEmbedSyncModule } from './modules/sync-embed.js';
import { createInputAreaModule } from './modules/input-area.js';

// ---- Backend config ----
const BACKEND_LABELS = { deepseek: 'DeepSeek', chatgpt: 'ChatGPT', doubao: '豆包', qianwen: '千问', gemini: 'Gemini' };

// ---- Shared state ----
const state = {
  activeSites: ['doubao', 'qianwen'],  // ordered list, max 2. [0]=left, [1]=right
  activePanel: 'left',  // which panel receives input: 'left' | 'right'
  splitRatio: 0.5,  // left panel fraction of available width
  requestId: 0
};

const $ = (sel) => document.querySelector(sel);

// ---- DOM refs ----
const siteIcons = document.querySelectorAll('.site-icon');
const panelLeft = $('#embed-panel-left');
const panelRight = $('#embed-panel-right');
const inputArea = $('#input-area');
const debugToggle = $('#debug-toggle');
const debugPanel = $('#debug-panel');
const debugLog = $('#debug-log');
const debugClear = $('#debug-clear');
const testBtn = $('#test-btn');
const panelSwitch = $('#panel-switch');
const indicatorLeft = $('#indicator-left');
const indicatorRight = $('#indicator-right');
const indicatorStrip = $('#indicator-strip');
const panelIndicators = { left: indicatorLeft, right: indicatorRight };
const resizeGutter = $('#resize-gutter');

// ---- Active modules ----
const panelModules = { left: null, right: null };
let inputModule = null;

// Shared DOM bundle for modules
function makePanelDom(backend, container) {
  return {
    get inputEl() { return inputModule ? inputModule.dom.inputEl : null; },
    get sendBtn() { return inputModule ? inputModule.dom.sendBtn : null; },
    get statusDot() { return null; },
    get statusText() { return null; },
    get backendLabel() { return BACKEND_LABELS[backend]; },
    get containerEl() { return container; }
  };
}

// Shared utilities
const utils = {
  appendDebug
};

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  // Open long-lived port to background for cookie injection lifecycle
  const bgPort = chrome.runtime.connect({ name: 'chatfree-app' });
  bgPort.onDisconnect.addListener(() => {
    appendDebug('app', 'Background port lost — cookie injection may stop');
  });

  // Init input area module
  inputModule = createInputAreaModule({ container: inputArea, state, utils });
  inputModule.init();

  inputModule.onSend((text) => {
    const mod = panelModules[state.activePanel];
    if (mod) mod.module.send(text);
  });

  inputModule.onHistoryResend(({ composedText, targetPanel }) => {
    const mod = panelModules[targetPanel];
    if (mod) mod.module.send(composedText);
  });

  // Site icon clicks
  siteIcons.forEach(icon => {
    icon.addEventListener('click', () => toggleSite(icon.dataset.site));
  });

  // Site icon drag-to-reorder
  initIconDragReorder();

  debugToggle.addEventListener('click', toggleDebugPanel);
  debugClear.addEventListener('click', clearDebugLog);
  testBtn.addEventListener('click', runDiagnostics);
  document.getElementById('debug-copy').addEventListener('click', copyDebugLog);

  // Panel indicators (click to switch active panel)
  for (const side of ['left', 'right']) {
    panelIndicators[side].addEventListener('mousedown', () => {
      appendDebug('app', `indicator mousedown → activePanel: ${state.activePanel} → ${side}`);
      if (state.activePanel !== side) {
        state.activePanel = side;
        updateIndicators();
      }
    });
  }

  // Panel switch (center pill at indicator junction)
  panelSwitch.addEventListener('click', (e) => {
    const side = e.target.closest('.switch-side')?.dataset.side;
    if (side && state.activePanel !== side && panelModules[side]) {
      appendDebug('app', `Switch click → activePanel: ${state.activePanel} → ${side}`);
      state.activePanel = side;
      updateIndicators();
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'debug') {
      appendDebug(msg.source || 'bg', msg.message, msg.level);
    }
  });

  // Initial layout
  renderLayout();

  appendDebug('app', 'Ready');
});

// ---- Diagnostics ----
function runDiagnostics() {
  testBtn.classList.add('running');
  testBtn.disabled = true;
  const t0 = Date.now();
  appendDebug('app', '========== EMBED DIAGNOSTICS ==========');
  appendDebug('app', '[TEST] Active sites: ' + state.activeSites.join(', '));
  appendDebug('app', '[TEST] Active panel: ' + state.activePanel);

  // 1. Run content-script diagnose on each active panel
  for (const side of ['left', 'right']) {
    const mod = panelModules[side];
    if (mod) {
      appendDebug('app', '[TEST] --- Diagnosing ' + side + ' panel (' + mod.backend + ') ---');
      mod.module.sendDiagnose();
    } else {
      appendDebug('app', '[TEST] ' + side + ' panel: not loaded');
    }
  }

  // 2. Connectivity test via background service worker
  const sitesToTest = [...new Set([...state.activeSites, 'chatgpt'])];
  sitesToTest.forEach(site => {
    chrome.runtime.sendMessage({
      action: 'testConnectivity',
      site: site
    }).then(result => {
      appendDebug('app', '[TEST] Connectivity ' + site + ': ' + JSON.stringify(result));
    }).catch(err => {
      appendDebug('app', '[TEST] Connectivity ' + site + ': ERROR ' + err.message, 'err');
    });
  });

  // 3. Check declarativeNetRequest rules
  chrome.declarativeNetRequest.getDynamicRules().then(rules => {
    appendDebug('app', '[TEST] Dynamic DNR rules: ' + rules.length);
  }).catch(() => {});

  chrome.declarativeNetRequest.getEnabledRulesets().then(rulesets => {
    appendDebug('app', '[TEST] Enabled rulesets: ' + JSON.stringify(rulesets));
  }).catch(() => {});

  setTimeout(() => {
    testBtn.classList.remove('running');
    testBtn.disabled = false;
    appendDebug('app', '[TEST] ========== Diagnostics complete +' + (Date.now() - t0) + 'ms ==========');
  }, 3000);
}

// ---- Site toggle ----
function toggleSite(site) {
  const idx = state.activeSites.indexOf(site);
  if (idx >= 0) {
    // Already active — switch focus to its panel
    const side = idx === 0 ? 'left' : 'right';
    if (state.activePanel !== side) {
      appendDebug('app', `Icon click → switch focus: ${state.activePanel} → ${side}`);
      state.activePanel = side;
      updateIndicators();
    } else {
      // Double-click active icon → deactivate
      state.activeSites.splice(idx, 1);
      renderLayout();
    }
  } else {
    // Activate new site
    if (state.activeSites.length >= 2) {
      const old = state.activeSites.pop();
      document.querySelector(`.site-icon[data-site="${old}"]`)?.classList.remove('active');
    }
    state.activeSites.push(site);
    renderLayout();
    // Focus the newly added panel
    const newIdx = state.activeSites.indexOf(site);
    state.activePanel = newIdx === 0 ? 'left' : 'right';
    updateIndicators();
  }
}

// ---- Icon drag reorder ----
function initIconDragReorder() {
  const container = document.getElementById('site-icons');
  let dragSrc = null;

  // Restore saved order
  const saved = localStorage.getItem('iconOrder');
  if (saved) {
    try {
      const order = JSON.parse(saved);
      order.forEach(site => {
        const icon = container.querySelector(`[data-site="${site}"]`);
        if (icon) container.appendChild(icon);
      });
    } catch (_) { /* ignore */ }
  }

  container.addEventListener('dragstart', (e) => {
    const icon = e.target.closest('.site-icon');
    if (!icon) return;
    dragSrc = icon;
    icon.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', icon.dataset.site);
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    container.querySelectorAll('.site-icon').forEach(el => {
      el.classList.remove('drag-target-left', 'drag-target-right');
    });

    const icon = e.target.closest('.site-icon');
    if (!icon || icon === dragSrc) return;

    const rect = icon.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) {
      icon.classList.add('drag-target-left');
    } else {
      icon.classList.add('drag-target-right');
    }
  });

  container.addEventListener('dragleave', (e) => {
    const icon = e.target.closest('.site-icon');
    // Only clear when actually leaving the icon, not entering a child
    if (icon && !icon.contains(e.relatedTarget)) {
      icon.classList.remove('drag-target-left', 'drag-target-right');
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.querySelectorAll('.site-icon').forEach(el => {
      el.classList.remove('drag-target-left', 'drag-target-right');
    });

    const icon = e.target.closest('.site-icon');
    if (!icon || !dragSrc || icon === dragSrc) return;

    const rect = icon.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) {
      container.insertBefore(dragSrc, icon);
    } else {
      container.insertBefore(dragSrc, icon.nextSibling);
    }

    saveIconOrder();
  });

  container.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    container.querySelectorAll('.site-icon').forEach(el => {
      el.classList.remove('drag-target-left', 'drag-target-right');
    });
    dragSrc = null;
  });
}

function saveIconOrder() {
  const container = document.getElementById('site-icons');
  const order = [];
  container.querySelectorAll('.site-icon').forEach(icon => {
    order.push(icon.dataset.site);
  });
  localStorage.setItem('iconOrder', JSON.stringify(order));
}

// ---- Layout rendering ----
function renderLayout() {
  // Update icon states
  siteIcons.forEach(icon => {
    icon.classList.toggle('active', state.activeSites.includes(icon.dataset.site));
  });

  // Left panel
  if (state.activeSites.length >= 1) {
    loadPanel('left', state.activeSites[0]);
  } else {
    unloadPanel('left');
  }

  // Right panel
  if (state.activeSites.length >= 2) {
    loadPanel('right', state.activeSites[1]);
  } else {
    unloadPanel('right');
  }

  // If active panel was unloaded, switch to the other
  if (!panelModules[state.activePanel]) {
    state.activePanel = state.activePanel === 'left' ? 'right' : 'left';
  }

  // Show center switch & gutter only when both panels are active
  const bothActive = state.activeSites.length >= 2;
  panelSwitch.classList.toggle('hidden', !bothActive);
  resizeGutter.classList.toggle('hidden', !bothActive);

  applySplit();
  updateIndicators();
}

function updateIndicators() {
  for (const side of ['left', 'right']) {
    const mod = panelModules[side];
    const indicator = panelIndicators[side];
    if (indicator) {
      indicator.classList.toggle('active', !!(mod && state.activePanel === side));
    }
  }
  // Update switch halves
  const leftSide = panelSwitch.querySelector('.switch-side.left');
  const rightSide = panelSwitch.querySelector('.switch-side.right');
  if (leftSide) leftSide.classList.toggle('active', state.activePanel === 'left');
  if (rightSide) rightSide.classList.toggle('active', state.activePanel === 'right');
}

// ---- Panel management ----
function loadPanel(side, backend) {
  const panel = side === 'left' ? panelLeft : panelRight;
  const current = panelModules[side];

  if (current && current.backend === backend) return;

  if (current) {
    current.module.stop();
    panelModules[side] = null;
  }

  appendDebug('app', `Loading ${backend} in ${side} panel`);

  const container = document.createElement('div');
  container.style.cssText = 'flex:1;min-height:0;position:relative;';

  panel.innerHTML = '';
  panel.appendChild(container);
  panel.classList.remove('hidden');

  const panelDom = makePanelDom(backend, container);
  const module = createEmbedSyncModule({
    state: { backend, loggedIn: false, requestId: 0 },
    dom: panelDom,
    utils: { appendDebug }
  });

  module.init();
  const indicator = panelIndicators[side];
  panelModules[side] = { module, backend, indicator };
}

function unloadPanel(side) {
  const panel = side === 'left' ? panelLeft : panelRight;
  const current = panelModules[side];
  if (current) {
    current.module.stop();
    panelModules[side] = null;
  }
  panel.classList.add('hidden');
  panel.innerHTML = '';
}

// ---- Panel split resizing ----
function applySplit() {
  const bothActive = state.activeSites.length === 2;
  if (!bothActive) {
    panelLeft.style.flex = '';
    panelRight.style.flex = '';
    indicatorLeft.style.flex = '';
    indicatorRight.style.flex = '';
    panelSwitch.style.left = '';
    return;
  }

  const debugVisible = !debugPanel.classList.contains('hidden');
  const gutterWidth = 4;
  const debugWidth = debugVisible ? 340 : 0;
  const available = $('#main-area').clientWidth - debugWidth - gutterWidth;

  const leftWidth = available * state.splitRatio;

  panelLeft.style.flex = `0 0 ${leftWidth}px`;
  panelRight.style.flex = '1 1 0%';

  indicatorLeft.style.flex = `0 0 ${leftWidth}px`;
  indicatorRight.style.flex = '1 1 0%';

  panelSwitch.style.left = `${leftWidth + gutterWidth / 2}px`;
}

// ---- Gutter drag ----
resizeGutter.addEventListener('mousedown', (e) => {
  e.preventDefault();

  const mainArea = $('#main-area');
  const debugVisible = !debugPanel.classList.contains('hidden');
  const debugWidth = debugVisible ? 340 : 0;
  const gutterWidth = 4;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:col-resize;';
  document.body.appendChild(overlay);

  resizeGutter.classList.add('dragging');

  const onMove = (e) => {
    const rect = mainArea.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const available = mainArea.clientWidth - debugWidth - gutterWidth;
    state.splitRatio = Math.max(0.15, Math.min(0.85, x / available));
    applySplit();
  };

  const onUp = () => {
    overlay.remove();
    resizeGutter.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

window.addEventListener('resize', () => {
  if (state.activeSites.length === 2) {
    applySplit();
  }
});

// ---- Debug panel ----
function toggleDebugPanel() {
  const visible = debugPanel.classList.toggle('hidden');
  debugToggle.classList.toggle('active', !visible);
  indicatorStrip.style.right = visible ? '340px' : '0';
  applySplit();
}

function clearDebugLog() {
  debugLog.innerHTML = '<div class="debug-empty">Log cleared</div>';
}

function copyDebugLog() {
  const entries = debugLog.querySelectorAll('.debug-entry');
  const lines = [];
  entries.forEach(entry => {
    const time = entry.querySelector('.debug-time')?.textContent || '';
    const source = entry.querySelector('.debug-source')?.textContent || '';
    const msg = entry.querySelector('.debug-msg')?.textContent || '';
    lines.push(`${time} [${source}] ${msg}`);
  });
  const text = lines.join('\n');
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      appendDebug('app', 'Debug log copied to clipboard');
    }).catch(() => {
      appendDebug('app', 'Failed to copy debug log', 'err');
    });
  }
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
