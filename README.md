# codex-dev-rigor-stack

**Current version: 1.6.0**

MIT licensed.

An evidence-first development and release system for Codex. It turns “done” from a
confidence statement into a claim backed by tests, runtime evidence, adversarial review,
real-user walkthroughs, public-surface audits, and a human-controlled release decision.

[Landing page](https://scottconverse.github.io/codex-dev-rigor-stack/) ·
[Full user manual](docs/MANUAL.md) · [Technical architecture](docs/ARCHITECTURE.md) ·
[Changelog](CHANGELOG.md)

## Plain English

AI coding agents can sound certain before they have proved anything. This stack gives the
agent a disciplined route through the work:

1. agree on what “finished” means;
2. write a check that can actually fail;
3. build the change and run it;
4. try to disprove the result and review it at the right depth;
5. merge only through a green pull request.

For a release, it adds stronger gates: a full adversarial gauntlet, claim checking against
the real documentation, a newcomer journey through the published installer, a visual and
UI/UX audit, every public page and link, rollback readiness, and the owner’s final go/no-go.

The important part is not ceremony. It is matching the proof to the claim. A unit test may
prove a function; it cannot prove the installer, a button, a rendered page, or a public
download works.

## Technical Summary

The coordinator routes each unit through `PLAN → BUILD → VERIFY → REVIEW → MERGE`, with
blast radius controlling review depth. Standalone skills share durable evidence contracts
for run identity, claims, findings, coverage, handoffs, and gate results. Release closure
is strict-zero by default across Blocker, Critical, Major, Minor, and Nit.

Visitor Audit owns the public boundary: rendered pages, links, safe controls, responsive
visual inspection, claims, release assets, checksums, and the acquisition path. Walkthrough
consumes the exact published artifact and owns blind-first clean-environment installation,
every product screen/control/path/state, interface-to-function wiring, accessibility,
update, repair, uninstall, and a numerical coverage ledger.

An active Codex lifecycle layer injects the universal proof reflex at session and subagent
start, routes prompts to the matching discipline, records edits and successful real executions, and
uses Stop/SubagentStop to continue work when the latest runnable edit has not been checked successfully
or the final evidence receipt is missing.

See the [technical architecture](docs/ARCHITECTURE.md) for system context, delivery state,
evidence/handoff, and deployment drawings.

## What Is Included

The installer deploys **all 19 entrypoints** together: 13 canonical namespaced skills and
6 backward-compatible names.

| Canonical entrypoint | Responsibility |
| --- | --- |
| `dev-rigor-stack` | Coordinates the complete unit and release flow |
| `dev-rigor-stack-continuity` | Restores and persists cross-session/machine decisions |
| `dev-rigor-stack-plan` | Defines acceptance, test list, blast radius, and routing |
| `dev-rigor-stack-build` | Applies the complete test-first engineering and QA contract |
| `dev-rigor-stack-proof-gate` | Refutes claims and rejects verification theater |
| `dev-rigor-stack-audit-lite` | Runs a fast, scoped review |
| `dev-rigor-stack-audit-team` | Runs a deep five-role review |
| `dev-rigor-stack-walkthrough` | Audits acquisition, installer lifecycle, every UI path/state, visuals, accessibility, and wiring |
| `dev-rigor-stack-visitor-audit` | Audits every public surface, link, safe control, visual state, asset, checksum, and claim |
| `dev-rigor-stack-gauntletgate` | Runs the adversarial advancement gate |
| `dev-rigor-stack-merge-gate` | Makes the exact-SHA green-path merge decision |
| `dev-rigor-stack-docs-gate` | Verifies README, manual, architecture, landing page, links, and claims |
| `dev-rigor-stack-release` | Coordinates candidate evidence through live strict-zero closure |

Compatibility entrypoints remain complete and installed: `coder-tdd-qa`, `proof-gate`,
`audit-lite`, `audit-team`, `gauntletgate`, and `visitor-audit`. They are not abbreviated
rewrites.

## Requirements

- Codex Desktop or another Codex client that loads skills from `CODEX_HOME/skills`
- Windows PowerShell 5.1+ for `install.ps1`, or Bash/Git Bash for `install.sh`
- Git only when cloning instead of downloading the source archive
- Node.js for the active Codex hook runtime (the hooks use built-ins only)

## Quick Start

1. Download or clone this repository.
2. Open a terminal in the repository root.
3. Run the PowerShell or Bash installer below.
4. Open `/hooks`, review and trust the six dev-rigor lifecycle definitions.
5. Restart Codex Desktop, then invoke `$dev-rigor-stack` or any standalone entrypoint.

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Bash/Git Bash:

```sh
./install.sh
```

The default destination is `~/.codex/skills`. Existing copies are backed up under
`.backup/codex-dev-rigor-stack/<timestamp>/` before replacement.

## Usage Examples

```text
$dev-rigor-stack implement and prove this feature through the full stack
$dev-rigor-stack-build fix this bug test-first
$dev-rigor-stack-proof-gate try to disprove that this fix is production-ready
$dev-rigor-stack-walkthrough audit the published Windows installer as a newcomer
$dev-rigor-stack-visitor-audit inspect every public release surface and link
$dev-rigor-stack-docs-gate verify every public claim and documentation deliverable
```

The [full user manual](docs/MANUAL.md) covers installation, choosing a skill, operating
the unit/release flows, evidence artifacts, updates, backups, restore, uninstall,
troubleshooting, portability, and the exact Codex hook status.

## Configuration

- Set `CODEX_HOME` to change the Codex home used by the installers.
- Pass `-Target <path>` to `install.ps1` or `--target <path>` to `install.sh` for an exact
  skills directory. When it is not `<CODEX_HOME>/skills`, also pass `-CodexHome <path>` or
  `--codex-home <path>` so the runtime and `hooks.json` land in the intended clean profile.
- Use `-NoBackup` or `--no-backup` only when you intentionally do not want recovery copies.
- A project may declare a non-default severity threshold before a run, but it cannot lower
  the threshold after findings exist. The stack default is strict-zero.

## Versioning

Version `1.6.0` continues the product lineage from `1.5.1`. The earlier `1.0.0` Codex
packaging number was an interim version reset; it is preserved in the changelog as history
but is not the basis for future numbering. Releases advance monotonically from 1.6.0.

## Strength-Preservation Contract

Refactoring for brevity is never a reason to remove behavior. CI checks the complete
19-entrypoint manifest and routing, Walkthrough’s blind-first/installer/UI/lifecycle
requirements, Visitor Audit’s strong mechanics, shared handoffs, strict-zero wiring,
installer parity, and portable-export parity. Missing required siblings make a gate
invalid; they do not silently trigger a weaker approximation.

## Active Codex Hooks

The installer copies a Codex-native hook runtime to `CODEX_HOME/dev-rigor-stack` and
merges owned entries into `CODEX_HOME/hooks.json` without removing foreign hooks. Active
events are `SessionStart`, `SubagentStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, and
`SubagentStop`. Codex deliberately requires review/trust for non-managed command hooks;
until the user trusts these definitions in `/hooks`, they are installed but not enforced.

The original Claude implementation remains under `plugin/` only as provenance. It is not
part of the active Codex architecture.

## Project Links

- [Full user manual](docs/MANUAL.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [MIT License](LICENSE)
- [Upstream methodology repository](https://github.com/scottconverse/dev-rigor-stack)
