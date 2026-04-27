# Changelog

All notable changes to the **D365 F&O Dev Lead** extension.

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