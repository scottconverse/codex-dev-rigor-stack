# Engineering Deep-Dive — [Project Name]

**Audit date:** [YYYY-MM-DD]
**Role:** Principal Engineer
**Scope audited:** [what was reviewed]
**Auditor posture:** [Balanced | Adversarial]

---

## TL;DR

[3–5 sentences. Code shape, top concern, level of architectural debt, security posture at a glance. Honest.]

## Severity roll-up (engineering)

| Severity | Count |
|---|---|
| Blocker | [N] |
| Critical | [N] |
| Major | [N] |
| Minor | [N] |
| Nit | [N] |

## What's working

- **[Specific thing]** — [evidence]
- **[Specific thing]** — [evidence]

## What couldn't be assessed

[Missing access, broken build, no CI logs, etc. "All items in scope were accessible" if nothing was skipped.]

---

## Findings

> **Finding ID prefix:** `ENG-`
> **Categories:** Architecture / Correctness / Security / Performance / Data provenance / Dependencies / Hygiene

### [ENG-001] — [Severity] — [Category] — [Title]

**Evidence**
[File paths with line numbers. Code snippets. Reproduction steps. grep/rg output if demonstrating a pattern. Versions of runtime, language, dependencies where relevant.]

**Why this matters**
[What breaks, when, for whom.]

**Blast radius**
- Adjacent code: ...
- Shared state: ...
- User-facing: ...
- Migration: ...
- Tests to update: ...
- Related findings: ...

**Fix path**
[Concrete recommendation.]

---

[... continue for each finding, sorted by severity ...]

---

## Patterns and systemic observations

[Root causes that produce multiple findings. Usually the highest-leverage content in this report.]

## Dependency snapshot

[If the project has a dep manifest, a short table of dependencies with concerns.]

| Dependency | Version | Concern |
|---|---|---|
| [name] | [version] | [CVE / abandoned / license / bloat / other] |

[Or: "Dependency surface is clean — no notable concerns."]

## Appendix: artifacts reviewed

[Files, directories, PRs, commits this role actually read.]
