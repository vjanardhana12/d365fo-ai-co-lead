import * as vscode from 'vscode';
import * as crypto from 'crypto';

export type IdentityKind = 'Pat' | 'GitHubPat' | 'EntraUser' | 'Other';

export interface Identity {
  id: string;
  displayName: string;
  email: string;
  kind: IdentityKind;
  note?: string;
  /** SecretStorage key holding the PAT. The PAT itself never sits in globalState. */
  secretKey: string;
}

const KEY = 'd365fo.identities';

export class IdentityStore {
  constructor(private ctx: vscode.ExtensionContext) {}

  loadAll(): Identity[] {
    return this.ctx.globalState.get<Identity[]>(KEY, []);
  }

  get(id: string): Identity | undefined {
    return this.loadAll().find(i => i.id === id);
  }

  async upsert(id: Identity, secret?: string): Promise<void> {
    if (secret !== undefined && secret.length > 0) {
      await this.ctx.secrets.store(id.secretKey, secret);
    }
    const all = this.loadAll();
    const idx = all.findIndex(x => x.id === id.id);
    if (idx >= 0) all[idx] = id; else all.push(id);
    await this.ctx.globalState.update(KEY, all);
  }

  async delete(id: string): Promise<void> {
    const item = this.get(id);
    if (item) await this.ctx.secrets.delete(item.secretKey);
    const all = this.loadAll().filter(i => i.id !== id);
    await this.ctx.globalState.update(KEY, all);
  }

  async getSecret(id: string): Promise<string | undefined> {
    const item = this.get(id);
    if (!item) return undefined;
    return this.ctx.secrets.get(item.secretKey);
  }

  newId(): string { return crypto.randomBytes(8).toString('hex'); }
  newSecretKey(): string { return `d365fo.pat.${crypto.randomBytes(8).toString('hex')}`; }
}
