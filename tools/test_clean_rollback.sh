#!/usr/bin/env sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
root=$(mktemp -d "${TMPDIR:-/tmp}/dev-rigor-clean-rollback.XXXXXX")
case "$root" in
  */dev-rigor-clean-rollback.*) ;;
  *) echo "unsafe temporary path: $root" >&2; exit 1 ;;
esac
trap 'rm -rf -- "$root"' EXIT HUP INT TERM

for point in mid-commit backup-finalization; do
  home="$root/$point"
  if CI=1 DEV_RIGOR_INSTALL_TEST_FAIL_AT="$point" \
      "$repo_dir/install.sh" --target "$home/skills"; then
    echo "injected $point failure unexpectedly succeeded" >&2
    exit 1
  fi
  if [ -n "$(find "$home" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    echo "$point left partial first-install artifacts:" >&2
    find "$home" -mindepth 1 -print >&2
    exit 1
  fi
  echo "$point clean first-install rollback passed"
done
