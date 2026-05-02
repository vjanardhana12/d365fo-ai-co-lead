import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { listSharePointChildren } from '../services/sharepointClient';

export function registerSharePointCommands(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.sharepoint.browse', async () => {
      const conn = connections.getActive();
      if (!conn) { vscode.window.showWarningMessage('No active connection.'); return; }
      if (!conn.sharepointSiteUrl) {
        const choice = await vscode.window.showWarningMessage(
          `Connection '${conn.name}' has no SharePoint site URL configured.`,
          'Edit connection',
        );
        if (choice === 'Edit connection') {
          await vscode.commands.executeCommand('d365fo.connections.edit', { connection: conn });
        }
        return;
      }

      const stack: { id?: string; label: string }[] = [{ label: 'Root' }];
      while (true) {
        const top = stack[stack.length - 1];
        let items;
        try {
          items = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Loading ${top.label}\u2026` },
            () => listSharePointChildren(conn.sharepointSiteUrl!, top.id),
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`SharePoint browse failed: ${msg}`);
          return;
        }

        const picks: (vscode.QuickPickItem & { _id?: string; _isFolder: boolean; _webUrl: string; _action?: 'up' })[] = [];
        if (stack.length > 1) {
          picks.push({ label: '$(arrow-up) ..', description: 'Up one level', _isFolder: true, _webUrl: '', _action: 'up' });
        }
        for (const it of items) {
          const isFolder = !!it.folder;
          picks.push({
            label: `${isFolder ? '$(folder)' : '$(file)'} ${it.name}`,
            description: isFolder ? 'Folder' : (it.size ? `${Math.round(it.size / 1024)} KB` : ''),
            detail: it.lastModifiedDateTime ? `Modified ${new Date(it.lastModifiedDateTime).toLocaleString()}` : undefined,
            _id: it.id,
            _isFolder: isFolder,
            _webUrl: it.webUrl,
          });
        }
        if (picks.filter(p => !p._action).length === 0) {
          picks.push({ label: '(empty)', _isFolder: false, _webUrl: '' });
        }

        const pick = await vscode.window.showQuickPick(picks, {
          title: `SharePoint \u2014 ${conn.name} \u2014 ${stack.map(s => s.label).join(' / ')}`,
          placeHolder: 'Select a folder to drill in, or a file to open in browser',
        });
        if (!pick) return;
        if (pick._action === 'up') { stack.pop(); continue; }
        if (pick._isFolder && pick._id) { stack.push({ id: pick._id, label: pick.label.replace(/^\$\([^)]+\)\s*/, '') }); continue; }
        if (pick._webUrl) { vscode.env.openExternal(vscode.Uri.parse(pick._webUrl)); }
        return;
      }
    }),
  );
}
