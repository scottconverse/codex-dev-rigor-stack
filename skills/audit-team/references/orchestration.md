# Orchestration Guide

You are the orchestrator of the audit-team skill. The five roles do the deep work. Your job is to scope, dispatch, synthesize, and deliver.

This file tells you how to run the roles in parallel via the Agent tool and how to combine their output into the final audit package.

---

## Your workflow at a glance

1. **Intake** — confirm scope, posture, and writer mode with the user (see SKILL.md Phase 1).
2. **Stage the output directory** — create `audit-<project>-<YYYY-MM-DD>/` with empty placeholders.
3. **Dispatch role subagents in parallel** — single message, multiple Agent calls.
4. **Wait for all five to return.**
5. **Read each deep-dive file they wrote.**
6. **Cross-reference and synthesize** — look for findings that touch multiple roles.
7. **Write the executive audit, sprint punchlist, and next-sprint watchlist.**
8. **Package and present** — hand over via `present_files`.

---

## Role dispatch: prompt templates

Spawn all in-scope role subagents in a **single message with multiple Agent tool-use blocks** so they execute concurrently. Use `subagent_type: "general-purpose"` (or `Explore` if available and the scope is read-only). Pass the full role reference file path so the subagent reads its role in detail.

Each role prompt follows this shape:

```
You are performing an audit in the role of a <ROLE NAME>.

Before you begin, READ IN FULL:
1. <ABS PATH>/references/<role-file>.md — your role definition, methodology, severity examples, and report format.
2. <ABS PATH>/references/severity-framework.md — how to classify findings.
3. <ABS PATH>/references/blast-radius.md — required for every Blocker/Critical/Major finding.
4. <ABS PATH>/templates/<NN>-<role>-deepdive.md — the deep-dive template you must produce into.

Scope of this audit:
- Project: <project name and location>
- Audit root: <path / repo URL / project description>
- Scope mode: <full | targeted: ... | scoped to: ...>
- Posture: <balanced | adversarial>
- Writer mode (only relevant to writer role): <audit-only | audit+draft | full-rewrite>

Additional context from the user: <any context given at intake>

Your task:
1. Read the role reference file and the cross-cutting references above.
2. Perform your audit of the project within the agreed scope.
3. Produce your deep-dive report to <AUDIT OUTPUT>/<NN>-<role>-deepdive.md, following the template structure exactly.
4. Credit what's working in a dedicated section of your report — not as filler, as honest signal.
5. For every Blocker/Critical/Major finding, include the blast radius entry.

Return to the orchestrator:
- Absolute path to the deep-dive file you wrote
- Severity counts (Blocker / Critical / Major / Minor / Nit)
- A numbered list of your top 5 findings (ID and one-line title only)
- Any Blockers that need immediate attention
- Anything you could not assess, and why

Keep your returned summary under 300 words. The full detail belongs in the deep-dive file.
```

The writer role gets one extra instruction:
```
If writer mode includes drafting (audit+draft or full-rewrite), also produce replacement drafts into <AUDIT OUTPUT>/doc-rewrites/. Draft the docs that the audit finds Blocker/Critical/Major gaps for. Use the templates in <ABS PATH>/templates/ as starting points. Return the list of drafted filenames.
```

---

## Parallel dispatch — exact pattern

Use one tool-use message containing all role Agent calls. Example (concept, not copy-paste; adapt names and paths to the live session):

- Agent call 1: `description: "Principal Engineer audit"`, prompt as above for engineering
- Agent call 2: `description: "UI/UX audit"`, prompt for UX
- Agent call 3: `description: "Technical Writer audit"`, prompt for writer
- Agent call 4: `description: "Test Engineer audit"`, prompt for test
- Agent call 5: `description: "QA audit"`, prompt for QA

Issue all five in one message. Wait for the combined return.

If the user scoped down (e.g., just UI/UX and QA), only dispatch those roles. Do not silently drop roles from a full-scope audit.

---

## What to do while they run

Don't just wait. Use the time to:

1. Make sure the audit output directory and placeholder files exist.
2. Draft the skeleton of `00-executive-audit.md` from `templates/00-executive-audit.md`. You'll fill it in after the subagents return.
3. If the user provided context that affects specific sections (known constraints, known compromises the team made, upcoming deadlines), record these so you can reference them in the executive report.

---

## Synthesis: after the role subagents return

### Step 1 — Read every deep-dive file

Don't trust the subagent summaries alone — they're terse by design. Read the full deep-dive files. Note:
- The Top 5 per role
- Any Blockers
- Anything marked Critical that might affect another role's findings

### Step 2 — Cross-reference

Look for findings that touch multiple roles. These are often the highest-leverage items in the audit. Examples:
- A security bug (Engineering) with no test (Test) and no disclosure (Docs) is a **triple finding**
- An empty-state gap (UX) that's also a coverage gap (Test) and an onboarding-docs gap (Docs) is a triple finding
- An architectural choice (Engineering) that also produces a test-ability problem (Test) and a docs-complexity problem (Docs) is a triple finding

When you find one, mark it in the executive report's "Cross-role findings" section with a single coherent description and pointers to each role's individual entry.

### Step 3 — Build the Top 10 for the exec report

Combine all findings across all roles, sort by severity, take the top 10. Rules:
- Include every Blocker
- Include Criticals in order of leverage (fix this, several things get better)
- Fill the rest with high-leverage Majors, especially cross-role ones
- Do NOT pad with Minors to reach 10. If the top of the list is 7 items, it's 7.

### Step 4 — Build the sprint punch list

`sprint-punchlist.md` is for the dev team's current sprint. Include:
- All Blockers and Criticals (these must be in-flight now)
- Majors that are cheap or urgent (e.g., "rewrite an empty-state copy" is cheap; "add middleware on auth boundary" is urgent)
- Exclude Majors that are structural or long-lived — those go to the watchlist

Each punch-list item: ID, title, severity, owner hint (which role), one-line "what to do," and estimated size (S/M/L).

### Step 5 — Build the next-sprint watchlist

`next-sprint-watchlist.md` is for sprint planning one cycle out. Include:
- Majors that require cross-team decisions
- Architectural findings
- Design-debt items
- Scaling/performance items that aren't acute yet
- Anything that requires product or leadership input before engineering can act

### Step 6 — Write the executive audit

Use `templates/00-executive-audit.md`. Fill every section. Confirm every reference to a deep-dive finding ID resolves correctly. The exec audit is the dev team's front door — it must stand on its own.

### Step 7 — Final consistency check

Before declaring done:
- Do any two deep-dives contradict each other? (It can happen — roles are independent.) If yes, state the tension honestly in the exec report rather than papering over it.
- Do all cross-references (finding IDs, file paths) resolve?
- Is the "what's working" narrative present in every role and in the exec? (If this is missing, the audit reads adversarial even if content-balanced.)

---

## Presenting the final package

Use `mcp__cowork__present_files` to deliver the files. Order matters — the user should see the exec report first:

1. `00-executive-audit.md`
2. `sprint-punchlist.md`
3. `next-sprint-watchlist.md`
4. `01-engineering-deepdive.md`
5. `02-uiux-deepdive.md`
6. `03-documentation-deepdive.md`
7. `04-test-deepdive.md`
8. `05-qa-deepdive.md`
9. Any files in `doc-rewrites/`

Give a short summary in the chat — 3–5 sentences covering severity roll-up, the top finding, and where the drafted docs live if relevant. Do not rehash the exec report in the chat. The user will read it.

---

## Failure modes to avoid

- **Sequential dispatch.** If you send the agents one at a time, you've doubled the wall-clock time for no reason. Parallelize.
- **Trusting the summaries without reading the deep-dives.** The summaries are terse; they miss the texture. Read the files.
- **Silently skipping a role because it's "hard" or "no obvious scope."** If the scope is genuinely empty for a role (project has no UI so UX is moot), say so explicitly in the exec report. Don't omit.
- **Calibrating findings against each other post-hoc.** The roles are intentionally independent. If the Engineer says the code is fine and the Test Engineer says the suite lies, both go in. State the tension.
- **Inventing evidence to "complete" a role's report.** If the subagent couldn't run the product and the QA report is thin, the report is thin — write what was observed, flag what couldn't be verified.
- **Overclaiming readiness.** If the audit has Blockers, the exec summary says so, clearly, even if the user wanted good news.
