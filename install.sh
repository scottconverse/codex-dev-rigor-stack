#!/usr/bin/env sh
set -eu

version="1.0.0"

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
skills_src="$repo_dir/skills"
target="${CODEX_HOME:-$HOME/.codex}/skills"
backup=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      target="$2"
      shift 2
      ;;
    --no-backup)
      backup=0
      shift
      ;;
    *)
      echo "usage: ./install.sh [--target DIR] [--no-backup]" >&2
      exit 2
      ;;
  esac
done

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
echo "Restart Codex Desktop to pick up updated skill metadata."
