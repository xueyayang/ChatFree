// modules/preset-panel.js
// Preset rules panel — toggle-able instruction rules prepended to AI messages.
// Standalone module: manages its own DOM, state, and persistence.
//
// Interface: createPresetPanel({ container }) → { getActiveRulesText, onChange, getPresets }

const STORAGE_KEY = 'chatfree_presets';

export function createPresetPanel({ container }) {
  let presets = [];
  const changeCallbacks = [];
  let _fileInput = null;

  async function loadPresets() {
    // 1. Try localStorage (user's saved data)
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.length) {
          presets = saved;
          return;
        }
      }
    } catch { /* fall through to defaults */ }

    // 2. Load seed data from bundled JSON file
    try {
      const url = chrome.runtime.getURL('data/presets.json');
      const resp = await fetch(url);
      if (resp.ok) {
        presets = await resp.json();
        if (presets.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
          return;
        }
      }
    } catch { /* fall through to empty */ }

    // 3. Ultimate fallback
    presets = [];
  }

  function savePresets() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    notifyChange();
  }

  function notifyChange() {
    changeCallbacks.forEach(cb => cb(presets));
  }

  function getActiveRulesText() {
    return presets.filter(p => p.enabled).map(p => p.text).join('\n');
  }

  function render() {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.id = 'preset-header';

    const title = document.createElement('span');
    title.id = 'preset-title';
    title.textContent = 'Rules';
    header.appendChild(title);

    const addBtn = document.createElement('button');
    addBtn.id = 'preset-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add rule';
    addBtn.addEventListener('click', addPreset);
    header.appendChild(addBtn);

    const loadBtn = document.createElement('button');
    loadBtn.id = 'preset-load-btn';
    loadBtn.textContent = '\u{1F4C2}';
    loadBtn.title = 'Load from file';
    loadBtn.addEventListener('click', () => _fileInput.click());
    header.appendChild(loadBtn);

    _fileInput = document.createElement('input');
    _fileInput.type = 'file';
    _fileInput.accept = '.json,.txt';
    _fileInput.hidden = true;
    _fileInput.addEventListener('change', handleFileSelect);
    header.appendChild(_fileInput);

    container.appendChild(header);

    // List
    const list = document.createElement('div');
    list.id = 'preset-list';

    if (!presets.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-empty';
      empty.textContent = 'No rules yet. Click + to add.';
      list.appendChild(empty);
    } else {
      presets.forEach((preset, i) => {
        list.appendChild(createPresetItem(preset, i));
      });
    }

    container.appendChild(list);
  }

  function createPresetItem(preset, index) {
    const item = document.createElement('div');
    item.className = 'preset-item' + (preset.enabled ? ' active' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = preset.enabled;
    checkbox.addEventListener('change', () => {
      presets[index].enabled = checkbox.checked;
      item.classList.toggle('active', checkbox.checked);
      savePresets();
    });
    item.appendChild(checkbox);

    const body = document.createElement('div');
    body.className = 'preset-body';

    const label = document.createElement('span');
    label.className = 'preset-label';
    label.textContent = preset.label;
    body.appendChild(label);

    const text = document.createElement('span');
    text.className = 'preset-text';
    text.textContent = preset.text;
    body.appendChild(text);

    item.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'preset-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'preset-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = '编辑';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editPreset(index);
    });
    actions.appendChild(editBtn);

    item.appendChild(actions);

    // Right-click to delete
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = confirm('删除规则 "' + preset.label + '"?');
      if (ok) {
        presets.splice(index, 1);
        savePresets();
        render();
      }
    });

    return item;
  }

  function addPreset() {
    const label = prompt('规则名称（显示在左侧面板）:');
    if (!label || !label.trim()) return;
    const text = prompt('规则文本（将附加在每次发送的消息前面）:');
    if (!text || !text.trim()) return;

    presets.push({
      id: 'p' + Date.now(),
      label: label.trim(),
      text: text.trim(),
      enabled: true
    });
    savePresets();
    render();
  }

  function editPreset(index) {
    const preset = presets[index];
    const label = prompt('规则名称:', preset.label);
    if (label === null) return;
    const text = prompt('规则文本:', preset.text);
    if (text === null) return;

    if (label.trim()) preset.label = label.trim();
    if (text.trim()) preset.text = text.trim();
    savePresets();
    render();
  }

  function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        let imported = [];
        if (Array.isArray(data)) {
          imported = data;
        } else if (data.presets && Array.isArray(data.presets)) {
          imported = data.presets;
        } else {
          throw new Error('Expected array or { presets: [...] }');
        }
        imported.forEach((item, i) => {
          presets.push({
            id: 'p' + Date.now() + '_' + i,
            label: item.label || 'Rule ' + (i + 1),
            text: item.text || '',
            enabled: item.enabled !== false
          });
        });
        savePresets();
        render();
      } catch (err) {
        alert('Failed to parse file: ' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function onChange(callback) {
    changeCallbacks.push(callback);
  }

  // Init — async: tries localStorage first, then fetches bundled JSON
  const initPromise = loadPresets().then(() => render());

  return { getActiveRulesText, onChange, getPresets: () => presets, initPromise };
}
