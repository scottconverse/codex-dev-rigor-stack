#!/usr/bin/env python3
"""Prove the release verifiers detect representative product mutations."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def run(root: Path, command: list[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, cwd=root, text=True, capture_output=True, env=env, timeout=90)
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout.decode() if isinstance(error.stdout, bytes) else error.stdout or ""
        stderr = error.stderr.decode() if isinstance(error.stderr, bytes) else error.stderr or ""
        return subprocess.CompletedProcess(command, 124, stdout, stderr + "\nVERIFIER TIMEOUT after 90 seconds\n")


def require_red(result: subprocess.CompletedProcess[str], diagnostic: str, label: str) -> None:
    combined = result.stdout + result.stderr
    if result.returncode == 0:
        raise AssertionError(f"{label} mutation survived its verifier")
    if diagnostic.lower() not in combined.lower():
        raise AssertionError(f"{label} verifier went red without the expected diagnostic {diagnostic!r}:\n{combined}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-verifier-mutations-") as temporary:
        copy = Path(temporary) / "repo"
        shutil.copytree(
            ROOT,
            copy,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "dist", ".pytest_cache"),
        )

        ground = copy / "codex" / "hooks" / "dev-rigor-ground.js"
        activate = copy / "codex" / "hooks" / "dev-rigor-activate.js"
        router = copy / "codex" / "hooks" / "dev-rigor-router.js"
        live = copy / "desktop" / "test-live-hook-lifecycle.js"
        live_support = copy / "desktop" / "live-hook-lifecycle-support.js"
        transaction = copy / "codex" / "install-transaction.js"
        original_ground = ground.read_text(encoding="utf-8")
        original_activate = activate.read_text(encoding="utf-8")
        original_router = router.read_text(encoding="utf-8")
        original_live = live.read_text(encoding="utf-8")
        original_live_support = live_support.read_text(encoding="utf-8")
        original_transaction = transaction.read_text(encoding="utf-8")
        mutation_scope = os.environ.get("DEV_RIGOR_MUTATION_SCOPE", "").strip().lower()
        mutation_labels: list[str] = []

        def verifier_mutation(
            file: Path,
            original: str,
            needle: str,
            replacement: str,
            command: list[str],
            diagnostic: str,
            label: str,
            *,
            env: dict[str, str] | None = None,
            extra_replacements: tuple[tuple[str, str], ...] = (),
        ) -> None:
            if mutation_scope == "installer" and file != transaction:
                return
            mutated = original
            for target, substitute in ((needle, replacement), *extra_replacements):
                if mutated.count(target) != 1:
                    raise AssertionError(f"{label} mutation target is no longer unique: {target!r}")
                mutated = mutated.replace(target, substitute)
            file.write_text(mutated, encoding="utf-8")
            try:
                require_red(run(copy, command, env=env), diagnostic, label)
                mutation_labels.append(label)
            finally:
                file.write_text(original, encoding="utf-8")

        def hook_mutation(
            file: Path,
            original: str,
            needle: str,
            replacement: str,
            diagnostic: str,
            label: str,
        ) -> None:
            verifier_mutation(
                file,
                original,
                needle,
                replacement,
                ["node", "codex/hooks/test-hooks.js"],
                diagnostic,
                label,
                env={**os.environ, "DEV_RIGOR_TEST_FILTER": diagnostic},
            )

        def installer_mutation(
            needle: str,
            replacement: str,
            diagnostic: str,
            label: str,
            group: str,
            *,
            extra_replacements: tuple[tuple[str, str], ...] = (),
        ) -> None:
            verifier_mutation(
                transaction,
                original_transaction,
                needle,
                replacement,
                ["node", "codex/install-transaction.test.js"],
                diagnostic,
                label,
                env={**os.environ, "DEV_RIGOR_INSTALL_TEST_FILTER": group},
                extra_replacements=extra_replacements,
            )

        def hook_mutation_many(
            file: Path,
            original: str,
            replacements: tuple[tuple[str, str], ...],
            diagnostic: str,
            label: str,
        ) -> None:
            if not replacements:
                raise AssertionError(f"{label} has no mutation replacements")
            first, *remaining = replacements
            verifier_mutation(
                file,
                original,
                first[0],
                first[1],
                ["node", "codex/hooks/test-hooks.js"],
                diagnostic,
                label,
                env={**os.environ, "DEV_RIGOR_TEST_FILTER": diagnostic},
                extra_replacements=tuple(remaining),
            )

        def two_file_hook_mutation(
            first_file: Path,
            first_original: str,
            first_needle: str,
            first_replacement: str,
            second_file: Path,
            second_original: str,
            second_needle: str,
            second_replacement: str,
            diagnostic: str,
            label: str,
        ) -> None:
            if mutation_scope == "installer":
                return
            if first_original.count(first_needle) != 1 or second_original.count(second_needle) != 1:
                raise AssertionError(f"{label} mutation targets are no longer unique")
            first_file.write_text(first_original.replace(first_needle, first_replacement), encoding="utf-8")
            second_file.write_text(second_original.replace(second_needle, second_replacement), encoding="utf-8")
            try:
                require_red(
                    run(copy, ["node", "codex/hooks/test-hooks.js"], env={**os.environ, "DEV_RIGOR_TEST_FILTER": diagnostic}),
                    diagnostic,
                    label,
                )
                mutation_labels.append(label)
            finally:
                first_file.write_text(first_original, encoding="utf-8")
                second_file.write_text(second_original, encoding="utf-8")

        hook_mutation(
            ground, original_ground,
            "if (lastProof < lastEdit) {", "if (false && lastProof < lastEdit) {",
            "apply_patch runnable edit without a later execution blocks Stop", "substantive Stop gate",
        )
        hook_mutation(
            ground, original_ground,
            "return path.join(stateDir, `ground-v4-${hash(session, turn)}.log`);",
            "return path.join(stateDir, `ground-v4-${hash(session)}.log`);",
            "a distinct Codex turn passes even when an older turn remains unresolved", "exact-turn isolation",
        )
        hook_mutation(
            ground,
            original_ground,
            "  try { return withTaskLock(session, callback); }",
            "  try { return callback(); }",
            "concurrent edit observations retain the exact dirty and debt edit sets",
            "task-state transaction lock",
        )
        hook_mutation(
            ground, original_ground,
            "if (lastRelease >= lastBlock) return;", "if (false && lastRelease >= lastBlock) return;",
            "the same turn is blocked at most once when Codex omits stop_hook_active", "one-block circuit release",
        )
        verifier_mutation(
            ground,
            original_ground,
            "    if (!append(session, turn, `C proof-accepted proof-id:${proof.token} checkpoint:${proof.checkpoint}`)) {",
            "    if (!append(session, turn, `W proof-accepted proof-id:${proof.token} checkpoint:${proof.checkpoint}`)) {",
            ["node", "codex/hooks/test-lifecycle-oracle.js"],
            "accepted proof checkpoint was not recorded",
            "deterministic lifecycle accepted-checkpoint oracle",
        )
        verifier_mutation(
            live_support,
            original_live_support,
            "    if (expected.get(name) !== actual.get(name)) {",
            "    if (false && expected.get(name) !== actual.get(name)) {",
            ["node", "desktop/test-live-hook-lifecycle-support.js"],
            "Missing expected exception",
            "authenticated lifecycle exact-candidate hash binding",
        )
        verifier_mutation(
            live_support,
            original_live_support,
            "    if (pathsOverlap(target, active)) {",
            "    if (false && pathsOverlap(target, active)) {",
            ["node", "desktop/test-live-hook-lifecycle-support.js"],
            "Missing expected exception",
            "authenticated lifecycle active-profile containment",
        )
        live_contract = [
            sys.executable,
            "-m",
            "unittest",
            "tools.test_desktop_activator.DesktopActivatorContractTests.test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
        ]
        verifier_mutation(
            live,
            original_live,
            "      try { hookBinding = assertExactTrustedHooks(message); } catch (error) { fail(error); return; }",
            "      hookBinding = {};",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated hooks/list candidate binding",
        )
        verifier_mutation(
            live,
            original_live,
            "        try { statusProjection = parseFinalJson(statusMessages, 'DevRigorSTATUS').value; }",
            "        try { statusProjection = {}; }",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated DevRigorSTATUS delivery",
        )
        verifier_mutation(
            live,
            original_live,
            "  if (!finalDeltas || finalDeltas.split('REPORT_STAYS_VISIBLE').length - 1 !== 1) {",
            "  if (false) {",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated required final-report deltas",
        )
        verifier_mutation(
            live,
            original_live,
            "  if (!exactDirtyEdits) {",
            "  if (false) {",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated exact dirty-edit state",
        )
        verifier_mutation(
            live,
            original_live,
            "  if (task.checkpoint !== unprovedCheckpointBaseline || task.proofs.length !== unprovedProofBaseline) {",
            "  if (false) {",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated unproved checkpoint and proof invariance",
        )
        verifier_mutation(
            live,
            original_live,
            "  if (!task.delivery || task.delivery.stop !== unprovedStopBaseline + 2) {",
            "  if (false) {",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated exact two-Stop delivery",
        )
        verifier_mutation(
            live,
            original_live,
            "    const expectedTimeout = ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'].includes(expected.event) ? 15 : 5;",
            "    const expectedTimeout = ['PreToolUse', 'PostToolUse'].includes(expected.event) ? 15 : 5;",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated production timeout parity",
        )
        verifier_mutation(
            live,
            original_live,
            "        cwd, approvalPolicy: 'never', sandbox: 'workspace-write', ephemeral: true,",
            "        cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: true,",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated workspace-only sandbox",
        )
        verifier_mutation(
            live,
            original_live,
            "        send({ id: message.id, result: { decision: 'decline' } });",
            "        send({ id: message.id, result: { decision: 'accept' } });",
            live_contract,
            "test_authenticated_live_lifecycle_harness_exercises_retry_and_conversation",
            "authenticated approval refusal",
        )
        hook_mutation(
            ground, original_ground,
            "    if (lastBlock >= 0 && lastProof < lastEdit) {", "    if (lastBlock >= 0) {",
            "proof after a block can resolve the current turn without a second block", "post-block proof under stop_hook_active",
        )
        hook_mutation(
            ground, original_ground,
            "  task.unresolved = task.unresolved.filter((debt) =>\n"
            "    !Array.isArray(debt.edits) || !debt.edits.every((edit) => accepted.has(edit))\n"
            "  );",
            "  task.unresolved = task.unresolved.filter(() => true);",
            "proof resolves debt only for the same or a verified superseding edit set", "proof-debt clearing",
        )
        hook_mutation(
            ground, original_ground,
            "  const inherited = effectiveMode(taskByKey(task.parentKey), visited);",
            "  const inherited = 'ON';",
            "bound subagent inherits live parent controls including later OFF", "OFF propagation",
        )
        hook_mutation(
            ground, original_ground,
            "    executionHash, descriptorHash, checkpoint, result: 'pass',", "    descriptorHash, checkpoint, result: 'pass',",
            "evidence tokens bind the exact execution fingerprint and target checkpoint", "execution-token binding",
        )
        hook_mutation(
            ground, original_ground,
            "if (structured.found) return structured.passed && !structured.failed;",
            "if (false && structured.found) return structured.passed && !structured.failed;",
            "structured failing test result outranks process exit zero", "structured-result precedence",
        )
        hook_mutation(
            ground, original_ground,
            "        if (numericPassed > 0) seen.passed = true;",
            "        if (numericPassed >= 0) seen.passed = true;",
            "structured zero-test metadata cannot satisfy substantive proof", "structured zero-test rejection",
        )
        hook_mutation(
            ground, original_ground,
            "const observed = isEdit ? null : worktreeChanges(before, after, cwd, observationDeadline);",
            "const observed = isEdit ? null : { available: true, items: [], repositoryChanged: false };",
            "PreToolUse/PostToolUse detects an opaque shell write to a tracked source file", "opaque shell-write detection",
        )
        hook_mutation(
            ground,
            original_ground,
            "    for (const item of observedPaths.values()) {",
            "    for (const item of observedPaths.values()) {\n      if (!/\\.(?:js|ts)$/i.test(item.name)) continue;",
            "direct and opaque edits track binary, image, font, document, archive, and extensionless assets",
            "all-extension worktree asset tracking",
        )
        hook_mutation(
            ground,
            original_ground,
            "          for (const file of paths) { noteWrite(recordEdit(session, turn, task, 'E', file, cwd)); changed = true; }",
            "          for (const file of paths) { if (/\\.(?:js|ts)$/i.test(file)) { noteWrite(recordEdit(session, turn, task, 'E', file, cwd)); changed = true; } }",
            "direct and opaque edits track binary, image, font, document, archive, and extensionless assets",
            "all-extension direct-edit tracking",
        )
        hook_mutation(
            ground,
            original_ground,
            "    } else if (child && typeof child === 'object') editedPaths(child, found);",
            "    } else if (false && child && typeof child === 'object') editedPaths(child, found);",
            "nested edit-tool paths, response paths, and missing paths fail safely",
            "nested edit-path extraction",
        )
        hook_mutation(
            ground,
            original_ground,
            "/^(?:file_path|path|notebook_path|notebookPath)$/",
            "/^(?:file_path|path)$/",
            "nested edit-tool paths, response paths, and missing paths fail safely",
            "notebook edit-path extraction",
        )
        hook_mutation(
            ground,
            original_ground,
            "        const paths = new Set([...editedPaths(payload.tool_input), ...changedPaths(payload.tool_response)]);",
            "        const paths = new Set(editedPaths(payload.tool_input));",
            "nested edit-tool paths, response paths, and missing paths fail safely",
            "edit-response changed-path extraction",
        )
        hook_mutation(
            ground,
            original_ground,
            "        if (paths.size === 0) {",
            "        if (false && paths.size === 0) {",
            "nested edit-tool paths, response paths, and missing paths fail safely",
            "pathless edit fail-safe",
        )
        hook_mutation_many(
            ground,
            original_ground,
            (
                (
                    "  for (const [priorTree, nextTree] of [[before.headTree, after.headTree], [before.indexTree, after.indexTree]]) {",
                    "  for (const [priorTree, nextTree] of []) {",
                ),
                (
                    "  const repositoryChanged = ['headState', 'head', 'headTree', 'refKind', 'refHash', 'indexTree', 'indexHash']",
                    "  const repositoryChanged = ['refKind', 'refHash']",
                ),
            ),
            "clean-to-clean commit, amend, branch switch, and detached HEAD transitions re-arm proof",
            "HEAD and tree transition comparison",
        )
        hook_mutation(
            ground,
            original_ground,
            "  const repositoryChanged = ['headState', 'head', 'headTree', 'refKind', 'refHash', 'indexTree', 'indexHash']",
            "  const repositoryChanged = ['headState', 'head', 'headTree', 'indexTree', 'indexHash']",
            "repository identity-only and index-only transitions re-arm proof",
            "symbolic and detached ref comparison",
        )
        hook_mutation_many(
            ground,
            original_ground,
            (
                (
                    "  for (const [priorTree, nextTree] of [[before.headTree, after.headTree], [before.indexTree, after.indexTree]]) {",
                    "  for (const [priorTree, nextTree] of [[before.headTree, after.headTree]]) {",
                ),
                (
                    "  const repositoryChanged = ['headState', 'head', 'headTree', 'refKind', 'refHash', 'indexTree', 'indexHash']",
                    "  const repositoryChanged = ['headState', 'head', 'headTree', 'refKind', 'refHash']",
                ),
                (
                    "  const unexplainedStatusChange = before.statusHash !== after.statusHash && items.size === 0;",
                    "  const unexplainedStatusChange = false && before.statusHash !== after.statusHash && items.size === 0;",
                ),
            ),
            "repository identity-only and index-only transitions re-arm proof",
            "index tree and status comparison",
        )
        hook_mutation(
            ground,
            original_ground,
            "  if (!validation.available) return validation;",
            "  if (!validation.available) return { available: true, items: [], repositoryChanged: false };",
            "unavailable repository comparison records visible mechanical debt instead of proof",
            "unavailable comparison fail-safe",
        )
        hook_mutation(
            ground,
            original_ground,
            "      if (!observedPaths.has(name)) observedPaths.set(name, { name, status: metadata.hidden ? 'hidden-index' : 'tracked' });",
            "      if (!metadata.hidden && !observedPaths.has(name)) observedPaths.set(name, { name, status: 'tracked' });",
            "pre-existing hidden index paths remain content-observable",
            "pre-existing hidden-index content observation",
        )
        hook_mutation(
            ground,
            original_ground,
            "    } else if (item.gitlink && stat.isDirectory()) {",
            "    } else if (false && item.gitlink && stat.isDirectory()) {",
            "an already-dirty submodule cannot change commits invisibly",
            "dirty submodule identity and content observation",
        )
        hook_mutation(
            ground,
            original_ground,
            "    const observed = isEdit ? null : worktreeChanges(before, after, cwd, observationDeadline);",
            "    const observed = isEdit ? null : worktreeChanges(before, after, cwd, Date.now() + SNAPSHOT_BUDGET_MS);",
            "PostToolUse repository observation has one bounded deadline and fails safe",
            "shared PostToolUse repository-observation deadline",
        )
        hook_mutation(
            ground,
            original_ground,
            "const POST_OBSERVATION_BUDGET_MS = 5000;",
            "const POST_OBSERVATION_BUDGET_MS = 14000;",
            "PostToolUse repository observation has one bounded deadline and fails safe",
            "PostToolUse lock and persistence safety margin",
        )
        verifier_mutation(
            activate,
            original_activate,
            "  try { lock = acquireTaskLock(key); } catch (_) { /* recorded below */ }",
            "  lock = { target: '' };",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "association: 32 concurrent child starts retain every edge and every child debt",
            "association task transaction lock",
        )
        verifier_mutation(
            activate,
            original_activate,
            "        if (!writeAssociationEdge(parentKey, key)) {",
            "        if (false && !writeAssociationEdge(parentKey, key)) {",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "association: 32 concurrent child starts retain every edge and every child debt",
            "parent-child debt registration",
        )
        verifier_mutation(
            activate,
            original_activate,
            "          if (!parentTask.children.includes(key)) parentTask.children.push(key);",
            "          if (false && !parentTask.children.includes(key)) parentTask.children.push(key);",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "association: 32 concurrent child starts retain every edge and every child debt",
            "locked legacy child projection",
        )
        verifier_mutation(
            activate,
            original_activate,
            "        if (current.parentKey && current.parentKey !== parentKey) {",
            "        if (false && current.parentKey && current.parentKey !== parentKey) {",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "association: concurrent reparent attempts preserve one immutable parent and expose every conflict",
            "immutable parent association",
        )
        verifier_mutation(
            activate,
            original_activate,
            "        const debtId = writeAssociationDebt(parentKey, key, 'association-parent-conflict');",
            "        const debtId = hash(`${parentKey}\\0${key}\\0association-parent-conflict`).slice(0, 16);",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "association: concurrent reparent attempts preserve one immutable parent and expose every conflict",
            "association-conflict debt persistence",
        )
        verifier_mutation(
            activate,
            original_activate,
            "  const effective = effectiveModeByKey(key);",
            "  const effective = { mode: task.mode, warning: '' };",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "controls: OFF and WARN resolve recursively through nested descendants",
            "activation recursive parent mode",
        )
        verifier_mutation(
            activate,
            original_activate,
            "    else if (loaded.task.mode === 'WARN' && mode !== 'OFF') mode = 'WARN';",
            "    else if (false && loaded.task.mode === 'WARN' && mode !== 'OFF') mode = 'WARN';",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "controls: a descendant-local WARN remains effective beneath an ON root",
            "activation descendant-local WARN mode",
        )
        verifier_mutation(
            activate,
            original_activate,
            "        const unboundDebt = transaction.ok ? writeAssociationDebt(\n"
            "          task.parentKey || key, key, existing.status === 'missing-known' ? 'missing-child-state' : 'parent-unavailable'\n"
            "        ) : '';",
            "        const unboundDebt = transaction.ok ? hash(`${key}\\0parent-unavailable`).slice(0, 16) : '';",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "association: an unbound subagent remains visibly release-blocking in its own STATUS",
            "unbound-subagent association debt persistence",
        )
        two_file_hook_mutation(
            activate,
            original_activate,
            "path.join(stateDir, `router-v4-${hash(session)}.log`)",
            "path.join(stateDir, `router-${String(session).replace(/[^a-zA-Z0-9_-]/g, '')}.log`)",
            router,
            original_router,
            "path.join(stateDir, `router-v4-${hash(exactSession)}.log`)",
            "path.join(stateDir, `router-${String(exactSession).replace(/[^a-zA-Z0-9_-]/g, '')}.log`)",
            "router/activate: route state uses exact task identity and cannot collide after sanitization",
            "exact task route-state identity",
        )
        verifier_mutation(
            router,
            original_router,
            "    key = loaded.task.parentKey;",
            "    return { mode: loaded.task.mode, code: '' };",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "controls: OFF and WARN resolve recursively through nested descendants",
            "router recursive parent mode",
        )
        verifier_mutation(
            router,
            original_router,
            "    else if (loaded.task.mode === 'WARN' && mode !== 'OFF') mode = 'WARN';",
            "    else if (false && loaded.task.mode === 'WARN' && mode !== 'OFF') mode = 'WARN';",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "controls: a descendant-local WARN remains effective beneath an ON root",
            "router descendant-local WARN mode",
        )
        verifier_mutation(
            router,
            original_router,
            "  readAssociationEdges(relations, structuralDebts, rootKey);",
            "  // mutation: ignore the authoritative edge registry",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "association: 32 concurrent child starts retain every edge and every child debt",
            "association edge-registry union",
        )
        hook_mutation(
            router,
            original_router,
            "      walk(childKey, new Set([...ancestors, childKey]));",
            "      if (false) walk(childKey, new Set([...ancestors, childKey]));",
            "activate/router: 32 concurrent and nested authoritative children all remain release-visible",
            "recursive association debt aggregation",
        )
        verifier_mutation(
            router,
            original_router,
            "      for (const debt of child.unresolved) if (debt && typeof debt.id === 'string') summary.unresolved.add(debt.id);",
            "      if (false) for (const debt of child.unresolved) if (debt && typeof debt.id === 'string') summary.unresolved.add(debt.id);",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "association: 32 concurrent child starts retain every edge and every child debt",
            "associated unresolved-debt retention",
        )
        verifier_mutation(
            router,
            original_router,
            "      if ((!child.parentKey || typeof child.parentKey !== 'string') &&\n"
            "          (sources.has('edge') || sources.has('edge-corrupt') || sources.has('legacy'))) {",
            "      if (false && (!child.parentKey || typeof child.parentKey !== 'string') &&\n"
            "          (sources.has('edge') || sources.has('edge-corrupt') || sources.has('legacy'))) {",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "STATUS: an edge without the child parent binding remains association debt",
            "edge parent-binding debt",
        )
        verifier_mutation(
            router,
            original_router,
            "      // Durable task, proof, mechanical, and association state is never pruned by routing.",
            "      for (const name of fs.readdirSync(stateDir)) {\n"
            "        if (/^(?:task|mechanical|associations|association-debt)-v4-/.test(name) || name === 'associations-v4') {\n"
            "          fs.rmSync(path.join(stateDir, name), { recursive: true, force: true });\n"
            "        }\n"
            "      }",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "retention: routing never deletes unresolved task, mechanical, or association state",
            "unresolved durable-state retention",
        )
        verifier_mutation(
            router,
            original_router,
            "      if (marker.parentKey !== exactKey) continue;",
            "      if (marker.parentKey !== exactKey && marker.childKey !== exactKey) continue;",
            ["node", "codex/hooks/test-recovery.js"],
            "REPAIR: a child cannot resolve a normal marker owned by its parent task",
            "exact-task recovery isolation",
        )
        verifier_mutation(
            router,
            original_router,
            "        const transaction = recoveryTransaction(repairTask.task, actual.repairTaskKey,\n"
            "          actual.repairTransactionId, actual.repairTransactionDigest);",
            "        const transaction = recoveryTransaction(repairTask.task, actual.repairTaskKey,\n"
            "          actual.repairTransactionId, actual.repairTransactionDigest) || {\n"
            "            id: actual.repairTransactionId, digest: actual.repairTransactionDigest, associations: [{\n"
            "              id: marker.id, digest: marker.digest, parentKey: marker.parentKey,\n"
            "              childKey: marker.childKey, code: marker.code, occurrence: marker.occurrence,\n"
            "            }],\n"
            "          };",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: a resolution file without a persisted matching repair transaction is rejected",
            "persisted association repair transaction",
        )
        verifier_mutation(
            router,
            original_router,
            "        const transaction = recoveryTransaction(task, key, match[2], match[3]);",
            "        const transaction = recoveryTransaction(task, key, match[2], match[3]) || (record ? {\n"
            "          id: match[2], digest: match[3], mechanical: [{\n"
            "            id: record.id, ledgerId: record.ledgerId, occurrence: record.occurrence,\n"
            "            reason: record.reason, source: record.source, correlation: record.correlation,\n"
            "          }],\n"
            "        } : null);",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: a mechanical C without a persisted matching repair transaction is rejected",
            "persisted mechanical repair transaction",
        )
        verifier_mutation(
            activate,
            original_activate,
            "  } catch (_) { /* first marker in this namespace */ }\n"
            "  const occurrence = crypto.randomBytes(8).toString('hex');",
            "  } catch (_) { /* first marker in this namespace */ }\n"
            "  const occurrence = '0000000000000000';",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: a new association occurrence is not hidden by an older resolution",
            "association failure occurrence identity",
        )
        verifier_mutation(
            router,
            original_router,
            "function recordMechanicalDebt(key, code, correlation = '') {\n"
            "  const occurrence = crypto.randomBytes(8).toString('hex');",
            "function recordMechanicalDebt(key, code, correlation = '') {\n"
            "  const occurrence = '0000000000000000';",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: replaying an old mechanical C cannot clear a newer failure occurrence",
            "mechanical failure occurrence identity",
        )
        verifier_mutation(
            router,
            original_router,
            "function repairExactTask(session, key) {\n"
            "  let lock = null;\n"
            "  try { lock = acquireTaskLock(key); } catch (_) { /* visible failure below */ }",
            "function repairExactTask(session, key) {\n"
            "  let lock = { target: '' };",
            ["node", "codex/hooks/test-recovery.js"],
            "REPAIR: concurrent retries append one resolution for one occurrence",
            "exact-task repair transaction lock",
        )
        verifier_mutation(
            router,
            original_router,
            "        if (!ASSOCIATION_DEBT_CODES.has(marker.code)) {",
            "        if (false && !ASSOCIATION_DEBT_CODES.has(marker.code)) {",
            ["node", "codex/hooks/test-recovery.js"],
            "REPAIR: an unknown association code cannot be attested even when graph invariants match",
            "association recovery code allowlist",
        )
        verifier_mutation(
            router,
            original_router,
            "      if (!sources.has('edge') && !sources.has('edge-corrupt')) {",
            "      if (false && !sources.has('edge') && !sources.has('edge-corrupt')) {",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: deleting the immutable edge cannot be hidden by parent and child compatibility projections",
            "authoritative association edge presence",
        )
        verifier_mutation(
            router,
            original_router,
            "function readAssociationDebtMarkers(markers, structuralDebts, rootKey = '') {\n"
            "  let parents = [];",
            "function readAssociationDebtMarkers(markers, structuralDebts, rootKey = '') {\n"
            "  structuralDebts = new Map();\n"
            "  let parents = [];",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: malformed exact-task association namespace entries remain visible debt",
            "malformed association namespace visibility",
        )
        verifier_mutation(
            router,
            original_router,
            "      if (canonicalRecoveryTransaction(candidate, key)) return;",
            "      if (true || canonicalRecoveryTransaction(candidate, key)) return;",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: malformed unreferenced recovery transactions are visible and not repairable",
            "malformed recovery transaction visibility",
        )
        verifier_mutation(
            router,
            original_router,
            "    if (latestControl) task.mode = CONTROL_RECOVERY_OPERATIONS.get(latestControl.operation);",
            "    if (false && latestControl) task.mode = CONTROL_RECOVERY_OPERATIONS.get(latestControl.operation);",
            ["node", "codex/hooks/test-recovery.js"],
            "REPAIR: known router debt is resolved by one correlated task transaction and retry is idempotent",
            "owner-control recovery postcondition",
        )
        verifier_mutation(
            router,
            original_router,
            "  return { source, correlation, occurrence, repairable: false };",
            "  return { source, correlation, occurrence, repairable: true };",
            ["node", "codex/hooks/test-recovery.js"],
            "REPAIR: failure to persist the only association marker cannot be acknowledged away",
            "generic mechanical failure nonrepairability",
        )
        verifier_mutation(
            router,
            original_router,
            "      if (!sources.has('legacy')) {",
            "      if (false && !sources.has('legacy')) {",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: deleting the locked parent projection cannot be hidden by child binding and edge",
            "locked parent projection presence",
        )
        verifier_mutation(
            router,
            original_router,
            "    if (rootKey && fs.existsSync(associationDebtDir)) {",
            "    if (false && rootKey && fs.existsSync(associationDebtDir)) {",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: a corrupt top-level association namespace cannot erase known child debt",
            "top-level association namespace visibility",
        )
        verifier_mutation(
            router,
            original_router,
            "  task.mode = 'WARN';\n"
            "  const reason = loaded.status === 'corrupt' ? 'task-state-corrupt' : 'task-state-missing';",
            "  task.mode = 'ON';\n"
            "  const reason = loaded.status === 'corrupt' ? 'task-state-corrupt' : 'task-state-missing';",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: missing exact root task state fails open and cannot report a clean task",
            "missing exact-root task fail-open",
        )
        verifier_mutation(
            router,
            original_router,
            "    if (!validTaskShape(parsed, key) || !plainObject(genesis) || genesis.version !== 4 ||",
            "    if ((!parsed || parsed.version !== 4 || !/^(?:ON|WARN|OFF)$/.test(parsed.mode)) || !plainObject(genesis) || genesis.version !== 4 ||",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: malformed critical task fields are corruption, never normalized to clean defaults",
            "critical task-shape validation",
        )
        verifier_mutation(
            router,
            original_router,
            "        if (!edge || edge.version !== 4 || edge.parentKey !== parent.name || edge.childKey !== childKey ||\n"
            "            Object.keys(edge).sort().join(',') !== 'childKey,parentKey,version') throw new Error('mismatch');",
            "        if (!edge || edge.parentKey !== parent.name || edge.childKey !== childKey) throw new Error('mismatch');",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: wrong-version or extra-field association edges are corrupt debt",
            "strict association edge schema",
        )
        verifier_mutation(
            router,
            original_router,
            "      if (line.trim()) {",
            "      if (false && line.trim()) {",
            ["node", "codex/hooks/test-recovery.js"],
            "STATUS: malformed nonblank mechanical ledger records are visible corruption debt",
            "malformed mechanical record visibility",
        )
        verifier_mutation(
            router,
            original_router,
            "  if (graph && graph.unresolved.size) {",
            "  if (false && graph && graph.unresolved.size) {",
            ["node", "codex/hooks/test-association-concurrency.js"],
            "router: parent coding reminder includes nested subagent proof and mechanical debt",
            "nested subagent debt reminder",
            extra_replacements=((
                "  if (graph && graph.mechanical.size) {",
                "  if (false && graph && graph.mechanical.size) {",
            ),),
        )
        hook_mutation(
            ground,
            original_ground,
            "  const protectedState = /^(?:task(?:-genesis)?|association|association-debt|mechanical|evidence)-v4-/;",
            "  const protectedState = /^(?:task|association|association-debt|mechanical|evidence)-v4-/;",
            "retention preserves immutable task genesis under expiry and budget pressure",
            "immutable task-genesis retention",
        )
        hook_mutation(
            ground, original_ground,
            "  try { process.stdout.write(JSON.stringify(output)); } catch (_) { return; }",
            "  try { process.stdout.write(''); } catch (_) { return; }",
            "warnings are visible and unresolved debt is injected into the next coding turn", "visible WARN delivery",
        )
        hook_mutation(
            ground, original_ground,
            "  if (executable === 'tsc') return 'B';\n  return 'U';\n}",
            "  if (executable === 'tsc') return 'B';\n  return 'R';\n}",
            "harmless and unknown shell commands cannot satisfy substantive proof", "unknown-command classification",
        )
        hook_mutation(
            ground, original_ground,
            "if (informationOnly(executable, args)) return 'U';",
            "if (false && informationOnly(executable, args)) return 'U';",
            "version, help, eval, and keyword-shaped commands remain non-proof",
            "information-only command guard",
        )
        hook_mutation(
            ground, original_ground,
            "  const command = input && typeof input.command === 'string' ? input.command : '';\n",
            "  const command = input && typeof input.command === 'string' ? input.command : '';\n"
            "  if (/^\\s*(?:node|python|python3|ruby|php|java)\\b/i.test(command)) return 'R';\n",
            "version, help, eval, and keyword-shaped commands remain non-proof",
            "interpreter eval and metadata classification",
        )
        hook_mutation(
            ground, original_ground,
            "  const command = input && typeof input.command === 'string' ? input.command : '';\n",
            "  const command = input && typeof input.command === 'string' ? input.command : '';\n"
            "  if (/\\btest\\b/i.test(command)) return 'T';\n"
            "  if (/\\bbuild\\b/i.test(command)) return 'B';\n",
            "version, help, eval, and keyword-shaped commands remain non-proof",
            "exact executable and composition classification",
        )
        hook_mutation(
            ground, original_ground,
            "  if (/[;&|><`\\r\\n]/.test(command) || /\\$\\(|\\$\\{|%[^%\\r\\n]+%/.test(command)) return null;",
            "  if (false && (/[;&|><`\\r\\n]/.test(command) || /\\$\\(|\\$\\{|%[^%\\r\\n]+%/.test(command))) return null;",
            "version, help, eval, and keyword-shaped commands remain non-proof",
            "single-command composition guard",
        )
        hook_mutation(
            ground, original_ground,
            "  return interactionAction(tool, input) ? 'R' : 'U';",
            "  return /(?:navigate|snapshot)/i.test(tool) || interactionAction(tool, input) ? 'R' : 'U';",
            "version, help, eval, and keyword-shaped commands remain non-proof",
            "exact interactive-tool action classification",
        )

        installer_mutation(
            "  const values = { operation, backup: true, skipTrust: false };",
            "  const values = { operation, backup: false, skipTrust: false };",
            "default backup-bearing update did not record exactly one backup",
            "default backup-bearing update",
            "backups-v4",
        )
        installer_mutation(
            "      if (!entry[scope].present) continue;",
            "      if (true || !entry[scope].present) continue;",
            "owned backup parent survived clean uninstall",
            "exact owned backup deletion",
            "backups-v4",
        )
        installer_mutation(
            "marker.lineage !== ownership.lineage",
            "false && marker.lineage !== ownership.lineage",
            "modified backup preservation was not visible",
            "backup marker lineage binding",
            "backups-v4",
        )
        installer_mutation(
            "  return treeDigest(directory, true) === scopeRecord.digest;",
            "  return true;",
            "backup digest mismatch preservation was not visible",
            "backup content digest verification",
            "backups-v4",
        )
        installer_mutation(
            "  if (ownership.created.skillsDirectory) removeEmpty(active.target);",
            "  if (false && ownership.created.skillsDirectory) removeEmpty(active.target);",
            "owned empty skills directory survived",
            "owned origin cleanup",
            "ownership-foreign",
        )
        installer_mutation(
            "  if (!hookSnapshotEqual(hookSnapshot(active.hooks), journal.hooksBefore)) {\n"
            "    throw new TransactionError('CAS', 'hooks.json changed concurrently before commit');\n"
            "  }",
            "  if (false && !hookSnapshotEqual(hookSnapshot(active.hooks), journal.hooksBefore)) {\n"
            "    throw new TransactionError('CAS', 'hooks.json changed concurrently before commit');\n"
            "  }",
            "ENOENT",
            "hooks compare-and-swap",
            "hooks-cas-lock",
        )
        installer_mutation(
            "    if (!prior) {\n"
            "      const age = Date.now() - fs.statSync(paths.lock).mtimeMs;",
            "    if (false && !prior) {\n"
            "      const age = Date.now() - fs.statSync(paths.lock).mtimeMs;",
            "unexpected exit for recover-only",
            "ownerless lock initialization grace",
            "lock-initialization-race",
        )
        installer_mutation(
            "  if (journal.phase === 'COMMITTED') {",
            "  if (true || journal.phase === 'COMMITTED') {",
            "refusing committed cleanup for an uncommitted transaction",
            "journal phase recovery",
            "uninstall-crash",
        )
        installer_mutation(
            "      journal.movedBackups.push(moved);",
            "      // Mutation: omit durable backup-move intent.",
            "backup move crash lost or changed an owned backup",
            "durable backup-move intent",
            "backup-crash-marker",
        )
        installer_mutation(
            "  if (digestIfDirectory(active.runtime) !== journal.baselineDigests.runtime) {\n"
            "    throw new TransactionError('CAS', 'runtime or current v4 state changed during install preparation');\n"
            "  }",
            "  if (false && digestIfDirectory(active.runtime) !== journal.baselineDigests.runtime) {\n"
            "    throw new TransactionError('CAS', 'runtime or current v4 state changed during install preparation');\n"
            "  }",
            "state-generation rejection did not restore the exact newer profile",
            "runtime-state preparation CAS",
            "prepare-state-races",
            extra_replacements=((
                "    if (digestIfDirectory(active.runtime) !== journal.baselineDigests.runtime) {\n"
                "      throw new TransactionError('CAS', 'runtime changed after preparation');\n"
                "    }",
                "    if (false && digestIfDirectory(active.runtime) !== journal.baselineDigests.runtime) {\n"
                "      throw new TransactionError('CAS', 'runtime changed after preparation');\n"
                "    }",
            ),),
        )
        installer_mutation(
            "    if (footprint && LEGACY_INSTALL_FOOTPRINTS.has(footprint)) {",
            "    if (footprint) {",
            "unexpected exit for install",
            "exact archived markerless footprint allowlist",
            "ownership-path-refusals",
        )
        installer_mutation(
            "    if (!fs.existsSync(current) || treeDigest(current) !== ownership.installed.skills[name]) {",
            "    if (false && (!fs.existsSync(current) || treeDigest(current) !== ownership.installed.skills[name])) {",
            "unexpected exit for uninstall",
            "managed-tree foreign-content refusal",
            "ownership-path-refusals",
            extra_replacements=((
                "  if (managedRuntimeDigest(active.runtime) !== ownership.installed.runtime) {",
                "  if (false && managedRuntimeDigest(active.runtime) !== ownership.installed.runtime) {",
            ),),
        )
        installer_mutation(
            "  if (home === target || containsPath(target, home)) {",
            "  if (false && (home === target || containsPath(target, home))) {",
            "unexpected exit for install",
            "home/target containment refusal",
            "ownership-path-refusals",
        )
        installer_mutation(
            "  if (containsPath(home, target) && target !== defaultTarget) {",
            "  if (false && containsPath(home, target) && target !== defaultTarget) {",
            "unexpected exit for install",
            "noncanonical target-inside-home refusal",
            "ownership-path-refusals",
        )
        installer_mutation(
            "    if (containsPath(repo, home) || containsPath(home, repo)\n"
            "        || containsPath(repo, target) || containsPath(target, repo)) {",
            "    if (false && (containsPath(repo, home) || containsPath(home, repo)\n"
            "        || containsPath(repo, target) || containsPath(target, repo))) {",
            "unexpected exit for install",
            "repository/managed-root overlap refusal",
            "ownership-path-refusals",
        )
        installer_mutation(
            "!Number.isSafeInteger(journal.sequence) || journal.sequence < 1",
            "false",
            "damaged journal was not rejected as journal corruption",
            "strict journal sequence and scaffold shape",
            "recovery-origin-journal",
            extra_replacements=((
                "  const booleanRecord = (value, keys) => exactKeys(value, keys)\n"
                "    && Object.values(value).every((item) => typeof item === 'boolean');",
                "  const booleanRecord = (value, keys) => object(value);",
            ), (
                "      || value.targetIdentity !== identity(lock.target) || value.sequence !== expectedSequence) {",
                "      || value.targetIdentity !== identity(lock.target) || false) {",
            ),),
        )
        installer_mutation(
            "    if (!baselineComplete || (journal.operation === 'install'\n"
            "      && (!preparedComplete || !SKILLS.every((name) => HASH.test(journal.preparedDigests.skills[name] || ''))\n"
            "        || !HASH.test(journal.preparedDigests.runtime || '')))\n"
            "      || (journal.operation === 'uninstall'\n"
            "        && (!SKILLS.every((name) => HASH.test(journal.baselineDigests.skills[name] || ''))\n"
            "          || !HASH.test(journal.baselineDigests.runtime || '')))) {\n"
            "      throw new TransactionError('JOURNAL', 'prepared journal lacks complete managed-tree digests');\n"
            "    }",
            "    // Mutation: accept incomplete prepared/applying digest collections.",
            "structurally incomplete APPLYING journal was not rejected before recovery",
            "complete APPLYING journal digest set",
            "recovery-origin-journal",
        )
        installer_mutation(
            "  if (!baseline.journalParent) removeEmpty(paths.journalParent);",
            "  if (true || !baseline.journalParent) removeEmpty(paths.journalParent);",
            "recover-only removed pre-existing journal scaffolding",
            "pre-existing journal origin preservation",
            "recovery-origin-journal",
        )
        installer_mutation(
            "  if (journal.operation === 'uninstall') {\n"
            "    barrier('uninstall', 'before-origin-cleanup');\n"
            "    cleanupUninstallOrigins(journal);\n"
            "  }\n"
            "  cleanupJournalArtifacts(journal);",
            "  cleanupJournalArtifacts(journal);\n"
            "  if (journal.operation === 'uninstall') {\n"
            "    barrier('uninstall', 'before-origin-cleanup');\n"
            "    cleanupUninstallOrigins(journal);\n"
            "  }",
            "committed uninstall recovery stranded owned origin scaffolding",
            "committed origin cleanup ordering",
            "recovery-origin-journal",
        )
        installer_mutation(
            "    } else if (/^exec-v4-/i.test(name)) {\n"
            "      pattern = EXEC_RECEIPT;",
            "    } else if (false && /^exec-v4-/i.test(name)) {\n"
            "      pattern = EXEC_RECEIPT;",
            "unexpected exit for install",
            "exact execution-receipt state allowlist",
            "genesis-state-contract",
        )
        installer_mutation(
            "  if (hookSnapshotEqual(current, journal.trustBefore)\n"
            "      && !fs.existsSync(candidate) && !fs.existsSync(displaced)) return;",
            "  if (false && hookSnapshotEqual(current, journal.trustBefore)\n"
            "      && !fs.existsSync(candidate) && !fs.existsSync(displaced)) return;",
            "unexpected exit for recover-only",
            "idempotent trust rollback recovery",
            "trust-crash-recovery",
            extra_replacements=((
                "  if (hookSnapshotEqual(current, journal.trustBefore)) {\n"
                "    cleanCompletedArtifacts();\n"
                "    return;\n"
                "  }",
                "  if (false && hookSnapshotEqual(current, journal.trustBefore)) {\n"
                "    cleanCompletedArtifacts();\n"
                "    return;\n"
                "  }",
            ),),
        )
        installer_mutation(
            "      if (!validateBackupDirectory(saved, journal.ownership, ownershipEntry, moved.scope)) {",
            "      if (false && !validateBackupDirectory(saved, journal.ownership, ownershipEntry, moved.scope)) {",
            "unexpected exit for recover-only",
            "rollback backup digest verification",
            "backup-crash-marker",
        )
        installer_mutation(
            "    const expectedSkills = journal.backupPlan.skillsPath !== null ? path.join(active.skillsBackupNamespace, journal.id) : null;",
            "    const expectedSkills = journal.backupPlan.skillsPath;",
            "redirected journal failed for an incidental reason instead of strict path validation",
            "journal backup-path binding",
            "journal-binding",
        )
        installer_mutation(
            "  try { marker = readJson(markerPath, 'backup owner marker'); } catch { return false; }",
            "  marker = readJson(markerPath, 'backup owner marker');",
            "unexpected exit for uninstall",
            "malformed backup marker preservation",
            "backup-crash-marker",
        )
        installer_mutation(
            "  return fs.readdirSync(source).filter((name) => !discarded.has(name)).sort();",
            "  return fs.readdirSync(source).filter((name) => !discarded.has(name) && !GENESIS_FILE.test(name)).sort();",
            "same-version update dropped persistent owned or foreign state",
            "exact task-genesis state preservation",
            "backups-v4",
        )
        installer_mutation(
            "    } else if (lowered.startsWith(GENESIS_PREFIX)) {\n"
            "      pattern = GENESIS_FILE;",
            "    } else if (false && lowered.startsWith(GENESIS_PREFIX)) {\n"
            "      pattern = GENESIS_FILE;",
            "unexpected exit for install",
            "malformed task-genesis fail-closed guard",
            "genesis-state-contract",
        )
        installer_mutation(
            "  return fs.readdirSync(source).filter((name) => !discarded.has(name)).sort();",
            "  return fs.readdirSync(source).filter((name) => !discarded.has(name) && !EVIDENCE_FILE.test(name)).sort();",
            "same-version update dropped persistent owned or foreign state",
            "exact privacy-safe evidence state preservation",
            "backups-v4",
        )
        installer_mutation(
            "    } else if (lowered.startsWith(EVIDENCE_PREFIX)) {\n"
            "      pattern = EVIDENCE_FILE;",
            "    } else if (false && lowered.startsWith(EVIDENCE_PREFIX)) {\n"
            "      pattern = EVIDENCE_FILE;",
            "unexpected exit for install",
            "malformed evidence state fail-closed guard",
            "genesis-state-contract",
        )
        installer_mutation(
            "    home: canonicalPath(options.home),\n"
            "    target: canonicalPath(options.target),",
            "    home: path.resolve(options.home),\n"
            "    target: path.resolve(options.target),",
            "journal path identity does not match this recovery request",
            "canonical alias recovery binding",
            "canonical-alias-recovery",
        )
        installer_mutation(
            "function digestRecord(digest, type, relative, bytes = null) {\n"
            "  digestField(digest, type);\n"
            "  digestField(digest, relative);\n"
            "  if (type === 'F') digestField(digest, bytes);\n"
            "}",
            "function digestRecord(digest, type, relative, bytes = null) {\n"
            "  digest.update(type);\n"
            "  digest.update('\\0');\n"
            "  digest.update(relative);\n"
            "  digest.update('\\0');\n"
            "  if (type === 'F') digest.update(bytes);\n"
            "}",
            "tree digest serialization allowed two different trees to share one digest",
            "length-framed managed-tree digest",
            "digest-framing",
        )
        installer_mutation(
            "    if (portable && !portable.includes('/') && ['state', 'install-ownership-v2.json'].includes(portable)) return;",
            "    if (portable && !portable.includes('/') && ['state', 'install-ownership-v1.json', 'install-ownership-v2.json'].includes(portable)) return;",
            "unexpected exit for uninstall",
            "foreign legacy ownership-marker detection",
            "ownership-path-refusals",
        )
        installer_mutation(
            "  if (purpose === 'uninstall' && foreign.length) {",
            "  if (false && purpose === 'uninstall' && foreign.length) {",
            "unexpected exit for uninstall",
            "unknown persistent-state uninstall refusal",
            "backups-v4",
        )
        installer_mutation(
            "    if (treeDigest(input) !== frozen.skills[name] || treeDigest(output) !== frozen.skills[name]) {",
            "    if (false && (treeDigest(input) !== frozen.skills[name] || treeDigest(output) !== frozen.skills[name])) {",
            "installer accepted a repository change after freezing its source baseline",
            "repository source freeze",
            "install-source-freeze",
            extra_replacements=((
                "  if (treeDigest(source.runtime) !== frozen.runtime || treeDigest(stageRuntime) !== frozen.runtime) {",
                "  if (false && (treeDigest(source.runtime) !== frozen.runtime || treeDigest(stageRuntime) !== frozen.runtime)) {",
            ), (
                "  if (!sourceDigestsEqual(repoSourceDigests(source), frozen)) {",
                "  if (false && !sourceDigestsEqual(repoSourceDigests(source), frozen)) {",
            )),
        )
        installer_mutation(
            "  const migrated = { ...task, taskKey: key };",
            "  const migrated = { ...task };",
            "legacy task was not bound to its filename key",
            "legacy task-key migration binding",
            "legacy-v4-migration",
        )
        installer_mutation(
            "      writeNewDurable(genesisItem, {\n"
            "        version: 4, taskKey: migration.key, saltCommitment: hookHash(migration.task.salt),\n"
            "      });\n"
            "      expectedDestination.add(migration.genesisName);",
            "      // Mutation: omit the canonical genesis record.",
            "legacy migration did not create a current genesis record",
            "legacy task-genesis creation",
            "legacy-v4-migration",
        )
        installer_mutation(
            "    migrated.dirtyEdits = [...new Set([\n"
            "      ...(Array.isArray(task.dirtyEdits) ? task.dirtyEdits : []),\n"
            "      ...edits,\n"
            "    ])];",
            "    migrated.dirtyEdits = [...new Set([\n"
            "      ...(Array.isArray(task.dirtyEdits) ? task.dirtyEdits : []),\n"
            "    ])];",
            "migration did not re-arm the exact pre-canonical proof edit union",
            "legacy proof edit-set re-arming",
            "legacy-v4-migration",
        )
        installer_mutation(
            "      reason: 'legacy-proof-unverifiable',\n"
            "      status: 'unresolved',",
            "      reason: 'legacy-proof-unverifiable',\n"
            "      status: 'resolved',",
            "pre-canonical proof was silently treated as current accepted evidence",
            "legacy proof debt remains unresolved",
            "legacy-v4-migration",
        )
        installer_mutation(
            "        message: 'Dev Rigor warning: this task contains pre-canonical proof records that cannot be verified as current evidence. The original proof, debt, and checkpoint records were preserved, and release remains blocked until current evidence resolves this mechanical debt.',\n"
            "        delivered: false,",
            "        message: 'Dev Rigor warning: this task contains pre-canonical proof records that cannot be verified as current evidence. The original proof, debt, and checkpoint records were preserved, and release remains blocked until current evidence resolves this mechanical debt.',\n"
            "        delivered: true,",
            "pre-canonical proof migration did not surface a release-visible warning",
            "legacy proof warning delivery",
            "legacy-v4-migration",
        )
        installer_mutation(
            "        || normalize(record.path) !== normalize(path.join(expectedToolRoot, filename))) {",
            "        || false) {",
            "recovery executed a journal-redirected revoker",
            "journal-bound verified-helper path",
            "pinned-helper-races",
        )
        installer_mutation(
            "  if (!record || !fs.existsSync(record.path) || fileHash(record.path) !== record.hash) {",
            "  if (!record) {",
            "tampered pinned wire helper executed arbitrary code",
            "pinned helper byte identity",
            "pinned-helper-races",
            extra_replacements=((
                "  if (!HASH.test(expectedHash || '') || !fs.existsSync(script) || fileHash(script) !== expectedHash) {",
                "  if (false && (!HASH.test(expectedHash || '') || !fs.existsSync(script) || fileHash(script) !== expectedHash)) {",
            ), (
                "  if (!fs.existsSync(script) || fileHash(script) !== expectedHash) {\n"
                "    throw new TransactionError('CAS', `${label} helper bytes changed during execution`);\n"
                "  }",
                "  if (false && (!fs.existsSync(script) || fileHash(script) !== expectedHash)) {\n"
                "    throw new TransactionError('CAS', `${label} helper bytes changed during execution`);\n"
                "  }",
            )),
        )
        installer_mutation(
            "  if (runtime && treeDigest(runtime) !== expectedRuntime) {\n"
            "    throw new TransactionError('CAS', `${label} runtime changed before helper execution`);\n"
            "  }",
            "  if (false && runtime && treeDigest(runtime) !== expectedRuntime) {\n"
            "    throw new TransactionError('CAS', `${label} runtime changed before helper execution`);\n"
            "  }",
            "runtime-changed pinned wire helper executed before CAS refusal",
            "full-runtime helper execution CAS",
            "pinned-helper-races",
            extra_replacements=((
                "  if (runtime && treeDigest(runtime) !== expectedRuntime) {\n"
                "    throw new TransactionError('CAS', `${label} runtime changed during helper execution`);\n"
                "  }",
                "  if (false && runtime && treeDigest(runtime) !== expectedRuntime) {\n"
                "    throw new TransactionError('CAS', `${label} runtime changed during helper execution`);\n"
                "  }",
            ),),
        )
        installer_mutation(
            "    if (!hookSnapshotEqual(hookSnapshot(active.trust), journal.trustAfter)) {\n"
            "      throw new TransactionError('CONFLICT', 'config.toml changed at the trust rollback displacement boundary');\n"
            "    }",
            "    if (false && !hookSnapshotEqual(hookSnapshot(active.trust), journal.trustAfter)) {\n"
            "      throw new TransactionError('CONFLICT', 'config.toml changed at the trust rollback displacement boundary');\n"
            "    }",
            "pre-displacement concurrent config was displaced from its active path",
            "atomic trust displacement recheck",
            "atomic-trust-restore",
        )
        installer_mutation(
            "  move(lock.paths.lock, intent);\n"
            "  barrier('transaction', 'after-lock-removal');",
            "  const vulnerableOwner = readJson(ownerPath, 'transaction lock owner');\n"
            "  removeTree(lock.paths.lock);\n"
            "  barrier('transaction', 'after-lock-removal');\n"
            "  ensureDirectory(intent);\n"
            "  writeNewDurable(path.join(intent, 'owner.json'), vulnerableOwner);",
            "lock removal exposed an unowned cleanup window instead of a durable release intent",
            "durable lock-release intent",
            "recovery-origin-journal",
        )
        installer_mutation(
            "      fs.renameSync(home, tombstone);\n"
            "      fsyncDirectory(path.dirname(home));\n"
            "      barrier('transaction', 'after-home-tombstone');",
            "      removeTree(home);\n"
            "      fsyncDirectory(path.dirname(home));\n"
            "      barrier('transaction', 'after-home-tombstone');\n"
            "      ensureDirectory(path.join(tombstone, RELEASE_DIRECTORY));\n"
            "      writeNewDurable(path.join(tombstone, RELEASE_DIRECTORY, 'owner.json'), current);",
            "home cleanup did not atomically retain its durable release intent in the tombstone",
            "durable empty-profile tombstone",
            "recovery-origin-journal",
        )

        manifest = copy / "manifest.json"
        original_manifest = manifest.read_text(encoding="utf-8")
        manifest.write_text(original_manifest.replace('"version": "1.7.0"', '"version": "9.9.9"', 1), encoding="utf-8")
        require_red(
            run(copy, [sys.executable, "tools/test_stack_contracts.py"]),
            "test_current_release_is_identified_on_every_document_surface",
            "version-surface contract",
        )
        manifest.write_text(original_manifest, encoding="utf-8")

        executable = copy / "docs" / "downloads" / "DevRigorHookActivator-1.7.0.exe"
        executable.parent.mkdir(parents=True, exist_ok=True)
        executable.write_bytes(b"MZ unapproved executable mutation")
        require_red(
            run(copy, [sys.executable, "tools/test_desktop_activator.py"]),
            "test_unapproved_candidate_is_not_published_or_described_as_current",
            "publication-hold binary exclusion",
        )

    print(
        f"verifier mutations: {len(mutation_labels)} safety invariants, "
        "version surface, and publication-hold artifact all went red"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
