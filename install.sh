#!/usr/bin/env bash
# dev-rigor-stack installer (macOS / Linux / Git Bash).
# Copies the vendored skills into your agent's skills directory, and (for a default Claude
# install) also installs the always-on dev-rigor reflex hook and wires it into settings.json.
#
# Usage:
#   ./install.sh                                  # -> $CLAUDE_CONFIG_DIR/skills or ~/.claude/skills
#   ./install.sh --target ~/.codex/skills         # install skills elsewhere (e.g. Codex); no reflex hook
#   CLAUDE_CONFIG_DIR=/custom ./install.sh
#
# Requires Node.js for the reflex hook (the six skills install without it).
#
# Re-running updates in place (each skill is replaced; the hook re-wires idempotently). No path assumptions.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$REPO_DIR/skills"
PLUGIN_SRC="$REPO_DIR/plugin"
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    -h|--help)
      echo "usage: ./install.sh [--target <skills-dir>]"
      echo "  --target <dir>    install skills into <dir> (default: \$CLAUDE_CONFIG_DIR/skills or ~/.claude/skills)"
      echo "                    with --target, only skills are installed; the reflex hook is Claude-specific and is skipped"
      exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [ ! -d "$SKILLS_SRC" ]; then
  echo "ERROR: no skills/ directory found next to this script ($SKILLS_SRC)" >&2
  exit 1
fi

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -n "$TARGET" ]; then
  DEST="$TARGET"
else
  DEST="$CLAUDE_DIR/skills"
fi

mkdir -p "$DEST"
echo "Installing dev-rigor-stack skills -> $DEST"
echo

installed=0
for src in "$SKILLS_SRC"/*/; do
  name="$(basename "$src")"
  target="$DEST/$name"
  rm -rf "$target"
  cp -r "$src" "$target"
  if [ -f "$target/SKILL.md" ]; then
    printf "  ok    %s\n" "$name"
    installed=$((installed + 1))
  else
    printf "  FAIL  %s (no SKILL.md landed)\n" "$name" >&2
    exit 1
  fi
done

echo
echo "Installed $installed stack skill(s) to $DEST"

# Always-on reflex hook — default Claude install only (skipped for a custom --target).
if [ -z "$TARGET" ] && [ -d "$PLUGIN_SRC" ]; then
  PLUGIN_DEST="$CLAUDE_DIR/dev-rigor-plugin"
  rm -rf "$PLUGIN_DEST"
  mkdir -p "$PLUGIN_DEST"
  cp -r "$PLUGIN_SRC/." "$PLUGIN_DEST/"
  echo "  ok    dev-rigor reflex -> $PLUGIN_DEST"
  if command -v node >/dev/null 2>&1; then
    node "$PLUGIN_DEST/hooks/wire-settings.js" "$CLAUDE_DIR"
  else
    echo "  WARN  Node.js not found — it is REQUIRED for the reflex. Skills installed fine;"
    echo "        reflex files copied but the SessionStart hook was NOT wired. Install Node.js"
    echo "        and re-run, or add the hook to settings.json by hand (see README)."
  fi
elif [ -n "$TARGET" ]; then
  echo "  note  --target set: skills only; the always-on reflex hook is Claude-specific and was not wired."
fi

echo
echo "Next steps:"
echo "  * The reflex activates on your next session start (or /compact). Nothing else to run."
echo "  * Optional: fold config/CLAUDE.md into your own ~/.claude/CLAUDE.md so the stack applies"
echo "    automatically even without the hook. Review it first -- do not blindly overwrite your CLAUDE.md."
echo "  * Restart your agent (or reload skills) so it picks up the new skills."
