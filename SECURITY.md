# Security Policy

**Current supported version:** 1.7.0

## Security model

The installer stages 19 Markdown skill folders, the active Node.js hook runtime, and a
merged `hooks.json`, then commits or rolls back that set together. It preserves foreign
hook definitions and backs up changed configuration. It does not open network services or
install dependencies.

Codex requires review and trust before non-managed command hooks run. Each installed
command embeds its script SHA-256, reads the script once, verifies that buffer, and compiles
that same buffer. A changed runtime file is refused; reinstalling legitimate updates emits
changed definitions for review. The runtime uses Node built-ins only, reads lifecycle JSON
from stdin, writes Codex hook JSON to stdout, and stores append-only state beneath
`CODEX_HOME/dev-rigor-stack/state`. Task records and evidence tokens contain hashes and
bounded metadata rather than raw sensitive command arguments. Correlation tokens detect
stale/mismatched evidence but are not a security boundary against a process that can read
the task salt.

On Windows, `DevRigorHookActivator-1.7.0.exe` provides that review without a terminal. It
uses Codex's local app-server protocol, accepts only the exact six expected dev-rigor
events sourced from the user's `hooks.json`, shows their commands and hashes, requires an
explicit confirmation, writes those hashes through `config/batchWrite`, and re-reads
`hooks/list` before reporting success. It cannot trust unrelated hooks.

The 1.7.0 Windows executable is built from the published source but is not Authenticode-signed.
Browser downloads may therefore trigger Windows SmartScreen. The landing page publishes
the exact binary SHA-256 and the complete matching C# source; do not continue when the
downloaded hash differs.

The installers write only to the selected skills target, Codex hook runtime/configuration,
and their staging, rollback, and backup trees. Injected mid-commit and backup-finalization
failures are CI-tested. Transactional uninstall snapshots trust configuration before
revocation; a later failure restores the complete starting profile, while success removes
all owned components and preserves foreign configuration. Use a custom `-Target`/`--target` for
clean-profile inspection before installing into an active Codex home.

## Supported versions

No version is currently approved for installation. Version 1.7.0 remains an unreleased
candidate on independent-review hold. After approval, updating will use a fresh repository download or pull followed by
rerunning the installer; backups are enabled by default.

Versions 1.6.0 through 1.6.2 are unsupported. Their Stop-hook state can outlive the coding
turn that created it and discard later read-only or conversational responses. Uninstall
those versions before continuing normal work, then install 1.7.0 only after its isolated
tests and exact hook definitions have been reviewed.

## Reporting a vulnerability

Use GitHub private vulnerability reporting under the repository Security tab. If the
report is not sensitive, open a normal issue. Include the narrowest reproduction, affected
version, platform, exact command/action, and observed result. Do not include live secrets
or credentials.
