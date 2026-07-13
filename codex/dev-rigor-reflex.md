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

The active Stop/SubagentStop grounding gate checks for a successful real execution after the latest runnable edit and for this receipt. `stop_hook_active` is honored as Codex’s anti-loop guard.
