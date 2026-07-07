# Shared deep-dive structure

All five role deep-dive files use the same structure. This file documents it once. Each role-specific template (01–05) is a thin wrapper that fills in the role name, ID prefix, and category list, then inherits this structure.

---

## File structure every deep-dive must follow

```markdown
# [Role] Deep-Dive — [Project Name]

**Audit date:** [YYYY-MM-DD]
**Role:** [Principal Engineer | Senior UI/UX Designer | Technical Writer | Test Engineer | QA Engineer]
**Scope audited:** [what this role actually reviewed]
**Auditor posture:** [Balanced | Adversarial]

---

## TL;DR

[3–5 sentences. What shape is this dimension in? What's the one thing the dev team most needs to know from this role?]

## Severity roll-up (this role)

| Severity | Count |
|---|---|
| Blocker | [N] |
| Critical | [N] |
| Major | [N] |
| Minor | [N] |
| Nit | [N] |

## What's working

[Specific credit. Name exactly what this role found well-done. At least two concrete items for any real project.]

- **[Specific thing]** — [evidence: file/URL/flow]
- **[Specific thing]** — [evidence]

## What couldn't be assessed

[Anything this role couldn't audit — missing access, broken build, no credentials, etc. If nothing, say so: "All items in scope were accessible."]

---

## Findings

[Use the finding block format below. Order by severity: Blockers first, then Critical, Major, Minor, Nit. Within a severity, order by leverage.]

### [ROLE-001] — Blocker — [Category] — [One-line title]

**Evidence**
[File paths with line numbers, URLs, reproduction steps, code snippets, screenshots or describable visual evidence, grep output, network captures, etc. Be specific enough that a developer can verify independently.]

**Why this matters**
[Under what conditions does this bite? Which users? What breaks or degrades? If it's a security or data issue, name the exposure.]

**Blast radius**
(Required for Blocker/Critical/Major. Omit for Minor/Nit.)
- Adjacent code: [list]
- Shared state / data / config: [if relevant]
- User-facing: [what changes from the user's perspective once fixed]
- Migration: [none | describe]
- Tests to update: [list or "none known"]
- Related findings: [cross-references]

**Fix path**
[Concrete recommendation. Not "clean this up" — an approach a developer can start executing on. For copy issues, include the rewrite. For architectural issues, sketch the target shape.]

---

### [ROLE-002] — Critical — [Category] — [Title]

[Same structure as above.]

---

[...continue for each finding, by severity...]

---

## Patterns and systemic observations

[Any time you find three or more findings that share a root cause, note the pattern here. The pattern is often more valuable than the individual findings. Examples:

- "Pattern: empty states are missing across the product — UX-003, UX-008, UX-011, UX-014. Recommend a single component and one PR that adds it to every consumer."
- "Pattern: over-mocking in the integration test suite — TEST-004, TEST-006, TEST-009 all stem from the same habit. Recommend a team decision on what a real integration test means here."
]

## Appendix: what was audited

[A short list or table of the artifacts this role actually reviewed. Useful for the dev team to understand the scope and for future audits to build on.]
```

---

## How roles use this

The role-specific templates (01-engineering-deepdive.md through 05-qa-deepdive.md) each set:
1. The role name
2. The finding-ID prefix (ENG, UX, DOC, TEST, QA)
3. The category list the role uses
4. Any role-specific sections (for instance, the Technical Writer role has a "Drafts produced" section if writer mode included drafting)

Everything else inherits from this shared structure.
