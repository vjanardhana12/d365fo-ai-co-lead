import * as vscode from 'vscode';
import { Identity, IdentityStore } from '../services/identityStore';
import { IdentitiesTreeProvider, IdentityItem } from '../views/identitiesTreeProvider';
import { showForm } from '../views/formWebview';
import { validatePat } from '../services/adoClient';

export function registerIdentityCommands(
  ctx: vscode.ExtensionContext,
  store: IdentityStore,
  tree: IdentitiesTreeProvider,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.identities.add', () => editIdentity(undefined)),
    vscode.commands.registerCommand('d365fo.identities.edit', (item: IdentityItem) => editIdentity(item.identity)),
    vscode.commands.registerCommand('d365fo.identities.delete', async (item: IdentityItem) => {
      const ok = await vscode.window.showWarningMessage(
        `Delete identity '${item.identity.displayName}'? The stored PAT will be removed.`,
        { modal: true }, 'Delete',
      );
      if (ok === 'Delete') {
        await store.delete(item.identity.id);
        tree.refresh();
        vscode.commands.executeCommand('d365fo.dashboard.refresh');
      }
    }),
    vscode.commands.registerCommand('d365fo.identities.openPatPage', async () => {
      const org = await vscode.window.showInputBox({
        title: 'Open ADO PAT page',
        prompt: 'ADO organization name or full URL',
        placeHolder: 'e.g. contoso  or  https://dev.azure.com/contoso',
        ignoreFocusOut: true,
        validateInput: v => v.trim().length === 0 ? 'Required' : null,
      });
      if (!org) return;
      let url: string;
      const trimmed = org.trim().replace(/\/+$/, '');
      if (/^https?:\/\//i.test(trimmed)) {
        url = `${trimmed}/_usersSettings/tokens`;
      } else {
        url = `https://dev.azure.com/${encodeURIComponent(trimmed)}/_usersSettings/tokens`;
      }
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  async function editIdentity(existing: Identity | undefined): Promise<void> {
    const isEdit = !!existing;
    const result = await showForm(
      ctx,
      isEdit ? `Edit identity - ${existing!.displayName}` : 'New identity',
      [
        { key: 'displayName', label: 'Display name', type: 'text', required: true,
          value: existing?.displayName, placeholder: 'e.g. ADO Work, ADO Customer A',
          help: 'A friendly name to identify this credential. Use one identity per ADO org / customer.' },
        { key: 'email', label: 'Email', type: 'email', required: true,
          value: existing?.email, placeholder: 'name@company.com',
          help: 'Used as the username for ADO Basic auth.' },
        { key: 'pat', label: 'ADO PAT (Personal Access Token)', type: 'password',
          required: !isEdit,
          placeholder: isEdit ? 'Leave blank to keep existing PAT' : 'Paste your token',
          help: 'A PAT only authenticates as you - it cannot grant ADO permissions you do not have.\n\n' +
            'Recommended scopes by role (set in ADO when generating the PAT):\n' +
            '- All roles: Code R/W, Work Items R/W & Manage, Project & Team Read, User Profile Read\n' +
            '- Functional: + Test Management Read\n' +
            '- Tester: + Test Management R/W\n' +
            '- Developer: + Build Read, Release Read, Packaging Read\n' +
            '- Dev Lead (this extension): + Build R & Execute, Release R/W & Execute, Packaging R/W (NuGet Sync needs this), Code Full\n\n' +
            'Tip: run "D365FO: Open ADO PAT Page" from the Command Palette to jump straight to your ADO PAT generator. Stored encrypted via VS Code SecretStorage.' },
        { key: 'note', label: 'Note (optional)', type: 'textarea',
          value: existing?.note, placeholder: 'Free-form note' },
      ],
      isEdit ? 'Update' : 'Save identity',
    );
    if (!result) return;

    // Validate PAT against ADO when supplied
    if (result.pat && result.pat.length > 0) {
      const v = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Validating PAT...' },
        () => validatePat(result.email.trim(), result.pat),
      );
      if (!v.ok) {
        const choice = await vscode.window.showErrorMessage(
          `PAT validation failed (HTTP ${v.status} ${v.reason}). Save anyway?`,
          'Save anyway', 'Cancel',
        );
        if (choice !== 'Save anyway') return;
      } else {
        vscode.window.showInformationMessage(`PAT validated for ${v.displayName ?? v.emailAddress ?? result.email}.`);
      }
    }

    const id: Identity = {
      id: existing?.id ?? store.newId(),
      displayName: result.displayName.trim(),
      email: result.email.trim(),
      kind: existing?.kind ?? 'Pat',
      note: result.note.trim() || undefined,
      secretKey: existing?.secretKey ?? store.newSecretKey(),
    };
    await store.upsert(id, result.pat.length > 0 ? result.pat : undefined);
    tree.refresh();
    vscode.commands.executeCommand('d365fo.dashboard.refresh');
    vscode.window.showInformationMessage(`Saved identity '${id.displayName}'.`);
  }
}