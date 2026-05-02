import * as vscode from 'vscode';

/**
 * Azure DevOps resource scope. Granting this scope on a Microsoft account
 * issues a Bearer token usable against any *.dev.azure.com / *.visualstudio.com
 * endpoint - no PAT required.
 *
 * The fixed GUID `499b84ac-1321-427f-aa17-267ca6975798` is the well-known
 * resource ID for "Azure DevOps". `/.default` requests all consented scopes.
 */
const ADO_SCOPES = ['499b84ac-1321-427f-aa17-267ca6975798/.default'];
const PROVIDER = 'microsoft';

export interface SignInResult {
  accessToken: string;
  email: string;       // session.account.label - typically the UPN/email
  accountId: string;   // session.account.id - stable handle for silent reuse
}

/**
 * Interactive sign-in. Pops the VS Code "Allow extension to use Microsoft account"
 * dialog, then the standard MSAL browser-based login (handles MFA/CA policies via
 * the user's tenant). Returns once a token has been issued.
 *
 * `clearSessionPreference: true` forces the account picker to appear every time
 * (no remembered default from a previous attempt - important when the user
 * cancelled and is starting over with a different account).
 */
export async function signIn(): Promise<SignInResult> {
  const session = await vscode.authentication.getSession(PROVIDER, ADO_SCOPES, { createIfNone: true, clearSessionPreference: true });
  return { accessToken: session.accessToken, email: session.account.label, accountId: session.account.id };
}

/**
 * Sign in, preferring an account whose label (email) matches the provided
 * `preferredEmail` if one already exists silently. Otherwise opens the picker
 * (with previous preference cleared so the user is not stuck on an old
 * default) and lets the user choose / add an account.
 */
export async function signInPreferringEmail(preferredEmail: string): Promise<SignInResult> {
  const target = preferredEmail.trim().toLowerCase();
  if (target) {
    try {
      const accounts = await (vscode.authentication as unknown as { getAccounts(p: string): Thenable<vscode.AuthenticationSessionAccountInformation[]> }).getAccounts(PROVIDER);
      const match = accounts?.find(a => a.label.toLowerCase() === target);
      if (match) {
        const session = await vscode.authentication.getSession(PROVIDER, ADO_SCOPES, { account: match, createIfNone: true });
        return { accessToken: session.accessToken, email: session.account.label, accountId: session.account.id };
      }
    } catch { /* getAccounts may be unavailable on older VS Code; fall through to picker */ }
  }
  return signIn();
}

/**
 * List Microsoft accounts that VS Code already knows about (signed-in via any
 * extension or via the Accounts menu). Used to pre-populate a picker on the
 * connection form so the user doesn't have to retype an email they've already
 * authenticated with. Returns [] if the API isn't available on this VS Code build.
 */
export async function getKnownAccounts(): Promise<{ id: string; label: string }[]> {
  try {
    const accounts = await (vscode.authentication as unknown as { getAccounts(p: string): Thenable<vscode.AuthenticationSessionAccountInformation[]> }).getAccounts(PROVIDER);
    return (accounts ?? []).map(a => ({ id: a.id, label: a.label }));
  } catch {
    return [];
  }
}

/**
 * Silent token acquisition for an account previously captured via signIn().
 * Returns undefined if the user has signed out of that account in VS Code,
 * if the token can't be refreshed without interaction, or if revoked.
 */
export async function getAdoTokenSilent(accountId: string, accountLabel?: string): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession(
      PROVIDER, ADO_SCOPES,
      { account: { id: accountId, label: accountLabel ?? '' }, silent: true },
    );
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

/**
 * Get a token for a known account, prompting the user if a silent refresh fails.
 * Use this from operation entry points (running a sync, opening a kit) so the
 * user sees the auth prompt at the moment of use.
 */
export async function getAdoTokenInteractive(accountId?: string, accountLabel?: string): Promise<string> {
  const opts = accountId
    ? { account: { id: accountId, label: accountLabel ?? '' }, createIfNone: true }
    : { createIfNone: true };
  const session = await vscode.authentication.getSession(PROVIDER, ADO_SCOPES, opts);
  return session.accessToken;
}

/**
 * Resolve an Authorization header for a connection. Prefers Bearer (signed-in
 * Microsoft account); falls back to Basic (legacy email + PAT) for connections
 * that haven't been migrated yet. Returns undefined if neither is available.
 *
 * `patFallback` is the cleartext PAT pulled from SecretStorage by the caller;
 * we don't have ConnectionStore here to avoid a circular dep.
 */
export async function getAuthHeaderForConnection(
  conn: { microsoftAccountId?: string; microsoftAccountLabel?: string; email?: string },
  patFallback?: string,
): Promise<string | undefined> {
  if (conn.microsoftAccountId) {
    const token = await getAdoTokenSilent(conn.microsoftAccountId, conn.microsoftAccountLabel);
    if (token) return `Bearer ${token}`;
  }
  if (conn.email && patFallback) {
    return 'Basic ' + Buffer.from(`${conn.email}:${patFallback}`).toString('base64');
  }
  return undefined;
}
