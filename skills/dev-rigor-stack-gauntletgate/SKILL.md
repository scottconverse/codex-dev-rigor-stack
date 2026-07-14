---
name: dev-rigor-stack-gauntletgate
metadata:
  version: 1.7.0
description: Run the complete GauntletGate advancement gate independently with lite, walkthrough, full, or all lanes and an honest verdict. Use for "$dev-rigor-stack-gauntletgate", "/dev-rigor-stack-gauntletgate", stage gate, sprint gate, readiness gate, or the overall stack's release gauntlet.
---

# Dev Rigor Stack — GauntletGate

Read `../gauntletgate/SKILL.md` and every reference and selected lane it requires
completely. Apply it without abbreviation. That sibling is the canonical implementation
and backward-compatible `$gauntletgate` entrypoint.

The Walkthrough lane must consume `$dev-rigor-stack-walkthrough`; public-facing release
scope must also consume `$dev-rigor-stack-visitor-audit`. The overall stack sets the gate
threshold to strict-zero: 0 Blocker / 0 Critical / 0 Major / 0 Minor / 0 Nit.
