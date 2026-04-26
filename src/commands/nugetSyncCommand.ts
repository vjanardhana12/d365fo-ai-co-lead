import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { runNuGetSync } from '../services/nugetSyncRunner';

let channel: vscode.OutputChannel | undefined;

export function registerNuGetSyncCommand(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.nugetSync.run', async () => {
      const conn = connections.getActive();
      if (!conn) { vscode.window.showWarningMessage('No active connection. Add one first.'); return; }
      const identity = identities.get(conn.identityId);
      if (!identity) { vscode.window.showWarningMessage('Active connection has no identity.'); return; }
      const pat = await identities.getSecret(identity.id);
      if (!pat) { vscode.window.showWarningMessage('Identity has no stored PAT.'); return; }

      const feedUrl = await vscode.window.showInputBox({
        title: 'NuGet Sync - Feed URL',
        prompt: 'e.g. https://pkgs.dev.azure.com/<org>/_packaging/<feed>/nuget/v3/index.json',
        ignoreFocusOut: true,
        validateInput: v => /^https:\/\/pkgs\.dev\.azure\.com\/.+\/index\.json$/.test(v) ? null : 'Must be an ADO Artifacts v3 index URL',
      });
      if (!feedUrl) return;

      const feedNameDefault = (feedUrl.match(/_packaging\/([^/]+)\/nuget/) ?? [])[1] ?? '';
      const feedName = await vscode.window.showInputBox({
        title: 'NuGet Sync - Feed Name',
        prompt: 'ADO feed name (used for nuget.config source name)',
        value: feedNameDefault,
        ignoreFocusOut: true,
        validateInput: v => v.trim().length > 0 ? null : 'Required',
      });
      if (!feedName) return;

      const folderPick = await vscode.window.showOpenDialog({
        title: 'NuGet Sync - Package folder',
        openLabel: 'Use this folder',
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      });
      if (!folderPick || folderPick.length === 0) return;

      const force = await vscode.window.showQuickPick(['No', 'Yes'], {
        title: 'Force re-push if version exists?', placeHolder: 'Default: No',
      });
      if (force === undefined) return;

      if (!channel) channel = vscode.window.createOutputChannel('D365FO NuGet Sync');
      const exit = await runNuGetSync({
        feedUrl, feedName, email: identity.email, pat,
        packageFolder: folderPick[0].fsPath, force: force === 'Yes',
      }, channel);

      if (exit === 0) vscode.window.showInformationMessage('NuGet sync completed.');
      else vscode.window.showErrorMessage(`NuGet sync exited with code ${exit}. See output channel.`);
    }),
  );
}
