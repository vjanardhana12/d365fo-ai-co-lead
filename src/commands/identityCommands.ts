import * as vscode from 'vscode';
import { Identity, IdentityKind, IdentityStore } from '../services/identityStore';
import { IdentitiesTreeProvider, IdentityItem } from '../views/identitiesTreeProvider';

const PAT_HELP = `Generate a PAT in Azure DevOps:
  Profile (top-right) -> Personal access tokens -> New Token

Recommended scopes (least-privilege):
  - Code: Read & Write
  - Packaging: Read & Write
  - Project and Team: Read
  - Work Items: Read`;

export function registerIdentityCommands(
  ctx: vscode.ExtensionContext,
  store: IdentityStore,
  tree: IdentitiesTreeProvider,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.identities.add', () => editIdentity(undefined)),
    vscode.commands.registerCommand('d365fo.identities.edit', (item: IdentityItem) => editIdentity(item.identity)),
    vscode.commands.registerCommand('d365fo.identities.delete', async (item: IdentityItem) => {
      const ok = await vscode.window.showWarningMessage(`Delete identity '${item.identity.displayName}'? The stored PAT will be removed.`, { modal: true }, 'Delete');
      if (ok === 'Delete') {
        await store.delete(item.identity.id);
        tree.refresh();
      }
    }),
  );

  async function editIdentity(existing: Identity | undefined): Promise<void> {
    const isEdit = !!existing;
    const displayName = await vscode.window.showInputBox({
      title: isEdit ? 'Edit identity - display name' : 'New identity - display name',
      prompt: 'Friendly name shown in pickers',
      value: existing?.displayName ?? '',
      ignoreFocusOut: true,
      validateInput: v => v.trim().length > 0 ? null : 'Display name is required',
    });
    if (!displayName) return;

    const email = await vscode.window.showInputBox({
      title: 'Identity - email',
      prompt: 'Email used for ADO authentication (Basic auth username)',
      value: existing?.email ?? '',
      ignoreFocusOut: true,
      validateInput: v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Enter a valid email',
    });
    if (!email) return;

    const patPrompt = isEdit ? 'PAT (leave blank to keep existing)' : 'PAT (Personal Access Token)';
    const pat = await vscode.window.showInputBox({
      title: `Identity - PAT`,
      prompt: patPrompt,
      password: true,
      ignoreFocusOut: true,
      placeHolder: PAT_HELP.split('\n')[0],
      validateInput: v => isEdit || v.length > 0 ? null : 'PAT is required for new identities',
    });
    if (pat === undefined) return; // user cancelled

    const kindPick = await vscode.window.showQuickPick<vscode.QuickPickItem & { value: IdentityKind }>(
      [
        { label: 'Pat',       description: 'Azure DevOps PAT', value: 'Pat' },
        { label: 'GitHubPat', description: 'GitHub PAT',       value: 'GitHubPat' },
        { label: 'EntraUser', description: 'Entra ID user',    value: 'EntraUser' },
        { label: 'Other',     description: '',                 value: 'Other' },
      ],
      { title: 'Identity kind', placeHolder: 'Select identity type' },
    );
    if (!kindPick) return;

    const note = await vscode.window.showInputBox({
      title: 'Identity - note (optional)',
      prompt: 'Free-form note',
      value: existing?.note ?? '',
      ignoreFocusOut: true,
    });

    const id: Identity = {
      id: existing?.id ?? store.newId(),
      displayName: displayName.trim(),
      email: email.trim(),
      kind: kindPick.value,
      note: note?.trim() || undefined,
      secretKey: existing?.secretKey ?? store.newSecretKey(),
    };
    await store.upsert(id, pat.length > 0 ? pat : undefined);
    tree.refresh();
    vscode.window.showInformationMessage(`Saved identity '${id.displayName}'.`);
  }
}
