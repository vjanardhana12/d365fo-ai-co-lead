import * as vscode from 'vscode';
import { Connection, ConnectionStore } from '../services/connectionStore';
import { ConnectionsTreeProvider, ConnectionItem } from '../views/connectionsTreeProvider';
import { testProjectWithAuth, probeOrgAccessWithAuth, getProfileWithAuth } from '../services/adoClient';
import { showForm, FieldActionResult } from '../views/formWebview';
import { normalizeAdoOrgUrl, normalizeSharePointSiteUrl } from '../services/urlNormalizers';
import { signInPreferringEmail, getAdoTokenInteractive, getKnownAccounts } from '../services/microsoftAuth';

export function registerConnectionCommands(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
  tree: ConnectionsTreeProvider,
  refreshStatus: () => void,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.connections.add', () => editConnection(undefined)),
    vscode.commands.registerCommand('d365fo.connections.edit', (item: ConnectionItem | { connection: Connection }) => editConnection(item.connection)),
    vscode.commands.registerCommand('d365fo.connections.delete', async (item: ConnectionItem) => {
      const ok = await vscode.window.showWarningMessage(
        `Delete connection '${item.connection.name}'?`, { modal: true }, 'Delete',
      );
      if (ok === 'Delete') {
        if (item.connection.patSecretKey) await ctx.secrets.delete(item.connection.patSecretKey);
        connections.delete(item.connection.id);
        tree.refresh();
        refreshStatus();
        vscode.commands.executeCommand('d365fo.dashboard.refresh');
      }
    }),
    vscode.commands.registerCommand('d365fo.connections.setActive', (item: ConnectionItem) => {
      connections.setActive(item.connection.id);
      tree.refresh();
      refreshStatus();
      vscode.commands.executeCommand('d365fo.dashboard.refresh');
      vscode.window.setStatusBarMessage(`Active: ${item.connection.name}`, 3000);
    }),
    vscode.commands.registerCommand('d365fo.connections.test', async (item?: ConnectionItem) => {
      const conn = item?.connection ?? connections.getActive();
      if (!conn) { vscode.window.showWarningMessage('No connection selected.'); return; }
      if (!conn.microsoftAccountId) { vscode.window.showWarningMessage('Connection is not signed in. Edit it and click Sign in.'); return; }
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Testing ${conn.name}...` },
        async () => {
          const token = await getAdoTokenInteractive(conn.microsoftAccountId, conn.microsoftAccountLabel);
          return testProjectWithAuth(conn.adoOrgUrl, conn.adoProject, `Bearer ${token}`);
        },
      );
      if (result.ok) {
        vscode.window.showInformationMessage(`Connection successful.`);
      } else {
        vscode.window.showErrorMessage(`Connection failed: HTTP ${result.status} ${result.reason}. Check Org URL and Project name (or your account's access).`);
      }
    }),
    vscode.commands.registerCommand('d365fo.connections.openPatPage', async () => {
      const active = connections.getActive();
      const defaultOrg = active?.adoOrgUrl ?? 'https://dev.azure.com/';
      const org = await vscode.window.showInputBox({
        title: 'Open ADO PAT page',
        prompt: 'ADO organization name or full URL (PAT only needed for NuGet Sync; everything else uses Sign in)',
        value: defaultOrg,
        placeHolder: 'e.g. contoso  or  https://dev.azure.com/contoso',
        ignoreFocusOut: true,
        validateInput: v => v.trim().length === 0 ? 'Required' : null,
      });
      if (!org) return;
      const trimmed = org.trim().replace(/\/+$/, '');
      const url = /^https?:\/\//i.test(trimmed) ? `${trimmed}/_usersSettings/tokens` : `https://dev.azure.com/${encodeURIComponent(trimmed)}/_usersSettings/tokens`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  async function editConnection(existing: Connection | undefined): Promise<void> {
    const isEdit = !!existing;

    // Sign-in state captured by the inline 'Sign in' button on the form.
    let signedInAccountId: string | undefined = existing?.microsoftAccountId;
    let signedInEmail: string | undefined = existing?.microsoftAccountLabel ?? existing?.email;
    let signedInDisplayName: string | undefined = existing?.displayName;

    // Suggest accounts that VS Code already knows about.
    const knownAccounts = await getKnownAccounts();
    const suggestions = Array.from(new Set([
      ...(signedInEmail ? [signedInEmail] : []),
      ...knownAccounts.map(a => a.label),
    ]));

    const result = await showForm(
      ctx,
      isEdit ? `Edit project connection - ${existing!.name}` : 'New project connection',
      [
        { key: 'email', label: 'Email', type: 'emailSignIn', required: true,
          value: signedInEmail, placeholder: 'name@company.com',
          actionLabel: signedInAccountId ? 'Re-sign in' : 'Sign in',
          suggestions,
          help: 'Pick an account VS Code already knows or type a new email, then click Sign in. Sign-in uses your browser/system dialog for password and MFA.' },
        { key: 'name', label: 'Connection name', type: 'text', required: true,
          value: existing?.name, placeholder: 'e.g. Alex - Contoso ERP',
          help: 'Friendly label - usually combines your name + the project, e.g. "Alex - Contoso ERP".' },
        { key: 'adoOrgUrl', label: 'ADO Organization URL', type: 'text', required: true,
          value: existing?.adoOrgUrl ?? 'https://dev.azure.com/',
          placeholder: 'https://dev.azure.com/<org>',
          help: 'Org URL. If you paste a full URL like https://dev.azure.com/<org>/<project>, the project will be auto-filled.' },
        { key: 'adoProject', label: 'ADO Project', type: 'text', required: true,
          value: existing?.adoProject, placeholder: 'Project name' },
        { key: 'adoProjectSecondary', label: 'Secondary ADO Project (optional)', type: 'text',
          value: existing?.adoProjectSecondary, placeholder: 'Sister or admin project in the same org',
          help: 'Optional. A second project in the same org that you also have access to. Tested separately - if the primary passes but the secondary fails, you can still save.' },
        { key: 'sharepointSiteUrl', label: 'SharePoint site URL (optional)', type: 'text',
          value: existing?.sharepointSiteUrl,
          placeholder: 'https://contoso.sharepoint.com/sites/YourTeam',
          help: 'Optional. Paste any link from the SharePoint site - it will be normalized to the site root. Authenticates with the same Microsoft account.' },
        { key: 'workingFolder', label: 'Working folder (optional)', type: 'folder',
          value: existing?.workingFolder, placeholder: 'e.g. C:\\Work\\Contoso',
          help: 'A scratch / staging folder for this connection - design notes, exports, generated files.\nKeep it OUTSIDE your customer git repos to avoid accidentally committing tooling output.' },
        { key: 'notes', label: 'Notes (optional)', type: 'textarea',
          value: existing?.notes },
      ],
      {
        submitLabel: isEdit ? 'Update' : 'Save',
        onFieldAction: async (key, values): Promise<FieldActionResult> => {
          if (key !== 'email') return { level: 'fail', message: `Unknown action: ${key}` };
          const typed = (values.email || '').trim();
          if (!typed) return { level: 'fail', message: 'Type your email address first, then click Sign in.' };
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) return { level: 'fail', message: `Not a valid email address: ${typed}` };
          try {
            const r = await signInPreferringEmail(typed);
            signedInAccountId = r.accountId;
            signedInEmail = r.email;
            // Best-effort: fetch displayName from ADO profile (Bearer has the right claims).
            try {
              const prof = await getProfileWithAuth(`Bearer ${r.accessToken}`);
              if (prof.ok && prof.displayName) signedInDisplayName = prof.displayName;
            } catch { /* ignore - keep undefined */ }
            const matchesTyped = r.email.toLowerCase() === typed.toLowerCase();
            const who = signedInDisplayName ? `${signedInDisplayName} (${r.email})` : r.email;
            return {
              level: matchesTyped ? 'ok' : 'warn',
              message: matchesTyped
                ? `Signed in as ${who}.`
                : `Signed in as ${who} (you typed ${typed}). Using ${r.email} to authenticate.`,
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

          // 1. Probe org-level access first. This separates "wrong org / no access"
          //    from "wrong project". 203/302/401/403 all mean ADO refused the token.
          const orgProbe = await probeOrgAccessWithAuth(orgParse.orgUrl, auth);
          const isAuthFailure = (s: number) => s === 203 || s === 302 || s === 401 || s === 403;
          if (!orgProbe.ok) {
            if (isAuthFailure(orgProbe.status)) {
              return { ok: false, message: `Account ${signedInEmail} cannot access ${orgParse.orgUrl} (HTTP ${orgProbe.status}). Confirm the org name is correct AND that this account is a member of the organization.` };
            }
            if (orgProbe.status === 404 || orgProbe.status === 0) {
              return { ok: false, message: `Cannot reach ${orgParse.orgUrl} (HTTP ${orgProbe.status} ${orgProbe.reason}). Check the Org URL.` };
            }
            return { ok: false, message: `Org check failed: HTTP ${orgProbe.status} ${orgProbe.reason}.` };
          }

          // 2. Org is reachable - now check the project.
          const r = await testProjectWithAuth(orgParse.orgUrl, project, auth);
          if (!r.ok) {
            if (isAuthFailure(r.status)) {
              return { ok: false, message: `Account ${signedInEmail} has org access but cannot read project ${project} (HTTP ${r.status}). You may not be a member of this project.` };
            }
            if (r.status === 404) {
              return { ok: false, message: `Project ${project} not found in ${orgParse.orgUrl}. Check the spelling.` };
            }
            return { ok: false, message: `Cannot reach ${project}: HTTP ${r.status} ${r.reason}.` };
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
      },
    );
    if (!result) return;

    if (!signedInAccountId || !signedInEmail) {
      vscode.window.showErrorMessage('You must Sign in before saving the connection.');
      return;
    }
    if ((result.email || '').trim().toLowerCase() !== signedInEmail.toLowerCase()) {
      vscode.window.showErrorMessage(`Email field (${result.email}) does not match the signed-in account (${signedInEmail}). Click Sign in again with the new email.`);
      return;
    }

    const orgParse = normalizeAdoOrgUrl(result.adoOrgUrl);
    if (!/^https?:\/\/.+/.test(orgParse.orgUrl)) {
      vscode.window.showErrorMessage('ADO Org URL must start with https://');
      return;
    }
    const project = (result.adoProject?.trim() || orgParse.project || '').replace(/^\/+|\/+$/g, '');
    const sharepoint = result.sharepointSiteUrl ? normalizeSharePointSiteUrl(result.sharepointSiteUrl) : '';
    let secondary = result.adoProjectSecondary?.trim() || '';
    if (secondary && secondary.toLowerCase() === project.toLowerCase()) secondary = '';

    const conn: Connection = {
      id: existing?.id ?? connections.newId(),
      name: result.name.trim(),
      email: signedInEmail,
      microsoftAccountId: signedInAccountId,
      microsoftAccountLabel: signedInEmail,
      displayName: signedInDisplayName,
      adoOrgUrl: orgParse.orgUrl,
      adoProject: project,
      adoProjectSecondary: secondary || undefined,
      sharepointSiteUrl: sharepoint || undefined,
      patSecretKey: existing?.patSecretKey,  // preserved (used only by NuGet sync today)
      workingFolder: result.workingFolder?.trim() || undefined,
      notes: result.notes?.trim() || undefined,
      lastUsedUtc: new Date().toISOString(),
      projectSpec: existing?.projectSpec,
      kitAccess: existing?.kitAccess,
    };

    connections.upsert(conn);
    tree.refresh();
    refreshStatus();
    vscode.commands.executeCommand('d365fo.dashboard.refresh');
    vscode.window.showInformationMessage(`Saved project connection '${conn.name}' (signed in as ${signedInEmail}).`);
  }
}
