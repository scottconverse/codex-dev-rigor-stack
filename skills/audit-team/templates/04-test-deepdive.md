# Test Suite Deep-Dive — [Project Name]

**Audit date:** [YYYY-MM-DD]
**Role:** Test Engineer
**Scope audited:** [test directories and frameworks reviewed]
**Auditor posture:** [Balanced | Adversarial]

---

## TL;DR

[3–5 sentences. The shape of the test suite. What it covers well, what it doesn't. The most important class of bug that would slip through.]

## Severity roll-up (tests)

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

[CI history locked, coverage tool not configured, test suite doesn't run in this env, etc.]

---

## Test landscape

| Dimension | Observation |
|---|---|
| Framework(s) | [Jest / Vitest / Pytest / Rspec / etc.] |
| Test pyramid shape | [heavy unit / thin integration / no E2E / etc.] |
| Coverage tool | [Istanbul / coverage.py / go tool cover / none] |
| Reported coverage (if any) | [N%] — [with honest caveats] |
| Flakiness posture | [clean / occasional / normalized with retries] |
| CI blocking? | [yes / no / sometimes bypassed] |

---

## Findings

> **Finding ID prefix:** `TEST-`
> **Categories:** Coverage / Shortcut / Flakiness / Quality / Ergonomics / Mocking / Regression / CI

### [TEST-001] — [Severity] — [Category] — [Title]

**Evidence**
[Specific test file paths and lines. grep output for pattern-level findings. CI log excerpts if relevant.]

**Why this matters**
[What user behavior is at risk. What class of bug slips through.]

**Blast radius**
- Test files affected: ...
- Related findings: ...

**Fix path**
[Add a test at X. Rewrite Y. Remove the retry config. Etc.]

---

[... continue ...]

---

## Shortcut census

[Quick inventory: how many `.skip`, `.only`, `TODO: add test`, `@pytest.mark.xfail`, empty test bodies, etc. A single number across the codebase is useful context.]

| Shortcut pattern | Count |
|---|---|
| `.skip` / `xit` / `@skip` | [N] |
| `.only` (left in) | [N] |
| `TODO: add test` / similar | [N] |
| Empty assertion / placeholder | [N] |
| `--retry` / retries normalized | [yes/no] |

## Blind spots by class

[List the classes of bug the existing suite would allow through. Examples: "concurrency / race conditions," "auth boundary crossing," "malformed input," "empty and partial states," "regression after refactor."]

## Patterns and systemic observations

[Over-mocking, snapshot ossification, flaky-then-retry culture, etc.]

## Appendix: test artifacts reviewed

[Test directories, sample test files read, CI config files consulted.]
