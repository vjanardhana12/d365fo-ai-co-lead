import * as vscode from 'vscode';

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'select' | 'textarea' | 'folder' | 'file';
  value?: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string; description?: string }[];
  help?: string;
}

export interface FormResult {
  [key: string]: string;
}

/**
 * Open a webview-based form. Returns the submitted values, or undefined if cancelled.
 */
export function showForm(
  ctx: vscode.ExtensionContext,
  title: string,
  fields: FormField[],
  submitLabel = 'Save',
): Promise<FormResult | undefined> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'd365fo.form',
      title,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png');

    let resolved = false;
    panel.onDidDispose(() => { if (!resolved) { resolved = true; resolve(undefined); } });

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'submit') {
        resolved = true;
        resolve(msg.values);
        panel.dispose();
      } else if (msg.type === 'cancel') {
        resolved = true;
        resolve(undefined);
        panel.dispose();
      } else if (msg.type === 'browse') {
        const isFile = msg.kind === 'file';
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: isFile,
          canSelectFolders: !isFile,
          canSelectMany: false,
          openLabel: isFile ? 'Select file' : 'Select folder',
        });
        if (picked && picked[0]) {
          panel.webview.postMessage({ type: 'browseResult', key: msg.key, path: picked[0].fsPath });
        }
      }
    });

    panel.webview.html = renderForm(title, fields, submitLabel);
  });
}

function renderForm(title: string, fields: FormField[], submitLabel: string): string {
  const fieldsHtml = fields.map(f => {
    const id = `f_${f.key}`;
    const req = f.required ? 'required' : '';
    const reqMark = f.required ? ' <span class="req">*</span>' : '';
    const help = f.help ? `<div class="help">${escape(f.help)}</div>` : '';
    let input = '';
    switch (f.type) {
      case 'text':
      case 'email':
      case 'password':
        input = `<input id="${id}" type="${f.type}" ${req} placeholder="${escape(f.placeholder ?? '')}" value="${escape(f.value ?? '')}" />`;
        break;
      case 'textarea':
        input = `<textarea id="${id}" ${req} placeholder="${escape(f.placeholder ?? '')}" rows="3">${escape(f.value ?? '')}</textarea>`;
        break;
      case 'select':
        const opts = (f.options ?? []).map(o =>
          `<option value="${escape(o.value)}" ${o.value === f.value ? 'selected' : ''}>${escape(o.label)}${o.description ? ` - ${escape(o.description)}` : ''}</option>`,
        ).join('');
        input = `<select id="${id}" ${req}>${opts}</select>`;
        break;
      case 'folder':
      case 'file':
        input = `<div class="path-row">
          <input id="${id}" type="text" ${req} placeholder="${escape(f.placeholder ?? '')}" value="${escape(f.value ?? '')}" />
          <button type="button" class="btn-secondary btn-browse" data-key="${escape(f.key)}" data-kind="${f.type}">Browse...</button>
        </div>`;
        break;
    }
    return `<div class="field">
      <label for="${id}">${escape(f.label)}${reqMark}</label>
      ${input}
      ${help}
    </div>`;
  }).join('\n');

  const fieldKeys = JSON.stringify(fields.map(f => f.key));

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; max-width: 560px; }
    h1 { font-size: 18px; margin: 0 0 6px; font-weight: 600; }
    .sub { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 24px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 12px; margin-bottom: 4px; color: var(--vscode-foreground); }
    .req { color: var(--vscode-errorForeground); }
    input, select, textarea {
      width: 100%; box-sizing: border-box; padding: 6px 8px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
      font-family: var(--vscode-font-family); font-size: 13px; outline: none;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
    .help { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--vscode-widget-border); }
    button {
      padding: 6px 18px; border: none; cursor: pointer; font-size: 13px; border-radius: 2px;
      font-family: var(--vscode-font-family);
    }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .err { color: var(--vscode-errorForeground); font-size: 12px; margin-top: 8px; min-height: 16px; }
    .path-row { display: flex; gap: 6px; }
    .path-row input { flex: 1; }
    .btn-browse { padding: 4px 12px; font-size: 12px; white-space: nowrap; }
  </style></head><body>
    <h1>${escape(title)}</h1>
    <div class="sub">All fields marked <span class="req">*</span> are required.</div>
    <form id="form">
      ${fieldsHtml}
      <div class="err" id="err"></div>
      <div class="actions">
        <button type="button" class="btn-secondary" id="cancel">Cancel</button>
        <button type="submit" class="btn-primary">${escape(submitLabel)}</button>
      </div>
    </form>
    <script>
      const vscode = acquireVsCodeApi();
      const keys = ${fieldKeys};
      const form = document.getElementById('form');
      const err = document.getElementById('err');
      document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
      // Browse buttons
      document.querySelectorAll('.btn-browse').forEach(btn => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'browse', key: btn.dataset.key, kind: btn.dataset.kind });
        });
      });
      window.addEventListener('message', (e) => {
        const m = e.data;
        if (m && m.type === 'browseResult') {
          const el = document.getElementById('f_' + m.key);
          if (el) el.value = m.path;
        }
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const values = {};
        for (const k of keys) {
          const el = document.getElementById('f_' + k);
          values[k] = el.value;
        }
        // basic required check
        for (const k of keys) {
          const el = document.getElementById('f_' + k);
          if (el.required && !el.value.trim()) {
            err.textContent = 'Please fill all required fields.';
            el.focus();
            return;
          }
        }
        vscode.postMessage({ type: 'submit', values });
      });
      // Autofocus first field
      const first = document.querySelector('input, select, textarea');
      if (first) first.focus();
    </script>
  </body></html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}
