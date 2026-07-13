#!/usr/bin/env python3
"""Prove the release verifiers detect representative product mutations."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def run(root: Path, command: list[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=root, text=True, capture_output=True, env=env)


def require_red(result: subprocess.CompletedProcess[str], diagnostic: str, label: str) -> None:
    combined = result.stdout + result.stderr
    if result.returncode == 0:
        raise AssertionError(f"{label} mutation survived its verifier")
    if diagnostic.lower() not in combined.lower():
        raise AssertionError(f"{label} verifier went red without the expected diagnostic {diagnostic!r}:\n{combined}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-verifier-mutations-") as temporary:
        copy = Path(temporary) / "repo"
        shutil.copytree(
            ROOT,
            copy,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "dist", ".pytest_cache"),
        )

        ground = copy / "codex" / "hooks" / "dev-rigor-ground.js"
        activate = copy / "codex" / "hooks" / "dev-rigor-activate.js"
        original_ground = ground.read_text(encoding="utf-8")
        original_activate = activate.read_text(encoding="utf-8")

        def hook_mutation(
            file: Path,
            original: str,
            needle: str,
            replacement: str,
            diagnostic: str,
            label: str,
        ) -> None:
            if original.count(needle) != 1:
                raise AssertionError(f"{label} mutation target is no longer unique")
            file.write_text(original.replace(needle, replacement), encoding="utf-8")
            try:
                env = {**os.environ, "DEV_RIGOR_TEST_FILTER": diagnostic}
                require_red(run(copy, ["node", "codex/hooks/test-hooks.js"], env=env), diagnostic, label)
            finally:
                file.write_text(original, encoding="utf-8")

        hook_mutation(
            ground, original_ground,
            "if (lastProof < lastEdit) {", "if (false && lastProof < lastEdit) {",
            "apply_patch runnable edit without a later execution blocks Stop", "substantive Stop gate",
        )
        hook_mutation(
            ground, original_ground,
            "return path.join(stateDir, `ground-v4-${hash(session, turn)}.log`);",
            "return path.join(stateDir, `ground-v4-${hash(session)}.log`);",
            "a distinct Codex turn passes even when an older turn remains unresolved", "exact-turn isolation",
        )
        hook_mutation(
            ground, original_ground,
            "if (lastRelease >= lastBlock) return;", "if (false && lastRelease >= lastBlock) return;",
            "the same turn is blocked at most once when Codex omits stop_hook_active", "one-block circuit release",
        )
        hook_mutation(
            ground, original_ground,
            "if (payload.stop_hook_active && lastBlock < 0) return;", "if (payload.stop_hook_active) return;",
            "proof after a block can resolve the current turn without a second block", "post-block proof under stop_hook_active",
        )
        hook_mutation(
            ground, original_ground,
            "!Array.isArray(debt.edits) || !debt.edits.every((edit) => accepted.has(edit))",
            "true",
            "proof resolves debt only for the same or a verified superseding edit set", "proof-debt clearing",
        )
        hook_mutation(
            ground, original_ground,
            "parsed.mode = parent && /^(?:ON|WARN|OFF)$/.test(parent.mode) ? parent.mode : 'WARN';",
            "parsed.mode = 'ON';",
            "bound subagent inherits live parent controls including later OFF", "OFF propagation",
        )
        hook_mutation(
            ground, original_ground,
            "executionHash, checkpoint, result: 'pass'", "checkpoint, result: 'pass'",
            "evidence tokens bind the exact execution fingerprint and target checkpoint", "execution-token binding",
        )
        hook_mutation(
            ground, original_ground,
            "if (structured.found) return !structured.failed;", "if (false && structured.found) return !structured.failed;",
            "structured failing test result outranks process exit zero", "structured-result precedence",
        )
        hook_mutation(
            ground, original_ground,
            "const observed = worktreeChanges(before, after);", "const observed = [];",
            "PreToolUse/PostToolUse detects an opaque shell write to a tracked source file", "opaque shell-write detection",
        )
        hook_mutation(
            activate, original_activate,
            "if (!parentTask.children.includes(childKey)) parentTask.children.push(childKey);",
            "if (false && !parentTask.children.includes(childKey)) parentTask.children.push(childKey);",
            "parent STATUS aggregates authoritatively associated subagent proof debt", "parent-child debt registration",
        )
        hook_mutation(
            ground, original_ground,
            "process.stdout.write(JSON.stringify({ systemMessage: message }));", "process.stdout.write('');",
            "warnings are visible and unresolved debt is injected into the next coding turn", "visible WARN delivery",
        )
        hook_mutation(
            ground, original_ground,
            "  return 'U';\n}", "  return 'R';\n}",
            "harmless and unknown shell commands cannot satisfy substantive proof", "unknown-command classification",
        )

        manifest = copy / "manifest.json"
        original_manifest = manifest.read_text(encoding="utf-8")
        manifest.write_text(original_manifest.replace('"version": "1.7.0"', '"version": "9.9.9"', 1), encoding="utf-8")
        require_red(
            run(copy, [sys.executable, "tools/test_stack_contracts.py"]),
            "test_current_release_is_identified_on_every_document_surface",
            "version-surface contract",
        )
        manifest.write_text(original_manifest, encoding="utf-8")

        executable = copy / "docs" / "downloads" / "unapproved-installer.exe"
        executable.parent.mkdir(parents=True, exist_ok=True)
        executable.write_bytes(b"MZ\x00unapproved-publication-mutation")
        require_red(
            run(copy, [sys.executable, "tools/test_desktop_activator.py"]),
            "test_unapproved_candidate_is_not_published_or_described_as_current",
            "unapproved installable artifact publication",
        )

    print("verifier mutations: 12 hook invariants, version surface, and publication hold all went red")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
