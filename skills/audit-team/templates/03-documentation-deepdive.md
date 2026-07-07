# Documentation Deep-Dive — [Project Name]

**Audit date:** [YYYY-MM-DD]
**Role:** Technical Writer
**Scope audited:** [docs reviewed — README, architecture, user manual, API ref, FAQ, marketing copy, etc.]
**Writer mode:** [audit-only | audit+draft | full-rewrite]
**Auditor posture:** [Balanced | Adversarial]

---

## TL;DR

[3–5 sentences. What's the state of the docs? Would a new user succeed? Are the docs honest? The single most important takeaway.]

## Severity roll-up (documentation)

| Severity | Count |
|---|---|
| Blocker | [N] |
| Critical | [N] |
| Major | [N] |
| Minor | [N] |
| Nit | [N] |

## What's working

- **[Specific thing]** — [evidence: doc path, section]
- **[Specific thing]** — [evidence]

## What couldn't be assessed

[Docs that are claimed to exist but weren't accessible; marketing pages behind paywalls; archived content.]

---

## Doc asset inventory

[A table of what exists vs. what's expected for this project type.]

| Asset | Exists? | Status | Finding(s) |
|---|---|---|---|
| README.md | Yes/No | [Strong / Adequate / Weak / Missing] | [DOC-X, DOC-Y] |
| ARCHITECTURE.md | | | |
| User manual / guide | | | |
| API reference | | | |
| FAQ | | | |
| CHANGELOG | | | |
| CONTRIBUTING | | | |
| SECURITY | | | |
| LICENSE | | | |
| Landing / marketing page | | | |

---

## Persona walk-through

### First-time user
[What do they encounter? Do they succeed at installing / trying / signing up?]

### Returning user
[Can they find the answer to a specific question fast? Is search or nav adequate?]

### New team member
[Can they get a dev environment running? Do they understand the architecture?]

---

## Findings

> **Finding ID prefix:** `DOC-`
> **Categories:** Accuracy / Completeness / Onboarding / Architecture / API / FAQ / Marketing / Tone / Hygiene

### [DOC-001] — [Severity] — [Category] — [Title]

**Evidence**
[Exact doc path and line or section. Quote problematic text verbatim when short.]

**Why this matters**
[Which persona is blocked or misled, and how.]

**Blast radius**
- Other docs that repeat the same error: ...
- User-facing: ...
- Related findings: ...

**Fix path**
[Short rewrites inline. Longer replacements deferred to `doc-rewrites/<name>.md`.]

---

[... continue ...]

---

## Drafts produced

[If writer mode is audit+draft or full-rewrite, list the files created in `doc-rewrites/`. Otherwise: "Writer mode is audit-only; no drafts produced in this pass."]

- `doc-rewrites/README.md` — [what it covers]
- `doc-rewrites/ARCHITECTURE.md` — [with diagram]
- `doc-rewrites/FAQ.md`
- `doc-rewrites/user-manual.md`

## Marketing / honesty audit

[If marketing copy is in scope, specific findings about overclaim, vague value props, misleading feature lists, unsubstantiated stats.]

## Patterns and systemic observations

[Tone drift, naming drift, version-number drift, doc debt that correlates with specific doc types, etc.]

## Appendix: docs reviewed

[Paths / URLs of every doc actually read.]
