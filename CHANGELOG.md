# Changelog

All notable changes to dev-rigor-stack. A version heading does not imply a Git tag exists
in this repository.

## 1.6.3 — 2026-07-13

Stop-hook safety repair. Versions 1.6.0–1.6.2 could carry a runnable edit beyond the
turn that created it. Version 1.6.2 tried to infer turn boundaries from
`UserPromptSubmit`, but Codex already supplies authoritative `session_id` and `turn_id`
values, and ambient prompt events are not reliable turn boundaries. Those versions are
unsupported and should be uninstalled or replaced.

- **Scoped state to Codex's real identity:** PostToolUse and Stop/SubagentStop now share
  one append-only `ground-v3-*` ledger per exact `(session_id, turn_id)` pair. IDs are
  hashed without lossy sanitization, preventing cross-session, cross-turn, and filename
  collisions.
- **Removed prompt-boundary inference:** UserPromptSubmit routes disciplines only. It can
  neither clear nor create grounding state, including when Codex emits ambient prompt
  events without a corresponding Stop.
- **Added a hard retry circuit breaker:** after one evidence block, the retry is released
  and checkpointed when no new tool event occurred—even if a client omits or misreports
  `stop_hook_active`. New tool activity re-arms evaluation.
- **Made failure safe:** missing turn identity and inability to persist retry state fail
  open instead of creating a global or permanent response-discard loop.
- **Corrected real result parsing:** failed executions reported inside nested Codex
  response content, explicit failure fields, or live policy-rejection text cannot count
  as successful proof, while successful output such as “Error handling tests passed” is
  not misclassified by broad keyword matching.
- **Quarantined all old state:** 1.6.0/1.6.1 and 1.6.2 ledgers remain inert audit history;
  1.6.3 reads only the new turn-scoped namespace.
- **Expanded regression coverage:** 41 hook tests now cover ambient events, normal
  conversation after edits, same-turn retries with and without `stop_hook_active`,
  re-arming, subagents, missing IDs, read-only state, legacy ledgers, identity collisions,
  concurrent writes, nested failed tool responses, and live policy rejection.
- **Added an authenticated disposable-profile capstone:** the real Codex 0.143.0
  app-server performs a happy edit/run/checkpoint turn, a forced receipt-free turn that
  records exactly one block before retry release, and a later ordinary conversation.

## 1.6.2 — 2026-07-13

Withdrawn state-machine hotfix. Version 1.6.1 kept the last runnable edit live for the
entire session, so later read-only reports and ordinary conversation could be discarded
unless they repeated a coding evidence receipt.

This attempted repair used `UserPromptSubmit` as an inferred turn boundary. That model
was incomplete and is superseded by 1.6.3's exact Codex turn identity.

- **Scoped enforcement to the current user turn:** every `UserPromptSubmit` records a
  prompt boundary; Stop/SubagentStop inspect only activity after the latest prompt boundary
  or accepted receipt.
- **Added explicit receipt checkpoints:** a successful execution plus a compliant
  `proved / blast / skipped` receipt clears that coding unit's dirty state.
- **Preserved re-arming:** any later runnable edit creates a new dirty state and still
  requires a later successful execution/render and receipt.
- **Prevented retry loops:** Codex's `stop_hook_active` retry passes without recursively
  invoking the same rejection; the next genuine user prompt starts a clean scope.
- **Quarantined legacy state without deleting evidence:** 1.6.1 ledgers remain on disk as
  audit history, while 1.6.2 writes and reads a new `ground-v2-*` namespace.
- **Added regression proof:** tests cover checkpoint clearing, later-edit re-arming,
  cross-turn isolation, active retry behavior, current-turn enforcement, and legacy-ledger
  quarantine while retaining every prior hook contract test.

## 1.6.1 — 2026-07-13

Desktop activation hotfix. Version 1.6.0 installed the active hook definitions but
incorrectly directed Codex Desktop users to the CLI-only `/hooks` command.

- **Added a native graphical hook activator:** no terminal or command knowledge is needed.
- **Kept the trust decision human:** all six event purposes, commands, sources, statuses,
  and current hashes are reviewable before an explicit confirmation.
- **Restricted trust scope:** the activator refuses partial, duplicate, foreign-source, or
  unexpected event sets and writes only the six owned current hashes.
- **Bound definitions to runtime bytes:** every command embeds the expected script SHA-256,
  verifies one read buffer, and compiles that same buffer; changed hook files are refused.
- **Made installation transactional:** both installers stage skills, runtime, and merged
  hook configuration, then roll back injected mid-commit and backup failures, including a
  clean first install with no partial directories left behind.
- **Closed the lifecycle:** uninstall revokes exactly the six owned trusted hashes before
  removal while preserving foreign trust state; restore merges only owned definitions into
  the current hook file instead of overwriting later foreign hooks.
- **Proved the real Desktop path:** a compiled WinForms capstone clicks the actual Trust
  button, exercises safe cancel/incomplete/error states, and a fresh app-server process
  verifies 6/6. The protocol stream is explicitly BOM-free for Codex JSON.
- **Used Codex's supported integration:** `hooks/list` discovers the current definitions;
  `config/batchWrite` records trust exactly as Codex's own hook review does; a second
  `hooks/list` proves the result.
- **Corrected every Desktop-facing claim and path:** the README, manual, architecture,
  landing page, installers, security model, manifest, tests, and CI now describe the
  graphical flow. Versioning advances monotonically from 1.6.0 to 1.6.1.

## 1.6.0 — 2026-07-13

Version 1.6.0 restores monotonic product-line versioning after the interim 1.0.0 Codex
package number. Future releases advance from 1.6.0.

- **Added active Codex lifecycle enforcement:** SessionStart/SubagentStart reflex,
  UserPromptSubmit routing, PostToolUse grounding, and Stop/SubagentStop evidence gates.
- **Strengthened grounding:** only a successful real execution or render after the latest
  runnable edit clears the gate; an earlier test run, or an explicitly failed later check,
  no longer excuses a trailing edit.
- **Added mechanical receipt enforcement:** runnable changes require the exact proved / blast /
  skipped evidence receipt before a normal stop.
- **Added safe Codex hook wiring:** installers preserve foreign hooks, refuse corrupt
  `hooks.json`, back up configuration, and support ownership-safe hook removal.
- **Corrected architecture:** active Codex hooks now appear in the primary system and
  deployment flows; Claude source is limited to a provenance note.
- **Added Codex hook behavior tests** alongside the retained upstream regression suite on
  Windows and Linux CI.

## 1.0.0 — 2026-07-13

Historical interim Codex packaging release. This version reset was later corrected by
1.6.0 and is not the basis for subsequent version numbers.

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
- **Published documentation:** expanded the real two-voice user manual, professional
  architecture reference, and public landing page; synchronized 1.0.0 across every
  document, installer, exporter, and public release surface.

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
