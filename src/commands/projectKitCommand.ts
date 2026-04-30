import * as vscode from 'vscode';
import { Connection, ConnectionStore, ProjectSpec } from '../services/connectionStore';
import { IdentityStore } from '../services/identityStore';
import { showForm } from '../views/formWebview';
import { importFromWorkspaceFolder, WorkspaceImport } from '../services/workspaceImporter';

export function registerProjectKitCommand(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  identities: IdentityStore,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.projectKit.init', async () => {
      // Step 1: optional "Import from folder" — lets the user pre-fill from
      // a DevWorkspace-style folder (ado-config.json + d365fo-mcp.json).
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Import from folder', detail: 'Pre-fill from ado-config.json + d365fo-mcp.json in a folder', kind: 'import' } as any,
          { label: 'Start blank',        detail: 'Enter all fields manually',                                  kind: 'blank' } as any,
        ],
        { placeHolder: 'How do you want to create this project connection?' },
      ) as ({ kind: 'import' | 'blank' } | undefined);
      if (!choice) return;

      let imported: WorkspaceImport | undefined;
      if (choice.kind === 'import') {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
          openLabel: 'Select workspace folder',
        });
        if (!picked || !picked[0]) return;
        imported = importFromWorkspaceFolder(picked[0].fsPath);
        if (imported.found.length === 0) {
          const ok = await vscode.window.showWarningMessage(
            `No config files found in ${picked[0].fsPath}. Continue with blank form?`,
            { modal: true }, 'Continue',
          );
          if (ok !== 'Continue') return;
        }
      }

      // Identity must exist
      if (identities.loadAll().length === 0) {
        const ok = await vscode.window.showWarningMessage(
          'You need an identity first.', { modal: true }, 'Add identity',
        );
        if (ok !== 'Add identity') return;
        await vscode.commands.executeCommand('d365fo.identities.add');
        if (identities.loadAll().length === 0) return;
      }
      const idOptions = identities.loadAll().map(i => ({ value: i.id, label: i.displayName, description: i.email }));

      const sug = imported?.suggested;
      const sp = imported?.spec;

      const result = await showForm(ctx, 'Project Initiation Kit', [
        // ── Identity / connection ────────────────────────────────────
        { key: 'name', label: 'Project name', type: 'text', required: true,
          value: sug?.name, placeholder: 'e.g. My Project HUB',
          help: 'Display name for this project connection.' },

        { key: 'identityId', label: 'Identity', type: 'select', required: true,
          value: idOptions[0]?.value, options: idOptions,
          help: 'ADO PAT-bearing identity used for API calls.' },
        { key: 'adoOrgUrl', label: 'ADO Organization URL', type: 'text', required: true,
          value: sug?.adoOrgUrl ?? 'https://dev.azure.com/',
          placeholder: 'https://dev.azure.com/<org>' },
        { key: 'adoProject', label: 'ADO Project', type: 'text', required: true,
          value: sug?.adoProject, placeholder: 'Project name' },
        { key: 'workingFolder', label: 'Working folder', type: 'folder',
          value: sug?.workingFolder, placeholder: 'e.g. D:\\Repos\\YourProject' },

        // ── D365 F&O paths ───────────────────────────────────────────
        { key: 'prefix', label: 'Prefix (object name prefix)', type: 'text',
          value: sp?.prefix, placeholder: 'e.g. CHB' },
        { key: 'defaultModel', label: 'Default model (display name)', type: 'text',
          value: sp?.defaultModel, placeholder: 'e.g. My Project Model' },
        { key: 'defaultPackage', label: 'Default package (folder name)', type: 'text',
          value: sp?.defaultPackage, placeholder: 'e.g. MyProjectPackage' },
        { key: 'packagesLocalDirectory', label: 'PackagesLocalDirectory', type: 'folder',
          value: sp?.packagesLocalDirectory },
        { key: 'customMetadataDirectory', label: 'CustomMetadataDirectory (primary repo metadata)', type: 'folder',
          value: sp?.customMetadataDirectory },
        { key: 'additionalMetadataDirectories', label: 'Additional metadata directories (one per line)', type: 'textarea',
          value: (sp?.additionalMetadataDirectories ?? []).join('\n') },
        { key: 'projectsDirectory', label: 'ProjectsDirectory (VS .rnrproj location)', type: 'folder',
          value: sp?.projectsDirectory },
        { key: 'labelLanguages', label: 'Label languages (comma separated)', type: 'text',
          value: (sp?.labelLanguages ?? ['en-US']).join(', ') },
        { key: 'repoRoot', label: 'Repo root', type: 'folder',
          value: sp?.repoRoot, help: 'Top-level git checkout for source control operations.' },

        // ── ADO defaults for dev tasks ───────────────────────────────
        { key: 'iteration', label: 'Iteration (default sprint path)', type: 'text',
          value: sp?.iteration ?? sug?.adoProject ?? '' },
        { key: 'defaultReviewer', label: 'Default reviewer (Code Review tasks)', type: 'text',
          value: sp?.defaultReviewer, placeholder: 'lead@your-org.com' },
        { key: 'ceWorkItemType', label: 'CE work item type', type: 'text',
          value: sp?.ceWorkItemType ?? 'Code Extensions' },
        { key: 'codeReviewPercent', label: 'Code Review % of CE (auto-calc default)', type: 'text',
          value: String(sp?.codeReviewPercent ?? 10) },
      ], 'Save project connection');
      if (!result) return;

      // Build ProjectSpec. The `kit` field is intentionally NOT collected
      // from the user — customer-specific kit tiles are gated by a live ADO
      // access probe (see kitAccessProbe.ts). We carry forward any kit value
      // detected during workspace import so existing CB workspaces still work.
      const spec: ProjectSpec = {
        kit: imported?.spec.kit,
        prefix: nz(result.prefix),
        defaultModel: nz(result.defaultModel),
        defaultPackage: nz(result.defaultPackage),
        packagesLocalDirectory: nz(result.packagesLocalDirectory),
        customMetadataDirectory: nz(result.customMetadataDirectory),
        additionalMetadataDirectories: splitLines(result.additionalMetadataDirectories),
        projectsDirectory: nz(result.projectsDirectory),
        labelLanguages: splitCsv(result.labelLanguages),
        repoRoot: nz(result.repoRoot),
        iteration: nz(result.iteration),
        defaultReviewer: nz(result.defaultReviewer),
        ceWorkItemType: nz(result.ceWorkItemType) ?? 'Code Extensions',
        codeReviewPercent: numOr(result.codeReviewPercent, 10),
        kitData: imported?.spec.kitData,  // preserve any kit overlay from import
      };

      const conn: Connection = {
        id: connections.newId(),
        name: result.name.trim(),
        adoOrgUrl: result.adoOrgUrl.trim().replace(/\/+$/, ''),
        adoProject: result.adoProject.trim().replace(/^\/+|\/+$/g, ''),
        identityId: result.identityId,
        workingFolder: nz(result.workingFolder),
        notes: undefined,
        lastUsedUtc: new Date().toISOString(),
        projectSpec: spec,
      };
      connections.upsert(conn);
      connections.setActive(conn.id);

      vscode.commands.executeCommand('d365fo.dashboard.refresh');
      vscode.commands.executeCommand('d365fo.refresh');

      const importedNote = imported && imported.found.length > 0
        ? ` (imported from ${imported.found.length} file${imported.found.length === 1 ? '' : 's'})`
        : '';
      vscode.window.showInformationMessage(`Project '${conn.name}' created${importedNote}.`);
    }),
  );
}

function nz(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}
function splitLines(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const arr = s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}
function splitCsv(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const arr = s.split(',').map(x => x.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}
function numOr(s: string | undefined, def: number): number {
  const n = parseInt(s ?? '', 10);
  return isNaN(n) ? def : n;
}
