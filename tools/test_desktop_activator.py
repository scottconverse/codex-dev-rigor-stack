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
BINARY_EQUIVALENCE = ROOT / "desktop" / "verify-binary-equivalence.ps1"
DOWNLOAD = ROOT / "docs" / "downloads" / "DevRigorHookActivator-1.6.1.exe"


class DesktopActivatorContractTests(unittest.TestCase):
    def test_version_is_monotonic_desktop_hotfix(self) -> None:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "1.6.1")
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
            "postToolUse",
            "stop",
            "subagentStop",
        ):
            self.assertIn(event, text)
        self.assertIn("ExpectedHookCount = 6", text)
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
        self.assertIn("Review and trust these 6 hooks", text)
        self.assertIn("Alt+T", text)
        self.assertIn("HookReviewDialog", text)
        self.assertIn("Exact six-hook review details", text)
        self.assertIn("AcceptButton = cancel", text)
        self.assertIn("No terminal is required", text)
        self.assertIn("RefreshAndVerify", text)
        self.assertNotIn("--auto-trust", text)

    def test_windows_build_is_a_gui_executable(self) -> None:
        text = BUILD.read_text(encoding="utf-8")
        self.assertIn("/target:winexe", text)
        self.assertIn("DevRigorHookActivator.exe", text)
        self.assertIn("System.Windows.Forms.dll", text)

    def test_every_executable_version_surface_is_1_6_1(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")
        for declaration in (
            'AssemblyVersion("1.6.1.0")',
            'AssemblyFileVersion("1.6.1.0")',
            'AssemblyInformationalVersion("1.6.1")',
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
        ):
            self.assertIn(term, text)
        self.assertNotIn('`"${executable}" app-server --listen stdio://`', text)
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("revoke-trust.js", ci)
        self.assertIn("uninstall/reinstall trust lifecycle", ci)

    def test_published_binary_has_a_source_bound_build_record(self) -> None:
        record = DOWNLOAD.with_name("DevRigorHookActivator-1.6.1.build.json")
        self.assertTrue(record.is_file())
        data = json.loads(record.read_text(encoding="utf-8"))
        self.assertEqual(data["version"], "1.6.1")
        self.assertEqual(data["binary_sha256"], hashlib.sha256(DOWNLOAD.read_bytes()).hexdigest())
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

    def test_landing_download_and_checksum_match_published_executable(self) -> None:
        landing = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="downloads/DevRigorHookActivator-1.6.1.exe"', landing)
        self.assertTrue(DOWNLOAD.is_file(), "published activator executable is missing")
        digest = hashlib.sha256(DOWNLOAD.read_bytes()).hexdigest()
        checksum = DOWNLOAD.with_suffix(DOWNLOAD.suffix + ".sha256").read_text(encoding="ascii")
        self.assertEqual(checksum.strip(), f"{digest}  {DOWNLOAD.name}")

    def test_published_executable_has_windows_gui_subsystem(self) -> None:
        data = DOWNLOAD.read_bytes()
        self.assertEqual(data[:2], b"MZ")
        pe_offset = int.from_bytes(data[0x3C:0x40], "little")
        self.assertEqual(data[pe_offset:pe_offset + 4], b"PE\0\0")
        optional_header = pe_offset + 24
        subsystem = int.from_bytes(data[optional_header + 68:optional_header + 70], "little")
        self.assertEqual(subsystem, 2, "executable must use the Windows GUI subsystem")

    def test_published_source_is_the_exact_build_source(self) -> None:
        published = DOWNLOAD.with_name("DevRigorHookActivator-1.6.1.cs")
        self.assertEqual(published.read_bytes(), SOURCE.read_bytes())


if __name__ == "__main__":
    unittest.main(verbosity=2)
