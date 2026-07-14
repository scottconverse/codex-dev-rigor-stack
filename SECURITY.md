# Security Policy

**Current release status:** no version is approved for installation. Version 1.7.0 is an
unreleased review candidate; versions 1.6.0–1.6.3 are unsupported.

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
or rewrite local task state. The same boundary applies to exact-task recovery transaction
tokens: they bind a completion to one task, checkpoint, and unique failure occurrence for
stale/replay detection, but do not make model-readable local state tamper-proof.

Task identity is paired with
`task-genesis-v4-<64 lowercase hex task key>.json`, which commits the exact task key to its
task-local salt. Accepted proof is paired with
`evidence-v4-<16 lowercase hex proof ID>.json`, whose strict schema binds the task, turn,
hashed edit set, evidence class, execution/descriptor hashes, result, and checkpoint.
Descriptors retain only bounded semantic and hashed correlation fields; they never retain
secrets or raw sensitive command arguments. These files make accidental copying, stale
reuse, schema drift, and mismatch visible. They are local evidence and correlation—not a
security boundary against a process with permission to rewrite the profile. Missing or
tampered canonical evidence is release-invalid, as are unreconciled pending tool
observations or subagent pending observations.

On Windows, `DevRigorHookActivator-1.7.0.exe` provides that review without a terminal. It
uses Codex's local app-server protocol, accepts only the exact seven expected dev-rigor
events sourced from the user's `hooks.json`, shows their commands and hashes, requires an
explicit confirmation, writes those hashes through `config/batchWrite`, and re-reads
`hooks/list` before reporting success. It cannot trust unrelated hooks.

The 1.7.0 Windows executable will be built from the published source only after a clean
independent verdict and the owner's explicit release decision. While the review hold is
active, no executable, checksum, or end-user installation route is published. Maintainer
source installers remain available solely for isolated review-profile testing. An authorized release
must publish the exact binary SHA-256 and matching source/build record; do not continue when
the downloaded hash differs. Browser downloads may trigger Windows SmartScreen because the
future executable is not Authenticode-signed.

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

Versions 1.6.0 through 1.6.3 are unsupported. Their hook enforcement lacks the complete
independently reviewed 1.7.0 remediation; earlier Stop-hook state can outlive the coding
turn that created it and discard later read-only or conversational responses. Uninstall
those versions before continuing normal work, then install 1.7.0 only after its isolated
tests and exact hook definitions have been reviewed.

## Reporting a vulnerability

Use GitHub private vulnerability reporting under the repository Security tab. If the
report is not sensitive, open a normal issue. Include the narrowest reproduction, affected
version, platform, exact command/action, and observed result. Do not include live secrets
or credentials.
