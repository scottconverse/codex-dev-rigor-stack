---
name: audit-team
metadata:
  version: 1.7.0
description: Deep multi-role audit of a project by a simulated team — Principal Engineer, Senior UI/UX Designer, Technical Writer, Test Engineer, and QA Engineer — that reviews code, UX, docs, tests, and runtime behavior, then produces an executive report plus five per-role deep-dive reports with severity-ranked findings, blast-radius analysis, a this-sprint punch list, and a next-sprint watchlist. Use this skill whenever the user asks for an audit, review, code review, design review, doc review, test audit, QA audit, pre-release check, pre-merge check, "tear this apart," "tell me what's wrong," "is this ready to ship," or a second opinion before handing a project to a dev team, a customer, or leadership. Also trigger when the user provides a repo, folder, PR, or project and asks for findings, gaps, risks, quality issues, or readiness assessment. Prefer this skill over generic code review — it catches what single-role reviews miss and produces deliverables a dev team can act on this sprint.
---

# Audit Team

A five-role audit team that performs a deep, honest, balanced audit of a project and delivers a dev-team-ready set of reports. Each role is a domain expert, and the roles work in parallel. The orchestrator (you) synthesizes their findings into a single coherent audit package.

The bar: when a dev team receives the audit package, they have everything they need to fix the current sprint's problems AND know what to watch for in the next sprint. Every finding has evidence, severity, blast radius, and a concrete fix path.

---

## The five roles

| # | Role | Focus | Reference |
|---|------|-------|-----------|
| 1 | Principal Engineer | Architecture, correctness, security, performance, dependencies, data provenance | `references/principal-engineer.md` |
| 2 | Senior UI/UX Designer | Visual hierarchy, interaction states, copy, accessibility, user-journey gaps | `references/uiux-designer.md` |
| 3 | Technical Writer | READMEs, architecture docs, user manuals, FAQs, marketing/landing copy — accuracy, completeness, honesty | `references/technical-writer.md` |
| 4 | Test Engineer | Test coverage reality vs. claim, blind spots, shortcuts, regression risk | `references/test-engineer.md` |
| 5 | QA Engineer | Runtime behavior across layers — webpage, SaaS, API, protocol, CLI | `references/qa-engineer.md` |

Cross-cutting guides every role uses:

- `references/severity-framework.md` — How to classify findings (Blocker / Critical / Major / Minor / Nit)
- `references/blast-radius.md` — How to trace downstream impact of each finding
- `references/orchestration.md` — How you (the orchestrator) run the roles in parallel and synthesize results

---

## When invoked: the three-phase workflow

### Phase 1 — Intake and scope

Before spawning anything, confirm scope with the user. Use AskUserQuestion if it's ambiguous. You need:

1. **What are we auditing?** A repo path, a folder, a specific PR, a URL, or a project description. If the user hasn't told you, ask.
2. **Scope mode:**
   - `full` (default) — all five roles, everything
   - `targeted` — a subset of roles (e.g. just UI/UX and QA)
   - `scoped` — all roles but restricted to a path or feature
3. **Posture:** balanced by default (credit what's done well, flag what's broken, no scorched-earth, no rubber-stamping). Switch to `adversarial` only if the user asks for a gate-keeping review or says something like "tear this apart."
4. **Writer mode:**
   - `audit-only` — review existing docs, flag gaps, don't produce new files
   - `audit+draft` (default if serious doc gaps exist) — produce draft replacements for any missing or broken docs alongside the audit findings
   - `full-rewrite` — rewrite all doc assets regardless of existing state (use when the user explicitly asks for this)

Once scope is confirmed, create the output directory: `audit-<project-name>-<date>/` and stage the structure described in the "Output package" section below.

### Phase 2 — Run the roles

Spawn the role subagents **in parallel** (single message, multiple Agent tool calls) so they run concurrently. Each subagent:

- Reads its role reference file in full before starting
- Reads `references/severity-framework.md` and `references/blast-radius.md`
- Performs its audit of the agreed scope
- Produces its deep-dive report to its own file in the output directory
- Returns a terse summary to you (top findings, severity counts, any blockers)

See `references/orchestration.md` for the exact prompt templates for each subagent.

**Do not skip roles to save time.** If the user scoped down to fewer roles, respect that. Otherwise all five run.

### Phase 3 — Synthesize and deliver

Once all subagent reports are in:

1. Read each deep-dive file the subagents produced
2. Cross-reference findings — a single issue may show up in multiple roles (e.g. a security bug with no test and no doc is a triple finding). Merge where appropriate.
3. Build the executive audit report (`00-executive-audit.md`) using the template. It is the dev team's front door. It must include:
   - Executive summary (3–5 sentences, honest)
   - Severity roll-up (count by Blocker/Critical/Major/Minor/Nit across all roles)
   - Top 10 findings across all roles, sorted by severity
   - What's working well (credit given, specific)
   - This-sprint punch list (actionable items the dev team should fix before close of sprint)
   - Next-sprint watchlist (forward-looking items — decisions, design debts, scaling concerns)
   - Blast-radius notes (decisions or fixes that ripple outward — call them out explicitly so the dev team doesn't break adjacent code)
4. Build the `sprint-punchlist.md` and `next-sprint-watchlist.md` as standalone files for the dev team's sprint planning.
5. If writer mode includes drafting replacements, put those in `doc-rewrites/`.
6. Present all files to the user via the host's file-presentation tool if it has one; in Codex Desktop, list clickable absolute file paths in the final message. Delivery is the gate; the specific tool is not.

Do not declare the audit complete until all files exist and all internal cross-references resolve.

---

## Output package structure

```
audit-<project>-<YYYY-MM-DD>/
├── 00-executive-audit.md           # The front door — read this first
├── 01-engineering-deepdive.md      # Principal Engineer's full findings
├── 02-uiux-deepdive.md             # UI/UX Designer's full findings
├── 03-documentation-deepdive.md    # Technical Writer's full findings
├── 04-test-deepdive.md             # Test Engineer's full findings
├── 05-qa-deepdive.md               # QA Engineer's full findings
├── sprint-punchlist.md             # This-sprint actionable fixes
├── next-sprint-watchlist.md        # Forward-looking items
└── doc-rewrites/                   # Only if writer mode produced drafts
    ├── README.md
    ├── ARCHITECTURE.md
    ├── FAQ.md
    └── USER-MANUAL.md
```

Templates for every file live in `templates/`. Use them — don't invent your own structure per audit, consistency matters for dev teams reading multiple audits over time.

---

## The core commitments of this skill

These are the commitments every role makes. They are why this skill exists.

**Honest, balanced, specific.** Findings name what's wrong and cite evidence — file paths, line numbers, screenshots or runtime behavior, commit SHAs. Findings also credit what's done well, because a review that's all red flags is less useful than a review that's graded. No rubber-stamping, no scorched earth.

**Proctology-exam depth.** Every finding has: category, severity, evidence, affected files, blast radius, and a concrete fix path. A developer should be able to pick up any finding and start working immediately — no "go figure it out" punts.

**Blast-radius awareness.** Every non-trivial fix has downstream impact. The audit calls out what else is likely to break when this fix lands, what adjacent code needs regression testing, and whether the fix creates a migration or compatibility concern. See `references/blast-radius.md`.

**Two horizons.** Every audit delivers for two horizons: fix-this-sprint (acute, in-scope now) and watch-next-sprint (structural, forward-looking). Dev teams stop reading audits that only list things they can't fix right now. They also ignore audits that only nitpick. Both horizons earn their keep.

**Role independence.** The five roles run independently. They don't calibrate to each other. If the Principal Engineer thinks the architecture is solid and the Test Engineer thinks the test suite lies, both findings go in — the synthesis explains the tension. Pretending the roles agree when they don't is dishonest.

**The writer produces, not just critiques.** When docs are missing or broken enough to block the project's readiness, the writer drafts replacements in `doc-rewrites/`. This is a deliverable, not a suggestion.

---

## Important guardrails

- **Do not fabricate evidence.** If you haven't read the file, don't cite a line number. If the project has no tests, don't invent a test file path. Undisputable evidence or don't claim it.
- **Do not gate by gut feel.** Every severity classification follows `references/severity-framework.md`. If you call something Critical, it meets the Critical criteria. If it doesn't, it's Major or lower.
- **Do not punt the blast radius.** Every Blocker/Critical/Major finding has an explicit blast-radius entry. Minor/Nit findings can skip this.
- **Do not skip the visual check.** If the project has a UI, the UI/UX role must actually look at it — in the running product where possible, in screenshots or mockups otherwise. Reading CSS source is not a substitute.
- **Do not skip the runtime check.** The QA role runs the product where possible. Static review is not QA.
- **Credit what's done well.** Every deep-dive report includes a "What's working" section. This is not filler — it's honest signal. If the dev team has an excellent test suite and a garbage UX, say both.

---

## On triggering

This skill is the right tool whenever the user wants a deep review that covers more than one dimension. It is not the right tool for:

- A pure code review of a 10-line function (that's inline review)
- A spelling/grammar pass on a single doc (that's a proofread)
- A performance benchmark of a specific algorithm (that's profiling)

If in doubt, ask the user whether they want a full audit or a narrower review. The five-role team is worth it when the project has real users, real revenue, real risk, or real stakes.

---

## Final sign-off

Before declaring the audit complete, confirm every item:

- [ ] All in-scope roles ran and produced their deep-dive
- [ ] Executive report is written and cross-references the deep-dives correctly
- [ ] Every Blocker and Critical finding has evidence, blast radius, and a fix path
- [ ] Sprint punch list is sortable by priority and every item has an owner hint (which role surfaced it)
- [ ] Next-sprint watchlist is populated (it's rarely empty for real projects)
- [ ] What-works-well sections are honest and specific
- [ ] If writer mode includes drafting, the doc-rewrites/ directory is populated and contents are accurate
- [ ] Files delivered to the user (host presentation tool, or paths clearly listed)

Then — and only then — tell the user the audit is ready.
