#!/usr/bin/env pwsh
# dev-rigor-stack installer (Windows PowerShell / PowerShell 7+).
# Copies the vendored skills into your agent's skills directory, and (for a default Claude
# install) also installs the always-on dev-rigor reflex hook and wires it into settings.json.
#
# Usage:
#   ./install.ps1                                  # -> $env:CLAUDE_CONFIG_DIR\skills or ~\.claude\skills
#   ./install.ps1 -Target ~/.codex/skills          # install skills elsewhere (e.g. Codex); no reflex hook
#
# Requires Node.js for the reflex hook (the six skills install without it). On a locked-down
# box, run this as:  powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Re-running updates in place (each skill is replaced; the hook re-wires idempotently). No path assumptions.
# NOTE: kept ASCII-only on purpose -- Windows PowerShell 5.1 reads a BOM-less script as
# ANSI, so non-ASCII characters (em dashes, smart quotes) would break the parser.
[CmdletBinding()]
param(
  [string]$Target
)
$ErrorActionPreference = 'Stop'

$SkillsSrc = Join-Path $PSScriptRoot 'skills'
$PluginSrc = Join-Path $PSScriptRoot 'plugin'
if (-not (Test-Path $SkillsSrc)) {
  throw "no skills/ directory found next to this script ($SkillsSrc)"
}

$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
if ($Target) {
  $Dest = $Target
} else {
  $Dest = Join-Path $ClaudeDir 'skills'
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "Installing dev-rigor-stack skills -> $Dest`n"

$installed = 0
foreach ($src in Get-ChildItem -Directory $SkillsSrc) {
  # NOTE: not $target -- PowerShell variable names are case-insensitive, so $target would
  # alias the $Target param and the loop would clobber it (breaking the reflex-hook check below).
  $skillDest = Join-Path $Dest $src.Name
  if (Test-Path $skillDest) { Remove-Item -Recurse -Force $skillDest }
  Copy-Item -Recurse $src.FullName $skillDest
  if (Test-Path (Join-Path $skillDest 'SKILL.md')) {
    Write-Host "  ok    $($src.Name)"
    $installed++
  } else {
    throw "FAIL $($src.Name): no SKILL.md landed"
  }
}

Write-Host "`nInstalled $installed stack skill(s) to $Dest"

# Always-on reflex hook -- default Claude install only (skipped for a custom -Target).
if ((-not $Target) -and (Test-Path $PluginSrc)) {
  $PluginDest = Join-Path $ClaudeDir 'dev-rigor-plugin'
  if (Test-Path $PluginDest) { Remove-Item -Recurse -Force $PluginDest }
  New-Item -ItemType Directory -Force -Path $PluginDest | Out-Null
  Copy-Item -Recurse (Join-Path $PluginSrc '*') $PluginDest
  Write-Host "  ok    dev-rigor plugin (reflex + router + grounding) -> $PluginDest"
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    node (Join-Path $PluginDest 'hooks/wire-settings.js') $ClaudeDir
  } else {
    Write-Host "  WARN  Node.js not found -- it is REQUIRED for the hooks. Skills installed fine;"
    Write-Host "        plugin files copied but no hooks were wired. Install Node.js"
    Write-Host "        and re-run, or add the hooks to settings.json by hand (see README)."
  }
} elseif ($Target) {
  Write-Host "  note  -Target set: skills only; the hooks are Claude-specific and were not wired."
}

Write-Host "`nNext steps:"
Write-Host "  * The reflex activates on your next session start (or /compact); the rigor router and"
Write-Host "    grounding check activate immediately for new sessions. Nothing else to run."
Write-Host "  * Optional: fold config/CLAUDE.md into your own ~/.claude/CLAUDE.md so the stack applies"
Write-Host "    automatically even without the hook. Review it first -- do not blindly overwrite your CLAUDE.md."
Write-Host "  * Restart your agent (or reload skills) so it picks up the new skills."
