#!/usr/bin/env python3
"""Contract tests that prevent the Codex rigor stack from losing capabilities."""

from __future__ import annotations

import json
import subprocess
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
        for skill in ("visitor-audit", "dev-rigor-stack-visitor-audit"):
            text = self.text(skill)
            with self.subTest(skill=skill):
                self.assertGreaterEqual(len(text.splitlines()), 150, "visitor skill was abbreviated")
                self.assertNotIn("read `../visitor-audit/skill.md`", text.lower())
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
        self.assertEqual(
            (SKILLS / "visitor-audit" / "scripts" / "check_links.py").read_text(encoding="utf-8").rstrip(),
            (SKILLS / "dev-rigor-stack-visitor-audit" / "scripts" / "check_links.py").read_text(encoding="utf-8").rstrip(),
            "both standalone Visitor entrypoints must ship the same mechanical link checker",
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
        self.assertEqual(manifest["version"], "1.7.0")
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
                self.assertIn("1.7.0", path.read_text(encoding="utf-8"))
        for skill in sorted(CANONICAL_SKILLS | COMPATIBILITY_SKILLS):
            with self.subTest(surface=f"{skill} skill"):
                skill_text = self.text(skill)
                self.assertRegex(skill_text, r"(?m)^metadata:\s*\n\s+version:\s*1\.7\.0\s*$")
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
            "version 1.7.0",
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
            {"SessionStart", "SubagentStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"},
        )

        required = (
            ROOT / "codex" / "hooks" / "dev-rigor-activate.js",
            ROOT / "codex" / "hooks" / "dev-rigor-router.js",
            ROOT / "codex" / "hooks" / "dev-rigor-ground.js",
            ROOT / "codex" / "hooks" / "wire-hooks.js",
            ROOT / "codex" / "dev-rigor-reflex.md",
            ROOT / "codex" / "install-transaction.js",
            ROOT / "codex" / "install-transaction.test.js",
            ROOT / "codex" / "hooks" / "test-revoke-trust-cas.js",
        )
        for path in required:
            self.assertTrue(path.is_file(), f"missing active Codex hook artifact: {path}")

        ground = (ROOT / "codex" / "hooks" / "dev-rigor-ground.js").read_text(encoding="utf-8")
        router = (ROOT / "codex" / "hooks" / "dev-rigor-router.js").read_text(encoding="utf-8")
        self.assert_terms(ground, "payload.session_id", "payload.turn_id", "ground-v4-", "released-unproved")
        self.assertNotIn("ground-v2-", ground)
        # The router may validate/read grounding-ledger references for STATUS and
        # recovery, but only the grounding hook may derive or own a turn ledger.
        self.assertNotIn("function ledgerPath(", router)
        self.assertNotIn("`ground-v4-${hash(session, turn)}.log`", router)

        transaction = (ROOT / "codex" / "install-transaction.js").read_text(encoding="utf-8")
        self.assert_terms(
            transaction,
            "wire-hooks.js",
            "staging",
            "rollback",
            "hooks.json",
            "install-ownership-v2.json",
            "before-hooks-cas",
            "recover-only",
        )
        for installer in (ROOT / "install.ps1", ROOT / "install.sh"):
            text = installer.read_text(encoding="utf-8")
            self.assertIn("install-transaction.js", text)
            self.assertIn("install", text)
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

    def test_task_controls_and_all_debt_classes_are_release_visible(self) -> None:
        core = (ROOT / "codex" / "dev-rigor-core.md").read_text(encoding="utf-8")
        reflex = (ROOT / "codex" / "dev-rigor-reflex.md").read_text(encoding="utf-8")
        manual = (ROOT / "docs" / "MANUAL.md").read_text(encoding="utf-8")
        release = self.text("dev-rigor-stack-release")
        coordinator = self.text("dev-rigor-stack")
        for text in (core, reflex, manual):
            self.assert_terms(text, "devrigoron", "devrigorwarn", "devrigoroff", "devrigorstatus")
        self.assert_terms(core, "invalid canonical evidence", "pending tool observations", "subagent pending observations")
        self.assert_terms(reflex, "generated", "proof, mechanical, association", "security boundary")
        self.assert_terms(
            reflex,
            "task-genesis-v4-",
            "evidence-v4-",
            "invalid canonical evidence",
            "pending tool observations",
            "subagent pending observations",
        )
        self.assert_terms(manual, "released-unproved", "mechanical debt", "association debt", "authoritative parent identity")
        self.assert_terms(release, "devrigorstatus", "proof, mechanical, or association debt", "mark the release invalid")
        self.assert_terms(coordinator, "no unresolved proof, mechanical, or association debt", "verified superseding set")

    def test_release_gate_requires_pr11_safety_evidence_before_go(self) -> None:
        release = self.text("dev-rigor-stack-release")
        self.assert_terms(
            release,
            "before go",
            "exact classifier negatives and positives",
            "version/help/list/eval/dry-run",
            "exact supported run/test/build shapes",
            "head/tree",
            "symbolic/detached reference",
            "semantic index",
            "complete status",
            "every git-reported artifact",
            "assume-unchanged",
            "skip-worktree",
            "submodule commit movement",
            "task-state transactions",
            "32 concurrent children",
            "immutable parent binding",
            "mutation suite",
            "zero survivors",
            "authenticated disposable-profile",
            "disappearing-report",
            "first stop blocks",
            "second stop releases with debt",
            "third stop is silent",
            "later conversation passes",
        )

    def test_canonical_evidence_and_task_identity_are_release_visible(self) -> None:
        ground = (ROOT / "codex" / "hooks" / "dev-rigor-ground.js").read_text(encoding="utf-8")
        router = (ROOT / "codex" / "hooks" / "dev-rigor-router.js").read_text(encoding="utf-8")
        transaction = (ROOT / "codex" / "install-transaction.js").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        manual = (ROOT / "docs" / "MANUAL.md").read_text(encoding="utf-8")
        architecture = (ROOT / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
        security = (ROOT / "SECURITY.md").read_text(encoding="utf-8")
        coordinator = self.text("dev-rigor-stack")
        release = self.text("dev-rigor-stack-release")

        self.assert_terms(
            ground,
            "task-genesis-v4-",
            "evidence-v4-",
            "descriptorhash",
            "executionhash",
            "originhash",
            "responsehash",
        )
        self.assert_terms(router, "invalid canonical evidence", "pending tool observations", "subagent pending observations")
        self.assert_terms(transaction, "task-genesis-v4-", "evidence-v4-")
        for text in (readme, manual, architecture, security):
            self.assert_terms(
                text,
                "evidence-v4-",
                "task-genesis-v4-",
                "raw sensitive command arguments",
                "correlation",
                "not a security boundary",
            )
        for text in (coordinator, release):
            self.assert_terms(
                text,
                "invalid canonical evidence",
                "pending tool observations",
                "subagent pending observations",
                "release invalid",
                "same affected edit set",
            )

    def test_contributor_and_injected_contracts_name_the_complete_release_checks(self) -> None:
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
        reflex = (ROOT / "codex" / "dev-rigor-reflex.md").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        architecture = (ROOT / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
        self.assert_terms(
            contributing,
            "node desktop/test-live-hook-lifecycle.js",
            "authenticated disposable codex_home",
            "manual release evidence",
        )
        self.assert_terms(reflex, "latest relevant artifact edit", "every direct or observed/tool-generated artifact change")
        self.assertNotIn("latest runnable edit", reflex.lower())
        self.assertNotIn("inheritance, and transactional migration/uninstall", readme.lower())
        self.assertNotIn("review 6 commands", architecture.lower())
        self.assert_terms(architecture, "review 7 hooks")

    def test_transactional_uninstaller_and_upgrade_matrix_ship_with_the_bundle(self) -> None:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["codex"]["uninstaller"], "uninstall.ps1")
        self.assertEqual(manifest["codex"]["transaction_coordinator"], "codex/install-transaction.js")
        self.assertEqual(manifest["codex"]["transaction_test"], "codex/install-transaction.test.js")
        for path in (
            ROOT / "uninstall.ps1",
            ROOT / "uninstall.sh",
            ROOT / "codex" / "install-transaction.js",
            ROOT / "codex" / "install-transaction.test.js",
            ROOT / "tools" / "test_upgrade_matrix.py",
        ):
            self.assertTrue(path.is_file(), f"missing transactional lifecycle artifact: {path}")
        matrix = (ROOT / "tools" / "test_upgrade_matrix.py").read_text(encoding="utf-8")
        self.assert_terms(matrix, "1.6.1", "1.6.2", "1.6.3", "pristine_scenario", "foreign hooks/trust")
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("test_upgrade_matrix.py", ci)
        self.assertIn("node codex/install-transaction.test.js", ci)
        self.assertIn("node codex/hooks/revoke-trust.js --self-test", ci)
        self.assertIn("node codex/hooks/test-revoke-trust-cas.js", ci)

    def test_posix_installers_are_executable_and_exercised_directly(self) -> None:
        modes = subprocess.run(
            ["git", "ls-files", "-s", "--", "install.sh", "uninstall.sh"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
        self.assertEqual(len(modes), 2)
        self.assertTrue(all(line.startswith("100755 ") for line in modes), modes)

        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("./install.sh", ci)
        self.assertIn("./uninstall.sh", ci)
        self.assertNotRegex(ci, r"(?m)\b(?:bash|sh)\s+(?:\./)?(?:install|uninstall)\.sh\b")


if __name__ == "__main__":
    unittest.main(verbosity=2)
