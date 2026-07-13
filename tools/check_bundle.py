#!/usr/bin/env python3
"""Validate that the declared Codex bundle is complete and installer-aligned."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

CANONICAL = {
    "dev-rigor-stack",
    "dev-rigor-stack-continuity",
    "dev-rigor-stack-plan",
    "dev-rigor-stack-build",
    "dev-rigor-stack-proof-gate",
    "dev-rigor-stack-audit-lite",
    "dev-rigor-stack-audit-team",
    "dev-rigor-stack-walkthrough",
    "dev-rigor-stack-visitor-audit",
    "dev-rigor-stack-gauntletgate",
    "dev-rigor-stack-merge-gate",
    "dev-rigor-stack-docs-gate",
    "dev-rigor-stack-release",
}

COMPATIBILITY = {
    "coder-tdd-qa",
    "proof-gate",
    "audit-lite",
    "audit-team",
    "gauntletgate",
    "visitor-audit",
}


def main() -> int:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    names = [entry["name"] for entry in manifest["skills"]]

    expected = CANONICAL | COMPATIBILITY
    assert set(names) == expected, f"manifest skills differ: {names}"
    assert manifest["version"] == "1.6.0", "manifest version must be 1.6.0"

    for name in names:
        skill_file = ROOT / "skills" / name / "SKILL.md"
        assert skill_file.is_file(), f"missing {name}/SKILL.md"
        text = skill_file.read_text(encoding="utf-8")
        assert re.search(rf"^name:\s*['\"]?{re.escape(name)}['\"]?\s*$", text, re.MULTILINE), (
            f"frontmatter name does not match folder: {name}"
        )

    ps = (ROOT / "install.ps1").read_text(encoding="utf-8")
    sh = (ROOT / "install.sh").read_text(encoding="utf-8")
    ps_order = re.search(r"\$Order = @\(([^\n]+)\)", ps)
    sh_order = re.search(r'^order="([^"]+)"', sh, re.MULTILINE)
    assert ps_order and sh_order, "could not locate installer order"
    ps_names = re.findall(r"'([^']+)'", ps_order.group(1))
    assert ps_names == names, "PowerShell installer order differs from manifest"
    assert sh_order.group(1).split() == names, "shell installer drift"

    hooks = manifest["codex"]["hooks"]
    assert hooks["status"] == "active", "Codex hooks must be active"
    for path in (
        ROOT / "codex" / "hooks" / "dev-rigor-activate.js",
        ROOT / "codex" / "hooks" / "dev-rigor-router.js",
        ROOT / "codex" / "hooks" / "dev-rigor-ground.js",
        ROOT / "codex" / "hooks" / "wire-hooks.js",
    ):
        assert path.is_file(), f"missing active Codex hook file: {path}"
    assert "wire-hooks.js" in ps and "wire-hooks.js" in sh, "installers do not wire Codex hooks"

    coordinator = (ROOT / "skills" / "dev-rigor-stack" / "SKILL.md").read_text(encoding="utf-8")
    for name in sorted(CANONICAL - {"dev-rigor-stack"}):
        assert f"${name}" in coordinator, f"coordinator does not route {name}"
    assert "post-deploy" in coordinator.lower(), "coordinator lacks live post-deploy audit"
    assert "0/0/0/0/0" in coordinator, "coordinator does not enforce strict-zero"

    walkthrough = (ROOT / "skills" / "dev-rigor-stack-walkthrough" / "SKILL.md").read_text(
        encoding="utf-8"
    )
    for phrase in (
        "before inspecting source",
        "published installer",
        "every screen",
        "every control",
        "coverage ledger",
        "update",
        "repair",
        "uninstall",
    ):
        assert phrase in walkthrough.lower(), f"walkthrough lost capability: {phrase}"

    visitor = (ROOT / "skills" / "visitor-audit" / "SKILL.md").read_text(encoding="utf-8")
    for phrase in ("every link", "every public page", "every safe public control", "acquisition handoff"):
        assert phrase in visitor.lower(), f"visitor-audit lost capability: {phrase}"
    checker = ROOT / "skills" / "visitor-audit" / "scripts" / "check_links.py"
    assert checker.is_file(), "visitor-audit checker missing"

    forbidden = [path for path in ROOT.rglob("*") if path.is_file() and (
        path.suffix in {".pyc", ".pyo"} or "__pycache__" in path.parts
    )]
    assert not forbidden, f"generated Python artifacts tracked/present: {forbidden}"

    print(f"ok   bundle declares and installs {len(names)} aligned skill(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
