import * as vscode from 'vscode';
import { Connection, ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { ConnectionsTreeProvider, ConnectionItem } from '../views/connectionsTreeProvider';
import { testProject } from '../services/adoClient';

export function registerConnectionCommands(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
  tree: ConnectionsTreeProvider,
  refreshStatus: () => void,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.connections.add', () => editConnection(undefined)),
    vscode.commands.registerCommand('d365fo.connections.edit', (item: ConnectionItem) => editConnection(item.connection)),
    vscode.commands.registerCommand('d365fo.connections.delete', async (item: ConnectionItem) => {
      const ok = await vscode.window.showWarningMessage(`Delete connection '${item.connection.name}'?`, { modal: true }, 'Delete');
      if (ok === 'Delete') {
        connections.delete(item.connection.id);
        tree.refresh();
        refreshStatus();
      }
    }),
    vscode.commands.registerCommand('d365fo.connections.setActive', (item: ConnectionItem) => {
      connections.setActive(item.connection.id);
      tree.refresh();
      refreshStatus();
      vscode.window.setStatusBarMessage(`Active: ${item.connection.name}`, 3000);
    }),
    vscode.commands.registerCommand('d365fo.connections.test', async (item?: ConnectionItem) => {
      const conn = item?.connection ?? connections.getActive();
      if (!conn) { vscode.window.showWarningMessage('No connection selected.'); return; }
      const id = identities.get(conn.identityId);
      if (!id) { vscode.window.showWarningMessage('Connection has no identity assigned.'); return; }
      const pat = await identities.getSecret(id.id);
      if (!pat) { vscode.window.showWarningMessage('Identity has no stored PAT.'); return; }
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Testing ${conn.name}...` },
        () => testProject(conn.adoOrgUrl, conn.adoProject, id.email, pat),
      );
      if (result.ok) {
        vscode.window.showInformationMessage(`Connection successful - reached '${conn.adoProject}'.`);
      } else {
        vscode.window.showErrorMessage(`Connection failed: HTTP ${result.status} ${result.reason}. Check Org URL, Project, and PAT scopes.`);
      }
    }),
  );

  async function editConnection(existing: Connection | undefined): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: existing ? 'Edit connection - name' : 'New connection - name',
      prompt: "Friendly label (e.g. 'Carlsberg HUB')",
      value: existing?.name ?? '',
      ignoreFocusOut: true,
    });
    if (!name) return;
    const orgUrl = await vscode.window.showInputBox({
      title: 'ADO Org URL', prompt: 'e.g. https://dev.azure.com/contoso',
      value: existing?.adoOrgUrl ?? 'https://dev.azure.com/',
      ignoreFocusOut: true,
      validateInput: v => /^https?:\/\/.+/.test(v) ? null : 'Must be an https URL',
    });
    if (!orgUrl) return;
    const project = await vscode.window.showInputBox({
      title: 'ADO Project', prompt: 'Project name (no slashes)',
      value: existing?.adoProject ?? '',
      ignoreFocusOut: true,
      validateInput: v => v.trim().length > 0 ? null : 'Project is required',
    });
    if (!project) return;

    // Identity picker
    const ids = identities.loadAll();
    let identityId = existing?.identityId ?? '';
    const items: vscode.QuickPickItem[] = ids.map(i => ({ label: i.displayName, description: i.email, detail: i.id }));
    items.push({ label: '$(add) Create new identity...', description: '', detail: '__new__' });
    const pick = await vscode.window.showQuickPick(items, { title: 'Identity', placeHolder: 'Select identity to use' });
    if (!pick) return;
    if (pick.detail === '__new__') {
      await vscode.commands.executeCommand('d365fo.identities.add');
      const fresh = identities.loadAll();
      const newest = fresh[fresh.length - 1];
      if (!newest) { vscode.window.showWarningMessage('No identity created.'); return; }
      identityId = newest.id;
    } else {
      identityId = pick.detail!;
    }

    const conn: Connection = {
      id: existing?.id ?? connections.newId(),
      name: name.trim(),
      adoOrgUrl: orgUrl.trim().replace(/\/+$/, ''),
      adoProject: project.trim().replace(/^\/+|\/+$/g, ''),
      identityId,
      workingFolder: existing?.workingFolder,
      notes: existing?.notes,
      lastUsedUtc: new Date().toISOString(),
    };
    connections.upsert(conn);
    tree.refresh();
    refreshStatus();
    vscode.window.showInformationMessage(`Saved connection '${conn.name}'.`);
  }
}
