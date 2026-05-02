import * as vscode from 'vscode';

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'select' | 'textarea' | 'folder' | 'file' | 'info' | 'emailSignIn';
  value?: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string; description?: string }[];
  help?: string;
  /** Optional label for the action button (used by 'emailSignIn'). Defaults to 'Sign in'. */
  actionLabel?: string;
  /** Optional dropdown suggestions for 'emailSignIn' (e.g. accounts already signed in to VS Code). */
  suggestions?: string[];
}

export interface FormResult {
  [key: string]: string;
}

export interface FormTestResult {
  ok: boolean;
  message: string;
  /** Optional 3-state level. 'warn' renders amber + counts as ok for save flow. Defaults from `ok`. */
  level?: 'ok' | 'warn' | 'fail';
}

export interface FieldActionResult {
  level: 'ok' | 'warn' | 'fail';
  message: string;
  /** Optional updates to other fields after the action runs. e.g. lock email after sign-in. */
  fieldUpdates?: { [key: string]: { value?: string; readonly?: boolean } };
}

export interface ShowFormOptions {
  submitLabel?: string;
  /**
   * Optional async tester. When provided, the form shows a "Test connection"
   * button that calls this function with the current values. Result is shown
   * inline. Save is NOT blocked - users can save even if the test fails
   * (offline, behind proxy, etc.) but a confirmation prompt is shown.
   */
  onTest?: (values: FormResult) => Promise<FormTestResult>;
  testLabel?: string;
  /**
   * Handler for per-field action buttons (e.g. the Sign in button on an
   * 'emailSignIn' field). Receives the field key and current form values;
   * returns a status message + optional field updates.
   */
  onFieldAction?: (key: string, values: FormResult) => Promise<FieldActionResult>;
}

/**
 * Open a webview-based form. Returns the submitted values, or undefined if cancelled.
 * Backwards compatible: 4th arg may be a string (submit label) or an options object.
 */
export function showForm(
  ctx: vscode.ExtensionContext,
  title: string,
  fields: FormField[],
  submitLabelOrOptions: string | ShowFormOptions = 'Save',
): Promise<FormResult | undefined> {
  const opts: ShowFormOptions = typeof submitLabelOrOptions === 'string'
    ? { submitLabel: submitLabelOrOptions }
    : submitLabelOrOptions;
  const submitLabel = opts.submitLabel ?? 'Save';
  const testLabel = opts.testLabel ?? 'Test connection';
  const hasTester = !!opts.onTest;

  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'd365fo.form',
      title,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png');

    let resolved = false;
    let lastTestOk: boolean | null = null;
    panel.onDidDispose(() => { if (!resolved) { resolved = true; resolve(undefined); } });

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'submit') {
        if (hasTester && lastTestOk !== true) {
          const choice = await vscode.window.showWarningMessage(
            lastTestOk === false
              ? 'The connection test failed. Save anyway?'
              : 'You have not tested the connection yet. Save without testing?',
            { modal: true },
            'Save anyway',
          );
          if (choice !== 'Save anyway') {
            panel.webview.postMessage({ type: 'submitCancelled' });
            return;
          }
        }
        resolved = true;
        resolve(msg.values);
        panel.dispose();
      } else if (msg.type === 'cancel') {
        resolved = true;
        resolve(undefined);
        panel.dispose();
      } else if (msg.type === 'test' && opts.onTest) {
        try {
          const r = await opts.onTest(msg.values);
          lastTestOk = r.ok;
          const level = r.level ?? (r.ok ? 'ok' : 'fail');
          panel.webview.postMessage({ type: 'testResult', ok: r.ok, level, message: r.message });
        } catch (err) {
          lastTestOk = false;
          panel.webview.postMessage({ type: 'testResult', ok: false, level: 'fail', message: String((err as Error)?.message ?? err) });
        }
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
      } else if (msg.type === 'fieldAction' && opts.onFieldAction) {
        try {
          const r = await opts.onFieldAction(msg.key, msg.values);
          panel.webview.postMessage({ type: 'fieldStatus', key: msg.key, level: r.level, message: r.message });
          if (r.fieldUpdates) {
            for (const [k, upd] of Object.entries(r.fieldUpdates)) {
              panel.webview.postMessage({ type: 'fieldUpdate', key: k, value: upd.value, readonly: upd.readonly });
            }
          }
        } catch (err) {
          panel.webview.postMessage({ type: 'fieldStatus', key: msg.key, level: 'fail', message: String((err as Error)?.message ?? err) });
        }
      }
    });

    panel.webview.html = renderForm(title, fields, submitLabel, hasTester, testLabel);
  });
}

function renderForm(title: string, fields: FormField[], submitLabel: string, hasTester: boolean, testLabel: string): string {
  const fieldsHtml = fields.map(f => {
    const id = `f_${f.key}`;
    const req = f.required ? 'required' : '';
    const reqMark = f.required ? ' <span class="req">*</span>' : '';
    const help = f.help ? `<div class="help">${escape(f.help)}</div>` : '';
    if (f.type === 'info') {
      // Read-only display row - no input element. Value renders as a styled badge.
      return `<div class="field info-row">
        <label>${escape(f.label)}</label>
        <div class="info-value">${escape(f.value ?? '')}</div>
        ${help}
      </div>`;
    }
    let input = '';
    switch (f.type) {
      case 'text':
      case 'email':
      case 'password':
        input = `<input id="${id}" type="${f.type}" ${req} placeholder="${escape(f.placeholder ?? '')}" value="${escape(f.value ?? '')}" />`;
        break;
      case 'emailSignIn':
        const sugList = (f.suggestions ?? []).map(s =>
          `<div class="acct-item" data-value="${escape(s)}">${escape(s)}</div>`,
        ).join('');
        input = `<div class="emailsignin-wrap">
          <div class="path-row">
            <input id="${id}" type="email" ${req} placeholder="${escape(f.placeholder ?? 'name@company.com')}" value="${escape(f.value ?? '')}" autocomplete="off" />
            <button type="button" class="btn-secondary btn-action" data-key="${escape(f.key)}">${escape(f.actionLabel ?? 'Sign in')}</button>
          </div>
          ${sugList ? `<div class="acct-dropdown" id="${id}_dd" data-target="${id}">${sugList}</div>` : ''}
          <div class="field-status" id="${id}_status"></div>
        </div>`;
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
    .info-value {
      padding: 6px 10px; border-radius: 3px;
      background: var(--vscode-textBlockQuote-background, var(--vscode-input-background));
      border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
      color: var(--vscode-foreground); font-size: 13px;
    }
    .inline-err { font-size: 11px; color: var(--vscode-errorForeground); margin-top: 4px; }
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
    .test-result { margin-top: 12px; padding: 8px 12px; border-radius: 3px; font-size: 12px; display: none; }
    .test-result.ok { background: var(--vscode-testing-iconPassed, #2ea043)20; border: 1px solid var(--vscode-testing-iconPassed, #2ea043); color: var(--vscode-testing-iconPassed, #2ea043); }
    .test-result.fail { background: var(--vscode-testing-iconFailed, #f85149)20; border: 1px solid var(--vscode-testing-iconFailed, #f85149); color: var(--vscode-testing-iconFailed, #f85149); }
    .test-result.warn { background: var(--vscode-editorWarning-foreground, #d29922)20; border: 1px solid var(--vscode-editorWarning-foreground, #d29922); color: var(--vscode-editorWarning-foreground, #d29922); }
    .test-result.busy { background: transparent; border: 1px dashed var(--vscode-widget-border); color: var(--vscode-descriptionForeground); }
    .field-status { margin-top: 6px; padding: 4px 8px; border-radius: 3px; font-size: 11px; display: none; }
    .field-status.ok { color: var(--vscode-testing-iconPassed, #2ea043); }
    .field-status.fail { color: var(--vscode-testing-iconFailed, #f85149); }
    .field-status.warn { color: var(--vscode-editorWarning-foreground, #d29922); }
    .field-status.busy { color: var(--vscode-descriptionForeground); }
    input[readonly] { opacity: 0.7; cursor: not-allowed; background: var(--vscode-textBlockQuote-background, var(--vscode-input-background)); }
    .emailsignin-wrap { position: relative; }
    .acct-dropdown {
      display: none; position: absolute; left: 0; right: 90px; top: 100%; margin-top: 2px;
      background: var(--vscode-quickInput-background, var(--vscode-input-background));
      border: 1px solid var(--vscode-focusBorder, var(--vscode-widget-border));
      border-radius: 3px; max-height: 180px; overflow-y: auto; z-index: 50;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .acct-dropdown.open { display: block; }
    .acct-item { padding: 6px 10px; cursor: pointer; font-size: 13px; color: var(--vscode-foreground); }
    .acct-item:hover, .acct-item.active { background: var(--vscode-list-hoverBackground); }
    .actions-left { margin-right: auto; }
  </style></head><body>
    <h1>${escape(title)}</h1>
    <div class="sub">All fields marked <span class="req">*</span> are required.</div>
    <form id="form">
      ${fieldsHtml}
      <div class="err" id="err"></div>
      <div class="test-result" id="testResult"></div>
      <div class="actions">
        ${hasTester ? `<button type="button" class="btn-secondary actions-left" id="testBtn">${escape(testLabel)}</button>` : ''}
        <button type="button" class="btn-secondary" id="cancel">Cancel</button>
        <button type="submit" class="btn-primary" id="submitBtn">${escape(submitLabel)}</button>
      </div>
    </form>
    <script>
      const vscode = acquireVsCodeApi();
      const keys = ${fieldKeys};
      const form = document.getElementById('form');
      const err = document.getElementById('err');
      const testBtn = document.getElementById('testBtn');
      const submitBtn = document.getElementById('submitBtn');
      const testResult = document.getElementById('testResult');
      document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
      function collectValues() {
        const values = {};
        for (const k of keys) {
          const el = document.getElementById('f_' + k);
          if (el && 'value' in el) values[k] = el.value;
        }
        return values;
      }
      // Browse buttons
      document.querySelectorAll('.btn-browse').forEach(btn => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'browse', key: btn.dataset.key, kind: btn.dataset.kind });
        });
      });

      // Built-in helper: live email format validation on blur for any
      // field with type='email'. Shows inline error below the field.
      document.querySelectorAll('input[type=email]').forEach(el => {
        el.addEventListener('blur', () => {
          const v = (el.value || '').trim();
          // Remove existing inline error if any
          const existing = el.parentElement && el.parentElement.querySelector('.inline-err');
          if (existing) existing.remove();
          if (!v) return;
          const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
          if (!re.test(v)) {
            const note = document.createElement('div');
            note.className = 'inline-err';
            note.textContent = 'Not a valid email address.';
            el.parentElement.appendChild(note);
          }
        });
      });
      // Built-in helper: when the user pastes a full ADO URL into the
      // 'adoOrgUrl' field, normalize it AND auto-fill 'adoProject' if empty.
      // Runs on input + blur so it works for paste, type, and tab-out.
      const orgEl = document.getElementById('f_adoOrgUrl');
      const projEl = document.getElementById('f_adoProject');
      if (orgEl && projEl) {
        const apply = () => {
          const raw = (orgEl.value || '').trim();
          if (!raw) return;
          // Match dev.azure.com/<org>[/<project>] or <org>.visualstudio.com[/<project>]
          let m = raw.match(/^https?:\\/\\/(?:dev\\.azure\\.com|ssh\\.dev\\.azure\\.com)\\/([^\\/?#]+)(?:\\/([^\\/?#]+))?/i);
          let host, org, proj;
          if (m) { host = 'dev.azure.com'; org = m[1]; proj = m[2]; }
          else {
            m = raw.match(/^https?:\\/\\/([^\\/.]+)\\.visualstudio\\.com(?:\\/([^\\/?#]+))?/i);
            if (m) { host = m[1] + '.visualstudio.com'; org = ''; proj = m[2]; }
          }
          if (host === 'dev.azure.com' && org) {
            const canonical = 'https://dev.azure.com/' + org;
            if (orgEl.value !== canonical) orgEl.value = canonical;
          } else if (m && host && host.endsWith('.visualstudio.com')) {
            const canonical = 'https://' + host;
            if (orgEl.value !== canonical) orgEl.value = canonical;
          } else {
            // Just trim trailing slash
            const trimmed = raw.replace(/\\/+$/, '');
            if (orgEl.value !== trimmed) orgEl.value = trimmed;
          }
          if (proj) {
            const decoded = decodeURIComponent(proj);
            // Skip ADO path keywords
            const stop = ['_git','_apis','_workitems','_build','_release','_dashboards','_settings','_artifacts','_boards','_pipelines','_test','_packaging','_usersSettings'];
            if (!stop.includes(decoded) && !projEl.value.trim()) {
              projEl.value = decoded;
            }
          }
        };
        orgEl.addEventListener('blur', apply);
        orgEl.addEventListener('paste', () => setTimeout(apply, 0));
      }

      // Built-in helper: if the user pastes a full ADO project URL into a
      // project field (primary or secondary), strip it down to just the
      // project name. Works for both 'adoProject' and 'adoProjectSecondary'.
      ['f_adoProject', 'f_adoProjectSecondary'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const stripToProject = () => {
          const raw = (el.value || '').trim();
          if (!raw) return;
          // Only act if it looks like a URL.
          let m = raw.match(/^https?:\\/\\/(?:dev\\.azure\\.com|ssh\\.dev\\.azure\\.com)\\/[^\\/?#]+\\/([^\\/?#]+)/i);
          if (!m) m = raw.match(/^https?:\\/\\/[^\\/.]+\\.visualstudio\\.com\\/([^\\/?#]+)/i);
          if (!m) return;
          const decoded = decodeURIComponent(m[1]);
          const stop = ['_git','_apis','_workitems','_build','_release','_dashboards','_settings','_artifacts','_boards','_pipelines','_test','_packaging','_usersSettings'];
          if (!stop.includes(decoded)) {
            el.value = decoded;
          }
        };
        el.addEventListener('blur', stripToProject);
        el.addEventListener('paste', () => setTimeout(stripToProject, 0));
      });

      // Built-in helper: trim SharePoint URL down to the site root.
      // Strips /Shared%20Documents/..., /SitePages/..., /Lists/..., query strings, fragments, etc.
      const spEl = document.getElementById('f_sharepointSiteUrl');
      if (spEl) {
        const trimSp = () => {
          const raw = (spEl.value || '').trim();
          if (!raw) return;
          // Match scheme + host + /sites/<name> OR /teams/<name>
          const m = raw.match(/^(https?:\\/\\/[^\\/?#]+)\\/(sites|teams)\\/([^\\/?#]+)/i);
          if (m) {
            const canonical = m[1] + '/' + m[2].toLowerCase() + '/' + decodeURIComponent(m[3]);
            if (spEl.value !== canonical) spEl.value = canonical;
          } else {
            // No /sites or /teams - just strip query/fragment/trailing slash
            const cleaned = raw.split('?')[0].split('#')[0].replace(/\\/+$/, '');
            if (spEl.value !== cleaned) spEl.value = cleaned;
          }
        };
        spEl.addEventListener('blur', trimSp);
        spEl.addEventListener('paste', () => setTimeout(trimSp, 0));
      }
      // Field-action buttons (e.g. Sign in beside an emailSignIn field).
      document.querySelectorAll('.btn-action').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          const status = document.getElementById('f_' + key + '_status');
          if (status) {
            status.className = 'field-status busy';
            status.style.display = 'block';
            status.textContent = 'Working...';
          }
          btn.disabled = true;
          vscode.postMessage({ type: 'fieldAction', key, values: collectValues() });
        });
      });

      // Custom account dropdown for emailSignIn fields.
      document.querySelectorAll('.acct-dropdown').forEach(dd => {
        const targetId = dd.dataset.target;
        const inp = document.getElementById(targetId);
        if (!inp) return;
        const items = Array.from(dd.querySelectorAll('.acct-item'));
        const showAll = () => {
          if (inp.hasAttribute('readonly')) { dd.classList.remove('open'); return; }
          items.forEach(it => { it.style.display = ''; });
          if (items.length) dd.classList.add('open');
        };
        const filterByInput = () => {
          if (inp.hasAttribute('readonly')) { dd.classList.remove('open'); return; }
          const q = (inp.value || '').toLowerCase().trim();
          let any = false;
          items.forEach(it => {
            const v = it.dataset.value.toLowerCase();
            const show = !q || v.includes(q);
            it.style.display = show ? '' : 'none';
            if (show) any = true;
          });
          if (any) dd.classList.add('open'); else dd.classList.remove('open');
        };
        inp.addEventListener('focus', showAll);
        inp.addEventListener('click', showAll);
        inp.addEventListener('input', filterByInput);
        inp.addEventListener('blur', () => setTimeout(() => dd.classList.remove('open'), 150));
        items.forEach(it => {
          it.addEventListener('mousedown', (e) => {
            e.preventDefault(); // keep input focus
            inp.value = it.dataset.value;
            dd.classList.remove('open');
            inp.dispatchEvent(new Event('blur'));
          });
        });
      });
      // Test button
      if (testBtn) {
        testBtn.addEventListener('click', () => {
          testResult.className = 'test-result busy';
          testResult.style.display = 'block';
          testResult.textContent = 'Testing...';
          testBtn.disabled = true;
          vscode.postMessage({ type: 'test', values: collectValues() });
        });
      }
      window.addEventListener('message', (e) => {
        const m = e.data;
        if (m && m.type === 'browseResult') {
          const el = document.getElementById('f_' + m.key);
          if (el) el.value = m.path;
        } else if (m && m.type === 'testResult') {
          const level = m.level || (m.ok ? 'ok' : 'fail');
          testResult.className = 'test-result ' + level;
          testResult.style.display = 'block';
          const symbol = level === 'ok' ? '\u2713' : (level === 'warn' ? '\u26A0' : '\u2717');
          testResult.textContent = symbol + ' ' + m.message;
          if (testBtn) testBtn.disabled = false;
        } else if (m && m.type === 'submitCancelled') {
          if (submitBtn) submitBtn.disabled = false;
        } else if (m && m.type === 'fieldStatus') {
          const status = document.getElementById('f_' + m.key + '_status');
          const btn = document.querySelector('.btn-action[data-key="' + m.key + '"]');
          if (btn) btn.disabled = false;
          if (status) {
            status.className = 'field-status ' + m.level;
            status.style.display = 'block';
            const symbol = m.level === 'ok' ? '\u2713' : (m.level === 'warn' ? '\u26A0' : '\u2717');
            status.textContent = symbol + ' ' + m.message;
          }
        } else if (m && m.type === 'fieldUpdate') {
          const el = document.getElementById('f_' + m.key);
          if (el) {
            if (typeof m.value === 'string') el.value = m.value;
            if (m.readonly !== undefined) {
              if (m.readonly) el.setAttribute('readonly', 'readonly');
              else el.removeAttribute('readonly');
            }
          }
        }
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        // basic required check
        for (const k of keys) {
          const el = document.getElementById('f_' + k);
          if (el.required && !el.value.trim()) {
            err.textContent = 'Please fill all required fields.';
            el.focus();
            return;
          }
        }
        err.textContent = '';
        if (submitBtn) submitBtn.disabled = true;
        vscode.postMessage({ type: 'submit', values: collectValues() });
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
