// modules/preset-panel.js
// Preset rules panel — toggle-able instruction rules prepended to AI messages.
// Standalone module: manages its own DOM, state, and persistence.
//
// Interface: createPresetPanel({ container }) → { getActiveRulesText, onChange, getPresets }

const STORAGE_KEY = 'chatfree_presets';

const DEFAULT_PRESETS = [
  { id: 'p1', label: 'Skip pleasantries', text: '请直接给出答案，不要寒暄客套，不要说"好的"、"明白了"、"希望对你有帮助"等多余的话。', enabled: true },
  { id: 'p2', label: 'Code best practices', text: '代码请使用最佳实践，包含适当的错误处理。', enabled: false },
  { id: 'p3', label: 'Reply in Chinese', text: '请用中文回答。', enabled: true },
];

export function createPresetPanel({ container }) {
  let presets = [];
  const changeCallbacks = [];
  let _fileInput = null;

  function loadPresets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        presets = JSON.parse(raw);
        if (!presets.length) presets = DEFAULT_PRESETS.map(p => ({ ...p }));
      } else {
        presets = DEFAULT_PRESETS.map(p => ({ ...p }));
      }
    } catch {
      presets = DEFAULT_PRESETS.map(p => ({ ...p }));
    }
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

    const label = document.createElement('span');
    label.className = 'preset-label';
    label.textContent = preset.label;
    label.title = preset.text;
    item.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'preset-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'preset-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editPreset(index);
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'preset-del-btn';
    delBtn.textContent = '×';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      presets.splice(index, 1);
      savePresets();
      render();
    });
    actions.appendChild(delBtn);

    item.appendChild(actions);

    return item;
  }

  function addPreset() {
    const label = prompt('Rule name (short):');
    if (!label || !label.trim()) return;
    const text = prompt('Rule text (prepended to message):');
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
    const label = prompt('Rule name:', preset.label);
    if (label === null) return;
    const text = prompt('Rule text:', preset.text);
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

  // Init
  loadPresets();
  render();

  return { getActiveRulesText, onChange, getPresets: () => presets };
}
