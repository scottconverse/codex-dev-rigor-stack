# Security Policy

**Current supported Codex bundle:** 1.0.0

## Security model

The Codex installer copies 19 Markdown skill folders into `CODEX_HOME/skills` (or an
explicit target) and creates timestamped backups of replaced managed folders. It does not
configure Codex settings, open network services, install runtime dependencies, or activate
the retained upstream Claude hook sources.

The repository contains three small Node hook implementations inherited from the upstream
Claude package. They are retained for provenance and future verified porting, and are
covered by the repository test suite. They are **not wired or executed by the Codex
installer**.

The installers write only to the selected skills target and its
`.backup/codex-dev-rigor-stack/<timestamp>/` tree. Use a custom `-Target`/`--target` for
clean-profile inspection before installing into an active Codex home.

## Supported versions

Codex bundle 1.0.0 is supported. The immediately previous bundle was 0.2.0 and receives no
backports. Updating is a fresh repository download or pull followed by rerunning the
installer; backups are enabled by default.

## Reporting a vulnerability

Use GitHub private vulnerability reporting under the repository Security tab. If the
report is not sensitive, open a normal issue. Include the narrowest reproduction, affected
version, platform, exact command/action, and observed result. Do not include live secrets
or credentials.
