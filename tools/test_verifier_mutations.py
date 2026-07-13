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


def run(root: Path, command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=root, text=True, capture_output=True)


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
        original_ground = ground.read_text(encoding="utf-8")
        needle = "if (lastProof < lastEdit) {"
        if original_ground.count(needle) != 1:
            raise AssertionError("grounding mutation target is no longer unique")
        ground.write_text(original_ground.replace(needle, "if (false && lastProof < lastEdit) {"), encoding="utf-8")
        require_red(
            run(copy, ["node", "codex/hooks/test-hooks.js"]),
            "apply_patch runnable edit without a later execution blocks Stop",
            "substantive Stop gate",
        )
        ground.write_text(original_ground, encoding="utf-8")

        manifest = copy / "manifest.json"
        original_manifest = manifest.read_text(encoding="utf-8")
        manifest.write_text(original_manifest.replace('"version": "1.7.0"', '"version": "9.9.9"', 1), encoding="utf-8")
        require_red(
            run(copy, [sys.executable, "tools/test_stack_contracts.py"]),
            "test_current_release_is_identified_on_every_document_surface",
            "version-surface contract",
        )
        manifest.write_text(original_manifest, encoding="utf-8")

        executable = copy / "docs" / "downloads" / "DevRigorHookActivator-1.7.0.exe"
        data = bytearray(executable.read_bytes())
        data[-1] ^= 0x01
        executable.write_bytes(data)
        require_red(
            run(copy, [sys.executable, "tools/test_desktop_activator.py"]),
            "test_landing_download_and_checksum_match_published_executable",
            "published executable checksum",
        )

    print("verifier mutations: Stop gate, version surface, and published binary all went red")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
