#!/usr/bin/env python3
"""Validate that the declared Codex bundle is complete and installer-aligned."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    names = [entry["name"] for entry in manifest["skills"]]

    expected = {
        "dev-rigor-stack",
        "coder-tdd-qa",
        "proof-gate",
        "audit-lite",
        "audit-team",
        "gauntletgate",
        "visitor-audit",
    }
    assert set(names) == expected, f"manifest skills differ: {names}"

    for name in names:
        assert (ROOT / "skills" / name / "SKILL.md").is_file(), f"missing {name}/SKILL.md"

    ps = (ROOT / "install.ps1").read_text(encoding="utf-8")
    sh = (ROOT / "install.sh").read_text(encoding="utf-8")
    ps_order = re.search(r"\$Order = @\(([^\n]+)\)", ps)
    sh_order = re.search(r'^order="([^"]+)"', sh, re.MULTILINE)
    assert ps_order and sh_order, "could not locate installer order"
    assert all(f"'{name}'" in ps_order.group(1) for name in names), "PowerShell installer drift"
    assert sh_order.group(1).split() == names, "shell installer drift"

    coordinator = (ROOT / "skills" / "dev-rigor-stack" / "SKILL.md").read_text(encoding="utf-8")
    assert "$visitor-audit" in coordinator, "coordinator does not route visitor-audit"
    assert "post-deploy" in coordinator.lower(), "coordinator lacks live post-deploy audit"

    print(f"ok   bundle declares and installs {len(names)} aligned skill(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
