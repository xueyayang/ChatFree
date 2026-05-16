// modules/preset-panel.js
// Preset rules panel — toggle-able instruction rules prepended to AI messages.
//
// Storage: localStorage as primary store, data/定制规则.json as seed (first launch).
// Normal view: read-only. Edit mode: full CRUD via edit dialog.
//
// Interface: createPresetPanel({ container }) → { getActiveRulesText, onChange }

export function createPresetPanel({ container }) {
  const STORAGE_KEY = 'chatfree_presets';
  let presets = [];
  let filterText = '';
  const changeCallbacks = [];
  let dirty = false;
  let dialog = null;       // add/edit dialog
  let editDialog = null;   // edit-mode dialog
  let editPresets = null;  // working copy during edit mode
  let editingIndex = -1;
  let usageRecordedThisTick = false;

  // ---- Storage ----
  async function loadPresets() {
    // 1) Try localStorage first
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        presets = JSON.parse(stored);
        return;
      } catch { /* fall through */ }
    }

    // 2) Seed from data/定制规则.json
    try {
      const url = chrome.runtime.getURL('data/定制规则.json');
      const resp = await fetch(url);
      if (resp.ok) {
        presets = await resp.json();
        saveToLocalStorage();
        return;
      }
    } catch { /* empty */ }

    presets = [];
  }

  function saveToLocalStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets, null, 2));
    dirty = false;
  }

  function downloadPresets() {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '定制规则.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importPresetsFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error('Not an array');
          editPresets = data;
          renderEditList();
        } catch {
          alert('无效的 JSON 文件。请导入有效的 presets 数组。');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // Auto-save on tab close
  window.addEventListener('beforeunload', () => {
    if (dirty) saveToLocalStorage();
  });

  function notifyChange() {
    changeCallbacks.forEach(cb => cb(presets));
  }

  function getActiveRulesText() {
    const enabled = presets.filter(p => p.enabled);
    if (enabled.length > 0 && !usageRecordedThisTick) {
      enabled.forEach(p => { p.count = (p.count || 0) + 1; });
      usageRecordedThisTick = true;
      dirty = true;
      sortByCount(presets);
      saveToLocalStorage();
      render();
      Promise.resolve().then(() => { usageRecordedThisTick = false; });
    }
    return enabled.map(p => p.text).join('\n');
  }

  function sortByCount(arr) {
    arr.sort((a, b) => (b.count || 0) - (a.count || 0));
  }

  // ---- Add/Edit dialog (nested) ----
  function buildDialog() {
    dialog = document.createElement('dialog');
    dialog.id = 'preset-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <h3 id="dialog-title"></h3>
        <div class="dialog-field">
          <label for="dialog-label">名称</label>
          <input type="text" id="dialog-label" maxlength="40" placeholder="简短标签，如"直接回答"">
        </div>
        <div class="dialog-field">
          <label for="dialog-text">文本</label>
          <textarea id="dialog-text" rows="4" placeholder="附加到消息前的文本，如"请直接给出答案""></textarea>
        </div>
        <div class="dialog-buttons">
          <button type="submit" id="dialog-save">保存</button>
          <button type="button" id="dialog-cancel">取消</button>
        </div>
      </form>
    `;
    container.appendChild(dialog);

    const form = dialog.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const label = dialog.querySelector('#dialog-label').value.trim();
      const text = dialog.querySelector('#dialog-text').value.trim();
      if (!label || !text) return;

      const target = editPresets || presets;
      if (editingIndex >= 0) {
        target[editingIndex].label = label;
        target[editingIndex].text = text;
      } else {
        target.push({
          label,
          text,
          enabled: true,
          count: 0
        });
      }
      dialog.close();

      if (editPresets) {
        // In edit mode: refresh the edit list only
        renderEditList();
      } else {
        render();
        dirty = true;
        saveToLocalStorage();
      }
    });

    dialog.querySelector('#dialog-cancel').addEventListener('click', () => {
      dialog.close();
    });
  }

  function openDialog(index) {
    editingIndex = index;
    const title = dialog.querySelector('#dialog-title');
    const label = dialog.querySelector('#dialog-label');
    const text = dialog.querySelector('#dialog-text');

    const source = editPresets || presets;
    if (index >= 0) {
      title.textContent = '编辑规则';
      label.value = source[index].label;
      text.value = source[index].text;
    } else {
      title.textContent = '添加规则';
      label.value = '';
      text.value = '';
    }
    dialog.showModal();
  }

  // ---- Edit-mode dialog ----
  function buildEditDialog() {
    editDialog = document.createElement('dialog');
    editDialog.id = 'edit-dialog';
    editDialog.innerHTML = `
      <div id="edit-dialog-header">
        <span id="edit-dialog-title">编辑规则</span>
        <button id="edit-dialog-close" title="关闭">✕</button>
      </div>
      <div id="edit-list"></div>
      <div id="edit-list-add-row">
        <button id="edit-list-add-btn" title="添加规则">+ 添加新规则</button>
      </div>
      <div id="edit-dialog-footer">
        <button id="edit-import-btn" title="从文件导入 JSON">导入</button>
        <div id="edit-dialog-actions">
          <button id="edit-save-btn">保存</button>
          <button id="edit-saveas-btn">另存为</button>
        </div>
      </div>
    `;
    container.appendChild(editDialog);

    editDialog.querySelector('#edit-dialog-close').addEventListener('click', () => {
      editDialog.close();
      editPresets = null;
      render();
    });

    editDialog.querySelector('#edit-list-add-btn').addEventListener('click', () => {
      openDialog(-1);
    });

    editDialog.querySelector('#edit-save-btn').addEventListener('click', () => {
      presets = [...editPresets];
      saveToLocalStorage();
      editDialog.close();
      editPresets = null;
      render();
    });

    editDialog.querySelector('#edit-saveas-btn').addEventListener('click', () => {
      // Download the edit copy
      const blob = new Blob([JSON.stringify(editPresets, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '定制规则.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    editDialog.querySelector('#edit-import-btn').addEventListener('click', () => {
      importPresetsFile();
    });

    editDialog.addEventListener('close', () => {
      editPresets = null;
      render();
    });
  }

  function openEditDialog() {
    if (!editDialog) buildEditDialog();
    editPresets = JSON.parse(JSON.stringify(presets)); // deep copy
    renderEditList();
    editDialog.showModal();
  }

  function renderEditList() {
    if (!editDialog) return;
    sortByCount(editPresets);
    const list = editDialog.querySelector('#edit-list');
    list.innerHTML = '';

    if (!editPresets || !editPresets.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-empty';
      empty.textContent = '暂无规则。点下方 + 添加。';
      list.appendChild(empty);
      return;
    }

    editPresets.forEach((p, i) => {
      list.appendChild(createEditItem(p, i));
    });
  }

  function createEditItem(preset, index) {
    const item = document.createElement('div');
    item.className = 'preset-item edit-item' + (preset.enabled ? ' active' : '');

    const body = document.createElement('div');
    body.className = 'preset-body';

    const labelRow = document.createElement('div');
    labelRow.className = 'preset-label-row';

    const label = document.createElement('span');
    label.className = 'preset-label';
    label.textContent = preset.label;
    labelRow.appendChild(label);

    const count = document.createElement('span');
    count.className = 'preset-count';
    count.textContent = preset.count || 0;
    labelRow.appendChild(count);

    body.appendChild(labelRow);

    const text = document.createElement('span');
    text.className = 'preset-text';
    text.textContent = preset.text;
    body.appendChild(text);

    item.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'preset-actions edit-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'preset-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = '编辑';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDialog(index);
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'preset-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = '删除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('删除 "' + preset.label + '"?')) {
        editPresets.splice(index, 1);
        renderEditList();
      }
    });
    actions.appendChild(delBtn);

    item.appendChild(actions);

    return item;
  }

  // ---- Normal render ----
  function render() {
    const existingDialog = container.querySelector('#preset-dialog');
    const existingEditDialog = container.querySelector('#edit-dialog');
    container.innerHTML = '';

    // Header (title + search + gear in one row)
    const header = document.createElement('div');
    header.id = 'preset-header';

    const title = document.createElement('span');
    title.id = 'preset-title';
    title.textContent = '领导指示';
    header.appendChild(title);

    const search = document.createElement('input');
    search.type = 'text';
    search.id = 'preset-search';
    search.placeholder = '搜索...';
    search.value = filterText;
    search.addEventListener('input', () => {
      filterText = search.value.toLowerCase();
      applyFilter();
    });
    header.appendChild(search);

    const editBtn = document.createElement('button');
    editBtn.id = 'preset-edit-icon';
    editBtn.textContent = '⚙';
    editBtn.title = '编辑规则';
    editBtn.addEventListener('click', () => openEditDialog());
    header.appendChild(editBtn);

    container.appendChild(header);

    // List
    const list = document.createElement('div');
    list.id = 'preset-list';
    container.appendChild(list);
    renderAllItems(list);

    // Restore or create dialogs
    if (existingDialog) {
      container.appendChild(existingDialog);
      dialog = existingDialog;
    } else if (!dialog) {
      buildDialog();
    } else {
      container.appendChild(dialog);
    }

    if (existingEditDialog) {
      container.appendChild(existingEditDialog);
      editDialog = existingEditDialog;
    } else if (editDialog) {
      container.appendChild(editDialog);
    }

    notifyChange();
  }

  function renderAllItems(list) {
    sortByCount(presets);
    list.innerHTML = '';

    if (!presets.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-empty';
      empty.textContent = '暂无规则。点 ⚙ 编辑。';
      list.appendChild(empty);
      return;
    }

    presets.forEach((p, i) => list.appendChild(createItem(p, i)));
  }

  function applyFilter() {
    const items = container.querySelectorAll('#preset-list > .preset-item');
    if (!filterText) {
      items.forEach(el => el.classList.remove('filtered-out'));
      return;
    }
    items.forEach(el => {
      const label = el.querySelector('.preset-label').textContent.toLowerCase();
      const text = el.querySelector('.preset-text').textContent.toLowerCase();
      el.classList.toggle('filtered-out', !label.includes(filterText) && !text.includes(filterText));
    });
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
      dirty = true;
      saveToLocalStorage();
      notifyChange();
    });
    item.appendChild(cb);

    const body = document.createElement('div');
    body.className = 'preset-body';

    const labelRow = document.createElement('div');
    labelRow.className = 'preset-label-row';

    const label = document.createElement('span');
    label.className = 'preset-label';
    label.textContent = preset.label;
    labelRow.appendChild(label);

    const count = document.createElement('span');
    count.className = 'preset-count';
    count.textContent = preset.count || 0;
    labelRow.appendChild(count);

    body.appendChild(labelRow);

    const text = document.createElement('span');
    text.className = 'preset-text';
    text.textContent = preset.text;
    body.appendChild(text);

    item.appendChild(body);

    return item;
  }

  function onChange(callback) {
    changeCallbacks.push(callback);
  }

  // Init
  const initPromise = loadPresets().then(() => render());

  return { getActiveRulesText, onChange, getPresets: () => presets, initPromise };
}
