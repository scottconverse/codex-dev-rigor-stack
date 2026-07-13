#!/usr/bin/env sh
set -eu

version="1.6.1"

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
skills_src="$repo_dir/skills"
target="${CODEX_HOME:-$HOME/.codex}/skills"
codex_home="${CODEX_HOME:-$HOME/.codex}"
codex_home_explicit=0
target_explicit=0
backup=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      target="$2"
      target_explicit=1
      shift 2
      ;;
    --codex-home)
      codex_home="$2"
      codex_home_explicit=1
      shift 2
      ;;
    --no-backup)
      backup=0
      shift
      ;;
    *)
      echo "usage: ./install.sh [--target DIR] [--codex-home DIR] [--no-backup]" >&2
      exit 2
      ;;
  esac
done

if [ "$codex_home_explicit" -eq 0 ]; then
  codex_home=$(dirname "$target")
elif [ "$target_explicit" -eq 0 ]; then
  target="$codex_home/skills"
fi
if [ -e "$target" ]; then target_preexisting=1; else target_preexisting=0; fi
command -v node >/dev/null 2>&1 || {
  echo "Node.js is required by the active Codex hooks, but node was not found on PATH." >&2
  exit 1
}

hook_src="$repo_dir/codex"
hook_dest="$codex_home/dev-rigor-stack"
hooks_config="$codex_home/hooks.json"
[ -f "$hook_src/hooks/dev-rigor-ground.js" ] || {
  echo "Active Codex hook runtime is incomplete: $hook_src" >&2
  exit 1
}
node "$hook_src/hooks/wire-hooks.js" --check "$codex_home" "$hook_src"

order="dev-rigor-stack dev-rigor-stack-continuity dev-rigor-stack-plan dev-rigor-stack-build dev-rigor-stack-proof-gate dev-rigor-stack-audit-lite dev-rigor-stack-audit-team dev-rigor-stack-walkthrough dev-rigor-stack-visitor-audit dev-rigor-stack-gauntletgate dev-rigor-stack-merge-gate dev-rigor-stack-docs-gate dev-rigor-stack-release coder-tdd-qa proof-gate audit-lite audit-team gauntletgate visitor-audit"
stamp=$(date +%Y%m%d-%H%M%S)
backup_root="$target/.backup/codex-dev-rigor-stack/$stamp"
for name in $order; do
  src="$skills_src/$name"
  [ -f "$src/SKILL.md" ] || { echo "Missing skill source or SKILL.md: $src" >&2; exit 1; }
done

transaction_id="$stamp-$$"
stage_root="$codex_home/.staging/codex-dev-rigor-stack/$transaction_id"
stage_skills="$stage_root/skills"
stage_runtime="$stage_root/runtime"
stage_config="$stage_root/config"
rollback_root="$codex_home/.rollback/codex-dev-rigor-stack/$transaction_id"
rollback_skills="$rollback_root/skills"
created_root="$rollback_root/created"
rollback_runtime="$rollback_root/runtime"
rollback_hooks="$rollback_root/hooks.json"
commit_started=0

remove_empty_dir() {
  [ ! -d "$1" ] || rmdir "$1" 2>/dev/null || true
}

cleanup_empty_scaffolding() {
  remove_empty_dir "$codex_home/.staging/codex-dev-rigor-stack"
  remove_empty_dir "$codex_home/.staging"
  remove_empty_dir "$codex_home/.rollback/codex-dev-rigor-stack"
  remove_empty_dir "$codex_home/.rollback"
  if [ "$target_preexisting" -eq 0 ]; then remove_empty_dir "$target"; fi
}

rollback_install() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e
  rollback_ok=1
  if [ "$commit_started" -eq 1 ]; then
    for name in $order; do
      dest="$target/$name"
      if [ -e "$rollback_skills/$name" ]; then
        rm -rf "$dest" || rollback_ok=0
        mv "$rollback_skills/$name" "$dest" || rollback_ok=0
      elif [ -e "$created_root/skill-$name" ]; then
        rm -rf "$dest" || rollback_ok=0
      fi
    done
    if [ -e "$rollback_runtime" ]; then rm -rf "$hook_dest" || rollback_ok=0; mv "$rollback_runtime" "$hook_dest" || rollback_ok=0; elif [ -e "$created_root/runtime" ]; then rm -rf "$hook_dest" || rollback_ok=0; fi
    if [ -e "$rollback_hooks" ]; then rm -f "$hooks_config" || rollback_ok=0; mv "$rollback_hooks" "$hooks_config" || rollback_ok=0; elif [ -e "$created_root/hooks" ]; then rm -f "$hooks_config" || rollback_ok=0; fi
  fi
  rm -rf "$stage_root"
  if [ "$rollback_ok" -eq 1 ]; then
    rm -rf "$rollback_root"
    cleanup_empty_scaffolding
    echo "Install transaction failed and was rolled back." >&2
  else
    echo "Install failed and automatic rollback was incomplete. Recovery data was preserved at $rollback_root." >&2
  fi
  exit "$status"
}
trap rollback_install EXIT HUP INT TERM

mkdir -p "$target" "$stage_skills" "$stage_config" "$rollback_skills" "$created_root"
for name in $order; do
  cp -R "$skills_src/$name" "$stage_skills/$name"
  [ -f "$stage_skills/$name/SKILL.md" ] || { echo "Staging failed for $name" >&2; exit 1; }
done
cp -R "$hook_src" "$stage_runtime"
if [ -f "$hooks_config" ]; then cp "$hooks_config" "$stage_config/hooks.json"; fi
node "$stage_runtime/hooks/wire-hooks.js" "$stage_config" "$hook_dest" "$stage_runtime"
[ -f "$stage_config/hooks.json" ] || { echo "Staged hook configuration missing" >&2; exit 1; }

echo "Installing codex-dev-rigor-stack $version skills -> $target"
commit_started=1
installed=0
for name in $order; do
  dest="$target/$name"

  if [ -e "$dest" ]; then mv "$dest" "$rollback_skills/$name"; else : > "$created_root/skill-$name"; fi
  mv "$stage_skills/$name" "$dest"
  echo "  ok     $name"
  installed=$((installed + 1))
  if [ "${CI:-}" ] && [ "${DEV_RIGOR_INSTALL_TEST_FAIL_AT:-}" = "mid-commit" ] && [ "$installed" -eq 5 ]; then echo "Injected CI mid-commit failure" >&2; exit 1; fi
done

runtime_backup="$codex_home/.backup/codex-dev-rigor-stack/$stamp/runtime"
hooks_backup="$codex_home/.backup/codex-dev-rigor-stack/$stamp/hooks.json"
if [ -e "$hook_dest" ]; then mv "$hook_dest" "$rollback_runtime"; else : > "$created_root/runtime"; fi
mv "$stage_runtime" "$hook_dest"
if [ -e "$hooks_config" ]; then mv "$hooks_config" "$rollback_hooks"; else : > "$created_root/hooks"; fi
mv "$stage_config/hooks.json" "$hooks_config"

if [ "$backup" -eq 1 ]; then
  if [ "$(ls -A "$rollback_skills")" ]; then mkdir -p "$backup_root"; cp -R "$rollback_skills"/. "$backup_root"/; fi
  if [ -e "$rollback_runtime" ]; then mkdir -p "$(dirname "$runtime_backup")"; cp -R "$rollback_runtime" "$runtime_backup"; fi
  if [ -e "$rollback_hooks" ]; then mkdir -p "$(dirname "$hooks_backup")"; cp "$rollback_hooks" "$hooks_backup"; fi
  if [ "${CI:-}" ] && [ "${DEV_RIGOR_INSTALL_TEST_FAIL_AT:-}" = "backup-finalization" ]; then echo "Injected CI backup-finalization failure" >&2; exit 1; fi
fi

trap - EXIT HUP INT TERM
rm -rf "$stage_root" "$rollback_root"
cleanup_empty_scaffolding

echo
echo "Installed $installed skill(s) transactionally."
if [ "$backup" -eq 1 ] && { [ -d "$backup_root" ] || [ -e "$runtime_backup" ] || [ -e "$hooks_backup" ]; }; then echo "Backups retained under the .backup directories for $stamp"; fi

echo "Active Codex hooks installed with content-bound SHA-256 guards: SessionStart, SubagentStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop."
echo "On Windows, open DevRigorHookActivator-1.6.1.exe and approve the six exact hook hashes. On other Codex clients, use the client's supported hook review UI. Then restart Codex."
