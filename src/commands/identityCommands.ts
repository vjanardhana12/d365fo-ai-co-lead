import * as vscode from 'vscode';
import { Identity, IdentityKind, IdentityStore } from '../services/identityStore';
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
  );

  async function editIdentity(existing: Identity | undefined): Promise<void> {
    const isEdit = !!existing;
    const result = await showForm(
      ctx,
      isEdit ? `Edit identity - ${existing!.displayName}` : 'New identity',
      [
        { key: 'displayName', label: 'Display name', type: 'text', required: true,
          value: existing?.displayName, placeholder: 'e.g. Vinod (work)' },
        { key: 'email', label: 'Email', type: 'email', required: true,
          value: existing?.email, placeholder: 'name@company.com',
          help: 'Used as the username for ADO Basic auth.' },
        { key: 'kind', label: 'Identity kind', type: 'select', required: true,
          value: existing?.kind ?? 'Pat',
          options: [
            { value: 'Pat', label: 'Pat', description: 'Azure DevOps PAT' },
            { value: 'GitHubPat', label: 'GitHubPat', description: 'GitHub PAT' },
            { value: 'EntraUser', label: 'EntraUser', description: 'Entra ID user' },
            { value: 'Other', label: 'Other' },
          ]},
        { key: 'pat', label: 'PAT (Personal Access Token)', type: 'password',
          required: !isEdit,
          placeholder: isEdit ? 'Leave blank to keep existing PAT' : 'Paste your token',
          help: 'Stored encrypted via VS Code SecretStorage. Recommended ADO scopes: Code R/W, Packaging R/W, Project Read, Work Items Read.' },
        { key: 'note', label: 'Note (optional)', type: 'textarea',
          value: existing?.note, placeholder: 'Free-form note' },
      ],
      isEdit ? 'Update' : 'Save identity',
    );
    if (!result) return;

    // Validate PAT against ADO (only for Pat kind, only when a PAT was supplied)
    if (result.kind === 'Pat' && result.pat && result.pat.length > 0) {
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
      kind: result.kind as IdentityKind,
      note: result.note.trim() || undefined,
      secretKey: existing?.secretKey ?? store.newSecretKey(),
    };
    await store.upsert(id, result.pat.length > 0 ? result.pat : undefined);
    tree.refresh();
    vscode.commands.executeCommand('d365fo.dashboard.refresh');
    vscode.window.showInformationMessage(`Saved identity '${id.displayName}'.`);
  }
}