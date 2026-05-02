import { ConnectionStore } from './connectionStore';
import { probeOrgAccessWithAuth } from './adoClient';
import { getAdoTokenSilent } from './microsoftAuth';

/**
 * Kit access gate.
 *
 * A kit-specific tile (e.g. CB Spec Kit) is only ever shown if the user's
 * connection identity has live read access to the kit's owning ADO org.
 * The probe runs against ADO and the result is cached on the Connection
 * record under `kitAccess[kit] = { granted, checkedUtc, reason }`.
 *
 * Outside MS / outside the customer org → probe fails → tile hidden.
 * No setting toggles, no manual opt-in.
 */

interface KitDefinition {
  id: string;
  /** ADO organization URL whose read access proves entitlement to this kit. */
  orgUrl: string;
}

/**
 * Registered kits. To add a new customer kit later: add a new entry here.
 * The kit id matches the existing `projectSpec.kit` and `kitData[kit]` keys.
 */
const KITS: KitDefinition[] = [
  { id: 'carlsberg', orgUrl: 'https://dev.azure.com/carlsberggroup' },
];

const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // re-probe after 6h

/**
 * Re-probe kit access for the active connection. Designed to be called from
 * the dashboard render path, fire-and-forget (returns true if anything
 * changed and the dashboard should re-render).
 *
 * Skipped for connections that have no identity / no PAT — granted defaults
 * to false in that case.
 */
export async function refreshKitAccessForActive(
  connections: ConnectionStore,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const conn = connections.getActive();
  if (!conn) return false;

  if (!conn.microsoftAccountId) {
    return persistAllDenied(connections, conn);
  }
  const token = await getAdoTokenSilent(conn.microsoftAccountId, conn.microsoftAccountLabel);
  if (!token) {
    return persistAllDenied(connections, conn);
  }
  const auth = `Bearer ${token}`;

  const access = { ...(conn.kitAccess ?? {}) };
  const nowMs = Date.now();
  let changed = false;

  for (const kit of KITS) {
    const cached = access[kit.id];
    const cachedAgeMs = cached ? nowMs - new Date(cached.checkedUtc).getTime() : Number.POSITIVE_INFINITY;
    if (!options.force && cached && cachedAgeMs < STALE_AFTER_MS) {
      continue; // recent enough, skip network call
    }

    const result = await probeOrgAccessWithAuth(kit.orgUrl, auth);
    const next = {
      granted: result.ok,
      checkedUtc: new Date().toISOString(),
      reason: result.ok ? undefined : `HTTP ${result.status} ${result.reason}`.trim(),
    };
    if (!cached || cached.granted !== next.granted) changed = true;
    access[kit.id] = next;
  }

  if (changed) {
    connections.upsert({ ...conn, kitAccess: access });
  }
  return changed;
}

function persistAllDenied(connections: ConnectionStore, conn: { id: string; kitAccess?: Record<string, { granted: boolean; checkedUtc: string; reason?: string }> }): boolean {
  const access = { ...(conn.kitAccess ?? {}) };
  const nowIso = new Date().toISOString();
  let changed = false;
  for (const kit of KITS) {
    if (!access[kit.id] || access[kit.id].granted) {
      access[kit.id] = { granted: false, checkedUtc: nowIso, reason: 'Not signed in for this connection' };
      changed = true;
    }
  }
  if (changed) {
    const full = (connections.loadAll().find(c => c.id === conn.id))!;
    connections.upsert({ ...full, kitAccess: access });
  }
  return changed;
}

/** Convenience: synchronous read of current cached grant. */
export function isKitGranted(conn: { kitAccess?: Record<string, { granted: boolean }> } | undefined, kit: string): boolean {
  return conn?.kitAccess?.[kit]?.granted === true;
}
