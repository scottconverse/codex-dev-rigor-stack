# codex-dev-rigor-stack — user manual

**Manual version:** 1.0.0

**Applies to Codex bundle:** 1.0.0

**Bundled upstream discipline:** 1.5.1

This is the operating manual, not a longer README. Part 1 explains the product in plain
English. Part 2 is the technical manual for installation, operation, evidence, lifecycle,
and troubleshooting.

## Contents

- [Part 1 — Plain English](#part-1--plain-english)
- [Part 2 — Technical Manual](#part-2--technical-manual)
- [Install](#install)
- [Choose an entrypoint](#choose-an-entrypoint)
- [Operate the stack](#operate-the-stack)
- [Evidence and handoffs](#evidence-and-handoffs)
- [Update, backup, restore, and uninstall](#update-backup-restore-and-uninstall)
- [Troubleshooting](#troubleshooting)
- [Versioning](#versioning)

---

## Part 1 — Plain English

### What problem does it solve?

An AI agent can write plausible code and say “done” without proving the real product
works. A passing unit test may not prove the installer opens, a button calls the right
function, the layout fits on a small screen, the public download exists, or the manual
tells the truth.

The stack makes the agent match its evidence to the claim. If the claim is about a
function, it tests the function. If the claim is about a screen, it opens and operates the
screen. If the claim is about a public release, it starts at the public front door,
downloads the published artifact, and follows the complete newcomer journey.

### What happens when I ask for work?

For an ordinary change, the agent:

1. defines what success means and how it will be tested;
2. writes or runs a check that can fail;
3. builds the change and proves the check turns green;
4. tries to break the result and reviews it at a depth proportional to risk;
5. merges only through a green pull request.

For a release, the stack adds a full adversarial gauntlet, documentation truth checking,
a clean-environment newcomer walkthrough, public-page and download verification, rollback
readiness, and a final human go/no-go. The agent prepares the decision; you own it.

### What does “proportional rigor” mean?

A spelling fix does not deserve the same process as an authentication change. The stack
uses **blast radius**, not line count, to choose review depth. A one-line change to money,
identity, permissions, or data loss is high risk. A large mechanical rename may be low
risk. Some rules never shrink: do not fabricate evidence, do not merge red, do not bypass
protection, and do not claim beyond the check actually run.

### What do Visitor Audit and Walkthrough add?

They cover the gaps source review and blind automation miss.

- **Visitor Audit** reads every public surface as rendered, checks every link and safe
  control, reviews desktop/mobile visuals, verifies release facts and assets, and records
  the exact installer a stranger would download.
- **Walkthrough** consumes that exact artifact in a verified clean environment. It runs
  the installer lifecycle, inventories every screen/control/path/state, clicks every safe
  control, verifies the promised function, checks spacing/alignment/clipping/contrast/focus,
  and exercises update, repair, uninstall, and reinstall.

Both maintain numerical coverage ledgers. “We looked around” is not complete coverage.

### What remains my decision?

You decide scope, risk acceptance, trust-boundary choices, spending, destructive external
actions, publishing, and the final release. The stack prepares evidence; it does not take
ownership away from you.

---

## Part 2 — Technical Manual

### Package model

Codex bundle 1.0.0 installs **all 19 entrypoints**: 13 canonical namespaced skills and 6
backward-compatible entrypoints. Each canonical section can be invoked independently or
through `$dev-rigor-stack`.

The repository retains three upstream Claude hook implementations for provenance. They are
not wired by the Codex installer. Codex operation is pull-based through skills; no current
surface should imply those Claude hooks are active in Codex.

## Install

### Requirements

- Codex Desktop or another client that loads `CODEX_HOME/skills`
- PowerShell 5.1+ on Windows, or Bash/Git Bash
- Git only if cloning rather than downloading a source archive
- Node.js only for tests over the retained upstream hook sources

### Windows PowerShell

```powershell
git clone https://github.com/scottconverse/codex-dev-rigor-stack
cd codex-dev-rigor-stack
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Bash, macOS, Linux, or Git Bash

```sh
git clone https://github.com/scottconverse/codex-dev-rigor-stack
cd codex-dev-rigor-stack
./install.sh
```

The default target is `~/.codex/skills`. Existing stack folders are backed up before they
are replaced. Restart Codex Desktop after installation so it reloads skill metadata.

### Custom target

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Target C:\temp\codex-skills
```

```sh
./install.sh --target /tmp/codex-skills
```

Use a custom target for clean-profile verification, CI, or another compatible host.
`-NoBackup` and `--no-backup` suppress backups only when explicitly used.

### Verify the installation

The installer must report `Installed 19 skill(s).` Verify that every manifest entry has a
`SKILL.md` in the target, restart Codex, and invoke a known entrypoint in a new task.

## Choose an entrypoint

| Entrypoint | Use it when |
| --- | --- |
| `$dev-rigor-stack` | Coordinate the complete unit and release workflow |
| `$dev-rigor-stack-continuity` | Decisions/evidence must survive sessions or machines |
| `$dev-rigor-stack-plan` | Define acceptance, tests, blast radius, and routing |
| `$dev-rigor-stack-build` | Apply the full test-first build and QA contract |
| `$dev-rigor-stack-proof-gate` | Make a claim survive adversarial refutation |
| `$dev-rigor-stack-audit-lite` | Run a fast scoped independent review |
| `$dev-rigor-stack-audit-team` | Run a high-blast five-role audit |
| `$dev-rigor-stack-walkthrough` | Exhaust the newcomer/product/UI journey |
| `$dev-rigor-stack-visitor-audit` | Audit public pages, links, visuals, assets, and claims |
| `$dev-rigor-stack-gauntletgate` | Produce a stage/release advancement verdict |
| `$dev-rigor-stack-merge-gate` | Check exact-SHA green-path merge evidence |
| `$dev-rigor-stack-docs-gate` | Prove README/manual/architecture/landing truth |
| `$dev-rigor-stack-release` | Coordinate candidate evidence through live closure |

Compatibility names—`coder-tdd-qa`, `proof-gate`, `audit-lite`, `audit-team`,
`gauntletgate`, and `visitor-audit`—remain installed and complete.

## Operate the stack

### Per-unit flow

1. **PLAN** traces the real path, defines acceptance and the test list, and classifies
   blast radius.
2. **BUILD** observes a valid RED failure, makes the minimum change for GREEN, refactors
   under tests, and widens the run.
3. **VERIFY** attempts to refute the claim and rejects checks that cannot fail.
4. **REVIEW** selects audit-lite or audit-team and adds Walkthrough/Visitor Audit when the
   change touches product or public surfaces.
5. **MERGE** requires a green PR for the exact reviewed SHA. No admin bypass.

A real finding routes back to BUILD. A false positive is classified out with evidence;
correct work is not distorted to satisfy a wrong tool.

### Release flow

1. run GauntletGate and drive all five severities to `0/0/0/0/0`;
2. refute README, manual, architecture, landing-page, and release claims;
3. render and inspect every documentation deliverable;
4. run candidate Visitor Audit and clean-environment Walkthrough;
5. define rollback trigger and owner;
6. stop for the owner’s tag/publish go/no-go;
7. after publication, cache-bust and repeat live Visitor Audit;
8. hand its exact public artifact to the full published Walkthrough;
9. close only with strict-zero findings and valid coverage.

### UI and newcomer coverage

Walkthrough starts blind before source inspection. For release scope, it starts at the
public product page and uses the published installer. It covers successful, failed,
cancelled, repeated, update, downgrade (when supported), repair, uninstall, and reinstall
states. Every screen, control, menu item, keyboard path, workflow, and meaningful visual
state receives an inventory ID and result.

Unsafe external actions are recorded as blocked unless the owner authorizes disposable
test data or identities. They are never silently omitted or counted as passed.

## Evidence and handoffs

Stages exchange additive JSON artifacts defined in
[`artifact-contracts.md`](../skills/dev-rigor-stack/references/artifact-contracts.md):

- `run-manifest.json` — run, commit, artifact, platform, and environment identity;
- `claims.json` — observable promises and survived/refuted/unproven status;
- `findings.json` — severity, reproduction, evidence, fix, and regression-test path;
- `coverage-ledger.json` — inventoried/tested/failed/blocked/excluded denominators;
- `handoff.json` — immutable stage-to-stage artifact identity and open findings;
- `gate-result.json` — PASS/FAIL/INVALID/BLOCKED/PARTIAL with strict-zero counts.

Visitor Audit’s acquisition handoff contains the product/release/installer URLs, platform,
version, filename, size, checksum/signature, requirements, claims, and evidence.
Walkthrough refuses a stale or substituted artifact.

## Session and machine continuity

Continuity is a bookend around the gates, not another gate. Durable decisions, acceptance
criteria, and rejected approaches with their reasons live in a remote-tracked,
append-safe artifact rather than only in agent context.

- **Start:** pull the durable state and revalidate facts that may have gone stale.
- **During:** append locked decisions and dead ends as they happen.
- **End:** push the updated state and confirm the remote moved as the session’s final action.

Use one project store that already exists—a pinned decision issue, project memory vault,
or grep-able tracked file. Do not create competing stores that drift or overwrite each
other. Continuity persists for the project lifetime, not merely one release.

## Evaluator-owned exits

When the host provides a goal/evaluator loop, phrase BUILD or VERIFY work with a
deterministic exit and a try cap, such as “tests green; stop after five attempts.” A model
interpreting “make it good” is not an independent exit. Ambiguous quality judgments stay
in VERIFY/REVIEW, where evidence and adversarial judgment are explicit.

This applies worker-not-judge separation to the stop condition: the builder cannot talk a
deterministic checker into accepting unsupported work.

## Owner vs coordinator

The coordinator decides reversible, in-scope implementation steps and green-path merges.
The owner decides scope and intent, publishing/tagging/deployment, destructive external
actions, spending, risk acceptance, security/privacy/licensing value calls, and final
go/no-go. Explicit instructions and standing authorizations count as owner decisions
already made; absent either, the coordinator prepares evidence and holds at the boundary.

## Fan-out and cost

Independent fan-out is used only when the host and user authorize it and the work benefits
from parallel coverage. Mechanical workers may enumerate combinations or inspect separate
surfaces; the main coordinator retains synthesis and judgment. Without bounded fan-out,
the same review runs serially from a fresh adversarial posture. Cost controls never delete
a gate that the blast radius requires.

## Audit-lite / audit-team vs GauntletGate

The overlap is deliberate. `audit-lite` and `audit-team` are standalone per-unit review
reports. GauntletGate is an advancement gate at stage/release altitude; its lite and full
lanes rerun the relevant review discipline self-contained and add a verdict, first-run
attestation, and Walkthrough lane. One produces review findings; the other decides whether
the product may advance.

## Retained upstream hook sources

The repository keeps three upstream Claude implementations:

- **Reflex** injects a compact proof discipline at Claude session/subagent start.
- **Rigor router** classifies Claude prompts and injects the relevant investigation,
  grounding, decomposition, or release protocol.
- **Grounding check** records runnable edits/executions and blocks one unsupported stop.

They are test-covered source assets, not active Codex behavior. The Codex installer does
not write Claude or Codex hook settings. Any future Codex-native port must first verify the
real Codex event names, configuration shape, and payloads.

## Degrade and invalid states

The complete installer prevents ordinary partial installs by validating all 19 sources.
If a required sibling or evidence artifact is missing at runtime, the affected gate is
INVALID and the gap is reported. Degrade never means silently using a shorter contract or
self-reviewing. Where the complete equivalent can be executed inline, the coordinator
states that path explicitly and still preserves independent/fresh-context judgment.

## Update, backup, restore, and uninstall

### Update

Pull or download the new repository version and rerun the installer. It replaces only the
19 managed skill folders and creates a timestamped backup first.

### Backup

Backups live under `<target>/.backup/codex-dev-rigor-stack/<timestamp>/`. Each contains
the managed folders that existed before that installation.

### Restore

1. Close Codex Desktop.
2. Choose the timestamped backup.
3. Copy its saved skill folders back into `~/.codex/skills`, replacing only matching
   current stack folders.
4. Restart Codex and invoke a known entrypoint.

### Uninstall

Close Codex Desktop and remove only the 19 folders listed in `manifest.json` from the
target. Keep `.backup/codex-dev-rigor-stack/` if you may restore later. Restart Codex.
The Codex installer never wires retained Claude hooks, so normal uninstall has no hook
settings to reverse.

## Troubleshooting

### PowerShell says scripts are disabled

Run `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

### Codex does not recognize a skill

- Confirm `<target>/<skill-name>/SKILL.md` exists.
- Confirm the target is `CODEX_HOME/skills` or `~/.codex/skills`.
- Restart Codex Desktop so metadata reloads.
- Check that a custom-target smoke install was not mistaken for the active Codex home.

### The installer reports fewer than 19 skills

Treat the install as failed. Confirm `manifest.json`, both installers, and all skill
directories came from the same commit. Do not accept a partial install as a weaker fallback.

### A gate says INVALID rather than FAIL

INVALID means the evidence cannot support a verdict: a sibling is missing, coverage lacks
denominators, artifact identity changed, or a blind pass was contaminated. Restore the
missing evidence or rerun in a clean environment.

### Visitor Audit reports GitHub infrastructure URLs

Separate repository-owned links from host-generated resource hints and throttled search
URLs. Classify host false positives with evidence, but never use them to hide a real
repository-owned failure.

### Exported bundles differ by platform

Compare the Bash and Windows PowerShell outputs byte for byte. CI requires parity; an
encoding or line-ending mismatch is a release blocker.

## Portability

Both exporters generate one derived Markdown bundle containing every skill body and
referenced support file. The export is derived; canonical capabilities are never removed
to make it shorter.

## Versioning

- **Codex bundle 1.0.0** is the current package.
- **Codex bundle 0.2.0** was the immediately previous repository version.
- **Upstream discipline 1.5.1** is the methodology snapshot in `manifest.json`.

These lines advance independently. Every current public/documentation surface displays the
Codex bundle version and does not present the upstream discipline number as the package
release.

## Security and honest limits

The installed Codex package is Markdown skill content. Installers copy managed folders and
create local backups; they do not activate the retained Claude hook layer. The product
does not guarantee bug-free software. It provides an inspectable process for matching
claims to evidence and refusing unsupported “done” statements.

See the [security policy](../SECURITY.md), [architecture](ARCHITECTURE.md),
[contribution guide](../CONTRIBUTING.md), and [MIT license](../LICENSE).
