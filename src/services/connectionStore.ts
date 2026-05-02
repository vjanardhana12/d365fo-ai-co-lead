import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Project-level spec optionally attached to a Connection. Captures the kind
 * of details a dev lead needs in one place: D365 F&O paths/prefix/model,
 * ADO defaults (iteration, reviewer, CE work item type), and an optional
 * "kit" slot for customer-specific overlays (e.g. CB Spec Kit).
 *
 * All fields are optional so existing connections keep working.
 */
export interface ProjectSpec {
  /** Free-form kit identifier — e.g. 'generic' | 'carlsberg'. Drives which kit-specific tiles light up. */
  kit?: string;

  // ── D365 F&O dev box ─────────────────────────────────────────────
  prefix?: string;                  // e.g. CHB
  defaultModel?: string;            // display name with spaces
  defaultPackage?: string;          // package directory name
  packagesLocalDirectory?: string;
  customMetadataDirectory?: string;
  additionalMetadataDirectories?: string[];
  projectsDirectory?: string;
  labelLanguages?: string[];
  repoRoot?: string;                // root checkout folder for source control

  // ── ADO defaults for dev-task creation ───────────────────────────
  iteration?: string;               // sprint / iteration path
  defaultReviewer?: string;         // email/display for Code Review tasks
  ceWorkItemType?: string;          // e.g. "Code Extensions" | "Task" | "User Story"
  codeReviewPercent?: number;       // default 10

  // ── Free-form kit overlay ────────────────────────────────────────
  /** Kit-specific extra payload (e.g. Carlsberg custom fields, stakeholders, etc.) — opaque to the runner. */
  kitData?: Record<string, unknown>;
}

export interface Connection {
  id: string;
  name: string;
  adoOrgUrl: string;
  adoProject: string;
  /** Optional secondary ADO project in the same org (e.g. a sister/admin project). */
  adoProjectSecondary?: string;
  /** ADO email (used as username for Basic auth). Was previously on Identity. */
  email: string;
  /** Microsoft account id captured at sign-in (vscode.authentication 'microsoft' provider). When set, we use Bearer (OAuth) auth instead of PAT. */
  microsoftAccountId?: string;
  /** Display label of the signed-in Microsoft account (typically the UPN/email). Used as a hint when re-acquiring the session silently. */
  microsoftAccountLabel?: string;
  /** Friendly display name of the signed-in user (e.g. "Vinod Kumar K J"), best-effort fetched from the ADO profile endpoint. */
  displayName?: string;
  /** @deprecated kept for migration - use email + patSecretKey on Connection. */
  identityId?: string;
  workingFolder?: string;
  notes?: string;
  lastUsedUtc?: string;
  /** Optional SharePoint site URL (e.g. https://contoso.sharepoint.com/sites/MyTeam). Auth uses VS Code's built-in Microsoft provider — no PAT needed. */
  sharepointSiteUrl?: string;
  /** Per-connection PAT secret key (SecretStorage). Set on save when user provides a PAT. */
  patSecretKey?: string;
  /** Optional project specification — populated by Project Initiation Kit. */
  projectSpec?: ProjectSpec;
  /**
   * Per-kit access cache. Populated by the kit access probe (live ADO check
   * against the kit's owning org). A kit-specific tile renders ONLY if
   * `kitAccess[kit].granted === true`. Probes re-run on dashboard open / set-active.
   */
  kitAccess?: Record<string, { granted: boolean; checkedUtc: string; reason?: string }>;
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

  /** Read this connection's PAT from SecretStorage. */
  async getPat(connId: string): Promise<string | undefined> {
    const c = this.loadAll().find(x => x.id === connId);
    if (!c?.patSecretKey) return undefined;
    return this.ctx.secrets.get(c.patSecretKey);
  }

  /** Store a PAT for this connection (creates a secret key if missing). Returns the conn with patSecretKey populated. */
  async setPat(conn: Connection, pat: string): Promise<Connection> {
    if (!conn.patSecretKey) conn.patSecretKey = `d365fo.conn.pat.${crypto.randomBytes(8).toString('hex')}`;
    await this.ctx.secrets.store(conn.patSecretKey, pat);
    return conn;
  }

  newPatSecretKey(): string { return `d365fo.conn.pat.${crypto.randomBytes(8).toString('hex')}`; }

  newId(): string { return crypto.randomBytes(8).toString('hex'); }

  /**
   * One-time migration: copy email + PAT from old Identity store onto each Connection.
   * Safe to run repeatedly; only acts on connections still using identityId without email/patSecretKey.
   */
  async migrateFromIdentities(legacyIdentities: { id: string; email: string; secretKey: string }[], legacySecrets: vscode.SecretStorage): Promise<number> {
    const all = this.loadAll();
    let migrated = 0;
    for (const c of all) {
      if (c.email && c.patSecretKey) continue; // already migrated
      const legacy = legacyIdentities.find(i => i.id === c.identityId);
      if (!legacy) continue;
      if (!c.email) c.email = legacy.email;
      if (!c.patSecretKey) {
        const oldPat = await legacySecrets.get(legacy.secretKey);
        if (oldPat) {
          c.patSecretKey = this.newPatSecretKey();
          await this.ctx.secrets.store(c.patSecretKey, oldPat);
        }
      }
      migrated++;
    }
    if (migrated > 0) {
      void this.storage().update(KEY, all);
    }
    return migrated;
  }

  private storage(): vscode.Memento {
    const mode = vscode.workspace.getConfiguration('d365fo').get<string>('storageMode', 'global');
    return mode === 'workspace' ? this.ctx.workspaceState : this.ctx.globalState;
  }
}
