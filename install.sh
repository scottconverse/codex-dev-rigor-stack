#!/usr/bin/env sh
set -eu

version="1.6.0"

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

mkdir -p "$target"
echo "Installing codex-dev-rigor-stack $version skills -> $target"

installed=0
for name in $order; do
  src="$skills_src/$name"
  dest="$target/$name"
  [ -f "$src/SKILL.md" ] || { echo "Missing skill source or SKILL.md: $src" >&2; exit 1; }

  if [ -e "$dest" ] && [ "$backup" -eq 1 ]; then
    mkdir -p "$backup_root"
    mv "$dest" "$backup_root/$name"
    echo "  backup $name"
  elif [ -e "$dest" ]; then
    rm -rf "$dest"
  fi

  cp -R "$src" "$dest"
  [ -f "$dest/SKILL.md" ] || { echo "Install failed, SKILL.md missing after copy: $dest" >&2; exit 1; }
  echo "  ok     $name"
  installed=$((installed + 1))
done

echo
echo "Installed $installed skill(s)."
if [ -d "$backup_root" ] && [ "$backup" -eq 1 ]; then
  echo "Backups: $backup_root"
fi

runtime_backup="$codex_home/.backup/codex-dev-rigor-stack/$stamp/runtime"
if [ -e "$hook_dest" ] && [ "$backup" -eq 1 ]; then
  mkdir -p "$(dirname "$runtime_backup")"
  mv "$hook_dest" "$runtime_backup"
  echo "  backup active hook runtime"
elif [ -e "$hook_dest" ]; then
  rm -rf "$hook_dest"
fi
cp -R "$hook_src" "$hook_dest"
[ -f "$hook_dest/hooks/wire-hooks.js" ] || {
  echo "Hook install failed, wire-hooks.js missing after copy: $hook_dest/hooks/wire-hooks.js" >&2
  exit 1
}
node "$hook_dest/hooks/wire-hooks.js" "$codex_home" "$hook_dest"
[ -f "$hooks_config" ] || { echo "Codex hook wiring did not create $hooks_config" >&2; exit 1; }

echo "Active Codex hooks installed: SessionStart, SubagentStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop."
echo "Open /hooks, review and trust the dev-rigor definitions, then restart Codex Desktop."
