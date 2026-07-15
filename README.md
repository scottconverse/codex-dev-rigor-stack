# codex-dev-rigor-stack

**Current version: 1.7.0 — released**

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

An active Codex lifecycle layer injects a compact universal core at session and subagent
start and routes coding/release prompts to the complete matching discipline. PreToolUse
and PostToolUse compare invocation-bound repository fingerprints: HEAD and tree identity,
symbolic/detached reference identity, semantic index state, complete Git status, and every
reported path regardless of extension. Direct edit tools likewise cover source, image,
font, document, archive, binary, notebook, and extensionless artifacts, including nested
and response-reported paths. Shell evidence uses an exact conservative allowlist; version,
help, eval, discovery, composite, and unknown commands cannot become proof merely because
their text contains words such as "test" or "build." Stop/SubagentStop may block once only
when the current coding turn lacks substantive proof. It never destroys a proved report
merely because receipt formatting is absent or invalid. A circuit release leaves explicit
unresolved proof debt instead of pretending the work passed, and release gates expose that
debt until evidence bound to the affected edit set resolves it. All task mutations use
owner-verified cross-process transactions. Immutable parent/child edges and recursive
STATUS aggregation keep subagent proof, mechanical, and association debt visible under
concurrency, compaction, retries, and retention cleanup.

Every accepted proof also has one write-once protocol record named
`evidence-v4-<16 lowercase hex proof ID>.json`. It binds the exact task and turn, hashed
edit set, evidence class, execution fingerprint, privacy-safe semantic descriptor, result,
and checkpoint. The descriptor retains only bounded fields such as tool family, executable,
operation, target hash/type, executable-origin hash, result source, and receipt/response
hashes; it excludes secrets and raw sensitive command arguments. Missing, malformed, or
tampered canonical evidence is **invalid canonical evidence**, never accepted proof. These
tokens provide correlation and stale/mismatch detection, not a security boundary against a
process that can rewrite local state. In-flight `pending tool observations` and recursively
associated `subagent pending observations` remain release-visible until reconciled.

Exact `DevRigorREPAIR` is an owner-directed recovery operation for the current task, not a
general debt eraser. It persists a transaction before resolving a uniquely identified
failure occurrence. A failed owner control is eligible only when its recorded operation
supplies an exact ON/WARN/OFF outcome that repair applies; generic and legacy failures without
a verifiable outcome remain debt. Normal allowlisted association debt can be repaired only by
its owning parent task after child binding, immutable edge, and locked parent projection all
match. STATUS rejects missing/malformed state, cross-task, forged, missing-transaction, and
stale replayed completions. Recovery tokens correlate local records but are not a security
boundary against arbitrary local-state edits.
Repair, reinstall, and update preserve the complete current v4 task, task-genesis, proof,
mechanical, snapshot, route, and association state transactionally. A task-genesis record is
owned only when its filename is exactly `task-genesis-v4-<64 lowercase hex task key>.json`;
malformed lookalikes fail closed before mutation and are never deleted. Legacy v1–v3 poisoned
ledgers and transient lock directories are deliberately not reactivated.

See the [technical architecture](docs/ARCHITECTURE.md) for system context, delivery state,
evidence/handoff, and deployment drawings.

## What Is Included

The transactional installer stages and validates **all 19 entrypoints** together: 13 canonical namespaced skills and
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
- Node.js for the active Codex hook runtime (the hooks use built-ins only)
- Windows 10/11 for the graphical Desktop hook activator
- PowerShell/Bash and Git are maintainer or scripted-install options, not requirements for
  an ordinary Codex Desktop user

## Quick Start

### Codex Desktop — no terminal

1. Use the tagged `1.7.0` source from this repository.
2. Install the stack into Codex Desktop, then review and trust its seven hooks through Codex.
3. Prebuilt activator artifacts are not tracked in the repository; build them from the tagged
   source when you need the graphical review app.

The activator uses Codex's supported app-server APIs to read, trust, and re-read the exact
hook hashes. Every command also embeds the expected SHA-256 of its JavaScript, reads the
file once, and compiles those already-verified bytes. Changed runtime files are refused;
reinstalling updated scripts creates changed definitions that require review. The app never
edits trust blindly, never trusts foreign hooks, and requires an explicit graphical approval.

### Scripted/maintainer installation

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Bash/Git Bash:

```sh
./install.sh
```

The default destination is `~/.codex/skills`. Skills, runtime, and the merged `hooks.json`
are staged and committed by one shared Windows/POSIX transaction coordinator. A canonical-home
lock serializes install and uninstall, and a durable phase journal lets the next invocation
recover an abruptly terminated prior operation before doing new work. The shared `hooks.json`
is applied last with compare-and-swap checks; a concurrent foreign edit causes a visible abort
and rollback instead of being overwritten. Existing copies are backed
up under the skills target and `CODEX_HOME` `.backup/codex-dev-rigor-stack/<backup-id>/`
trees. The collision-resistant backup ID includes its creation time and transaction identity.
Ownership metadata records only the exact backup IDs and immutable backup digests produced by
this lineage; unknown or modified children in the same namespace are preserved.
CI injects both mid-commit and backup-finalization failures and requires the entire starting
profile—including pre-existing backup history—to be restored byte-for-byte. A clean
first-install failure must leave no partial skills, runtime, hook configuration, backups,
staging, or rollback scaffolding.

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

Version `1.7.0` continues the product lineage from `1.5.1`. The earlier `1.0.0` Codex
packaging number was an interim version reset; it is preserved in the changelog as history
but is not the basis for future numbering. Releases advance monotonically from 1.6.0.
Version 1.6.1 repaired Desktop activation. Version 1.6.2 attempted Stop-hook scoping but
still inferred turns from prompt events. Version 1.6.3 replaced that model with exact
Codex turn identity and a hard retry circuit breaker. Version 1.7.0 keeps that isolation
and redesigns enforcement around task-scoped modes, typed substantive evidence,
non-destructive receipt warnings, complete repository/artifact observation, conservative
exact command classification, concurrency-safe task state, recursive
proof/mechanical/association debt, safe compaction/subagent inheritance, and transactional
migration/uninstall. Versions 1.6.0–1.6.3 are unsupported.

## Strength-Preservation Contract

Refactoring for brevity is never a reason to remove behavior. CI checks the complete
19-entrypoint manifest and routing, Walkthrough’s blind-first/installer/UI/lifecycle
requirements, Visitor Audit’s strong mechanics, shared handoffs, strict-zero wiring,
installer parity, and portable-export parity. Missing required siblings make a gate
invalid; they do not silently trigger a weaker approximation.

## Active Codex Hooks

The installer transactionally copies a Codex-native hook runtime to `CODEX_HOME/dev-rigor-stack` and
merges owned entries into `CODEX_HOME/hooks.json` without removing foreign hooks. Active
events are `SessionStart`, `SubagentStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, and
`SubagentStop`. Codex deliberately requires review/trust for non-managed command hooks;
until the user approves the exact definitions in the graphical activator (or another
client's supported hook-review UI), they are installed but not enforced. The activator
then performs a second `hooks/list` read and reports success only when Codex returns all
seven as trusted. Codex trust covers the definitions; the inline content guards bind those
definitions to the exact runtime bytes they execute.

Discovery and trust prove configuration, not event delivery. After a Codex client update,
run a live hook smoke test and confirm a coding turn creates a pre-tool repository fingerprint, edit,
execution, and checkpoint events in one turn-scoped ledger. A client that does not emit
PreToolUse and PostToolUse as an invocation-bound pair for its write and
execution tools is not fully enforced and must not be represented as such.

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
