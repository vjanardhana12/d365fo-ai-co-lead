import * as vscode from 'vscode';
import { ConnectionStore } from './services/connectionStore';
import { IdentityStore } from './services/identityStore';
import { AgentRegistry } from './services/agentRegistry';
import { ConnectionsTreeProvider } from './views/connectionsTreeProvider';
import { IdentitiesTreeProvider } from './views/identitiesTreeProvider';
import { openDashboard, refreshDashboard } from './views/dashboardWebview';
import { registerConnectionCommands } from './commands/connectionCommands';
import { registerIdentityCommands } from './commands/identityCommands';
import { registerNuGetSyncCommand } from './commands/nugetSyncCommand';
import { registerDevTasksCommand } from './commands/devTasksCommand';
import { registerProjectKitCommand } from './commands/projectKitCommand';
import { registerCbSpecKitCommand } from './commands/cbSpecKitCommand';
import { registerManageAgentsCommand } from './commands/manageAgentsCommand';
import { registerAiModeCommands } from './commands/aiModeCommands';
import { registerSharePointCommands } from './commands/sharepointCommands';
import { registerChatParticipants } from './chat/d365foParticipant';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  const connectionStore = new ConnectionStore(context);
  const identityStore = new IdentityStore(context);
  const agentRegistry = new AgentRegistry(context);
  agentRegistry.seedDefaults();

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
  registerDevTasksCommand(context, connectionStore, identityStore);
  registerProjectKitCommand(context, connectionStore, identityStore);
  registerCbSpecKitCommand(context, connectionStore, identityStore);
  registerManageAgentsCommand(context, agentRegistry, connectionStore);
  registerAiModeCommands(context, connectionStore);
  registerSharePointCommands(context, connectionStore);

  context.subscriptions.push(
    vscode.commands.registerCommand('d365fo.openDashboard', () =>
      openDashboard(context, connectionStore, identityStore)),
    vscode.commands.registerCommand('d365fo.dashboard.refresh', () => refreshDashboard()),
    vscode.commands.registerCommand('d365fo.refresh', () => {
      connectionsTree.refresh();
      identitiesTree.refresh();
      updateStatusBar(connectionStore);
      refreshDashboard();
    }),
    vscode.commands.registerCommand('d365fo.setRoles', async () => {
      const cfg = vscode.workspace.getConfiguration('d365fo');
      const current = cfg.get<string[]>('myRoles', ['dev-lead']);
      const items: (vscode.QuickPickItem & { value: string })[] = [
        { label: 'Architect', value: 'architect', description: 'Solution / delivery architect' },
        { label: 'FC',        value: 'fc',        description: 'Functional consultant' },
        { label: 'Dev Lead',  value: 'dev-lead',  description: 'Dev lead / tech lead' },
        { label: 'Developer', value: 'developer', description: 'X++ / extensions developer' },
        { label: 'Tester',    value: 'tester',    description: 'QA / test engineer' },
        { label: 'PM',        value: 'pm',        description: 'Project manager' },
      ];
      items.forEach(i => { i.picked = current.includes(i.value); });
      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: 'Viewing as \u2014 select your role(s)',
        placeHolder: 'Multi-select for techno-functional or hybrid roles',
      });
      if (!picked) return;
      const values = picked.map(p => p.value);
      await cfg.update('myRoles', values.length > 0 ? values : undefined, vscode.ConfigurationTarget.Global);
      refreshDashboard();
    }),
  );

  // Chat participants (master + 6 role-specific)
  registerChatParticipants(context, connectionStore, identityStore, agentRegistry);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'd365fo.openDashboard';
  context.subscriptions.push(statusBarItem);
  updateStatusBar(connectionStore);
  statusBarItem.show();

  // Auto-open dashboard per setting
  const openMode = vscode.workspace.getConfiguration('d365fo').get<string>('openDashboardOnStartup', 'ifEmpty');
  const shouldOpen =
    openMode === 'always' ||
    (openMode === 'ifEmpty' && connectionStore.loadAll().length === 0);
  if (shouldOpen) {
    setTimeout(() => {
      vscode.commands.executeCommand('d365fo.openDashboard');
    }, 800);
  }
}

function updateStatusBar(store: ConnectionStore): void {
  const active = store.getActive();
  if (active) {
    statusBarItem.text = `$(rocket) D365 F&O Co-Lead: ${active.name}`;
    statusBarItem.tooltip = `Active project: ${active.name}\nADO project: ${active.adoProject}\nClick to open dashboard`;
  } else {
    statusBarItem.text = `$(rocket) D365 F&O Co-Lead: no project`;
    statusBarItem.tooltip = 'Click to open dashboard and add a project';
  }
}

export function deactivate(): void { /* nothing to clean up */ }
