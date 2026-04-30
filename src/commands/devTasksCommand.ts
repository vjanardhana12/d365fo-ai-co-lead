import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { showForm } from '../views/formWebview';
import { createDevTasks, DevTaskHours } from '../services/devTaskRunner';

const LAST_INPUT_KEY = 'd365fo.devTasks.lastInput';
const LAST_RESULT_KEY = 'd365fo.devTasks.lastResult';

interface PresetDef { ce: number; tr: number; td: number; ut: number; wt: number; cr: number; }
const PRESETS: Record<string, PresetDef> = {
  XS: { ce: 2,  tr: 1, td: 1, ut: 1,  wt: 1, cr: 1  /* explicit, not auto */ },
  S:  { ce: 4,  tr: 1, td: 2, ut: 2,  wt: 1, cr: 0  /* auto */ },
  M:  { ce: 8,  tr: 2, td: 2, ut: 4,  wt: 1, cr: 0 },
  L:  { ce: 16, tr: 2, td: 4, ut: 6,  wt: 2, cr: 0 },
  XL: { ce: 32, tr: 4, td: 8, ut: 12, wt: 2, cr: 0 },
};

interface LastInput {
  parentId: string;
  developer: string;
  reviewer: string;
  preset: string;
  hours: DevTaskHours;
  ceWorkItemType: string;
  iteration: string;
}

export interface LastDevTaskResult {
  ok: boolean;
  parentId: string;
  parentTitle: string;
  created: number;
  skipped: number;
  failed: number;
  whenIso: string;
  durationSec: number;
  preset: string;
  links: { id: number; title: string; url: string }[];
}

let channel: vscode.OutputChannel | undefined;
function getChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('D365 F&O Dev Tasks');
  return channel;
}

export function registerDevTasksCommand(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.devTasks.showOutput', () => getChannel().show(true)),

    vscode.commands.registerCommand('d365fo.devTasks.create', async (opts?: { useLast?: boolean }) => {
      const conn = connections.getActive();
      if (!conn) { vscode.window.showWarningMessage('No active connection. Add one first.'); return; }
      const identity = identities.get(conn.identityId);
      if (!identity) { vscode.window.showWarningMessage('Active connection has no identity.'); return; }
      const pat = await identities.getSecret(identity.id);
      if (!pat) { vscode.window.showWarningMessage('Identity has no stored PAT.'); return; }

      const last = ctx.globalState.get<LastInput>(LAST_INPUT_KEY);

      let input: LastInput | undefined;
      if (opts?.useLast && last && last.parentId) {
        input = { ...last };
        // Always re-prompt for the parent ID even on "Run again" — it changes per task.
        const newParent = await vscode.window.showInputBox({
          prompt: `Parent work item ID (last: #${last.parentId})`,
          value: last.parentId,
          validateInput: v => /^\d+$/.test(v.trim()) ? undefined : 'Must be a numeric work item ID',
        });
        if (!newParent) return;
        input.parentId = newParent.trim();
      } else {
        const presetOptions = [
          ...Object.entries(PRESETS).map(([k, v]) => ({
            value: k,
            label: k,
            description: `CE:${v.ce} TR:${v.tr} TD:${v.td} UT:${v.ut} WT:${v.wt} CR:${v.cr || 'auto'}`,
          })),
          { value: 'Custom', label: 'Custom', description: 'Enter hours manually below' },
        ];
        const formResult = await showForm(ctx, `Create Dev Tasks - ${conn.name}`, [
          { key: 'parentId', label: 'Parent work item ID (DD / PBI / Feature)', type: 'text', required: true,
            value: last?.parentId, placeholder: 'e.g. 81234',
            help: 'The existing parent work item under which the dev hierarchy will be created.' },
          { key: 'developer', label: 'Developer (email or display name)', type: 'text', required: true,
            value: last?.developer ?? identity.email,
            placeholder: identity.email,
            help: 'Assignee for Code Extensions, Tech Review, Tech Design, Unit Testing, Walkthrough.' },
          { key: 'reviewer', label: 'Reviewer (Code Review assignee)', type: 'text', required: true,
            value: last?.reviewer ?? identity.email,
            placeholder: 'reviewer@your-org.com',
            help: 'Assignee for the Code Review task only.' },
          { key: 'preset', label: 'T-shirt preset', type: 'select', required: true,
            value: last?.preset ?? 'M',
            options: presetOptions,
            help: 'Pre-fills the hour breakdown. Pick Custom to enter your own.' },
          { key: 'ce', label: 'CE hours (Code Extensions parent)', type: 'text',
            value: last?.hours.ce.toString() ?? '8',
            help: 'Used only if preset = Custom. Otherwise ignored.' },
          { key: 'tr', label: 'TR hours (Technical Review)', type: 'text', value: last?.hours.tr.toString() ?? '2' },
          { key: 'td', label: 'TD hours (Technical Design)', type: 'text', value: last?.hours.td.toString() ?? '2' },
          { key: 'ut', label: 'UT hours (Unit Testing)', type: 'text', value: last?.hours.ut.toString() ?? '4' },
          { key: 'wt', label: 'WT hours (Walkthrough)', type: 'text', value: last?.hours.wt.toString() ?? '1' },
          { key: 'cr', label: 'CR hours (Code Review, 0 = auto-calc 10% of CE)', type: 'text',
            value: last?.hours.cr.toString() ?? '0',
            help: 'Leave 0 to auto-calculate as 10% of CE (min 1).' },
          { key: 'ceWorkItemType', label: 'CE work item type', type: 'text',
            value: last?.ceWorkItemType ?? 'Code Extensions',
            help: 'Customize if your project uses a different parent task type (e.g. "User Story").' },
          { key: 'iteration', label: 'Iteration / Sprint (blank = inherit from parent)', type: 'text',
            value: last?.iteration ?? '' },
          { key: 'dryRun', label: 'Dry run?', type: 'select', required: true,
            value: 'No',
            options: [
              { value: 'No', label: 'No', description: 'Actually create the work items' },
              { value: 'Yes', label: 'Yes', description: 'Preview only — no ADO changes' },
            ]},
        ], 'Create tasks');
        if (!formResult) return;

        if (!/^\d+$/.test(formResult.parentId.trim())) {
          vscode.window.showErrorMessage('Parent work item ID must be numeric.');
          return;
        }

        const presetKey = formResult.preset;
        let hours: DevTaskHours;
        if (presetKey === 'Custom') {
          const parsed = parseHours(formResult);
          if (!parsed) {
            vscode.window.showErrorMessage('All hour fields must be non-negative integers (CE/TR/TD/UT/WT > 0).');
            return;
          }
          hours = parsed;
        } else {
          const p = PRESETS[presetKey];
          hours = { ce: p.ce, tr: p.tr, td: p.td, ut: p.ut, wt: p.wt, cr: p.cr };
        }

        input = {
          parentId: formResult.parentId.trim(),
          developer: formResult.developer.trim(),
          reviewer: formResult.reviewer.trim(),
          preset: presetKey,
          hours,
          ceWorkItemType: formResult.ceWorkItemType.trim() || 'Code Extensions',
          iteration: formResult.iteration.trim(),
        };

        // Persist sticky inputs (for "Run again" defaults)
        await ctx.globalState.update(LAST_INPUT_KEY, input);

        if (formResult.dryRun === 'Yes') {
          await runOnce({ ...input, dryRun: true }, conn, identity, pat, ctx);
          return;
        }
      }

      await runOnce({ ...input!, dryRun: false }, conn, identity, pat, ctx);
    }),
  );
}

interface RunInput extends LastInput { dryRun: boolean; }

async function runOnce(
  input: RunInput,
  conn: { id: string; name: string; adoOrgUrl: string; adoProject: string },
  identity: { id: string; email: string },
  pat: string,
  ctx: vscode.ExtensionContext,
): Promise<void> {
  const ch = getChannel();
  ch.show(true);
  ch.appendLine('');
  ch.appendLine(`──────────────────────────────────────────────────────────────`);
  ch.appendLine(`Dev Tasks — ${new Date().toLocaleString()} — ${conn.name}`);
  ch.appendLine(`──────────────────────────────────────────────────────────────`);

  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  sb.text = `$(sync~spin) Dev Tasks: parent #${input.parentId}...`;
  sb.tooltip = 'Creating dev tasks — click to view output';
  sb.command = 'd365fo.devTasks.showOutput';
  sb.show();

  const onLine = (line: string) => {
    ch.appendLine(line);
    const m = line.match(/^\[\.\.\]\s+Creating\s+\w+(?:\s+\w+)?:\s+(.+)$/);
    if (m) sb.text = `$(sync~spin) Dev Tasks: ${shortTitle(m[1])}`;
  };

  const result = await createDevTasks({
    orgUrl: conn.adoOrgUrl,
    project: conn.adoProject,
    email: identity.email,
    pat,
    parentId: input.parentId,
    developer: input.developer,
    reviewer: input.reviewer,
    hours: input.hours,
    ceWorkItemType: input.ceWorkItemType,
    iteration: input.iteration || undefined,
    dryRun: input.dryRun,
  }, onLine);

  // Status bar final state
  if (result.ok) {
    sb.text = input.dryRun
      ? `$(beaker) Dev Tasks (dry run): ${result.created.length} would be created`
      : `$(check) Dev Tasks: ${result.created.length} created${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`;
    sb.color = new vscode.ThemeColor('charts.green');
  } else {
    sb.text = `$(error) Dev Tasks: ${result.failed.length} failed`;
    sb.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  setTimeout(() => sb.dispose(), 10_000);

  // Persist last result snapshot for the dashboard tile
  if (!input.dryRun) {
    const snap: LastDevTaskResult = {
      ok: result.ok,
      parentId: result.parentId,
      parentTitle: result.parentTitle,
      created: result.created.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
      whenIso: new Date().toISOString(),
      durationSec: result.durationSec,
      preset: input.preset,
      links: result.created.map(c => ({ id: c.id, title: c.title, url: c.url })),
    };
    await ctx.globalState.update(LAST_RESULT_KEY, snap);
  }

  vscode.commands.executeCommand('d365fo.dashboard.refresh').then(undefined, () => {});

  if (result.ok) {
    const msg = input.dryRun
      ? `Dev Tasks (dry run): ${result.created.length} would be created.`
      : `Dev Tasks: ${result.created.length} created, ${result.skipped.length} skipped.`;
    const action = input.dryRun ? undefined : await vscode.window.showInformationMessage(
      msg, 'Open parent in ADO', 'Show output');
    if (action === 'Open parent in ADO') {
      const url = `${conn.adoOrgUrl.replace(/\/+$/, '')}/${encodeURIComponent(conn.adoProject)}/_workitems/edit/${result.parentId}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    } else if (action === 'Show output') {
      ch.show(true);
    }
  } else {
    vscode.window.showErrorMessage(`Dev Tasks failed: ${result.failed.length} failed. See output channel.`);
  }
}

function parseHours(v: Record<string, string>): DevTaskHours | undefined {
  const n = (s: string) => {
    const x = parseInt(s, 10);
    return isNaN(x) || x < 0 ? -1 : x;
  };
  const h: DevTaskHours = {
    ce: n(v.ce), tr: n(v.tr), td: n(v.td),
    ut: n(v.ut), wt: n(v.wt), cr: n(v.cr),
  };
  if ([h.ce, h.tr, h.td, h.ut, h.wt].some(x => x <= 0)) return undefined;
  if (h.cr < 0) return undefined;
  return h;
}

function shortTitle(t: string): string {
  if (t.length <= 40) return t;
  return t.slice(0, 37) + '...';
}
