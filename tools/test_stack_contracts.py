#!/usr/bin/env python3
"""Contract tests that prevent the Codex rigor stack from losing capabilities."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"

CANONICAL_SKILLS = {
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

COMPATIBILITY_SKILLS = {
    "coder-tdd-qa",
    "proof-gate",
    "audit-lite",
    "audit-team",
    "gauntletgate",
    "visitor-audit",
}


class StackContractTests(unittest.TestCase):
    def text(self, skill: str) -> str:
        return (SKILLS / skill / "SKILL.md").read_text(encoding="utf-8")

    def assert_terms(self, text: str, *terms: str) -> None:
        lowered = text.lower()
        missing = [term for term in terms if term.lower() not in lowered]
        self.assertFalse(missing, f"missing required capability terms: {missing}")

    def test_manifest_declares_canonical_and_compatibility_entrypoints(self) -> None:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        names = {entry["name"] for entry in manifest["skills"]}
        self.assertEqual(names, CANONICAL_SKILLS | COMPATIBILITY_SKILLS)

    def test_walkthrough_is_blind_first_exhaustive_and_lifecycle_complete(self) -> None:
        text = self.text("dev-rigor-stack-walkthrough")
        self.assert_terms(
            text,
            "blind",
            "before inspecting source",
            "published installer",
            "clean machine",
            "every screen",
            "every control",
            "every distinct",
            "spacing",
            "alignment",
            "clipping",
            "contrast",
            "focus",
            "coverage ledger",
            "update",
            "repair",
            "uninstall",
            "interface promise",
            "actual outcome",
        )

    def test_visitor_audit_keeps_strong_mechanics_and_hands_off_installer(self) -> None:
        text = self.text("visitor-audit")
        self.assert_terms(
            text,
            "entire rendered surface",
            "every link",
            "every public page",
            "every safe public control",
            "visual",
            "checksum",
            "acquisition handoff",
            "blocker",
            "critical",
            "major",
            "minor",
            "nit",
        )

    def test_gauntlet_consumes_the_canonical_walkthrough(self) -> None:
        text = self.text("gauntletgate")
        self.assertIn("$dev-rigor-stack-walkthrough", text)
        lane = (SKILLS / "gauntletgate" / "lanes" / "walkthrough.md").read_text(encoding="utf-8")
        self.assertIn("dev-rigor-stack-walkthrough", lane)

    def test_coordinator_routes_every_canonical_stage(self) -> None:
        text = self.text("dev-rigor-stack")
        for skill in sorted(CANONICAL_SKILLS - {"dev-rigor-stack"}):
            self.assertIn(f"${skill}", text, f"coordinator does not route {skill}")
        self.assertIn("0/0/0/0/0", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
