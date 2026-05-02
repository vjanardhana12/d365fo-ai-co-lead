import * as vscode from 'vscode';
import { Connection, ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { ConnectionsTreeProvider, ConnectionItem } from '../views/connectionsTreeProvider';
import { testProject } from '../services/adoClient';
import { showForm } from '../views/formWebview';

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
      const ok = await vscode.window.showWarningMessage(
        `Delete connection '${item.connection.name}'?`, { modal: true }, 'Delete',
      );
      if (ok === 'Delete') {
        connections.delete(item.connection.id);
        tree.refresh();
        refreshStatus();
        vscode.commands.executeCommand('d365fo.dashboard.refresh');
      }
    }),
    vscode.commands.registerCommand('d365fo.connections.setActive', (item: ConnectionItem) => {
      connections.setActive(item.connection.id);
      tree.refresh();
      refreshStatus();
      vscode.commands.executeCommand('d365fo.dashboard.refresh');
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
        vscode.window.showInformationMessage(`Connection successful.`);
      } else {
        vscode.window.showErrorMessage(`Connection failed: HTTP ${result.status} ${result.reason}. Check Org URL, Project, and PAT scopes.`);
      }
    }),
  );

  async function editConnection(existing: Connection | undefined): Promise<void> {
    const isEdit = !!existing;
    if (identities.loadAll().length === 0) {
      const choice = await vscode.window.showWarningMessage(
        'You need to add an identity first.', { modal: true }, 'Add identity',
      );
      if (choice !== 'Add identity') return;
      await vscode.commands.executeCommand('d365fo.identities.add');
      if (identities.loadAll().length === 0) return;
    }

    const idOptions = identities.loadAll().map(i => ({
      value: i.id,
      label: i.displayName,
      description: i.email,
    }));
    idOptions.push({ value: '__NEW__', label: '+ Create new identity…', description: 'Opens the identity form first' });

    const result = await showForm(
      ctx,
      isEdit ? `Edit connection - ${existing!.name}` : 'New connection',
      [
        { key: 'name', label: 'Connection name', type: 'text', required: true,
          value: existing?.name, placeholder: 'e.g. Contoso ERP, Customer A HUB' },
        { key: 'adoOrgUrl', label: 'ADO Organization URL', type: 'text', required: true,
          value: existing?.adoOrgUrl ?? 'https://dev.azure.com/',
          placeholder: 'https://dev.azure.com/<org>',
          help: 'Just the org URL - no project segment.' },
        { key: 'adoProject', label: 'ADO Project', type: 'text', required: true,
          value: existing?.adoProject, placeholder: 'Project name' },
        { key: 'identityId', label: 'Identity', type: 'select', required: true,
          value: existing?.identityId ?? idOptions[0]?.value,
          options: idOptions,
          help: 'Identity used to authenticate (PAT is stored encrypted). Pick "+ Create new identity…" to add one inline.' },
        { key: 'sharepointSiteUrl', label: 'SharePoint site URL (optional)', type: 'text',
          value: existing?.sharepointSiteUrl,
          placeholder: 'https://contoso.sharepoint.com/sites/YourTeam',
          help: 'Optional. When set, the dashboard shows a Browse SharePoint tile. Auth uses your Microsoft account via VS Code — no password or PAT stored.' },
        { key: 'workingFolder', label: 'Working folder (optional)', type: 'folder',
          value: existing?.workingFolder, placeholder: 'e.g. D:\\Repos\\YourProject' },
        { key: 'notes', label: 'Notes (optional)', type: 'textarea',
          value: existing?.notes },
      ],
      isEdit ? 'Update' : 'Save connection',
    );
    if (!result) return;

    if (result.identityId === '__NEW__') {
      const before = identities.loadAll().map(i => i.id);
      await vscode.commands.executeCommand('d365fo.identities.add');
      const after = identities.loadAll();
      const newId = after.find(i => !before.includes(i.id));
      if (!newId) {
        vscode.window.showInformationMessage('Identity creation cancelled — connection not saved.');
        return;
      }
      // Re-open the connection form with the new identity preselected.
      const seed: Connection = {
        id: existing?.id ?? '',
        name: result.name.trim(),
        adoOrgUrl: result.adoOrgUrl.trim(),
        adoProject: result.adoProject.trim(),
        identityId: newId.id,
        sharepointSiteUrl: result.sharepointSiteUrl.trim() || undefined,
        workingFolder: result.workingFolder.trim() || undefined,
        notes: result.notes.trim() || undefined,
      };
      await editConnection(existing ? { ...existing, ...seed } : seed.id ? seed : { ...seed, id: '' } as Connection);
      return;
    }

    if (!/^https?:\/\/.+/.test(result.adoOrgUrl)) {
      vscode.window.showErrorMessage('ADO Org URL must start with https://');
      return;
    }

    const conn: Connection = {
      id: existing?.id ?? connections.newId(),
      name: result.name.trim(),
      adoOrgUrl: result.adoOrgUrl.trim().replace(/\/+$/, ''),
      adoProject: result.adoProject.trim().replace(/^\/+|\/+$/g, ''),
      identityId: result.identityId,
      sharepointSiteUrl: result.sharepointSiteUrl?.trim() || undefined,
      workingFolder: result.workingFolder.trim() || undefined,
      notes: result.notes.trim() || undefined,
      lastUsedUtc: new Date().toISOString(),
    };
    connections.upsert(conn);
    tree.refresh();
    refreshStatus();
    vscode.commands.executeCommand('d365fo.dashboard.refresh');
    vscode.window.showInformationMessage(`Saved connection '${conn.name}'.`);
  }
}