import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import * as vscode from 'vscode';

const SCRIPT_URL = 'https://raw.githubusercontent.com/vjanardhana12/d365fo-nuget-sync/main/Sync-D365FONuGet.ps1';

function cacheDir(): string {
  return path.join(os.homedir(), 'AppData', 'Local', 'd365fo-console', 'scripts');
}

async function ensureScript(): Promise<string> {
  const overridden = vscode.workspace.getConfiguration('d365fo').get<string>('nugetSyncScript', '').trim();
  if (overridden && fs.existsSync(overridden)) return overridden;

  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, 'Sync-D365FONuGet.ps1');
  if (fs.existsSync(dst)) return dst;

  await downloadFile(SCRIPT_URL, dst);
  return dst;
}

function downloadFile(url: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(dst);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
}

export interface NuGetSyncRequest {
  feedUrl: string;
  feedName: string;
  email: string;
  pat: string;
  packageFolder: string;
  force: boolean;
}

/**
 * Runs the existing Sync-D365FONuGet.ps1 script and pipes output to a VS Code OutputChannel.
 */
export async function runNuGetSync(req: NuGetSyncRequest, channel: vscode.OutputChannel): Promise<number> {
  const script = await ensureScript();
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-FeedUrl', req.feedUrl,
    '-FeedName', req.feedName,
    '-Email', req.email,
    '-Pat', req.pat,
    '-PackageFolder', req.packageFolder,
    '-NonInteractive',
  ];
  if (req.force) args.push('-Force');

  channel.show(true);
  channel.appendLine(`> powershell.exe ${args.filter(a => a !== req.pat).join(' ')}`);

  return new Promise<number>((resolve) => {
    const proc = cp.spawn('powershell.exe', args, { windowsHide: true });
    proc.stdout.on('data', (b) => channel.append(b.toString()));
    proc.stderr.on('data', (b) => channel.append('[err] ' + b.toString()));
    proc.on('close', (code) => {
      channel.appendLine(`\n[exit ${code}]`);
      resolve(code ?? -1);
    });
  });
}
