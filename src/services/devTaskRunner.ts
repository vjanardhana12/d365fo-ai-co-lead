import * as https from 'https';
import { URL } from 'url';

/**
 * Generic dev-task creator — creates a standard task hierarchy under a
 * parent work item (typically a "Document Deliverable"/PBI/Feature) in
 * Azure DevOps.
 *
 * Hierarchy created:
 *   Parent (existing)
 *   ├── Technical Review (Task)        → developer
 *   └── Development (Code Extensions)  → developer
 *       ├── Technical Design (Task)    → developer
 *       ├── Code Review (Task)         → reviewer
 *       ├── Unit Testing (Task)        → developer
 *       └── Walkthrough (Task)         → developer
 *
 * No customer-specific custom fields, stakeholder mentions or naming —
 * those belong in a separate "spec kit" overlay.
 */

export interface DevTaskHours {
  ce: number;  // Code Extensions (parent of dev tasks)
  tr: number;  // Technical Review
  td: number;  // Technical Design
  ut: number;  // Unit Testing
  wt: number;  // Walkthrough
  cr: number;  // Code Review (0 = auto = ceil(ce * crPercent / 100), min 1)
}

export interface DevTaskOptions {
  orgUrl: string;          // https://dev.azure.com/<org>
  project: string;         // ADO project name
  authHeader: string;      // precomputed Authorization header (Bearer or Basic)
  parentId: string;        // existing work item ID (e.g. DD)
  developer: string;       // assignee (email or display name) for dev tasks
  reviewer: string;        // assignee for Code Review (defaults to developer)
  hours: DevTaskHours;
  codeReviewPercent?: number; // default 10
  iteration?: string;      // optional override; defaults to project
  ceWorkItemType?: string; // default "Code Extensions" (some orgs use "Task" or "User Story")
  dryRun?: boolean;
}

export interface CreatedItem {
  id: number;
  type: string;
  title: string;
  hours: number;
  assignedTo: string;
  url: string;
}

export interface DevTaskResult {
  ok: boolean;
  parentId: string;
  parentTitle: string;
  created: CreatedItem[];
  skipped: { title: string; existingId: number; reason: string }[];
  failed: { title: string; error: string }[];
  durationSec: number;
}

type LineSink = (line: string) => void;

/**
 * Create dev tasks under a parent work item. All progress lines are
 * emitted via `onLine` so callers can stream them to a VS Code output
 * channel.
 */
export async function createDevTasks(
  opts: DevTaskOptions,
  onLine: LineSink,
): Promise<DevTaskResult> {
  const start = Date.now();
  const result: DevTaskResult = {
    ok: false, parentId: opts.parentId, parentTitle: '',
    created: [], skipped: [], failed: [],
    durationSec: 0,
  };

  const ceType = opts.ceWorkItemType || 'Code Extensions';
  const crPct = opts.codeReviewPercent ?? 10;
  const crHours = opts.hours.cr > 0
    ? opts.hours.cr
    : Math.max(1, Math.ceil(opts.hours.ce * crPct / 100));

  onLine(`=== Parent #${opts.parentId} ===`);

  // 1. Fetch parent
  let parent: WorkItem;
  try {
    parent = await getWorkItem(opts, opts.parentId, true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onLine(`[FAIL] Could not fetch parent #${opts.parentId}: ${msg}`);
    result.failed.push({ title: `Parent #${opts.parentId}`, error: msg });
    result.durationSec = Math.round((Date.now() - start) / 1000);
    return result;
  }
  result.parentTitle = parent.fields['System.Title'] ?? '';
  const parentArea = parent.fields['System.AreaPath'] ?? '';
  const iteration = opts.iteration || parent.fields['System.IterationPath'] || opts.project;

  onLine(`Title : ${result.parentTitle}`);
  onLine(`Area  : ${parentArea}`);
  onLine(`Sprint: ${iteration}`);
  onLine(`Hours : CE=${opts.hours.ce} TR=${opts.hours.tr} TD=${opts.hours.td} CR=${crHours} UT=${opts.hours.ut} WT=${opts.hours.wt}`);
  onLine(`Dev   : ${opts.developer}`);
  onLine(`Review: ${opts.reviewer}`);
  if (opts.dryRun) onLine('*** DRY RUN — no changes will be made ***');

  // 2. Existing children
  const childIds = (parent.relations || [])
    .filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward')
    .map(r => Number(r.url.split('/').pop()))
    .filter(n => !isNaN(n));
  const existingChildren: WorkItem[] = [];
  for (const cid of childIds) {
    try { existingChildren.push(await getWorkItem(opts, String(cid), true)); } catch { /* ignore */ }
  }

  // 3. Code Extensions (parent of dev tasks)
  const titleSuffix = result.parentTitle;
  const ceTitle = `Development: ${titleSuffix}`;

  let ceId: number | undefined;
  const existingCE = existingChildren.find(c => c.fields['System.WorkItemType'] === ceType);
  if (existingCE) {
    ceId = existingCE.id;
    onLine(`[SKIP] ${ceType} already exists: #${ceId}`);
    result.skipped.push({ title: ceTitle, existingId: ceId, reason: `${ceType} already linked` });
  } else {
    const created = await createWorkItem(opts, ceType, {
      'System.Title': ceTitle,
      'System.AreaPath': parentArea,
      'System.IterationPath': iteration,
      'System.AssignedTo': opts.developer,
      'Microsoft.VSTS.Scheduling.OriginalEstimate': opts.hours.ce,
      'Microsoft.VSTS.Scheduling.RemainingWork': opts.hours.ce,
    }, Number(opts.parentId), onLine, result);
    ceId = created?.id;
    if (created) {
      result.created.push({
        id: created.id, type: ceType, title: ceTitle,
        hours: opts.hours.ce, assignedTo: opts.developer,
        url: webUrl(opts, created.id),
      });
    }
  }

  // 4. Technical Review (child of parent)
  const trTitle = `Technical Review: ${titleSuffix}`;
  if (existingChildren.some(c => (c.fields['System.Title'] || '').startsWith('Technical Review:'))) {
    const ex = existingChildren.find(c => (c.fields['System.Title'] || '').startsWith('Technical Review:'))!;
    onLine(`[SKIP] Technical Review already exists: #${ex.id}`);
    result.skipped.push({ title: trTitle, existingId: ex.id, reason: 'Already linked' });
  } else {
    const created = await createWorkItem(opts, 'Task', {
      'System.Title': trTitle,
      'System.AreaPath': parentArea,
      'System.IterationPath': iteration,
      'System.AssignedTo': opts.developer,
      'Microsoft.VSTS.Scheduling.OriginalEstimate': opts.hours.tr,
      'Microsoft.VSTS.Scheduling.RemainingWork': opts.hours.tr,
    }, Number(opts.parentId), onLine, result);
    if (created) {
      result.created.push({
        id: created.id, type: 'Task', title: trTitle,
        hours: opts.hours.tr, assignedTo: opts.developer,
        url: webUrl(opts, created.id),
      });
    }
  }

  // 5. Children under Code Extensions
  if (ceId !== undefined) {
    let ceChildren: WorkItem[] = [];
    if (existingCE && !opts.dryRun) {
      try {
        const refreshed = await getWorkItem(opts, String(ceId), true);
        const ccIds = (refreshed.relations || [])
          .filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward')
          .map(r => Number(r.url.split('/').pop())).filter(n => !isNaN(n));
        for (const id of ccIds) {
          try { ceChildren.push(await getWorkItem(opts, String(id), false)); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }

    const ceTasks = [
      { prefix: 'Technical Design', hours: opts.hours.td, assignTo: opts.developer },
      { prefix: 'Code Review',      hours: crHours,        assignTo: opts.reviewer },
      { prefix: 'Unit Testing',     hours: opts.hours.ut, assignTo: opts.developer },
      { prefix: 'Walkthrough',      hours: opts.hours.wt, assignTo: opts.developer },
    ];

    for (const t of ceTasks) {
      const taskTitle = `${t.prefix}: ${titleSuffix}`;
      const ex = ceChildren.find(c => (c.fields['System.Title'] || '').startsWith(`${t.prefix}:`));
      if (ex) {
        onLine(`[SKIP] ${t.prefix} already exists: #${ex.id}`);
        result.skipped.push({ title: taskTitle, existingId: ex.id, reason: 'Already linked' });
        continue;
      }
      const created = await createWorkItem(opts, 'Task', {
        'System.Title': taskTitle,
        'System.AreaPath': parentArea,
        'System.IterationPath': iteration,
        'System.AssignedTo': t.assignTo,
        'Microsoft.VSTS.Scheduling.OriginalEstimate': t.hours,
        'Microsoft.VSTS.Scheduling.RemainingWork': t.hours,
      }, ceId, onLine, result);
      if (created) {
        result.created.push({
          id: created.id, type: 'Task', title: taskTitle,
          hours: t.hours, assignedTo: t.assignTo,
          url: webUrl(opts, created.id),
        });
      }
    }
  }

  result.ok = result.failed.length === 0;
  result.durationSec = Math.round((Date.now() - start) / 1000);
  onLine('');
  onLine(`Summary: ${result.created.length} created, ${result.skipped.length} skipped, ${result.failed.length} failed (${result.durationSec}s)`);
  return result;
}

// ── ADO REST helpers ──────────────────────────────────────────────────

interface WorkItem {
  id: number;
  fields: Record<string, string>;
  relations?: { rel: string; url: string }[];
  url?: string;
}

function authHeader(opts: DevTaskOptions): string {
  return opts.authHeader;
}

function webUrl(opts: DevTaskOptions, id: number): string {
  const base = opts.orgUrl.replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(opts.project)}/_workitems/edit/${id}`;
}

function getWorkItem(opts: DevTaskOptions, id: string, withRelations: boolean): Promise<WorkItem> {
  const base = opts.orgUrl.replace(/\/+$/, '');
  const expand = withRelations ? '&$expand=relations' : '';
  const u = new URL(`${base}/${encodeURIComponent(opts.project)}/_apis/wit/workitems/${encodeURIComponent(id)}?api-version=7.1${expand}`);
  return restJson<WorkItem>('GET', u, opts, undefined);
}

interface AdoOk { id: number; }

async function createWorkItem(
  opts: DevTaskOptions,
  type: string,
  fields: Record<string, string | number>,
  parentId: number,
  onLine: LineSink,
  result: DevTaskResult,
): Promise<AdoOk | undefined> {
  const title = String(fields['System.Title']);
  if (opts.dryRun) {
    onLine(`[DRY] Would create ${type} : ${title}`);
    return { id: -1 };
  }
  onLine(`[..]  Creating ${type}: ${title}`);
  const base = opts.orgUrl.replace(/\/+$/, '');
  const parentUrl = `${base}/_apis/wit/workItems/${parentId}`;
  const patch: Array<Record<string, unknown>> = Object.entries(fields).map(([k, v]) => ({
    op: 'add', path: `/fields/${k}`, value: v,
  }));
  patch.push({
    op: 'add', path: '/relations/-', value: {
      rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl,
    },
  });
  const u = new URL(`${base}/${encodeURIComponent(opts.project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`);
  try {
    const resp = await restJson<AdoOk>('POST', u, opts, patch, 'application/json-patch+json');
    onLine(`[OK]  Created #${resp.id}: ${title}`);
    return resp;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onLine(`[FAIL] ${title} — ${msg}`);
    result.failed.push({ title, error: msg });
    return undefined;
  }
}

function restJson<T>(
  method: string, url: URL, opts: DevTaskOptions,
  body?: unknown, contentType: string = 'application/json',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
    const headers: Record<string, string | number> = {
      Authorization: authHeader(opts),
      Accept: 'application/json',
    };
    if (data) {
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = data.length;
    }
    const req = https.request({
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers,
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          try { resolve(buf ? JSON.parse(buf) as T : ({} as T)); }
          catch (e) { reject(e); }
        } else {
          let detail = buf;
          try { detail = (JSON.parse(buf).message ?? buf); } catch { /* ignore */ }
          reject(new Error(`HTTP ${status} ${res.statusMessage || ''}: ${detail}`.trim()));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
