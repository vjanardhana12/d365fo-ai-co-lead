import * as fs from 'fs';
import * as path from 'path';
import { ProjectSpec } from './connectionStore';

/**
 * Try to harvest a ProjectSpec from a folder that looks like a D365 F&O
 * DevWorkspace (or similar). Reads any of these files when present:
 *
 *   - ado-config.json          { Organization, Project, TenantId? }
 *   - d365fo-mcp.json          (D365FODevMCP config — paths, prefix, naming)
 *   - d365fo-mcp.local.json    (local overrides for the above)
 *
 * Returns a partial spec plus suggested Connection fields. All fields are
 * best-effort — caller should let the user review/edit before saving.
 */
export interface WorkspaceImport {
  spec: ProjectSpec;
  suggested: {
    name?: string;
    adoOrgUrl?: string;
    adoProject?: string;
    workingFolder?: string;
  };
  found: string[];   // file paths that were read
  missing: string[]; // file paths that were expected but not found
}

const FILES = ['ado-config.json', 'd365fo-mcp.json', 'd365fo-mcp.local.json'];

export function importFromWorkspaceFolder(folder: string): WorkspaceImport {
  const result: WorkspaceImport = {
    spec: {},
    suggested: { workingFolder: folder },
    found: [],
    missing: [],
  };

  for (const f of FILES) {
    const fp = path.join(folder, f);
    if (fs.existsSync(fp)) {
      result.found.push(fp);
      try {
        const raw = fs.readFileSync(fp, 'utf8');
        const json = JSON.parse(stripJsonComments(raw));
        applyJson(json, f, result);
      } catch (_e) { /* tolerate malformed JSON */ }
    } else {
      result.missing.push(fp);
    }
  }

  // Fill name from ADO project if not set
  if (!result.suggested.name && result.suggested.adoProject) {
    result.suggested.name = result.suggested.adoProject;
  }

  return result;
}

function applyJson(json: Record<string, unknown>, file: string, r: WorkspaceImport): void {
  // ado-config.json
  if (typeof json.Organization === 'string') {
    const org = String(json.Organization).trim();
    if (org && !r.suggested.adoOrgUrl) {
      r.suggested.adoOrgUrl = org.startsWith('http')
        ? org.replace(/\/+$/, '')
        : `https://dev.azure.com/${org}`;
    }
  }
  if (typeof json.Project === 'string' && !r.suggested.adoProject) {
    r.suggested.adoProject = String(json.Project);
  }

  // d365fo-mcp.json (and .local.json overrides)
  const s = r.spec;
  setIfString(json, 'CustomMetadataDirectory', v => s.customMetadataDirectory = v);
  setIfString(json, 'PackagesLocalDirectory',  v => s.packagesLocalDirectory = v);
  setIfString(json, 'DefaultPackage',          v => s.defaultPackage = v);
  setIfString(json, 'DefaultModel',            v => s.defaultModel = v);
  setIfString(json, 'ProjectsDirectory',       v => s.projectsDirectory = v);

  if (Array.isArray(json.AdditionalMetadataDirectories)) {
    s.additionalMetadataDirectories = (json.AdditionalMetadataDirectories as unknown[])
      .filter(x => typeof x === 'string') as string[];
  }
  if (Array.isArray(json.LabelLanguages)) {
    s.labelLanguages = (json.LabelLanguages as unknown[])
      .filter(x => typeof x === 'string') as string[];
  }

  const naming = json.NamingConventions as Record<string, unknown> | undefined;
  if (naming && typeof naming.Prefix === 'string') {
    s.prefix = naming.Prefix;
  }

  // Derive a sensible repoRoot from CustomMetadataDirectory:
  // e.g. D:\CarlsbergRepos\1760-Smartcore-HUB\src\xpp\Metadata
  //      -> D:\CarlsbergRepos\1760-Smartcore-HUB
  if (!s.repoRoot && s.customMetadataDirectory) {
    const m = s.customMetadataDirectory.replace(/\\/g, '/').match(/^(.*?)\/src\/xpp\/Metadata/i);
    if (m) s.repoRoot = m[1].replace(/\//g, path.sep);
  }
}

function setIfString(o: Record<string, unknown>, key: string, set: (v: string) => void): void {
  const v = o[key];
  if (typeof v === 'string' && v.trim()) set(v.trim());
}

/** Strip // and /* *\/ comments — some JSON-with-comments configs include them. */
function stripJsonComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
