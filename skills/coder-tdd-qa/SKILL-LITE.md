---
name: coder-tdd-qa-lite
description: "Condensed TDD/QA contract for quick fixes — single-file changes, small scripts, tweaks under ~50 lines. Same non-negotiable rules, evidence format, and test-first loop as coder-tdd-qa, minus workflow and release ceremony. Escalates to the full coder-tdd-qa standards when a change grows beyond one file, touches untrusted input/auth/secrets, or is being pushed or released."
---

# Coder TDD/QA Standards — LITE — v0.5

The condensed contract for small tasks: single-file changes, roughly 50 lines or
less, nothing being released. Same non-negotiables as the full standards
([`SKILL.md`](SKILL.md)) at a third the length. Blocks inside `<!-- sync -->`
comments are shared verbatim with the full document and enforced by
`check_sync.py` — edit them there, never here.

**Escalation tripwire — check before starting and again while working:** if the
change grows past one file or ~50 lines, alters any public interface, touches
untrusted input, auth, secrets, or deserialization, or you're about to push,
publish, or release — **stop and load the full standards** before continuing.
Lite is a fast path, not a lower bar.

---

## THE FIVE RULES (non-negotiable)

If asked to skip one, state the specific risk in one line; comply only after the
human acknowledges it.

<!-- sync:rule-1 -->
1. **Read before you write.** Read a file's current contents before modifying it.
   Discover mid-task that you need to touch an unread file → read it first.
<!-- /sync:rule-1 -->
<!-- sync:rule-2 -->
2. **Baseline before you change.** Before touching code, run the relevant test suite
   and record the result in Evidence Format (below). If the baseline is already red,
   report that immediately and track pre-existing failures separately from anything
   you cause — a new failure and inherited noise must never blur together, and
   red→green means nothing against an unknown start. Scale the baseline to the
   change: run the suite relevant to what you're touching, and cosmetic-only changes
   (copy, formatting, comments) need no baseline at all.
<!-- /sync:rule-2 -->
<!-- sync:rule-3 -->
3. **Run before you declare done.** After implementing, run it — tests, build,
   linter, or the feature itself — and report the result in Evidence Format.
   "It should work" is not evidence.
<!-- /sync:rule-3 -->
<!-- sync:rule-4 -->
4. **TDD for logic changes.** Every change to logic, data flow, or a public
   interface goes through the TDD Loop below. Cosmetic-only changes are exempt.
   Never weaken or delete an existing test to make a change pass — a failing test
   means either your code is wrong or the tested behavior genuinely changed;
   determine which before touching the test.
<!-- /sync:rule-4 -->
<!-- sync:rule-5 -->
5. **No secrets in committed or client code.** Keys, tokens, credentials, internal
   URLs never appear in commits, client bundles, or logs. Verify `.gitignore` covers
   env files and local config before any push.
<!-- /sync:rule-5 -->

---

## EVIDENCE FORMAT

<!-- sync:evidence-format -->
This is an anti-fabrication rule, not a formatting preference. Agents that
"summarize" test runs are exactly the ones that bury skips, fake greens, and paper
over flakiness. Every run you report includes:

- **The exact command invoked**, as run.
- **The complete summary/counts line, copied verbatim** — passed, failed, skipped,
  xfailed, warnings, duration. Never retype or paraphrase counts.
- **Every failure, error, and warning in full**, untruncated.
- Collapse only the per-test PASS spam. Nothing else.

Summarized or paraphrased output counts as no output. The verification log is not a
chat deliverable — verbosity here is cheap; fabrication is expensive.
<!-- /sync:evidence-format -->

---

## THE TDD LOOP

<!-- sync:tdd-principle -->
The core function — and it exists to close a specific hole: a rule that a test must
*exist* proves nothing, because one test can assert nothing, exercise a mock, or
pass whether or not the behavior works. **A test is only real once you have watched
it fail on its assertion.** That's what wires it to the behavior.
<!-- /sync:tdd-principle -->

<!-- sync:tdd-bugfix -->
**For a bug fix, the loop starts at RED with a reproduction:** write a test that
fails *because of the bug* before touching the fix. This is the highest-value habit
in this document — it proves you understood the bug, proves the fix, and prevents
the regression forever.
<!-- /sync:tdd-bugfix -->

<!-- sync:tdd-loop -->
1. **RED — write the smallest failing test** that names the intended behavior. One
   behavior per test. Use the project's existing test framework, patterns, and file
   locations; if none exists, set up the simplest viable one for the language first
   and note it in the report.
2. **Run it and watch it fail for the right reason.** An error (import failure,
   typo) is not a valid RED; fix the test until it fails on the *assertion*.
   Capture the failure in Evidence Format.
3. **GREEN — write the minimum code that passes.** No speculative parameters, no
   cases the test doesn't demand. Run; confirm green.
4. **REFACTOR — clean up with the tests as a net.** Rename, extract, simplify.
   Tests stay green throughout.
5. **Widen the run.** Run the full suite for the affected package/module (full repo
   if fast) and compare against the Rule-2 baseline. Any failure not in the
   baseline is your regression; fix it before moving on.
6. **Repeat** for the next behavior. Small cycles — minutes, not hours.
<!-- /sync:tdd-loop -->

Can't test it in practice (visual layout, hardware timing, third-party side
effects)? Test the logic behind it; run the surface and describe what you
observed. Never call code-first-tests-after TDD, and never skip watching the
test fail.

---

## MINIMUM REPORT — before declaring done

- **What changed and why** — two or three sentences.
- **Baseline vs. end state** — both runs in Evidence Format.
- **TDD evidence** — the RED failure and the GREEN summary.
- **Trust check** — state explicitly that the change involves no untrusted input,
  auth, secrets, or deserialization. (If it does, you should have escalated
  already.)
- **Sign-off** — scope done? Known limitations, or "no known open issues."

A checkmark with no evidence is worth nothing. Show what you found, not that you
looked.
