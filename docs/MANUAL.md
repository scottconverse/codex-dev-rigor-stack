# codex-dev-rigor-stack — user manual

**Manual version:** 1.7.0

**Applies to dev-rigor-stack:** 1.7.0

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
- [Active Codex hooks](#active-codex-hooks)
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

Version 1.7.0 installs **all 19 entrypoints**: 13 canonical namespaced skills and 6
backward-compatible entrypoints. Each canonical section can be invoked independently or
through `$dev-rigor-stack`.

It also installs **active Codex hooks** for the reflex, prompt router, grounding ledger,
and Stop/SubagentStop evidence gate. The original Claude source remains only as provenance.

## Install

### Requirements

- Codex Desktop or another client that loads `CODEX_HOME/skills`
- Node.js for the active Codex hooks; the runtime uses built-ins only
- Windows 10/11 for the graphical hook activator
- PowerShell/Bash and Git only for maintainers or scripted installation

### Codex Desktop installation — no terminal

1. Open a normal Codex Desktop task and ask:
   Do not request installation while 1.7.0 is on independent-review hold.
2. Codex stages all 19 skill folders, the hook runtime, and the merged six owned
   definitions, then commits them as one rollback-protected transaction while preserving
   unrelated hooks and creating backups.
3. Wait for a tagged release, an explicit owner go/no-go, and restored publication links.
   Candidate executables are deliberately unavailable from GitHub Pages during review.
4. Once publication is authorized, verify the tagged release's checksum before opening it.
   Stop if Codex reports a mismatch.
5. Read all six rows. Selecting a row exposes its exact command, source, matcher, and
   current hash.
6. Choose **Review and trust these 6 hooks**. The confirmation lists the exact six hashes;
   choose **Trust these 6 hooks** only after reviewing them.
7. The app writes trust through Codex, re-reads all six definitions, and must display
   **Verified — all 6 hooks trusted**. Restart Codex Desktop.

This is the ordinary Windows Desktop path. It does not require opening a terminal, typing
a command, editing configuration, or knowing where Codex stores its files.

### Scripted installation for maintainers and compatible clients

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

The default targets are `~/.codex/skills` for the 19 entrypoints and
`~/.codex/dev-rigor-stack` for the hook runtime. The installer merges owned entries into
`~/.codex/hooks.json`, preserving foreign hooks and backing up changed configuration.
The staged skills, runtime, and hook configuration commit together or restore the prior set.
On Windows, open `DevRigorHookActivator-1.7.0.exe`, review and approve the exact six
hashes, and require its verified result before restarting Codex Desktop. Other Codex
clients may use their own supported hook-review UI.

### Custom target

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -Target C:\temp\codex-home\skills -CodexHome C:\temp\codex-home
```

```sh
./install.sh --target /tmp/codex-home/skills --codex-home /tmp/codex-home
```

Use a custom target for clean-profile verification, CI, or another compatible host.
`-NoBackup` and `--no-backup` suppress backups only when explicitly used.

### Verify the installation

The installer must report `Installed 19 skill(s).` Verify every manifest entry has a
`SKILL.md`, `CODEX_HOME/dev-rigor-stack/hooks/dev-rigor-ground.js` exists, and the
graphical activator shows all six trusted lifecycle events. Restart Codex and invoke a
known entrypoint.

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

## Active Codex hooks

- **SessionStart/SubagentStart activator:** injects the compact universal safeguards.
  Coding and release prompts still load the complete applicable contracts. Compaction
  restores the task mode and routed discipline rather than resetting them.
- **UserPromptSubmit router and task controls:** routes investigation, grounding,
  decomposition, and release work. The exact owner commands `DevRigorON`,
  `DevRigorWARN`, `DevRigorOFF`, and `DevRigorSTATUS` affect only the current task.
  Quoted or embedded command text is inert.
- **PostToolUse evidence recorder:** records important direct edits (`E`), tool-generated
  source changes (`G`), inspections (`I`), runs/renders (`R`), tests (`T`), builds (`B`),
  and failures (`F`). It stores hashes and bounded metadata, not raw sensitive commands.
- **Stop/SubagentStop substantive gate:** evaluates the authoritative current turn. In
  `ON`, an important edit without a later qualifying run/render/test/build may block once.
  The retry is released to keep conversation usable, but records `U: released-unproved`
  and persistent proof debt instead of a successful checkpoint. `WARN` records the same
  gap without blocking; `OFF` disables mechanical blocking for that task. Missing or
  invalid receipt formatting after real proof is only a visible warning and never removes
  a report. Evidence clears debt only when bound to the same edit set or a verified
  superseding set that contains every affected edit.

Task modes survive retries and compaction. A subagent inherits a live parent mode only
when Codex supplies authoritative parent identity; otherwise it visibly fails open in
`WARN` and never guesses. A parent `OFF` or later mode change propagates to associated
running and future subagents. Controls never leak into another task.

Evidence IDs correlate the task, turn, edit set, evidence class, result, and checkpoint
with the canonical local ledger. They prevent accidental stale reuse; they are not a
security boundary against a model that can read its own task state. Tokens and ledgers
exclude secrets and raw sensitive command arguments.

Codex requires explicit trust for non-managed hooks. On Windows, use the graphical
activator to inspect and approve the exact six current hashes. It discovers them with
`hooks/list`, refuses any incomplete or unexpected owned set, writes trust with
`config/batchWrite`, then calls `hooks/list` again. If any event is untrusted, modified,
disabled, absent, duplicated, or failing, the skills remain usable but mechanical
enforcement is not active and must not be claimed.
Each owned command also embeds its runtime script SHA-256, verifies a single read buffer,
and compiles that same buffer. Changed script bytes are refused. Reinstalling legitimate
updates changes the command definitions and requires review again.

## Degrade and invalid states

The complete installer prevents partial installs by staging all 19 sources, the runtime,
and the merged hook configuration before replacement. A commit or backup-finalization
failure restores the prior set. If automatic recovery itself fails, the recovery tree is
preserved and reported instead of deleted.
If a required sibling or evidence artifact is missing at runtime, the affected gate is
INVALID and the gap is reported. Degrade never means silently using a shorter contract or
self-reviewing. Where the complete equivalent can be executed inline, the coordinator
states that path explicitly and still preserves independent/fresh-context judgment.

## Update, backup, restore, and uninstall

### Update

Pull or download the new repository version and rerun the installer. It stages the 19
managed skill folders, active Codex hook runtime, and current owned hook definitions,
then transactionally commits them and retains timestamped backups. Reopen the graphical
activator after every update. If any script or definition changed, review and trust the new
six hashes, require **Verified — all 6 hooks trusted**, and restart Codex Desktop.

### Backup

One installation timestamp can have two coordinated backup locations:

- `<target>/.backup/codex-dev-rigor-stack/<timestamp>/` contains the prior managed skill
  folders.
- `<CODEX_HOME>/.backup/codex-dev-rigor-stack/<timestamp>/runtime` contains the prior
  managed hook runtime, and the adjacent `hooks.json` is the prior merged hook configuration.

Keep both locations together. Restoring only one creates a mixed-version installation.

### Restore

For a no-terminal restore, open a Codex Desktop task before closing the app and ask:
`Restore dev-rigor-stack from backup timestamp <timestamp>. Restore the 19 managed skills and managed runtime from that timestamp. Rebuild only the owned definitions into the current hooks.json with the restored wire-hooks.js; never replace hooks.json wholesale. Preserve every unrelated skill, hook, and trust entry.`
Require Codex to report the restored skills/runtime, the matching timestamp, and an
owned-only hook merge that retained current foreign hooks.
Then reopen the graphical activator, review the restored definitions, require all six
trusted, and restart Codex Desktop.

For a manual maintainer restore:

1. Close Codex Desktop and choose one timestamp present in both backup locations.
2. Copy the saved skill folders from the target backup into `<target>`, replacing only
   matching managed stack folders.
3. Replace `<CODEX_HOME>/dev-rigor-stack` with the saved `runtime` directory.
4. Do **not** replace the current `hooks.json` wholesale; that could erase unrelated hooks
   added after the backup. Run the restored runtime's `hooks/wire-hooks.js` against the
   current `hooks.json`. It reconstructs and replaces only the six owned definitions while
   preserving foreign hooks. Treat the saved `hooks.json` as recovery evidence, not a
   whole-file restore payload.

   ```text
   node <CODEX_HOME>/dev-rigor-stack/hooks/wire-hooks.js <CODEX_HOME> <CODEX_HOME>/dev-rigor-stack
   ```

5. Open the graphical activator, review the restored definitions, require all six trusted,
   then restart Codex Desktop and invoke a known entrypoint.

### Uninstall

For a no-terminal uninstall, open a Codex Desktop task and ask:
`Uninstall dev-rigor-stack. First run the managed revoke-trust.js through Codex app-server and verify exactly 6/6 owned trusted hashes were removed while foreign trust state was preserved. Then remove only the 19 managed skills, six owned hook definitions, and managed runtime; preserve every unrelated skill, hook, trust entry, and backup.`
Codex must revoke trust before removing the definitions/runtime, preserve foreign hooks,
and report every path changed. The repository uninstaller treats trust, owned hook
definitions, runtime, and all 19 skills as one transaction: an interrupted uninstall
restores the starting state byte-for-byte; a successful uninstall removes all owned
components and keeps foreign configuration. Restoring an older version is a separate,
explicit restore operation.
Restart Codex Desktop afterward.

Maintainers may run the transactional uninstaller after closing Codex Desktop:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

```sh
./uninstall.sh
```

Keep backups if you may restore later. Restart Codex afterward.

## Troubleshooting

### PowerShell says scripts are disabled

Ordinary Codex Desktop users should use the no-terminal path above. Maintainers choosing
the script path can run `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

### Codex does not recognize a skill

- Confirm `<target>/<skill-name>/SKILL.md` exists.
- Confirm the target is `CODEX_HOME/skills` or `~/.codex/skills`.
- Restart Codex Desktop so metadata reloads.
- Check that a custom-target smoke install was not mistaken for the active Codex home.

### The hooks are installed but do not run

- Open `DevRigorHookActivator-1.7.0.exe` and confirm each dev-rigor definition is trusted.
- Confirm `[features].hooks` is not `false` in active Codex configuration or policy.
- Confirm Node.js is on the PATH visible to Codex.
- Confirm `CODEX_HOME/dev-rigor-stack/hooks/` and `CODEX_HOME/hooks.json` point to the same
  Codex home.
- Restart Codex after installation or any hook-definition change. Definition trust and the
  embedded runtime SHA-256 guards must both pass; updated scripts produce changed
  definitions that require review again.

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

- **Version 1.7.0** is an unreleased candidate on independent-review hold and continues the product lineage from 1.5.1.
- The earlier 1.0.0 Codex package number is retained only as historical record of an
  interim reset; future versions advance monotonically from 1.6.0. Version 1.6.1 repaired
  Desktop graphical activation. Version 1.6.2's prompt-boundary repair was incomplete;
  1.6.3 introduced exact Codex turn identity and a hard retry circuit breaker. Version
  1.7.0 preserves exact-turn isolation and adds task modes, typed evidence, non-destructive
  receipt handling, persistent proof debt, safe compaction/subagent behavior, and
  transactional upgrade/uninstall. Versions 1.6.0–1.6.2 are unsupported.

## Security and honest limits

The installed package contains Markdown skills plus a small Node.js hook runtime. The
installer preserves foreign hook entries and Codex requires the user to review/trust the
owned command hooks. The product does not guarantee bug-free software. It provides an inspectable process for matching
claims to evidence and refusing unsupported “done” statements.

See the [security policy](../SECURITY.md), [architecture](ARCHITECTURE.md),
[contribution guide](../CONTRIBUTING.md), and [MIT license](../LICENSE).
