# Runtime QA Deep-Dive — [Project Name]

**Audit date:** [YYYY-MM-DD]
**Role:** QA Engineer
**Scope audited:** [surfaces and layers tested — web frontend, API, CLI, protocol, etc.]
**Environment:** [browser + version, OS, API base URL, build/version, etc.]
**Auditor posture:** [Balanced | Adversarial]

---

## TL;DR

[3–5 sentences. Did the product behave as claimed? What's the most serious runtime issue? Any security/privacy issues uncovered while running?]

## Severity roll-up (QA)

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

[Paid-tier features, staging env offline, no credentials for admin/enterprise, mobile native app without device, etc. Be explicit.]

---

## Product shape

[One paragraph — what this product is, and what dimensions QA focused on as a result.]

## Flows exercised

| Flow | Result | Findings |
|---|---|---|
| [Flow name, e.g. "Signup → first value"] | Pass / Fail / Partial | [QA-X, QA-Y] |
| [Flow] | | |

## Adversarial scenarios exercised

[Scenarios deliberately run to try to break the product: invalid input, concurrency, auth expiration, network degradation, etc. Record each and its outcome.]

| Scenario | Outcome | Findings |
|---|---|---|
| [e.g. submit with expired token] | [e.g. 500 instead of 401] | [QA-X] |
| | | |

---

## Findings

> **Finding ID prefix:** `QA-`
> **Categories:** Flow / API / Security / Performance / Browser / Mobile / Console / Protocol / Install / Auth

### [QA-001] — [Severity] — [Category] — [Title]

**Evidence**
[Numbered reproduction steps. Environment (browser + version, viewport, OS, API version). Observed vs. expected. Screenshots, network captures, console output if available.]

**Why this matters**
[Who is affected. Under what conditions.]

**Blast radius**
- Related endpoints / flows / browsers: ...
- Tests to update: ...
- Related findings: ...

**Fix path**
[Concrete hand-off.]

---

[... continue ...]

---

## Performance snapshot

| Metric | Observed | Benchmark | Verdict |
|---|---|---|---|
| LCP (largest contentful paint) | [s] | <2.5s | [pass/fail] |
| CLS (cumulative layout shift) | [N] | <0.1 | [pass/fail] |
| INP (interaction to next paint) | [ms] | <200ms | [pass/fail] |
| API P50 latency (primary endpoint) | [ms] | [category benchmark] | [pass/fail] |
| Startup / cold-start | [ms] | | |
| Bundle size (client) | [KB] | | |

[Omit rows that don't apply to the product type.]

## Security / privacy snapshot

[Short list of security findings surfaced via runtime testing — IDOR attempts, session handling, token exposure, CORS, CSP, mixed content, etc. Cross-link to engineering findings where shared.]

## Console and log observations

[Summary of browser console health and/or server log health across the audit.]

## Patterns and systemic observations

[Patterns across multiple flows, endpoints, or browsers.]

## Appendix: environments and artifacts

[Browsers tested, viewport sizes, OS, API versions, credentials tier used (or equivalent), tools used (Playwright, curl, Postman, Wireshark, etc.).]
