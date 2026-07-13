# Security Policy

**Current supported version:** 1.6.0

## Security model

The installer copies 19 Markdown skill folders into `CODEX_HOME/skills`, installs the
active Node.js hook runtime under `CODEX_HOME/dev-rigor-stack`, and merges owned entries
into `CODEX_HOME/hooks.json`. It preserves foreign hook definitions and backs up changed
configuration. It does not open network services or install dependencies.

Codex requires review and trust before non-managed command hooks run. The hook runtime
uses Node built-ins only, reads lifecycle JSON from stdin, writes Codex hook JSON to
stdout, and stores append-only state beneath `CODEX_HOME/dev-rigor-stack/state`.

The installers write only to the selected skills target, Codex hook runtime/configuration,
and their backup trees. Use a custom `-Target`/`--target` for
clean-profile inspection before installing into an active Codex home.

## Supported versions

Version 1.6.0 is supported. Updating is a fresh repository download or pull followed by
rerunning the installer; backups are enabled by default.

## Reporting a vulnerability

Use GitHub private vulnerability reporting under the repository Security tab. If the
report is not sensitive, open a normal issue. Include the narrowest reproduction, affected
version, platform, exact command/action, and observed result. Do not include live secrets
or credentials.
