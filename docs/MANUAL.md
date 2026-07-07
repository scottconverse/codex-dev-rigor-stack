# dev-rigor-stack — user manual

This manual has two halves. The first is for **anyone** — no code required. The second is
for **engineers** running the stack day to day. Read whichever fits; they cover the same
thing at different depths.

---

## Part 1 — For everyone

### The problem it solves

AI coding agents are confident. Confidence is not correctness. An agent will say "done"
when what it really means is "I wrote code that looks right" — which is a different claim
from "I proved it runs" and different again from "I proved it's correct." Most of the cost
of AI-assisted development hides in that gap: a change that looked finished, passed a
check that couldn't fail, and broke something real once it shipped.

The dev-rigor-stack is a discipline that closes the gap. It makes "done" mean **proven** —
demonstrated by exercising the real thing, the way a real user or consumer hits it, before
anyone calls it finished.

### The idea in one picture

Every change walks through a short line of gates. Nothing advances on a claim; it advances
on evidence. The heaviest checks happen right before you call a release *real* — and that
final call, "tag it, we're shipping," is always a **human's** decision, never the agent's.

Between work sessions — even across different days and different computers — the important
decisions ("we chose X", "we ruled out Y because Z") are written down somewhere permanent,
so the next session doesn't reinvent or undo them.

### Who it's for

Anyone directing an AI coding agent on work that matters: a solo developer shipping a
product, a team standardizing how their agents work, or someone who has simply been burned
once by a confident "all done" that wasn't.

### What a day with it looks like

You ask the agent for a change. Instead of diving in, it first says what "done" looks like
and how it will check it. It writes a test that fails, then makes it pass. It then tries to
*break* its own result rather than admire it. It runs a review sized to how risky the
change is — a quick pass for a small fix, a deep one for anything touching security or
money. It merges only when the automated checks are genuinely green. And when a whole
version is ready, it runs the full gauntlet, writes real documentation, and then **stops
and asks you** whether to make the release official. You stay in control of the decisions
that are actually yours; the agent does the disciplined work in between.

---

## Part 2 — For engineers

### Two altitudes

- **Per-unit loop** — applies to every unit of work (a fix, a module, a feature).
- **Release gate** — fires once per version, at the tag boundary, over the aggregate of
  all merged units.

A red result at any gate returns to the phase that owns it. You never route around a gate
or merge/tag past it. See [ARCHITECTURE.md](ARCHITECTURE.md) for the flow diagrams.

### The per-unit gates

1. **PLAN** — trace the real code end-to-end, reuse before building, write the
   done-criteria and the test list, and **classify blast radius**. Blast radius — not diff
   size — is the sizing axis: a one-line change to auth is small in lines and large in
   blast, and gets the deep treatment.
2. **BUILD** (`coder-tdd-qa`) — test-first. Write the failing test and *watch it fail*
   before making it pass; that, not a coverage percentage, is what proves the test is
   real. Coverage is a gap diagnostic, not a threshold to game.
3. **VERIFY** (`proof-gate`) — adversarially try to *break* the claim ("this holds," "the
   race can't occur," "the number isn't inflated"). The claim survives only if it can't be
   refuted. For a low-blast unit, VERIFY and REVIEW may collapse into one pass.
4. **REVIEW** — the coordinator picks the proportionate lane for what the slice touched:
   `audit-lite` (default), `audit-team` (high-blast), or `gauntletgate walkthrough`
   (user-facing wiring — dead links, dead buttons, broken flows). A *finding* is a real
   defect; a tool false-positive is classified out with the reason it isn't real — never
   contort correct code to satisfy a wrong tool, never pass a real defect as a "false
   positive."
5. **MERGE** — green-path only. Units land on the integration line via green PR; a
   green-path merge is pre-authorized (it cleared gates 1–4). No `--admin`, no override, no
   bypassing branch protection.

### The release gate

Before a version tag, on the aggregate — everything here runs in a spawned sub-agent so
the coordinator never reviews its own orchestration:

- **Full gauntlet** (`gauntletgate all`) → drive all five severity levels to
  **0/0/0/0/0**. The only way to clear a finding is to fix it. No waivers, no freeze, no
  deferred backlog. A nit found after the gauntlet re-runs the gate **at the blast radius
  of the fix** (never skip — skipping ships an unverified delta and breaks the invariant
  that the tag equals the artifact you proved).
- **Claim refutation** (`proof-gate` against the docs) — the README, manual, and landing
  page must not promise what the product doesn't do. The gauntlet catches a dead link;
  only claim-refutation catches an honest-looking page that overclaims.
- **Deliverable docs real & complete** — README, a two-voice user manual, an architecture
  section with drawings, an honest landing page.
- **Rollback defined** — name the trigger and the owner before tagging.
- **Owner go/no-go** — the coordinator drives everything to ready, then hands the tag
  decision to the owner.

### Session & machine continuity

Above the loop, a bookend (not a gate — nothing passes or fails). Durable state — locked
decisions, done-criteria, killed approaches with their reasons — lives in a
**remote-tracked, append-safe artifact**, never only in context.

- **Start** — pull and read state; honor settled decisions as defaults, but re-validate
  any resting on a fact that can go stale before relying on it.
- **During** — append each decision and dead end as it happens.
- **End** — write, push, and **confirm the remote moved** as the session's last action. An
  unconfirmed push is worse than none: the next machine pulls stale state believing it's
  current.

The mechanism is the project's to pick — a project-memory vault, a pinned decision Issue,
or a grep-able in-repo file — as long as it's remote-tracked and append-safe. Point at one
that already exists; don't spin up a second store beside it.

### Owner vs. coordinator

The coordinator (top model / main thread) decides everything reversible, in-spec, and
in-sandbox, and never originates an **owner decision**: scope/intent, crossing into the
world (publishing, tagging, deploying, spending, deleting), risk acceptance / gate
overrides, trust-boundary and value calls, and go/no-go/budget. Owner decisions are made
by explicit request ("tag it" → do it now) or standing authorization (green merges are
pre-approved); absent either, the coordinator surfaces the call and holds.

### Fan-out and cost

Heavy or parallel work fans out to cheaper models via the host's workflow/orchestration
tool — never a bare recursing agent. Each worker states its tier and moderates rigor by it
(the fan-out preamble ships in the skill). The coordinator stays lean.

### Install, configure, export

- **Install**: `./install.ps1` (Windows) or `./install.sh` (macOS/Linux/Git Bash).
  Installs the six skills into `~/.claude/skills` (or `$CLAUDE_CONFIG_DIR/skills`) **and**
  wires the always-on **dev-rigor reflex** — a one-page distillation of this discipline — as
  a SessionStart hook under `~/.claude/dev-rigor-plugin/`. The reflex hook needs Node.js;
  without it the skills still install and the installer reports the hook as skipped.
  Idempotent — re-run to update. One flag on both:
  - `--target <dir>` / `-Target <dir>` — install the skills into any directory, e.g. Codex's
    `~/.codex/skills`. With `--target`, only skills are installed; the always-on reflex hook
    is Claude-specific and is not wired.
- **Installing from inside a Cowork or Codex session** (the common case, no terminal): tell
  the agent to install the stack from the repo. It copies `skills/*` into the host's skills
  directory (`~/.claude/skills` for Claude, `~/.codex/skills` for Codex) and, for a Claude
  install, wires the reflex hook. `manifest.json` lists everything that installs.
- **Configure**: fold [`config/CLAUDE.md`](../config/CLAUDE.md) into your own `CLAUDE.md`
  to auto-apply the stack. Generic template; review before adopting.
- **Cross-AI export**: `./export/export-portable.sh` (or `.ps1`) writes
  `portable-bundle.md` — the skill bodies concatenated for pasting into another agent. The
  Claude-native skills stay canonical; the bundle is derived, so improving the Claude side
  is never held back to serve the export.

### Dependencies & degrade

The stack expects its sibling skills co-installed (`coder-tdd-qa`, `proof-gate`, the
`gauntletgate` / `audit-lite` / `audit-team` family). The always-on reflex is a convenience
layer, not a dependency — the full discipline lives in the skill. If a lane's skill is
absent, the coordinator runs the equivalent discipline inline, says so, and still spawns a
fresh sub-agent — degrade never means self-review.
