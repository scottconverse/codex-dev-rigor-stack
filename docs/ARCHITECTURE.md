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
        P["1 · PLAN\nclassify blast radius"]
        B["2 · BUILD\n/coder-tdd-qa · test-first"]
        V["3 · VERIFY\n/proof-gate · refute the claim"]
        R["4 · REVIEW\nproportionate lane:\n/audit-lite → /audit-team → /gauntletgate walkthrough"]
        M["5 · MERGE\ngreen PR → main · standing auth"]
        P --> B --> V --> R --> M
        V -. "low-blast: collapse" .-> R
    end

    M --> REL

    subgraph REL["Release gate — once per version, before the tag"]
        direction TB
        G["/gauntletgate all → 0/0/0/0/0"]
        C["claim-refutation on README / manual / landing"]
        D["deliverable docs real & complete"]
        RB["rollback trigger + owner named"]
        G --> C --> D --> RB
    end

    REL --> TAG{"OWNER go/no-go\non the tag"}
    TAG -->|go| SHIP["tag / release"]
    TAG -->|no| LOOP

    R -->|finding| B
    G -->|finding| B
```

A red result at any gate returns to the phase that owns it — findings from REVIEW or the
release gauntlet route back into BUILD. Nothing routes *around* a gate.

## Skill composition — which skill serves which gate

```mermaid
flowchart LR
    DRS["dev-rigor-stack\n(orchestrator)"]
    DRS --> B2["BUILD → coder-tdd-qa"]
    DRS --> V2["VERIFY → proof-gate"]
    DRS --> R2["REVIEW → audit-lite / audit-team / gauntletgate walkthrough"]
    DRS --> G2["RELEASE → gauntletgate all + proof-gate claim-refutation"]
    DRS -. "ladder + code-scope" .-> PT["ponytail (external, optional)"]
```

The orchestrator holds the discipline; each gate delegates to the skill built for it. If
a lane's skill is absent, the coordinator runs the equivalent discipline inline, says so,
and still spawns a fresh sub-agent — it never reviews its own work.

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
