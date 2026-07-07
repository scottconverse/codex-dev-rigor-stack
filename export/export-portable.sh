#!/usr/bin/env bash
# Generate a single portable bundle for non-Claude agents (ChatGPT, Gemini, Codex, etc.).
# Strips each skill's YAML frontmatter and concatenates the bodies into one Markdown file
# you can paste into a system prompt / custom instructions / AGENTS.md.
#
# The Claude-native skills stay canonical. This is a DERIVED artifact — Claude-specific
# mechanics (the Workflow tool, /slash skills, haiku/sonnet routing) are left in and read
# as plain guidance to any model; nothing is removed from the source to serve other agents.
#
# Usage: ./export/export-portable.sh [output_file]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO_DIR/portable-bundle.md}"
ORDER="dev-rigor-stack coder-tdd-qa proof-gate audit-lite audit-team gauntletgate"

{
  echo "# dev-rigor-stack — portable bundle"
  echo
  echo "Derived from the Claude-native skills. Paste into any agent's system prompt / AGENTS.md."
  echo "Claude-specific mechanics (the Workflow tool, /slash skills, haiku/sonnet routing) read as"
  echo "plain guidance here — they are not removed from the source to serve other agents."
  echo
  for s in $ORDER; do
    f="$REPO_DIR/skills/$s/SKILL.md"
    [ -f "$f" ] || continue
    echo "---"
    echo
    echo "# skill: $s"
    echo
    # Strip only the FIRST YAML frontmatter block; keep every later '---' as body content.
    awk 'NR==1 && /^---[[:space:]]*$/ {infm=1; next}
         infm && /^---[[:space:]]*$/ {infm=0; next}
         infm {next}
         {print}' "$f"
    echo
  done
} > "$OUT"

echo "Wrote portable bundle -> $OUT"
