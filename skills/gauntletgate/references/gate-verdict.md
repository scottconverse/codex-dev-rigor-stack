# GauntletGate — the gate verdict

GauntletGate is a **stage-gate**: a product runs the gauntlet to earn the right to
advance to the next stage / sprint / release. The verdict is the whole point. It
must be honest about *what was actually run* — a cheap partial check can never
masquerade as the full gate.

---

## The two verdict types

### CLEAR TO ADVANCE  (only `all`, or `walkthrough full` together)

Emit **CLEAR TO ADVANCE** only when **all** of the following hold:

- Both the **walkthrough** and **full** lanes ran (this is what `gauntletgate all`
  does; `lite` is a feeder, not part of the advancement bar).
- Severity is **0 Blocker / 0 Critical** across every lane.
- **First-run coverage is VALID** (the environment attestation is filled with
  verified facts) **and a brand-new user can reach the core feature.**

Majors/Minors/Nits may remain in a CLEAR verdict, but they ride along on the
punch list / watchlist; they don't block advancement. (Projects that hold a higher
bar — e.g. "0/0/0/0/0 to advance" — say so at invocation and the gate honors it.)

### PARTIAL CHECK  (any run missing a required lane)

Any run that does **not** include both walkthrough and full — e.g. `lite`,
`walkthrough`, `full` alone, or `lite walkthrough` — emits a **PARTIAL CHECK**
verdict, never CLEAR TO ADVANCE. The report must say, in the first line:

> ⚠️ PARTIAL CHECK — lanes run: `<list>`. This is **not** an advancement gate.
> Run `gauntletgate all` for a clear-to-advance decision.

A PARTIAL CHECK still reports its findings and its own pass/fail *within the lanes
it ran* — it just cannot greenlight advancement.

### DO NOT ADVANCE

Any run (full or partial) that finds a **Blocker or Critical**, or whose first-run
coverage is **INVALID** while a UI/onboarding/dependency surface is in scope, emits
**DO NOT ADVANCE** with the blocking punch list that must be cleared before a re-run.

---

## What every verdict carries

1. **The verdict line** — CLEAR TO ADVANCE / PARTIAL CHECK / DO NOT ADVANCE — plus
   the lanes that ran and the lanes that did not.
2. **First-run line** — reaches core feature ✅ / dead-ends a new user ❌ / NOT
   VERIFIED (with first-run coverage VALID/INVALID).
3. **Severity roll-up** — Blocker / Critical / Major / Minor / Nit across all lanes
   that ran.
4. **The environment-provisioning attestation** (from the shared backbone), **with
   its linked on-disk evidence artifacts** — or an explicit statement that it could
   not be produced and why. An attestation with no linked artifact is UNVERIFIED →
   first-run coverage INVALID → the run cannot be CLEAR TO ADVANCE.
5. **The blocking punch list** (what must clear to advance) and the **watchlist**
   (what to fix next).

---

## Honesty rules (do not violate)

- A `lite`-only or any partial run is **never** CLEAR TO ADVANCE. Label it PARTIAL.
- Never report CLEAR TO ADVANCE off an environment whose first-run state was not
  verified, when the product has a first-run surface. INVALID first-run coverage
  caps the verdict.
- If a lane could not run (app won't start, dependency couldn't be removed, no
  multi-agent budget for `full`), say so plainly and mark that coverage as a gap —
  a gap is not a pass.
- The gate is **adversarial by default**: its job is to *block* advancement, not to
  find reasons to wave it through. Credit what works (honest signal), but the bar is
  the bar.
