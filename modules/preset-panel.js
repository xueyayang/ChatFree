// modules/preset-panel.js
// Preset rules panel — toggle-able instruction rules prepended to AI messages.
//
// Data flow: localStorage is the working copy. On first launch, seed from
// data/presets.json. Every edit writes localStorage then re-renders UI.
//
// Interface: createPresetPanel({ container }) → { getActiveRulesText, onChange }

const STORAGE_KEY = 'chatfree_presets';

export function createPresetPanel({ container }) {
  let presets = [];
  const changeCallbacks = [];
  let _fileInput = null;

  // ---- Data ----
  async function loadPresets() {
    // 1. localStorage — the working copy
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.length) { presets = saved; return; }
      }
    } catch { /* fall through */ }

    // 2. First launch — seed from bundled file
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
    } catch { /* fall through */ }

    presets = [];
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    changeCallbacks.forEach(cb => cb(presets));
  }

  function getActiveRulesText() {
    return presets.filter(p => p.enabled).map(p => p.text).join('\n');
  }

  // ---- Render ----
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
    addBtn.title = '添加规则';
    addBtn.addEventListener('click', addPreset);
    header.appendChild(addBtn);

    const fileBtn = document.createElement('button');
    fileBtn.id = 'preset-load-btn';
    fileBtn.textContent = '\u{1F4C2}';
    fileBtn.title = '导入/导出 JSON 文件';
    fileBtn.addEventListener('click', () => _fileInput.click());
    header.appendChild(fileBtn);

    _fileInput = document.createElement('input');
    _fileInput.type = 'file';
    _fileInput.accept = '.json';
    _fileInput.hidden = true;
    _fileInput.addEventListener('change', handleImport);
    header.appendChild(_fileInput);

    container.appendChild(header);

    // List
    const list = document.createElement('div');
    list.id = 'preset-list';

    if (!presets.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-empty';
      empty.textContent = '暂无规则。点 + 添加。';
      list.appendChild(empty);
    } else {
      presets.forEach((p, i) => list.appendChild(createItem(p, i)));
    }

    container.appendChild(list);
  }

  function createItem(preset, index) {
    const item = document.createElement('div');
    item.className = 'preset-item' + (preset.enabled ? ' active' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = preset.enabled;
    cb.addEventListener('change', () => {
      presets[index].enabled = cb.checked;
      item.classList.toggle('active', cb.checked);
      save();
    });
    item.appendChild(cb);

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

    // Edit button (hover)
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

    // Right-click → delete
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm('删除 "' + preset.label + '"?')) {
        presets.splice(index, 1);
        save();
        render();
      }
    });

    return item;
  }

  // ---- Edit operations (save + re-render) ----
  function addPreset() {
    const label = prompt('规则名称（显示标签）:');
    if (!label || !label.trim()) return;
    const text = prompt('规则文本（附加到消息前）:');
    if (!text || !text.trim()) return;

    presets.push({
      id: 'p' + Date.now(),
      label: label.trim(),
      text: text.trim(),
      enabled: true
    });
    save();
    render();
  }

  function editPreset(index) {
    const p = presets[index];
    const label = prompt('规则名称:', p.label);
    if (label === null) return;
    const text = prompt('规则文本:', p.text);
    if (text === null) return;

    if (label.trim()) p.label = label.trim();
    if (text.trim()) p.text = text.trim();
    save();
    render();
  }

  // ---- Import (📂 button) ----
  function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const imported = Array.isArray(data) ? data
          : (data.presets && Array.isArray(data.presets)) ? data.presets
          : null;
        if (!imported) throw new Error('格式错误：需要 JSON 数组');

        imported.forEach((item, i) => {
          presets.push({
            id: 'p' + Date.now() + '_' + i,
            label: item.label || 'Rule ' + (i + 1),
            text: item.text || '',
            enabled: item.enabled !== false
          });
        });
        save();
        render();
      } catch (err) {
        alert('导入失败: ' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function onChange(callback) {
    changeCallbacks.push(callback);
  }

  // Init
  const initPromise = loadPresets().then(() => render());

  return { getActiveRulesText, onChange, getPresets: () => presets, initPromise };
}
