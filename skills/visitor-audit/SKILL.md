---
name: visitor-audit
metadata:
  version: 1.6.3
description: >
  Run a visitor-grade audit of public-facing pages, rendered docs, READMEs, release
  pages, announcements, and published assets. Read every surface fully as rendered,
  follow every link with per-link status and counts, verify published checksums and
  sizes, and flag stale claims, jargon, mojibake, placeholders, invisible links, and
  misleading framing. Use when asked for a visitor audit or public-surface audit, before
  announcing a page/site/release as done, and after every deploy. CI is not a substitute.
---

# Visitor Audit — PUBLIC SURFACE gate (v1.6.3)

Verify the artifact as a first-time visitor experiences it, never through source diffs
or CI proxies. This lane is distinct from product walkthrough: walkthrough asks whether
a new user can operate the product; visitor-audit asks whether the public front door is
truthful, coherent, reachable, and complete.

When the dev-rigor-stack bundle is present, read
`../dev-rigor-stack/references/artifact-contracts.md` and emit its run-manifest,
findings, coverage-ledger, handoff, and gate-result shapes. Preserve the complete human
report as well.

## Discover and attest scope

Establish canonical current facts first: released version, supported features,
requirements, asset names, sizes, and checksums. Discover and list every public surface:

- deployed websites, landing pages, and documentation sites;
- the repository README rendered by its host and relevant org/profile pages;
- release bodies, downloadable assets, and published checksums;
- rendered manuals, FAQs, changelogs, troubleshooting and compatibility pages;
- announcements, discussions, forum posts, and other published artifacts.

Audit all discovered surfaces unless the user explicitly narrows scope. Mark anything
behind an unavailable login or session **unverifiable**; never omit it silently.

Build a public-surface inventory before testing. Include every public page, route,
release, asset, announcement, and meaningful rendered state that discovery exposes
through navigation, sitemaps, repository links, release metadata, and the surfaces
themselves. Give each item a stable ID. Record discovered, tested, blocked, and excluded
counts; a surface absent from the inventory cannot be silently treated as covered.

## Per-surface protocol

Both jobs are mandatory.

### 1. Read the entire rendered surface

Use the live URL whenever one exists and read top to bottom. Flag, with the canonical
fact or observed rendering that proves it:

- stale, false, or mutually contradictory current-state claims;
- fixed-bug history presented as marketing copy instead of a positive capability;
- internal jargon, unexplained names, or developer-only framing;
- mojibake, placeholders, TODOs, broken formatting, and local filesystem paths;
- misleading hierarchy or emphasis a visitor cannot understand;
- controls and links that do not look interactive.

Inspect every inventoried public page visually at the supported desktop and mobile
viewports and, where relevant, supported themes and display scaling. Capture evidence
for the full page and important states. Check spacing, alignment, rhythm, hierarchy,
typography, clipping, overlap, overflow, truncation, responsive behavior, contrast,
focus visibility, keyboard navigation, accessible names, loading/error/empty states,
and controls whose appearance misrepresents whether they are interactive.

Historical documents may correctly describe the past. Only current-state claims are
judged against the current release.

### 2. Follow every link and count them

Run `scripts/check_links.py` for the mechanical pass, then inspect every landing with
human judgment.

- Record the final status after redirects for each absolute URL.
- Resolve relative links against the actual publish root, not the repository root.
- For host-rendered Markdown, verify the target file and anchor on the default branch.
- Treat a reachable but wrong, raw, generic, or unhelpful landing as a finding.
- Download published assets and independently derive every quoted hash and size.

### 3. Exercise every safe public control

Inventory and exercise every safe public control: navigation menus, buttons, tabs,
accordions, forms, filters, downloads, copy controls, responsive menus, and other
interactive elements. Record the interface promise, action, expected result, actual
result, landing or function reached, and evidence. A control is not working merely
because it responds; the destination or function must match what its label and context
promise.

Use disposable data and test identities where needed. Do not purchase, publish, send,
delete user-owned data, change real accounts, or trigger other external side effects
without explicit authority. Mark such controls **blocked — authorization required**;
never omit them or count them as passed.

### 4. Produce the acquisition handoff

When the product has a downloadable installer or package, follow the journey exactly as
a stranger would: public front door → download guidance → release page → platform choice
→ published artifact. Produce an **acquisition handoff** for
`$dev-rigor-stack-walkthrough` containing:

```text
product_page, release_page, installer_url, platform, version,
filename, size, checksum_or_signature, requirements, install_claims,
download_evidence, unresolved_questions
```

Visitor Audit stops at the downloaded artifact boundary. Walkthrough must consume that
exact artifact in a verified clean environment; it may not substitute a repository build
while claiming to have tested the public newcomer journey.

## Evidence and severity

For each surface return its URL, links checked, environment/time, and findings:

```text
{ location, issue, severity: blocker|critical|major|minor|nit,
  confirmed: true|false, evidence, suggested_fix }
```

- **blocker:** dead end or false release fact, including 404 downloads and wrong hashes;
- **critical:** a primary public journey or realistic failure-prone action is broken,
  misleading, unsafe, or missing an actionable error state;
- **major:** visibly broken or misleading, including mojibake and cross-surface conflict;
- **minor:** jargon, poor landing, or audience/tone failure;
- **nit:** polish.

`confirmed: true` means the auditor fetched or followed it directly. Preserve suspicions
as `false`; never promote them into facts.

Use one bounded auditor per surface when the user authorizes multi-agent work; otherwise
run sequentially. Each auditor uses its own temporary directory and is read-only.

Maintain a coverage ledger with denominators, not a prose assurance:

```text
Public surfaces: discovered N / inspected N / blocked N
Links: discovered N / followed N / broken N / unconfirmed N
Controls: inventoried N / exercised N / passed N / failed N / blocked N
Visual states: inventoried N / captured N / inspected N
Installers/assets: inventoried N / downloaded N / independently verified N
```

Coverage is complete only when every inventoried item is passed or explicitly blocked,
unverifiable, or excluded with a reason. Unknown scope or missing denominators makes the
coverage claim INVALID, never clean.

## Fix loop and exit

Report all findings, most severe first, with per-surface link counts. When fixes are in
scope, fix and deploy, then cache-bust and re-run against the live surface. The gate is
clean only when the published artifact is clean. CI, a committed source file, or a local
preview alone cannot close the post-deploy gate.

At a release boundary, a failed live pass blocks announcement, release-workflow closure,
and retirement of rollback readiness. It does not silently rewrite or delete an already
published tag; route the evidence to correction or the defined rollback decision.

For a release, run twice: candidate/staging before owner go/no-go, then cache-busted live
surfaces and actual published assets after deployment. The live acquisition handoff must
feed a full clean-room Walkthrough. Do not close or announce the release until both are
clean at the stack's configured severity threshold; the dev-rigor-stack default is
strict-zero across Blocker/Critical/Major/Minor/Nit.
