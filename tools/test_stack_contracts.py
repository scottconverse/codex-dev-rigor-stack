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

    def test_current_release_is_identified_on_every_document_surface(self) -> None:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "1.6.1")
        surfaces = {
            "README": ROOT / "README.md",
            "manual": ROOT / "docs" / "MANUAL.md",
            "architecture": ROOT / "docs" / "ARCHITECTURE.md",
            "landing": ROOT / "docs" / "index.html",
            "security": ROOT / "SECURITY.md",
            "contributing": ROOT / "CONTRIBUTING.md",
            "changelog": ROOT / "CHANGELOG.md",
            "PowerShell installer": ROOT / "install.ps1",
            "shell installer": ROOT / "install.sh",
            "PowerShell exporter": ROOT / "export" / "export-portable.ps1",
            "shell exporter": ROOT / "export" / "export-portable.sh",
        }
        for name, path in surfaces.items():
            with self.subTest(surface=name):
                self.assertIn("1.6.1", path.read_text(encoding="utf-8"))
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertNotIn("Dates are release (tag) dates.", changelog)
        self.assertIn("does not imply a Git tag", changelog)

    def test_deliverable_docs_are_complete_and_two_voice(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        manual = (ROOT / "docs" / "MANUAL.md").read_text(encoding="utf-8")
        architecture = (ROOT / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
        landing = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")

        self.assert_terms(readme, "plain english", "technical", "user manual", "architecture")
        self.assert_terms(
            manual,
            "part 1 — plain english",
            "part 2 — technical manual",
            "install",
            "update",
            "backup",
            "restore",
            "uninstall",
            "troubleshooting",
            "all 19",
            "session and machine continuity",
            "evaluator-owned exits",
            "owner vs coordinator",
            "fan-out and cost",
            "audit-lite / audit-team vs gauntletgate",
            "active codex hooks",
            "degrade and invalid states",
        )
        self.assertGreaterEqual(architecture.count("```mermaid"), 3)
        self.assert_terms(
            architecture,
            "system context",
            "delivery state machine",
            "evidence and handoff architecture",
            "deployment architecture",
        )
        self.assert_terms(
            landing,
            "plain english",
            "technical architecture",
            "all 19 entrypoints",
            "version 1.6.1",
            "read the full user manual",
        )
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        for entry in manifest["skills"]:
            self.assertIn(entry["name"], landing, f"landing omits {entry['name']}")
        for target in ("plain-english", "technical-architecture", "entrypoints", "install"):
            self.assertIn(f'id="{target}"', landing)
            self.assertIn(f'href="#{target}"', landing)

    def test_codex_hooks_are_active_wired_and_architecturally_primary(self) -> None:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        hook_status = manifest["codex"]["hooks"]
        self.assertEqual(hook_status["status"], "active")
        self.assertEqual(
            set(hook_status["events"]),
            {"SessionStart", "SubagentStart", "UserPromptSubmit", "PostToolUse", "Stop", "SubagentStop"},
        )

        required = (
            ROOT / "codex" / "hooks" / "dev-rigor-activate.js",
            ROOT / "codex" / "hooks" / "dev-rigor-router.js",
            ROOT / "codex" / "hooks" / "dev-rigor-ground.js",
            ROOT / "codex" / "hooks" / "wire-hooks.js",
            ROOT / "codex" / "hooks" / "test-hooks.js",
            ROOT / "codex" / "dev-rigor-reflex.md",
        )
        for path in required:
            self.assertTrue(path.is_file(), f"missing active Codex hook artifact: {path}")

        for installer in (ROOT / "install.ps1", ROOT / "install.sh"):
            text = installer.read_text(encoding="utf-8")
            self.assertIn("wire-hooks.js", text)
            self.assertIn("staging", text.lower())
            self.assertIn("rollback", text.lower())
            self.assertIn("hooks.json", text)
        self.assertIn(
            'target="$codex_home/skills"',
            (ROOT / "install.sh").read_text(encoding="utf-8"),
        )

        landing = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
        architecture = (ROOT / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
        primary_figure = landing.split("<figure>", 1)[1].split("</figure>", 1)[0]
        self.assertNotIn("CLAUDE", primary_figure.upper())
        self.assert_terms(
            primary_figure,
            "active codex hooks",
            "sessionstart",
            "userpromptsubmit",
            "posttooluse",
            "stop",
            "19 entrypoints",
        )
        self.assert_terms(
            architecture,
            "active codex hook",
            "reflex",
            "router",
            "grounding",
            "hooks.json",
            "trust",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
