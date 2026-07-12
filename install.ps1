#!/usr/bin/env pwsh
# Codex Desktop installer for codex-dev-rigor-stack.
[CmdletBinding()]
param(
  [string]$Target,
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'

$Repo = $PSScriptRoot
$SkillsSrc = Join-Path $Repo 'skills'
if (-not (Test-Path -LiteralPath $SkillsSrc)) {
  throw "No skills directory found: $SkillsSrc"
}

if (-not $Target) {
  $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
  $Target = Join-Path $CodexHome 'skills'
}

$Order = @('dev-rigor-stack','coder-tdd-qa','proof-gate','audit-lite','audit-team','gauntletgate','visitor-audit')
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = Join-Path $Target ".backup\codex-dev-rigor-stack\$Stamp"

New-Item -ItemType Directory -Force -Path $Target | Out-Null
Write-Host "Installing codex-dev-rigor-stack skills -> $Target"

$installed = 0
foreach ($Name in $Order) {
  $Src = Join-Path $SkillsSrc $Name
  $Dest = Join-Path $Target $Name
  if (-not (Test-Path -LiteralPath (Join-Path $Src 'SKILL.md'))) {
    throw "Missing skill source or SKILL.md: $Src"
  }

  if ((Test-Path -LiteralPath $Dest) -and -not $NoBackup) {
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    Move-Item -LiteralPath $Dest -Destination (Join-Path $BackupRoot $Name)
    Write-Host "  backup $Name"
  } elseif (Test-Path -LiteralPath $Dest) {
    Remove-Item -LiteralPath $Dest -Recurse -Force
  }

  Copy-Item -LiteralPath $Src -Destination $Dest -Recurse
  if (-not (Test-Path -LiteralPath (Join-Path $Dest 'SKILL.md'))) {
    throw "Install failed, SKILL.md missing after copy: $Dest"
  }
  Write-Host "  ok     $Name"
  $installed++
}

Write-Host ""
Write-Host "Installed $installed skill(s)."
if ((Test-Path -LiteralPath $BackupRoot) -and -not $NoBackup) {
  Write-Host "Backups: $BackupRoot"
}
Write-Host "Restart Codex Desktop to pick up updated skill metadata."
