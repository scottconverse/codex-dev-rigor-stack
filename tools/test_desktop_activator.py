#!/usr/bin/env python3
"""Regression contracts for the no-terminal Codex Desktop hook activator."""

from __future__ import annotations

import json
import hashlib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "desktop" / "DevRigorHookActivator.cs"
BUILD = ROOT / "desktop" / "build.ps1"
OWNERSHIP_TEST = ROOT / "desktop" / "OwnershipSelfTest.cs"
INTEGRATION_TEST = ROOT / "desktop" / "ActivatorIntegrationSelfTest.cs"
UI_TEST = ROOT / "desktop" / "ActivatorUiSelfTest.cs"
LIVE_TEST = ROOT / "desktop" / "test-live-hook-lifecycle.js"
BINARY_EQUIVALENCE = ROOT / "desktop" / "verify-binary-equivalence.ps1"
CANDIDATE = ROOT / "candidate-artifacts" / "1.7.0" / "DevRigorHookActivator-1.7.0.exe"
RELEASE_STATE = ROOT / "release-state.json"


class DesktopActivatorContractTests(unittest.TestCase):
    def test_unapproved_candidate_is_not_published_or_described_as_current(self) -> None:
        state = json.loads(RELEASE_STATE.read_text(encoding="utf-8"))
        self.assertEqual(state["candidate_version"], "1.7.0")
        self.assertEqual(state["status"], "review-hold")
        self.assertFalse(state["publication_authorized"])

        landing = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
        self.assertIn("1.7.0 is under independent review", landing)
        self.assertIn("Downloads are disabled", landing)
        self.assertNotIn("Current version: 1.7.0", landing)
        self.assertNotIn("downloads/DevRigorHookActivator-1.7.0", landing)
        self.assertIn("Installation remains withheld", landing)
        self.assertIn('<a href="#install">Release hold</a>', landing)
        self.assertNotIn('<a href="#install">Install</a>', landing)
        self.assertNotIn("powershell -ExecutionPolicy Bypass -File", landing)
        self.assertNotIn("./install.sh", landing)
        self.assertNotIn("./export/export-portable.sh", landing)

        architecture = (ROOT / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
        self.assertIn("candidate-artifacts/", architecture)
        self.assertIn("explicit owner go/no-go", architecture)
        self.assertIn("GO only", architecture)

        published = ROOT / "docs" / "downloads"
        self.assertFalse(
            any(p.name.startswith("DevRigorHookActivator-1.7.0") for p in published.iterdir()),
            "an unapproved 1.7.0 artifact is still in the GitHub Pages source tree",
        )

    def test_version_is_monotonic_task_state_redesign(self) -> None:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "1.7.0")
        self.assertEqual(manifest["codex"]["hooks"]["activation"], "graphical-review")

    def test_activator_uses_codex_supported_app_server_contract(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        for term in (
            'new[] { "app-server", "--listen", "stdio://" }',
            '"initialize"',
            '"initialized"',
            '"hooks/list"',
            '"config/batchWrite"',
            '"hooks.state"',
            '"trusted_hash"',
            '"reloadUserConfig"',
        ):
            self.assertIn(term, text)
        self.assertIn("Environment.SpecialFolder.LocalApplicationData", text)
        self.assertIn('"OpenAI", "Codex", "bin"', text)

    def test_winexe_uses_console_independent_bom_stripping_relay(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        for term in (
            "CreateRelayStart",
            "windowsHide:true",
            "windowsVerbatimArguments:!!s.verbatim",
            "WindowsVerbatimArguments = true",
            "prefix[0]===0xef",
            "prefix[1]===0xbb",
            "prefix[2]===0xbf",
            "prefix.subarray(3)",
            'FileName = "node"',
        ):
            self.assertIn(term, text)
        self.assertNotIn("Console.InputEncoding", text)
        self.assertNotIn("StartWithBomFreeStandardInput", text)

    def test_activator_trusts_only_owned_exact_hook_set(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        for script in (
            "dev-rigor-activate.js",
            "dev-rigor-router.js",
            "dev-rigor-ground.js",
        ):
            self.assertIn(script, text)
        for event in (
            "sessionStart",
            "subagentStart",
            "userPromptSubmit",
            "preToolUse",
            "postToolUse",
            "stop",
            "subagentStop",
        ):
            self.assertIn(event, text)
        self.assertIn("ExpectedHookCount = 7", text)
        self.assertIn("sourcePath", text)
        self.assertIn("currentHash", text)
        ownership = OWNERSHIP_TEST.read_text(encoding="utf-8")
        self.assertIn("lookalike command must be rejected", ownership)
        self.assertIn("foreign source must be rejected", ownership)
        self.assertIn("duplicate event set must be rejected", ownership)
        self.assertIn("missing runtime files must prevent verified activation", ownership)
        self.assertIn("changed runtime bytes must invalidate", ownership)
        self.assertIn("RuntimeFailure", text)
        self.assertIn("BuildIntegrityCommand", text)
        self.assertIn("SHA256", text)

    def test_gui_requires_explicit_review_action_and_verifies_after_write(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        self.assertIn("Review and trust these 7 hooks", text)
        self.assertIn("Alt+T", text)
        self.assertIn("HookReviewDialog", text)
        self.assertIn("Exact seven-hook review details", text)
        self.assertIn("AcceptButton = cancel", text)
        self.assertIn("No terminal is required", text)
        self.assertIn("RefreshAndVerify", text)
        self.assertNotIn("--auto-trust", text)

    def test_windows_build_is_a_gui_executable(self) -> None:
        text = BUILD.read_text(encoding="utf-8")
        self.assertIn("/target:winexe", text)
        self.assertIn("DevRigorHookActivator.exe", text)
        self.assertIn("System.Windows.Forms.dll", text)

    def test_every_executable_version_surface_is_1_7_0(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")
        for declaration in (
            'AssemblyVersion("1.7.0.0")',
            'AssemblyFileVersion("1.7.0.0")',
            'AssemblyInformationalVersion("1.7.0")',
            'AssemblyProduct("Dev Rigor Stack")',
        ):
            self.assertIn(declaration, source)
        build = BUILD.read_text(encoding="utf-8")
        self.assertIn("VersionInfo.FileVersion", build)
        self.assertIn("VersionInfo.ProductVersion", build)

    def test_production_app_server_path_has_fresh_process_integration_test(self) -> None:
        self.assertTrue(INTEGRATION_TEST.is_file())
        text = INTEGRATION_TEST.read_text(encoding="utf-8")
        self.assertIn("new CodexAppServerSession()", text)
        self.assertGreaterEqual(text.count("new CodexAppServerSession()"), 2)
        self.assertIn("fresh app-server process", text)
        build = BUILD.read_text(encoding="utf-8")
        self.assertIn("ActivatorIntegrationSelfTest", build)
        self.assertIn("RunIntegrationTest", build)

    def test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation(self) -> None:
        self.assertTrue(LIVE_TEST.is_file())
        text = LIVE_TEST.read_text(encoding="utf-8")
        for term in (
            "thread/start",
            "turn/start",
            "ground-v4-",
            "delivery.preToolUse",
            "outputSchema",
            "REPORT_STAYS_VISIBLE",
            "UNPROVED_EDIT_RESPONSE",
            "CONVERSATION_OK",
            "missing-receipt",
            "startsWith('K ')",
            "task.unresolved",
            "blocked more than once",
            "Refusing to run the live lifecycle test against the active Codex profile",
            "work directory must exist and be empty",
            "execFileSync('git', ['init', '--quiet', cwd]",
        ):
            self.assertIn(term, text)

    def test_compiled_ui_capstone_exercises_the_real_trust_button(self) -> None:
        self.assertTrue(UI_TEST.is_file())
        text = UI_TEST.read_text(encoding="utf-8")
        for term in (
            "PerformTrustClickForTest",
            "Activation verified after the trust write.",
            "Canceling the review still invoked trust.",
            "An incomplete hook set enabled trust.",
        ):
            self.assertIn(term, text)
        build = BUILD.read_text(encoding="utf-8")
        self.assertIn("ActivatorUiSelfTest", build)
        self.assertIn("Activator UI self-test failed", build)

    def test_ci_fingerprints_every_live_installed_file_for_rollback(self) -> None:
        helper = ROOT / "tools" / "fingerprint_install_tree.py"
        self.assertTrue(helper.is_file())
        text = helper.read_text(encoding="utf-8")
        self.assertIn('skill / ".rollback-proof.txt"', text)
        self.assertIn('runtime / ".rollback-proof.txt"', text)
        self.assertIn('"hooks.json"', text)
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertEqual(ci.count("fingerprint_install_tree.py"), 6)
        self.assertEqual(ci.count("--seed"), 2)

    def test_cross_platform_provenance_and_rollback_harnesses_are_real(self) -> None:
        attributes = (ROOT / ".gitattributes").read_text(encoding="utf-8")
        self.assertIn("*.cs text eol=lf", attributes)
        rollback = (ROOT / "tools" / "test_clean_rollback.sh").read_text(encoding="utf-8")
        self.assertIn('bash "$repo_dir/install.sh"', rollback)
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("$global:LASTEXITCODE = 0", ci)

    def test_uninstall_revokes_only_exact_owned_trust_before_removal(self) -> None:
        revoker = ROOT / "codex" / "hooks" / "revoke-trust.js"
        self.assertTrue(revoker.is_file())
        text = revoker.read_text(encoding="utf-8")
        for term in (
            "config/read",
            "hooks.state",
            "mergeStrategy: 'replace'",
            "selectOwned",
            "Foreign trust state changed",
            "locateDesktopCodex",
            "'OpenAI', 'Codex', 'bin'",
            "'codex app-server --listen stdio://'",
            "codexEnvironment",
            "CODEX_HOME: path.resolve(codexHome)",
        ):
            self.assertIn(term, text)
        self.assertNotIn('`"${executable}" app-server --listen stdio://`', text)
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("revoke-trust.js", ci)
        self.assertIn("uninstall/reinstall trust lifecycle", ci)
        self.assertIn("alternate-uninstall-home", ci)
        self.assertIn(".\\uninstall.ps1 -CodexHome $alternate", ci)

    def test_upgrade_matrix_uses_exact_historical_trees_and_expanded_mutations(self) -> None:
        matrix = (ROOT / "tools" / "test_upgrade_matrix.py").read_text(encoding="utf-8")
        for version, commit in {"1.6.1": "e1e22a2", "1.6.2": "89c5d0d", "1.6.3": "91c8d7f"}.items():
            self.assertIn(f'"{version}": "{commit}"', matrix)
        self.assertIn('git", "archive"', matrix)
        self.assertIn('installed_skill.read_bytes() == source_skill.read_bytes()', matrix)
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("fetch-depth: 0", ci)

        mutations = (ROOT / "tools" / "test_verifier_mutations.py").read_text(encoding="utf-8")
        for target in (
            "exact-turn isolation",
            "one-block circuit release",
            "post-block proof under stop_hook_active",
            "proof-debt clearing",
            "OFF propagation",
            "execution-token binding",
            "structured-result precedence",
            "opaque shell-write detection",
            "parent-child debt registration",
            "visible WARN delivery",
            "unknown-command classification",
        ):
            self.assertIn(target, mutations)

    def test_candidate_binary_has_a_source_bound_build_record(self) -> None:
        record = CANDIDATE.with_name("DevRigorHookActivator-1.7.0.build.json")
        self.assertTrue(record.is_file())
        data = json.loads(record.read_text(encoding="utf-8"))
        self.assertEqual(data["version"], "1.7.0")
        self.assertEqual(data["binary_sha256"], hashlib.sha256(CANDIDATE.read_bytes()).hexdigest())
        self.assertEqual(data["source_sha256"], hashlib.sha256(SOURCE.read_bytes()).hexdigest())
        self.assertIn("compiler_version", data)

    def test_ci_rebuilds_and_normalizes_only_compiler_identity_bytes(self) -> None:
        self.assertTrue(BINARY_EQUIVALENCE.is_file())
        verifier = BINARY_EQUIVALENCE.read_text(encoding="utf-8")
        for term in ("ModuleVersionId", "PE timestamp", "byte-identical after normalizing"):
            self.assertIn(term, verifier)
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("-RunIntegrationTest", ci)
        self.assertIn("verify-binary-equivalence.ps1", ci)

    def test_gui_has_keyboard_and_accessible_security_review_path(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        for term in (
            "_grid.StandardTab = true",
            "ProcessDialogKey",
            "ProcessDataGridViewKey",
            "ProcessCmdKey",
            "WmKeyDown",
            "NextTabControl",
            "KeyboardReviewControl",
            "_grid.AccessibleName",
            "row.AccessibilityObject.Name",
            "Selected hook details",
            "Keyboard hook review selector",
            "_grid.TabStop = false",
            "_close.Enabled = !busy",
        ):
            self.assertIn(term, text)

    def test_candidate_binary_and_checksum_match_off_pages(self) -> None:
        self.assertTrue(CANDIDATE.is_file(), "candidate activator executable is missing")
        digest = hashlib.sha256(CANDIDATE.read_bytes()).hexdigest()
        checksum = CANDIDATE.with_suffix(CANDIDATE.suffix + ".sha256").read_text(encoding="ascii")
        self.assertEqual(checksum.strip(), f"{digest}  {CANDIDATE.name}")

    def test_candidate_executable_has_windows_gui_subsystem(self) -> None:
        data = CANDIDATE.read_bytes()
        self.assertEqual(data[:2], b"MZ")
        pe_offset = int.from_bytes(data[0x3C:0x40], "little")
        self.assertEqual(data[pe_offset:pe_offset + 4], b"PE\0\0")
        optional_header = pe_offset + 24
        subsystem = int.from_bytes(data[optional_header + 68:optional_header + 70], "little")
        self.assertEqual(subsystem, 2, "executable must use the Windows GUI subsystem")

    def test_candidate_source_is_the_exact_build_source(self) -> None:
        published = CANDIDATE.with_name("DevRigorHookActivator-1.7.0.cs")
        self.assertEqual(published.read_bytes(), SOURCE.read_bytes())


if __name__ == "__main__":
    unittest.main(verbosity=2)
