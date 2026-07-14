---
name: dev-rigor-stack-continuity
metadata:
  version: 1.7.0
description: Restore, reconcile, and persist durable dev-rigor-stack project state across sessions, agents, and machines. Use for "$dev-rigor-stack-continuity", "/dev-rigor-stack-continuity", project handoff, resume work, record locked decisions, or close a rigor-stack session safely.
---

# Dev Rigor Stack — continuity

Use one existing remote-tracked, append-safe project record; never create a competing
memory store when the project already has one. Preserve locked decisions, acceptance
criteria, killed approaches with reasons, current gate evidence, unresolved findings,
release state, and exact artifact/build identities.

At start, pull/read the record and revalidate facts that can become stale. Reconcile
concurrent entries without overwriting either history. During work, append decisions and
dead ends when they become durable. At end, append the handoff, push or otherwise persist
it, confirm the remote moved, and record that confirmation. An unconfirmed write is not a
successful handoff. Never store secrets, credentials, or sensitive evidence in a public
record.

Return: state source, revision read, stale facts revalidated, decisions honored, conflicts
resolved, entries appended, remote revision confirmed, and remaining work.
