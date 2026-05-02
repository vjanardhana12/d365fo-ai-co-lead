import * as vscode from 'vscode';
import { Connection, ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { testProject } from '../services/adoClient';
import { refreshKitAccessForActive, isKitGranted } from '../services/kitAccessProbe';
import { LastDevTaskResult } from '../commands/devTasksCommand';

interface LastNuGetResult { ok: boolean; pushed: number; skipped: number; failed: number; whenIso: string; durationSec: number; }
const LAST_NUGET_RESULT_KEY = 'd365fo.lastNuGetSyncResult';
const LAST_DEVTASKS_RESULT_KEY = 'd365fo.devTasks.lastResult';

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
    'D365 F&O AI Co-Lead',
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
        // Re-probe kit access for the newly active connection in the background.
        void refreshKitAccessForActive(connections, identities, { force: true }).then(changed => { if (changed) render(); });
        break;
      case 'testActive':
        await runInlineTest(connections, identities);
        render();
        break;
      case 'recheckKits': {
        const changed = await refreshKitAccessForActive(connections, identities, { force: true });
        const conn = connections.getActive();
        const granted = conn ? Object.entries(conn.kitAccess ?? {}).filter(([, v]) => v.granted).map(([k]) => k) : [];
        const denied  = conn ? Object.entries(conn.kitAccess ?? {}).filter(([, v]) => !v.granted).map(([k]) => k) : [];
        const parts = [];
        if (granted.length) parts.push(`granted: ${granted.join(', ')}`);
        if (denied.length)  parts.push(`denied: ${denied.join(', ')}`);
        vscode.window.showInformationMessage(`Kit access re-checked. ${parts.join(' | ') || 'no kits configured.'}`);
        if (changed) render();
        break;
      }
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
  // Trigger live kit-access probe in background; re-render when results change.
  void refreshKitAccessForActive(connections, identities).then(changed => { if (changed) render(); });
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
  const lastDevTasks = ctx.globalState.get<LastDevTaskResult>(LAST_DEVTASKS_RESULT_KEY);
  const roles = vscode.workspace.getConfiguration('d365fo').get<string[]>('myRoles', ['dev-lead']);
  const agentCount = ctx.globalState.get<{ id: string }[]>('d365fo.agents.global', []).length;

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
             <button class="btn-secondary" data-action="recheckKits" title="Re-check whether your identity has access to any customer kits (e.g. CB Spec Kit)">Re-check kits</button>
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
    ? `<tr><td colspan="3" class="empty">No identities yet. <a data-cmd="d365fo.identities.add">+ Add one</a></td></tr>`
    : ids.map(i => {
        const payload = escAttr(JSON.stringify(i));
        return `<tr>
          <td><b>${esc(i.displayName)}</b></td>
          <td class="muted">${esc(i.email)}</td>
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
    .tile-actions { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
    .role-badge { display: inline-block; padding: 2px 8px; margin: 0 2px; font-size: 11px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .role-tag { display: inline-block; padding: 1px 6px; margin: 4px 4px 0 0; font-size: 10px; border-radius: 3px; background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent); color: var(--vscode-descriptionForeground); }
    .role-tags { margin-top: 8px; }
    .ver-badge { display: inline-block; padding: 1px 6px; font-size: 10px; border-radius: 3px; margin-left: 6px; vertical-align: middle; font-weight: 600; }
    .ver-v1\.1 { background: color-mix(in srgb, #22d3ee 25%, transparent); color: #22d3ee; }
    .ver-v1\.2 { background: color-mix(in srgb, #a78bfa 25%, transparent); color: #a78bfa; }
    .ver-v2   { background: color-mix(in srgb, #f59e0b 25%, transparent); color: #f59e0b; }
  </style></head><body>
    <h1>D365 F&amp;O AI Co-Lead</h1>
    <div class="sub">Your AI partner across the F&amp;O delivery lifecycle &mdash; Architect, FC, Dev Lead, Developer, Tester, PM. <a data-cmd="d365fo.setRoles" title="Click to change role(s)">${renderRoleBadges(roles)}</a></div>

    ${topBlock}

    <h2>Tools <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400;">- generic, work with any project</span></h2>
    <div class="grid">
      ${renderNuGetTile(lastNuGet)}
      <div class="tile" data-cmd="d365fo.projectKit.init">
        <h3>Project Initiation Kit</h3>
        <p>Create a new project connection (import from folder or start blank)</p>
      </div>
      ${renderManageAgentsTile(agentCount)}
    </div>

    <h2>${active ? `Project: ${esc(active.name)}` : 'Project'} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400;">${active ? renderProjectMeta(active) : '- pick or add a project to enable'}</span></h2>
    <div class="grid">
      ${active ? renderDevTasksTile(lastDevTasks) : `<div class="tile disabled"><h3>Create Dev Tasks</h3><p>Generate task hierarchy under a parent work item</p></div>`}
      ${active ? renderSharePointTile(active) : ''}
      ${active && isKitGranted(active, 'carlsberg') ? renderCbSpecKitTile(active) : ''}
    </div>

    <h2>Coming soon <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400;">- roadmap by role &amp; version</span></h2>
    <div class="grid">
      ${renderComingSoon(roles)}
    </div>

    <div class="table-header">
      <h2>Identities (${ids.length})</h2>
      <button class="add-btn" data-cmd="d365fo.identities.add">+ New identity</button>
    </div>
    <table>
      <thead><tr><th>Display name</th><th>Email</th><th></th></tr></thead>
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
      <h3>NuGet Sync</h3>
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
    <h3>NuGet Sync</h3>
    <p>Push D365 F&amp;O packages to ADO Artifacts</p>
    <div class="${cls}">
      <div class="snap-row"><span class="snap-label">Last run</span><span class="snap-when">${esc(stamp)}</span></div>
      <div class="snap-stats">${stats} <span class="muted">- ${dur}</span></div>
    </div>
    <div class="tile-actions">
      <button class="btn-primary" data-cmd-args="d365fo.nugetSync.run" data-args='${escAttr(JSON.stringify([{ useLast: true }]))}'>Run sync</button>
      <button class="btn-tiny" data-cmd="d365fo.nugetSync.run">Edit + run...</button>
      <button class="btn-tiny" data-cmd="d365fo.nugetSync.showOutput">Output</button>
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

function renderProjectMeta(c: Connection): string {
  const parts: string[] = [];
  if (c.projectSpec?.kit) parts.push(`kit: <b>${esc(c.projectSpec.kit)}</b>`);
  if (c.projectSpec?.prefix) parts.push(`prefix: <b>${esc(c.projectSpec.prefix)}</b>`);
  if (c.projectSpec?.defaultModel) parts.push(`model: <b>${esc(c.projectSpec.defaultModel)}</b>`);
  return parts.length ? `- ${parts.join(' | ')}` : '- bound to active connection';
}

function renderCbSpecKitTile(c: Connection): string {
  const kd = (c.projectSpec?.kitData?.carlsberg ?? {}) as { ceCustomFields?: Record<string,string>; taskCustomFields?: Record<string,string>; stakeholders?: { name: string; guid: string }[] };
  const ceCount = kd.ceCustomFields ? Object.keys(kd.ceCustomFields).length : 0;
  const tkCount = kd.taskCustomFields ? Object.keys(kd.taskCustomFields).length : 0;
  const shCount = kd.stakeholders?.length ?? 0;
  const configured = ceCount + tkCount + shCount > 0;
  return `<div class="tile tile-snap">
    <h3>CB Spec Kit</h3>
    <p>Carlsberg overlay: custom fields, stakeholder mentions, reviewer defaults</p>
    ${configured ? `<div class="snap ok">
      <div class="snap-row"><span class="snap-label">Configured</span><span class="snap-when">overlay active</span></div>
      <div class="snap-stats"><b>${ceCount}</b> CE fields, <b>${tkCount}</b> task fields, <b>${shCount}</b> stakeholders</div>
    </div>` : `<div class="snap fail">
      <div class="snap-row"><span class="snap-label">Not configured</span><span class="snap-when">defaults will apply</span></div>
    </div>`}
    <div class="tile-actions">
      <button class="btn-primary" data-cmd="d365fo.cbSpecKit.edit">${configured ? 'Edit' : 'Configure'}</button>
    </div>
  </div>`;
}

function renderDevTasksTile(r: LastDevTaskResult | undefined): string {
  if (!r) {
    return `<div class="tile">
      <h3>Create Dev Tasks</h3>
      <p>Generate task hierarchy under a parent work item in ADO</p>
      <div class="tile-actions">
        <button class="btn-primary" data-cmd="d365fo.devTasks.create">Plan + create</button>
        <button class="btn-tiny" data-cmd="d365fo.devTasks.askAi" title="Ask the @d365fo-dev-lead AI partner to plan tasks">$(sparkle) Ask AI</button>
      </div>
    </div>`;
  }
  const cls = r.ok ? 'snap ok' : 'snap fail';
  const stamp = `${formatTime(r.whenIso)} - ${relTime(r.whenIso)}`;
  const stats = r.ok
    ? `<b>${r.created}</b> created${r.skipped ? `, <b>${r.skipped}</b> skipped` : ''}${r.failed ? `, <b>${r.failed}</b> failed` : ''}`
    : `<b>${r.failed}</b> failed${r.created ? `, <b>${r.created}</b> created` : ''}`;
  const dur = `${Math.floor(r.durationSec / 60)}m ${r.durationSec % 60}s`;
  const presetBadge = r.preset ? `<span class="muted">[${esc(r.preset)}]</span> ` : '';
  return `<div class="tile tile-snap">
    <h3>Create Dev Tasks</h3>
    <p>Generate task hierarchy under a parent work item in ADO</p>
    <div class="${cls}">
      <div class="snap-row"><span class="snap-label">Last run</span><span class="snap-when">${esc(stamp)}</span></div>
      <div class="snap-stats">${presetBadge}Parent <b>#${esc(r.parentId)}</b> - ${stats} <span class="muted">- ${dur}</span></div>
    </div>
    <div class="tile-actions">
      <button class="btn-primary" data-cmd-args="d365fo.devTasks.create" data-args='${escAttr(JSON.stringify([{ useLast: true }]))}'>Run again</button>
      <button class="btn-tiny" data-cmd="d365fo.devTasks.create">Edit + create...</button>
      <button class="btn-tiny" data-cmd="d365fo.devTasks.askAi" title="Ask the @d365fo-dev-lead AI partner to plan tasks">$(sparkle) Ask AI</button>
      <button class="btn-tiny" data-cmd="d365fo.devTasks.showOutput">Output</button>
    </div>
  </div>`;
}


// --- Role-aware rendering helpers (v1.0) ----------------------------------

const ROLE_LABEL: Record<string, string> = {
  'architect': 'Architect',
  'fc': 'FC',
  'dev-lead': 'Dev Lead',
  'developer': 'Developer',
  'tester': 'Tester',
  'pm': 'PM',
};

function renderRoleBadges(roles: string[]): string {
  if (!roles || roles.length === 0) return 'set your role(s)';
  const badges = roles.map(r => `<span class="role-badge">${esc(ROLE_LABEL[r] ?? r)}</span>`).join(' ');
  return `Viewing as: ${badges}`;
}

function renderSharePointTile(conn: import('../services/connectionStore').Connection): string {
  if (!conn.sharepointSiteUrl) {
    return `<div class="tile">
      <h3>SharePoint <span class="muted" style="font-weight:400;font-size:11px;">(not configured)</span></h3>
      <p>Browse files from your project's SharePoint site. Sign-in uses your Microsoft account &mdash; no password stored.</p>
      <div class="tile-actions">
        <button class="btn-tiny" data-cmd-item="d365fo.connections.edit" data-item-key="connection" data-payload='${escAttr(JSON.stringify(conn))}'>Add SharePoint URL</button>
      </div>
    </div>`;
  }
  const host = (() => { try { return new URL(conn.sharepointSiteUrl).host; } catch { return conn.sharepointSiteUrl; } })();
  return `<div class="tile">
    <h3>SharePoint</h3>
    <p>Browse <span class="muted">${esc(host)}</span></p>
    <div class="tile-actions">
      <button class="btn-primary" data-cmd="d365fo.sharepoint.browse">Browse files</button>
      <button class="btn-tiny" data-cmd-args="vscode.open" data-args='${escAttr(JSON.stringify([conn.sharepointSiteUrl]))}'>Open site</button>
    </div>
  </div>`;
}

function renderManageAgentsTile(count: number): string {
  return `<div class="tile">
    <h3>Manage Agents <span class="muted" style="font-weight:400;font-size:11px;">(${count})</span></h3>
    <p>Create role-aware AI agents � each with its own system prompt + MCP servers</p>
    <div class="tile-actions">
      <button class="btn-primary" data-cmd="d365fo.agents.manage">Open</button>
      <button class="btn-tiny" data-cmd="d365fo.agents.invoke">Ask an agent</button>
    </div>
  </div>`;
}

interface ComingSoonTile {
  title: string;
  desc: string;
  roles: string[];
  version: 'v1.1' | 'v1.2' | 'v2';
}

const COMING_SOON: ComingSoonTile[] = [
  // -- v1.1 (next) -----------------------------------------
  { title: 'FDD Authoring',          desc: 'AI-drafted FDDs from a requirement description, fit/gap matrix.', roles: ['fc','architect'], version: 'v1.1' },
  { title: 'Solution Design (HLD)',  desc: 'Architecture + integration design, ARB checklist.',                roles: ['architect'],       version: 'v1.1' },
  { title: 'TDD from FDD',           desc: 'Generate technical design referencing AOT objects via D365FODevMCP.', roles: ['developer','dev-lead'], version: 'v1.1' },
  { title: 'Implement from TDD',     desc: 'Build tables/classes/forms via D365FODevMCP, fix BP errors.',      roles: ['developer'],       version: 'v1.1' },
  { title: 'Test Cases from FDD',    desc: 'Generate functional test cases + RSAT/ATC scaffolds.',             roles: ['tester'],          version: 'v1.1' },
  { title: 'PR Triage',              desc: 'List + review open PRs, suggest reviewers, summarise diffs.',      roles: ['dev-lead','developer'], version: 'v1.1' },
  { title: 'Defect Triage',          desc: 'Aggregate test failures, suggest root cause + assign back.',       roles: ['tester','dev-lead'], version: 'v1.1' },
  { title: 'Project Spec ? Repo',    desc: 'Commit projectSpec to <repo>/.d365fo-co-lead/project.json � team sync.', roles: ['architect','fc','dev-lead'], version: 'v1.1' },
  { title: 'Per-Agent Evals',        desc: 'Run agent against project eval dataset; pass-rate trend.',         roles: ['architect','dev-lead'], version: 'v1.1' },
  { title: 'Telemetry (opt-in)',     desc: 'Anonymised tile usage to Application Insights for adoption metrics.', roles: ['dev-lead','pm'], version: 'v1.1' },

  // -- v1.2 ------------------------------------------------
  { title: 'Status & Burndown',      desc: 'Sprint rollup, burndown, blockers � for PMs and leads.',           roles: ['pm','dev-lead','architect'], version: 'v1.2' },
  { title: 'Risk Register',          desc: 'Tracked risks, owners, mitigation status.',                        roles: ['pm','architect'],   version: 'v1.2' },
  { title: 'Release Notes',          desc: 'Auto-draft release notes from merged PRs / closed work items.',    roles: ['dev-lead','pm'],    version: 'v1.2' },
  { title: 'UAT Script Pack',        desc: 'Bundle test cases + screenshots into UAT-ready document.',         roles: ['fc','tester'],      version: 'v1.2' },
  { title: 'Code Review Coach',      desc: 'AI checklist run on PR diff aligned with project conventions.',    roles: ['developer','dev-lead'], version: 'v1.2' },

  // -- v2 --------------------------------------------------
  { title: 'Multi-Agent Orchestration', desc: 'Master Co-Lead routes complex requests across multiple role agents.', roles: ['architect','dev-lead'], version: 'v2' },
  { title: 'Patent / IP Pack',          desc: 'Auto-generate disclosure docs from delivery artefacts.',           roles: ['architect','pm'],          version: 'v2' },
  { title: 'Customer Portal Export',    desc: 'Publish project status + design pack to a customer portal.',       roles: ['pm'],                       version: 'v2' },
];

function renderComingSoon(myRoles: string[]): string {
  // Filter by role overlap (any match), but always show "all" tagged tiles too.
  const filtered = COMING_SOON.filter(t => t.roles.some(r => myRoles.includes(r)));
  const list = filtered.length > 0 ? filtered : COMING_SOON; // if no role match, show everything
  return list.map(t => `<div class="tile disabled" title="${esc(t.title)} � ${esc(t.version)}">
    <h3>${esc(t.title)} <span class="ver-badge ver-${t.version}">${t.version}</span></h3>
    <p>${esc(t.desc)}</p>
    <div class="role-tags">${t.roles.map(r => `<span class="role-tag">${esc(ROLE_LABEL[r] ?? r)}</span>`).join('')}</div>
  </div>`).join('\n');
}