import * as vscode from 'vscode';
import { Connection, ConnectionStore } from '../services/connectionStore';

export class ConnectionsTreeProvider implements vscode.TreeDataProvider<ConnectionItem> {
  private _onDidChange = new vscode.EventEmitter<ConnectionItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private store: ConnectionStore) {}

  refresh(): void { this._onDidChange.fire(); }

  getTreeItem(item: ConnectionItem): vscode.TreeItem { return item; }

  getChildren(): ConnectionItem[] {
    const all = this.store.loadAll();
    if (all.length === 0) {
      const empty = new vscode.TreeItem('No connections - click + to add', vscode.TreeItemCollapsibleState.None);
      empty.command = { command: 'd365fo.connections.add', title: 'Add' };
      return [empty as ConnectionItem];
    }
    const activeId = this.store.getActive()?.id;
    return all.map(c => new ConnectionItem(c, c.id === activeId));
  }
}

export class ConnectionItem extends vscode.TreeItem {
  constructor(public readonly connection: Connection, isActive: boolean) {
    super(`${isActive ? '$(star-full) ' : ''}${connection.name}`, vscode.TreeItemCollapsibleState.None);
    this.description = connection.adoProject;
    this.tooltip = `${connection.name}\n${connection.adoOrgUrl}/${connection.adoProject}\nIdentity: ${connection.identityId || '(none)'}`;
    this.contextValue = 'connection';
    this.iconPath = new vscode.ThemeIcon(isActive ? 'star-full' : 'plug');
  }
}
