import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { AgentRegistry } from '../services/agentRegistry';
import { testProject } from '../services/adoClient';

/**
 * Registers the D365 F&O AI Co-Lead chat participants.
 *
 * v1.0 = role routing skeletons. The "master" @d365fo-co-lead handles slash
 * commands (/dashboard, /connections, /test, /sync, /agents, /role). The five
 * role-specific participants currently respond with a tailored "what I can do"
 * message + suggest opening the dashboard. Real agent reasoning (calling
 * MCP servers, generating designs/tests) lights up tile-by-tile in v1.1+.
 */
export function registerChatParticipants(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
  agents: AgentRegistry,
): void {
  // Master / orchestrator
  registerOne(ctx, 'd365fo.coLead', async (request, _c, stream, _t) => {
    const cmd = request.command;
    const prompt = request.prompt.trim();
    switch (cmd) {
      case 'dashboard':
        await vscode.commands.executeCommand('d365fo.openDashboard');
        stream.markdown('Opened the D365 F&O AI Co-Lead dashboard.');
        return;
      case 'connections': {
        const all = connections.loadAll();
        const active = connections.getActive();
        if (all.length === 0) {
          stream.markdown('No project connections yet. ');
          stream.button({ command: 'd365fo.projectKit.init', title: 'Project Initiation Kit' });
          return;
        }
        stream.markdown(`**${all.length} project(s):**\n\n`);
        for (const c of all) {
          const star = c.id === active?.id ? ' â­' : '';
          stream.markdown(`- **${c.name}**${star} - ${c.adoProject}\n`);
        }
        stream.button({ command: 'd365fo.openDashboard', title: 'Open dashboard' });
        return;
      }
      case 'agents': {
        const all = agents.loadAll();
        if (all.length === 0) {
          stream.markdown('No agents defined. ');
          stream.button({ command: 'd365fo.agents.manage', title: 'Manage agents' });
          return;
        }
        stream.markdown(`**${all.length} agent(s):**\n\n`);
        for (const a of all) {
          stream.markdown(`- **${a.name}** \`[${a.role}]\` â€” ${a.description}\n`);
        }
        stream.button({ command: 'd365fo.agents.manage', title: 'Manage agents' });
        return;
      }
      case 'role': {
        const myRoles = vscode.workspace.getConfiguration('d365fo').get<string[]>('myRoles', ['dev-lead']);
        stream.markdown(`Your active role(s): **${myRoles.join(', ')}**\n\n`);
        stream.markdown('Change via VS Code Settings â†’ search "d365fo.myRoles".');
        return;
      }
    }
    helpMaster(stream, prompt);
  });

  // Role-specific participants â€” skeleton responders for v1.0.
  registerRolePartner(ctx, 'd365fo.architect',  'Solution Architect',     'architect',
    ['HLD outlines', 'Integration design', 'ARB checklist', 'Cross-module impact analysis']);
  registerRolePartner(ctx, 'd365fo.fc',         'Functional Consultant',  'fc',
    ['FDD authoring', 'Fit / gap analysis', 'Configuration workbook', 'UAT script drafts']);
  registerDevLead(ctx, connections, identities);
  registerRolePartner(ctx, 'd365fo.developer',  'Developer',              'developer',
    ['Implement TDD via D365FODevMCP', 'Fix BP / UT errors', 'Generate labels', 'X++ pattern help']);
  registerRolePartner(ctx, 'd365fo.tester',     'Tester',                 'tester',
    ['Test cases from FDD', 'Run interactive tests on DevMachine', 'Capture defects with repro', 'Regression checklist']);
  registerRolePartner(ctx, 'd365fo.pm',         'Project Manager',        'pm',
    ['Status rollup (v1.1)', 'Burndown (v1.1)', 'Risk view (v1.1)']);
}

function registerOne(ctx: vscode.ExtensionContext, id: string, handler: vscode.ChatRequestHandler): void {
  const p = vscode.chat.createChatParticipant(id, handler);
  p.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png');
  ctx.subscriptions.push(p);
}

function registerRolePartner(ctx: vscode.ExtensionContext, id: string, displayName: string, role: string, capabilities: string[]): void {
  registerOne(ctx, id, async (request, _c, stream, _t) => {
    const prompt = request.prompt.trim();
    stream.markdown(`Hi â€” I'm your **${displayName}** AI partner (\`${role}\`).\n\n`);
    stream.markdown(`In v1.1+ I'll wire each capability below to MCP servers. For now:\n\n`);
    for (const cap of capabilities) stream.markdown(`- ${cap}\n`);
    stream.markdown('\n');
    if (prompt) {
      stream.markdown(`> Your prompt: _"${escape(prompt)}"_\n\n`);
      stream.markdown('Once wired, this will route to the matching agent + MCP servers and stream a real answer.');
    } else {
      stream.markdown('Try asking me about the items above.');
    }
    stream.button({ command: 'd365fo.openDashboard', title: 'Open dashboard' });
    stream.button({ command: 'd365fo.agents.manage', title: 'Manage agents' });
  });
}

function registerDevLead(ctx: vscode.ExtensionContext, connections: ConnectionStore, identities: IdentityStore): void {
  registerOne(ctx, 'd365fo.devLead', async (request, _c, stream, _t) => {
    const cmd = request.command;
    const prompt = request.prompt.trim();
    switch (cmd) {
      case 'sync':
        await vscode.commands.executeCommand('d365fo.nugetSync.run');
        stream.markdown('Started NuGet sync.');
        return;
      case 'devtasks':
        await vscode.commands.executeCommand('d365fo.devTasks.create');
        stream.markdown('Opened the Dev Tasks creator.');
        return;
      case 'test': {
        const conn = connections.getActive();
        if (!conn) { stream.markdown('No active connection.'); stream.button({ command: 'd365fo.connections.add', title: '+ Add connection' }); return; }
        const id = identities.get(conn.identityId);
        if (!id) { stream.markdown('Active connection has no identity.'); return; }
        const pat = await identities.getSecret(id.id);
        if (!pat) { stream.markdown('Identity has no stored PAT.'); return; }
        stream.progress(`Testing ${conn.name}...`);
        const result = await testProject(conn.adoOrgUrl, conn.adoProject, id.email, pat);
        stream.markdown(result.ok ? `âœ“ Reached **${conn.adoProject}** on ${conn.adoOrgUrl}` : `âœ— HTTP ${result.status} ${result.reason}`);
        return;
      }
    }
    stream.markdown(`Hi â€” I'm your **Dev Lead** AI partner.\n\nTry:\n- \`/sync\` â€” run NuGet sync\n- \`/devtasks\` â€” plan / create ADO Dev Tasks\n- \`/test\` â€” test the active connection\n\nOr just describe what you want and I'll route it (full AI mode lights up in v1.1).`);
    if (prompt) stream.markdown(`\n\n_Your prompt: "${escape(prompt)}"_`);
  });
}

function helpMaster(stream: vscode.ChatResponseStream, prompt: string): void {
  stream.markdown('Hi â€” I am **D365 F&O AI Co-Lead**, your master orchestrator.\n\nSlash commands:\n');
  stream.markdown('- `/dashboard` â€” open the dashboard\n');
  stream.markdown('- `/connections` â€” list project connections\n');
  stream.markdown('- `/agents` â€” list defined agents\n');
  stream.markdown('- `/role` â€” show your current role(s)\n\n');
  stream.markdown('Or talk to a role-specific partner directly:\n');
  stream.markdown('`@d365fo-architect` `@d365fo-fc` `@d365fo-dev-lead` `@d365fo-developer` `@d365fo-tester` `@d365fo-pm`\n');
  if (prompt) stream.markdown(`\n_Your prompt: "${escape(prompt)}"_`);
}

function escape(s: string): string {
  return s.replace(/[<>]/g, ch => ({ '<': '&lt;', '>': '&gt;' }[ch]!));
}
