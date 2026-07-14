# codex-dev-rigor-stack — technical architecture

**Architecture version:** 1.7.0

**Applies to dev-rigor-stack:** 1.7.0

This document describes the system boundaries, delivery state machine, evidence flow, and
deployment model. The [user manual](MANUAL.md) explains operation; this document explains
how the parts compose and where trust changes hands.

## Architectural principles

1. **Evidence is typed by claim.** Source inspection cannot prove runtime, UI, installer,
   or public-distribution claims.
2. **Worker is not judge.** Build, adversarial verification, review, and release judgment
   are separated by role or fresh context.
3. **Blast radius sets depth.** Review rigor follows impact, not diff size.
4. **Artifacts keep identity.** Commit SHA, installer hash, environment, coverage, and
   handoff identity remain stable across gates.
5. **Capability does not silently degrade.** Missing required siblings or evidence make a
   gate INVALID; they do not authorize a compact approximation.
6. **External value stays owner-controlled.** Tagging, publishing, destructive external
   actions, spending, and risk acceptance remain human decisions unless explicitly authorized.

## System context

```mermaid
flowchart LR
    Owner["Owner / product decision-maker"]
    Hooks["Active Codex lifecycle hooks\nreflex · router · grounding gate"]
    Codex["Codex main coordinator"]
    Skills["19 installed skill entrypoints\n13 canonical + 6 compatibility"]
    Repo["Project repository\nsource · tests · docs · CI"]
    Runtime["Real runtime / rendered product"]
    Public["Public distribution\nrepo · docs site · release assets"]
    Evidence["Durable evidence\nclaims · findings · coverage · handoffs"]
    CI["Cross-platform CI\nhooks · contracts · install smoke · export parity"]
    Install["install.ps1 / install.sh\n19 skills + hook runtime + hooks.json"]
    Publish["Publication\nmain · Pages · release surfaces"]

    Owner -->|scope, go/no-go, trust decisions| Codex
    Hooks -->|always-on context + stop continuation| Codex
    Codex -->|route complete contracts| Skills
    Skills -->|read/change/verify| Repo
    Skills -->|exercise real artifact| Runtime
    Skills -->|visitor + acquisition journey| Public
    Repo -->|exact SHA and candidate| Evidence
    Repo --> CI
    CI -->|green exact SHA| Evidence
    Install --> Hooks
    Install --> Skills
    Repo --> Publish
    Publish --> Public
    Runtime -->|screens, controls, traces| Evidence
    Public -->|URLs, bytes, checksums| Evidence
    Evidence -->|decision packet| Codex
    Codex -->|release-ready evidence| Owner
```

The package is not a build system or test framework. It is an orchestration and evidence
discipline layered over the tools a repository already uses. The coordinator keeps
judgment; specialized skills provide complete standalone protocols.

## Active Codex enforcement architecture

The active Codex hook layer is a first-class runtime boundary:

```mermaid
flowchart TB
    Events["Codex lifecycle events"]
    Start["SessionStart / SubagentStart"]
    Prompt["UserPromptSubmit"]
    Tools["PreToolUse / PostToolUse"]
    Stops["Stop / SubagentStop"]
    Core["Compact core injector\nsubstantive proof + owner controls"]
    Router["Rigor router\ncomplete discipline + task mode"]
    Identity["Authoritative Codex identity\ntask + turn + parent association"]
    Snapshot["Invocation-bound repository fingerprints\nHEAD + ref + index + status + every path"]
    Transaction["Owner-verified task transaction\ncross-process lock + atomic state"]
    Association["Immutable association edges\nrecursive parent/child graph"]
    Ledger["Privacy-bounded evidence state\nE/G/I/R/T/B/F/K/U/W/C"]
    Gate["Substantive evidence gate\ncurrent edit set proved?"]
    Debt["Release-blocking debt\nproof + mechanical + association"]
    Status["DevRigorSTATUS\ncheckpoint · blocks · all debt · child aggregate · observed delivery"]
    Continue["One continuation prompt\nrun the narrowest qualifying check"]
    Coordinator["Coordinator + 19 standalone entrypoints"]

    Events --> Start --> Core --> Coordinator
    Events --> Prompt --> Router --> Coordinator
    Events --> Tools --> Identity --> Snapshot --> Transaction --> Ledger
    Events --> Stops --> Identity
    Identity --> Association --> Transaction
    Identity --> Gate
    Ledger --> Gate
    Gate -->|proved or WARN/OFF| Coordinator
    Gate -->|first unproved stop in ON| Continue --> Coordinator
    Gate -->|circuit release| Debt
    Debt -->|same or proved superseding edit set| Gate
    Debt --> Status --> Coordinator
```

`Stop` and `SubagentStop` are the authoritative completion boundary. `PreToolUse` snapshots
privacy-bounded repository identity: HEAD and tree, symbolic/detached reference, semantic
index, complete status, and every Git-reported path regardless of extension. `PostToolUse`
compares the same `tool_use_id` after execution. This catches opaque shell-authored changes,
clean-to-clean commits, index-only changes, and binary/document/UI assets without persisting
paths, command text, arguments, file contents, arbitrary suffixes, or secrets. If observation
is missing, corrupt, incomplete, over-budget, or otherwise uncertain, no substantive proof
is accepted; a synthetic change, visible warning, and mechanical debt fail open for
conversation while keeping release closure blocked.
Tool and Stop evidence is shared only when Codex supplies exact task and turn identity. The task
record separately carries `ON`, `WARN`, or `OFF`, dirty edit identities, typed proofs, and
unresolved debt. Exact owner commands affect only that task; authoritatively associated
subagents read the parent mode live, while an unbound subagent visibly fails open in
`WARN`. Compaction restores mode and routed discipline from task state.

The evidence recorder distinguishes every direct edit (`E`), every observed or generated
artifact change (`G`), inspection (`I`), run/render (`R`), test (`T`), build (`B`), and explicit/structured
failure (`F`). Result precedence is explicit policy/tool failure, structured test/build
result, process exit status, then bounded text inference only when structured evidence is
absent. Raw sensitive command arguments are not persisted. Correlation tokens bind task,
turn, edit set, evidence class, the exact execution fingerprint, target checkpoint, and
result; they detect stale/mismatched evidence but are
not represented as a security boundary against a process that can read task state.

An accepted proof is a three-way correlation, not a claim in one file: the exact-turn
ledger event, the task checkpoint/proof projection, and a protocol-write-once
`evidence-v4-<16 lowercase hex proof ID>.json` record must agree. The canonical record binds
task/turn hashes, hashed edit identities, evidence class, execution fingerprint, semantic
descriptor hash, result, and checkpoint. Its descriptor contains bounded tool family,
executable, operation, hashed target/type, executable-origin, result-source, receipt, and
response identities; secrets and raw sensitive command arguments are excluded. Missing,
malformed, or tampered canonical evidence is `invalid canonical evidence` and release-invalid.
The HMAC token provides correlation and stale/mismatch detection, not a security boundary.

Shell evidence classification is exact and conservative. Only supported executable and
subcommand shapes can emit `R`, `T`, or `B`; version/help/list/eval/dry-run forms, composed
shell commands, unknown executables, and keyword lookalikes remain non-proof. Interaction
evidence likewise requires both a known tool family and an exact action. All task mutations
share the same bounded owner-verified cross-process lock. Parent binding is immutable and
each association is an independent append-only edge, so concurrent subagent creation cannot
erase siblings. STATUS walks the union of edges, child parent bindings, and the locked legacy
projection; missing, corrupt, conflicting, cyclic, orphaned, or incomplete state becomes
association debt rather than disappearing.

In `ON`, an unproved observed artifact edit can cause one substantive block. A retry with no new
tool event is released to prevent response-discard loops, records `U: released-unproved`,
and leaves release-visible proof debt rather than a checkpoint. Missing/invalid receipt
formatting after real proof is a visible `systemMessage` warning, never a destructive block. Debt clears only
when evidence is bound to the same affected edit set or a proved superseding set containing
every indebted edit. Missing identity or unwritable state fails open with a once-per-state
visible warning. `DevRigorSTATUS` reports local and associated-subagent proof, mechanical,
and association debt IDs, local `pending tool observations`, `subagent pending observations`,
checkpoint generation, substantive block count, and observed
event counts. It deliberately says that
the ledger does not establish hook trust; configuration trust belongs to Codex's hook review.

Owner-directed recovery is a separate append-only state machine. Each router/activator or
association failure occurrence receives a unique identity. Under the exact task lock,
`DevRigorREPAIR` records a canonical transaction containing the task, checkpoint, exact
mechanical occurrences, and exact association marker digests before it writes any completion
record. A mechanically failed owner control is eligible only when the recorded operation
binds an exact ON/WARN/OFF postcondition, which the same transaction applies; generic and
legacy state failures without a verifiable outcome remain debt. STATUS accepts a completion
only when that transaction remains present and binds the same occurrence. Normal association
markers belong only to `marker.parentKey`; a historical
`parent-unavailable` marker is self-scoped to the child. These rules make retries idempotent
and reject stale replay, cross-task repair, and synthesized completion files. Transaction
tokens are correlation evidence, not a security boundary against arbitrary local-state edits.

The state reader is fail-safe as well as the writer: exact-root absence, malformed critical
task fields, malformed nonblank mechanical records, wrong-schema edges, missing immutable
edges or locked parent projections, unknown association codes, and corrupt owned namespace
shapes all become nonrepairable release debt. Parent coding reminders include recursively
associated child and grandchild proof/mechanical debt, not only local debt.

Codex requires users to review and trust non-managed hook definitions. Each command binds
its definition to the runtime script SHA-256, verifies a single read buffer, and compiles
that same buffer; it never hashes one read and executes a second. On Windows, the
graphical Desktop activator supplies that missing client surface: it lists the exact seven
owned definitions, requires human confirmation, writes only their current hashes through
Codex's app server, and re-lists them before it can report success. Installed but
untrusted hooks are not active enforcement.
The event and trust behavior follow the
[official Codex hooks contract](https://learn.chatgpt.com/docs/hooks).

## Delivery state machine

```mermaid
stateDiagram-v2
    [*] --> Plan
    Plan --> Build: acceptance + test list + blast radius
    Build --> Verify: valid RED → GREEN → widened run
    Verify --> Review: claim survives refutation
    Verify --> Build: claim refuted
    Review --> Build: confirmed finding
    Review --> MergeGate: strict scoped review clean
    MergeGate --> Main: exact SHA + CI green
    MergeGate --> Build: stale SHA or red evidence
    Main --> ReleaseCandidate: version scope complete
    ReleaseCandidate --> ReleaseFix: gauntlet/docs/visitor/walkthrough finding
    ReleaseFix --> ReleaseCandidate: affected lanes rerun
    ReleaseCandidate --> OwnerDecision: strict-zero + valid coverage + rollback ready
    OwnerDecision --> Main: no-go
    OwnerDecision --> Published: owner go
    Published --> LiveClosure: cache-busted visitor + exact-artifact walkthrough
    LiveClosure --> Published: finding routes to correction/rollback
    LiveClosure --> [*]: strict-zero live evidence
```

The per-unit loop and release gate operate at different altitudes. Every change uses the
unit loop. The aggregate version uses the release gate once the integration line is ready.

## Skill composition

| Layer | Canonical skill | Complete responsibility |
| --- | --- | --- |
| Coordinate | `dev-rigor-stack` | Route unit/release stages and preserve gate invariants |
| Continuity | `dev-rigor-stack-continuity` | Restore and persist cross-session decisions |
| PLAN | `dev-rigor-stack-plan` | Acceptance, tests, blast radius, routing |
| BUILD | `dev-rigor-stack-build` | Full TDD/QA contract and evidence receipt |
| VERIFY | `dev-rigor-stack-proof-gate` | Claim refutation and anti-theater proof |
| REVIEW | `dev-rigor-stack-audit-lite` | Fast scoped independent review |
| REVIEW | `dev-rigor-stack-audit-team` | Five-role high-blast review |
| PRODUCT | `dev-rigor-stack-walkthrough` | Blind acquisition, installer lifecycle, complete UI/UX/wiring coverage |
| PUBLIC | `dev-rigor-stack-visitor-audit` | Rendered public surfaces, controls, assets, claims, acquisition handoff |
| ADVANCE | `dev-rigor-stack-gauntletgate` | Lite/walkthrough/full advancement verdict |
| MERGE | `dev-rigor-stack-merge-gate` | Exact-SHA green-path decision |
| DOCS | `dev-rigor-stack-docs-gate` | README/manual/architecture/landing truth and completeness |
| RELEASE | `dev-rigor-stack-release` | Candidate-to-live strict-zero closure |

Compatibility skills preserve their full contracts: `coder-tdd-qa`, `proof-gate`,
`audit-lite`, `audit-team`, `gauntletgate`, and `visitor-audit`.

## Evidence and handoff architecture

```mermaid
flowchart TB
    RM["run-manifest.json\nrun · commit · artifacts · platforms"]
    CL["claims.json\nobservable promises"]
    FD["findings.json\nseverity · reproduction · evidence"]
    CV["coverage-ledger.json\ndenominators + item results"]
    HO["handoff.json\nimmutable identity + open findings"]
    GR["gate-result.json\nPASS / FAIL / INVALID / BLOCKED / PARTIAL"]

    RM --> CL
    RM --> FD
    RM --> CV
    CL --> HO
    FD --> HO
    CV --> HO
    HO --> GR

    Visitor["Visitor Audit\npublic URL → exact installer"] -->|acquisition handoff| HO
    HO -->|verify hash/version/commit| Walk["Walkthrough\nclean environment → full product journey"]
    Walk --> FD
    Walk --> CV
    GR --> Decision["Merge or owner release decision"]
```

Evidence is additive. A downstream stage may add proof but may not rewrite upstream
findings, coverage, or artifact identity. Coverage is valid only when every inventoried
item resolves to tested, blocked, unverifiable, or explicitly excluded with a reason.

### Visitor/Walkthrough trust boundary

Visitor Audit owns discovery through download. Walkthrough owns the downloaded artifact
through installation and product lifecycle. The boundary record contains product page,
release page, installer URL, platform, version, filename, bytes, checksum/signature,
requirements, install claims, and unresolved questions. Substituting a local build breaks
the public-newcomer claim and makes the run INVALID.

## Deployment architecture

```mermaid
flowchart LR
    Source["Public GitHub repository\nmain branch"]
    Docs["docs/\nstatic landing + manual + architecture"]
    Pages["GitHub Pages\npublic landing URL"]
    Archive["GitHub source archive\npublished installer scripts"]
    Installer["agent or script installation\ndev-rigor-stack 1.7.0"]
    Txn["shared transaction coordinator\ncanonical-home lock + durable phase journal"]
    Backup["target + CODEX_HOME/.backup/.../<exact owned backup-id>"]
    Home["CODEX_HOME/skills\n19 entrypoints"]
    Runtime["CODEX_HOME/dev-rigor-stack\nactive Node hook runtime + state"]
    HookConfig["CODEX_HOME/hooks.json\n7 merged lifecycle events"]
    Activator["Windows graphical activator\nreview 7 hooks + current hashes"]
    AppServer["Codex app server\nhooks/list + config/batchWrite + hooks/list"]
    Trust["Codex hash-bound trust\nrequired before execution"]
    Candidate["local ignored review build\nrebuilt from exact source commit"]
    OwnerGate{"independent TAG GO\n+ explicit owner go/no-go"}
    Download["authorized release download\nactivator EXE + SHA-256"]
    CI["GitHub Actions\nWindows + Linux gates"]
    Publish["GitHub Pages / repository surfaces"]

    Source --> CI --> Publish
    Source --> Docs --> Pages --> Publish
    Source --> Activator --> Candidate --> OwnerGate
    OwnerGate -->|GO only| Download --> Pages
    OwnerGate -->|NO-GO / no decision| Candidate
    Source --> Archive --> Installer
    Installer --> Txn
    Txn -->|staged transaction + marker/digest-verified backup| Backup
    Txn -->|copy complete manifest| Home
    Txn --> Runtime
    Txn -->|CAS last; preserve foreign entries| HookConfig
    HookConfig --> AppServer
    Activator -->|explicit human approval| AppServer --> Trust --> Runtime
```

The script installers delegate to one cross-platform coordinator, which stages all 19 managed
folders, the active hook runtime, and the merged `hooks.json`, then commits or rolls back that
set together. Its canonical-home lock serializes cooperative install/uninstall operations;
its durable `PREPARING → PREPARED → APPLYING → COMMITTED` journal recovers an abruptly dead
operation on the next invocation. The shared hook configuration is committed last using
baseline hash, save verification, and destination reappearance checks. A concurrent foreign
write aborts without overwrite. Migration is verified from broken
1.6.1, withdrawn 1.6.2, 1.6.3, clean, current-v4 repair, and foreign-hook/trust profiles.
Current-version repair carries forward every v4 task/control, exact task-genesis record,
proof, mechanical, per-turn, snapshot, route, association record, and active execution receipt
while excluding legacy poisoned ledgers and transient locks. Exact task-genesis ownership is
bound to `task-genesis-v4-<64 lowercase hex task key>.json`; malformed lookalikes fail closed
before mutation. A failed migration restores the untouched complete
profile—including backup history—byte-for-byte. The transactional uninstaller removes owned
trust, definitions, runtime, skills, and stack-owned backup namespaces on success; any failed
transaction restores its complete starting state byte-for-byte. Ownership lineage records
exact backup transaction IDs, markers, and digests; uninstall never deletes an unknown or
modified backup child. Foreign configuration and foreign backup namespaces are preserved,
and restoring an older version remains a separate
explicit operation. Node.js is a
runtime requirement for the hooks; no package dependencies are installed. Codex reloads
skill metadata after restart and executes non-managed hooks only after Codex records the
reviewed current hashes. The Windows activator never edits `config.toml` directly; it uses
the same `hooks/list` and `config/batchWrite` contract as Codex's own hook-review client.

## Runtime and failure boundaries

- **Missing skill or evidence:** gate result is INVALID, not a weaker pass.
- **Confirmed defect:** finding routes to the owning BUILD scope and affected gates rerun.
- **Host-generated checker noise:** classify out only with fetched evidence; do not change
  correct product behavior to satisfy a false positive.
- **Unsafe external action:** mark blocked unless explicitly authorized; never omit it.
- **Stale commit/artifact:** merge/release gate rejects the evidence packet.
- **Live publication defect:** keep rollback readiness active and route to correction or
  the defined rollback decision.

## Security boundaries

The installed artifact is Markdown skill content plus a small Node.js lifecycle runtime.
Installers write managed skill/runtime folders, owned `hooks.json` entries, append-safe
state, and collision-resistant timestamped transaction backups. The hook runtime uses Node built-ins only and introduces no
network service, credential store, or application endpoint. Corrupt or structurally
unexpected hook configuration is refused and left byte-identical.
The transaction journal flushes state before mutation and uses same-filesystem atomic renames.
It proves abrupt-process recovery on the tested filesystems; physical-power-loss durability
cannot exceed the filesystem/storage implementation's honored flush and rename guarantees.

## Version model

Version `1.7.0` continues the product lineage from `1.5.1`. The interim `1.0.0` Codex
package number remains historical changelog data, not a new lineage root. Subsequent
versions advance monotonically from 1.6.0. Version 1.6.1 repaired Desktop activation;
1.6.2's prompt-boundary repair was withdrawn; 1.6.3 introduced exact Codex turn identity
and a hard retry circuit breaker. Version 1.7.0 preserves that isolation and adds
task-scoped controls, typed proof, non-destructive receipt handling, complete repository and
artifact observation, exact command classification, persistent proof/mechanical/association
debt, concurrency-safe compaction/subagent behavior, and transactional migration/uninstall. Versions
1.6.0–1.6.3 are unsupported.

## Provenance note

The original Claude Code hook source is retained under `plugin/` for traceability and
regression comparison. It is not loaded by Codex and is not part of the active runtime
diagram above. The active implementation is independently adapted to the documented Codex
event, payload, trust, and continuation contracts under `codex/`.
