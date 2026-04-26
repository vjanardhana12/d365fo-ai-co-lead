import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import * as vscode from 'vscode';

const SCRIPT_URL = 'https://raw.githubusercontent.com/vjanardhana12/d365fo-nuget-sync/main/Sync-D365FONuGet.ps1';
const RELEASES_API = 'https://api.github.com/repos/vjanardhana12/d365fo-nuget-sync/releases/latest';

function cacheDir(): string {
  return path.join(os.homedir(), 'AppData', 'Local', 'd365fo-console', 'scripts');
}

async function ensureScript(): Promise<string> {
  const overridden = vscode.workspace.getConfiguration('d365fo').get<string>('nugetSyncScript', '').trim();
  if (overridden && fs.existsSync(overridden)) return overridden;

  const channel = vscode.workspace.getConfiguration('d365fo').get<string>('nugetSyncScriptChannel', 'latest-release');
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, 'Sync-D365FONuGet.ps1');

  let url = SCRIPT_URL; // fallback to main
  if (channel === 'latest-release') {
    try {
      const meta = await getLatestReleaseAsset();
      if (meta) url = meta;
    } catch { /* fall through to main */ }
  }
  try {
    await downloadFile(url, dst);
  } catch (e) {
    if (!fs.existsSync(dst)) throw e;
  }
  return dst;
}

function getLatestReleaseAsset(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    https.get(RELEASES_API, { headers: { 'User-Agent': 'd365fo-devlead' } }, (res) => {
      if (res.statusCode !== 200) { resolve(undefined); return; }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const asset = (json.assets ?? []).find((a: any) => a.name === 'Sync-D365FONuGet.ps1');
          resolve(asset?.browser_download_url);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
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
export async function runNuGetSync(req: NuGetSyncRequest, channel: vscode.OutputChannel, onLine?: (line: string) => void): Promise<number> {
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
    let buf = '';
    const handle = (chunk: string, prefix = '') => {
      channel.append(prefix + chunk);
      if (!onLine) return;
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        onLine(line);
      }
    };
    proc.stdout.on('data', (b) => handle(b.toString()));
    proc.stderr.on('data', (b) => handle(b.toString(), '[err] '));
    proc.on('close', (code) => {
      if (buf && onLine) onLine(buf);
      channel.appendLine(`\n[exit ${code}]`);
      resolve(code ?? -1);
    });
  });
}
