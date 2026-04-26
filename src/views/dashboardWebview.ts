import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';

let panel: vscode.WebviewPanel | undefined;

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

  panel.onDidDispose(() => { panel = undefined; });

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case 'cmd':
        await vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
        render();
        break;
      case 'refresh':
        render();
        break;
    }
  });

  function render(): void {
    if (!panel) return;
    const conns = connections.loadAll();
    const active = connections.getActive();
    const ids = identities.loadAll();
    panel.webview.html = html(conns.length, ids.length, active?.name, active?.adoProject, active?.adoOrgUrl);
  }

  render();
}

function html(connCount: number, identCount: number, activeName?: string, activeProject?: string, activeOrg?: string): string {
  const activeBlock = activeName
    ? `<div class="active">
         <div class="active-label">Active connection</div>
         <div class="active-name">${escape(activeName)}</div>
         <div class="active-meta">${escape(activeProject ?? '')} - <span class="muted">${escape(activeOrg ?? '')}</span></div>
       </div>`
    : `<div class="active none">No active connection. <a href="#" data-cmd="d365fo.connections.add">Add one</a> to get started.</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }
    .active { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); padding: 14px 18px; border-radius: 6px; margin-bottom: 24px; }
    .active.none { color: var(--vscode-descriptionForeground); }
    .active-label { font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); letter-spacing: 0.5px; }
    .active-name { font-size: 16px; font-weight: 600; margin-top: 4px; }
    .active-meta { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .muted { opacity: 0.7; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .tile { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); padding: 14px 16px; border-radius: 6px; cursor: pointer; transition: border-color 0.1s; }
    .tile:hover { border-color: var(--vscode-focusBorder); }
    .tile h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
    .tile p { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .tile.disabled { opacity: 0.5; cursor: not-allowed; }
    .stats { display: flex; gap: 24px; margin-bottom: 24px; }
    .stat { font-size: 12px; color: var(--vscode-descriptionForeground); }
    .stat b { font-size: 18px; color: var(--vscode-foreground); display: block; }
    a { color: var(--vscode-textLink-foreground); cursor: pointer; }
  </style></head><body>
    <h1>D365 F&amp;O Dev Lead</h1>
    <div class="sub">Tools for D365 F&amp;O dev leads - reviews, syncs, releases, all in one place.</div>

    ${activeBlock}

    <div class="stats">
      <div class="stat"><b>${connCount}</b>Connections</div>
      <div class="stat"><b>${identCount}</b>Identities</div>
    </div>

    <div class="grid">
      <div class="tile" data-cmd="d365fo.nugetSync.run"><h3>NuGet Sync</h3><p>Push D365 F&amp;O packages to ADO Artifacts</p></div>
      <div class="tile" data-cmd="d365fo.connections.add"><h3>+ New Connection</h3><p>Add an ADO project + identity</p></div>
      <div class="tile" data-cmd="d365fo.identities.add"><h3>+ New Identity</h3><p>Store an ADO PAT (encrypted)</p></div>
      <div class="tile disabled"><h3>Pull Requests</h3><p>Coming soon</p></div>
      <div class="tile disabled"><h3>Pre-Checks</h3><p>Coming soon</p></div>
      <div class="tile disabled"><h3>Releases</h3><p>Coming soon</p></div>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('[data-cmd]').forEach(el => {
        if (el.classList.contains('disabled')) return;
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({ type: 'cmd', command: el.dataset.cmd });
        });
      });
    </script>
  </body></html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}
