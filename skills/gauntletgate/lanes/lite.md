# Lane: Lite

A single-pass review for a small change, a slice, or a recent diff — same severity
framework and honesty bar as the heavy lanes, compressed into one sitting. Built to
run *between* fixes during a stage without breaking flow. On its own it is a quick
check; inside `gauntletgate all` it is the warm-up/feeder, **not** the advancement
gate.

Apply `references/shared-backbone.md` (severity framework always; the first-run rule
+ attestation **when the change touches a first-run / onboarding / dependency /
empty-state surface**).

## Scope first (one question, max)
Confirm what's under review: a diff/PR, a bug fix, or a small feature — file list +
description. If already given, proceed.

## Read everything in scope
Read the changed files in full and enough adjacent code to understand call sites and
shared state. Skim tests for the affected paths. If a UI is involved and you can run
it, run it; otherwise say so honestly.

## The five dimensions (compressed)
| Dimension | Check | Skip if |
|---|---|---|
| Correctness & Security | Does it do what it claims? Any reachable security issue or data hazard? | pure cosmetic |
| **First-run** | **If the change touches onboarding/setup/a dependency/auth/empty-state: try it as a brand-new user with that dependency ABSENT** (shared backbone §1). A new-user dead-end on the core feature is a Blocker. | the change touches no first-run surface |
| UX | Visible states, copy, error paths, accessibility regressions | no UI in the diff |
| Docs | If behavior changed, are README/inline/API docs still accurate? | behavior identical |
| Tests | Is there a test for the fix? Existing tests still valid? Regression risk? | never skip — at minimum note absence |
| Runtime | Does the affected path actually run? Smoke-test it. | static-only, no runtime path |

Don't pad. If a dimension doesn't apply, say so in one line and move on.

## Output (single report)
- TL;DR verdict — ship / ship-with-caveats / don't ship — honest.
- Severity roll-up + findings (dimension, severity, evidence, why-it-matters, fix
  path; blast radius for Blocker/Critical).
- A one-line environment note (ran against: fresh/provisioned; dependency
  present/absent — verified how) when a first-run surface was in scope.
- **What's working** (specific, credited).
- **Escalation recommendation** — escalate to `full` (or `all`) if: 1+ Blocker, 3+
  Criticals, findings span 4–5 dimensions deeply, the root cause looks
  architectural, or **a first-run dead-end was found.**

## Gate role
A `lite`-only run is always a **PARTIAL CHECK**, never CLEAR TO ADVANCE
(`references/gate-verdict.md`). It informs; it does not greenlight a stage.
