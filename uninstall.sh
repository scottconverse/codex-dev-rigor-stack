#!/usr/bin/env sh
set -eu

version="1.7.0"
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
codex_home="${CODEX_HOME:-$HOME/.codex}"
target="$codex_home/skills"
codex_home_explicit=0
target_explicit=0
skip_trust=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --codex-home)
      [ "$#" -ge 2 ] || { echo "--codex-home requires a value" >&2; exit 2; }
      codex_home="$2"; codex_home_explicit=1; shift 2
      ;;
    --target)
      [ "$#" -ge 2 ] || { echo "--target requires a value" >&2; exit 2; }
      target="$2"; target_explicit=1; shift 2
      ;;
    --skip-trust-revocation)
      skip_trust=1; shift
      ;;
    *)
      echo "usage: ./uninstall.sh [--codex-home DIR] [--target DIR] [--skip-trust-revocation]" >&2
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
  echo "Node.js is required by the Dev Rigor uninstaller, but node was not found on PATH." >&2
  exit 1
}

coordinator="$repo_dir/codex/install-transaction.js"
[ -f "$coordinator" ] || {
  echo "The shared Dev Rigor transaction coordinator is missing: $coordinator" >&2
  exit 1
}

if [ "$skip_trust" -eq 1 ]; then
  exec node "$coordinator" uninstall --codex-home "$codex_home" --target "$target" --skip-trust-revocation
fi
exec node "$coordinator" uninstall --codex-home "$codex_home" --target "$target"
