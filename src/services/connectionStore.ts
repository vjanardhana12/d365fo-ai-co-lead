import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface Connection {
  id: string;
  name: string;
  adoOrgUrl: string;
  adoProject: string;
  identityId: string;
  workingFolder?: string;
  notes?: string;
  lastUsedUtc?: string;
}

const KEY = 'd365fo.connections';
const ACTIVE_KEY = 'd365fo.activeConnectionId';

export class ConnectionStore {
  constructor(private ctx: vscode.ExtensionContext) {}

  loadAll(): Connection[] {
    return this.storage().get<Connection[]>(KEY, []);
  }

  getActive(): Connection | undefined {
    const id = this.storage().get<string>(ACTIVE_KEY);
    if (!id) return undefined;
    return this.loadAll().find(c => c.id === id);
  }

  setActive(id: string): void {
    void this.storage().update(ACTIVE_KEY, id);
  }

  upsert(conn: Connection): void {
    const all = this.loadAll();
    const idx = all.findIndex(c => c.id === conn.id);
    if (idx >= 0) all[idx] = conn; else all.push(conn);
    void this.storage().update(KEY, all);
    if (!this.storage().get<string>(ACTIVE_KEY)) this.setActive(conn.id);
  }

  delete(id: string): void {
    const all = this.loadAll().filter(c => c.id !== id);
    void this.storage().update(KEY, all);
    if (this.storage().get<string>(ACTIVE_KEY) === id) {
      void this.storage().update(ACTIVE_KEY, all[0]?.id);
    }
  }

  newId(): string { return crypto.randomBytes(8).toString('hex'); }

  private storage(): vscode.Memento {
    const mode = vscode.workspace.getConfiguration('d365fo').get<string>('storageMode', 'global');
    return mode === 'workspace' ? this.ctx.workspaceState : this.ctx.globalState;
  }
}
