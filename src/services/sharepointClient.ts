import * as vscode from 'vscode';
import * as https from 'https';

const GRAPH_HOST = 'graph.microsoft.com';
const DEFAULT_SCOPES = [
  'https://graph.microsoft.com/Sites.Read.All',
  'https://graph.microsoft.com/Files.ReadWrite.All',
];

export async function getSharePointToken(scopes: string[] = DEFAULT_SCOPES): Promise<string> {
  const session = await vscode.authentication.getSession('microsoft', scopes, { createIfNone: true });
  return session.accessToken;
}

interface GraphSite { id: string; webUrl: string; displayName?: string; }
interface GraphDriveItem { id: string; name: string; webUrl: string; folder?: object; file?: object; size?: number; lastModifiedDateTime?: string; }

function graphGet<T>(path: string, token: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'GET',
      hostname: GRAPH_HOST,
      path,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body) as T); } catch (e) { reject(e); }
        } else {
          reject(new Error(`Graph ${res.statusCode}: ${res.statusMessage}\n${body.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export async function resolveSiteId(siteUrl: string, token: string): Promise<GraphSite> {
  const u = new URL(siteUrl);
  const hostname = u.hostname;
  const sitePath = u.pathname.replace(/^\/+|\/+$/g, '');
  const apiPath = `/v1.0/sites/${hostname}:/${sitePath}`;
  return graphGet<GraphSite>(apiPath, token);
}

export async function listSharePointChildren(siteUrl: string, folderId?: string): Promise<GraphDriveItem[]> {
  const token = await getSharePointToken();
  const site = await resolveSiteId(siteUrl, token);
  const path = folderId
    ? `/v1.0/sites/${site.id}/drive/items/${encodeURIComponent(folderId)}/children?$top=50&$orderby=name`
    : `/v1.0/sites/${site.id}/drive/root/children?$top=50&$orderby=name`;
  const res = await graphGet<{ value: GraphDriveItem[] }>(path, token);
  return res.value;
}

export interface SharePointBrowseItem extends GraphDriveItem {
  isFolder: boolean;
}
