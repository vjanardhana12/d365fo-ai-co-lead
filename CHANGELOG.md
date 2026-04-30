# Changelog

All notable changes to the **D365 F&O AI Co-Lead** extension (formerly *D365 F&O Dev Lead*).

## 1.0.0 — 2026-05-01 — AI Co-Lead rebrand & Agent Factory

### Renamed
- Extension renamed from **D365 F&O Dev Lead** → **D365 Finance & Operations AI Co-Lead**
- Package: `d365fo-devlead` → `d365fo-ai-co-lead`
- Repo: `vjanardhana12/d365fo-devlead` → `vjanardhana12/d365fo-ai-co-lead`
- New teal/cyan icon (replaces dark blue)
- Status bar: `D365 F&O Co-Lead: <project>` (was `Dev Lead`)

### Added
- **6 role-aware Copilot Chat partners**: `@d365fo-co-lead` (master) plus `@d365fo-architect`, `@d365fo-fc`, `@d365fo-dev-lead`, `@d365fo-developer`, `@d365fo-tester`, `@d365fo-pm`
- **Role filter setting** `d365fo.myRoles` (multi-select: architect / fc / dev-lead / developer / tester / pm)
- **Manage Agents tile** + `AgentRegistry` service — create/edit/clone/delete custom AI agents with role, system prompt, and MCP server scope
- **6 seeded starter agents** auto-installed on first activation (one per role)
- **Ask AI button** on Create Dev Tasks tile — hands off to `@d365fo-dev-lead` with project context
- **Coming-soon tiles** filtered by role with v1.1 / v1.2 / v2 badges, so users see the roadmap in-product
- New commands: `d365fo.agents.manage`, `d365fo.agents.invoke`, `d365fo.devTasks.askAi`

### Architecture
- All v0.4.0 services preserved; `AgentRegistry` added; `ProjectSpec.kitData` slot used for customer overlays (kept the CB Spec Kit pattern)
- Chat participants share the same services layer as the dashboard tiles — same backend, two surfaces

### Internal command IDs (`d365fo.*`) preserved
- Old globalState keys (`d365fo.connections`, `d365fo.identities`, `d365fo.lastNuGetSyncResult`, etc.) **kept as-is** so v0.4.0 users upgrade without losing data.
- A namespace migration to `d365foCoLead.*` is on the roadmap for v1.1 — will ship with one-time auto-migration.

---

## 0.4.0 — 2026-04 — Project kits

- Project Initiation Kit (import from DevWorkspace folder, or start blank)
- CB Spec Kit (Carlsberg-specific overlay: custom fields + stakeholder mentions)
- ProjectSpec model on Connection (with `kitData` overlay slot)
- Tools / Project / Coming soon dashboard categorisation
- Output button on NuGet Sync snapshot

## 0.3.0 — Dev Tasks creator

- `devTaskRunner` service + `Create Dev Tasks` tile + status bar progress
- T-shirt presets (XS/S/M/L/XL) with auto code-review hours
- Snapshot of last run on the dashboard tile

## Earlier

- v0.2 — NuGet Sync tile with last-run snapshot
- v0.1 — Identities, Connections, Dashboard, `@d365fo` chat participant, status bar
# Changelog

All notable changes to the **D365 F&O AI Co-Lead** extension (formerly *D365 F&O Dev Lead*).

## 1.0.0 — 2026-05-01 — AI Co-Lead rebrand &amp; Agent Factory

### Renamed
- Extension renamed from **D365 F&O Dev Lead** → **D365 Finance &amp; Operations AI Co-Lead**
- Package: `d365fo-devlead` → `d365fo-ai-co-lead`
- Repo: `vjanardhana12/d365fo-devlead` → `vjanardhana12/d365fo-ai-co-lead`
- New cyan/teal "Co-Lead" icon (was dark blue 'D' + bolt)
- Status bar text: `D365 F&O Co-Lead: <project>`
- Internal command IDs and state keys remain `d365fo.*` for v1.0 (clean rename + auto-migration ships in v1.1 to minimise upgrade blast radius)

### Added
- **6 chat partners** (master + 5 role-specific + PM): `@d365fo-co-lead`, `@d365fo-architect`, `@d365fo-fc`, `@d365fo-dev-lead`, `@d365fo-developer`, `@d365fo-tester`, `@d365fo-pm`
- **Manage Agents** tile + `AgentRegistry` service + 6 seeded role agents
- **Role filter setting** `d365fo.myRoles` (multi-select)
- Role-aware dashboard with per-role coming-soon tiles tagged by version (v1.1 / v1.2 / v2)
- **Ask AI** button on Dev Tasks tile (opens Copilot Chat with `@d365fo-dev-lead` + project context)
- ROADMAP.md and role-segmented README.md

### Removed
- Single `@d365fo` chat participant (replaced by master + role partners)

## 0.4.0 — 2026-04-30 — Project Initiation Kit + CB Spec Kit + Dev Tasks

### Added
- Project Initiation Kit tile (Import from folder / Start blank)
- ProjectSpec on Connection (kit, prefix, model, ADO defaults, kitData overlay)
- CB Spec Kit tile + command (Carlsberg-only overlay; renders only when `kit==='carlsberg'`)
- Create Dev Tasks command + service (XS/S/M/L/XL presets, T-shirt hours, parent linking)
- Dashboard categories: Tools / Project / Coming soon
- Output button on NuGet snapshot tile

## 0.2.8 — 2026-04-27 — Generic placeholders

### Changed
- Form placeholders now use generic examples (`Contoso`, `Customer A`, `D:\Repos\YourProject`) instead of real customer names

## 0.2.7 — 2026-04-27 — Simpler identity form

### Changed
- Removed the `Identity kind` dropdown from the Add/Edit identity form — every identity is treated as an ADO PAT (the only kind this extension uses today)
- Display name help text updated to suggest customer-scoped names like `Vinod (MCAPS)`, `Vinod (Carlsberg)`
- Dashboard identities table no longer shows the Kind column (always Pat)

## 0.2.6 — 2026-04-27 — PAT scope guidance + ADO PAT shortcut

### Added
- Command `D365FO: Open ADO PAT Page` — prompts for ADO org name or URL, opens the PAT generator page in your browser
- Expanded PAT field help with role-based scope recommendations (Functional, Tester, Developer, Dev Lead) and a clear note that PATs cannot escalate ADO permissions

## 0.2.5 — 2026-04-27 — Publisher fix

### Changed
- Publisher set to `vinodkumarkj12` to match the registered Marketplace publisher (was incorrectly `vinodkumarkj` in earlier dev builds — this is now locked for all future releases)

## 0.2.4 — 2026-04-27 — Dashboard refresh fix

### Fixed
- Dashboard webview now refreshes immediately when identities or connections are added, edited, deleted, or marked active from the activity bar tree views (previously stayed stale until manual refresh)

## 0.2.3 — 2026-04-27 — UI naming cleanup

### Changed
- Dashboard tab title: `D365 F&O Dashboard` → `Dev Lead Dashboard`
- Dashboard heading: `D365 F&O Dev Lead` → `Dev Lead` (subtitle still mentions D365 F&O)
- NuGet tile title: `D365 F&O NuGet Sync` → `NuGet Sync`
- Status bar text: `D365 F&O NuGet Sync: starting...` → `NuGet Sync: starting...`
- Form title: `D365 F&O NuGet Sync - <conn>` → `NuGet Sync - <conn>`
- Notifications now use `D365 F&O: <message>` style (cleaner colon separator)

### Kept (suite identity on global surfaces)
- Marketplace name, command palette commands, output channel, activity bar title

## 0.2.0 — 2026-04-26 — First public release

First Marketplace release. The extension is feature-complete for the Identities + Connections + NuGet Sync workflow.

### Added
- D365 F&O activity bar with Identities and Connections tree views
- Dashboard webview with adaptive setup hints (no identities → no connections → no active → all set)
- Webview forms for adding identities and connections (replaces sequential prompts)
- **Browse...** button on path fields (folder picker via VS Code native dialog)
- Status bar shows active connection; click to open dashboard
- Test connection: inline pass/fail bar in dashboard with HTTP status
- **PAT validation** against ADO profile API before saving identity
- NuGet Sync wraps Sync-D365FONuGet.ps1 with a guided form
- Live status bar updates during NuGet Sync (`NuGet: PackageName`)
- Green/red status bar summary for 10 seconds after NuGet Sync completes
- Dashboard badge inside NuGet Sync tile shows last-run summary
- Output Channel `D365 F&O NuGet Sync` for streaming PowerShell output
- "Show last sync output" tile to reopen the channel anytime
- Configurable script channel (`latest-release` vs `main`) for the NuGet sync PS1
- Auto-open dashboard on startup setting (`never`, `ifEmpty`, `always`)
- Copilot Chat participant `@d365fo` with `/dashboard`, `/connections`, `/test`, `/sync` commands

### Security
- PATs stored via VS Code SecretStorage (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
- No telemetry — extension makes API calls only to Azure DevOps using the user-supplied PAT

## 0.1.x — pre-release iterations

Internal builds during initial development. Not published.