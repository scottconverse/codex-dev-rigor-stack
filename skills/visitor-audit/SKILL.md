---
name: visitor-audit
metadata:
  version: 0.2.0
description: >
  Run a visitor-grade audit of public-facing pages, rendered docs, READMEs, release
  pages, announcements, and published assets. Read every surface fully as rendered,
  follow every link with per-link status and counts, verify published checksums and
  sizes, and flag stale claims, jargon, mojibake, placeholders, invisible links, and
  misleading framing. Use when asked for a visitor audit or public-surface audit, before
  announcing a page/site/release as done, and after every deploy. CI is not a substitute.
---

# Visitor Audit — PUBLIC SURFACE gate

Verify the artifact as a first-time visitor experiences it, never through source diffs
or CI proxies. This lane is distinct from product walkthrough: walkthrough asks whether
a new user can operate the product; visitor-audit asks whether the public front door is
truthful, coherent, reachable, and complete.

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

## Evidence and severity

For each surface return its URL, links checked, environment/time, and findings:

```text
{ location, issue, severity: blocker|major|minor|nit,
  confirmed: true|false, evidence, suggested_fix }
```

- **blocker:** dead end or false release fact, including 404 downloads and wrong hashes;
- **major:** visibly broken or misleading, including mojibake and cross-surface conflict;
- **minor:** jargon, poor landing, or audience/tone failure;
- **nit:** polish.

`confirmed: true` means the auditor fetched or followed it directly. Preserve suspicions
as `false`; never promote them into facts.

Use one bounded auditor per surface when the user authorizes multi-agent work; otherwise
run sequentially. Each auditor uses its own temporary directory and is read-only.

## Fix loop and exit

Report all findings, most severe first, with per-surface link counts. When fixes are in
scope, fix and deploy, then cache-bust and re-run against the live surface. The gate is
clean only when the published artifact is clean. CI, a committed source file, or a local
preview alone cannot close the post-deploy gate.

At a release boundary, a failed live pass blocks announcement, release-workflow closure,
and retirement of rollback readiness. It does not silently rewrite or delete an already
published tag; route the evidence to correction or the defined rollback decision.
