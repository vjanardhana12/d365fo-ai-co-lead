# D365 F&O Dev Lead

> Click-driven dashboard, sidebar, and Copilot chat agent for **Dynamics 365 Finance & Operations dev leads**. Manage connections, identities, and run common dev-lead tools — without leaving VS Code.

[![Version](https://img.shields.io/visual-studio-marketplace/v/vinodkumarkj.d365fo-devlead?style=flat&color=007acc)](https://marketplace.visualstudio.com/items?itemName=vinodkumarkj.d365fo-devlead)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/vinodkumarkj.d365fo-devlead?style=flat&color=007acc)](https://marketplace.visualstudio.com/items?itemName=vinodkumarkj.d365fo-devlead)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.txt)

## Features

### Dashboard, Sidebar & Status Bar
- Activity bar icon opens a dedicated **D365 F&O** view container with **Identities** and **Connections** trees
- One-click **Dashboard** webview shows active connection, all identities/connections, and quick-action tiles
- **Status bar** always shows the active connection; click it to jump to the dashboard

### Identities & Connections (with PAT validation)
- **Identities** = who you are (email + Azure DevOps PAT). Stored encrypted in VS Code `SecretStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
- PATs are **validated against the ADO profile API** before saving — bad tokens fail fast
- **Connections** = identity + ADO org + project + optional working folder
- Switch active connection from the sidebar or dashboard with a single click
- **Test connection** button shows inline pass/fail with HTTP status

### NuGet Sync (D365 F&O packages → ADO Artifacts)
- Wraps the proven [Sync-D365FONuGet.ps1](https://github.com/vjanardhana12/d365fo-nuget-sync) script with a guided form
- **Browse** button for picking the package folder (no manual path typing)
- Output streams to a dedicated VS Code Output Channel
- **Status bar** shows live progress (`NuGet: PackageName`) during run, then green/red summary on completion
- **Dashboard badge** shows last-run summary inside the NuGet Sync tile (`Last: 4 pushed - 2m ago`)
- Script auto-pinned to the latest GitHub Release of `d365fo-nuget-sync` (configurable channel)

### Copilot Chat Agent
- Type `@d365fo` in Copilot Chat, then a slash command:
  - `/dashboard` — open the dashboard
  - `/connections` — list configured connections
  - `/test` — test the active connection
  - `/sync` — start NuGet sync
  - `/prs`, `/estimate` — coming soon

### Coming Soon
- Pull request listing & review
- Pre-checks (branch / build validation)
- Release pipeline triggers
- AI-assisted work item estimation

## Quick Start

1. **Install** the extension from the Marketplace
2. Click the **D365 F&O** icon in the activity bar
3. Add an **Identity** (your name + ADO email + PAT — get one at `https://dev.azure.com/<org>/_usersSettings/tokens` with at least `Code R/W`, `Packaging R/W`, `Project Read`, `Work Items Read` scopes)
4. Add a **Connection** (link the identity to an ADO project)
5. Click **NuGet Sync** in the dashboard to push D365 F&O packages to your feed

## Settings

| Setting | Default | Description |
|---|---|---|
| `d365fo.storageMode` | `global` | Where to store connections/identities (`global` or `workspace`) |
| `d365fo.openDashboardOnStartup` | `ifEmpty` | When to auto-open the dashboard (`never`, `ifEmpty`, `always`) |
| `d365fo.nugetSyncScript` | _(empty)_ | Optional path to a local `Sync-D365FONuGet.ps1` (overrides download) |
| `d365fo.nugetSyncScriptChannel` | `latest-release` | Where to fetch the script from (`latest-release` or `main`) |

## Privacy & Security

- All connection data and identities are stored locally (`globalState` or `workspaceState`)
- PATs are encrypted via VS Code `SecretStorage` (DPAPI on Windows)
- **No telemetry.** No data leaves your machine except direct API calls to Azure DevOps using your PAT.
- See [DISCLAIMER.md](DISCLAIMER.md) for full details

## Source & Issues

- **Repo:** https://github.com/vjanardhana12/d365fo-devlead
- **NuGet sync script:** https://github.com/vjanardhana12/d365fo-nuget-sync
- **Issues / feature requests:** https://github.com/vjanardhana12/d365fo-devlead/issues

## License

MIT — see [LICENSE.txt](LICENSE.txt).

Built by **Vinod Kumar K J** for D365 F&O dev leads.