#!/usr/bin/env bash
# dev-rigor-stack installer (macOS / Linux / Git Bash).
# Copies the vendored skills into your Claude Code skills directory.
#
# Usage:
#   ./install.sh                         # installs to $CLAUDE_CONFIG_DIR/skills or ~/.claude/skills
#   CLAUDE_CONFIG_DIR=/custom ./install.sh
#
# Re-running updates in place (each skill is replaced). No path assumptions.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$REPO_DIR/skills"
DEST_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DEST="$DEST_ROOT/skills"

if [ ! -d "$SKILLS_SRC" ]; then
  echo "ERROR: no skills/ directory found next to this script ($SKILLS_SRC)" >&2
  exit 1
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
echo "Installed $installed skill(s) to $DEST"
echo
echo "Next steps:"
echo "  * ponytail is an OPTIONAL third-party dependency (not bundled). For the code-minimalism"
echo "    lane the stack references, install it from https://github.com/DietrichGebert/ponytail"
echo "  * Optional: fold config/CLAUDE.md into your own ~/.claude/CLAUDE.md so the stack applies"
echo "    automatically. Review it first -- do not blindly overwrite your existing CLAUDE.md."
echo "  * Restart Claude Code (or reload skills) so it picks up the new skills."
