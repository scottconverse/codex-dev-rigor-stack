# Severity Framework

Every finding in an audit must have a severity. The severity is how the dev team will prioritize. Get this wrong and the audit is either noise (too many Criticals) or useless (everything Minor).

Severity is a function of two things: **impact** (how bad is it if unaddressed?) and **exposure** (how likely is it to hit real users?). Think of it as a grid, though you'll resolve to one label.

---

## The five levels

### Blocker
**Cannot ship. Cannot be deferred.**

Examples across roles:
- Security: exposed credential in client code; missing auth on sensitive endpoint; RCE path
- Data: loss or corruption under normal operation
- Product: a core flow is unusable; the documented install doesn't work
- Docs: marketing page materially misrepresents the product
- Tests: the test suite doesn't run; CI passes because tests are skipped
- QA: a Blocker security issue reachable from the running product

If a Blocker is found in a pre-release audit, the release stops. In an in-flight audit, it goes to the top of the sprint punch list.

### Critical
**Must be fixed before the next release. Significant impact or significant exposure.**

Examples:
- Security: missing sanitization on a reachable user-input path
- Correctness: critical feature breaks under realistic conditions
- Product: primary CTA is invisible or ambiguous; error states missing on failure-prone flow
- Docs: no README; no architecture doc for a complex system
- Tests: no e2e coverage of the single most important user flow
- QA: common-case flow fails on a mainstream browser

Critical findings need fixes in the current sprint or a very explicit deferral with risk accepted.

### Major
**Should be fixed soon. Not acute, but meaningful impact or significant pattern.**

Examples:
- Performance: N+1 query on a hot path; noticeable latency or bundle bloat
- Architecture: a pattern choice that will force a refactor in 6–12 months
- UX: empty states blank; copy technical/unhelpful across multiple surfaces
- Docs: FAQ missing answers to real recurring questions; no architecture diagram
- Tests: systemic over-mocking pattern; flakiness institutionalized with retries
- QA: browser console full of errors

Major findings populate the next-sprint watchlist and the broader roadmap.

### Minor
**Would be nice to fix. Low impact or low exposure. Worth logging, not worth blocking.**

Examples:
- Code hygiene: dead code, naming inconsistency, redundant call
- UX: inconsistent spacing scale on a non-critical page
- Docs: outdated but not materially wrong tip
- Tests: a couple of skipped tests on a non-critical feature
- QA: a minor flow fails only on edge-case input

Minor findings are batch-able. One sprint of hygiene work clears most of them.

### Nit
**Preference, not a defect. Flag once; don't belabor.**

Examples:
- Subjective stylistic choice
- A color that works but could be better
- A grammatical micro-preference
- A code style the team chose, that a reviewer might have chosen differently

Nits are fine to mention in a "and by the way" section. They should not drive workflow. Do not pad a report with Nits to inflate finding count — it devalues the audit.

---

## Deciding severity

When in doubt, test the finding against these questions:

1. **What breaks if this is not fixed?** If the answer is "nothing visible to users and no risk to data or security," it's Minor or Nit.
2. **Under what conditions does it bite?** If the answer is "normal operation," it's higher. If "only under an unusual edge case," it's lower.
3. **How many users are exposed?** A bug affecting all paying customers is higher than a bug affecting a rare edge case.
4. **Is there a workaround?** A Critical with a known workaround can sometimes be downgraded to Major.
5. **Does leaving it unfixed compound?** A systemic pattern is Major even if each instance is Minor.

**Anti-patterns to avoid:**

- Calling everything Critical so the team takes it seriously — this destroys your credibility. Trust the framework.
- Calling things Minor because you're afraid of conflict — if it's Major, say Major.
- Treating security findings as Major by default — security findings are Critical or Blocker unless the exposure is truly theoretical.

---

## Severity rollup (for the executive report)

When summarizing, report the count by severity across all roles:

```
Blocker: 2
Critical: 7
Major: 23
Minor: 41
Nit: 8
-----
Total: 81
```

Then pick the Top 10 findings across all roles — the ones that, if the dev team fixes only 10 things, deliver the most value. Usually: all Blockers, most Criticals, and a few especially high-leverage Majors.

---

## Language to use in findings

- Use **"is"** and **"does"** for things you verified. "The signup flow fails with a 500 when..."
- Use **"appears to"** and **"may"** for things you inferred without direct verification. "The endpoint appears to lack rate limiting."
- Use **"recommend"** or **"suggest"** in fix paths. Not "you should" — that's lecturing.

Write findings in the voice of a trusted senior colleague, not a prosecutor.
