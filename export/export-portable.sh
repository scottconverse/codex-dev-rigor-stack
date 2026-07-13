#!/usr/bin/env bash
# Generate a single portable bundle for non-Claude agents (ChatGPT, Gemini, Codex, etc.).
# Strips each skill's YAML frontmatter and concatenates the bodies — PLUS every support
# file the skills reference (SKILL-LITE, references/, lanes/, templates/) — into one
# Markdown file you can paste into a system prompt / custom instructions / AGENTS.md.
#
# The Claude-native skills stay canonical. This is a DERIVED artifact — Claude-specific
# mechanics (the Workflow tool, /slash skills, haiku/sonnet routing) are left in and read
# as plain guidance to any model; nothing is removed from the source to serve other agents.
#
# Usage: ./export/export-portable.sh [output_file]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO_DIR/portable-bundle.md}"
ORDER="dev-rigor-stack dev-rigor-stack-continuity dev-rigor-stack-plan dev-rigor-stack-build dev-rigor-stack-proof-gate dev-rigor-stack-audit-lite dev-rigor-stack-audit-team dev-rigor-stack-walkthrough dev-rigor-stack-visitor-audit dev-rigor-stack-gauntletgate dev-rigor-stack-merge-gate dev-rigor-stack-docs-gate dev-rigor-stack-release coder-tdd-qa proof-gate audit-lite audit-team gauntletgate visitor-audit"

# Strip only the FIRST YAML frontmatter block; keep every later '---' as body content.
strip_frontmatter() {
  awk 'NR==1 && /^---[[:space:]]*$/ {infm=1; next}
       infm && /^---[[:space:]]*$/ {infm=0; next}
       infm {next}
       {sub(/\r$/, ""); print}' "$1"
}

{
  echo "# codex-dev-rigor-stack 1.6.0 — portable bundle"
  echo
  echo "Derived from the complete Codex bundle. Paste into any agent's system prompt / AGENTS.md."
  echo "Host-specific mechanics read as plain guidance; canonical capabilities are not removed"
  echo "or shortened to serve the export — the bundle is derived from the strong source."
  echo "Support files each skill references (references/, lanes/, templates/, SKILL-LITE) are"
  echo "included after that skill's main text, so no internal pointer dangles."
  echo
  for s in $ORDER; do
    dir="$REPO_DIR/skills/$s"
    f="$dir/SKILL.md"
    [ -f "$f" ] || continue
    echo "---"
    echo
    echo "# skill: $s"
    echo
    strip_frontmatter "$f"
    echo
    # Support files, in a stable order, each under a path-named heading.
    find "$dir" -name '*.md' ! -name 'SKILL.md' | LC_ALL=C sort | while read -r sup; do
      rel="${sup#"$dir"/}"
      echo "## $s — support file: $rel"
      echo
      strip_frontmatter "$sup"
      echo
    done
  done
} > "$OUT"

echo "Wrote portable bundle -> $OUT"
