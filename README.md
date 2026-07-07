# dev-rigor-stack

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A six-gate delivery discipline for AI coding agents — and the skills it runs. It turns
"the agent said it's done" into "the change was *proven*, at the layer of the claim,
before it shipped." For anyone directing a coding agent through work where being
confidently wrong is expensive.

## What it is

The **dev-rigor-stack** skill routes every unit of work — a fix, a feature, a refactor —
through five gates, then stands a release gate before any version tag. It is
model-agnostic and tool-agnostic: install it as a set of Claude Code skills, or paste the
derived bundle into any other agent.

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

| Skill | Role in the stack |
|---|---|
| [`dev-rigor-stack`](skills/dev-rigor-stack/SKILL.md) | the stack — orchestrates the loop + release gate |
| [`coder-tdd-qa`](skills/coder-tdd-qa/SKILL.md) | **BUILD** — test-first engineering + QA standards |
| [`proof-gate`](skills/proof-gate/SKILL.md) | **VERIFY** — adversarial build-and-verify, anti-theater |
| [`audit-lite`](skills/audit-lite/SKILL.md) | **REVIEW** — fast single-pass audit of a small change |
| [`audit-team`](skills/audit-team/SKILL.md) | **REVIEW** — multi-role deep audit for high-blast units |
| [`gauntletgate`](skills/gauntletgate/SKILL.md) | **REVIEW + release** — adversarial stage-gate (lite / walkthrough / full) |

All six are MIT-licensed and authored by the repo owner. Alongside them, an always-on
**dev-rigor reflex** — a one-page distillation of the discipline — installs as a
SessionStart hook and primes every coding session (see [The always-on
reflex](#the-always-on-reflex)).

## Quick start

**As Claude Code skills:**

```sh
git clone https://github.com/scottconverse/dev-rigor-stack
cd dev-rigor-stack
./install.ps1     # Windows
./install.sh      # macOS / Linux / Git Bash
```

Installs the six skills into `~/.claude/skills` (or `$CLAUDE_CONFIG_DIR/skills` if set)
**and** wires the always-on reflex hook (below). Restart your agent to pick them up.
Re-running updates in place — no path assumptions, safe to repeat.

One flag on both installers:

```sh
./install.sh --target ~/.codex/skills       # install the skills somewhere else, e.g. Codex
./install.ps1 -Target ~/.codex/skills       # (PowerShell equivalent)
```

`--target` sends the skills to any directory — use it for Codex (`~/.codex/skills`) or any
non-default host. With `--target`, only the skills are installed; the always-on reflex hook
is Claude-specific and is not wired.

**Installing from inside a Cowork or Codex session** (the common case — no terminal): just
tell the agent *"install the dev-rigor-stack from github.com/scottconverse/dev-rigor-stack"*.
It clones the repo, copies `skills/*` into the host's skills directory (`~/.claude/skills`
for Claude, `~/.codex/skills` for Codex), and for a Claude install wires the reflex hook.
`manifest.json` lists everything that installs.

### The always-on reflex

The six skills are pull-based — the agent invokes them when it judges a task calls for
them. The **reflex** is push-based: it is injected into every session and every subagent, so
the discipline is present by default instead of waiting to be summoned. It is a single page —
persona, the **proof ladder** (spend rigor sized to blast radius, not by habit), the
never-shrink rules, and a one-line evidence receipt — and it delegates the heavy mechanics to
the skills. It is a convenience layer, not a dependency: the full discipline lives in the
`dev-rigor-stack` skill.

The installer copies it to `~/.claude/dev-rigor-plugin/` and adds a `SessionStart` +
`SubagentStart` entry to your `settings.json` (idempotently, preserving your existing
hooks). It **needs Node.js** — without node the skills still install and the installer says
the hook was skipped. Edit `~/.claude/dev-rigor-plugin/dev-rigor-reflex.md` to tune the
wording; the hook re-reads it, no code change needed.

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

MIT — see [LICENSE](LICENSE). The skills and the reflex are authored by Scott Converse.
The reflex's always-on *form* is prior art from
[ponytail](https://github.com/DietrichGebert/ponytail) (DietrichGebert, MIT) — no ponytail
code is used, bundled, or required.
