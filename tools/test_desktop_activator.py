#!/usr/bin/env python3
"""Regression contracts for the no-terminal Codex Desktop hook activator."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "desktop" / "DevRigorHookActivator.cs"
BUILD = ROOT / "desktop" / "build.ps1"
OWNERSHIP_TEST = ROOT / "desktop" / "OwnershipSelfTest.cs"
INTEGRATION_TEST = ROOT / "desktop" / "ActivatorIntegrationSelfTest.cs"
UI_TEST = ROOT / "desktop" / "ActivatorUiSelfTest.cs"
LIVE_TEST = ROOT / "desktop" / "test-live-hook-lifecycle.js"
LIVE_SUPPORT = ROOT / "desktop" / "live-hook-lifecycle-support.js"
LIVE_SUPPORT_TEST = ROOT / "desktop" / "test-live-hook-lifecycle-support.js"
LIFECYCLE_ORACLE = ROOT / "codex" / "hooks" / "test-lifecycle-oracle.js"
BINARY_EQUIVALENCE = ROOT / "desktop" / "verify-binary-equivalence.ps1"
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
        self.assertIn("local ignored review build", architecture)
        self.assertIn("explicit owner go/no-go", architecture)
        self.assertIn("GO only", architecture)

        installable_suffixes = {".exe", ".msi", ".msix", ".appx", ".zip", ".dmg", ".pkg", ".deb", ".rpm"}
        public_candidates = [ROOT / "docs", ROOT / "candidate-artifacts"]
        exposed = [
            str(path.relative_to(ROOT))
            for surface in public_candidates if surface.exists()
            for path in surface.rglob("*") if path.is_file() and path.suffix.lower() in installable_suffixes
        ]
        self.assertEqual(exposed, [], f"review-hold installable artifacts remain publicly fetchable: {exposed}")

        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertNotIn("desktop_hook_activator_candidate", manifest["codex"])

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
        self.assertTrue(LIVE_SUPPORT.is_file())
        self.assertTrue(LIVE_SUPPORT_TEST.is_file())
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
            "task.unresolved",
            "conversationTurnId",
            "runInstalledHook",
            "assertLifecycleIsolation",
            "assertCandidateInstallation",
            "assertExactTrustedHooks",
            "hookBinding = assertExactTrustedHooks(message)",
            "DEV_RIGOR_ACTIVE_CODEX_HOME",
            "directHookTimeout",
            "return mode === 'snapshot' || mode === 'record' || mode === 'check' ? 15000 : 5000;",
            "seedUnprovedTurn",
            "unprovedStopBaseline",
            "firstCommands",
            "reportCommands",
            "real app-server Stop/retry path",
            "app-server Stop hooks did not deliver exactly K/U",
            "finalReports.length !== 1",
            "reportDeltaByItem",
            "finalReport.phase !== 'final_answer'",
            "startTurn(7, 'DevRigorSTATUS'",
            "statusTurnId",
            "statusProjection = parseFinalJson(statusMessages, 'DevRigorSTATUS').value",
            "newDebt.status !== 'unresolved'",
            "exactDirtyEdits",
            "if (!exactDirtyEdits)",
            "task.checkpoint !== unprovedCheckpointBaseline",
            "task.proofs.length !== unprovedProofBaseline",
            "task.delivery.stop !== unprovedStopBaseline + 2",
            "if (!finalDeltas || finalDeltas.split('REPORT_STAYS_VISIBLE').length - 1 !== 1)",
            "if (totalStreamedReportCount !== 1)",
            "['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop']",
            "conversation ledger recorded K/U",
            "model one-block ledger is not E/K/U/no-C",
            "work directory must exist and be empty",
            "execFileSync('git', ['init', '--quiet', cwd]",
            "sandbox: 'workspace-write'",
            "decision: 'decline'",
            "Unexpected app-server approval request",
            "redactedTaskProjection",
            "boundedRedactedAppend",
            "shutdownAppServer('success')",
            "shutdownAppServer('failure')",
            "shutdownAppServer('timeout')",
        ):
            self.assertIn(term, text)
        self.assertNotIn("danger-full-access", text)
        self.assertNotIn("decision: 'accept'", text)
        self.assertNotIn("verifyDeterministicStateMachine", text)
        self.assertNotIn("['check'], {", text)
        self.assertEqual(text.count("runInstalledHook("), 2, "live harness may directly invoke only its one edit seed")

    def test_live_lifecycle_support_has_executable_safety_regressions(self) -> None:
        result = subprocess.run(
            ["node", str(LIVE_SUPPORT_TEST)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("LIFECYCLE_SUPPORT_PASS", result.stdout)

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
        self.assertIn('"$repo_dir/install.sh"', rollback)
        self.assertNotIn('bash "$repo_dir/install.sh"', rollback)
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
            "includeLayers: true",
            "expectedVersion: version",
            "configVersionConflict",
            "MAX_CAS_ATTEMPTS",
            "selectOwned",
            "Foreign trust state changed",
            "locateDesktopCodex",
            "'OpenAI', 'Codex', 'bin'",
            "'codex app-server --listen stdio://'",
            "codexEnvironment",
            "CODEX_HOME: path.resolve(codexHome)",
        ):
            self.assertIn(term, text)
        self.assertNotIn("expectedVersion: null", text)
        self.assertNotIn('`"${executable}" app-server --listen stdio://`', text)
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("revoke-trust.js", ci)
        self.assertIn("uninstall/reinstall trust lifecycle", ci)
        self.assertIn("alternate-uninstall-home", ci)
        self.assertIn(".\\uninstall.ps1 -CodexHome $alternate", ci)

    def test_ci_runs_deterministic_unauthenticated_lifecycle_oracle(self) -> None:
        self.assertTrue(LIFECYCLE_ORACLE.is_file())
        text = LIFECYCLE_ORACLE.read_text(encoding="utf-8")
        for term in (
            "LIFECYCLE_ORACLE_PASS",
            "long proved report",
            "missing-receipt",
            "released-unproved",
            "later unrelated conversation",
            "exact indebted edit set",
            "proof-accepted",
            "updatedInput.command",
            "powershell.exe",
            "bash",
            "tool_response: execution.stdout",
            "mode === 'snapshot' || mode === 'record' || mode === 'check' ? 15000 : 5000",
            "{ E: 2, T: 0, W: 1, C: 2, K: 1, U: 1, G: 0, I: 0, F: 0, R: 2, B: 0 }",
        ):
            self.assertIn(term, text)
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("node codex/hooks/test-lifecycle-oracle.js", ci)
        self.assertIn("node codex/hooks/test-recovery.js", ci)
        self.assertIn("node desktop/test-live-hook-lifecycle-support.js", ci)
        mutations = (ROOT / "tools" / "test_verifier_mutations.py").read_text(encoding="utf-8")
        self.assertIn("timeout=90", mutations)
        self.assertIn("subprocess.TimeoutExpired", mutations)

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
            "structured zero-test rejection",
            "opaque shell-write detection",
            "parent-child debt registration",
            "visible WARN delivery",
            "unknown-command classification",
            "task-state transaction lock",
            "all-extension worktree asset tracking",
            "all-extension direct-edit tracking",
            "nested edit-path extraction",
            "notebook edit-path extraction",
            "edit-response changed-path extraction",
            "pathless edit fail-safe",
            "HEAD and tree transition comparison",
            "symbolic and detached ref comparison",
            "index tree and status comparison",
            "unavailable comparison fail-safe",
            "association task transaction lock",
            "immutable parent association",
            "association-conflict debt persistence",
            "unbound-subagent association debt persistence",
            "exact task route-state identity",
            "activation recursive parent mode",
            "router recursive parent mode",
            "association edge-registry union",
            "recursive association debt aggregation",
            "unresolved durable-state retention",
            "information-only command guard",
            "exact executable and composition classification",
            "single-command composition guard",
            "exact interactive-tool action classification",
            "deterministic lifecycle accepted-checkpoint oracle",
            "exact-task recovery isolation",
            "persisted association repair transaction",
            "persisted mechanical repair transaction",
            "association failure occurrence identity",
            "mechanical failure occurrence identity",
            "exact-task repair transaction lock",
            "association recovery code allowlist",
            "authoritative association edge presence",
            "malformed association namespace visibility",
            "malformed recovery transaction visibility",
            "owner-control recovery postcondition",
            "generic mechanical failure nonrepairability",
            "locked parent projection presence",
            "top-level association namespace visibility",
            "missing exact-root task fail-open",
            "critical task-shape validation",
            "strict association edge schema",
            "malformed mechanical record visibility",
            "nested subagent debt reminder",
        ):
            self.assertIn(target, mutations)

    def test_review_build_stays_local_and_publish_requires_release_authorization(self) -> None:
        build = BUILD.read_text(encoding="utf-8")
        for term in (
            "release-state.json",
            "publication_authorized",
            "Refusing to publish",
            "desktop/dist/",
        ):
            self.assertIn(term, build)
        ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("candidate-artifacts/", ignore)

    def test_build_refuses_a_publish_directory_while_release_is_unauthorized(self) -> None:
        shell = shutil.which("pwsh") or shutil.which("powershell")
        if not shell:
            self.skipTest("PowerShell is unavailable")
        with tempfile.TemporaryDirectory(prefix="dev-rigor-publish-hold-") as temporary:
            target = Path(temporary) / "public"
            result = subprocess.run(
                [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(BUILD), "-PublishDirectory", str(target)],
                cwd=ROOT, capture_output=True, text=True, timeout=30, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Refusing to publish", result.stdout + result.stderr)
            self.assertFalse(target.exists(), "unauthorized publish created a public artifact directory")

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

    def test_build_verifies_the_generated_executable_is_windows_gui(self) -> None:
        build = BUILD.read_text(encoding="utf-8")
        self.assertIn("Windows GUI subsystem", build)
        self.assertIn("ReadAllBytes", build)


if __name__ == "__main__":
    unittest.main(verbosity=2)
