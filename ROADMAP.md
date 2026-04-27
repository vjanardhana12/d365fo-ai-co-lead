# D365 F&O Suite — Roadmap

## Vision

A suite of role-specific VS Code extensions for D365 F&O teams, each surfacing the
right tools and views for that role. Bootstrapped by a single `Setup.bat` that
installs all prerequisites and the role-specific extension.

## Architecture: one extension per role

| Extension ID | Display name | Status |
|---|---|---|
| `vinodkumarkj12.d365fo-devlead` | D365 F&O Dev Lead | v0.2.9 (built, not published) |
| `vinodkumarkj12.d365fo-developer` | D365 F&O Developer | Planned |
| `vinodkumarkj12.d365fo-techno-functional` | D365 F&O Techno-Functional | Planned |
| `vinodkumarkj12.d365fo-functional` | D365 F&O Functional Consultant | Planned |
| `vinodkumarkj12.d365fo-architect` | D365 F&O Architect | Planned |
| `vinodkumarkj12.d365fo-tester` | D365 F&O Tester | Planned |
| `vinodkumarkj12.d365fo-pjm` | D365 F&O Project Manager | Planned |

All share publisher `vinodkumarkj12` and (eventually) a `d365fo-core` shared
package for identities, connections, and ADO services.

## Bootstrap flow (`D365FO-MCP-Onboarding` repo)

```
Setup.bat
  ↓ asks: install path + role
setup.ps1 -Path <path> -Role <role>
  ├─ winget install: VS Code, Git, .NET SDK
  ├─ git clone: DevWorkspace + Xpp-MCP repos to <path>
  ├─ build/place D365FODevMCP.exe
  ├─ code --install-extension vinodkumarkj12.d365fo-<role>
  └─ open VS Code on <path>\DevWorkspace
```

The user lands in DevWorkspace with MCP servers connected and the role-specific
dashboard ready. They add an ADO connection and start working.

## Per-role tile inventory (planned)

### Dev Lead (built today)
- NuGet Sync ✅
- PR Review (planned)
- Pre-Checks (planned)
- Releases (planned)
- Estimate (planned)
- Project Initialization Kit (planned)

### Developer
- Open Project Handbook
- Create PR (linked to work item)
- X++ Build Status
- Pre-Checks (branch validation, label rules)
- Pull Latest NuGet Packages

### Techno-Functional
- Functional Specs viewer
- Work Items (read/comment)
- Customization Impact (uses D365FODevMCP)
- Test Cases (read)

### Functional Consultant
- Functional Specs viewer
- Work Items (full edit)
- Configuration export/import
- Test Plan tracking

### Architect
- Architecture diagrams
- Customization Impact map
- Cross-reference explorer (D365FODevMCP)
- Solution design templates

### Tester
- Test Plans
- Test Run execution
- Bug logging
- Screenshot attachment helper

### PJM (Project Manager)
- Sprint board summary
- Burndown
- Team capacity view
- Status report generator

## Phasing

| Phase | Focus | Outcome |
|---|---|---|
| **v0.2.x** (current) | Polish d365fo-devlead | Multi-identity, NuGet Sync, clean UX |
| **v0.3** | Setup.bat with role menu | One bootstrap script for all roles |
| **v1.0** | Publish d365fo-devlead to Marketplace | First role live |
| **v1.1** | Skeleton d365fo-developer | Second role |
| **v1.2 - v1.6** | Other 5 roles | Full suite |
| **v2.0** | Extract `d365fo-core` shared package | Maintainable |
| **v2.x** | "Project Initialization Kit" tile in Dev Lead | Generates project handbook + uploads to ADO; other roles auto-pull from connected ADO |

## Open questions / decisions to revisit

- Should role identity/connection storage be **shared** across role extensions
  (one PAT serves all) or **isolated** per extension? Probably shared via a
  common storage key under publisher `vinodkumarkj12`.
- Pre-built kit upload path: dev lead generates → ADO repo → other roles
  auto-clone? Or extension fetches metadata from ADO Wiki?
- Customer-specific overlays (e.g. Carlsberg-specific tiles) — go in customer's
  own extension or as configurable kits in the standard role extension?

## Out of scope for the suite

- Replacing Setup.bat entirely — Setup.bat stays as the bootstrap, extensions
  handle in-VS-Code workflow.
- Cross-platform (mac/Linux) — Windows-first.
- D365 F&O environment management (LCS, environment refresh) — that's a
  separate concern, not a role tool.
