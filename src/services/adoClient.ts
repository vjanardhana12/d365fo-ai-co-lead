import * as https from 'https';
import { URL } from 'url';

export interface AdoTestResult { ok: boolean; status: number; reason: string; }

function getStatus(orgUrl: string, path: string, authHeader: string): Promise<AdoTestResult> {
  const url = new URL(`${orgUrl.replace(/\/+$/, '')}${path}`);
  return new Promise((resolve) => {
    const req = https.request({
      method: 'GET',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }, (res) => {
      res.on('data', () => { /* discard */ });
      res.on('end', () => resolve({
        ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
        status: res.statusCode ?? 0,
        reason: res.statusMessage ?? '',
      }));
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, reason: err.message }));
    req.end();
  });
}

/**
 * Test an ADO project endpoint with a precomputed Authorization header
 * (either `Bearer <oauth-token>` or `Basic <b64(email:pat)>`).
 */
export async function testProjectWithAuth(orgUrl: string, project: string, authHeader: string): Promise<AdoTestResult> {
  return getStatus(orgUrl, `/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`, authHeader);
}

/**
 * Probe whether the caller has any access to an ADO org with a precomputed Authorization header.
 */
export async function probeOrgAccessWithAuth(orgUrl: string, authHeader: string): Promise<AdoTestResult> {
  return getStatus(orgUrl, `/_apis/projects?$top=1&api-version=7.1`, authHeader);
}

/** Legacy Basic-auth wrapper. Prefer testProjectWithAuth + Bearer for new code. */
export async function testProject(orgUrl: string, project: string, email: string, pat: string): Promise<AdoTestResult> {
  const auth = 'Basic ' + Buffer.from(`${email}:${pat}`).toString('base64');
  return testProjectWithAuth(orgUrl, project, auth);
}

/**
 * Probe whether a given identity (email + PAT) has access to a specific ADO
 * organization. Used by the kit access gate — e.g. to check whether the user
 * belongs to the `carlsberggroup` org before showing the CB Spec Kit tile.
 *
 * Calls `GET {orgUrl}/_apis/projects?$top=1` with Basic auth.
 *   200/204  → granted
 *   401/403  → denied (not a member, or PAT lacks read scope)
 *   anything else → denied (treated as no access for safety)
 */
/** Legacy Basic-auth wrapper. Prefer probeOrgAccessWithAuth + Bearer for new code. */
export async function probeOrgAccess(orgUrl: string, email: string, pat: string): Promise<AdoTestResult> {
  const auth = 'Basic ' + Buffer.from(`${email}:${pat}`).toString('base64');
  return probeOrgAccessWithAuth(orgUrl, auth);
}

/**
 * Validate PAT by calling the ADO profile endpoint. Lightweight, no project required.
 */
export interface PatValidationResult { ok: boolean; status: number; reason: string; displayName?: string; emailAddress?: string; }

/** Fetch the ADO profile (display name + email) using a precomputed Authorization header (Bearer or Basic). Best-effort. */
export async function getProfileWithAuth(authHeader: string): Promise<PatValidationResult> {
  const url = new URL('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1');
  return new Promise((resolve) => {
    const req = https.request({
      method: 'GET',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          try {
            const j = JSON.parse(body);
            resolve({ ok: true, status, reason: '', displayName: j.displayName, emailAddress: j.emailAddress });
          } catch {
            resolve({ ok: true, status, reason: '' });
          }
        } else {
          resolve({ ok: false, status, reason: res.statusMessage ?? '' });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, reason: err.message }));
    req.end();
  });
}

export async function validatePat(email: string, pat: string): Promise<PatValidationResult> {
  const url = new URL('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1');
  const auth = Buffer.from(`${email}:${pat}`).toString('base64');
  return new Promise((resolve) => {
    const req = https.request({
      method: 'GET',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          try {
            const j = JSON.parse(body);
            resolve({ ok: true, status, reason: '', displayName: j.displayName, emailAddress: j.emailAddress });
          } catch {
            resolve({ ok: true, status, reason: '' });
          }
        } else {
          resolve({ ok: false, status, reason: res.statusMessage ?? '' });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, reason: err.message }));
    req.end();
  });
}
