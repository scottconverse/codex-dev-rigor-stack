---
name: proof-gate
metadata:
  version: 1.7.0
description: >
  Adversarial build-and-verify loop for high-stakes or trust-sensitive delivery
  work — releases, migrations, security/compliance changes, anything where a
  confident-but-wrong "done" claim is expensive. Kills verification theater:
  checks that can't fail, "done" claims that outrun the evidence, and
  plausible-but-wrong work that survives a shallow review. Use whenever the
  user asks to "prove it works," wants an "anti-theater" or "adversarial
  verify" pass, asks for a "real proof bar," "honest-red" reporting, to
  "drive to zero," a "cleanroom" or clean-environment gate, to "coordinate
  subagents to build and verify," or says "don't overclaim." Also trigger
  when coordinating a coordinator model with cheaper worker/builder models
  plus independent verifier agents, or when gating a merge/release against
  fabricated or self-reported evidence.
license: MIT
---

# Proof-Gate

A delivery loop for high-stakes work where "it looks done" and "it is proven done" are different things. It exists to kill verification theater: checks that pass because they can't fail, "done" claims that outrun the evidence, and plausible-but-wrong work that survives a shallow review.

## The Loop (one screen)

Everything rests on one rule: **a claim is proven only by exercising the real artifact end-to-end through the path a real user or consumer hits.** A green check is not proof; a check you've confirmed can go red is.

1. **Build** — a builder produces the change.
2. **Independent adversarial verify** — a separate verifier, fresh context, told to REFUTE not confirm, independently re-derives the evidence from scratch and tries to break the claim. It never trusts the builder's asserted evidence or notes — it reproduces everything itself.
3. **Fix-loop** — findings route back to the builder until the claim is clean, or an honest blocker is declared.
4. **Gated merge** — a coordinator merges only once the real proof bar (below) is met.

## When NOT to use this

Trivial edits, cosmetic changes, throwaway prototypes, anything where a wrong "done" claim costs nothing. The overhead only pays for itself when being wrong is expensive.

## The Honesty Contract

Adopt this verbatim in all reporting:

- Never claim "done," "verified," "passing," or "fixed" beyond the evidence actually in hand.
- Distinguish three different claims: *wrote the code* ≠ *proved it runs* ≠ *proved it's correct*.
- If a step was skipped, say so explicitly.
- If a check is red for a legitimate reason (missing hardware, external dependency, wall-clock gate), leave it **honest-red** — never fake it green.
- Report the actual failing output itself, not a summary of it.
- **Drive to zero**: no "deprioritized" or "revisit later" shelving of in-scope work. Finish it, or hand back the specific blocker and why — never a vague defer.

## Step 0 — Honest Scope Audit (before any fixing)

For every item in scope, produce a status: **implemented / partial / stub / missing**, each with `file:line` evidence. While doing this, actively hunt the fabricated-proof pattern — tests or checks that assert success without exercising the thing they claim to check. A passing suite is not trust by itself; it's trust only once you've confirmed the suite can go red.

## The Real Proof Bar vs. Verification Theater

A claim only counts as proven if it clears the bar for its domain:

| Domain | Theater (looks like proof, isn't) | Real Proof Bar |
|---|---|---|
| Web / API | Route returns 200; happy-path test passes | Fetch over a real socket from a clean client; assert the real response body and observable behavior |
| Spec / contract compliance | Trusting that a cited doc/PDF says what the code claims | Fetch the actual upstream spec/standard/PDF and diff the implementation against it |
| Video / media / binary output | Byte-count check or happy-path log | Run a real decoder/validator on the real output (e.g. a prober confirming codec, resolving segments, keyframe cadence) |
| Data / ML | Pipeline's own self-reported metrics | Check against a held-out oracle or independent ground truth |
| The check itself | A check that has never been seen to fail | Mutation-test it: deliberately break the artifact and confirm the check goes red |

If a claim can't be mapped onto one of these — or an equivalent, evidenced way of hitting the real consumer path — it isn't proven yet.

## Coordinator / Worker Orchestration

- **Coordinator**: plans the work, owns the scope audit, holds the honesty line, gates every merge. Spends few premium tokens; does not do heavy building or first-pass verification itself.
- **Workers** (cheaper models, run in parallel where available): do the heavy building, and do the independent adversarial verification.
- **Cost discipline**: coordinator stays lean, workers scale out. If you hit the budget guardrail, stop and leave an honest status doc — never overclaim to close it out. Parallelism is a performance optimization, not a correctness requirement.
- **Graceful degradation**: if parallel subagents aren't available, run the identical loop serially. The verifier still adopts a deliberately fresh, adversarial vantage — new context, re-derives evidence from scratch, is instructed to refute rather than confirm, and does **not** read the builder's notes or prior assertions. The coordinator still gates.
- **Serial-merge linearization**: when multiple worker branches land together, don't batch-merge and hope. Reconcile collisions deterministically (sequence numbers, generated files, migrations) and merge **one branch at a time**, re-verifying after each before starting the next.

## Release / Cleanroom Gate Checklist

The final gate reproduces from a genuinely clean environment (fresh VM, container, or account) and exercises the real consumer path — not the dev's warm box with hidden state. This is the only gate that reliably catches "works on my machine" and installer/packaging-wiring failures.

- [ ] Provisioned a genuinely clean environment — no leftover dev state, caches, or config
- [ ] Install/setup performed exactly as a real consumer would perform it
- [ ] Core path exercised end-to-end, not just imported/loaded
- [ ] Output validated with a real-bar check from the table above, not a log read
- [ ] Every verification check used here was mutation-tested (see below)
- [ ] No remaining honest-red items for in-scope work
- [ ] Any skipped check or honest-red is reported with the exact failing output and reason, not silently green or summarized
- [ ] Honest status document exists: what was proven, what evidence supports it, what was not proven

## Self-Check: Mutation-Test the Verifier

Required before trusting any non-trivial verification step:

1. Deliberately introduce a known, detectable defect into the artifact under test (wrong byte layout, off-by-N segment timing, a hardcoded "always pass," a missing rate-limit, a race condition, fabricated spec data, etc.).
2. Run the exact same verifier/check that will be used in the real run.
3. Confirm it goes red and surfaces the specific injected defect with useful diagnostic output.
4. Only after this succeeds do you trust a green result from that check.

If the check stays green on a deliberately broken artifact, it's theater — rebuild it before using it to gate anything. This is the single most important guard against plausible-but-wrong verification.

---

**License**: MIT — free to use, modify, and redistribute for any purpose.
