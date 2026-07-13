#!/usr/bin/env python3
"""Seed and fingerprint every live file in an installed Dev Rigor tree."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


def _files(root: Path):
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_file() and ".backup" not in path.relative_to(root).parts:
            yield path


def seed(codex_home: Path) -> None:
    skills = codex_home / "skills"
    skill_dirs = sorted(
        path for path in skills.iterdir() if path.is_dir() and path.name != ".backup"
    )
    if not skill_dirs:
        raise SystemExit("no installed skills found to seed")
    for skill in skill_dirs:
        (skill / ".rollback-proof.txt").write_text(
            f"preserve pre-existing state for {skill.name}\n", encoding="utf-8"
        )
    runtime = codex_home / "dev-rigor-stack"
    if not runtime.is_dir():
        raise SystemExit("installed hook runtime is missing")
    (runtime / ".rollback-proof.txt").write_text(
        "preserve pre-existing hook runtime state\n", encoding="utf-8"
    )


def fingerprint(codex_home: Path) -> str:
    roots = {
        "skills": codex_home / "skills",
        "runtime": codex_home / "dev-rigor-stack",
    }
    hooks = codex_home / "hooks.json"
    for label, root in roots.items():
        if not root.is_dir():
            raise SystemExit(f"{label} root is missing: {root}")
    if not hooks.is_file():
        raise SystemExit(f"hook configuration is missing: {hooks}")

    digest = hashlib.sha256()
    for label, root in roots.items():
        for path in _files(root):
            relative = path.relative_to(root).as_posix()
            content = path.read_bytes()
            digest.update(f"{label}/{relative}\0{len(content)}\0".encode("utf-8"))
            digest.update(hashlib.sha256(content).digest())
    content = hooks.read_bytes()
    digest.update(f"hooks.json\0{len(content)}\0".encode("utf-8"))
    digest.update(hashlib.sha256(content).digest())
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("codex_home", type=Path)
    parser.add_argument(
        "--seed",
        action="store_true",
        help="add distinct pre-existing-state probes to every live skill and runtime",
    )
    args = parser.parse_args()
    home = args.codex_home.resolve()
    if args.seed:
        seed(home)
    print(fingerprint(home))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
