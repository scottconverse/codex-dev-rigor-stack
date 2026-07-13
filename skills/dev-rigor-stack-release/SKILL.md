---
name: dev-rigor-stack-release
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
7. Drive every real finding to 0/0/0/0/0; re-run at the blast radius of each fix.
8. Require `DevRigorSTATUS` to report no unresolved proof debt for the release task and
   every authoritatively associated subagent. If mechanical status is unavailable, inspect
   the canonical evidence records and mark the release INVALID until every debt is resolved
   by proof bound to the same affected edit set or a verified superseding edit set.
9. Stop for the owner's go/no-go on tag/publish/deploy unless already explicitly granted.

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
