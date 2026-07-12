# codex-dev-rigor-stack

Codex Desktop packaging of Scott Converse's `dev-rigor-stack` skills.

This repo keeps the newer upstream skill content and makes the install path native to
Codex: copy the skill folders into `~/.codex/skills`, replacing older local copies when
requested. The Claude Code always-on hook layer from upstream is not wired by default
because Claude hook events and Codex hook payloads are different.

## Skills

- `dev-rigor-stack` - delivery loop and release gate coordinator
- `coder-tdd-qa` - test-first engineering and QA standards
- `proof-gate` - adversarial proof and anti-theater verification
- `audit-lite` - fast scoped review
- `audit-team` - deeper multi-role audit
- `gauntletgate` - stage/release gate with lite, walkthrough, and full lanes
- `visitor-audit` - live public-surface audit of rendered pages, links, release assets,
  checksums, and current claims

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

The installer replaces these seven skill folders in the target. Existing copies are backed
up under `.backup\codex-dev-rigor-stack\<timestamp>\` unless `-NoBackup` /
`--no-backup` is used.

Restart Codex Desktop after installing so the new skill metadata is loaded.

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
