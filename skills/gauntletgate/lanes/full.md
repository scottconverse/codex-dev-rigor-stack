# Lane: Full

A five-role adversarial deep audit. Five domain experts review the product in
parallel; you (the orchestrator) synthesize their findings into the gate report.
This is the heavy lane — **a 5-subagent fan-out, billed, requiring the user's
multi-agent opt-in.** State the cost and confirm the go-ahead before running it.

Apply `references/shared-backbone.md` (first-run rule, attestation, severity) and,
when the Walkthrough lane ran, **consume its report** instead of re-walking the UI.

## The five roles

| # | Role | Focus |
|---|------|-------|
| 1 | Principal Engineer | architecture, correctness, security, performance, data provenance, dependencies |
| 2 | UI/UX Designer | visual hierarchy, interaction states, copy, accessibility, user-journey gaps (incl. first-run/empty states) |
| 3 | Technical Writer | README/architecture/manual/marketing accuracy, completeness, honesty |
| 4 | Test Engineer | test-coverage reality vs. claim, blind spots, shortcuts, regression risk |
| 5 | QA Engineer | runtime behavior across layers — web/SaaS/API/protocol/CLI — **including the first-run / dependency-absent state per the shared backbone** |

> Note vs. an ordinary QA pass: the QA role here does **not** load "realistic data
> and skip the empty state." It must also exercise the **first-run / empty /
> dependency-absent** state (shared backbone §1). If the Walkthrough lane already
> produced a verified first-run attestation, the QA role builds on it rather than
> redoing it; if Walkthrough did **not** run, QA owns the first-run pass and its
> verdict carries the attestation.

## Orchestration

1. **Confirm cost/opt-in.** This fans out 5 subagents. Say so; proceed only with the
   go-ahead.
2. **Stage the output dir** `gate-<project>-<YYYY-MM-DD>/` with placeholders.
3. **If Walkthrough ran**, pass its report path to every role so UX/QA extend rather
   than duplicate it, and Engineering/Test can reference its wiring findings.
4. **Dispatch the in-scope roles in parallel** — use bounded Codex multi-agent tools
   when available, all roles as leaf workers. Never use an unbounded recursing agent:
   it can spawn its own swarm. On a host with no bounded parallel dispatch, run the
   same role passes serially from fresh context. **Cap the fan-out at the 5
   roles** (concurrency limit ≠ total cap — never let it stampede; one agent per role).
   Each role: reads the shared backbone + its focus, audits within scope, writes its
   deep-dive (`01-engineering` … `05-qa`), and returns a <300-word summary (severity
   counts, top 5, any Blockers, what it couldn't assess).
   **Isolation:** if a role's job requires live-mutating the product's source (e.g.
   an adversarial revert → re-run tests → restore cycle to prove a fix is load-bearing,
   not just read the diff), that role must do so in its own isolated worktree/copy of
   the repo, never the shared clone the other 4 roles are concurrently reading from.
   Two roles editing the same shared checkout at once can race — one role's revert
   step corrupts another role's read or produces a false test failure, and a
   restore that "reports success" can silently under-restore under concurrent writes.
   Read-only roles (docs review, static analysis) may share the clone; only
   live-mutation roles need their own copy.
5. **Read every deep-dive** (don't trust summaries alone).
6. **Cross-reference** — a finding touching multiple roles (e.g. a security bug with
   no test and no doc) is a high-leverage triple finding; mark it.
7. **Synthesize** the executive view, the blocking punch list (Blockers/Criticals +
   cheap/urgent Majors), and the next-stage watchlist (structural Majors,
   architectural debt, scaling).

## Degraded mode (when multi-agent fan-out isn't available)

Do not silently abandon the lane and do not let the environment quietly change the
verdict. If the running context can't fan out subagents:

1. **Run the five roles SEQUENTIALLY in-context**, one labeled pass each, applying the
   exact same role focus, shared backbone, and severity bar.
2. **Label the report `Full: DEGRADED (sequential, not parallel)`** so the reader
   knows the roles weren't independent. The severity bar and verdict rules are
   unchanged — degraded mode is slower and less independent, never more lenient.
3. If you can't run the roles even sequentially (no budget, can't proceed), **mark
   Full as a coverage gap** in the report — a gap is not a pass, and a gap means the
   run can't be CLEAR TO ADVANCE on Full's behalf.

## Deep-dive schema (what a complete role report must contain)

Each deep-dive (`01-engineering` … `05-qa`) must contain, or it's an incomplete
coverage gap (not a clean pass):

- **Role + severity counts** (Blocker / Critical / Major / Minor / Nit).
- **Findings**, each with: id, severity, category, **evidence** (file:line or numbered
  repro + observed vs. expected), why-it-matters, **blast radius** (required for
  Blocker/Critical/Major), and a concrete fix path.
- **What's working** — specific and credited (not "the app launches"; that's
  content-free and doesn't satisfy the section).

An empty, generic, or obviously truncated deep-dive is treated by the orchestrator as
a coverage gap for that role — surface it, don't average it away.

## Posture
Adversarial by default — the gate's job is to block advancement, not wave it
through. But stay honest and balanced: every role credits what works (it's signal,
not filler), and severity follows the framework, not gut. If two roles disagree,
state the tension rather than papering over it. Never invent evidence to "complete"
a thin report — write what was observed and flag what couldn't be verified.

## This lane's output
The five deep-dives + an engineering/test/docs/QA/UX severity roll-up that feeds the
combined gate verdict. When run standalone (not inside `all`), it is a **PARTIAL
CHECK** unless Walkthrough also ran — `full` alone does not verify first-run unless
its QA role constructed and verified the first-run state, in which case it may
contribute a first-run verdict. The advancement decision is made by the dispatcher
per `references/gate-verdict.md`.
