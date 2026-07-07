#!/usr/bin/env pwsh
# Generate a single portable bundle for non-Claude agents (ChatGPT, Gemini, Codex, etc.).
# Strips each skill's YAML frontmatter and concatenates the bodies into one Markdown file
# you can paste into a system prompt / custom instructions / AGENTS.md.
#
# The Claude-native skills stay canonical. This is a DERIVED artifact — Claude-specific
# mechanics (the Workflow tool, /slash skills, haiku/sonnet routing) are left in and read
# as plain guidance to any model; nothing is removed from the source to serve other agents.
#
# Usage: ./export/export-portable.ps1 [output_file]
param([string]$OutFile)
$ErrorActionPreference = 'Stop'

$RepoDir = Split-Path -Parent $PSScriptRoot
if (-not $OutFile) { $OutFile = Join-Path $RepoDir 'portable-bundle.md' }
$Order = @('dev-rigor-stack','coder-tdd-qa','proof-gate','audit-lite','audit-team','gauntletgate')

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('# dev-rigor-stack — portable bundle')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Derived from the Claude-native skills. Paste into any agent''s system prompt / AGENTS.md.')
[void]$sb.AppendLine('Claude-specific mechanics (the Workflow tool, /slash skills, haiku/sonnet routing) read as')
[void]$sb.AppendLine('plain guidance here — they are not removed from the source to serve other agents.')
[void]$sb.AppendLine('')

foreach ($s in $Order) {
  $f = Join-Path $RepoDir "skills/$s/SKILL.md"
  if (-not (Test-Path $f)) { continue }
  [void]$sb.AppendLine('---'); [void]$sb.AppendLine(''); [void]$sb.AppendLine("# skill: $s"); [void]$sb.AppendLine('')
  $lines = Get-Content -LiteralPath $f
  $infm = $false; $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if (-not $done) {
      if ($i -eq 0 -and $line -match '^---\s*$') { $infm = $true; continue }
      if ($infm -and $line -match '^---\s*$') { $infm = $false; $done = $true; continue }
      if ($infm) { continue }
      $done = $true
    }
    [void]$sb.AppendLine($line)
  }
  [void]$sb.AppendLine('')
}

# UTF-8 without BOM (avoids a BOM breaking downstream tooling).
[System.IO.File]::WriteAllText($OutFile, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote portable bundle -> $OutFile"
