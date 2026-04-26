import * as vscode from 'vscode';
import { ConnectionStore } from './services/connectionStore';
import { IdentityStore } from './services/identityStore';
import { ConnectionsTreeProvider } from './views/connectionsTreeProvider';
import { IdentitiesTreeProvider } from './views/identitiesTreeProvider';
import { openDashboard } from './views/dashboardWebview';
import { registerConnectionCommands } from './commands/connectionCommands';
import { registerIdentityCommands } from './commands/identityCommands';
import { registerNuGetSyncCommand } from './commands/nugetSyncCommand';
import { registerChatParticipant } from './chat/d365foParticipant';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  const connectionStore = new ConnectionStore(context);
  const identityStore = new IdentityStore(context);

  // Tree views
  const connectionsTree = new ConnectionsTreeProvider(connectionStore);
  const identitiesTree = new IdentitiesTreeProvider(identityStore);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('d365fo.connections', connectionsTree),
    vscode.window.registerTreeDataProvider('d365fo.identities', identitiesTree),
  );

  // Commands
  registerConnectionCommands(context, connectionStore, identityStore, connectionsTree, () => updateStatusBar(connectionStore));
  registerIdentityCommands(context, identityStore, identitiesTree);
  registerNuGetSyncCommand(context, connectionStore, identityStore);

  context.subscriptions.push(
    vscode.commands.registerCommand('d365fo.openDashboard', () =>
      openDashboard(context, connectionStore, identityStore)),
    vscode.commands.registerCommand('d365fo.refresh', () => {
      connectionsTree.refresh();
      identitiesTree.refresh();
      updateStatusBar(connectionStore);
    }),
  );

  // Chat participant
  registerChatParticipant(context, connectionStore, identityStore);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'd365fo.openDashboard';
  context.subscriptions.push(statusBarItem);
  updateStatusBar(connectionStore);
  statusBarItem.show();
}

function updateStatusBar(store: ConnectionStore): void {
  const active = store.getActive();
  if (active) {
    statusBarItem.text = `$(plug) D365FO: ${active.name}`;
    statusBarItem.tooltip = `Active connection: ${active.name}\nProject: ${active.adoProject}\nClick to open dashboard`;
  } else {
    statusBarItem.text = `$(plug) D365FO: no connection`;
    statusBarItem.tooltip = 'Click to open dashboard and add a connection';
  }
}

export function deactivate(): void { /* nothing to clean up */ }
