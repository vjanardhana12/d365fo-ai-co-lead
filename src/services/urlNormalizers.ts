/**
 * URL normalization helpers for ADO and SharePoint inputs.
 * Keeps stored connection values clean regardless of how the user pasted them.
 */

export interface AdoOrgParse {
  orgUrl: string;          // canonical: https://dev.azure.com/<org>
  project?: string;        // extracted from URL if present
}

/**
 * Normalize an ADO Organization URL.
 *  - Trims whitespace and trailing slashes.
 *  - If the URL contains a project segment (e.g. .../<org>/<project> or
 *    .../<org>/<project>/_git/<repo>), returns the org root and the
 *    decoded project name separately.
 *  - Supports both modern (dev.azure.com/org) and legacy (org.visualstudio.com) hosts.
 */
export function normalizeAdoOrgUrl(input: string): AdoOrgParse {
  const raw = (input ?? '').trim();
  if (!raw) return { orgUrl: '' };

  let cleaned = raw.replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(cleaned); } catch { return { orgUrl: cleaned }; }

  const host = url.hostname.toLowerCase();
  const segs = url.pathname.split('/').filter(Boolean);

  // Stop at well-known ADO path keywords that terminate the project segment.
  const stopWords = new Set(['_git', '_apis', '_workitems', '_build', '_release', '_dashboards', '_settings', '_artifacts', '_boards', '_pipelines', '_test', '_packaging', '_usersSettings']);

  if (host === 'dev.azure.com' || host === 'ssh.dev.azure.com') {
    // /<org>[/<project>[/...]]
    const org = segs[0];
    if (!org) return { orgUrl: `${url.protocol}//${url.host}` };
    let project: string | undefined;
    if (segs.length >= 2 && !stopWords.has(segs[1])) {
      project = decodeURIComponent(segs[1]);
    }
    return { orgUrl: `${url.protocol}//${url.host}/${org}`, project };
  }

  if (host.endsWith('.visualstudio.com')) {
    // legacy: <org>.visualstudio.com[/<project>[/...]]
    let project: string | undefined;
    if (segs.length >= 1 && !stopWords.has(segs[0])) {
      // First segment could still be a project; some legacy URLs have it directly
      // e.g. https://contoso.visualstudio.com/MyProject/_git/Repo
      project = decodeURIComponent(segs[0]);
    }
    return { orgUrl: `${url.protocol}//${url.host}`, project };
  }

  // Unknown host shape - return as-is, no project extraction.
  return { orgUrl: cleaned };
}

/**
 * Normalize a SharePoint site URL down to its canonical site root.
 * Examples handled:
 *   https://contoso.sharepoint.com/sites/Foo
 *   https://contoso.sharepoint.com/sites/Foo/
 *   https://contoso.sharepoint.com/sites/Foo/Shared%20Documents/Forms/AllItems.aspx
 *   https://contoso.sharepoint.com/sites/Foo/SitePages/Home.aspx?param=1
 *   https://contoso.sharepoint.com/teams/Bar/Lists/...
 * Returns the original (trimmed) string if the shape is unrecognized.
 */
export function normalizeSharePointSiteUrl(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  let url: URL;
  try { url = new URL(raw); } catch { return raw; }

  const host = url.hostname;
  const segs = url.pathname.split('/').filter(Boolean);

  // Look for /sites/<name> or /teams/<name>
  for (let i = 0; i < segs.length - 1; i++) {
    const lower = segs[i].toLowerCase();
    if (lower === 'sites' || lower === 'teams') {
      const siteName = decodeURIComponent(segs[i + 1]);
      return `${url.protocol}//${host}/${lower}/${encodeURIComponent(siteName)}`;
    }
  }

  // Tenant root (e.g. https://contoso.sharepoint.com) - return without trailing slash.
  return `${url.protocol}//${host}${url.pathname.replace(/\/+$/, '')}`;
}
