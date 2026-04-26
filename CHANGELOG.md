# Changelog

## [Unreleased] - 0.1.0
- Initial scaffold: activity bar, Connections + Identities trees, dashboard webview, status bar item.
- NuGet Sync command (wraps `Sync-D365FONuGet.ps1`).
- Copilot chat participant `@d365fo` with `/dashboard`, `/connections`, `/test`, `/sync`.
- PATs stored via VS Code `SecretStorage` (DPAPI on Windows, Keychain on Mac).
- Per-workspace or global storage via `d365fo.storageMode` setting.

## Predecessor
This extension replaces the deprecated [d365fo-devlead-console](https://github.com/vjanardhana12/devlead-console) WPF app (last release v0.2.0-alpha).
