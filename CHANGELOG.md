# Changelog

All notable changes to dev-rigor-stack. Dates are release (tag) dates.

## 1.0.0 — 2026-07-13

- **Strengthened without subtraction:** restored the standalone Visitor Audit link checker
  as a strict superset of both prior implementations: live URLs, local files, redirects,
  HEAD-to-GET fallback, rate-limit retry, parallel checks, JSON/human output, publish-root
  resolution, asset extraction, and offline self-tests.
- **Added:** exhaustive standalone `dev-rigor-stack-walkthrough`: blind-first public
  acquisition, verified clean-machine state, published installer lifecycle, every-screen,
  every-control, distinct-path and meaningful-state inventories, visual/accessibility QA,
  function wiring, update, repair, uninstall, and numerical coverage ledgers.
- **Added:** thirteen namespaced standalone stage skills plus six backward-compatible
  entrypoints, all installed together and routed by the coordinator.
- **Integrated:** Visitor Audit now emits the exact acquisition handoff consumed by
  Walkthrough; releases run candidate passes before go/no-go and repeat both against live
  public artifacts before announcement or closure.
- **Changed:** GauntletGate consumes the canonical Walkthrough and defaults to strict-zero
  `0/0/0/0/0` under the overall stack.
- **Added:** shared run-manifest, claims, findings, coverage-ledger, handoff, and gate-result
  contracts with artifact identity and invalid-coverage rules.
- **Added:** behavioral and contract tests plus Linux/Windows installer smoke tests in CI.
- **Fixed from live Visitor evidence:** remote Markdown sources are identified from their
  content type, final URL, and content rather than being misparsed as HTML with zero links.

## Unreleased (pre-1.0 history)

- **Added:** `visitor-audit` as the PUBLIC SURFACE gate. Public-facing units receive a
  rendered-surface review after publication; releases receive a candidate/staging pass
  before go/no-go and a mandatory live post-deploy pass before announcement or closure.
- **Added:** bundle consistency validation so the manifest, skill payloads, and both
  installers cannot silently drift.

## v1.5.1 — 2026-07-08

Drive-to-zero release: every finding from a full five-role audit of v1.5.0
(4 Critical / 11 Major / 10 Minor / 2 Nit) fixed — nothing waived or deferred.

- **Fixed (Critical):** `export-portable.ps1` mojibaked em dashes/smart quotes on
  Windows PowerShell 5.1 (bare `Get-Content` ANSI fallback); the script now reads
  explicit UTF-8, is itself pure ASCII, and both exporters produce **byte-identical**
  bundles — enforced in CI on real PS 5.1.
- **Fixed (Critical):** `skills/audit-team/SKILL.md` had shipped with 119 trailing NUL
  bytes since v1.3; stripped, and a repo-wide content-integrity test (NUL/mojibake/BOM)
  now gates every commit.
- **Fixed (Critical):** the `audit-team` orchestration guide (and `gauntletgate`'s full
  lane) instructed bare-Agent fan-out — rewritten to Workflow-tool dispatch with leaf
  workers, matching the stack's own hard rule.
- **Fixed (Critical):** `dev-rigor-activate.js` (the always-on reflex mechanism) had
  zero test coverage; now covered (default mode, subagent JSON mode, missing-file
  fail-open).
- **Fixed (Major):** the no-Node install path claimed hooks were active and pointed at
  README instructions that didn't exist; both installers now report hook status
  truthfully and README gained a real "Manual hook wiring" section.
- **Fixed (Major):** the portable bundle dropped `references/`, `lanes/`, `templates/`,
  and `SKILL-LITE` files that the skills' own text tells readers to consult; both
  exporters now include every support file.
- **Fixed (Major):** `audit-lite`/`audit-team` hard-gated "done" on a Cowork-only
  presentation tool; delivery is now host-conditional (Cowork `present_files`, Claude
  Code SendUserFile, or clearly listed paths).
- **Fixed (Major):** no CI existed; GitHub Actions now runs the full hook suite,
  the sync-block check, and export parity on Ubuntu + Windows for every push/PR —
  and `tools/check_sync.py` now actually exists, making the `coder-tdd-qa` sync-
  enforcement claim true.
- **Fixed (Major):** `wire-settings.js` crashed with a raw stack trace on a
  syntactically-valid but structurally-unexpected `settings.json`; it now refuses
  cleanly (exit 1, file untouched), same as the corrupt-JSON path.
- **Fixed (Major):** the rigor router hijacked ordinary programming vocabulary
  ("the mutex release causes a deadlock") into the release discipline; release now
  requires release-verb/noun context, with adversarial-vocabulary tests.
- **Fixed (Minor):** landing page gained CTA hover/focus states, a favicon,
  Open Graph/Twitter meta, and a mobile scroll affordance on wide diagrams; repo
  gained `CONTRIBUTING.md` and `SECURITY.md`; hook payload markdown is pinned to LF
  on every platform; the ledger concurrency test now runs at 40 writers.
- Suite: 31 → 41 tests.

## v1.5.0 — 2026-07-08

"Fable-on-Opus": procedure-level enforcement of verification behavior, clean-room
from concepts proven transferable by fivetaku/fablize's Fable-vs-Opus comparison
(MIT, credited; no fablize code used).

- **Added:** rigor router (`UserPromptSubmit` hook) — classifies each prompt and
  injects only the matching task protocol (investigation / grounding / decomposition /
  release), once per discipline per session; silence otherwise.
- **Added:** grounding check (`PostToolUse` + `Stop` hooks) — append-only per-session
  ledger; blocks a stop once if runnable files were edited but nothing was ever
  executed or rendered. Fails open, respects `stop_hook_active`.
- **Added:** evaluator-owned exits — `/goal` wiring documented in the skill and manual
  (deterministic exit + try cap; worker ≠ judge for the stop condition).
- **Changed:** reflex trimmed to universal rules only (the router carries task
  protocols); `wire-settings.js` replaces its own stale entries on re-run and refuses
  to overwrite a corrupt `settings.json`.
- Suite: 21 → 31 tests (hermetic child-process tests, concurrency + corruption
  regressions included).

## v1.4.2 — 2026-07-07

- Node.js documented as a required dependency for the reflex hook (skills install
  without it); Windows install line uses `-ExecutionPolicy Bypass`; added
  `.gitattributes` line-ending normalization.

## v1.4.1 — 2026-07-07

- Version bump across surfaces (manifest + skill header) after the v1.4 landing/docs
  rebuild.

## v1.4.0 — 2026-07-07

- **Added:** the always-on dev-rigor reflex hook (SessionStart/SubagentStart), bundled
  in-repo with installer wiring; ponytail dropped as a dependency (prior-art form
  credit retained).
- Landing page rebuilt with inline-SVG architecture drawings.

## v1.3 — 2026-07-07 (initial public release)

- Six-skill stack (dev-rigor-stack, coder-tdd-qa, proof-gate, audit-lite, audit-team,
  gauntletgate) with cross-platform installers, portable export, two-voice manual,
  architecture docs, and landing page.
