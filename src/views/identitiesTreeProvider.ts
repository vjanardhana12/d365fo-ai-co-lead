import * as vscode from 'vscode';
import { Identity, IdentityStore } from '../services/identityStore';

export class IdentitiesTreeProvider implements vscode.TreeDataProvider<IdentityItem> {
  private _onDidChange = new vscode.EventEmitter<IdentityItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private store: IdentityStore) {}

  refresh(): void { this._onDidChange.fire(); }

  getTreeItem(item: IdentityItem): vscode.TreeItem { return item; }

  getChildren(): IdentityItem[] {
    const all = this.store.loadAll();
    if (all.length === 0) {
      const empty = new vscode.TreeItem('No identities - click + to add', vscode.TreeItemCollapsibleState.None);
      empty.command = { command: 'd365fo.identities.add', title: 'Add' };
      return [empty as IdentityItem];
    }
    return all.map(i => new IdentityItem(i));
  }
}

export class IdentityItem extends vscode.TreeItem {
  constructor(public readonly identity: Identity) {
    super(identity.displayName, vscode.TreeItemCollapsibleState.None);
    this.description = identity.email;
    this.tooltip = `${identity.displayName} <${identity.email}>\nKind: ${identity.kind}${identity.note ? `\n${identity.note}` : ''}`;
    this.contextValue = 'identity';
    this.iconPath = new vscode.ThemeIcon('account');
  }
}
