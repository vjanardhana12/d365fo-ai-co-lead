import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { runNuGetSync } from '../services/nugetSyncRunner';
import { showForm } from '../views/formWebview';

const LAST_NUGET_KEY = 'd365fo.lastNuGetSync';
const LAST_RESULT_KEY = 'd365fo.lastNuGetSyncResult';

interface LastNuGet { feedUrl: string; feedName: string; packageFolder: string; force: string; }
export interface LastNuGetResult { ok: boolean; pushed: number; skipped: number; failed: number; whenIso: string; durationSec: number; }

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('D365FO NuGet Sync');
  return channel;
}

export function registerNuGetSyncCommand(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.nugetSync.showOutput', () => {
      getChannel().show(true);
    }),
    vscode.commands.registerCommand('d365fo.nugetSync.run', async () => {
      const conn = connections.getActive();
      if (!conn) { vscode.window.showWarningMessage('No active connection. Add one first.'); return; }
      const identity = identities.get(conn.identityId);
      if (!identity) { vscode.window.showWarningMessage('Active connection has no identity.'); return; }
      const pat = await identities.getSecret(identity.id);
      if (!pat) { vscode.window.showWarningMessage('Identity has no stored PAT.'); return; }

      const last = ctx.globalState.get<LastNuGet>(LAST_NUGET_KEY) ?? { feedUrl: '', feedName: '', packageFolder: '', force: 'No' };

      const result = await showForm(
        ctx,
        `NuGet Sync - ${conn.name}`,
        [
          { key: 'feedUrl', label: 'ADO Artifacts feed URL', type: 'text', required: true,
            value: last.feedUrl,
            placeholder: 'https://pkgs.dev.azure.com/<org>/_packaging/<feed>/nuget/v3/index.json',
            help: 'Find this in ADO -> Artifacts -> your feed -> Connect to feed -> NuGet -> Project setup.' },
          { key: 'feedName', label: 'Feed name', type: 'text', required: true,
            value: last.feedName,
            placeholder: 'auto-derived from URL if blank',
            help: 'Used as the source name in nuget.config.' },
          { key: 'packageFolder', label: 'Package folder', type: 'folder', required: true,
            value: last.packageFolder,
            placeholder: 'e.g. D:\\D365FO\\PackagesLocalDirectory or path to your .nupkg files',
            help: 'Folder containing .nupkg files to push. Click Browse... to pick.' },
          { key: 'force', label: 'Force re-push if version exists?', type: 'select', required: true,
            value: last.force,
            options: [
              { value: 'No', label: 'No', description: 'Skip existing versions (recommended)' },
              { value: 'Yes', label: 'Yes', description: 'Overwrite existing versions' },
            ]},
        ],
        'Run sync',
      );
      if (!result) return;

      // Auto-derive feed name from URL if user left it blank but URL has it
      let feedName = result.feedName.trim();
      if (!feedName) {
        feedName = (result.feedUrl.match(/_packaging\/([^/]+)\/nuget/) ?? [])[1] ?? '';
      }
      if (!feedName) {
        vscode.window.showErrorMessage('Could not determine feed name. Please enter it manually.');
        return;
      }
      if (!/^https:\/\/pkgs\.dev\.azure\.com\/.+\/index\.json$/.test(result.feedUrl)) {
        vscode.window.showErrorMessage('Feed URL must look like https://pkgs.dev.azure.com/<org>/_packaging/<feed>/nuget/v3/index.json');
        return;
      }

      // Persist for next time
      ctx.globalState.update(LAST_NUGET_KEY, {
        feedUrl: result.feedUrl.trim(),
        feedName,
        packageFolder: result.packageFolder.trim(),
        force: result.force,
      } as LastNuGet);

      const ch = getChannel();
      ch.show(true);

      // Status bar item — live during run, then stays visible 10s with result colour
      const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
      sb.text = '$(sync~spin) NuGet Sync: starting...';
      sb.tooltip = 'D365FO NuGet Sync running - click to view output';
      sb.command = 'd365fo.nugetSync.showOutput';
      sb.show();

      const startedAt = Date.now();
      const tally = { pushed: 0, skipped: 0, failed: 0 };
      let lastPkg = '';

      const onLine = (line: string) => {
        // Match: "   [..]   Pkg.nupkg (NN MB)  pushing..."
        const m = line.match(/\[\.\.\]\s+(\S+\.nupkg)/);
        if (m) {
          lastPkg = shortPkg(m[1]);
          sb.text = `$(sync~spin) NuGet: ${lastPkg}`;
          return;
        }
        if (/\[OK\]\s+\S+\.nupkg pushed/.test(line)) tally.pushed++;
        else if (/\[FAIL\]\s+\S+\.nupkg/.test(line)) tally.failed++;
        else {
          const skip = line.match(/Skipped\s*:\s*(\d+)/);
          if (skip) tally.skipped = parseInt(skip[1], 10);
        }
      };

      const exit = await runNuGetSync({
        feedUrl: result.feedUrl.trim(),
        feedName,
        email: identity.email,
        pat,
        packageFolder: result.packageFolder.trim(),
        force: result.force === 'Yes',
      }, ch, onLine);

      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      const ok = exit === 0;

      // Persist last result for dashboard badge
      const summary: LastNuGetResult = {
        ok, pushed: tally.pushed, skipped: tally.skipped, failed: tally.failed,
        whenIso: new Date().toISOString(), durationSec,
      };
      await ctx.globalState.update(LAST_RESULT_KEY, summary);

      // Status bar final state — sticky for 10s with colour
      sb.text = ok
        ? `$(check) NuGet Sync: ${tally.pushed} pushed, ${tally.skipped} skipped (${fmtDur(durationSec)})`
        : `$(error) NuGet Sync failed: ${tally.failed} failed`;
      sb.backgroundColor = new vscode.ThemeColor(ok ? 'statusBarItem.warningBackground' : 'statusBarItem.errorBackground');
      // Use prominent background only on failure; on success use a coloured foreground
      if (ok) {
        sb.backgroundColor = undefined;
        sb.color = new vscode.ThemeColor('charts.green');
      } else {
        sb.color = undefined;
      }
      setTimeout(() => sb.dispose(), 10000);

      // Refresh dashboard if open
      vscode.commands.executeCommand('d365fo.dashboard.refresh').then(undefined, () => {});

      if (ok) vscode.window.showInformationMessage(`NuGet sync completed - ${tally.pushed} pushed, ${tally.skipped} skipped.`);
      else vscode.window.showErrorMessage(`NuGet sync failed (exit ${exit}). See output channel.`);
    }),
  );
}

function shortPkg(name: string): string {
  // Microsoft.Dynamics.AX.Platform.CompilerPackage.nupkg -> Platform.CompilerPackage
  return name.replace(/^Microsoft\.Dynamics\.AX\./, '').replace(/\.nupkg$/, '');
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}