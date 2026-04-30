import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';
import { showForm } from '../views/formWebview';
import { isKitGranted, refreshKitAccessForActive } from '../services/kitAccessProbe';
import { IdentityStore } from '../services/identityStore';

/**
 * Carlsberg-specific kit overlay. Stored under
 *   connection.projectSpec.kitData.carlsberg
 *
 * Fields are the Carlsberg-only bits that don't belong in the generic
 * Dev Tasks runner: ADO custom-field strings and stakeholder mentions.
 */
export interface CarlsbergKitData {
  ceCustomFields?: Record<string, string>;
  taskCustomFields?: Record<string, string>;
  stakeholders?: { name: string; guid: string }[];
}

const DEFAULTS: CarlsbergKitData = {
  ceCustomFields: {
    'Custom.CodeExtensionsDiscipline_MicrosoftServices': 'Development',
    'Custom.CodeExtensionsTaskType_MicrosoftServices': 'Planned',
    'Custom.CodeExtensionsTypeClassifier_MicrosoftServices': 'Functional',
    'Custom.CodeStage_MicrosoftServices': 'Initial Code Development',
    'Custom.Domain_MicrosoftServices': 'Business Applications',
    'Custom.WorkLoadType_MicrosoftServices': 'Finance and Operations',
  },
  taskCustomFields: {
    'Custom.TaskType_MicrosoftServices': 'Planned',
  },
  stakeholders: [
    { name: 'Divya Agarwal (EXT)',       guid: '165d322a-6b4d-6e1e-9e9e-cca5431f2f7a' },
    { name: 'Sunil Krishnamurthy (EXT)', guid: 'f905bb3f-7e40-47a8-b11f-49bed5ecb9ad' },
  ],
};

export function registerCbSpecKitCommand(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.cbSpecKit.edit', async () => {
      const conn = connections.getActive();
      if (!conn) { vscode.window.showWarningMessage('No active project. Create one via Project Initiation Kit first.'); return; }

      // Live access gate: re-check if needed, then refuse if not granted.
      await refreshKitAccessForActive(connections, identities);
      const fresh = connections.getActive();
      if (!isKitGranted(fresh, 'carlsberg')) {
        vscode.window.showWarningMessage(
          `This kit requires read access to https://dev.azure.com/carlsberggroup. Your active connection's identity does not have that access.`,
        );
        return;
      }

      const existing = (conn.projectSpec?.kitData?.carlsberg as CarlsbergKitData | undefined) ?? {};
      const ce = { ...DEFAULTS.ceCustomFields, ...(existing.ceCustomFields ?? {}) };
      const tk = { ...DEFAULTS.taskCustomFields, ...(existing.taskCustomFields ?? {}) };
      const sh = existing.stakeholders ?? DEFAULTS.stakeholders ?? [];

      const result = await showForm(ctx, `CB Spec Kit - ${conn.name}`, [
        { key: 'ceCustomFields', label: 'Code Extensions custom fields (one per line, key=value)', type: 'textarea',
          value: kvToText(ce),
          help: 'Applied to every Code Extensions parent created via Dev Tasks.' },
        { key: 'taskCustomFields', label: 'Task custom fields (one per line, key=value)', type: 'textarea',
          value: kvToText(tk),
          help: 'Applied to every Task (Tech Review / Tech Design / etc.) created via Dev Tasks.' },
        { key: 'stakeholders', label: 'Stakeholder @mentions (one per line, name|guid)', type: 'textarea',
          value: stakeholdersToText(sh),
          help: 'Posted as a History comment after each work item is created. Format: "Display Name|guid".' },
      ], 'Save CB Spec Kit');
      if (!result) return;

      const updated: CarlsbergKitData = {
        ceCustomFields:   textToKv(result.ceCustomFields),
        taskCustomFields: textToKv(result.taskCustomFields),
        stakeholders:     textToStakeholders(result.stakeholders),
      };

      const spec = { ...(conn.projectSpec ?? {}) };
      spec.kit = 'carlsberg';                              // ensure kit is flagged
      spec.kitData = { ...(spec.kitData ?? {}), carlsberg: updated };
      if (!spec.codeReviewPercent) spec.codeReviewPercent = 10;

      connections.upsert({ ...conn, projectSpec: spec });
      vscode.commands.executeCommand('d365fo.dashboard.refresh');
      vscode.commands.executeCommand('d365fo.refresh');
      vscode.window.showInformationMessage(`CB Spec Kit saved for '${conn.name}'.`);
    }),
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function kvToText(kv: Record<string, string> | undefined): string {
  if (!kv) return '';
  return Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n');
}
function textToKv(s: string | undefined): Record<string, string> | undefined {
  if (!s) return undefined;
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}
function stakeholdersToText(sh: { name: string; guid: string }[]): string {
  return sh.map(s => `${s.name}|${s.guid}`).join('\n');
}
function textToStakeholders(s: string | undefined): { name: string; guid: string }[] | undefined {
  if (!s) return undefined;
  const out: { name: string; guid: string }[] = [];
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.lastIndexOf('|');
    if (idx <= 0) continue;
    const name = t.slice(0, idx).trim();
    const guid = t.slice(idx + 1).trim();
    if (name && guid) out.push({ name, guid });
  }
  return out.length ? out : undefined;
}
