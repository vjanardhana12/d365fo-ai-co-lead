import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { testProject } from '../services/adoClient';

/**
 * Registers the @d365fo chat participant. All commands route to existing
 * VS Code commands so the same backend is used by both dashboard and chat.
 */
export function registerChatParticipant(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
): void {
  const handler: vscode.ChatRequestHandler = async (request, _context, stream, _token) => {
    const cmd = request.command;
    const prompt = request.prompt.trim();

    switch (cmd) {
      case 'dashboard':
        await vscode.commands.executeCommand('d365fo.openDashboard');
        stream.markdown('Opened the D365 F&O dashboard.');
        return;

      case 'connections': {
        const all = connections.loadAll();
        const active = connections.getActive();
        if (all.length === 0) {
          stream.markdown('No connections yet. ');
          stream.button({ command: 'd365fo.connections.add', title: '+ Add connection' });
          return;
        }
        stream.markdown(`**${all.length} connection(s):**\n\n`);
        for (const c of all) {
          const star = c.id === active?.id ? ' ⭐' : '';
          stream.markdown(`- **${c.name}**${star} - ${c.adoProject} (${c.adoOrgUrl})\n`);
        }
        stream.button({ command: 'd365fo.openDashboard', title: 'Open dashboard' });
        return;
      }

      case 'test': {
        const conn = connections.getActive();
        if (!conn) { stream.markdown('No active connection. '); stream.button({ command: 'd365fo.connections.add', title: '+ Add connection' }); return; }
        const id = identities.get(conn.identityId);
        if (!id) { stream.markdown('Active connection has no identity.'); return; }
        const pat = await identities.getSecret(id.id);
        if (!pat) { stream.markdown('Identity has no stored PAT.'); return; }
        stream.progress(`Testing ${conn.name}...`);
        const result = await testProject(conn.adoOrgUrl, conn.adoProject, id.email, pat);
        if (result.ok) stream.markdown(`✓ Connection successful - reached **${conn.adoProject}** on ${conn.adoOrgUrl}`);
        else stream.markdown(`✗ Connection failed - HTTP ${result.status} ${result.reason}`);
        return;
      }

      case 'sync':
        await vscode.commands.executeCommand('d365fo.nugetSync.run');
        return;

      case 'prs':
      case 'estimate':
        stream.markdown(`**\`/${cmd}\` is coming soon.** Track progress in the [extension README](https://github.com/vjanardhana12/d365fo-devlead#readme).`);
        return;
    }

    // No command -> general help
    stream.markdown('Hi! I am the D365 F&O dev-lead helper. Try one of these:\n\n');
    stream.markdown('- `/dashboard` - open the dashboard panel\n');
    stream.markdown('- `/connections` - list configured connections\n');
    stream.markdown('- `/test` - test the active connection\n');
    stream.markdown('- `/sync` - run NuGet sync for the active connection\n');
    stream.markdown('- `/prs` - show open pull requests *(soon)*\n');
    stream.markdown('- `/estimate` - estimate a work item *(soon)*\n');
    if (prompt) stream.markdown(`\n*(Free-form prompt support coming with later versions: "${escape(prompt)}")*`);
  };

  const participant = vscode.chat.createChatParticipant('d365fo.devlead', handler);
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png');
  ctx.subscriptions.push(participant);
}

function escape(s: string): string {
  return s.replace(/[<>]/g, ch => ({ '<':'&lt;', '>':'&gt;' }[ch]!));
}
