// modules/preset-panel.js
// Preset rules panel — toggle-able instruction rules prepended to AI messages.
//
// Data flow: data/presets.json → memory → UI. Edits stay in memory until
// user explicitly downloads (💾). No localStorage, no automatic persistence.
//
// Interface: createPresetPanel({ container }) → { getActiveRulesText, onChange }

export function createPresetPanel({ container }) {
  let presets = [];
  const changeCallbacks = [];
  let _importInput = null;

  // ---- Data ----
  async function loadPresets() {
    try {
      const url = chrome.runtime.getURL('data/presets.json');
      const resp = await fetch(url);
      if (resp.ok) {
        presets = await resp.json();
        return;
      }
    } catch { /* empty */ }
    presets = [];
  }

  function notifyChange() {
    changeCallbacks.forEach(cb => cb(presets));
  }

  function getActiveRulesText() {
    return presets.filter(p => p.enabled).map(p => p.text).join('\n');
  }

  function downloadPresets() {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'presets.json';
    a.click();
    URL.revokeObjectURL(url);
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

    const saveBtn = document.createElement('button');
    saveBtn.id = 'preset-save-btn';
    saveBtn.textContent = '\u{1F4BE}';
    saveBtn.title = '下载保存 presets.json（替换 data/presets.json）';
    saveBtn.addEventListener('click', () => {
      if (confirm('下载 presets.json 并用它替换 data/presets.json 文件？')) {
        downloadPresets();
      }
    });
    header.appendChild(saveBtn);

    const importBtn = document.createElement('button');
    importBtn.id = 'preset-load-btn';
    importBtn.textContent = '\u{1F4C2}';
    importBtn.title = '从 JSON 文件导入';
    importBtn.addEventListener('click', () => _importInput.click());
    header.appendChild(importBtn);

    _importInput = document.createElement('input');
    _importInput.type = 'file';
    _importInput.accept = '.json';
    _importInput.hidden = true;
    _importInput.addEventListener('change', handleImport);
    header.appendChild(_importInput);

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
      notifyChange();
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

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm('删除 "' + preset.label + '"?')) {
        presets.splice(index, 1);
        render();
      }
    });

    return item;
  }

  // ---- Edit operations (memory only) ----
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
    render();
  }

  // ---- Import ----
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
