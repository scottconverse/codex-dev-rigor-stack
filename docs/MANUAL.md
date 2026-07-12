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

Three small helpers run in the background the whole time. One reminds the agent of the
discipline at the start of every session. One notices what *kind* of task you just asked
for — a bug fix, a visual change, a big multi-part feature, a release — and slips the
agent the matching checklist for exactly that kind of work. And one is a tripwire: if the
agent edited real code but never once ran anything before saying it was finished, it is
stopped and told to go run it first. That last one isn't a suggestion — it's enforced.

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
   If the unit changes an already-published README, docs site, landing page, release page,
   announcement, or asset, add `visitor-audit` after publication. It reads the rendered
   surface and follows every link; source inspection and CI do not substitute for it.
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
- **Candidate public-surface audit** (`visitor-audit`) — read rendered staging/candidate
  surfaces in full, count and follow every link, and verify candidate assets before
  go/no-go. Anything not yet published remains explicitly unproven.
- **Rollback defined** — name the trigger and the owner before tagging.
- **Owner go/no-go** — the coordinator drives everything to ready, then hands the tag
  decision to the owner.
- **Live post-deploy closure** — after the authorized tag/publish/deploy, run
  `visitor-audit` against cache-busted live URLs and actual release assets. Until clean,
  do not announce completion, close the release workflow, or retire rollback readiness.

### The always-on layer (three hooks)

The skills are pull-based; three Node hooks are push-based and cover different failure
modes:

- **Reflex** (`SessionStart` + `SubagentStart`) — injects a one-page distillation of the
  discipline (proof ladder, never-shrink rules, evidence receipt) into every session and
  subagent.
- **Rigor router** (`UserPromptSubmit`) — classifies each prompt and injects only the
  matching task protocol from `plugin/disciplines/`: investigation (reproduce →
  hypothesize → trace → root-cause fix) for bug work, render/run grounding for UI/artifact
  work, decomposition + per-story evidence for multi-part work, release discipline for tag
  work. At most once per discipline per session; no match → silence. This keeps context
  lean while landing the right discipline at the right moment.
- **Grounding check** (`PostToolUse` + `Stop`) — the only *enforced* layer. It ledgers
  edits to runnable/viewable files and execution-tool calls per session; if runnable code
  was edited but nothing was ever executed or rendered, it blocks the stop once and asks
  for the narrowest real check. Deliberate floor: it catches provable theater (zero
  executions ever) and leaves finer judgment to the model.

Tune any of them by editing the markdown under `~/.claude/dev-rigor-plugin/` — the hooks
re-read it, no code change needed. The hooks ship with an assert-based self-check:
`node plugin/hooks/test-hooks.js`.

### Evaluator-owned exits (goal loops)

Where the host provides goal-based loops (e.g. Claude Code's `/goal`), phrase each
BUILD/VERIFY unit as a goal with a deterministic exit and a try cap — "tests green, stop
after 5 tries" — so a separate evaluator, not the model that did the work, owns "done".
Worker ≠ judge, applied to the stop condition itself. Exits a model must interpret ("make
it good") don't qualify; route those through VERIFY/REVIEW instead.

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

- **Requirements**: Git, and **Node.js** for the hooks (three small Node scripts).
  The seven skills install without Node; only the hooks need it — and anyone running a coding
  agent almost certainly has it already.
- **Install**: `./install.sh` (macOS/Linux/Git Bash), or on Windows
  `powershell -ExecutionPolicy Bypass -File .\install.ps1` (the prefix avoids the default
  *"running scripts is disabled"* block). Installs the seven skills into `~/.claude/skills` (or
  `$CLAUDE_CONFIG_DIR/skills`) **and** wires the three always-on hooks (reflex, rigor
  router, grounding check) under `~/.claude/dev-rigor-plugin/`. If Node is missing, the
  skills still install and the installer reports the hooks as skipped. Idempotent — re-run
  to update; a v1.4 install upgrades cleanly (new hooks added, nothing duplicated). One
  flag on both:
  - `--target <dir>` / `-Target <dir>` — install the skills into any directory, e.g. Codex's
    `~/.codex/skills`. With `--target`, only skills are installed; the always-on hooks are
    Claude-specific and are not wired.
- **Installing from inside a Cowork or Codex session** (the common case, no terminal): tell
  the agent to install the stack from the repo. It copies `skills/*` into the host's skills
  directory (`~/.claude/skills` for Claude, `~/.codex/skills` for Codex) and, for a Claude
  install, wires the hooks. `manifest.json` lists everything that installs.
- **Configure**: fold [`config/CLAUDE.md`](../config/CLAUDE.md) into your own `CLAUDE.md`
  to auto-apply the stack. Generic template; review before adopting.
- **Cross-AI export**: `./export/export-portable.sh` (or `.ps1`) writes
  `portable-bundle.md` — the skill bodies concatenated for pasting into another agent. The
  Claude-native skills stay canonical; the bundle is derived, so improving the Claude side
  is never held back to serve the export.

### Dependencies & degrade

The installer bundles and installs all the sibling skills together (`coder-tdd-qa`,
`proof-gate`, the `gauntletgate` / `audit-lite` / `audit-team` family, and
`visitor-audit`) — a normal install
has every lane present. The always-on hooks install alongside; they're convenience layers,
not dependencies — the full discipline lives in the skill. The degrade path is only a
fallback for a partial or `--target` install: if a lane's skill is absent, the coordinator
runs the equivalent discipline inline, says so, and still spawns a fresh sub-agent —
degrade never means self-review.

**audit-lite / audit-team vs. gauntletgate.** These overlap by design — the same review
discipline in two packagings. `audit-lite` (light) and `audit-team` (deep, five-role) are
standalone *review reports* used at the per-unit REVIEW gate. `gauntletgate` is the
*advancement stage-gate* used at the release boundary: its `lite`/`full` lanes re-run that
same discipline self-contained (a gate can't invoke a separate skill mid-run) and add a
pass/fail verdict, a first-run attestation, and the `walkthrough` lane. Same discipline,
different altitude — a report vs. a gate.
