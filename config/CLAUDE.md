# Coding rigor — optional CLAUDE.md snippet

Fold this into your own `~/.claude/CLAUDE.md` (or a project `CLAUDE.md`) to make the
stack apply automatically to coding work. **Review before adopting — do not blindly
overwrite an existing CLAUDE.md.** This is a generic template: it contains no machine
paths, accounts, or permission settings.

---

## Coding rigor

For ANY coding unit of work (a fix, module, feature, refactor), apply the
**dev-rigor-stack** skill. Two altitudes: the per-unit loop — PLAN (classify blast
radius) → BUILD (/coder-tdd-qa, test-first) → VERIFY (/proof-gate) → REVIEW
(proportionate lane: /audit-lite → /audit-team → /gauntletgate walkthrough) → MERGE
(green-path only, no override) — and the release gate before a tag: /gauntletgate all
→ 0/0/0/0/0 + claim-refutation + real docs + rollback plan → owner go/no-go on the tag.
Above the loop, a session/machine continuity bookend: durable state (locked decisions,
done-criteria, killed approaches) in a remote-tracked, append-safe artifact —
pull+revalidate at Start, append During, push+confirm at End. Blast radius (not diff
size) is the sizing axis. The stack flexes to the unit; a skipped gate is stated with a
reason, never silent. Skip only for trivial one-line edits. (If you installed the dev-rigor
reflex hook, this discipline is already injected every session; this snippet is the
equivalent for hosts without the hook.)

## Subagents

Fan-out / multi-agent work goes through your harness's workflow/orchestration tool,
never a bare recursing agent. Use the cheapest model that fits — a small model for
mechanical passes, a mid model for analysis — and reserve the top model / main thread
for judgment and gating. Each fan-out worker states its tier and moderates its rigor by
it (see the fan-out preamble in the dev-rigor-stack skill).

## Evidence over claims

Reproduce before fixing, verify with real output, never claim beyond the evidence in
hand, own mistakes plainly.
