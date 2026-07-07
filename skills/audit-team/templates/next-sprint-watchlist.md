# Next-Sprint Watchlist — [Project Name]

**Audit date:** [YYYY-MM-DD]

Forward-looking items. These are findings that do not belong in the current sprint — usually because they require cross-team coordination, architectural thinking, or product/leadership input — but must be on the team's radar for the next planning cycle.

A project that ignores its watchlist accumulates debt faster than it can pay it down. The purpose of this file is to make sure the team sees structural issues before they become acute.

---

## Structural / architectural

> Decisions and refactors that need to be planned, not rushed.

| # | ID | Role | What to consider | Trigger to act |
|---|---|---|---|---|
| 1 | [ENG-012] | Engineering | [e.g. "Migrate auth middleware to centralized team-scope check"] | [e.g. "Before adding any new /teams/:id/* endpoint"] |
| ... | | | | |

## Design debt

| # | ID | Role | What to consider |
|---|---|---|---|
| 1 | [UX-011] | UX | [e.g. "Adopt a shared empty-state component across dashboard, lists, search"] |
| ... | | | |

## Documentation debt

| # | ID | Role | What to consider |
|---|---|---|---|
| 1 | [DOC-007] | Docs | [e.g. "Stand up a real architecture doc before the next engineer joins"] |
| ... | | | |

## Test-culture debt

| # | ID | Role | What to consider |
|---|---|---|---|
| 1 | [TEST-008] | Test | [e.g. "Policy decision on snapshot-test review cadence"] |
| ... | | | |

## Performance and scaling

| # | ID | Role | What to consider | Trigger to act |
|---|---|---|---|---|
| 1 | [QA-015] | QA | [e.g. "LCP degrades with >50 items in list"] | [e.g. "Before customers with high-volume workloads onboard"] |
| ... | | | | |

## Dependency and supply chain

| # | ID | Role | What to consider |
|---|---|---|---|
| 1 | [ENG-020] | Engineering | [e.g. "Abandoned dep on X — find a replacement or fork"] |
| ... | | | |

## Decisions needing product/leadership input

> These aren't pure engineering fixes. They require a product or leadership decision before the team can act.

- **[ID]** — [what needs to be decided, by whom, by when]
- **[ID]** — [...]

---

## Review cadence

Revisit this watchlist at:
- Next sprint planning — elevate anything acute to the sprint
- Every quarter — decide what's still current, what's been addressed, what to retire
- On any major architectural change — re-audit to see if the watchlist needs rewriting

---

*Generated from the `audit-team` skill. Each entry cross-references its full treatment in the relevant role deep-dive.*
