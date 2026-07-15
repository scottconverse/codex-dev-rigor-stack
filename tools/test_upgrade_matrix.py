#!/usr/bin/env python3
"""Transactional upgrade/uninstall matrix for Dev Rigor profiles."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS = [item["name"] for item in json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["skills"]]
HISTORICAL = {
    "1.6.1": "e1e22a2",
    "1.6.2": "89c5d0d",
    "1.6.3": "91c8d7f",
}
CANDIDATE_HISTORY = {
    "pr9": "1941c2d4bb7c9db634c625948f0b48157b8da59e",
    "pr11": "4ba16f8ffb4376b9bea0105b6a3ca4b8b127d67b",
}
OWNERSHIP_FILE = "install-ownership-v2.json"


def fingerprint(root: Path) -> str:
    digest = hashlib.sha256()
    if not root.exists():
        return digest.hexdigest()
    for candidate in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        relative = candidate.relative_to(root).as_posix()
        if candidate.is_symlink():
            digest.update(b"L" + relative.encode() + b"\0" + os.readlink(candidate).encode() + b"\0")
        elif candidate.is_dir():
            digest.update(b"D" + relative.encode() + b"\0")
        else:
            digest.update(b"F" + relative.encode() + b"\0")
            digest.update(hashlib.sha256(candidate.read_bytes()).digest())
    return digest.hexdigest()


def snapshot(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for candidate in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        relative = candidate.relative_to(root).as_posix()
        if candidate.is_symlink():
            result[relative] = f"symlink:{os.readlink(candidate)}"
        elif candidate.is_dir():
            result[relative] = "dir"
        else:
            result[relative] = hashlib.sha256(candidate.read_bytes()).hexdigest()
    return result


def command(
    script: str,
    home: Path,
    *,
    uninstall: bool = False,
    repo: Path = ROOT,
    no_backup: bool = True,
) -> list[str]:
    if os.name == "nt":
        args = [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            str(repo / script), "-CodexHome", str(home),
        ]
        if not uninstall and no_backup:
            args.append("-NoBackup")
        if uninstall:
            args.append("-SkipTrustRevocation")
        return args
    args = ["bash", str(repo / script), "--codex-home", str(home)]
    if not uninstall and no_backup:
        args.append("--no-backup")
    if uninstall:
        args.append("--skip-trust-revocation")
    return args


def archived_tree(temporary: Path, label: str, commit: str, expected_version: str) -> Path:
    archive = temporary / f"{label}.tar"
    tree = temporary / f"source-{label}"
    subprocess.run(
        ["git", "archive", "--format=tar", "-o", str(archive), commit],
        cwd=ROOT, check=True, capture_output=True,
    )
    tree.mkdir()
    with tarfile.open(archive) as bundle:
        bundle.extractall(tree, filter="data")
    manifest = json.loads((tree / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["version"] == expected_version, f"{commit} is not the exact {label} tree"
    return tree


def historical_tree(temporary: Path, version: str) -> Path:
    return archived_tree(temporary, version, HISTORICAL[version], version)


def seed_foreign_and_poison(home: Path, version: str) -> str:
    runtime = home / "dev-rigor-stack" / "hooks"
    state = runtime.parent / "state"
    state.mkdir(exist_ok=True)
    suffix = hashlib.sha256(f"legacy-{version}".encode()).hexdigest()
    ledger = f"ground-{suffix}.log" if version == "1.6.1" else f"ground-v{2 if version == '1.6.2' else 3}-{suffix}.log"
    (state / ledger).write_text("E old-poisoned-edit.ts\nX Bash\n", encoding="utf-8")
    hooks = json.loads((home / "hooks.json").read_text(encoding="utf-8"))
    hooks["hooks"].setdefault("Stop", []).insert(0, {"hooks": [{"type": "command", "command": "node foreign-stop.js"}]})
    hooks["hooks"]["ForeignEvent"] = [{"hooks": [{"type": "command", "command": "node foreign.js"}]}]
    hooks["foreignRoot"] = {"preserve": True}
    (home / "hooks.json").write_text(json.dumps(hooks, indent=2) + "\n", encoding="utf-8")
    (home / "config.toml").write_text("[hooks.state.'foreign-proof']\ntrusted_hash = 'sha256:foreign'\n", encoding="utf-8")
    return ledger


def run(args: list[str], env: dict[str, str], expect: int) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True)
    if result.returncode != expect:
        raise AssertionError(f"expected {expect}, got {result.returncode}: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
    return result


def run_nonzero(args: list[str], env: dict[str, str], *, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True, timeout=timeout)
    if result.returncode == 0:
        raise AssertionError(f"expected nonzero exit: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
    return result


def transaction_command(home: Path, operation: str = "recover-only") -> list[str]:
    return [
        "node", str(ROOT / "codex" / "install-transaction.js"), operation,
        "--codex-home", str(home), "--target", str(home / "skills"),
    ]


def wait_for_path(path: Path, process: subprocess.Popen[str], timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            return
        if process.poll() is not None:
            stdout, stderr = process.communicate()
            raise AssertionError(f"transaction exited before pause barrier: {stdout}\n{stderr}")
        time.sleep(0.05)
    process.kill()
    stdout, stderr = process.communicate()
    raise AssertionError(f"transaction did not reach pause barrier: {path}\n{stdout}\n{stderr}")


def run_hook(home: Path, script: str, payload: dict[str, object], *args: str) -> str:
    target = home / "dev-rigor-stack" / "hooks" / script
    result = subprocess.run(
        ["node", str(target), *args],
        input=json.dumps(payload),
        cwd=ROOT,
        env={**os.environ, "CODEX_HOME": str(home)},
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"installed hook failed: {target} {' '.join(args)}\n{result.stdout}\n{result.stderr}")
    return result.stdout.strip()


def hook_state_hash(*values: object) -> str:
    digest = hashlib.sha256()
    for value in values:
        digest.update(str(value).encode())
        digest.update(b"\0")
    return digest.hexdigest()


def run_current_tool(
    home: Path,
    session: str,
    turn: str,
    tool_use_id: str,
    cwd: Path,
    tool_name: str,
    command_text: str,
    response: dict[str, object],
) -> None:
    payload = {
        "session_id": session,
        "turn_id": turn,
        "tool_use_id": tool_use_id,
        "cwd": str(cwd),
        "tool_name": tool_name,
        "tool_input": {"command": command_text},
    }
    run_hook(home, "dev-rigor-ground.js", {**payload, "hook_event_name": "PreToolUse"}, "snapshot")
    state = home / "dev-rigor-stack" / "state"
    before = json.loads((state / f"pre-v4-{hook_state_hash(session, turn, tool_use_id)}.json").read_text(encoding="utf-8"))
    if before.get("executionNonce"):
        (state / f"exec-v4-{hook_state_hash(session, turn, tool_use_id)}.receipt").write_text(
            f"{before['executionNonce']}:0", encoding="utf-8"
        )
    run_hook(
        home,
        "dev-rigor-ground.js",
        {**payload, "hook_event_name": "PostToolUse", "tool_response": response},
        "record",
    )


def status_text(home: Path, session: str) -> str:
    output = run_hook(
        home,
        "dev-rigor-router.js",
        {
            "session_id": session,
            "turn_id": f"status-{session}",
            "hook_event_name": "UserPromptSubmit",
            "prompt": "DevRigorSTATUS",
        },
    )
    parsed = json.loads(output)
    return parsed["hookSpecificOutput"]["additionalContext"]


def seed_candidate_v4_lifecycle(home: Path, label: str) -> tuple[str, Path, dict[str, object]]:
    """Create proof + debt through the exact archived candidate hooks, not synthetic JSON."""
    session = f"archived-{label}-migration"
    run_hook(home, "dev-rigor-activate.js", {"session_id": session, "hook_event_name": "SessionStart"})
    run_hook(
        home,
        "dev-rigor-router.js",
        {
            "session_id": session,
            "turn_id": "legacy-control",
            "hook_event_name": "UserPromptSubmit",
            "prompt": "DevRigorWARN",
        },
    )
    proof_turn = "legacy-proof-turn"
    run_hook(
        home,
        "dev-rigor-ground.js",
        {
            "session_id": session,
            "turn_id": proof_turn,
            "hook_event_name": "PostToolUse",
            "tool_use_id": "legacy-edit",
            "cwd": str(home),
            "tool_name": "apply_patch",
            "tool_input": {"command": "*** Update File: src/legacy-proof.ts"},
            "tool_response": {},
        },
        "record",
    )
    run_hook(
        home,
        "dev-rigor-ground.js",
        {
            "session_id": session,
            "turn_id": proof_turn,
            "hook_event_name": "PostToolUse",
            "tool_use_id": "legacy-test",
            "cwd": str(home),
            "tool_name": "Bash",
            "tool_input": {"command": "npm test"},
            "tool_response": {"exit_code": 0, "test_result": {"passed": 1, "failed": 0}},
        },
        "record",
    )
    state = home / "dev-rigor-stack" / "state"
    task_files = list(state.glob("task-v4-*.json"))
    assert len(task_files) == 1, f"{label} archived lifecycle did not create exactly one task"
    proof_state = json.loads(task_files[0].read_text(encoding="utf-8"))
    assert proof_state.get("proofs"), f"{label} archived lifecycle did not create a real pre-canonical proof"
    token = proof_state["proofs"][-1]["token"]
    run_hook(
        home,
        "dev-rigor-ground.js",
        {
            "session_id": session,
            "turn_id": proof_turn,
            "hook_event_name": "Stop",
            "stop_hook_active": False,
            "last_assistant_message": f"proved: proof-id:{token} · blast: low · skipped: none",
        },
        "check",
    )
    debt_turn = "legacy-debt-turn"
    run_hook(
        home,
        "dev-rigor-ground.js",
        {
            "session_id": session,
            "turn_id": debt_turn,
            "hook_event_name": "PostToolUse",
            "tool_use_id": "legacy-unproved-edit",
            "cwd": str(home),
            "tool_name": "apply_patch",
            "tool_input": {"command": "*** Update File: src/legacy-debt.ts"},
            "tool_response": {},
        },
        "record",
    )
    run_hook(
        home,
        "dev-rigor-ground.js",
        {
            "session_id": session,
            "turn_id": debt_turn,
            "hook_event_name": "Stop",
            "stop_hook_active": False,
            "last_assistant_message": "legacy unproved edit",
        },
        "check",
    )
    legacy = json.loads(task_files[0].read_text(encoding="utf-8"))
    assert "taskKey" not in legacy, f"{label} archived task unexpectedly used the current identity schema"
    assert legacy.get("proofs"), f"{label} archived proof disappeared before migration"
    assert legacy.get("unresolved"), f"{label} archived lifecycle did not retain proof debt"
    key = task_files[0].name[len("task-v4-"):-len(".json")]
    assert not (state / f"task-genesis-v4-{key}.json").exists(), f"{label} archived tree unexpectedly created genesis"
    assert not list(state.glob("evidence-v4-*.json")), f"{label} archived tree unexpectedly created canonical evidence"
    return session, task_files[0], legacy


def candidate_v4_migration_scenario(label: str) -> None:
    with tempfile.TemporaryDirectory(prefix=f"dev-rigor-{label}-migration-") as temporary:
        temporary_path = Path(temporary)
        source = archived_tree(temporary_path, label, CANDIDATE_HISTORY[label], "1.7.0")
        home = temporary_path / "home"
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        uninstaller = "uninstall.ps1" if os.name == "nt" else "uninstall.sh"
        run(command(installer, home, repo=source), env, 0)
        session, task_path, legacy = seed_candidate_v4_lifecycle(home, label)
        task_key = task_path.name[len("task-v4-"):-len(".json")]
        original_profile = snapshot(home)

        failed = {**env, "DEV_RIGOR_INSTALL_TEST_FAIL_AT": "backup-finalization"}
        run(command(installer, home), failed, 1)
        assert snapshot(home) == original_profile, (
            f"failed exact {label} migration did not restore original task bytes and genesis absence"
        )

        run(command(installer, home), env, 0)
        migrated = json.loads(task_path.read_text(encoding="utf-8"))
        for field, value in legacy.items():
            if field not in {"dirtyEdits", "notices", "mechanical"}:
                assert migrated.get(field) == value, f"{label} migration changed legacy field {field}"
        assert migrated["proofs"] == legacy["proofs"], f"{label} proof history changed during migration"
        assert migrated["unresolved"] == legacy["unresolved"], f"{label} proof debt changed during migration"
        assert migrated.get("checkpoint") == legacy.get("checkpoint"), f"{label} checkpoint changed during migration"
        assert migrated["taskKey"] == task_key, f"{label} task was not bound to its exact filename key"
        legacy_proof_edits = {
            edit for proof in legacy["proofs"] for edit in proof.get("edits", [])
        }
        assert legacy_proof_edits, f"{label} exact archived proof did not expose its affected edit set"
        assert set(migrated.get("dirtyEdits", [])) == set(legacy.get("dirtyEdits", [])) | legacy_proof_edits, (
            f"{label} migration did not re-arm the exact historical proof edit set"
        )
        original_notices = legacy.get("notices", [])
        assert migrated.get("notices", [])[:len(original_notices)] == original_notices
        assert any(item.get("reason") == "legacy-proof-unverifiable" and item.get("status") == "unresolved"
                   for item in migrated.get("mechanical", [])), (
            f"{label} pre-canonical proof was silently treated as current accepted evidence"
        )
        assert any(item.get("id", "").startswith("legacy-proof-unverifiable:") and item.get("delivered") is False
                   for item in migrated.get("notices", [])), f"{label} migration warning was not visible"
        genesis = json.loads((task_path.parent / f"task-genesis-v4-{task_key}.json").read_text(encoding="utf-8"))
        commitment = hashlib.sha256((legacy["salt"] + "\0").encode()).hexdigest()
        assert genesis == {"version": 4, "taskKey": task_key, "saltCommitment": commitment}
        assert not list(task_path.parent.glob("evidence-v4-*.json")), (
            f"{label} migration invented canonical evidence for an unverifiable historical proof"
        )
        status = status_text(home, session)
        assert "mechanical debt: yes" in status, f"{label} legacy-proof warning was not release-visible"
        assert "unresolved proof: yes" in status, f"{label} original proof debt was not release-visible"

        proof_repo = temporary_path / "proof-repo"
        (proof_repo / "src").mkdir(parents=True)
        (proof_repo / "src" / "app.js").write_text("module.exports = 1;\n", encoding="utf-8")
        run(["git", "init", "--quiet", str(proof_repo)], env, 0)
        run(["git", "-C", str(proof_repo), "config", "user.email", "migration@example.invalid"], env, 0)
        run(["git", "-C", str(proof_repo), "config", "user.name", "Migration Test"], env, 0)
        run(["git", "-C", str(proof_repo), "add", "."], env, 0)
        run(["git", "-C", str(proof_repo), "commit", "--quiet", "-m", "fixture"], env, 0)

        run_current_tool(
            home, session, "unrelated-turn", "unrelated-tool", proof_repo,
            "PowerShell", "Get-Date", {"exit_code": 0},
        )
        after_unrelated = json.loads(task_path.read_text(encoding="utf-8"))
        assert legacy_proof_edits <= set(after_unrelated.get("dirtyEdits", [])), (
            f"{label} unrelated command cleared re-armed historical edits"
        )
        assert any(item.get("reason") == "legacy-proof-unverifiable" and item.get("status") == "unresolved"
                   for item in after_unrelated.get("mechanical", [])), (
            f"{label} unrelated command cleared legacy-proof mechanical debt"
        )

        proof_turn = "current-proof-turn"
        run_current_tool(
            home, session, proof_turn, "current-test", proof_repo,
            "Bash", "npm test", {"exit_code": 0, "test_result": {"passed": 1, "failed": 0}},
        )
        with_current_proof = json.loads(task_path.read_text(encoding="utf-8"))
        canonical = [proof for proof in with_current_proof.get("proofs", []) if proof.get("evidence")]
        assert canonical, f"{label} current qualifying run did not create canonical evidence"
        current_token = canonical[-1]["token"]
        run_hook(
            home,
            "dev-rigor-ground.js",
            {
                "session_id": session,
                "turn_id": proof_turn,
                "hook_event_name": "Stop",
                "stop_hook_active": False,
                "last_assistant_message": f"proved: proof-id:{current_token} · blast: low · skipped: none",
            },
            "check",
        )
        resolved = json.loads(task_path.read_text(encoding="utf-8"))
        assert not (legacy_proof_edits & set(resolved.get("dirtyEdits", []))), (
            f"{label} current evidence did not resolve the same historical edit set"
        )
        assert any(item.get("reason") == "legacy-proof-unverifiable" and item.get("status") == "resolved"
                   for item in resolved.get("mechanical", [])), (
            f"{label} current exact-set evidence did not resolve legacy-proof debt"
        )

        migrated_profile = snapshot(home)
        failed_uninstall = {**env, "DEV_RIGOR_UNINSTALL_TEST_FAIL_AT": "mid-remove"}
        run(command(uninstaller, home, uninstall=True), failed_uninstall, 1)
        assert snapshot(home) == migrated_profile, f"failed {label} uninstall did not restore migrated bytes exactly"
        run(command(uninstaller, home, uninstall=True), env, 0)
        assert not (home / "dev-rigor-stack").exists(), f"successful {label} uninstall retained owned migrated state"


def seed_current_v4_state(home: Path) -> None:
    activate = "dev-rigor-activate.js"
    router = "dev-rigor-router.js"
    ground = "dev-rigor-ground.js"

    for session in (
        "state-parent", "state-warn", "state-off", "state-proof", "state-mechanical",
        "state-repair-parent",
    ):
        run_hook(home, activate, {"session_id": session, "hook_event_name": "SessionStart"})
    run_hook(
        home,
        activate,
        {
            "session_id": "state-child",
            "parent_session_id": "state-parent",
            "hook_event_name": "SubagentStart",
        },
        "subagent",
    )
    run_hook(
        home,
        activate,
        {"session_id": "state-unbound", "hook_event_name": "SubagentStart"},
        "subagent",
    )
    run_hook(
        home,
        activate,
        {"session_id": "state-repair-child", "hook_event_name": "SubagentStart"},
        "subagent",
    )
    run_hook(
        home,
        activate,
        {
            "session_id": "state-repair-child",
            "parent_session_id": "state-repair-parent",
            "hook_event_name": "SubagentStart",
        },
        "subagent",
    )
    repaired = json.loads(run_hook(
        home,
        router,
        {
            "session_id": "state-repair-child",
            "turn_id": "repair-state-child",
            "hook_event_name": "UserPromptSubmit",
            "prompt": "DevRigorREPAIR",
        },
    ))
    assert "association resolved: 1" in repaired["hookSpecificOutput"]["additionalContext"], (
        "association-resolution fixture was not created"
    )
    for session, control in (("state-warn", "DevRigorWARN"), ("state-off", "DevRigorOFF")):
        run_hook(
            home,
            router,
            {
                "session_id": session,
                "turn_id": f"control-{session}",
                "hook_event_name": "UserPromptSubmit",
                "prompt": control,
            },
        )

    run_hook(
        home,
        ground,
        {
            "session_id": "state-proof",
            "turn_id": "proof-turn",
            "hook_event_name": "PostToolUse",
            "tool_use_id": "proof-edit",
            "cwd": str(home),
            "tool_name": "apply_patch",
            "tool_input": {"file_path": "proof-debt.js"},
            "tool_response": {},
        },
        "record",
    )
    first_stop = json.loads(run_hook(
        home,
        ground,
        {
            "session_id": "state-proof",
            "turn_id": "proof-turn",
            "hook_event_name": "Stop",
            "stop_hook_active": False,
            "last_assistant_message": "unproved edit",
        },
        "check",
    ))
    assert first_stop.get("decision") == "block", "proof-debt fixture did not create its first block"
    second_stop = json.loads(run_hook(
        home,
        ground,
        {
            "session_id": "state-proof",
            "turn_id": "proof-turn",
            "hook_event_name": "Stop",
            "stop_hook_active": True,
            "last_assistant_message": "unproved edit retry",
        },
        "check",
    ))
    assert "proof debt" in second_stop.get("systemMessage", "").lower(), "proof debt was not retained"

    mechanical = json.loads(run_hook(
        home,
        ground,
        {
            "session_id": "state-mechanical",
            "turn_id": "mechanical-turn",
            "hook_event_name": "PostToolUse",
            "tool_use_id": "pathless-edit",
            "cwd": str(home),
            "tool_name": "apply_patch",
            "tool_input": {},
            "tool_response": {},
        },
        "record",
    ))
    assert "mechanical debt" in mechanical.get("systemMessage", "").lower(), "mechanical-debt fixture was not created"

    # A valid exact legacy ledger must not be migrated back into the repaired runtime.
    state = home / "dev-rigor-stack" / "state"
    (state / f"exec-v4-{'a' * 64}.receipt").write_text("active-install-proof:0\n", encoding="utf-8")
    legacy_name = f"ground-v3-{hashlib.sha256(b'legacy-current-poison').hexdigest()}.log"
    (state / legacy_name).write_text("E old-poisoned-edit.ts\nX Bash\n", encoding="utf-8")


def verify_current_v4_state(home: Path, expected: dict[str, str]) -> None:
    state = home / "dev-rigor-stack" / "state"
    actual = snapshot(state)
    current_prefixes = (
        "task-v4-", "task-genesis-v4-", "evidence-v4-", "mechanical-v4-", "ground-v4-",
        "pre-v4-", "router-v4-", "exec-v4-",
    )
    current_directories = {"associations-v4", "association-debt-v4", "association-resolutions-v4"}

    def current(relative: str) -> bool:
        head = Path(relative).parts[0]
        return head.startswith(current_prefixes) or head in current_directories

    legacy = sorted(key for key in actual if not current(key))
    assert not legacy, f"legacy 1.6 state was migrated into the active runtime: {legacy}"
    expected = {key: value for key, value in expected.items() if current(key)}
    if actual != expected:
        changed = sorted(
            key for key in set(actual) | set(expected)
            if actual.get(key) != expected.get(key)
        )
        raise AssertionError(f"current v4 task/proof/mechanical/association state changed during reinstall: {changed}")

    assert "mode: WARN" in status_text(home, "state-warn")
    assert "mode: OFF" in status_text(home, "state-off")
    assert "unresolved proof: yes" in status_text(home, "state-proof")
    assert "mechanical debt: yes" in status_text(home, "state-mechanical")
    assert "association debt: yes (1)" in status_text(home, "state-unbound")
    repaired = status_text(home, "state-repair-child")
    assert "association debt: no" in repaired
    assert "association resolutions: 1" in repaired
    parent = status_text(home, "state-parent")
    assert "associated subagents: 1" in parent
    assert "association debt: no" in parent


def seed_foreign_backups(home: Path) -> dict[Path, bytes]:
    sentinels = {
        home / ".backup" / "foreign-product" / "keep.bin": b"foreign runtime backup\x00\xff",
        home / "skills" / ".backup" / "foreign-product" / "keep.txt": b"foreign skills backup\n",
        home / ".backup" / "codex-dev-rigor-stack" / "foreign-unowned" / "keep.txt": b"foreign child in stack namespace\n",
        home / "skills" / ".backup" / "codex-dev-rigor-stack" / "foreign-unowned" / "keep.txt": b"foreign child in skills namespace\n",
    }
    for path, content in sentinels.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return sentinels


def verify_uninstalled(
    home: Path,
    foreign_config: bytes,
    foreign_backups: dict[Path, bytes],
    owned_backup_paths: list[Path],
) -> None:
    assert not (home / "dev-rigor-stack").exists(), "owned runtime survived uninstall"
    assert all(not (home / "skills" / name).exists() for name in SKILLS), "owned skill survived uninstall"
    for path in owned_backup_paths:
        assert not path.exists(), f"owned backup transaction survived uninstall: {path}"
    for path, content in foreign_backups.items():
        assert path.read_bytes() == content, f"foreign backup changed during uninstall: {path}"
    hooks = json.loads((home / "hooks.json").read_text(encoding="utf-8"))
    rendered = json.dumps(hooks)
    assert "foreign-stop.js" in rendered and "foreign.js" in rendered and hooks["foreignRoot"] == {"preserve": True}
    assert "dev-rigor-" not in rendered
    assert (home / "config.toml").read_bytes() == foreign_config


def scenario(version: str) -> None:
    with tempfile.TemporaryDirectory(prefix=f"dev-rigor-upgrade-{version}-") as temporary:
        temporary_path = Path(temporary)
        home = Path(temporary) / "home"
        source = historical_tree(temporary_path, version)
        historical_env = {**os.environ, "CI": "1"}
        run(command("install.ps1" if os.name == "nt" else "install.sh", home, repo=source), historical_env, 0)
        legacy_ledger = seed_foreign_and_poison(home, version)
        installed_skill = home / "skills" / "dev-rigor-stack" / "SKILL.md"
        source_skill = source / "skills" / "dev-rigor-stack" / "SKILL.md"
        assert installed_skill.read_bytes() == source_skill.read_bytes(), f"{version} was not installed from its archived tree"
        before = fingerprint(home)
        env = {**os.environ, "CI": "1", "DEV_RIGOR_INSTALL_TEST_FAIL_AT": "mid-commit"}
        run(command("install.ps1" if os.name == "nt" else "install.sh", home), env, 1)
        assert fingerprint(home) == before, f"failed {version} upgrade did not roll back byte-for-byte"

        env.pop("DEV_RIGOR_INSTALL_TEST_FAIL_AT")
        run(command("install.ps1" if os.name == "nt" else "install.sh", home, no_backup=False), env, 0)
        assert (home / ".backup" / "codex-dev-rigor-stack").is_dir(), "default update did not create runtime backup"
        assert (home / "skills" / ".backup" / "codex-dev-rigor-stack").is_dir(), "default update did not create skills backup"
        ownership = json.loads((home / "dev-rigor-stack" / OWNERSHIP_FILE).read_text(encoding="utf-8"))
        owned_backup_paths = []
        for backup in ownership["backups"]:
            if backup["skills"]["present"]:
                assert len(backup["skills"]["digest"]) == 64, "skills backup digest is missing"
                owned_backup_paths.append(home / "skills" / ".backup" / "codex-dev-rigor-stack" / backup["id"])
            if backup["home"]["present"]:
                assert len(backup["home"]["digest"]) == 64, "home backup digest is missing"
                owned_backup_paths.append(home / ".backup" / "codex-dev-rigor-stack" / backup["id"])
        assert owned_backup_paths and all(path.exists() for path in owned_backup_paths), "owned backup ledger does not match installed backups"
        foreign_backups = seed_foreign_backups(home)
        assert len([name for name in SKILLS if (home / "skills" / name / "SKILL.md").is_file()]) == 19
        assert "ground-v4-" in (ROOT / "codex" / "hooks" / "dev-rigor-ground.js").read_text(encoding="utf-8")
        assert not (home / "dev-rigor-stack" / "state" / legacy_ledger).exists(), (
            f"{version} poisoned legacy ledger was migrated into the current runtime"
        )
        foreign_config = (home / "config.toml").read_bytes()
        installed = fingerprint(home)
        installed_snapshot = snapshot(home)
        for failure_point in ("mid-remove", "config-commit"):
            env["DEV_RIGOR_UNINSTALL_TEST_FAIL_AT"] = failure_point
            run(command("uninstall.ps1" if os.name == "nt" else "uninstall.sh", home, uninstall=True), env, 1)
            after_snapshot = snapshot(home)
            changed = sorted(
                key for key in set(installed_snapshot) | set(after_snapshot)
                if installed_snapshot.get(key) != after_snapshot.get(key)
            )
            assert fingerprint(home) == installed, (
                f"failed {version} uninstall at {failure_point} did not roll back byte-for-byte: {changed}"
            )
        env.pop("DEV_RIGOR_UNINSTALL_TEST_FAIL_AT")
        run(command("uninstall.ps1" if os.name == "nt" else "uninstall.sh", home, uninstall=True), env, 0)
        verify_uninstalled(home, foreign_config, foreign_backups, owned_backup_paths)


def markerless_near_match_refusal_scenario() -> None:
    """Only the exact immutable markerless archive may cross the ownership boundary."""
    with tempfile.TemporaryDirectory(prefix="dev-rigor-markerless-near-match-") as temporary:
        temporary_path = Path(temporary)
        source = historical_tree(temporary_path, "1.6.3")
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        mutations = {
            "runtime": (Path("dev-rigor-stack/hooks/dev-rigor-ground.js"), b"\n// foreign markerless runtime byte\n"),
            "skill": (Path("skills/visitor-audit/SKILL.md"), b"\n<!-- foreign markerless skill byte -->\n"),
        }
        for label, (relative, addition) in mutations.items():
            home = temporary_path / f"home-{label}"
            run(command(installer, home, repo=source), env, 0)
            assert not (home / "dev-rigor-stack" / OWNERSHIP_FILE).exists(), (
                "archived 1.6.3 fixture unexpectedly contains current ownership metadata"
            )
            assert not (home / "dev-rigor-stack" / "install-ownership-v1.json").exists(), (
                "archived 1.6.3 fixture unexpectedly contains legacy ownership metadata"
            )
            changed = home / relative
            changed.write_bytes(changed.read_bytes() + addition)
            expected = snapshot(home)
            refusal = run(command(installer, home), env, 1)
            output = refusal.stdout + refusal.stderr
            assert "OWNERSHIP" in output and "missing exact v1/v2" in output, (
                f"markerless {label} near-match failed for an incidental reason: {output}"
            )
            assert snapshot(home) == expected, (
                f"markerless {label} near-match refusal did not preserve the profile byte-for-byte"
            )


def clean_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-upgrade-clean-") as temporary:
        home = Path(temporary) / "home"
        home.mkdir()
        (home / "config.toml").write_text("[foreign]\nvalue = true\n", encoding="utf-8")
        (home / "hooks.json").write_text(json.dumps({"hooks": {"ForeignEvent": [{"hooks": [{"type": "command", "command": "node foreign.js"}]}]}}), encoding="utf-8")
        env = {**os.environ, "CI": "1"}
        run(command("install.ps1" if os.name == "nt" else "install.sh", home), env, 0)
        foreign_config = (home / "config.toml").read_bytes()
        run(command("uninstall.ps1" if os.name == "nt" else "uninstall.sh", home, uninstall=True), env, 0)
        assert not (home / "dev-rigor-stack").exists()
        assert (home / "config.toml").read_bytes() == foreign_config


def pristine_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-upgrade-pristine-") as temporary:
        home = Path(temporary) / "home"
        env = {**os.environ, "CI": "1"}
        run(command("install.ps1" if os.name == "nt" else "install.sh", home), env, 0)
        installed = fingerprint(home)
        env["DEV_RIGOR_UNINSTALL_TEST_FAIL_AT"] = "mid-remove"
        run(command("uninstall.ps1" if os.name == "nt" else "uninstall.sh", home, uninstall=True), env, 1)
        assert fingerprint(home) == installed, "failed pristine uninstall did not restore its exact installed state"
        assert not (home / "config.toml").exists(), "rollback retained trust config created by the failed revoker"
        env.pop("DEV_RIGOR_UNINSTALL_TEST_FAIL_AT")
        run(command("uninstall.ps1" if os.name == "nt" else "uninstall.sh", home, uninstall=True), env, 0)
        assert not (home / "dev-rigor-stack").exists(), "pristine uninstall retained the owned runtime"
        assert all(not (home / "skills" / name).exists() for name in SKILLS), "pristine uninstall retained an owned skill"
        assert not (home / "hooks.json").exists(), "pristine uninstall retained the stack-created empty hooks.json"
        assert not (home / "skills").exists(), "pristine uninstall retained the stack-created empty skills directory"
        assert not (home / "config.toml").exists(), "pristine uninstall created trust configuration"


def preexisting_scaffolding_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-preexisting-scaffolding-") as temporary:
        home = Path(temporary) / "home"
        skills = home / "skills"
        skills.mkdir(parents=True)
        hooks_path = home / "hooks.json"
        hooks_path.write_text('{"hooks": {}}\n', encoding="utf-8")
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        uninstaller = "uninstall.ps1" if os.name == "nt" else "uninstall.sh"
        run(command(installer, home), env, 0)
        assert (home / "dev-rigor-stack" / OWNERSHIP_FILE).is_file(), "install origin metadata was not persisted"
        run(command(uninstaller, home, uninstall=True), env, 0)
        assert skills.is_dir() and not list(skills.iterdir()), "pre-existing empty skills scaffolding was removed or changed"
        assert hooks_path.is_file(), "pre-existing empty hooks.json scaffolding was removed"
        assert json.loads(hooks_path.read_text(encoding="utf-8")) == {"hooks": {}}, "pre-existing hooks scaffold changed semantically"


def later_foreign_content_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-later-foreign-") as temporary:
        home = Path(temporary) / "home"
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        uninstaller = "uninstall.ps1" if os.name == "nt" else "uninstall.sh"
        run(command(installer, home), env, 0)
        foreign_skill_content = b"created after Dev Rigor installation\x00\xff"
        foreign_skill = home / "skills" / "foreign-owner" / "keep.bin"
        foreign_skill.parent.mkdir()
        foreign_skill.write_bytes(foreign_skill_content)
        hooks_path = home / "hooks.json"
        hooks = json.loads(hooks_path.read_text(encoding="utf-8"))
        hooks["foreignRoot"] = {"preserve": True}
        hooks_path.write_text(json.dumps(hooks, indent=2) + "\n", encoding="utf-8")
        run(command(uninstaller, home, uninstall=True), env, 0)
        assert foreign_skill.read_bytes() == foreign_skill_content, "later foreign skills content was removed"
        preserved_hooks = json.loads(hooks_path.read_text(encoding="utf-8"))
        assert preserved_hooks["foreignRoot"] == {"preserve": True}, "later foreign hooks content was removed"
        assert "dev-rigor-" not in json.dumps(preserved_hooks), "owned hook definition survived alongside foreign content"


def owned_scaffolding_with_backups_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-owned-scaffolding-backups-") as temporary:
        home = Path(temporary) / "home"
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        uninstaller = "uninstall.ps1" if os.name == "nt" else "uninstall.sh"
        run(command(installer, home), env, 0)
        run(command(installer, home, no_backup=False), env, 0)
        ownership = json.loads((home / "dev-rigor-stack" / OWNERSHIP_FILE).read_text(encoding="utf-8"))
        assert ownership["created"] == {
            "skillsDirectory": True,
            "hooksConfig": True,
            "skillsBackupNamespace": True,
            "skillsBackupParent": True,
            "homeBackupNamespace": True,
            "homeBackupParent": True,
        }, "same-version update did not retain and extend exact ownership metadata"
        assert len(ownership["backups"]) == 1
        backup = ownership["backups"][0]
        assert backup["skills"]["present"] is True and backup["home"]["present"] is True
        assert len(backup["skills"]["digest"]) == 64 and len(backup["home"]["digest"]) == 64
        run(command(uninstaller, home, uninstall=True), env, 0)
        assert not (home / "skills").exists(), "owned skills/backup scaffolding survived uninstall"
        assert not (home / "hooks.json").exists(), "owned hook configuration survived uninstall"
        assert not (home / ".backup").exists(), "owned backup parent scaffolding survived uninstall"


def missing_hooks_uninstall_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-missing-hooks-uninstall-") as temporary:
        home = Path(temporary) / "home"
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        uninstaller = "uninstall.ps1" if os.name == "nt" else "uninstall.sh"
        run(command(installer, home), env, 0)
        (home / "hooks.json").unlink()
        run(command(uninstaller, home, uninstall=True), env, 0)
        assert not (home / "hooks.json").exists(), "uninstall manufactured hooks.json when the live file was absent"
        assert not (home / "skills").exists(), "missing-hooks uninstall retained owned skills scaffolding"


def ownership_refusal_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-ownership-refusal-") as temporary:
        root = Path(temporary)
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"

        valid_home = root / "valid-home"
        run(command(installer, valid_home), env, 0)
        valid_marker = (valid_home / "dev-rigor-stack" / OWNERSHIP_FILE).read_bytes()

        corrupt_home = root / "corrupt-home"
        run(command(installer, corrupt_home), env, 0)
        corrupt_marker = corrupt_home / "dev-rigor-stack" / OWNERSHIP_FILE
        corrupt_marker.write_bytes(b"{not valid ownership json\n")
        expected = snapshot(corrupt_home)
        run(command(installer, corrupt_home), env, 1)
        assert snapshot(corrupt_home) == expected, "corrupt ownership refusal changed the profile"

        mismatch_home = root / "mismatch-home"
        run(command(installer, mismatch_home), env, 0)
        mismatch_marker = mismatch_home / "dev-rigor-stack" / OWNERSHIP_FILE
        mismatch_marker.write_bytes(valid_marker)
        expected = snapshot(mismatch_home)
        run(command(installer, mismatch_home), env, 1)
        assert snapshot(mismatch_home) == expected, "path-mismatched ownership refusal changed the profile"

        traversal_home = root / "traversal-home"
        run(command(installer, traversal_home), env, 0)
        traversal_marker = traversal_home / "dev-rigor-stack" / OWNERSHIP_FILE
        record = json.loads(traversal_marker.read_text(encoding="utf-8"))
        record["backups"] = [{
            "id": "../escape",
            "skills": {"present": True, "digest": "a" * 64},
            "home": {"present": True, "digest": "b" * 64},
        }]
        traversal_marker.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        expected = snapshot(traversal_home)
        run(command(installer, traversal_home), env, 1)
        assert snapshot(traversal_home) == expected, "traversal backup ID refusal changed the profile"


def current_state_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-current-state-") as temporary:
        home = Path(temporary) / "home"
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"

        run(command(installer, home), env, 0)
        seed_foreign_and_poison(home, "1.6.3")
        seed_current_v4_state(home)
        state = home / "dev-rigor-stack" / "state"
        expected_state = snapshot(state)
        expected_profile = snapshot(home)
        foreign_config = (home / "config.toml").read_bytes()

        # Exercise rollback after the runtime/state migration and backup-copy
        # point. Failure must restore the complete profile, including backup history.
        failed_env = {**env, "DEV_RIGOR_INSTALL_TEST_FAIL_AT": "backup-finalization"}
        run(command(installer, home, no_backup=False), failed_env, 1)
        actual_profile = snapshot(home)
        changed = sorted(
            key for key in set(actual_profile) | set(expected_profile)
            if actual_profile.get(key) != expected_profile.get(key)
        )
        assert actual_profile == expected_profile, f"failed current-state repair did not restore every profile byte: {changed}"
        assert snapshot(state) == expected_state, "failed current-state repair changed v4 state"

        run(command(installer, home), env, 0)
        verify_current_v4_state(home, expected_state)
        assert (home / "config.toml").read_bytes() == foreign_config, "foreign trust state changed during repair"
        hooks = json.loads((home / "hooks.json").read_text(encoding="utf-8"))
        rendered = json.dumps(hooks)
        assert "foreign-stop.js" in rendered and "foreign.js" in rendered
        assert hooks["foreignRoot"] == {"preserve": True}


def empty_backup_container_rollback_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-empty-backup-rollback-") as temporary:
        home = Path(temporary) / "home"
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        run(command(installer, home), env, 0)
        # Empty pre-existing backup containers are part of the starting profile;
        # rollback may remove only the transaction's new backup-ID children.
        (home / ".backup" / "codex-dev-rigor-stack").mkdir(parents=True)
        (home / "skills" / ".backup" / "codex-dev-rigor-stack").mkdir(parents=True)
        expected = snapshot(home)
        failed_env = {**env, "DEV_RIGOR_INSTALL_TEST_FAIL_AT": "backup-finalization"}
        run(command(installer, home, no_backup=False), failed_env, 1)
        actual = snapshot(home)
        changed = sorted(key for key in set(actual) | set(expected) if actual.get(key) != expected.get(key))
        assert actual == expected, f"failed upgrade removed pre-existing empty backup containers: {changed}"


def abrupt_install_recovery_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-abrupt-recovery-") as temporary:
        home = Path(temporary) / "home"
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        run(command(installer, home), env, 0)
        # These generic containers predate each interrupted update and therefore
        # must survive recovery even when the stack's child transaction is removed.
        for relative in (".staging", ".rollback", ".transactions"):
            (home / relative).mkdir(exist_ok=True)
        expected = snapshot(home)
        for barrier in ("after-skills", "after-runtime", "after-hooks-apply", "before-commit"):
            crashed_env = {**env, "DEV_RIGOR_TXN_CRASH_AT": f"install:{barrier}"}
            run_nonzero(command(installer, home, no_backup=False), crashed_env)
            run(transaction_command(home), env, 0)
            actual = snapshot(home)
            changed = sorted(key for key in set(actual) | set(expected) if actual.get(key) != expected.get(key))
            assert actual == expected, f"recovery after abrupt {barrier} did not restore the exact starting profile: {changed}"


def abrupt_uninstall_recovery_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-abrupt-uninstall-recovery-") as temporary:
        home = Path(temporary) / "home"
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        uninstaller = "uninstall.ps1" if os.name == "nt" else "uninstall.sh"
        run(command(installer, home), env, 0)
        run(command(installer, home, no_backup=False), env, 0)
        ownership = json.loads((home / "dev-rigor-stack" / OWNERSHIP_FILE).read_text(encoding="utf-8"))
        assert ownership["backups"], "uninstall recovery fixture lacks an owned backup transaction"
        for relative in (".staging", ".rollback", ".transactions"):
            (home / relative).mkdir(exist_ok=True)
        expected = snapshot(home)
        for barrier in ("after-skills", "after-runtime", "after-hooks-apply", "before-commit"):
            crashed_env = {**env, "DEV_RIGOR_TXN_CRASH_AT": f"uninstall:{barrier}"}
            run_nonzero(command(uninstaller, home, uninstall=True), crashed_env)
            run(transaction_command(home), env, 0)
            actual = snapshot(home)
            changed = sorted(key for key in set(actual) | set(expected) if actual.get(key) != expected.get(key))
            assert actual == expected, f"recovery after abrupt uninstall {barrier} changed the profile: {changed}"


def hooks_cas_and_serialization_scenario() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-rigor-hooks-cas-") as temporary:
        root = Path(temporary)
        home = root / "home"
        control = root / "control"
        control.mkdir()
        env = {**os.environ, "CI": "1"}
        installer = "install.ps1" if os.name == "nt" else "install.sh"
        run(command(installer, home), env, 0)
        for relative in (".staging", ".rollback", ".transactions"):
            (home / relative).mkdir(exist_ok=True)
        expected = snapshot(home)

        paused_env = {
            **env,
            "DEV_RIGOR_TXN_PAUSE_AT": "install:before-hooks-cas",
            "DEV_RIGOR_TXN_CONTROL_DIR": str(control),
        }
        process = subprocess.Popen(
            command(installer, home), cwd=ROOT, env=paused_env,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        ready = control / "install_before-hooks-cas.ready"
        wait_for_path(ready, process)

        loser = run_nonzero(command(installer, home), env)
        assert "lock" in (loser.stdout + loser.stderr).lower(), "concurrent installer did not visibly refuse the live transaction"

        hooks_path = home / "hooks.json"
        hooks = json.loads(hooks_path.read_text(encoding="utf-8"))
        hooks["foreignConcurrent"] = {"preserve": True}
        hooks_path.write_text(json.dumps(hooks, indent=2) + "\n", encoding="utf-8")
        expected["hooks.json"] = hashlib.sha256(hooks_path.read_bytes()).hexdigest()
        (control / "install_before-hooks-cas.continue").write_text("continue\n", encoding="utf-8")
        stdout, stderr = process.communicate(timeout=30)
        assert process.returncode != 0, f"hooks CAS accepted a concurrent foreign edit\n{stdout}\n{stderr}"
        actual = snapshot(home)
        changed = sorted(key for key in set(actual) | set(expected) if actual.get(key) != expected.get(key))
        assert actual == expected, f"CAS abort failed to preserve concurrent hooks bytes and roll back earlier surfaces: {changed}"


def main() -> int:
    for version in ("1.6.1", "1.6.2", "1.6.3"):
        scenario(version)
    markerless_near_match_refusal_scenario()
    clean_scenario()
    pristine_scenario()
    preexisting_scaffolding_scenario()
    later_foreign_content_scenario()
    owned_scaffolding_with_backups_scenario()
    missing_hooks_uninstall_scenario()
    ownership_refusal_scenario()
    empty_backup_container_rollback_scenario()
    abrupt_install_recovery_scenario()
    abrupt_uninstall_recovery_scenario()
    hooks_cas_and_serialization_scenario()
    candidate_v4_migration_scenario("pr9")
    candidate_v4_migration_scenario("pr11")
    current_state_scenario()
    print("upgrade matrix: 1.6.1, 1.6.2, 1.6.3, markerless near-match refusal, exact PR9/PR11 v4 migration, pristine, current-v4 repair, foreign hooks/trust PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
