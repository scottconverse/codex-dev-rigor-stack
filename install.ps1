#!/usr/bin/env pwsh
# Codex Desktop installer for codex-dev-rigor-stack.
[CmdletBinding()]
param(
  [string]$Target,
  [string]$CodexHome,
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
$Version = '1.6.0'

$Repo = $PSScriptRoot
$SkillsSrc = Join-Path $Repo 'skills'
if (-not (Test-Path -LiteralPath $SkillsSrc)) {
  throw "No skills directory found: $SkillsSrc"
}

if (-not $CodexHome) {
  if ($Target) {
    $CodexHome = Split-Path -Parent $Target
  } else {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
  }
}
if (-not $Target) {
  $Target = Join-Path $CodexHome 'skills'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required by the active Codex hooks, but node was not found on PATH.'
}

$HookSrc = Join-Path $Repo 'codex'
$HookDest = Join-Path $CodexHome 'dev-rigor-stack'
$HooksConfig = Join-Path $CodexHome 'hooks.json'
$SourceWireScript = Join-Path $HookSrc 'hooks\wire-hooks.js'
$WireScript = Join-Path $HookDest 'hooks\wire-hooks.js'
if (-not (Test-Path -LiteralPath (Join-Path $HookSrc 'hooks\dev-rigor-ground.js'))) {
  throw "Active Codex hook runtime is incomplete: $HookSrc"
}
& node $SourceWireScript --check $CodexHome $HookSrc
if ($LASTEXITCODE -ne 0) { throw "Codex hook configuration preflight failed with exit code $LASTEXITCODE" }

$Order = @('dev-rigor-stack','dev-rigor-stack-continuity','dev-rigor-stack-plan','dev-rigor-stack-build','dev-rigor-stack-proof-gate','dev-rigor-stack-audit-lite','dev-rigor-stack-audit-team','dev-rigor-stack-walkthrough','dev-rigor-stack-visitor-audit','dev-rigor-stack-gauntletgate','dev-rigor-stack-merge-gate','dev-rigor-stack-docs-gate','dev-rigor-stack-release','coder-tdd-qa','proof-gate','audit-lite','audit-team','gauntletgate','visitor-audit')
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = Join-Path $Target ".backup\codex-dev-rigor-stack\$Stamp"

New-Item -ItemType Directory -Force -Path $Target | Out-Null
Write-Host "Installing codex-dev-rigor-stack $Version skills -> $Target"

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

$RuntimeBackup = Join-Path $CodexHome ".backup\codex-dev-rigor-stack\$Stamp\runtime"
if ((Test-Path -LiteralPath $HookDest) -and -not $NoBackup) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeBackup) | Out-Null
  Move-Item -LiteralPath $HookDest -Destination $RuntimeBackup
  Write-Host "  backup active hook runtime"
} elseif (Test-Path -LiteralPath $HookDest) {
  Remove-Item -LiteralPath $HookDest -Recurse -Force
}
Copy-Item -LiteralPath $HookSrc -Destination $HookDest -Recurse
if (-not (Test-Path -LiteralPath $WireScript)) {
  throw "Hook install failed, wire-hooks.js missing after copy: $WireScript"
}
& node $WireScript $CodexHome $HookDest
if ($LASTEXITCODE -ne 0) { throw "Codex hook wiring failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $HooksConfig)) { throw "Codex hook wiring did not create $HooksConfig" }

Write-Host "Active Codex hooks installed: SessionStart, SubagentStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop."
Write-Host "Open /hooks, review and trust the dev-rigor definitions, then restart Codex Desktop."
