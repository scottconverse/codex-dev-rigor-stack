---
name: dev-rigor-stack-walkthrough
metadata:
  version: 1.7.0
description: Run the dev-rigor-stack's exhaustive black-box newcomer journey and UI/UX audit. Use for first-run testing, published-installer testing, onboarding and configuration, every-screen/every-control runtime coverage, visual and accessibility inspection, interface-to-function wiring, update/repair/uninstall lifecycle checks, or the walkthrough lane of a stage or release gate. Recognize requests such as "dev rigor walkthrough", "/dev-rigor-stack-walkthrough", "test it like a new user", "click everything", and "audit every screen".
---

# Dev Rigor Stack Walkthrough — black-box newcomer and interface gate

Audit the product as a real first-time human, then as an adversarial operator. Blind
automation, source review, unit tests, CI, and a developer's provisioned machine do not
substitute for observing the published product. Preserve every earlier first-run,
dependency-absent, route, form, state, wiring, documentation, and test-assessment check;
the requirements below extend them.

Read `../dev-rigor-stack/references/artifact-contracts.md` and emit its run-manifest,
findings, coverage-ledger, handoff, and gate-result shapes in addition to the human report.

## Modes and truth labels

- **Candidate mode:** test a staged installer or packaged candidate before publication.
  Label acquisition and live-release claims UNPROVEN.
- **Published mode:** begin at the public front door, consume Visitor Audit's acquisition
  handoff, download the published installer, and test that exact artifact.
- **Scoped mode:** for a per-unit change, exhaustively exercise changed journeys plus core
  regression paths. Report PARTIAL COVERAGE; never call it a full walkthrough.
- **Full mode:** inventory and exercise every reachable screen, control, distinct path,
  meaningful state, and installer lifecycle operation in declared platform scope.

If the user does not choose, use scoped mode for a unit and full published mode at a
release boundary. State the mode, artifact, platform matrix, and exclusions before the
verdict.

## Phase 1 — blind acquisition before source knowledge

For published mode, remain blind before inspecting source. Use only information a new
user can see on public pages and in the product. Do not read repository implementation,
private setup notes, developer environment variables, or internal architecture before
recording newcomer observations.

1. Start at the public product page, not a memorized release URL.
2. Find the download and platform choice through the visible journey.
3. Consume and independently verify Visitor Audit's acquisition handoff: product page,
   release page, installer URL, version, filename, size, checksum/signature,
   requirements, and install claims.
4. Download the published installer exactly as a new user would. Do not substitute a
   repository build, locally packaged artifact, or cached installer.
5. Record discoverability, confusing choices, warnings, redirects, download friction,
   and any mismatch between public claims and the artifact received.

If no acquisition handoff exists, build it from public evidence and mark the missing
upstream Visitor Audit. Do not silently skip acquisition.

## Phase 2 — construct and prove a clean machine state

Use a fresh VM, OS user, disposable container, clean browser profile, or equivalent
clean machine boundary. Merely changing one config directory on a provisioned developer
machine is not equivalent; label it clean-profile-only and invalidate clean-machine
coverage.

Attest with artifacts:

- OS, edition, architecture, patch level, locale, display scaling, and theme;
- clean-machine/profile mechanism and proof the application used it;
- absence of prior product files, settings, credentials, licenses, caches, and data;
- absence/presence of every external dependency, measured rather than assumed;
- installed runtimes and developer tools, including confirmation when intentionally
  absent;
- network state, permissions, and security policy;
- exact installer hash/signature and source URL.

Run the first-use matrix across first-run/returning, dependency present/absent, data
empty/populated, and online/offline wherever the dimension is meaningful. A core
first-run dead end is a Blocker. If clean isolation cannot be proven, coverage is INVALID.

## Phase 3 — audit the full installer lifecycle

Capture every installer screen, prompt, default, warning, license step, destination,
component choice, permission/elevation request, security dialog, progress state, success
state, failure state, and launch option. Verify what the installer actually changes:
files, directories, services, processes, shortcuts, PATH, registry/configuration, file
associations, scheduled tasks, permissions, and logs as applicable.

Exercise and record:

- normal install and first launch;
- cancellation at each meaningful stage and recovery afterward;
- invalid destination, insufficient permissions, low disk space where safely testable,
  missing runtime/dependency, offline/network interruption, and corrupted or wrong-platform
  artifact;
- repeated installation and idempotence;
- update from every supported prior version in scope, including data/settings migration;
- downgrade behavior when supported or a clear refusal when unsupported;
- repair/reinstall with settings and data preserved as promised;
- uninstall, optional data removal choices, restart requirements, and leftovers;
- reinstall after uninstall and recovery from an interrupted update.

An installer that completes but leaves the product unusable does not pass.

## Phase 4 — inventory before interaction

Create stable IDs and denominators for:

- every screen, window, route, page, dialog, modal, wizard step, tab, menu, tray item,
  panel, and meaningful responsive variant;
- every control: button, link, menu item, input, selector, toggle, checkbox, radio,
  slider, table action, row action, drag/drop target, keyboard shortcut, context action,
  notification action, and system-integration entrypoint;
- every meaningful state: initial, empty, loading, success, partial, disabled, hover,
  focus, pressed, selected, validation, permission-denied, offline, timeout, interrupted,
  stale, conflict, and error;
- every distinct user-visible navigation transition and workflow path.

Discover through visible navigation first. After the blind pass, compare against public
documentation and then source route/control inventories to find hidden, unreachable,
undocumented, or accidentally exposed surfaces. Unknown inventory means coverage INVALID.

## Phase 5 — exercise every screen, control, and distinct path

Click and operate every control in the inventory. Traverse every distinct reachable
workflow and navigation edge, including back, forward, cancel, close, escape, refresh,
restart, resume, repeated submission, invalid/empty input, stale state, permission denial,
and interrupted operations. “Every path” means every distinct user-visible transition in
the bounded state graph, not infinite permutations of arbitrary data.

For every item record:

```text
id, screen, control_or_path, interface promise, preconditions, action,
expected outcome, actual outcome, function/destination reached,
persistence after refresh/restart, evidence, result
```

A control does not pass because it animates, navigates somewhere, or returns HTTP 200.
The resulting function must match the interface promise, complete successfully, persist
as promised, and show an honest visible outcome.

Use disposable accounts and data. Purchases, messages, publication, deletion of
user-owned data, real account changes, or other external side effects require explicit
authority. Inventory them and mark blocked rather than silently skipping or falsely
passing them.

## Phase 6 — systematic visual and accessibility inspection

Capture every screen and important state at the supported viewport/window sizes,
breakpoints, display scaling/DPI, themes, zoom levels, and orientations in scope. Inspect:

- spacing, alignment, rhythm, padding, density, and inconsistent component geometry;
- hierarchy, typography, iconography, copy, labels, and visual consistency;
- clipping, overlap, overflow, truncation, wrapping, scroll traps, jitter, layout shift,
  and content obscured by chrome or virtual keyboards;
- responsive resizing, minimum/maximum window behavior, multi-monitor movement, and
  high-DPI transitions where applicable;
- contrast, color-only meaning, focus visibility, tab order, keyboard-only operation,
  accessible names/roles/states, screen-reader announcements where tooling permits,
  reduced motion, and zoom/text scaling;
- hover, focus, pressed, selected, disabled, loading, empty, error, warning, success,
  destructive, and confirmation treatments;
- misleading affordances: inert elements that look clickable and working controls that
  do not look interactive.

Use rendered observation and screenshots, not CSS/source inspection alone. For web UI,
use browser automation plus DOM, console, network, and accessibility evidence. For native
desktop/mobile UI, use Computer Use or an appropriate native automation surface; do not
pretend Playwright covers a native application.

## Phase 7 — white-box wiring and promise verification

Only after blind observations are frozen, inspect implementation and trace every tested
interaction through the actual path:

```text
control → event → route/component → state → API/service → schema → persistence
→ visible result
```

Find inert controls, dead routes, placeholder pages presented as complete, stubs presented
as real, wrong handler bindings, invalid input accepted, errors swallowed, state that does
not persist, incorrect defaults, console/network errors, and docs or labels that promise a
different function. Classify each promised feature as working, partially wired, broken,
in-code-not-UI, in-UI-unsupported, documented-not-implemented, or ambiguous.

Assess whether existing tests would fail for every confirmed defect. Recommend the
smallest high-value regression test for each gap; render-only tests are not runtime proof.

## Evidence, severity, and coverage ledger

Use Blocker/Critical/Major/Minor/Nit from the shared dev-rigor-stack contract. Each
finding contains location, expected, actual, reproducible steps, evidence artifact,
likely cause, fix path, and regression test. Preserve suspected/unverified findings as
such.

Report denominators:

```text
Installer stages: inventoried / exercised / passed / failed / blocked
Screens: inventoried / inspected / passed / failed / blocked
Controls: inventoried / exercised / passed / failed / blocked
Distinct paths: inventoried / completed / failed / blocked
Visual states: inventoried / captured / inspected / failed
Accessibility checks: applicable / passed / failed / blocked
Lifecycle operations: install / update / repair / uninstall / reinstall
```

Every item must be passed, failed, blocked, unverifiable, or excluded with a reason.
Missing denominators, missing artifacts, a contaminated blind pass, or unverified clean
state makes full coverage INVALID. A gap is never a pass.

When invoked alone, emit a standalone Walkthrough report and PARTIAL CHECK relative to
the overall release gate. When invoked by `$dev-rigor-stack-gauntletgate`, provide the
attestation, acquisition evidence, coverage ledger, findings, first-run verdict, and
machine-readable gate result. Under the default stack policy, advancement and release
closure require 0/0/0/0/0.
