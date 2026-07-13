# Contributing

**Current release:** 1.6.3

Thanks for considering it. This repo practices what it ships — contributions walk the
same gates the stack enforces.

## Ground rules

- **Every change comes with its check.** Active Codex hook changes need a test in
  `codex/hooks/test-hooks.js`; retained upstream Claude source changes need a test in
  `plugin/hooks/test-hooks.js`. Watch the relevant assertion fail first.
  Doc changes must not overclaim — if you say the product does X, the code must do X.
- **Run the complete suite before pushing:** `node codex/hooks/test-hooks.js`,
  `node plugin/hooks/test-hooks.js` (provenance regression suite),
  `python3 tools/check_sync.py`, `python3 tools/check_bundle.py`, and
  `python3 -m unittest tools.test_stack_contracts tools.test_desktop_activator
  tools.test_visitor_audit`. On Windows, also build `desktop/build.ps1`; CI runs its
  compiled ownership and fresh-process production app-server tests, compares the rebuilt
  executable with the published binary after normalizing compiler identity bytes, injects
  transactional-installer failures, and verifies exporter parity on Ubuntu and Windows.
- **Green-path only.** PRs merge when CI is green. No `--admin`, no overrides.
- **Windows PowerShell 5.1 is a first-class target.** `.ps1` files stay pure ASCII
  (PS 5.1 reads BOM-less files as ANSI — non-ASCII in source breaks or corrupts);
  build non-ASCII output via `[char]0x2014`-style code points. All file reads specify
  UTF-8 explicitly.
- **The installers are hand-kept in sync** (`install.sh` / `install.ps1`): a behavior
  change lands in both, and both get re-verified.
- **Every versioned public surface moves together.** When the bundle version changes,
  update the manifest, installers, exporters, README, manual, architecture, landing page,
  security/contribution docs, changelog, and version contract tests in one change.
- **Skills must not contradict the stack's hard rules** (Workflow-tool fan-out, never
  merge red, never self-review, host-agnostic completion gates). CI's integrity tests
  and periodic sweeps enforce some of this; reviewers enforce the rest.

## Practical notes

- Zero package dependencies is deliberate — the active hooks use only Node built-ins. Don't
  add a package.json for the product (dev tooling included).
- Keep `SKILL.md` / `SKILL-LITE.md` sync blocks byte-identical (`lite:required`) or
  absent (`lite:excluded`); `tools/check_sync.py` gates this.
- Prose style: honest, specific, no theater. The receipt format is
  `proved: <check + result> · blast: <level> · skipped: <gate + why>`.

## Reporting bugs

Open a GitHub issue with the narrowest reproduction you have — the command you ran and
its verbatim output beat a description of both. For security issues, see
[SECURITY.md](SECURITY.md).
