---
name: dev-rigor-stack-plan
description: >
  Run the dev-rigor-stack PLAN stage independently: trace current behavior,
  challenge unnecessary work, define acceptance criteria and tests, classify blast
  radius, and route required gates. Use for "$dev-rigor-stack-plan",
  "/dev-rigor-stack-plan", rigorous implementation planning, or planning one unit
  before BUILD.
---

# Dev Rigor Stack — PLAN

Read the real implementation, tests, configuration, documentation, and current durable
state before proposing changes. Trace the behavior end to end. Apply reuse-before-build:
ask whether the change needs to exist, already exists, belongs in the platform/standard
library, or can be smaller without losing requirements.

Produce:

- scope and explicit non-scope;
- current behavior and evidence;
- acceptance criteria and definition of done;
- a test list with RED conditions and deterministic exit criteria;
- blast-radius classification based on impact, not line count;
- security, data, compatibility, migration, performance, documentation, UI, public-surface,
  installer, and newcomer-journey impacts;
- required downstream gates and reasons for every conditional skip;
- rollback/checkpoint strategy for risky work;
- owner decisions required, without inventing the owner's answer.

The output must be directly consumable by `$dev-rigor-stack-build`. Unknowns that could
materially change the implementation remain explicit; do not turn assumptions into facts.
