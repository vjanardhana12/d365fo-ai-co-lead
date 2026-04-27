import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { testProject } from '../services/adoClient';

interface LastNuGetResult { ok: boolean; pushed: number; skipped: number; failed: number; whenIso: string; durationSec: number; }
const LAST_NUGET_RESULT_KEY = 'd365fo.lastNuGetSyncResult';

let panel: vscode.WebviewPanel | undefined;
let renderFn: (() => void) | undefined;
let lastTestResult: { connectionId: string; ok: boolean; message: string; whenIso: string } | undefined;

export function openDashboard(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
): void {
  if (panel) { panel.reveal(); return; }

  panel = vscode.window.createWebviewPanel(
    'd365fo.dashboard',
    'D365 F&O Dashboard',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png');

  panel.onDidDispose(() => { panel = undefined; renderFn = undefined; });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!panel) return;
    switch (msg.type) {
      case 'cmd':
        await vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
        render();
        break;
      case 'cmdArgs':
        await vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
        render();
        break;
      case 'cmdWithItem':
        await vscode.commands.executeCommand(msg.command, { [msg.itemKey]: msg.payload });
        render();
        break;
      case 'setActive':
        connections.setActive(msg.id);
        lastTestResult = undefined; // stale once active changes
        render();
        break;
      case 'testActive':
        await runInlineTest(connections, identities);
        render();
        break;
      case 'refresh':
        render();
        break;
    }
  });

  function render(): void {
    if (!panel) return;
    panel.webview.html = renderHtml(ctx, connections, identities);
  }
  renderFn = render;

  render();
}

export function refreshDashboard(): void {
  if (renderFn) renderFn();
}

async function runInlineTest(connections: ConnectionStore, identities: IdentityStore): Promise<void> {
  const conn = connections.getActive();
  if (!conn) { lastTestResult = undefined; return; }
  const id = identities.get(conn.identityId);
  if (!id) {
    lastTestResult = { connectionId: conn.id, ok: false, message: 'Connection has no identity assigned.', whenIso: new Date().toISOString() };
    return;
  }
  const pat = await identities.getSecret(id.id);
  if (!pat) {
    lastTestResult = { connectionId: conn.id, ok: false, message: 'Identity has no stored PAT.', whenIso: new Date().toISOString() };
    return;
  }
  lastTestResult = { connectionId: conn.id, ok: false, message: 'Testing...', whenIso: new Date().toISOString() };
  const result = await testProject(conn.adoOrgUrl, conn.adoProject, id.email, pat);
  lastTestResult = result.ok
    ? { connectionId: conn.id, ok: true, message: `Connection successful.`, whenIso: new Date().toISOString() }
    : { connectionId: conn.id, ok: false, message: `Failed: HTTP ${result.status} ${result.reason}. Check Org URL, Project, and PAT scopes.`, whenIso: new Date().toISOString() };
}

function renderHtml(ctx: vscode.ExtensionContext, connections: ConnectionStore, identities: IdentityStore): string {
  const conns = connections.loadAll();
  const ids = identities.loadAll();
  const active = connections.getActive();
  const lastNuGet = ctx.globalState.get<LastNuGetResult>(LAST_NUGET_RESULT_KEY);

  // Top block: walk the user through setup in order (Identity -> Connection -> Active).
  let topBlock: string;
  if (ids.length === 0) {
    topBlock = `<div class="active none">
         <div>
           <div class="active-label">STEP 1 OF 2</div>
           <div style="margin-top:4px;">Add an identity (your ADO email + PAT) to get started.</div>
         </div>
         <button class="btn-primary" data-cmd="d365fo.identities.add">+ Add identity</button>
       </div>`;
  } else if (conns.length === 0) {
    topBlock = `<div class="active none">
         <div>
           <div class="active-label">STEP 2 OF 2</div>
           <div style="margin-top:4px;">Add a connection - one per ADO project you work on.</div>
         </div>
         <button class="btn-primary" data-cmd="d365fo.connections.add">+ Add connection</button>
       </div>`;
  } else if (!active) {
    topBlock = `<div class="active none">
         <div>No active connection. Pick one below by clicking <b>Set active</b>.</div>
       </div>`;
  } else {
    const showResult = lastTestResult && lastTestResult.connectionId === active.id;
    const resultBlock = showResult
      ? `<div class="test-result ${lastTestResult!.ok ? 'ok' : 'fail'}">
           <span class="dot"></span>${esc(lastTestResult!.message)}
           <span class="muted when">- ${esc(formatTime(lastTestResult!.whenIso))}</span>
         </div>`
      : '';
    topBlock = `<div class="active">
         <div class="active-row">
           <div>
             <div class="active-label">ACTIVE CONNECTION</div>
             <div class="active-name">${esc(active.name)}</div>
             <div class="active-meta">${esc(active.adoProject)} <span class="muted">- ${esc(active.adoOrgUrl)}</span></div>
           </div>
           <div class="active-actions">
             <button class="btn-primary" data-action="testActive">Test</button>
             <button class="btn-secondary" data-cmd-item="d365fo.connections.edit" data-item-key="connection" data-payload='${escAttr(JSON.stringify(active))}'>Edit</button>
           </div>
         </div>
         ${resultBlock}
       </div>`;
  }

  const connRows = conns.length === 0
    ? `<tr><td colspan="4" class="empty">No connections yet. <a data-cmd="d365fo.connections.add">+ Add one</a></td></tr>`
    : conns.map(c => {
        const isActive = c.id === active?.id;
        const star = isActive ? '<span class="star" title="Active">*</span>' : '';
        const setBtn = isActive ? '' : `<button class="btn-tiny" data-set-active="${esc(c.id)}">Set active</button>`;
        const payload = escAttr(JSON.stringify(c));
        return `<tr class="${isActive ? 'row-active' : ''}">
          <td>${star} <b>${esc(c.name)}</b></td>
          <td>${esc(c.adoProject)}</td>
          <td class="muted">${esc(c.adoOrgUrl)}</td>
          <td class="actions-cell">
            ${setBtn}
            <button class="btn-tiny" data-cmd-item="d365fo.connections.edit" data-item-key="connection" data-payload='${payload}'>Edit</button>
            <button class="btn-tiny btn-danger" data-cmd-item="d365fo.connections.delete" data-item-key="connection" data-payload='${payload}'>Delete</button>
          </td>
        </tr>`;
      }).join('\n');

  const identRows = ids.length === 0
    ? `<tr><td colspan="4" class="empty">No identities yet. <a data-cmd="d365fo.identities.add">+ Add one</a></td></tr>`
    : ids.map(i => {
        const payload = escAttr(JSON.stringify(i));
        return `<tr>
          <td><b>${esc(i.displayName)}</b></td>
          <td class="muted">${esc(i.email)}</td>
          <td>${esc(i.kind)}</td>
          <td class="actions-cell">
            <button class="btn-tiny" data-cmd-item="d365fo.identities.edit" data-item-key="identity" data-payload='${payload}'>Edit</button>
            <button class="btn-tiny btn-danger" data-cmd-item="d365fo.identities.delete" data-item-key="identity" data-payload='${payload}'>Delete</button>
          </td>
        </tr>`;
      }).join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px 32px; max-width: 1100px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 24px; font-size: 13px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--vscode-descriptionForeground); margin: 28px 0 10px; font-weight: 600; }
    .active { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); padding: 16px 20px; border-radius: 6px; margin-bottom: 8px; }
    .active.none { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--vscode-descriptionForeground); }
    .active-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    .active-label { font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); letter-spacing: 0.8px; }
    .active-name { font-size: 18px; font-weight: 600; margin-top: 2px; }
    .active-meta { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .active-actions { display: flex; gap: 6px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .star { color: var(--vscode-charts-yellow, #d4a017); font-weight: bold; }
    table { width: 100%; border-collapse: collapse; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 6px; overflow: hidden; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--vscode-descriptionForeground); padding: 10px 14px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-widget-border); font-weight: 600; }
    td { padding: 10px 14px; border-bottom: 1px solid var(--vscode-widget-border); font-size: 13px; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr.row-active { background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 25%, transparent); }
    .actions-cell { text-align: right; white-space: nowrap; }
    .empty { text-align: center; color: var(--vscode-descriptionForeground); padding: 20px; }
    .empty a { color: var(--vscode-textLink-foreground); cursor: pointer; }
    .table-header { display: flex; align-items: center; justify-content: space-between; margin: 28px 0 10px; }
    .table-header h2 { margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-bottom: 8px; }
    .tile { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); padding: 14px 16px; border-radius: 6px; cursor: pointer; transition: border-color 0.1s, transform 0.05s; }
    .tile:hover:not(.disabled) { border-color: var(--vscode-focusBorder); }
    .tile:active:not(.disabled) { transform: scale(0.99); }
    .tile h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
    .tile p { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .tile.disabled { opacity: 0.5; cursor: not-allowed; }
    button { font-family: var(--vscode-font-family); font-size: 12px; cursor: pointer; border-radius: 2px; border: none; padding: 5px 12px; }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-tiny { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border); padding: 3px 9px; font-size: 11px; margin-left: 4px; }
    .btn-tiny:hover { background: var(--vscode-toolbar-hoverBackground); border-color: var(--vscode-focusBorder); }
    .btn-danger:hover { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
    .add-btn { background: transparent; border: 1px solid var(--vscode-widget-border); padding: 4px 12px; font-size: 12px; }
    .add-btn:hover { border-color: var(--vscode-focusBorder); }
    .test-result { margin-top: 12px; padding: 8px 12px; border-radius: 4px; font-size: 12px; display: flex; align-items: center; gap: 8px; }
    .test-result.ok { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 15%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 50%, transparent); color: var(--vscode-testing-iconPassed, #4caf50); }
    .test-result.fail { background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 50%, transparent); color: var(--vscode-errorForeground); }
    .test-result .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
    .test-result .when { margin-left: auto; opacity: 0.7; }
    .badge { margin-top: 8px; padding: 4px 8px; border-radius: 3px; font-size: 11px; display: inline-flex; align-items: center; gap: 6px; }
    .badge.ok { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 12%, transparent); color: var(--vscode-testing-iconPassed, #4caf50); }
    .badge.fail { background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); color: var(--vscode-errorForeground); }
    .badge .bdot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .tile-snap { cursor: default; }
    .snap { margin-top: 10px; padding: 8px 10px; border-radius: 4px; font-size: 11px; border-left: 3px solid; }
    .snap.ok { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 8%, transparent); border-color: var(--vscode-testing-iconPassed, #4caf50); }
    .snap.fail { background: color-mix(in srgb, var(--vscode-errorForeground) 8%, transparent); border-color: var(--vscode-errorForeground); }
    .snap-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
    .snap-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--vscode-descriptionForeground); }
    .snap-when { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .snap-stats b { color: var(--vscode-foreground); }
    .tile-actions { margin-top: 10px; display: flex; gap: 6px; }
  </style></head><body>
    <h1>D365 F&amp;O Dev Lead</h1>
    <div class="sub">Dashboard - manage connections, identities, and run dev-lead tools without leaving VS Code.</div>

    ${topBlock}

    <h2>Quick actions</h2>
    <div class="grid">
      ${renderNuGetTile(lastNuGet)}
      <div class="tile" data-cmd="d365fo.nugetSync.showOutput">
        <h3>Show last sync output</h3>
        <p>Open the D365 F&amp;O NuGet Sync log channel</p>
      </div>
      <div class="tile disabled">
        <h3>Pull Requests</h3>
        <p>List open PRs - coming soon</p>
      </div>
      <div class="tile disabled">
        <h3>Pre-Checks</h3>
        <p>Branch / build validation - coming soon</p>
      </div>
      <div class="tile disabled">
        <h3>Releases</h3>
        <p>Pipeline release management - coming soon</p>
      </div>
      <div class="tile disabled">
        <h3>Estimate</h3>
        <p>AI-assisted work item estimation - coming soon</p>
      </div>
    </div>

    <div class="table-header">
      <h2>Identities (${ids.length})</h2>
      <button class="add-btn" data-cmd="d365fo.identities.add">+ New identity</button>
    </div>
    <table>
      <thead><tr><th>Display name</th><th>Email</th><th>Kind</th><th></th></tr></thead>
      <tbody>${identRows}</tbody>
    </table>

    <div class="table-header">
      <h2>Connections (${conns.length})</h2>
      <button class="add-btn" data-cmd="d365fo.connections.add">+ New connection</button>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Project</th><th>Org URL</th><th></th></tr></thead>
      <tbody>${connRows}</tbody>
    </table>

    <script>
      const vscode = acquireVsCodeApi();
      function attach() {
        document.querySelectorAll('[data-cmd]').forEach(el => {
          if (el.classList.contains('disabled')) return;
          el.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            vscode.postMessage({ type: 'cmd', command: el.dataset.cmd });
          });
        });
        document.querySelectorAll('[data-cmd-args]').forEach(el => {
          el.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const args = JSON.parse(el.dataset.args || '[]');
            vscode.postMessage({ type: 'cmdArgs', command: el.dataset.cmdArgs, args });
          });
        });
        document.querySelectorAll('[data-cmd-item]').forEach(el => {
          el.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const payload = JSON.parse(el.dataset.payload);
            vscode.postMessage({ type: 'cmdWithItem', command: el.dataset.cmdItem, itemKey: el.dataset.itemKey, payload });
          });
        });
        document.querySelectorAll('[data-set-active]').forEach(el => {
          el.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            vscode.postMessage({ type: 'setActive', id: el.dataset.setActive });
          });
        });
        document.querySelectorAll('[data-action]').forEach(el => {
          if (el.classList.contains('disabled')) return;
          el.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            vscode.postMessage({ type: el.dataset.action });
          });
        });
      }
      attach();
      window.addEventListener('message', (e) => { if (e.data.type === 'refresh') location.reload(); });
    </script>
  </body></html>`;
}

function esc(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}
function escAttr(s: string): string {
  return s.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
function formatTime(iso: string): string {
  const d = new Date(iso);
  // e.g. "Apr 27, 8:51 PM"
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}
function renderNuGetTile(r: LastNuGetResult | undefined): string {
  // No previous run yet -> simple click-to-run tile
  if (!r) {
    return `<div class="tile" data-cmd="d365fo.nugetSync.run">
      <h3>D365 F&amp;O NuGet Sync</h3>
      <p>Push D365 F&amp;O packages to ADO Artifacts</p>
    </div>`;
  }

  // Snapshot of last run + Run sync button (re-uses last form values)
  const cls = r.ok ? 'snap ok' : 'snap fail';
  const stamp = `${formatTime(r.whenIso)} - ${relTime(r.whenIso)}`;
  const stats = r.ok
    ? `<b>${r.pushed}</b> pushed${r.skipped ? `, <b>${r.skipped}</b> skipped` : ''}${r.failed ? `, <b>${r.failed}</b> failed` : ''}`
    : `<b>${r.failed}</b> failed${r.pushed ? `, <b>${r.pushed}</b> pushed` : ''}${r.skipped ? `, <b>${r.skipped}</b> skipped` : ''}`;
  const dur = `${Math.floor(r.durationSec / 60)}m ${r.durationSec % 60}s`;
  return `<div class="tile tile-snap">
    <h3>D365 F&amp;O NuGet Sync</h3>
    <p>Push D365 F&amp;O packages to ADO Artifacts</p>
    <div class="${cls}">
      <div class="snap-row"><span class="snap-label">Last run</span><span class="snap-when">${esc(stamp)}</span></div>
      <div class="snap-stats">${stats} <span class="muted">- ${dur}</span></div>
    </div>
    <div class="tile-actions">
      <button class="btn-primary" data-cmd-args="d365fo.nugetSync.run" data-args='${escAttr(JSON.stringify([{ useLast: true }]))}'>Run sync</button>
      <button class="btn-tiny" data-cmd="d365fo.nugetSync.run">Edit + run...</button>
    </div>
  </div>`;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
