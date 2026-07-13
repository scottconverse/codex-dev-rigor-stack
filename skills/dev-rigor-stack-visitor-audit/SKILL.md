---
name: dev-rigor-stack-visitor-audit
description: >
  Run the complete visitor-grade public-surface gate independently: every rendered
  public page, link, safe control, visual state, release asset, checksum, claim, and
  installer-acquisition path. Use for "$dev-rigor-stack-visitor-audit",
  "/dev-rigor-stack-visitor-audit", public-surface audit, click every public link,
  or candidate/live release verification.
---

# Dev Rigor Stack — Visitor Audit

Read `../visitor-audit/SKILL.md` completely and run its bundled
`scripts/check_links.py` mechanical pass. Apply every requirement without abbreviation.
That sibling is the canonical implementation and backward-compatible `$visitor-audit`
entrypoint.

When the product ships an installer, emit the acquisition handoff required by
`$dev-rigor-stack-walkthrough`. When invoked inside a release, distinguish candidate from
live evidence and require a cache-busted live rerun before closure.
