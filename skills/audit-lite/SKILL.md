---
name: audit-lite
description: Fast single-pass audit of a small code change, bug fix, or scoped diff — covers correctness, UX, docs, tests, and runtime behavior in one tight report. Use this skill whenever the user wants a quick audit, lite audit, smoke audit, spot check, sanity check, or pre-merge review of a recent fix or small feature. Trigger on phrases like "audit this fix," "quick audit," "lite audit," "is this fix ready," "review this small change," "between fixes," "smoke check before merge," or any review request scoped to a single bug fix, a few files, or a recent diff. Prefer this over `audit-team` when the change is small, time is short, and the full multi-role package would be overkill. Escalate to `audit-team` if findings warrant it.
---

# Audit Lite

A single-pass audit for small changes. Same severity framework, same evidence bar, same honesty as `audit-team` — but compressed into one reviewer, one report, one sitting. Built to run between bug fixes without breaking flow.

The bar: when the user receives the report, they know whether the change ships, what's broken, what to watch, and whether the situation actually warrants escalating to a full `audit-team` run. Every finding has evidence and a fix path. No fluff, no padding, no false alarms.

---

## When to use audit-lite vs audit-team

**Use audit-lite when any of these are true:**
- The change is a bug fix, a single feature, or a small refactor
- Scope is one PR, a handful of files, or a recent diff
- The user wants a check between fixes, not a full project review
- The user said "quick," "lite," "smoke," "spot," "sanity," or "between"
- Stakes are routine (Tier 1) — not pre-release, not customer-facing launch

**Escalate to audit-team when any of these are true:**
- The user asks for a full audit, pre-release review, or readiness assessment
- The change crosses major architectural boundaries
- audit-lite surfaces a Blocker or 3+ Criticals (the situation outgrew lite)
- The user provides a whole repo, not a scoped change
- The dev team needs sprint-planning artifacts, doc rewrites, or per-role deep dives

When in doubt, ask. One question is cheaper than running the wrong tool.

---

## The five dimensions (collapsed into one pass)

audit-lite reviews the same five dimensions audit-team does, but compressed:

| Dimension | What to check | Skip if |
|-----------|---------------|---------|
| **Correctness & Security** | Does it do what it claims? Any reachable security issue? Any obvious data hazard? | Pure cosmetic change |
| **UX** | If a UI is affected: visible states, copy, error paths, accessibility regressions | No UI in the diff |
| **Docs** | If behavior changed: are README/inline docs/API docs still accurate? | Behavior is identical to before |
| **Tests** | Is there a test for the fix? Are existing tests still valid? Any regression risk? | Never skip this — at minimum, note absence |
| **Runtime** | Does the change actually run? Smoke-test the affected path if possible. | Static-only change with no runtime path (rare) |

Don't pad. If a dimension genuinely doesn't apply, say so in one line and move on. Don't invent findings to fill it.

---

## Workflow

### Step 1 — Confirm scope (one question, max)

Confirm what's being audited:
- **A diff or PR?** Get the file list and the change description.
- **A bug fix?** What was the bug, what was the fix, what files moved?
- **A small feature?** What does it do, what files implement it?

If the user already gave you this, don't re-ask. Move to step 2.

### Step 2 — Read everything in scope

Read the changed files in full. Read enough adjacent code to understand the call sites and shared state. Skim tests for the affected paths.

If a UI is involved and you can run the product, run it. If you can't, look at screenshots or describe the static check honestly — don't pretend you ran what you didn't.

### Step 3 — Produce the report

Single file: `audit-lite-<scope-slug>-<YYYY-MM-DD>.md`. Use the template below. Keep it scannable — the reader is mid-sprint, not reading a novel.

### Step 4 — Decide if escalation is warranted

Before declaring done, ask: did this lite pass surface findings that warrant the full `audit-team`? If yes, say so explicitly at the top of the report. Examples:

- 1+ Blocker found → escalate
- 3+ Criticals found → escalate
- Findings span 4 or 5 dimensions deeply → escalate
- Root cause looks architectural, not local → escalate

If escalation is warranted, the lite report still ships — but it ends with a clear recommendation to run audit-team.

### Step 5 — Present the file

Use `present_files` to make the report visible. Do not declare audit-lite done until the file exists and any cross-references resolve.

---

## Report template

```markdown
# Audit Lite — <scope>
**Date:** <YYYY-MM-DD>
**Scope:** <one sentence — what was reviewed>
**Reviewer:** Claude (audit-lite)

## TL;DR
<2–3 sentences. Ship / ship-with-caveats / don't ship. Honest verdict.>

## Severity rollup
- Blocker: N
- Critical: N
- Major: N
- Minor: N
- Nit: N

## Findings

### <FINDING-001> <Severity>: <One-line title>
**Dimension:** Correctness | UX | Docs | Tests | Runtime
**Evidence:** <file:line, behavior observed, command output, screenshot ref>
**Why it matters:** <1–2 sentences>
**Fix path:** <concrete next step>
**Blast radius:** <only for Blocker/Critical, optional for Major; omit otherwise>

### <FINDING-002> ...

## What's working
- <specific, credit-worthy item with file/area reference>
- <another>

## Watch items (optional)
<Forward-looking notes that don't rise to a formal finding. Keep to 3 max. Skip the section if there are none.>

## Escalation recommendation
<One of: "No escalation needed" | "Recommend running audit-team because..." Be specific about why.>
```

---

## Severity framework (compressed)

Same five levels as audit-team. Same definitions. Compressed for fast classification:

- **Blocker** — Cannot ship. Security exposure, data loss, broken core flow, install-doesn't-work-as-documented.
- **Critical** — Must fix before next release. Reachable security gap, broken primary feature under realistic conditions, missing error states on a failure-prone flow.
- **Major** — Should fix soon. N+1 on a hot path, copy that's unhelpful across multiple surfaces, systemic test gap, architectural choice that forces a refactor in 6–12 months.
- **Minor** — Nice to fix. Dead code, naming inconsistency, single skipped test on non-critical feature.
- **Nit** — Preference, not a defect. Mention once, don't belabor.

**Severity check questions** (when you're unsure):
1. What breaks if unfixed? Nothing visible? → Minor or Nit.
2. Under what conditions does it bite? Normal operation → higher. Edge case → lower.
3. How many users are exposed? Many → higher. Edge → lower.
4. Is there a workaround? Yes → may downgrade.
5. Does it compound if left? Systemic pattern → Major even if each instance is Minor.

**Anti-patterns:**
- Don't call everything Critical to get attention. It destroys credibility.
- Don't soften Major to Minor to avoid conflict.
- Security findings are Critical or Blocker by default — only downgrade if exposure is genuinely theoretical.

---

## Blast radius (compressed, when required)

Required for **Blocker and Critical** findings. Optional for **Major**. Skip for Minor/Nit.

For each qualifying finding, answer in 2–4 lines:

- **Adjacent code:** Other call sites, copy-paste twins, shared utilities likely to share the issue
- **Shared state:** Data models, configs, globals that touch this code
- **User-facing change:** Which flows look different after the fix
- **Migration concern:** None / backfill / API version bump / client upgrade
- **Tests to update:** Specific tests likely to need updates, or "none known"

Omit any line that doesn't apply. Don't write "N/A" — just leave it out.

If you genuinely don't know a blast-radius answer, write "unclear without deeper investigation of <X>" — that's itself an action item.

---

## Core commitments

These are the same commitments audit-team makes. Lite preserves all of them — speed comes from scope, not from cutting corners.

- **Honest, balanced, specific.** Findings cite evidence — file paths, line numbers, observed behavior. "What's working" is included and is honest, not filler.
- **No fabricated evidence.** If you didn't read the file, don't cite a line number. If you didn't run it, don't claim you did.
- **No padding.** If there are 2 findings, the report has 2 findings. Don't pad with Nits to look thorough.
- **Concrete fix paths.** Every finding includes a next step a developer can act on. No "go figure it out" punts.
- **Severity by framework, not gut.** If you call something Critical, it meets Critical criteria.
- **Credit what's done well.** "What's working" is not optional. A graded review is more useful than an all-red one.
- **Honest about scope.** If a dimension wasn't checked because the diff didn't touch it, say so.

---

## Hard guardrails

- **Tests are non-negotiable.** Even if the fix is "trivial," call out the test status. A bug fix without a regression test is at least a Major finding (depending on exposure). The user's standing rule: bugs are never deferred — corollary, fixes without tests are not done.
- **UX wins ties.** When trading off code elegance vs. user experience, UX wins. Flag any change that worsens UX even if it improves the code.
- **Doc drift is a finding.** If the change altered observable behavior and the docs still describe the old behavior, that's at least Major.
- **Don't audit what you can't see.** If you don't have the file, the diff, or the running product, say so and stop. Don't guess.
- **Stay in scope.** audit-lite is for the change. If the user asked you to audit a fix, don't review the whole repo — flag the scope creep and offer audit-team instead.

---

## Final sign-off

Before declaring audit-lite complete, confirm:

- [ ] Scope is clearly stated at the top of the report
- [ ] All applicable dimensions were checked (or explicitly marked N/A with one-line reason)
- [ ] Every finding has dimension, severity, evidence, why-it-matters, and fix path
- [ ] Every Blocker and Critical has a blast-radius block
- [ ] "What's working" is populated and specific
- [ ] Escalation recommendation is explicit (yes or no, with reason)
- [ ] Report file presented to the user via `present_files`

Then — and only then — tell the user the lite audit is ready.
