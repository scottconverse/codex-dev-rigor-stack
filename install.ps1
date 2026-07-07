#!/usr/bin/env pwsh
# dev-rigor-stack installer (Windows PowerShell / PowerShell 7+).
# Copies the vendored skills into your Claude Code skills directory.
#
# Usage:
#   ./install.ps1                                  # -> $env:CLAUDE_CONFIG_DIR\skills or ~\.claude\skills
#   $env:CLAUDE_CONFIG_DIR = 'C:\custom'; ./install.ps1
#
# Re-running updates in place (each skill is replaced). No path assumptions.
$ErrorActionPreference = 'Stop'

$SkillsSrc = Join-Path $PSScriptRoot 'skills'
$DestRoot  = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$Dest      = Join-Path $DestRoot 'skills'

if (-not (Test-Path $SkillsSrc)) {
  throw "no skills/ directory found next to this script ($SkillsSrc)"
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "Installing dev-rigor-stack skills -> $Dest`n"

$installed = 0
foreach ($src in Get-ChildItem -Directory $SkillsSrc) {
  $target = Join-Path $Dest $src.Name
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Copy-Item -Recurse $src.FullName $target
  if (Test-Path (Join-Path $target 'SKILL.md')) {
    Write-Host "  ok    $($src.Name)"
    $installed++
  } else {
    throw "FAIL $($src.Name): no SKILL.md landed"
  }
}

Write-Host "`nInstalled $installed skill(s) to $Dest`n"
Write-Host "Next steps:"
Write-Host "  * ponytail is an OPTIONAL third-party dependency (not bundled). For the code-minimalism"
Write-Host "    lane the stack references, install it from https://github.com/DietrichGebert/ponytail"
Write-Host "  * Optional: fold config/CLAUDE.md into your own ~/.claude/CLAUDE.md so the stack applies"
Write-Host "    automatically. Review it first -- do not blindly overwrite your existing CLAUDE.md."
Write-Host "  * Restart Claude Code (or reload skills) so it picks up the new skills."
