# dev-rigor-stack

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A six-gate delivery discipline for AI coding agents — the skills it runs, and three
always-on hooks that keep the discipline present by default: a **reflex** that primes every
session, a **rigor router** that injects the matching task protocol per prompt, and a
**grounding check** that mechanically blocks "done" claims on code nothing ever ran. It
turns "the agent said it's done" into "the change was *proven*, at the layer of the claim,
before it shipped." For anyone directing a coding agent through work where being
confidently wrong is expensive.

## What it is

The **dev-rigor-stack** skill routes every unit of work — a fix, a feature, a refactor —
through five gates, then stands a release gate before any version tag. It is
model-agnostic and tool-agnostic: install it as a set of Claude Code skills, or paste the
derived bundle into any other agent.

Two ways it reaches the agent: the **skills are pull-based** (invoked when a task needs
them), and the **hooks are push-based** — the [reflex](plugin/dev-rigor-reflex.md) is a
one-page distillation injected into every session and subagent, the router injects the
task-matching protocol the moment a prompt arrives, and the grounding check runs whether
or not the model remembered the discipline. The discipline is on by default instead of
waiting to be summoned — and its floor is enforced, not requested.

## The loop

Two altitudes:

- **Per-unit loop** (every change): **PLAN** (classify blast radius) → **BUILD**
  (test-first) → **VERIFY** (adversarially break the claim) → **REVIEW** (proportionate
  audit) → **MERGE** (green-path only).
- **Release gate** (before a tag): the full gauntlet driven to **zero findings** +
  claim-refutation on the docs + real deliverable docs + a rollback plan → the **owner's
  go/no-go on the tag**.

Above both sits a **session/machine continuity** bookend, so a multi-day, multi-machine
effort doesn't lose its locked decisions. Full text: [the dev-rigor-stack
skill](skills/dev-rigor-stack/SKILL.md).

## What's in the box

| Component | Role in the stack |
|---|---|
| [`dev-rigor-stack`](skills/dev-rigor-stack/SKILL.md) | the stack — orchestrates the loop + release gate |
| [`coder-tdd-qa`](skills/coder-tdd-qa/SKILL.md) | **BUILD** — test-first engineering + QA standards |
| [`proof-gate`](skills/proof-gate/SKILL.md) | **VERIFY** — adversarial build-and-verify, anti-theater |
| [`audit-lite`](skills/audit-lite/SKILL.md) | **REVIEW** — fast single-pass audit of a small change |
| [`audit-team`](skills/audit-team/SKILL.md) | **REVIEW** — multi-role deep audit for high-blast units |
| [`gauntletgate`](skills/gauntletgate/SKILL.md) | **REVIEW + release** — adversarial stage-gate (lite / walkthrough / full) |
| [`dev-rigor reflex`](plugin/dev-rigor-reflex.md) | **always-on hook** — primes every session with the proof ladder + never-shrink rules; delegates to the six skills above |
| [`rigor router`](plugin/hooks/dev-rigor-router.js) | **always-on hook** — classifies each prompt, injects only the [matching task protocol](plugin/disciplines/) (bug → investigation, UI → grounding, multi-part → decomposition, tag → release); silence otherwise |
| [`grounding check`](plugin/hooks/dev-rigor-ground.js) | **always-on hook** — mechanically blocks ending a session that edited runnable code without ever executing anything |

The six skills and the three hooks are MIT-licensed and authored by the repo owner. The
hooks are the always-on layer (see [The always-on layer](#the-always-on-layer)); the
skills are invoked per gate. The installer installs **all** of them.

`audit-lite`/`audit-team` and `gauntletgate` overlap by design — the same review discipline
in two packagings: the standalone audits are the per-unit **review reports**, while
`gauntletgate` is the release-altitude **advancement gate** (its `lite`/`full` lanes re-run
that discipline self-contained, plus a pass/fail verdict, first-run attestation, and the
`walkthrough` lane). A report vs. a gate.

## Quick start

**Requirements:** Git, and **Node.js** — the three hooks are small Node scripts (see [The
always-on layer](#the-always-on-layer)). The six skills install without Node; only the
hooks need it, and anyone running a coding agent almost certainly has it already.

**As Claude Code skills:**

```sh
git clone https://github.com/scottconverse/dev-rigor-stack
cd dev-rigor-stack
./install.sh                                             # macOS / Linux / Git Bash
powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```

On Windows the `-ExecutionPolicy Bypass` prefix avoids the default *"running scripts is
disabled on this system"* block — a bare `.\install.ps1` may be refused on a locked-down box.

Installs the six skills into `~/.claude/skills` (or `$CLAUDE_CONFIG_DIR/skills` if set)
**and** wires the three always-on hooks (below). If Node is missing, the skills still install
and the installer says the hooks were skipped. Restart your agent to pick them up. Re-running
updates in place — no path assumptions, safe to repeat (a v1.4 install upgrades cleanly; the
new hooks are added, nothing is duplicated).

One flag on both installers:

```sh
./install.sh --target ~/.codex/skills       # install the skills somewhere else, e.g. Codex
./install.ps1 -Target ~/.codex/skills       # (PowerShell equivalent)
```

`--target` sends the skills to any directory — use it for Codex (`~/.codex/skills`) or any
non-default host. With `--target`, only the skills are installed; the always-on hooks are
Claude-specific and are not wired.

**Installing from inside a Cowork or Codex session** (the common case — no terminal): just
tell the agent *"install the dev-rigor-stack from github.com/scottconverse/dev-rigor-stack"*.
It clones the repo, copies `skills/*` into the host's skills directory (`~/.claude/skills`
for Claude, `~/.codex/skills` for Codex), and for a Claude install wires the hooks.
`manifest.json` lists everything that installs.

### The always-on layer

The six skills are pull-based — the agent invokes them when it judges a task calls for
them. The three hooks are push-based, each covering a different failure mode:

- **The reflex** (`SessionStart` + `SubagentStart`) is injected into every session and
  every subagent — a single page: the **proof ladder** (spend rigor sized to blast radius,
  not by habit), the never-shrink rules, and a one-line evidence receipt. It delegates the
  heavy mechanics to the skills.
- **The rigor router** (`UserPromptSubmit`) classifies each prompt and injects **only the
  matching task protocol** from [`plugin/disciplines/`](plugin/disciplines/): bug work gets
  the investigation protocol (reproduce → hypothesize → trace → fix at the root), UI and
  artifact work gets render/run grounding, multi-part work gets decomposition with a
  per-story evidence gate, and release wording gets the release discipline. Each protocol
  injects at most once per session; a prompt that matches nothing gets silence. Routing
  keeps every session's context lean while still delivering the right discipline at the
  right moment — always-on-everything is the failure mode it replaces.
- **The grounding check** (`PostToolUse` + `Stop`) is the only *enforced* layer: it keeps a
  per-session ledger of edits to runnable/viewable files and of execution-tool calls, and
  if a session edited runnable code but never executed or rendered **anything**, it blocks
  the stop — once — with instructions to run the narrowest real check first. It is a
  deliberate floor: it catches provable theater (zero executions ever), and leaves
  "re-run after the last tweak" judgment to the model and the router's protocol.

All three are convenience layers, not dependencies: the full discipline lives in the
`dev-rigor-stack` skill. The installer copies them to `~/.claude/dev-rigor-plugin/` and
adds the hook entries to your `settings.json` (idempotently, preserving your existing
hooks). They **need Node.js** — without node the skills still install and the installer
says the hooks were skipped. Edit the markdown under `~/.claude/dev-rigor-plugin/` (the
reflex page, or any file in `disciplines/`) to tune the wording; the hooks re-read them,
no code change needed.

**For any other agent (ChatGPT, Gemini, Codex, …):**

```sh
./export/export-portable.sh      # or export/export-portable.ps1
```

Produces `portable-bundle.md` — paste it into the agent's system prompt / custom
instructions / `AGENTS.md`. Claude-specific mechanics (the Workflow tool, `/slash`
skills, model routing) stay in and read as plain guidance; nothing is stripped from the
Claude side to serve the export.

Optional: fold [`config/CLAUDE.md`](config/CLAUDE.md) into your own `CLAUDE.md` to apply
the stack automatically. It is a generic template — no machine paths, accounts, or
permissions — but review before adopting.

## When to use it — and when not

Use it for work where a wrong "done" is costly: releases, migrations, security or
compliance changes, anything a real user or consumer hits. **Skip it** for trivial
one-line edits, throwaway prototypes, and cosmetic changes — the overhead only pays for
itself when being wrong is expensive. The stack says so itself, in every gate.

## Docs

- [**User manual**](docs/MANUAL.md) — plain-English and technical, start to finish.
- [**Architecture**](docs/ARCHITECTURE.md) — how the gates and skills compose, with diagrams.

## License

MIT — see [LICENSE](LICENSE). The skills and the hooks are authored by Scott Converse.
Two pieces of prior art, gratefully credited: the reflex's always-on *form* is from
[ponytail](https://github.com/DietrichGebert/ponytail) (DietrichGebert, MIT), and the
per-task-routing + verification-grounding *concepts* were proven transferable to smaller
models by [fablize](https://github.com/fivetaku/fablize)'s Fable-vs-Opus comparison
(fivetaku, MIT). The router and grounding check are clean-room implementations; no code
from either project is used, bundled, or required.
