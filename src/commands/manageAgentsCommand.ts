import * as vscode from 'vscode';
import { AgentRegistry, AgentDefinition } from '../services/agentRegistry';
import { ConnectionStore } from '../services/connectionStore';
import { showForm, FormField } from '../views/formWebview';

const ROLE_OPTIONS = [
  { value: 'architect',  label: 'Solution Architect' },
  { value: 'fc',         label: 'Functional Consultant' },
  { value: 'dev-lead',   label: 'Dev Lead' },
  { value: 'developer',  label: 'Developer' },
  { value: 'tester',     label: 'Tester' },
  { value: 'pm',         label: 'Project Manager' },
  { value: 'custom',     label: 'Custom (no preset role)' },
];

const MCP_OPTIONS_HELP = 'Comma-separated MCP server names. Common: D365FODevMCP, DevMachine, ado, microsoft.docs.mcp';

export function registerManageAgentsCommand(
  ctx: vscode.ExtensionContext,
  registry: AgentRegistry,
  connections: ConnectionStore,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.agents.manage', async () => {
      while (true) {
        const all = registry.loadAll();
        const items: (vscode.QuickPickItem & { kind?: string; agent?: AgentDefinition })[] = [
          { label: '$(add) Create new agent...', kind: 'create' },
          { label: '', kind: 'separator' as any },
        ];
        for (const a of all) {
          items.push({
            label: `$(person) ${a.name}`,
            description: `[${a.role}]`,
            detail: a.description,
            agent: a,
          });
        }
        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: `Manage Agents (${all.length}) — pick one to edit / delete, or create a new one`,
          ignoreFocusOut: true,
        });
        if (!pick) return;

        if (pick.kind === 'create') {
          await createAgent(ctx, registry);
          continue;
        }
        if (pick.agent) {
          const action = await vscode.window.showQuickPick(
            ['Edit', 'Clone', 'Delete', 'Cancel'],
            { placeHolder: `What to do with '${pick.agent.name}'?` },
          );
          if (!action || action === 'Cancel') continue;
          if (action === 'Edit')   { await editAgent(ctx, registry, pick.agent); continue; }
          if (action === 'Clone')  { await cloneAgent(ctx, registry, pick.agent); continue; }
          if (action === 'Delete') {
            const ok = await vscode.window.showWarningMessage(`Delete agent '${pick.agent.name}'?`, { modal: true }, 'Delete');
            if (ok === 'Delete') {
              registry.delete(pick.agent.id);
              vscode.window.showInformationMessage(`Deleted agent '${pick.agent.name}'.`);
              await vscode.commands.executeCommand('d365fo.dashboard.refresh');
            }
            continue;
          }
        }
      }
    }),

    vscode.commands.registerCommand('d365fo.agents.invoke', async () => {
      const all = registry.loadAll();
      if (all.length === 0) {
        const create = await vscode.window.showInformationMessage(
          'No agents yet. Create one?', 'Create agent', 'Cancel',
        );
        if (create === 'Create agent') {
          await vscode.commands.executeCommand('d365fo.agents.manage');
        }
        return;
      }
      const pick = await vscode.window.showQuickPick(
        all.map(a => ({ label: `$(person) ${a.name}`, description: `[${a.role}]`, detail: a.description, agent: a })),
        { placeHolder: 'Pick an agent to ask in Copilot Chat', ignoreFocusOut: true },
      );
      if (!pick) return;
      const participant = roleToParticipant(pick.agent.role);
      // Open chat with the participant pre-mentioned. The user types their actual question.
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@${participant} `,
        isPartialQuery: true,
      });
    }),
  );
}

async function createAgent(ctx: vscode.ExtensionContext, registry: AgentRegistry): Promise<void> {
  const fields: FormField[] = [
    { key: 'name', label: 'Agent name', type: 'text', required: true, placeholder: 'e.g. FDD Reviewer' },
    { key: 'role', label: 'Role', type: 'select', required: true, options: ROLE_OPTIONS, value: 'developer' },
    { key: 'description', label: 'Short description', type: 'text', required: true, placeholder: 'What this agent helps with' },
    { key: 'systemPrompt', label: 'System prompt', type: 'textarea', required: true,
      placeholder: 'You are a D365 F&O ... When asked, you ...',
      help: 'Defines how the agent behaves. Include role, scope, conventions, and what tools to prefer.' },
    { key: 'allowedMcpServers', label: 'MCP servers', type: 'text', value: 'D365FODevMCP,ado',
      help: MCP_OPTIONS_HELP },
    { key: 'scope', label: 'Scope', type: 'select', value: 'global', options: [
      { value: 'global',  label: 'Global (all projects)' },
      { value: 'project', label: 'Project (active connection only)' },
    ]},
  ];
  const r = await showForm(ctx, 'Create agent', fields, 'Create');
  if (!r) return;
  const now = new Date().toISOString();
  const def: AgentDefinition = {
    id: registry.newId(),
    name: r.name.trim(),
    role: r.role,
    description: r.description.trim(),
    systemPrompt: r.systemPrompt.trim(),
    allowedMcpServers: r.allowedMcpServers.split(',').map(s => s.trim()).filter(Boolean),
    scope: r.scope as 'global' | 'project',
    createdUtc: now,
    updatedUtc: now,
  };
  registry.upsert(def);
  vscode.window.showInformationMessage(`Created agent '${def.name}'. Invoke via @${roleToParticipant(def.role)} in Copilot Chat.`);
  await vscode.commands.executeCommand('d365fo.dashboard.refresh');
}

async function editAgent(ctx: vscode.ExtensionContext, registry: AgentRegistry, a: AgentDefinition): Promise<void> {
  const fields: FormField[] = [
    { key: 'name',         label: 'Agent name',       type: 'text',     value: a.name, required: true },
    { key: 'role',         label: 'Role',             type: 'select',   value: a.role, options: ROLE_OPTIONS, required: true },
    { key: 'description',  label: 'Short description', type: 'text',    value: a.description, required: true },
    { key: 'systemPrompt', label: 'System prompt',    type: 'textarea', value: a.systemPrompt, required: true },
    { key: 'allowedMcpServers', label: 'MCP servers', type: 'text',     value: a.allowedMcpServers.join(','), help: MCP_OPTIONS_HELP },
    { key: 'scope',        label: 'Scope',            type: 'select',   value: a.scope, options: [
      { value: 'global',  label: 'Global (all projects)' },
      { value: 'project', label: 'Project (active connection only)' },
    ]},
  ];
  const r = await showForm(ctx, `Edit agent — ${a.name}`, fields, 'Save');
  if (!r) return;
  registry.upsert({
    ...a,
    name: r.name.trim(),
    role: r.role,
    description: r.description.trim(),
    systemPrompt: r.systemPrompt.trim(),
    allowedMcpServers: r.allowedMcpServers.split(',').map(s => s.trim()).filter(Boolean),
    scope: r.scope as 'global' | 'project',
  });
  vscode.window.showInformationMessage(`Updated agent '${r.name}'.`);
  await vscode.commands.executeCommand('d365fo.dashboard.refresh');
}

async function cloneAgent(ctx: vscode.ExtensionContext, registry: AgentRegistry, a: AgentDefinition): Promise<void> {
  const newName = await vscode.window.showInputBox({ prompt: 'Name for the clone', value: `${a.name} (copy)` });
  if (!newName) return;
  const now = new Date().toISOString();
  registry.upsert({ ...a, id: registry.newId(), name: newName, createdUtc: now, updatedUtc: now });
  vscode.window.showInformationMessage(`Cloned agent as '${newName}'.`);
  await vscode.commands.executeCommand('d365fo.dashboard.refresh');
}

function roleToParticipant(role: string): string {
  switch (role) {
    case 'architect': return 'd365fo-architect';
    case 'fc':        return 'd365fo-fc';
    case 'dev-lead':  return 'd365fo-dev-lead';
    case 'developer': return 'd365fo-developer';
    case 'tester':    return 'd365fo-tester';
    case 'pm':        return 'd365fo-pm';
    default:          return 'd365fo-co-lead';
  }
}
