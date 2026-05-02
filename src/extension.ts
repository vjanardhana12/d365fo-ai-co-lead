import * as vscode from 'vscode';
import { ConnectionStore } from './services/connectionStore';
import { IdentityStore } from './services/identityStore';
import { AgentRegistry } from './services/agentRegistry';
import { ConnectionsTreeProvider } from './views/connectionsTreeProvider';
import { openDashboard, refreshDashboard } from './views/dashboardWebview';
import { registerConnectionCommands } from './commands/connectionCommands';
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
  const agentRegistry = new AgentRegistry(context);
  agentRegistry.seedDefaults();

  // One-time migration: copy email + PAT from legacy IdentityStore onto Connections.
  // The Identity concept has been merged into Connection (one connection = one ADO email + PAT).
  void migrateLegacyIdentities(context, connectionStore);

  // Tree views (only Connections — Identities view removed in v1.0.x merge)
  const connectionsTree = new ConnectionsTreeProvider(connectionStore);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('d365fo.connections', connectionsTree),
  );

  // Commands
  registerConnectionCommands(context, connectionStore, connectionsTree, () => updateStatusBar(connectionStore));
  registerNuGetSyncCommand(context, connectionStore);
  registerDevTasksCommand(context, connectionStore);
  registerProjectKitCommand(context, connectionStore);
  registerCbSpecKitCommand(context, connectionStore);
  registerManageAgentsCommand(context, agentRegistry, connectionStore);
  registerAiModeCommands(context, connectionStore);
  registerSharePointCommands(context, connectionStore);

  context.subscriptions.push(
    vscode.commands.registerCommand('d365fo.openDashboard', () =>
      openDashboard(context, connectionStore)),
    vscode.commands.registerCommand('d365fo.dashboard.refresh', () => refreshDashboard()),
    vscode.commands.registerCommand('d365fo.refresh', () => {
      connectionsTree.refresh();
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
  registerChatParticipants(context, connectionStore, agentRegistry);

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

/**
 * Best-effort one-shot migration from the legacy IdentityStore to the merged
 * Connection model. Safe to run on every activation — it only acts on
 * connections that don't yet have email + patSecretKey.
 */
async function migrateLegacyIdentities(ctx: vscode.ExtensionContext, connections: ConnectionStore): Promise<void> {
  try {
    const legacy = new IdentityStore(ctx);
    const all = legacy.loadAll();
    if (all.length === 0) return;
    const n = await connections.migrateFromIdentities(
      all.map(i => ({ id: i.id, email: i.email, secretKey: i.secretKey })),
      ctx.secrets,
    );
    if (n > 0) {
      vscode.window.setStatusBarMessage(`D365 F&O Co-Lead: migrated ${n} identity${n === 1 ? '' : 's'} into connections.`, 5000);
    }
  } catch (_e) { /* migration is best-effort */ }
}
