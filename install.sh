#!/usr/bin/env sh
set -eu

version="1.7.0"
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target="${CODEX_HOME:-$HOME/.codex}/skills"
codex_home="${CODEX_HOME:-$HOME/.codex}"
codex_home_explicit=0
target_explicit=0
backup=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      [ "$#" -ge 2 ] || { echo "--target requires a value" >&2; exit 2; }
      target="$2"; target_explicit=1; shift 2
      ;;
    --codex-home)
      [ "$#" -ge 2 ] || { echo "--codex-home requires a value" >&2; exit 2; }
      codex_home="$2"; codex_home_explicit=1; shift 2
      ;;
    --no-backup)
      backup=0; shift
      ;;
    *)
      echo "usage: ./install.sh [--target DIR] [--codex-home DIR] [--no-backup]" >&2
      exit 2
      ;;
  esac
done

if [ "$codex_home_explicit" -eq 0 ] && [ "$target_explicit" -eq 1 ]; then
  codex_home=$(dirname -- "$target")
elif [ "$codex_home_explicit" -eq 1 ] && [ "$target_explicit" -eq 0 ]; then
  target="$codex_home/skills"
fi

command -v node >/dev/null 2>&1 || {
  echo "Node.js is required by the Dev Rigor installer, but node was not found on PATH." >&2
  exit 1
}

coordinator="$repo_dir/codex/install-transaction.js"
[ -f "$coordinator" ] || {
  echo "The shared Dev Rigor transaction coordinator is missing: $coordinator" >&2
  exit 1
}

if [ "$backup" -eq 0 ]; then
  exec node "$coordinator" install --repo "$repo_dir" --codex-home "$codex_home" --target "$target" --no-backup
fi
exec node "$coordinator" install --repo "$repo_dir" --codex-home "$codex_home" --target "$target"
