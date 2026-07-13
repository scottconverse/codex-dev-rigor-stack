#!/usr/bin/env python3
"""Transactional upgrade/uninstall matrix for Dev Rigor profiles."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS = [item["name"] for item in json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["skills"]]


def fingerprint(root: Path) -> str:
    digest = hashlib.sha256()
    if not root.exists():
        return digest.hexdigest()
    for candidate in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        relative = candidate.relative_to(root).as_posix()
        digest.update(("D" if candidate.is_dir() else "F").encode() + relative.encode() + b"\0")
        if candidate.is_file():
            digest.update(hashlib.sha256(candidate.read_bytes()).digest())
    return digest.hexdigest()


def snapshot(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for candidate in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        relative = candidate.relative_to(root).as_posix()
        result[relative] = "dir" if candidate.is_dir() else hashlib.sha256(candidate.read_bytes()).hexdigest()
    return result


def command(script: str, home: Path, *, uninstall: bool = False) -> list[str]:
    if os.name == "nt":
        args = [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            str(ROOT / script), "-CodexHome", str(home),
        ]
        if not uninstall:
            args.append("-NoBackup")
        return args
    args = ["bash", str(ROOT / script), "--codex-home", str(home)]
    if not uninstall:
        args.append("--no-backup")
    return args


def install_fake_revoker(home: Path) -> None:
    """Replace only the disposable profile's revoker with a deterministic trust mutation."""
    script = """#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const config = path.join(process.argv[2], 'config.toml');
if (process.env.DEV_RIGOR_UNINSTALL_TEST_FAIL_AT) {
  fs.appendFileSync(config, '\\n# injected trust mutation before rollback\\n');
}
"""
    (home / "dev-rigor-stack" / "hooks" / "revoke-trust.js").write_text(script, encoding="utf-8")


def seed(home: Path, version: str) -> None:
    (home / "skills").mkdir(parents=True)
    for name in SKILLS:
        target = home / "skills" / name
        target.mkdir()
        (target / "SKILL.md").write_text(f"seed {version} {name}\n", encoding="utf-8")
    runtime = home / "dev-rigor-stack" / "hooks"
    runtime.mkdir(parents=True)
    (runtime / "dev-rigor-ground.js").write_text(f"// seed {version}\n", encoding="utf-8")
    state = runtime.parent / "state"
    state.mkdir()
    ledger = "ground-seed.log" if version == "1.6.1" else f"ground-v{2 if version == '1.6.2' else 3}-seed.log"
    (state / ledger).write_text("E old-poisoned-edit.ts\nX Bash\n", encoding="utf-8")
    owned = f'node "{runtime / "dev-rigor-ground.js"}" check'
    hooks = {
        "hooks": {
            "Stop": [
                {"hooks": [{"type": "command", "command": "node foreign-stop.js"}]},
                {"hooks": [{"type": "command", "command": owned}]},
            ],
            "ForeignEvent": [{"hooks": [{"type": "command", "command": "node foreign.js"}]}],
        },
        "foreignRoot": {"preserve": True},
    }
    (home / "hooks.json").write_text(json.dumps(hooks, indent=2) + "\n", encoding="utf-8")
    (home / "config.toml").write_text("[hooks.state.'foreign-proof']\ntrusted_hash = 'sha256:foreign'\n", encoding="utf-8")


def run(args: list[str], env: dict[str, str], expect: int) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True)
    if result.returncode != expect:
        raise AssertionError(f"expected {expect}, got {result.returncode}: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
    return result


def verify_uninstalled(home: Path, foreign_config: bytes) -> None:
    assert not (home / "dev-rigor-stack").exists(), "owned runtime survived uninstall"
    assert all(not (home / "skills" / name).exists() for name in SKILLS), "owned skill survived uninstall"
    hooks = json.loads((home / "hooks.json").read_text(encoding="utf-8"))
    rendered = json.dumps(hooks)
    assert "foreign-stop.js" in rendered and "foreign.js" in rendered and hooks["foreignRoot"] == {"preserve": True}
    assert "dev-rigor-" not in rendered
    assert (home / "config.toml").read_bytes() == foreign_config


def scenario(version: str) -> None:
    with tempfile.TemporaryDirectory(prefix=f"dev-rigor-upgrade-{version}-") as temporary:
        home = Path(temporary) / "home"
        seed(home, version)
        before = fingerprint(home)
        env = {**os.environ, "CI": "1", "DEV_RIGOR_INSTALL_TEST_FAIL_AT": "mid-commit"}
        run(command("install.ps1" if os.name == "nt" else "install.sh", home), env, 1)
        assert fingerprint(home) == before, f"failed {version} upgrade did not roll back byte-for-byte"

        env.pop("DEV_RIGOR_INSTALL_TEST_FAIL_AT")
        run(command("install.ps1" if os.name == "nt" else "install.sh", home), env, 0)
        install_fake_revoker(home)
        assert len([name for name in SKILLS if (home / "skills" / name / "SKILL.md").is_file()]) == 19
        assert "ground-v4-" in (ROOT / "codex" / "hooks" / "dev-rigor-ground.js").read_text(encoding="utf-8")
        assert not list((home / "dev-rigor-stack" / "state").glob("ground*v*-seed.log")) if (home / "dev-rigor-stack" / "state").exists() else True
        foreign_config = (home / "config.toml").read_bytes()
        installed = fingerprint(home)
        installed_snapshot = snapshot(home)
        env["DEV_RIGOR_UNINSTALL_TEST_FAIL_AT"] = "mid-remove"
        run(command("uninstall.ps1" if os.name == "nt" else "uninstall.sh", home, uninstall=True), env, 1)
        after_snapshot = snapshot(home)
        changed = sorted(key for key in set(installed_snapshot) | set(after_snapshot) if installed_snapshot.get(key) != after_snapshot.get(key))
        assert fingerprint(home) == installed, f"failed {version} uninstall did not roll back byte-for-byte: {changed}"
        env.pop("DEV_RIGOR_UNINSTALL_TEST_FAIL_AT")
        run(command("uninstall.ps1" if os.name == "nt" else "uninstall.sh", home, uninstall=True), env, 0)
        verify_uninstalled(home, foreign_config)


def clean_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-upgrade-clean-") as temporary:
        home = Path(temporary) / "home"
        home.mkdir()
        (home / "config.toml").write_text("[foreign]\nvalue = true\n", encoding="utf-8")
        (home / "hooks.json").write_text(json.dumps({"hooks": {"ForeignEvent": [{"hooks": [{"type": "command", "command": "node foreign.js"}]}]}}), encoding="utf-8")
        env = {**os.environ, "CI": "1"}
        run(command("install.ps1" if os.name == "nt" else "install.sh", home), env, 0)
        install_fake_revoker(home)
        foreign_config = (home / "config.toml").read_bytes()
        run(command("uninstall.ps1" if os.name == "nt" else "uninstall.sh", home, uninstall=True), env, 0)
        assert not (home / "dev-rigor-stack").exists()
        assert (home / "config.toml").read_bytes() == foreign_config


def main() -> int:
    for version in ("1.6.1", "1.6.2", "1.6.3"):
        scenario(version)
    clean_scenario()
    print("upgrade matrix: 1.6.1, 1.6.2, 1.6.3, clean, foreign hooks/trust PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
