---
name: dev-rigor-stack-audit-lite
metadata:
  version: 1.7.0
description: Run the complete dev-rigor-stack Audit Lite review independently for a small change or scoped diff. Use for "$dev-rigor-stack-audit-lite", "/dev-rigor-stack-audit-lite", quick audit, smoke review, small-fix readiness, or the light REVIEW lane.
---

# Dev Rigor Stack — Audit Lite

Read `../audit-lite/SKILL.md` completely and apply it without abbreviation. That sibling
is the canonical implementation and backward-compatible `$audit-lite` entrypoint.

Consume PLAN, BUILD, and Proof Gate evidence when present. Escalate user-facing runtime
work to `$dev-rigor-stack-walkthrough`, public surfaces to
`$dev-rigor-stack-visitor-audit`, and high-blast changes to
`$dev-rigor-stack-audit-team`. A light lane may narrow scope; it may not weaken the checks
that apply inside that scope.
