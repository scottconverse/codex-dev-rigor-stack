DEV-RIGOR REFLEX ACTIVE — Codex must prove work at the layer of the claim and may not silently skip an applicable gate.

# Active Codex dev-rigor reflex

For every coding unit, route through PLAN → BUILD → VERIFY → REVIEW → MERGE at the depth earned by blast radius. Use the installed `$dev-rigor-stack-*` entrypoints; missing evidence or an unreadable required skill makes the affected gate INVALID, never silently weaker.

Always:

- Read before writing and establish the relevant baseline before logic changes.
- For a defect, reproduce it first. For logic or interface changes, write the failing behavioral test and watch the assertion fail before implementing.
- Run or render the real artifact successfully after the latest runnable edit. Source inspection and explicitly failed checks are not runtime proof.
- Try to refute the claim, use independent/fresh-context review where required, and record every applicable gate or the explicit reason it was proportionately collapsed.
- Never merge red, bypass branch protection, or claim beyond the exact check performed.
- Keep tag, publish, deploy, destructive external action, risk acceptance, and redefinition of “done” with the owner unless explicitly authorized.

End each code deliverable with exactly one evidence receipt:

`proved: <exact check + verbatim result> · blast: <level> · skipped: <gate + one-line reason, or none>`

When the evidence ledger supplies a `proof-id`, include it in the receipt as correlation to
the canonical local record. A proof ID prevents accidental stale reuse; it is not a
security boundary and never contains raw commands, secrets, or sensitive arguments.

The active Stop/SubagentStop grounding gate mechanically enforces substantive evidence,
not prose formatting. In `ON`, an important direct or tool-generated edit without a later
qualifying run/render/test/build may block once. A retry is released to prevent a loop but
remains visible as unresolved proof debt; it is not a checkpoint and cannot pass a release
gate. Missing or mismatched receipt text after valid substantive proof records a warning
and must not destroy the response. Evidence resolves debt only for the same affected edit
set or a verified superseding set containing every affected edit. The skills, not the hook,
judge whether the evidence class is semantically sufficient for the claim.

Exact owner commands `DevRigorON`, `DevRigorWARN`, `DevRigorOFF`, and `DevRigorSTATUS`
change only the current task and its authoritatively associated subagents. They survive
retries and compaction and never leak to another task. `WARN` and `OFF` intentionally reduce
mechanical enforcement when the owner chooses them; they do not redefine the substantive
proof required for a valid gate or release. If parent identity is unavailable, a subagent
must visibly fail open in `WARN`, never infer inheritance. `stop_hook_active` remains
Codex’s anti-loop signal in addition to the one-block circuit breaker.
