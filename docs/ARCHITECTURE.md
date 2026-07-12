# Architecture

The stack has **two altitudes** and a **continuity bookend**. The per-unit loop runs on
every change; the release gate runs once per version; continuity wraps the whole effort
so nothing durable is lost across sessions or machines.

## Control flow

```mermaid
flowchart TB
    subgraph CONT["Session & machine continuity (bookend — not a gate)"]
        direction LR
        START["Start: pull + re-validate stale-able decisions"]
        ENDS["End: write + push + confirm remote moved"]
    end

    CONT --> LOOP

    subgraph LOOP["Per-unit loop — every unit of work"]
        direction TB
        P["1 · PLAN<br/>classify blast radius"]
        B["2 · BUILD<br/>/coder-tdd-qa · test-first"]
        V["3 · VERIFY<br/>/proof-gate · refute the claim"]
        R["4 · REVIEW<br/>proportionate lane:<br/>/audit-lite → /audit-team → /gauntletgate walkthrough<br/>+ /visitor-audit for live public surfaces"]
        M["5 · MERGE<br/>green PR → main · standing auth"]
        P --> B --> V --> R --> M
        V -. "low-blast: collapse" .-> R
    end

    M --> REL

    subgraph REL["Release gate — once per version, before the tag"]
        direction TB
        G["/gauntletgate all → 0/0/0/0/0"]
        C["claim-refutation on README / manual / landing"]
        D["deliverable docs real & complete"]
        VA["/visitor-audit on rendered candidate surfaces"]
        RB["rollback trigger + owner named"]
        G --> C --> D --> VA --> RB
    end

    REL --> TAG{"OWNER go/no-go<br/>on the tag"}
    TAG -->|go| SHIP["tag / release / deploy"]
    TAG -->|no| LOOP
    SHIP --> LIVE["/visitor-audit on live URLs + assets"]
    LIVE --> CLOSE["announce + close release workflow"]

    R -->|finding| B
    G -->|finding| B
```

A red result at any gate returns to the phase that owns it — findings from REVIEW or the
release gauntlet route back into BUILD. Nothing routes *around* a gate.

## Skill composition — which skill serves which gate

```mermaid
flowchart LR
    DRS["dev-rigor-stack<br/>(orchestrator)"]
    DRS --> B2["BUILD → coder-tdd-qa"]
    DRS --> V2["VERIFY → proof-gate"]
    DRS --> R2["REVIEW → audit-lite / audit-team / gauntletgate walkthrough"]
    DRS --> P2["PUBLIC SURFACE → visitor-audit"]
    DRS --> G2["RELEASE → gauntletgate all + proof-gate + visitor-audit"]
```

The orchestrator holds the discipline; each gate delegates to the skill built for it. The
installer bundles all of these, so a normal install has every lane; if a skill is somehow
absent (a partial or `--target` install), the coordinator runs the equivalent discipline
inline, says so, and still spawns a fresh sub-agent — it never reviews its own work.

`audit-lite`/`audit-team` and `gauntletgate` overlap by design: the same review discipline
in two packagings. The standalone audits are the per-unit *review reports*; gauntletgate is
the release-altitude *advancement gate* whose `lite`/`full` lanes re-run that discipline
self-contained and add a pass/fail verdict. A report vs. a gate.

`visitor-audit` does not duplicate walkthrough. Walkthrough exercises the product and
first-run wiring; visitor-audit reads the public front door as rendered, follows and
counts every link, and verifies published release assets and claims. Candidate/staging
evidence informs go/no-go; only the cache-busted live post-deploy pass permits the release
to be announced as complete and the workflow to close.

## The always-on layer — three hooks

The skills are pull-based — invoked when the coordinator judges a task needs them. Shipped
alongside are **three hooks** that push the discipline in, each at a different moment:

```mermaid
flowchart LR
    SS["SessionStart /<br/>SubagentStart"] --> RX["reflex<br/>one-page distillation:<br/>proof ladder · never-shrink · receipt"]
    UP["UserPromptSubmit"] --> RT{"rigor router<br/>classify the prompt"}
    RT -->|bug words| I["investigation protocol"]
    RT -->|UI / artifact words| GD["render/run grounding"]
    RT -->|multi-part work| DC["decomposition +<br/>per-story evidence"]
    RT -->|release words| RL["release discipline"]
    RT -->|no match| SIL["silence"]
    PT["PostToolUse"] --> LG["ledger: runnable edits ·<br/>execution calls"]
    ST["Stop"] --> CK{"edited runnable code,<br/>never ran anything?"}
    CK -->|yes| BLK["block once:<br/>run the narrowest real check"]
    CK -->|no| OK["allow stop"]
```

- The **reflex** (`SessionStart`/`SubagentStart`) primes every session with the one-page
  distillation and delegates the heavy mechanics back to the skills. Text:
  `plugin/dev-rigor-reflex.md`.
- The **rigor router** (`UserPromptSubmit`) classifies each prompt and injects only the
  matching protocol from `plugin/disciplines/`, at most once per discipline per session —
  the right discipline at the right moment, without always-on-everything context cost.
  Release outranks other matches; a broken UI is a bug first (investigation outranks
  grounding).
- The **grounding check** (`PostToolUse` + `Stop`) is the enforced floor: a per-session
  ledger of runnable-file edits vs. execution calls, and a one-time stop-block when a
  session edited runnable code but never executed anything. It respects
  `stop_hook_active`, blocks at most once per session, and fails open on any error —
  a broken hook must never break a session.

All three are convenience layers, not new gates; the full discipline lives in the skills.
Concept credit: per-task routing and verification grounding were proven transferable by
[fablize](https://github.com/fivetaku/fablize)'s Fable-vs-Opus comparison (MIT) —
clean-room implementations here, no fablize code used.

## The two roles

- **Coordinator** (the top model / main thread) — plans, classifies blast radius, holds
  the honesty line, gates every merge, and dispatches workers. Decides everything
  reversible, in-spec, and in-sandbox. It **never originates an owner decision**.
- **Owner** (the human) — the one call the coordinator can't make: declaring a release
  real (the tag), and anything irreversible, trust-boundary-crossing, or externally
  valuable. Merging a green-path slice is pre-authorized; tagging is not.

## Fan-out and cost

Heavy or parallel work (test generation across combinations, sweeping for latent
siblings, adversarial verification) fans out to cheaper models through the host's
workflow/orchestration tool — never a bare recursing agent. Each worker states its tier
and moderates its own rigor by it (the fan-out preamble ships in the
[dev-rigor-stack skill](../skills/dev-rigor-stack/SKILL.md)). The coordinator stays lean
and does no grunt work.

## Why "proven," not "green"

The spine of the stack is one rule, inherited from `proof-gate`: **a claim is proven only
by exercising the real artifact through the path a real consumer hits.** A green check is
not proof; a check you've confirmed can go *red* is. Every gate is an application of that
rule at a different scope — a unit, a release, or the verification itself.
