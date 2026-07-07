# Lane: Walkthrough

A Playwright-driven runtime audit of the product as a real (and adversarial) user —
with the **first-run discipline** from `references/shared-backbone.md` as its spine.
This lane is the authority on first-run truth and interface wiring. When the Full
lane also runs, **this lane's report is Full's input** — Full reads it instead of
re-walking the UI.

Apply the shared backbone in full: the first-run rule, the environment attestation,
the severity framework. They are not repeated here.

## Steps

### 1. Build the product model
Read the repo as the source of truth: purpose, roles, primary/secondary workflows,
expected screens/routes/states, what the UI promises vs. what docs/spec promise, and
**every external dependency and first-run gate** (model server, DB, license, cloud,
API key, network, hardware) — for each, what happens when it is ABSENT, and can a new
user reach the core feature by following the in-product path?

### 2. Bring up the app — and VERIFY the environment
Derive setup from the repo. Launch locally; capture every blocker, failed script,
missing env var/service, type/lint/build failure. Then **verify the environment**
(shared backbone §2): prove the clean/isolated profile was actually used (assert the
app wrote config + first-run markers to the isolated location), and **probe** each
dependency's real state (present/absent, measured). Record the attestation. No
attestation → no first-run verdict.

### 3. Zero-state / first-run pass + provisioning matrix (MANDATORY)
Before general exploration, construct and walk the states a new user hits:
- Fresh verified-isolated profile, empty data, first-run flags unset, **every
  dependency ABSENT**. Walk onboarding end to end and **try the core feature with
  nothing set up.** A dead-end on the core feature is a **Blocker**.
- **Provisioning matrix:** `{first-run vs returning} × {dependency present vs ABSENT}
  × {data empty vs populated} × {offline vs online}`. The dependency-ABSENT row is
  mandatory. State which cells you covered.
- **Construct states deliberately** — kill the dependency, clear the store, remove
  the license, disconnect the network, reset first-run flags. Record what the UI did
  (guided / degraded / dead-ended / errored silently).

### 4. Explore with Playwright
All routes, forms, state-changing actions, modals/menus/wizards; empty/loading/error/
success/disabled states; back/forward, refresh, desktop + mobile viewports. Click
every meaningful control. Adversarial paths: invalid/empty input, interrupted flows,
repeated submits, stale navigation.

### 5. Cross-check wiring
UI → route → component → state → API → service → schema → persistence. Inert
controls, dead routes, placeholder pages shown as done, stubs presented as real,
forms accepting invalid data, state changes that don't persist, console/network
errors.

### 6. Cross-check docs & design
Classify each promised feature: working / partially wired / broken / in-code-not-UI /
in-UI-unsupported / documented-not-implemented / ambiguous.

### 7. Assess tests (UI-critical)
What the tests prove; render-only or pass-despite-broken; missing
error/empty/loading/permission-state coverage; the highest-value tests to add.

## Evidence
Per finding: route/screen, element/workflow, expected, actual, evidence
(screenshot/trace/console/network/a11y/code ref), likely cause, suggested fix,
suggested test. Severity per the shared framework.

## This lane's output
- The environment-provisioning attestation (verified).
- The **first-run verdict**: reaches core feature ✅ / dead-ends a new user ❌ /
  NOT VERIFIED.
- Numbered findings + a readiness-by-area table.
- If running standalone (not inside `all`): emit a **PARTIAL CHECK** gate verdict
  (it is not the full advancement gate on its own). If inside `all`: hand this report
  to Full and contribute to the combined verdict.
