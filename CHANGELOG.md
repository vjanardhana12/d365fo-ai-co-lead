# Changelog

All notable changes to the **D365 F&O Dev Lead** extension.

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
- Output Channel `D365FO NuGet Sync` for streaming PowerShell output
- "Show last sync output" tile to reopen the channel anytime
- Configurable script channel (`latest-release` vs `main`) for the NuGet sync PS1
- Auto-open dashboard on startup setting (`never`, `ifEmpty`, `always`)
- Copilot Chat participant `@d365fo` with `/dashboard`, `/connections`, `/test`, `/sync` commands

### Security
- PATs stored via VS Code SecretStorage (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
- No telemetry — extension makes API calls only to Azure DevOps using the user-supplied PAT

## 0.1.x — pre-release iterations

Internal builds during initial development. Not published.