import * as vscode from 'vscode';
import { Connection, ConnectionStore, ProjectSpec } from '../services/connectionStore';
import { showForm } from '../views/formWebview';
import { importFromWorkspaceFolder, WorkspaceImport } from '../services/workspaceImporter';
import { normalizeAdoOrgUrl, normalizeSharePointSiteUrl } from '../services/urlNormalizers';
import { testProjectWithAuth, getProfileWithAuth } from '../services/adoClient';
import { signInPreferringEmail, getAdoTokenInteractive, getKnownAccounts } from '../services/microsoftAuth';
import { FieldActionResult } from '../views/formWebview';

export function registerProjectKitCommand(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
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

      // Sign-in is captured inline by the 'Sign in' button on the email field.
      let signedInAccountId: string | undefined;
      let signedInEmail: string | undefined;
      let signedInDisplayName: string | undefined;
      const knownAccounts = await getKnownAccounts();
      const accountSuggestions = knownAccounts.map(a => a.label);

      const sug = imported?.suggested;
      const sp = imported?.spec;

      const result = await showForm(ctx, 'Project Initiation Kit', [
        { key: 'email', label: 'Email', type: 'emailSignIn', required: true,
          value: undefined, placeholder: 'name@company.com',
          actionLabel: 'Sign in',
          suggestions: accountSuggestions,
          help: 'Pick an account VS Code already knows or type a new email, then click Sign in. Browser/system dialog handles password and MFA.' },

        { key: 'name', label: 'Project name', type: 'text', required: true,
          value: sug?.name, placeholder: 'e.g. Alex - Contoso ERP',
          help: 'Friendly label for this project connection - usually "<your name> - <project>".' },

        { key: 'adoOrgUrl', label: 'ADO Organization URL', type: 'text', required: true,
          value: sug?.adoOrgUrl ?? 'https://dev.azure.com/',
          placeholder: 'https://dev.azure.com/<org>',
          help: 'Org URL. If you paste a full URL like https://dev.azure.com/<org>/<project>, the project will be auto-filled.' },
        { key: 'adoProject', label: 'ADO Project', type: 'text', required: true,
          value: sug?.adoProject, placeholder: 'Project name' },
        { key: 'adoProjectSecondary', label: 'Secondary ADO Project (optional)', type: 'text',
          value: undefined, placeholder: 'Sister or admin project in the same org',
          help: 'Optional. A second project in the same org that you also have access to. Tested separately - if the primary passes but the secondary fails, you can still save.' },
        { key: 'sharepointSiteUrl', label: 'SharePoint site URL (optional)', type: 'text',
          value: undefined,
          placeholder: 'https://contoso.sharepoint.com/sites/YourTeam',
          help: 'Optional. Paste any link from the SharePoint site - it will be normalized to the site root. Authenticates with the same Microsoft account.' },
        { key: 'workingFolder', label: 'Working folder (optional)', type: 'folder',
          value: sug?.workingFolder, placeholder: 'e.g. C:\\Work\\Contoso',
          help: 'A scratch / staging folder for this project - design notes, exports, generated files.\nKeep it OUTSIDE your customer git repos to avoid accidentally committing tooling output.' },

        // D365 F&O paths
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
      ], {
        submitLabel: 'Save',
        onFieldAction: async (key, values): Promise<FieldActionResult> => {
          if (key !== 'email') return { level: 'fail', message: `Unknown action: ${key}` };
          const typed = (values.email || '').trim();
          if (!typed) return { level: 'fail', message: 'Type your email address first, then click Sign in.' };
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) return { level: 'fail', message: `Not a valid email address: ${typed}` };
          try {
            const r = await signInPreferringEmail(typed);
            signedInAccountId = r.accountId;
            signedInEmail = r.email;
            try {
              const prof = await getProfileWithAuth(`Bearer ${r.accessToken}`);
              if (prof.ok && prof.displayName) signedInDisplayName = prof.displayName;
            } catch { /* ignore */ }
            const matchesTyped = r.email.toLowerCase() === typed.toLowerCase();
            const who = signedInDisplayName ? `${signedInDisplayName} (${r.email})` : r.email;
            return {
              level: matchesTyped ? 'ok' : 'warn',
              message: matchesTyped ? `Signed in as ${who}.` : `Signed in as ${who} (you typed ${typed}).`,
              fieldUpdates: { email: { value: r.email } },
            };
          } catch (e) {
            return { level: 'fail', message: `Sign-in cancelled or failed: ${(e as Error)?.message ?? e}` };
          }
        },
        onTest: async (values) => {
          const orgParse = normalizeAdoOrgUrl(values.adoOrgUrl);
          const project = (values.adoProject || orgParse.project || '').trim();
          let secondary = (values.adoProjectSecondary || '').trim();
          if (secondary && secondary.toLowerCase() === project.toLowerCase()) secondary = '';
          if (!signedInAccountId) return { ok: false, message: 'Click Sign in next to your email first.' };
          if (!orgParse.orgUrl) return { ok: false, message: 'Missing required field: ADO Org URL.' };
          if (/^https?:\/\/(?:dev\.azure\.com|ssh\.dev\.azure\.com)\/?$/i.test(orgParse.orgUrl)) {
            return { ok: false, message: 'ADO Org URL is missing the organization name. Expected https://dev.azure.com/<org>.' };
          }
          if (!project) return { ok: false, message: 'Missing required field: ADO Project.' };

          let token: string;
          try {
            token = await getAdoTokenInteractive(signedInAccountId, signedInEmail);
          } catch (e) {
            return { ok: false, message: `Could not get an ADO token: ${(e as Error).message ?? e}` };
          }
          const auth = `Bearer ${token}`;

          const r = await testProjectWithAuth(orgParse.orgUrl, project, auth);
          if (!r.ok) {
            const hint = r.status === 401 || r.status === 203
              ? `Your account (${signedInEmail}) does not have access. Confirm the org name and that your account is a member.`
              : `Check Org URL and project name.`;
            return { ok: false, message: `Cannot reach ${project} (HTTP ${r.status} ${r.reason}). ${hint}` };
          }
          if (secondary) {
            const r2 = await testProjectWithAuth(orgParse.orgUrl, secondary, auth);
            if (!r2.ok) {
              return { ok: true, level: 'warn', message: `Primary ${project} verified. Secondary ${secondary} unreachable (HTTP ${r2.status}). You can still save.` };
            }
            return { ok: true, message: `Connected as ${signedInEmail}. Verified access to ${project} and ${secondary}.` };
          }
          return { ok: true, message: `Connected as ${signedInEmail}. Verified access to ${project}.` };
        },
      });
      if (!result) return;
      if (!signedInAccountId || !signedInEmail) {
        vscode.window.showErrorMessage('You must Sign in before saving the project.');
        return;
      }
      if ((result.email || '').trim().toLowerCase() !== signedInEmail.toLowerCase()) {
        vscode.window.showErrorMessage(`Email field (${result.email}) does not match the signed-in account (${signedInEmail}). Click Sign in again with the new email.`);
        return;
      }

      const orgParse = normalizeAdoOrgUrl(result.adoOrgUrl);
      const project = (result.adoProject?.trim() || orgParse.project || '').replace(/^\/+|\/+$/g, '');
      const sharepoint = result.sharepointSiteUrl ? normalizeSharePointSiteUrl(result.sharepointSiteUrl) : '';
      let secondary = result.adoProjectSecondary?.trim() || '';
      if (secondary && secondary.toLowerCase() === project.toLowerCase()) secondary = '';

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
        email: signedInEmail,
        microsoftAccountId: signedInAccountId,
        microsoftAccountLabel: signedInEmail,
        displayName: signedInDisplayName,
        adoOrgUrl: orgParse.orgUrl,
        adoProject: project,
        adoProjectSecondary: secondary || undefined,
        sharepointSiteUrl: sharepoint || undefined,
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
