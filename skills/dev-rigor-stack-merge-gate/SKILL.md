---
name: dev-rigor-stack-merge-gate
description: Run the dev-rigor-stack green-path merge decision independently. Use for "$dev-rigor-stack-merge-gate", "/dev-rigor-stack-merge-gate", pre-merge evidence validation, or deciding whether a reviewed unit may merge without bypasses.
---

# Dev Rigor Stack — MERGE gate

Verify the exact head commit, target branch, CI state, review state, unresolved comments,
required PLAN/BUILD/VERIFY/REVIEW results, and conditional Walkthrough/Visitor results.
Re-run checks invalidated by changes after their evidence was captured. Evidence for a
different SHA, build, installer, environment, or public artifact does not transfer.

Allow only the configured green-path merge method under existing authorization. Never use
admin override, bypass branch protection, merge red, silently dismiss a finding, or treat
a partial/unverifiable gate as passed. Report READY TO MERGE or DO NOT MERGE with exact
blocking evidence. Executing the merge remains subject to the user's explicit or standing
authorization and the active GitHub workflow.
