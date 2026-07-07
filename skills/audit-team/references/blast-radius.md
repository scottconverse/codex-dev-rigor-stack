# Blast Radius Methodology

Every non-trivial finding has downstream impact. Blast radius is the map of what else this finding touches — what will break when a fix is attempted, what adjacent code needs regression testing, what other findings it interacts with, and whether the fix creates a migration concern.

This is the single highest-value addition a good audit makes over a generic code review. Call out blast radius explicitly and the dev team can plan their work. Skip it, and the fix lands, something adjacent breaks, and the team loses trust in the audit.

**Blast radius is required for every Blocker, Critical, and Major finding.** It's optional for Minor. Nits don't need it.

---

## The questions to answer

For each finding:

### 1. What adjacent code is likely to be affected by the fix?
- Other call sites of the affected function/component
- Other consumers of the affected data
- Other paths that share the pattern (copy-paste propagation)
- Dependencies and dependents in the module graph

### 2. What shared state or shared assumption does this touch?
- Data models used across multiple features
- Shared utility functions
- Environment variables and config keys
- Global state stores, caches, queues
- Database schema or migrations

### 3. What user-facing features pass through this code?
- Which flows will a user experience differently after the fix?
- Which analytics events, logs, or telemetry might change shape?

### 4. Is there a migration or compatibility concern?
- Will the fix change the shape of stored data? Need backfill/migration?
- Will the fix change an API contract? Need versioning?
- Will clients on older versions break? Deprecation path?
- Are there cached copies of the old behavior anywhere?

### 5. What existing tests might break — or must be updated?
- Tests that assert the current (incorrect) behavior
- Snapshot tests that will need re-approval
- Integration tests whose expectations shift

### 6. What related findings in this audit share the same root cause?
- If three findings all stem from the same architectural choice, name them and group the fix. A single coordinated fix is cheaper than three uncoordinated ones.

### 7. Are there political or organizational dependencies?
- Does the fix cross team boundaries?
- Does it require a product decision (not just engineering)?
- Does it need design input, legal review, or customer communication?

---

## How to write a blast radius entry

Keep it scannable. The dev team reads this under time pressure. Use this structure in each finding:

```markdown
**Blast radius:**
- Adjacent code: [list the specific files/symbols/patterns that share this concern]
- Shared state: [data models, configs, globals if relevant]
- User-facing: [which flows or features will change in any observable way]
- Migration: [none | backfill required | API version bump | client-side upgrade]
- Tests to update: [list or "none known"]
- Related findings: [IDs of other findings in this audit that share root cause]
```

If a section doesn't apply, omit it. Don't pad with "N/A" everywhere — scannable is the goal.

---

## Examples

### Example 1: A security finding

> **Finding ENG-007 (Critical): Missing authorization check on `/api/teams/:id/members`**
>
> ... [evidence, why it matters] ...
>
> **Blast radius:**
> - Adjacent code: `/api/teams/:id/settings`, `/api/teams/:id/invites` share the same middleware composition and likely have the same gap. Audit them as part of the fix.
> - Shared state: Team authorization is resolved in `lib/auth/team-scope.ts`. Consider centralizing the check there rather than per-route.
> - User-facing: no visible change to legitimate users; unauthorized access closes.
> - Migration: none. This is additive enforcement.
> - Tests to update: E2E tests in `__tests__/teams/` likely relied on the gap. Expect 3–5 tests to need updates.
> - Related findings: TEST-012 (no test exercises cross-team access attempts).

### Example 2: A UX finding

> **Finding UX-003 (Major): Empty state on the dashboard is blank**
>
> ... [evidence, why it matters] ...
>
> **Blast radius:**
> - Adjacent code: `<EmptyState />` pattern is also missing in `<ProjectsList />`, `<ArchivedItemsList />`, `<SearchResults />`. Fix once, apply five places.
> - User-facing: all first-time users see an empty view at some point in onboarding; this directly affects activation rate.
> - Migration: none.
> - Tests to update: none — there are no tests of empty states, which is TEST-009.
> - Related findings: DOC-004 (no onboarding doc), UX-011 (onboarding flow has no feedback on first success).

### Example 3: A test-engineering finding

> **Finding TEST-008 (Major): Snapshot tests haven't been reviewed in 18 months**
>
> ... [evidence] ...
>
> **Blast radius:**
> - Adjacent code: `__snapshots__/` directory across the UI test suite — ~60 snapshots, most regenerated automatically on failure rather than reviewed.
> - User-facing: snapshots may have ossified bugs as "correct." Hard to know without re-review.
> - Migration: none per se, but a fix requires an approved policy change (how to review snapshots, when to regenerate).
> - Tests to update: potentially every snapshot test.
> - Related findings: QA-004 (visual regressions shipped that would have been caught by a disciplined snapshot flow).

---

## Blast radius at audit-wide scope

After role subagents finish, the orchestrator does a **cross-role blast radius pass**. Look for findings that reinforce each other:

- A security finding with no test and no doc → triple-tag: Engineering flags the bug; Test flags the gap; Docs flags the absence of customer-facing disclosure if material.
- A UX empty-state problem that's also a docs gap (no onboarding flow documented) and a QA gap (empty-case not tested).
- An architectural choice that's simultaneously a Major engineering finding, a Major test finding (untestable), and a Major docs finding (undocumented).

When three roles point at the same root, the root is likely the highest-leverage fix in the audit. Promote it in the executive summary.

---

## When NOT to enumerate blast radius

- **Nits and Minors** don't need it. A style-preference nit with blast radius is over-investment.
- **When you genuinely don't know.** Guess work is worse than silence. If you're uncertain about the blast radius, say "Blast radius: unclear without a deeper investigation of [specific area]" — that's itself an action item for the team.

Never invent a blast radius to fill space. Dev teams spot it.
