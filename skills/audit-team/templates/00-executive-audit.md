# Executive Audit — [Project Name]

**Audit date:** [YYYY-MM-DD]
**Audit scope:** [Full | Targeted: ... | Scoped to: ...]
**Posture:** [Balanced | Adversarial]
**Roles engaged:** [Principal Engineer, UI/UX Designer, Technical Writer, Test Engineer, QA Engineer]

---

## Executive summary

> Three to five sentences. Honest and specific. Say what the project is, what shape it's in, whether it's ready for its intended purpose, and what the single most important takeaway is. No hedging; no boilerplate.

---

## Readiness at a glance

| Dimension | Status | Summary |
|---|---|---|
| Architecture & code | [Solid / Concerns / Serious issues] | [One line] |
| UI / UX | [Solid / Concerns / Serious issues] | [One line] |
| Documentation | [Solid / Concerns / Serious issues] | [One line] |
| Test suite | [Solid / Concerns / Serious issues] | [One line] |
| Runtime QA | [Solid / Concerns / Serious issues] | [One line] |

---

## Severity roll-up

| Severity | Count | What it means |
|---|---|---|
| Blocker | [N] | Cannot ship / cannot defer |
| Critical | [N] | Fix this sprint |
| Major | [N] | Fix this or next sprint |
| Minor | [N] | Batch for hygiene work |
| Nit | [N] | Preference-level; flag once |
| **Total** | **[N]** | |

---

## Top 10 findings

> Sorted by severity, then by leverage. Every entry has an ID pointing to the relevant deep-dive. These are the findings that, if the dev team fixes only 10 things, deliver the most value.

| # | ID | Severity | Role | Title | Blast |
|---|---|---|---|---|---|
| 1 | [ENG-001] | Blocker | Engineering | [title] | [one-line impact] |
| 2 | [UX-003]  | Critical | UX | [title] | [one-line impact] |
| ... | | | | | |

---

## Cross-role findings

> Root causes that surfaced independently in multiple roles. These are usually the highest-leverage fixes in the audit.

### [Cross-role title]
- **Surfaced in:** [ENG-X, TEST-Y, DOC-Z]
- **What it is:** [1–3 sentences describing the shared root cause]
- **Why this is the most important issue:** [1–2 sentences]
- **Blast radius of the fix:** [summary]
- **Recommended approach:** [a coordinated fix rather than three uncoordinated ones]

[Add as many as apply. If none, say so explicitly: "No cross-role root causes surfaced in this audit — findings are cleanly scoped per dimension."]

---

## What's working

> Specific, honest credit. Name exactly what's well-done. Generic praise ("the team did a good job") is worse than none. Reference the role deep-dives for detail.

- **Engineering:** [specific thing, with evidence]
- **UI/UX:** [specific thing, with evidence]
- **Documentation:** [specific thing, with evidence]
- **Tests:** [specific thing, with evidence]
- **Runtime quality:** [specific thing, with evidence]

---

## This-sprint punch list (summary)

> Items the dev team should fix before the end of the current sprint. Full detail and owner hints in `sprint-punchlist.md`.

**Must-fix (all Blockers + Criticals):** [N items]
**Should-fix (high-leverage Majors):** [N items]

[Abbreviated list here; the full list lives in sprint-punchlist.md]

---

## Next-sprint watchlist (summary)

> Items that need planning for the next sprint — architectural decisions, design debts, scaling concerns. Full detail in `next-sprint-watchlist.md`.

[Abbreviated list here]

---

## Blast-radius callouts

> Fixes that ripple outward. The dev team needs to coordinate these, not just patch locally.

- **[ID]** — [what to coordinate and why]
- **[ID]** — [what to coordinate and why]

---

## What we couldn't assess

> Be explicit. Any role that couldn't complete its audit due to access, credentials, broken build, etc. Name the gap so the team knows what wasn't checked.

- **[Role]:** [what was skipped and why]

[If nothing was skipped, say: "All in-scope roles completed their audit on the agreed artifacts."]

---

## Recommended next actions (for leadership, PM, or tech lead)

1. [Action — concrete, ordered]
2. [Action]
3. [Action]

---

## Reference — role deep-dives

- `01-engineering-deepdive.md` — Principal Engineer
- `02-uiux-deepdive.md` — Senior UI/UX Designer
- `03-documentation-deepdive.md` — Technical Writer
- `04-test-deepdive.md` — Test Engineer
- `05-qa-deepdive.md` — QA Engineer

If documentation drafts were produced, see `doc-rewrites/`.

---

*Audit conducted by the audit-team skill on [date]. Findings are balanced and evidence-based. Every Blocker and Critical includes reproduction details and a blast-radius entry in the deep-dive.*
