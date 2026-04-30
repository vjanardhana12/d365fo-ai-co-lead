# Roadmap

> Living document. Items move from "Coming soon" to "Shipped" as releases go out. Tracked in-product on the dashboard's **Coming soon** section, filtered to your role.

## v1.0 — Shipped (2026-05)

- Hard rename: `D365 F&O Dev Lead` → `D365 Finance & Operations AI Co-Lead`
- Six role-aware Copilot Chat partners (`@d365fo-co-lead` master + Architect / FC / Dev Lead / Developer / Tester / PM)
- Role-filtered dashboard via `d365fo.myRoles` setting (multi-select)
- **Manage Agents** tile + `AgentRegistry` service — create/edit/clone/delete custom agents
- 6 seeded starter agents (one per role) auto-installed on first run
- **Ask AI** button on Create Dev Tasks tile — hands off to `@d365fo-dev-lead` with project-context-loaded prompt
- New teal/cyan icon (replaces the old dark blue Dev Lead branding)
- All previous v0.4.0 features kept: Identities, Connections, NuGet Sync, Create Dev Tasks, Project Initiation Kit, CB Spec Kit, sidebar trees, status bar

## v1.1 — Next

| Item | Roles served |
|---|---|
| **Dev Tasks AI mode** wired end-to-end to ADO MCP (auto-recommend preset/hours/reviewer from parent) | dev-lead |
| **FDD Authoring** tile + agent | fc, architect |
| **TDD from FDD** tile + agent | developer, dev-lead |
| **Implement from TDD** tile + agent (D365FODevMCP build loop with BP fix iteration) | developer |
| **Test Cases from FDD** tile + agent | tester |
| **PR Triage** tile + agent | dev-lead, developer |
| **Defect Triage** tile + agent | tester, dev-lead |
| **Project Spec → Repo** — commit `projectSpec` to `<repo>/.d365fo-co-lead/project.json` for team sync | architect, fc, dev-lead |
| **Per-Agent Evals** — run agent against project eval dataset; pass-rate trend | architect, dev-lead |
| **Telemetry (opt-in)** — anonymized tile usage to App Insights for adoption metrics | dev-lead, pm |

## v1.2

| Item | Roles served |
|---|---|
| **Status & Burndown** dashboard | pm, dev-lead, architect |
| **Risk Register** | pm, architect |
| **Release Notes** auto-draft | dev-lead, pm |
| **Code Review Coach** — AI checklist run on PR diff with project conventions | developer, dev-lead |
| **UAT Script Pack** — bundle test cases + screenshots into UAT-ready doc | fc, tester |

## v2 — Future / vision

| Item | Roles served |
|---|---|
| **Multi-Agent Orchestration** — Co-Lead routes complex requests across multiple role agents | architect, dev-lead |
| **IP / Patent disclosure pack** — auto-generate disclosure docs from delivery artefacts | architect, pm |
| **Customer Portal Export** — publish project status + design pack to a customer portal | pm |

## Distribution principles

- **Generic tools** → standalone repos under `vjanardhana12` (personal GitHub) → public OSS, anyone can use without this extension. Example: [`d365fo-nuget-sync`](https://github.com/vjanardhana12/d365fo-nuget-sync).
- **MS-internal-only** plugins (anything that uses internal MS data, customer eval datasets, or internal LLM endpoints) → `mcaps-microsoft` GitHub org.
- **Customer-specific kits** (e.g. CB Spec Kit) → ship inside the customer's ADO repo. Never on public GitHub.

## In-product visibility

The dashboard's **Coming soon** section renders these tiles greyed-out with version badges (`v1.1` / `v1.2` / `v2`) so users see exactly where their requested feature is on the roadmap without leaving VS Code.
# Roadmap

## v1.0 — Shipped (current)

| Capability | Roles | Status |
|---|---|---|
| Project Initiation Kit (import / blank) | Architect, FC, Dev Lead | ✅ |
| Identities + Connections (PAT-validated, encrypted) | All | ✅ |
| NuGet Sync (D365 F&O packages → ADO Artifacts) | Dev Lead, Developer | ✅ |
| Create Dev Tasks (XS/S/M/L/XL presets) + **Ask AI** button | Dev Lead | ✅ |
| CB Spec Kit (Carlsberg overlay — custom fields, stakeholders) | Dev Lead | ✅ |
| **Manage Agents** (in-product Agent Factory) | All | ✅ |
| 6 chat partners: `@d365fo-co-lead`, `@d365fo-architect`, `@d365fo-fc`, `@d365fo-dev-lead`, `@d365fo-developer`, `@d365fo-tester`, `@d365fo-pm` | All | ✅ skeleton |
| Role-aware dashboard (multi-select role filter) | All | ✅ |

## v1.1 — Next (planned)

| Capability | Roles | Why it matters |
|---|---|---|
| FDD Authoring | FC, Architect | Cuts FDD draft time |
| Solution Design (HLD) | Architect | ARB-ready outline |
| TDD from FDD | Developer, Dev Lead | Cross-references AOT via `D365FODevMCP` |
| Implement from TDD | Developer | Real X++ generation via `D365FODevMCP` |
| Test Cases from FDD | Tester | Bridges FC↔Tester handoff |
| PR Triage | Dev Lead, Developer | Reviewer suggestions, diff summary |
| Defect Triage | Tester, Dev Lead | Root-cause + reassignment |
| Project Spec → Repo (`<repo>/.d365fo-co-lead/project.json`) | Architect, FC, Dev Lead | Team sync of project spec |
| Per-Agent Evals | Architect, Dev Lead | Track agent quality over time |
| Telemetry (opt-in, App Insights) | Dev Lead, PM | Adoption metrics for LT |
| State key + command ID rename (`d365fo.*` → `d365foCoLead.*`) with auto-migration | All | Clean namespace post v1.0 |

## v1.2 — Then

| Capability | Roles |
|---|---|
| Status & Burndown | PM, Dev Lead, Architect |
| Risk Register | PM, Architect |
| Release Notes (auto-draft from PRs/work items) | Dev Lead, PM |
| UAT Script Pack | FC, Tester |
| Code Review Coach | Developer, Dev Lead |

## v2 — Vision

| Capability | Roles |
|---|---|
| Multi-Agent Orchestration (master Co-Lead routes complex requests across role agents) | Architect, Dev Lead |
| Patent / IP Pack (auto-generate disclosure docs from delivery artefacts) | Architect, PM |
| Customer Portal Export | PM |

## Distribution model

| Component | Repo | Account |
|---|---|---|
| `d365fo-ai-co-lead` (this extension) | `vjanardhana12/d365fo-ai-co-lead` | Personal GitHub |
| `d365fo-nuget-sync` (PowerShell tool, consumed by extension) | `vjanardhana12/d365fo-nuget-sync` | Personal GitHub |
| Future generic plugins | own personal repos | Personal GitHub |
| MS-internal plugins (using internal data / endpoints) | `mcaps-microsoft/<name>` or `vjanardhana_microsoft/<name>` | MS GitHub |
| Customer overlays (e.g. CB Spec Kit data) | Customer ADO repo (e.g. `carlsberggroup`) | Customer ADO |

## Versioning &amp; release cadence

- **Semantic versioning.** v1.x = additive features. v2.0 = breaking changes (e.g. command ID rename without auto-migration).
- **Release cadence:** monthly minor when feature is ready; patches as needed.
- **Distribution:** GitHub Releases at https://github.com/vjanardhana12/d365fo-ai-co-lead/releases (no Marketplace dependency).
