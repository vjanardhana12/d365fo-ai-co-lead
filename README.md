# D365 F&O Dev Lead — VS Code Extension

A click-driven dashboard, sidebar, and Copilot chat agent for **Dynamics 365 Finance & Operations dev leads**. Manage connections, identities, NuGet sync, PR review, pre-checks and releases — without leaving VS Code.

> **Status: early alpha (v0.1).** First feature shipping is **Connections + Identities + NuGet Sync**, on top of the proven [d365fo-nuget-sync](https://github.com/vjanardhana12/d365fo-nuget-sync) script. Pull requests, pre-checks, releases and AI agents come next.

> Replaces the deprecated [d365fo-devlead-console](https://github.com/vjanardhana12/d365fo-devlead-console) (WPF). Same dashboard, lives where you already work.

## Features

- **D365 F&O activity bar** — sidebar with **Connections** and **Identities** trees.
- **Dashboard webview** — same layout as the WPF console; click tiles for actions.
- **Status bar** — shows the active connection at all times; click to open the dashboard.
- **Connections** — friendly name + ADO org + project + identity + working folder + notes.
- **Identities** — display name + email + ADO PAT (stored in VS Code `SecretStorage` — DPAPI on Windows, Keychain on Mac).
- **NuGet Sync** — wraps `Sync-D365FONuGet.ps1` with a guided flow; output streams to a dedicated channel.
- **Copilot Chat agent (`@d365fo`)** — type `@d365fo` in chat, then pick a slash command:
  - `/dashboard`, `/connections`, `/test`, `/sync`, `/prs` *(soon)*, `/estimate` *(soon)*

## Run from source

```powershell
git clone https://github.com/vjanardhana12/d365fo-devlead.git
cd d365fo-devlead
npm install
# Press F5 in VS Code to launch a debug Extension Host
```

## License
MIT — see [LICENSE](LICENSE).
