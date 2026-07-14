---
name: dev-rigor-stack-release
metadata:
  version: 1.7.0
description: Run the complete dev-rigor-stack release protocol independently from candidate evidence through owner go/no-go, publication, live Visitor Audit, clean-room published-installer Walkthrough, and strict-zero closure. Use for "$dev-rigor-stack-release", "/dev-rigor-stack-release", prepare or verify a release, publish a version, or close a deployment.
---

# Dev Rigor Stack — RELEASE gate

Bind every check to the exact candidate commit and artifacts. Before owner go/no-go:

1. Run `$dev-rigor-stack-gauntletgate all` under strict-zero policy.
2. Run `$dev-rigor-stack-proof-gate` against release claims.
3. Run `$dev-rigor-stack-docs-gate`.
4. Run candidate `$dev-rigor-stack-visitor-audit` on rendered staging/release surfaces.
5. Run candidate `$dev-rigor-stack-walkthrough` on the packaged installer in a verified
   clean machine across the supported platform matrix.
6. Verify version consistency, changelog, license, secrets scan, dependencies, rollback
   trigger/owner, and artifact hashes/signatures.
7. **Before GO, retain exact-candidate hook safety evidence:**
   - Prove exact classifier negatives and positives. `version/help/list/eval/dry-run`,
     composed, unknown, discovery, and keyword-lookalike commands remain non-proof;
     exact supported run/test/build shapes produce the expected qualifying evidence class.
   - Prove complete repository and artifact observation: HEAD/tree and symbolic/detached reference,
     semantic index, complete status, and every Git-reported artifact regardless
     of extension. Include clean-to-clean commits, index-only changes, `assume-unchanged`,
     `skip-worktree`, submodule commit movement, binary/document/UI assets, nested or
     response-reported edit paths, and an unavailable-comparison fail-safe.
   - Prove serialized task-state transactions and association concurrency across 32 concurrent children,
     including immutable parent binding, recursive mode inheritance, and parent
     STATUS aggregation of every proof, mechanical, and association debt.
   - Run the adversarial mutation suite against the exact candidate and require every
     targeted fault to turn its verifier red with zero survivors.
   - Run the authenticated disposable-profile disappearing-report lifecycle against the
     installed exact candidate. Declare the actual active profile separately; require canonical
     non-overlap, byte-bound installed owned sources, exact seven-hook `hooks/list` trust/hash
     identity, `workspace-write`, and rejection of every approval request. Preserve evidence
     that the exact final report streams and remains visible, the first Stop blocks, the second Stop releases with debt
     that remains unresolved and exact-edit-bound, the third Stop is silent, a real
     `DevRigorSTATUS` turn exposes that debt/checkpoint/block count and every debt class, and
     later conversation passes without K/U. Static source inspection, direct task-JSON reads
     alone, or an unauthenticated simulation is not a substitute.
8. Drive every real finding to 0/0/0/0/0; re-run at the blast radius of each fix.
9. Require `DevRigorSTATUS` to report no unresolved proof, mechanical, or association debt
   for the release task and every authoritatively associated subagent. Inspect the canonical
   records and mark the release INVALID if status is unavailable or any task/edge is missing,
   corrupt, conflicting, cyclic, orphaned, or incomplete. Resolve proof and correlated
   edit-bound mechanical debt only with evidence bound to the same affected edit set or a
   verified superseding edit set. For recoverable hook/association state, invoke exact-task
   `DevRigorREPAIR`, require append-only occurrence-specific resolution IDs bound to a
   persisted exact-task transaction in STATUS, and independently verify the successful
   correlated transaction applied its recorded owner-control postcondition, or verify all
   three association invariants (child parent
   binding, immutable edge, parent projection). Never accept later healthy state, an unknown
   or non-allowlisted marker, a generic failure without a verifiable outcome, a cross-task
   completion, or a corrupt/mismatched/stale resolution as implicit repair.
   Require matching task/checkpoint state, exact-turn ledger event, and strict
   `evidence-v4-<proof ID>.json` for every accepted proof; missing, malformed, mismatched,
   or tampered records are **invalid canonical evidence** and make the release INVALID.
   Treat local `pending tool observations` and recursively aggregated
   `subagent pending observations` as release-blocking. Tokens are correlation, not a
   security boundary, and evidence must exclude secrets and raw sensitive command arguments.
   Later evidence may clear debt only for the same affected edit set or a verified
   superseding edit set.
10. Stop for the owner's go/no-go on tag/publish/deploy unless already explicitly granted.

After authorized publication, the release remains OPEN:

1. Cache-bust and run live `$dev-rigor-stack-visitor-audit` against the public pages,
   release body, downloads, checksums, and claims.
2. Consume its acquisition handoff and run full published
   `$dev-rigor-stack-walkthrough`: find and download the finished installer as a stranger,
   install it on a verified clean machine, exercise the full newcomer/UI/lifecycle scope,
   and verify update/repair/uninstall.
3. Run focused Proof/Docs/Gauntlet lanes for any changed post-release surface or artifact.
4. Announce and close only when live evidence is VALID and all five severity counts are
   zero. Otherwise correct or invoke the defined rollback decision while keeping rollback
   readiness active.

Never rewrite or delete a published tag silently. Never use candidate, source, CI, or
developer-machine evidence as a substitute for the final public artifact.
