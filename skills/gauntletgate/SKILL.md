---
name: gauntletgate
metadata:
  version: 1.7.0
description: Run the GauntletGate stage-gate — an adversarial end-of-stage/sprint/release gauntlet a product must pass to advance. Dispatches to three lanes (lite, walkthrough, full) by argument. Use when asked to gate a stage/sprint/release, run the gauntlet, do a readiness/advancement check, or run any of "gauntletgate all | lite | full | walkthrough" or a combination.
---

# GauntletGate

An adversarial **stage-gate**. A product runs the gauntlet to earn the right to
advance to the next stage, sprint, or release. GauntletGate's job is to *block*
advancement until the product is genuinely ready — not to rubber-stamp it.

It is one gate with three lanes. The argument selects which lane(s) run.

## Invocation

Codex Desktop may invoke this skill by name or natural-language request, such as
asking for "GauntletGate lite" or "GauntletGate walkthrough full". In Codex, use the
natural-language request or `$gauntletgate <args>`. In any format, `args` is a
space-separated subset of:

| arg | lane | what it does | weight |
|-----|------|--------------|--------|
| `lite` | Lite | fast single-pass review of a change/slice (first-run-aware) | light, inline |
| `walkthrough` | Walkthrough | first-run-truth + interface-wiring runtime audit | light–medium, inline |
| `full` | Full | 5-role adversarial deep audit (eng/security/perf/tests/docs/QA) | **heavy, multi-agent, billed** |
| `all` | all three | Lite → Walkthrough → Full, then one gate verdict | **heavy** |

- **Bare `gauntletgate` (no arg) = `all`.** The product *is* the full gauntlet.
- **Any combination** is allowed: `gauntletgate lite walkthrough`, `gauntletgate walkthrough full`, etc. Run exactly the named lanes, in canonical order (lite → walkthrough → full).
- Unrecognized args: print this table and stop.

## Before you run — read these (always)

1. `references/shared-backbone.md` — the first-run rule, the environment attestation, and the one severity framework. **Every lane obeys these.**
2. `references/gate-verdict.md` — how the verdict is decided and the honesty rules.
3. `references/report-template.md` — the gate report you must produce.

Then read the lane file(s) the argument selected:

- `lanes/lite.md`
- `lanes/walkthrough.md`
- `lanes/full.md`

## Cost & opt-in signal (state this before running heavy lanes)

`lite` and `walkthrough` are light and run inline. **`full` (and therefore `all`)
fans out a panel of 5 role subagents — it is heavier, it is billed, and it requires
the user's opt-in to multi-agent orchestration.** Before running `full`/`all`, say
so in one line and confirm you have the go-ahead (or that the user invoked it
explicitly). Never silently fire a 5-role fan-out.

## How the lanes compose (canonical order)

1. **Lite** (if selected) — a fast pass. On its own it is a quick check; inside
   `all` it is the warm-up/feeder, not the gate.
2. **Walkthrough** (if selected) — constructs and **verifies the first-run state**,
   loads and runs `$dev-rigor-stack-walkthrough`, walks the public acquisition and
   published installer path in a verified clean machine when release scope applies,
   exercises every inventoried screen/control/path/state, and produces the environment
   attestation + coverage ledger + "can a new user reach the core feature?" verdict.
   Its report is an input to Full.
3. **Full** (if selected) — the 5-role adversarial audit. **It consumes the
   Walkthrough report** (when Walkthrough ran) instead of re-walking the UI, and
   spends its effort on engineering, security, performance, tests, docs, and the
   API/protocol layers Walkthrough doesn't cover.

After the selected lanes finish, **synthesize one gate report** per
`references/report-template.md` and emit the verdict per `references/gate-verdict.md`.

## The verdict (summary — full rules in gate-verdict.md)

- **✅ CLEAR TO ADVANCE** only when the **walkthrough and full lanes both ran** (i.e.
  `all`, or explicitly `walkthrough full`), at **0 Blocker / 0 Critical**, with
  **first-run coverage VALID and the core feature reachable by a new user.**
- **⚠️ PARTIAL CHECK** — any partial run (missing walkthrough or full); explicitly
  *not* an advancement gate. A cheap `lite` run can never masquerade as the gate.
- **⛔ DO NOT ADVANCE** — any Blocker/Critical, or INVALID first-run coverage on a
  product with a first-run surface → + the blocking punch list.

## Operating mode

Audit only by default — do not modify the product's source. Create only temporary
audit artifacts, kept separate from product code. If the app can't run, document the
blocker and continue with static analysis, and say so. Findings are evidence-backed
(route/file:line, expected, actual, evidence, cause, fix, test) — never "some things
are broken." Credit what works; the bar is still the bar.
