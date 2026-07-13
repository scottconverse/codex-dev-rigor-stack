#!/usr/bin/env sh
set -eu

codex_home="${CODEX_HOME:-$HOME/.codex}"
target="$codex_home/skills"
skip_trust=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --codex-home) codex_home="$2"; target="$2/skills"; shift 2 ;;
    --target) target="$2"; shift 2 ;;
    --skip-trust-revocation) skip_trust=1; shift ;;
    *) echo "usage: ./uninstall.sh [--codex-home DIR] [--target DIR] [--skip-trust-revocation]" >&2; exit 2 ;;
  esac
done
[ "$skip_trust" -eq 0 ] || [ -n "${CI:-}" ] || { echo "--skip-trust-revocation is restricted to isolated CI profiles" >&2; exit 1; }

order="dev-rigor-stack dev-rigor-stack-continuity dev-rigor-stack-plan dev-rigor-stack-build dev-rigor-stack-proof-gate dev-rigor-stack-audit-lite dev-rigor-stack-audit-team dev-rigor-stack-walkthrough dev-rigor-stack-visitor-audit dev-rigor-stack-gauntletgate dev-rigor-stack-merge-gate dev-rigor-stack-docs-gate dev-rigor-stack-release coder-tdd-qa proof-gate audit-lite audit-team gauntletgate visitor-audit"
runtime="$codex_home/dev-rigor-stack"
hooks="$codex_home/hooks.json"
wire="$runtime/hooks/wire-hooks.js"
revoker="$runtime/hooks/revoke-trust.js"
[ -f "$wire" ] || { echo "Installed Dev Rigor runtime is incomplete; refusing an ambiguous uninstall: $runtime" >&2; exit 1; }

transaction="$(date +%Y%m%d-%H%M%S)-$$"
stage="$codex_home/.staging/codex-dev-rigor-uninstall/$transaction"
stage_config="$stage/config"
rollback="$codex_home/.rollback/codex-dev-rigor-uninstall/$transaction"
rollback_skills="$rollback/skills"
rollback_runtime="$rollback/runtime"
rollback_hooks="$rollback/hooks.json"
trust_config="$codex_home/config.toml"
rollback_trust_config="$rollback/config.toml"
if [ -f "$hooks" ]; then hooks_existed=1; else hooks_existed=0; fi
if [ -f "$trust_config" ]; then trust_config_existed=1; else trust_config_existed=0; fi
committed=0

remove_empty_dir() { [ ! -d "$1" ] || rmdir "$1" 2>/dev/null || true; }
cleanup_scaffolding() {
  remove_empty_dir "$codex_home/.staging/codex-dev-rigor-uninstall"
  remove_empty_dir "$codex_home/.staging"
  remove_empty_dir "$codex_home/.rollback/codex-dev-rigor-uninstall"
  remove_empty_dir "$codex_home/.rollback"
}

rollback_uninstall() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e
  for name in $order; do
    [ ! -e "$rollback_skills/$name" ] || { rm -rf "$target/$name"; mv "$rollback_skills/$name" "$target/$name"; }
  done
  [ ! -e "$rollback_runtime" ] || { rm -rf "$runtime"; mv "$rollback_runtime" "$runtime"; }
  if [ -e "$rollback_hooks" ]; then rm -f "$hooks"; mv "$rollback_hooks" "$hooks"; elif [ "$hooks_existed" -eq 0 ]; then rm -f "$hooks"; fi
  if [ -e "$rollback_trust_config" ]; then cp "$rollback_trust_config" "$trust_config"; elif [ "$trust_config_existed" -eq 0 ]; then rm -f "$trust_config"; fi
  rm -rf "$stage" "$rollback"
  cleanup_scaffolding
  echo "Uninstall transaction failed and was rolled back." >&2
  exit "$status"
}
trap rollback_uninstall EXIT HUP INT TERM

mkdir -p "$stage_config" "$rollback_skills"
[ "$hooks_existed" -eq 0 ] || cp "$hooks" "$stage_config/hooks.json"
[ "$trust_config_existed" -eq 0 ] || cp "$trust_config" "$rollback_trust_config"
node "$wire" --remove "$stage_config" "$runtime" "$runtime"
if [ "$skip_trust" -eq 0 ]; then node "$revoker" "$codex_home" "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"; fi

count=0
for name in $order; do
  [ ! -e "$target/$name" ] || mv "$target/$name" "$rollback_skills/$name"
  count=$((count + 1))
  if [ -n "${CI:-}" ] && [ "${DEV_RIGOR_UNINSTALL_TEST_FAIL_AT:-}" = "mid-remove" ] && [ "$count" -eq 5 ]; then echo "Injected CI mid-remove uninstall failure" >&2; exit 1; fi
done
mv "$runtime" "$rollback_runtime"
[ "$hooks_existed" -eq 0 ] || mv "$hooks" "$rollback_hooks"
mv "$stage_config/hooks.json" "$hooks"
if [ -n "${CI:-}" ] && [ "${DEV_RIGOR_UNINSTALL_TEST_FAIL_AT:-}" = "config-commit" ]; then echo "Injected CI config-commit uninstall failure" >&2; exit 1; fi
committed=1

trap - EXIT HUP INT TERM
rm -rf "$stage" "$rollback"
cleanup_scaffolding
echo "Removed all owned Dev Rigor skills, runtime, hook definitions, and trusted hashes. Foreign configuration was preserved."
