# codex-dev-rigor-stack 1.0

Codex-native packaging of Scott Converse's `dev-rigor-stack`: a strict, evidence-first
development and release system whose complete capabilities remain independently invokable.

This repo keeps the newer upstream skill content and makes the install path native to
Codex: copy the skill folders into `~/.codex/skills`, replacing older local copies when
requested. The Claude Code always-on hook layer from upstream is not wired by default
because Claude hook events and Codex hook payloads are different.

## Canonical Skills

- `dev-rigor-stack` - delivery loop and release gate coordinator
- `dev-rigor-stack-continuity` - durable cross-session/machine state
- `dev-rigor-stack-plan` - acceptance, tests, blast radius, and gate routing
- `dev-rigor-stack-build` - full test-first BUILD contract
- `dev-rigor-stack-proof-gate` - adversarial proof and anti-theater verification
- `dev-rigor-stack-audit-lite` - fast scoped review
- `dev-rigor-stack-audit-team` - deeper five-role review
- `dev-rigor-stack-walkthrough` - blind-first public acquisition, clean-machine installer
  lifecycle, every-screen/every-control UI/UX, accessibility, and wiring audit
- `dev-rigor-stack-visitor-audit` - every rendered public page, link, safe control,
  visual state, release asset, checksum, claim, and installer acquisition path
- `dev-rigor-stack-gauntletgate` - stage/release advancement gate
- `dev-rigor-stack-merge-gate` - green-path merge evidence decision
- `dev-rigor-stack-docs-gate` - deliverable documentation truth and completeness
- `dev-rigor-stack-release` - candidate-to-live strict-zero release protocol

Backward-compatible entrypoints remain installed: `coder-tdd-qa`, `proof-gate`,
`audit-lite`, `audit-team`, `gauntletgate`, and `visitor-audit`. Namespaced entrypoints
load those complete canonical contracts where applicable; they are not abbreviated
rewrites.

Invoke skills in Codex with `$dev-rigor-stack`, `$dev-rigor-stack-walkthrough`,
`$dev-rigor-stack-proof-gate`, and so on. Natural-language requests are also supported.

## Requirements

- Codex Desktop or another Codex client that loads skills from `CODEX_HOME/skills`
- Windows PowerShell 5.1+ for `install.ps1`, or Bash/Git Bash for `install.sh`
- Git only when cloning the repository rather than downloading its source archive

## Quick Start

1. Download or clone this repository.
2. Open a terminal in the repository root.
3. Run the PowerShell or Bash installer shown below.
4. Restart Codex Desktop.
5. Invoke `$dev-rigor-stack` for the complete flow or a namespaced standalone skill for one gate.

## Install For Codex Desktop

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Bash/Git Bash:

```sh
./install.sh
```

Default destination is:

```text
%USERPROFILE%\.codex\skills
```

Set `CODEX_HOME` to install into a different Codex home, or pass `-Target` /
`--target`.

The installer replaces these nineteen skill folders in the target. Existing copies are backed
up under `.backup\codex-dev-rigor-stack\<timestamp>\` unless `-NoBackup` /
`--no-backup` is used.

Restart Codex Desktop after installing so the new skill metadata is loaded.

## Usage Examples

```text
$dev-rigor-stack implement and prove this feature through the full stack
$dev-rigor-stack-walkthrough audit the published Windows installer as a newcomer
$dev-rigor-stack-visitor-audit inspect every public release surface and link
$dev-rigor-stack-proof-gate refute the claim that this fix is production-ready
```

Each standalone entrypoint emits or consumes the shared evidence artifacts documented in
`skills/dev-rigor-stack/references/artifact-contracts.md`. The coordinator can route the
same work across PLAN, BUILD, VERIFY, REVIEW, MERGE, documentation, and release closure.

## Configuration

- Set `CODEX_HOME` to change the Codex home used by the installers.
- Pass `-Target <path>` to `install.ps1` or `--target <path>` to `install.sh` to select an
  exact skills directory.
- Existing installed skills are backed up by default. Use `-NoBackup` or `--no-backup`
  only when that recovery copy is intentionally unnecessary.
- The stack's release default is strict-zero across Blocker, Critical, Major, Minor, and
  Nit. A project may declare a different threshold before a run, but cannot silently
  weaken it after findings exist.

## Strength-Preservation Contract

This repository treats capability preservation as a release invariant. CI exercises the
strong Visitor Audit checker, checks Walkthrough's blind-first/installer/UI/lifecycle
requirements, verifies every canonical entrypoint is installed and routed, rejects missing
handoffs or strict-zero wiring, and keeps compatibility skills present. Refactoring for
brevity is never a reason to remove a behavior.

At a public release, candidate evidence is not final evidence. Closure requires a live
Visitor Audit followed by a full published Walkthrough that begins at the public front
door, downloads the finished installer, installs it in a verified clean machine, and
accounts for every in-scope screen, control, distinct path, visual state, update, repair,
and uninstall operation.

## Codex Hook Status

The upstream Claude plugin includes three always-on hooks:

- session reflex
- prompt router
- grounding check

Those are intentionally not installed here yet. Codex Desktop has different hook names,
configuration format, and event payloads. The portable behavior lives in the skills
themselves; hook enforcement should be ported as a separate Codex-native layer after its
payloads are verified against the active Codex build.

## Upstream

This derivative tracks:

```text
https://github.com/scottconverse/dev-rigor-stack
```

Keep `upstream` as the fetch-only source for new skill content, then re-run the Codex
installer and validation before replacing local skills.

## Project Links

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [MIT License](LICENSE)
