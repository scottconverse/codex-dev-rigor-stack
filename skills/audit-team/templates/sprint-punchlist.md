# Sprint Punch List — [Project Name]

**Audit date:** [YYYY-MM-DD]
**For sprint ending:** [date if known]

This list is the dev team's actionable fixes for the **current sprint**. Every item has an ID, severity, owner hint (which role surfaced it), and a one-line description of the fix. Estimated size (S/M/L) is a rough guide for planning, not a commitment.

Cross-references to the role deep-dives are in the ID column.

---

## Must-fix (Blockers + Criticals)

| # | ID | Severity | Role | What to do | Size |
|---|---|---|---|---|---|
| 1 | [ENG-001] | Blocker | Engineering | [one-line fix] | [S/M/L] |
| 2 | [UX-003]  | Critical | UX | [one-line fix] | [S/M/L] |
| ... | | | | | |

*If this section is empty — congratulations, there are no Blockers or Criticals in this audit. State that explicitly here rather than leaving the section blank.*

---

## Should-fix (high-leverage Majors)

Majors that are cheap, urgent, or high-leverage. Tackle these after Blockers/Criticals if sprint capacity allows.

| # | ID | Severity | Role | What to do | Size |
|---|---|---|---|---|---|
| 1 | [TEST-004] | Major | Test | [one-line fix] | [S/M/L] |
| ... | | | | | |

---

## Suggested sequencing

[A short paragraph or numbered sequence explaining which items should go first and why. Callout any dependencies — for instance, "fix ENG-001 before UX-003 because the auth-boundary fix will change the error states UX-003 needs to design for."]

---

## Items deferred to next sprint

[Majors that are structural or long-lived and don't belong in this sprint. These live in `next-sprint-watchlist.md`; list their IDs here so the team knows they were considered and consciously deferred.]

- [ID] — [one-line reason for deferral]
- [ID] — [one-line reason]

---

## Sign-off gate

The dev team should not consider the sprint done until:

- [ ] All Blockers fixed and verified in the running product
- [ ] All Criticals fixed and tests added where gaps existed
- [ ] Regression pass done on any code touched by these fixes (blast radius from the deep-dives)
- [ ] Docs updated for any user-facing or API-contract changes

---

*Generated from the `audit-team` skill. Full detail for every ID is in the matching role deep-dive (`01-engineering-deepdive.md`, `02-uiux-deepdive.md`, etc.).*
