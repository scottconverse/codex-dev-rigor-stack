---
name: dev-rigor-stack
description: >
  Standing delivery discipline for ANY coding unit of work — a bug fix, a module,
  a feature, a refactor — plus the release gate that stands before a tag. Apply
  whenever writing, changing, reviewing, verifying, merging, or releasing code, or
  when the user says "dev rigor stack", "apply the rigor stack", "the gates", "run
  this through the stack", "release gate", or asks for systematic/thorough delivery.
  Routes each unit through PLAN → BUILD → VERIFY → REVIEW → MERGE, runs the full
  GauntletGate + claim-refutation + real docs + a rollback plan at the release
  boundary, keeps durable project state across sessions and machines, fans work out with
  bounded Codex subagents or serial fresh-context passes when available, and holds an
  evidence-over-claims honesty line. Not for non-code work.
license: MIT
---

# Standing dev rigor stack v1.6.2

Two altitudes. The **per-unit loop** (gates 1–5) applies to EVERY unit of work — a
fix, a module, a feature. The **release gate** fires once per version, at the tag
boundary, on the aggregate of all merged units. A red result at any gate returns to
the phase that owns it — never route around a gate, never merge or tag past it.

## Standalone entrypoints

Every functional section is independently invokable and also routed by this coordinator:

- `$dev-rigor-stack-continuity`
- `$dev-rigor-stack-plan`
- `$dev-rigor-stack-build` (backward-compatible `$coder-tdd-qa`)
- `$dev-rigor-stack-proof-gate` (backward-compatible `$proof-gate`)
- `$dev-rigor-stack-audit-lite` (backward-compatible `$audit-lite`)
- `$dev-rigor-stack-audit-team` (backward-compatible `$audit-team`)
- `$dev-rigor-stack-walkthrough`
- `$dev-rigor-stack-visitor-audit` (backward-compatible `$visitor-audit`)
- `$dev-rigor-stack-gauntletgate` (backward-compatible `$gauntletgate`)
- `$dev-rigor-stack-merge-gate`
- `$dev-rigor-stack-docs-gate`
- `$dev-rigor-stack-release`

Namespaced entrypoints load the complete canonical sibling contract; they are not compact
rewrites. Missing or unreadable required skills make the affected gate INVALID rather than
silently degrading to a weaker approximation.

Read `references/artifact-contracts.md` before running the stack. Require each stage to
emit or consume the applicable run manifest, claims, findings, coverage, handoff, and gate
result without changing upstream evidence or losing artifact identity.

## Session & machine continuity

Standalone: `$dev-rigor-stack-continuity`.

Continuity, not a gate — a bookend on each side of the loop, sitting above it. Nothing
passes or fails here; it ensures only that durable project state outlives a session or
machine switch.

Durable state — locked decisions, done-criteria, and killed approaches (each with the
reason it was rejected) — lives in a **remote-tracked, append-safe artifact**, never
only in context:

- **The artifact** — remote-tracked (survives session/machine changes) and append-safe,
  so interleaved sessions (Codex Desktop, Codex CLI, Claude, many machines) don't clobber each other; that's
  why a comment-append store beats a lone in-repo file that merge-conflicts. Mechanism is
  the project's to pick, not the skill's — point at one that already exists (a
  project-memory vault such as the `claude-dev-loop` skill if present, a pinned decision
  Issue, or a grep-able in-repo file), never a second store beside one you already have.
- **Start** — pull and read state before entering the loop. Honor settled decisions as
  defaults, but re-validate any resting on a fact that can go stale before relying on it
  — recalled state reflects what was true when written. Don't blindly re-plan what's
  settled; don't blindly obey a rejection whose blocker is now gone.
- **During** — append each locked decision and dead end as it happens; an unlogged
  rejected spike gets re-proposed next session on another machine.
- **End** — writing state, pushing it, and confirming the remote moved is the session's
  LAST action. An unconfirmed push is worse than none — the next machine pulls stale
  state believing it's current; the next Start's clean pull is the proof.

State lives for the project's duration and purges at project retirement — not per release
tag (a decision killed in 0.1 is still worth not reopening in 0.4).

## Per-unit loop (every unit of work)

1. PLAN (main-thread coordinator)
   Standalone: `$dev-rigor-stack-plan`.
   Trace the real code end-to-end before touching it. Climb the reuse-before-build
   ladder (does this need to exist at all? is it already here? does stdlib or the
   platform do it? can it be one line?). Write the acceptance criteria / definition of done and the
   TEST LIST up front. **Classify the unit's blast radius here** — that sets the
   review depth and fires the escalators (below). Blast radius, not diff size, is the
   sizing axis: a one-line change to auth is small in lines and large in blast.

2. BUILD — `$dev-rigor-stack-build` / `$coder-tdd-qa`, test-first
   Write the failing tests from the test list FIRST (or reproduce-red for a bug),
   watching each FAIL before you make it pass — that, not a percentage, is what makes
   a test real. Then minimum code to pass, then refactor green. Static gates:
   types-strict + lint. Coverage is a **gap diagnostic** (flags untested branches),
   not a threshold to clear — the exact policy lives in coder-tdd-qa. Fan-out (test
   generation across combos, sweeping for latent siblings) uses Codex's bounded
   multi-agent tools when available. If no bounded fan-out exists, run the same checks
   serially from a fresh adversarial vantage. If workers produce parallel branches,
   merge them one at a time (linearize) and re-verify after each.

3. VERIFY — `$dev-rigor-stack-proof-gate` / `$proof-gate`
   Adversarially try to BREAK the claim ("this holds", "the race can't occur", "the
   number isn't inflated"). Skeptics run as a workflow on cheap models; the claim only
   survives if they cannot refute it. For a low-blast unit, VERIFY and REVIEW may
   collapse into one adversarial pass — don't run both formally over a one-liner.

4. REVIEW — the coordinator picks the proportionate review lane for what this
   slice touched, and dispatches a bounded subagent when available. Otherwise, run the
   same review serially from a fresh adversarial posture:
   • `$dev-rigor-stack-audit-lite` / `$audit-lite` — default; a scoped diff, a slice,
     an end-of-slice read.
   • `$dev-rigor-stack-audit-team` / `$audit-team` — escalate for high-blast units.
   • `$dev-rigor-stack-walkthrough` — user-facing wiring and black-box newcomer truth:
     acquisition/installer lifecycle when release-scoped, every inventoried screen,
     control, distinct path and visual state, then white-box function wiring.
   • `$dev-rigor-stack-visitor-audit` / `$visitor-audit` — PUBLIC SURFACE lane, only
     when the unit changes an already-live
     README, docs site, landing page, release page, announcement, or published asset.
     Audit the rendered surface after publication, follow every link, and verify quoted
     checksums/sizes against the published asset. Source inspection or CI is not a pass.
   (These are the per-unit *review reports*. GauntletGate as the full advancement
   stage-gate — its `lite`/`full` lanes plus a pass/fail verdict — belongs to the RELEASE
   gate below, not here. Its `lite`/`full` lanes re-run the same discipline as audit-lite
   and audit-team, self-contained, because a gate can't invoke a separate skill mid-run.)
   **What counts as a finding:** a REAL defect. An incorrect finding or tool
   false-positive is classified OUT, with the reason it isn't real — that is the
   boundary of "finding," not a back door. Guard both failure modes: never contort
   correct code to satisfy a wrong tool, and never pass a real defect by calling it a
   false positive.

5. MERGE — green-path only, under standing authorization.
   Standalone evidence decision: `$dev-rigor-stack-merge-gate`.
   Branching model: units land on the integration line via green PR (units → green PR
   → `main`); the **tag** is the release. A green-path unit merge is pre-authorized
   (it cleared gates 1–4): the coordinator merges the slice without asking. NO --admin
   / no override / no bypassing branch protection. One inappropriate red merge
   undermines every green one after it.

## Evaluator-owned exits (goal loops)

Where the platform provides goal-based loops or evaluator-owned task loops, phrase each
BUILD/VERIFY unit as a goal with a **deterministic exit** and an explicit **try cap** —
"tests green", "0 broken links", "Lighthouse ≥ 90, stop after 5 tries" — so a separate
evaluator, not the model that did the work, owns "done". Worker ≠ judge is the same
principle as never-review-your-own-work, applied to the stop condition itself: the
builder can't talk its way past a checker that reruns the check. Criteria a model has
to interpret ("make it good") don't qualify; if the exit can't be checked
deterministically, it isn't a goal exit — route it through VERIFY/REVIEW instead.

## Release gate (once per version, before the tag — a different altitude than a unit)

Fires after the last slice of a version has merged. Everything here runs in a spawned
sub-agent — the coordinator never reviews its own orchestration.

- **Full gauntlet** — `$dev-rigor-stack-gauntletgate all` / `$gauntletgate all` →
  drive all 5 severity levels to **0/0/0/0/0**
  (blocker → nit). Findings route back into the per-unit loop until zero. The only way
  to clear a finding is to **fix it** (not-real findings are classified out per gate
  4). No waiver, no freeze, no deferred backlog.
- **Claim refutation** — `$dev-rigor-stack-proof-gate` against the release *claims*:
  the README, manual,
  and landing page must not promise what the product doesn't do. Gauntletgate catches a
  dead link; only claim-refutation catches an honest-looking page that overclaims.
- **Candidate public-surface pass** — `$dev-rigor-stack-visitor-audit` against rendered
  staging/candidate
  surfaces before the owner go/no-go. Every surface is read in full and every link is
  counted. Unpublished surfaces remain explicitly unproven; source-file review is not a
  substitute for the live pass below.
- **Candidate newcomer/product pass** — `$dev-rigor-stack-walkthrough` against the
  packaged candidate in a verified clean environment. Exercise the installer lifecycle,
  every inventoried screen/control/distinct path/state, visual/accessibility quality, and
  actual interface-to-function wiring. Missing denominators or clean-state proof is INVALID.
- **Deliverable docs real & complete** — `$dev-rigor-stack-docs-gate`: a true README;
  a two-voice user manual
  (non-technical + technical); an architecture section with professional-grade
  drawings; an honest marketing landing page (what it is, how it fits, the value — no
  overclaiming, every link live).
- **Rollback defined before the tag** — name the trigger (what signal reverts) and the
  owner who calls it.
- **STOP → owner go/no-go on the tag.** The coordinator drives everything to ready,
  then hands the decision to the owner. Merging slices is pre-authorized; declaring the
  release real (the tag) is not.
- **Post-deploy closure** — after an authorized tag/publish/deploy, run
  `$dev-rigor-stack-visitor-audit`
  again against the live URLs and actual release assets, cache-busted. Until this is
  clean, do not announce the release as complete, close the release workflow, or retire
  rollback readiness. Consume its acquisition handoff and run full published
  `$dev-rigor-stack-walkthrough` from the public front door through download, clean-machine
  install, complete product journey, update/repair/uninstall, and visual/UI audit. A dead
  download, false current-version claim, wrong checksum, invalid coverage ledger, or broken
  newcomer journey is a release blocker and routes to correction or rollback.

The complete standalone release coordinator is `$dev-rigor-stack-release`.

Cost of pure-zero: with no freeze, a nit found after the gauntlet ran moves the tagged
artifact one commit off the one you proved. Re-run the gate **at the blast radius of
the fix** — a nit re-runs only the lane it touched, not the full gauntlet — enough to
restore tag == proven-artifact. Never skip it: skipping saves a bounded, scopeable cost
but ships an unverified delta and breaks the invariant the tag stands for —
release-altitude theater, however small the fix looked. So pure-zero raises the value of
driving every slice to zero at per-unit REVIEW; pure-zero and thorough per-unit review
are the same bet.

## Owner vs coordinator decisions

The coordinator (main-thread) decides everything reversible, in-spec, and
in-sandbox, and **never originates an owner decision** on its own initiative. The line
is a principle, not just a list: a decision is the owner's when it is **irreversible,
crosses a trust boundary, or exposes external value** — i.e. being wrong costs
something the model can't take back or wasn't authorized to spend. Instances:
1. **Scope & intent** — what to build, what "done" means, changing acceptance criteria.
2. **Crossing into the world** — publishing, tagging/releasing, deploying,
   sending/posting externally, spending money, deleting data the model didn't create.
   (Merging a reviewed green PR to the integration line is NOT this; a direct push
   bypassing PR/CI is.)
3. **Risk acceptance / gate overrides** — shipping with a known blocker, merging red,
   bypassing a gate.
4. **Trust-boundary & value calls** — security, privacy, licensing, legal/ethical/
   reputational weight.
5. **Go / no-go / priority / budget.**

Reconciliation (keeps this from meaning "ask permission constantly") — it's about who
**originates** the call:
- **Explicit request** ("tag 1.6.2") = the owner deciding live → execute now, no "are
  you sure."
- **Standing authorization** (green-path unit merges are pre-approved) = decided ahead
  → proceed.
- **Neither** = surface with a recommendation, and hold.
Concretely: green-path unit merge = standing authorization; the release tag = owner
decision, every time.

## Documentation discipline

Standalone gate: `$dev-rigor-stack-docs-gate`.

- **Deliverable docs — real and professional, always.** README, two-voice manual
  (non-technical + technical), architecture + professional drawings, honest landing
  page. Produced/updated at the release gate; per-unit, update only the deliverable doc
  a slice actually changes.
- **Process artifacts — ephemeral, never hoarded.** Audits, status docs, handoffs,
  scratch — keep out of the repo (or a transient dir) and purge them. Over-documenting
  the wrong thing buries a repo in stale audits; YAGNI applies to docs too.
- **Exception — evidence outlives its decision, not the model's convenience.** The
  aggregate gauntlet report is not a purgeable process artifact while a live decision
  rests on it: it persists through the tag and the rollback window, then purges. A
  go/no-go must run on evidence in hand, not memory of it.

## Dependencies & degrade-if-missing

The Codex installer bundles and installs every namespaced standalone stage plus the
backward-compatible **coder-tdd-qa, proof-gate, gauntletgate, audit-lite, audit-team, and
visitor-audit** entrypoints, so a normal install has every lane present. It also installs
and wires the active Codex lifecycle layer: SessionStart/SubagentStart reflex injection,
UserPromptSubmit routing, PostToolUse grounding, and Stop/SubagentStop evidence checks.
Codex requires the user to review and trust non-managed hooks through `/hooks`; an
untrusted, disabled, missing, or failed hook must be reported as unenforced, never
represented as active. The full discipline remains in the skills, while the hooks make
the universal reflex, task routing, run-after-latest-edit check, and evidence receipt
mechanical. The degrade path is a fallback for
the unusual case (a partial install, stale install, or a skill
manually removed): if a lane's skill is absent, the coordinator runs the equivalent
discipline inline, **says so**, and still uses a fresh-context serial pass or bounded
subagent when possible — degrade never means the coordinator reviews its own work.

**audit-lite / audit-team vs. gauntletgate** overlap by design — the same review
discipline in two packagings. The standalone audits are the per-unit *review reports*
(gate 4); gauntletgate is the release-altitude *advancement gate*, and its `lite`/`full`
lanes re-run that same discipline self-contained (a gate can't invoke a separate skill
mid-run) plus a pass/fail verdict, a first-run attestation, and the `walkthrough` lane.
Same discipline, different altitude — a report vs. a gate.

## Cross-cutting, always on

- Cheap or bounded workers for fan-out when the host provides them; keep judgment in the
  coordinator. Ultracode is BUDGET-GATED, not a fixed setting — OFF when
  budget is tight or being paced (don't default to "a workflow for everything"), ON
  when budget is ample. If the user has turned ultracode ON this session, that choice
  wins — honor it, never override it back to off.
- Worker tier calibration (fan-out only): every worker states its tier and moderates
  rigor by it — the paste-in wording is the fan-out preamble below.
- Open-source-first: verify licenses; prefer MIT/Apache/MPL over BUSL/SSPL/closed.
- Evidence over claims: reproduce before fixing, verify with numbers, never claim
  beyond the evidence, own mistakes plainly.
- Code minimalism governs CODE SCOPE ONLY — reuse-before-build and the shortest working
  diff shrink the *code*, never a gate, a CI check, verification, or subagent discipline.

The stack FLEXES to the unit — sequential fixes skip fan-out, low-blast units collapse
VERIFY+REVIEW, user-invisible changes skip the walkthrough lane — but the gates that
apply are not optional, and a skip is stated with a reason, never silent.

---

Fan-out worker preamble (paste the matching line at the top of each agent() prompt):

[worker] You are a bounded worker. Your known failure mode is passing your own "looks
right" review instead of running a check that can fail. For every claim, run the real
check and paste the exact command and its verbatim output.

[mechanical worker] You are a worker on a mechanical task. Every result needs a named
artifact — exact command + output. Do not claim "verified" from inspection. If this
task turns out to need judgment or synthesis, stop and say so; do not guess.
