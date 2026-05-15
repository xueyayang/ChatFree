// app.js - ChatFree standalone page UI logic
// Embed-only: loads AI platform in iframe, forwards input via postMessage.
// Supports dual-panel vertical split for viewing two sites simultaneously.

import { createEmbedSyncModule } from './modules/sync-embed.js';
import { createInputAreaModule } from './modules/input-area.js';

// ---- Backend config ----
const BACKEND_LABELS = { deepseek: 'DeepSeek', chatgpt: 'ChatGPT', doubao: '豆包' };

// ---- Shared state ----
const state = {
  activeSites: ['deepseek', 'chatgpt'],  // ordered list, max 2. [0]=left, [1]=right
  activePanel: 'left',  // which panel receives input: 'left' | 'right'
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
const panelSwitch = $('#panel-switch');

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
  // Init input area module
  inputModule = createInputAreaModule({ container: inputArea, state, utils });
  inputModule.init();

  inputModule.onSend((text) => {
    const mod = panelModules[state.activePanel];
    if (mod) mod.module.send(text);
  });

  // Site icon clicks
  siteIcons.forEach(icon => {
    icon.addEventListener('click', () => toggleSite(icon.dataset.site));
  });

  debugToggle.addEventListener('click', toggleDebugPanel);
  debugClear.addEventListener('click', clearDebugLog);
  document.getElementById('debug-copy').addEventListener('click', copyDebugLog);

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

  // Show center switch only when both panels are active
  panelSwitch.classList.toggle('hidden', state.activeSites.length < 2);

  updateIndicators();
}

function updateIndicators() {
  for (const side of ['left', 'right']) {
    const mod = panelModules[side];
    if (mod && mod.indicator) {
      mod.indicator.classList.toggle('active', state.activePanel === side);
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

  const indicator = document.createElement('div');
  indicator.className = 'panel-indicator';
  if (state.activePanel === side) indicator.classList.add('active');

  const container = document.createElement('div');
  container.style.cssText = 'flex:1;min-height:0;position:relative;';

  panel.innerHTML = '';
  panel.appendChild(indicator);
  panel.appendChild(container);
  panel.classList.remove('hidden');

  const activate = () => {
    appendDebug('app', `indicator mousedown → activePanel: ${state.activePanel} → ${side}`);
    if (state.activePanel !== side) {
      state.activePanel = side;
      updateIndicators();
    }
  };
  indicator.addEventListener('mousedown', activate);
  panel._indicatorActivate = activate;

  const panelDom = makePanelDom(backend, container);
  const module = createEmbedSyncModule({
    state: { backend, loggedIn: false, requestId: 0 },
    dom: panelDom,
    utils: { appendDebug }
  });

  module.init();
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

// ---- Debug panel ----
function toggleDebugPanel() {
  const visible = debugPanel.classList.toggle('hidden');
  debugToggle.classList.toggle('active', !visible);
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
