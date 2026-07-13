#!/usr/bin/env pwsh
# Generate a single portable bundle for non-Claude agents (ChatGPT, Gemini, Codex, etc.).
# Strips each skill's YAML frontmatter and concatenates the bodies -- PLUS every support
# file the skills reference (SKILL-LITE, references/, lanes/, templates/) -- into one
# Markdown file you can paste into a system prompt / custom instructions / AGENTS.md.
#
# The Claude-native skills stay canonical. This is a DERIVED artifact -- Claude-specific
# mechanics (the Workflow tool, /slash skills, haiku/sonnet routing) are left in and read
# as plain guidance to any model; nothing is removed from the source to serve other agents.
#
# Usage: ./export/export-portable.ps1 [output_file]
param([string]$OutFile)
$ErrorActionPreference = 'Stop'

$RepoDir = Split-Path -Parent $PSScriptRoot
if (-not $OutFile) { $OutFile = Join-Path $RepoDir 'portable-bundle.md' }
$Order = @('dev-rigor-stack','dev-rigor-stack-continuity','dev-rigor-stack-plan','dev-rigor-stack-build','dev-rigor-stack-proof-gate','dev-rigor-stack-audit-lite','dev-rigor-stack-audit-team','dev-rigor-stack-walkthrough','dev-rigor-stack-visitor-audit','dev-rigor-stack-gauntletgate','dev-rigor-stack-merge-gate','dev-rigor-stack-docs-gate','dev-rigor-stack-release','coder-tdd-qa','proof-gate','audit-lite','audit-team','gauntletgate','visitor-audit')

# Read as explicit UTF-8. On Windows PowerShell 5.1 a bare Get-Content on a BOM-less
# file falls back to the ANSI codepage and mojibakes every em dash / smart quote.
$Utf8 = [System.Text.UTF8Encoding]::new($false)
$EmDash = [char]0x2014  # em dash, built from a code point so this file stays pure ASCII (PS 5.1 ANSI trap)
function Get-BodyLines([string]$Path) {
  $text = [System.IO.File]::ReadAllText($Path, $Utf8)
  $lines = $text -split "`r?`n"
  $out = New-Object System.Collections.Generic.List[string]
  $infm = $false; $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if (-not $done) {
      if ($i -eq 0 -and $line -match '^---\s*$') { $infm = $true; continue }
      if ($infm -and $line -match '^---\s*$') { $infm = $false; $done = $true; continue }
      if ($infm) { continue }
      $done = $true
    }
    [void]$out.Add($line)
  }
  # A file ending in a newline splits into a trailing empty element awk never emits --
  # drop exactly one so both exporters produce byte-identical bundles.
  if ($out.Count -gt 0 -and $out[$out.Count - 1] -eq '') { $out.RemoveAt($out.Count - 1) }
  return $out
}

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# codex-dev-rigor-stack 1.0.0 $EmDash portable bundle")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Derived from the complete Codex bundle. Paste into any agent''s system prompt / AGENTS.md.')
[void]$sb.AppendLine('Host-specific mechanics read as plain guidance; canonical capabilities are not removed')
[void]$sb.AppendLine("or shortened to serve the export $EmDash the bundle is derived from the strong source.")
[void]$sb.AppendLine('Support files each skill references (references/, lanes/, templates/, SKILL-LITE) are')
[void]$sb.AppendLine('included after that skill''s main text, so no internal pointer dangles.')
[void]$sb.AppendLine('')

foreach ($s in $Order) {
  $dir = Join-Path $RepoDir "skills/$s"
  $f = Join-Path $dir 'SKILL.md'
  if (-not (Test-Path $f)) { continue }
  [void]$sb.AppendLine('---'); [void]$sb.AppendLine(''); [void]$sb.AppendLine("# skill: $s"); [void]$sb.AppendLine('')
  foreach ($line in (Get-BodyLines $f)) { [void]$sb.AppendLine($line) }
  [void]$sb.AppendLine('')
  # Support files, stable-sorted by relative path, each under a path-named heading.
  $support = @(Get-ChildItem -Path $dir -Recurse -Filter '*.md' |
    Where-Object { $_.Name -ne 'SKILL.md' } |
    ForEach-Object { $_.FullName.Substring($dir.Length + 1).Replace('\', '/') })
  # Ordinal (byte-order) sort to match the bash twin's LC_ALL=C sort exactly.
  [Array]::Sort($support, [System.StringComparer]::Ordinal)
  foreach ($rel in $support) {
    [void]$sb.AppendLine("## $s $EmDash support file: $rel")
    [void]$sb.AppendLine('')
    foreach ($line in (Get-BodyLines (Join-Path $dir $rel))) { [void]$sb.AppendLine($line) }
    [void]$sb.AppendLine('')
  }
}

# UTF-8 without BOM (avoids a BOM breaking downstream tooling).
[System.IO.File]::WriteAllText($OutFile, $sb.ToString().Replace("`r`n", "`n"), $Utf8)
Write-Host "Wrote portable bundle -> $OutFile"
