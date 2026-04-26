import * as https from 'https';
import { URL } from 'url';

export interface AdoTestResult { ok: boolean; status: number; reason: string; }

/**
 * Test an ADO project endpoint with Basic auth (email:PAT). Returns ok/status/reason.
 */
export async function testProject(orgUrl: string, project: string, email: string, pat: string): Promise<AdoTestResult> {
  const url = new URL(`${orgUrl.replace(/\/+$/, '')}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`);
  const auth = Buffer.from(`${email}:${pat}`).toString('base64');
  return new Promise((resolve) => {
    const req = https.request({
      method: 'GET',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    }, (res) => {
      // Consume body so the socket can free.
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
