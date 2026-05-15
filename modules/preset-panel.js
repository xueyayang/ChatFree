// modules/preset-panel.js
// Preset rules panel — toggle-able instruction rules prepended to AI messages.
//
// Data flow: data/presets.json → fetch → memory → UI. All edits in memory.
// On tab close: auto-download presets.json if dirty.
//
// Interface: createPresetPanel({ container }) → { getActiveRulesText, onChange }

export function createPresetPanel({ container }) {
  let presets = [];
  const changeCallbacks = [];
  let dirty = false;
  let dialog = null;
  let editingIndex = -1; // -1 = add new, >= 0 = edit existing

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
    dirty = false;
  }

  // Auto-save on tab close
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      downloadPresets();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---- Dialog ----
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

      if (editingIndex >= 0) {
        presets[editingIndex].label = label;
        presets[editingIndex].text = text;
      } else {
        presets.push({
          id: 'p' + Date.now(),
          label,
          text,
          enabled: true
        });
      }
      dialog.close();
      render();
      downloadPresets();
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

    if (index >= 0) {
      title.textContent = '编辑规则';
      label.value = presets[index].label;
      text.value = presets[index].text;
    } else {
      title.textContent = '添加规则';
      label.value = '';
      text.value = '';
    }
    dialog.showModal();
  }

  // ---- Render ----
  function render() {
    // Preserve dialog if it exists
    const existingDialog = container.querySelector('#preset-dialog');
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
    addBtn.addEventListener('click', () => openDialog(-1));
    header.appendChild(addBtn);

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

    // Restore or create dialog
    if (existingDialog) {
      container.appendChild(existingDialog);
      dialog = existingDialog;
    } else if (!dialog) {
      buildDialog();
    } else {
      container.appendChild(dialog);
    }

    notifyChange();
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
      openDialog(index);
    });
    actions.appendChild(editBtn);

    item.appendChild(actions);

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm('删除 "' + preset.label + '"?')) {
        presets.splice(index, 1);
        dirty = true;
        render();
      }
    });

    return item;
  }

  function onChange(callback) {
    changeCallbacks.push(callback);
  }

  // Init
  const initPromise = loadPresets().then(() => render());

  return { getActiveRulesText, onChange, getPresets: () => presets, initPromise };
}
