#!/usr/bin/env pwsh
# Codex Desktop installer for codex-dev-rigor-stack.
[CmdletBinding()]
param(
  [string]$Target,
  [string]$CodexHome,
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
$Version = '1.6.3'

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
$TargetPreexisting = Test-Path -LiteralPath $Target

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
$RuntimeBackup = Join-Path $CodexHome ".backup\codex-dev-rigor-stack\$Stamp\runtime"
$HooksBackup = Join-Path $CodexHome ".backup\codex-dev-rigor-stack\$Stamp\hooks.json"
$TransactionId = "$Stamp-$PID-$([Guid]::NewGuid().ToString('N'))"
$StageRoot = Join-Path $CodexHome ".staging\codex-dev-rigor-stack\$TransactionId"
$StageSkills = Join-Path $StageRoot 'skills'
$StageRuntime = Join-Path $StageRoot 'runtime'
$StageConfigHome = Join-Path $StageRoot 'config'
$RollbackRoot = Join-Path $CodexHome ".rollback\codex-dev-rigor-stack\$TransactionId"
$RollbackSkills = Join-Path $RollbackRoot 'skills'
$RollbackRuntime = Join-Path $RollbackRoot 'runtime'
$RollbackHooks = Join-Path $RollbackRoot 'hooks.json'
$Created = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$TransactionSucceeded = $false
$RollbackSucceeded = $false

function Remove-EmptyDirectory([string]$Path) {
  if ((Test-Path -LiteralPath $Path -PathType Container) -and
      -not (Get-ChildItem -LiteralPath $Path -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $Path -Force
  }
}

function Remove-EmptyTransactionScaffolding {
  foreach ($Path in @(
    (Join-Path $CodexHome '.staging\codex-dev-rigor-stack'),
    (Join-Path $CodexHome '.staging'),
    (Join-Path $CodexHome '.rollback\codex-dev-rigor-stack'),
    (Join-Path $CodexHome '.rollback')
  )) { Remove-EmptyDirectory $Path }
  if (-not $TargetPreexisting) { Remove-EmptyDirectory $Target }
}

foreach ($Name in $Order) {
  $Src = Join-Path $SkillsSrc $Name
  if (-not (Test-Path -LiteralPath (Join-Path $Src 'SKILL.md'))) { throw "Missing skill source or SKILL.md: $Src" }
}

try {
  New-Item -ItemType Directory -Force -Path $Target, $StageSkills, $StageConfigHome, $RollbackSkills | Out-Null
  foreach ($Name in $Order) {
    $Staged = Join-Path $StageSkills $Name
    Copy-Item -LiteralPath (Join-Path $SkillsSrc $Name) -Destination $Staged -Recurse
    if (-not (Test-Path -LiteralPath (Join-Path $Staged 'SKILL.md'))) { throw "Staging failed for $Name" }
  }
  Copy-Item -LiteralPath $HookSrc -Destination $StageRuntime -Recurse
  if (Test-Path -LiteralPath $HooksConfig) { Copy-Item -LiteralPath $HooksConfig -Destination (Join-Path $StageConfigHome 'hooks.json') }
  & node (Join-Path $StageRuntime 'hooks\wire-hooks.js') $StageConfigHome $HookDest $StageRuntime
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $StageConfigHome 'hooks.json'))) {
    throw "Staged Codex hook wiring failed with exit code $LASTEXITCODE"
  }

  Write-Host "Installing codex-dev-rigor-stack $Version skills -> $Target"
  $CommitCount = 0
  foreach ($Name in $Order) {
    $Dest = Join-Path $Target $Name
    if (Test-Path -LiteralPath $Dest) { Move-Item -LiteralPath $Dest -Destination (Join-Path $RollbackSkills $Name) }
    else { [void]$Created.Add("skill:$Name") }
    Move-Item -LiteralPath (Join-Path $StageSkills $Name) -Destination $Dest
    Write-Host "  ok     $Name"
    $CommitCount++
    if ($env:CI -and $env:DEV_RIGOR_INSTALL_TEST_FAIL_AT -eq 'mid-commit' -and $CommitCount -eq 5) { throw 'Injected CI mid-commit failure' }
  }

  if (Test-Path -LiteralPath $HookDest) { Move-Item -LiteralPath $HookDest -Destination $RollbackRuntime }
  else { [void]$Created.Add('runtime') }
  Move-Item -LiteralPath $StageRuntime -Destination $HookDest

  if (Test-Path -LiteralPath $HooksConfig) { Move-Item -LiteralPath $HooksConfig -Destination $RollbackHooks }
  else { [void]$Created.Add('hooks') }
  Move-Item -LiteralPath (Join-Path $StageConfigHome 'hooks.json') -Destination $HooksConfig

  if (-not $NoBackup) {
    if ((Get-ChildItem -LiteralPath $RollbackSkills -Force | Measure-Object).Count -gt 0) {
      New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
      Get-ChildItem -LiteralPath $RollbackSkills -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $BackupRoot $_.Name) -Recurse }
    }
    if (Test-Path -LiteralPath $RollbackRuntime) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeBackup) | Out-Null; Copy-Item -LiteralPath $RollbackRuntime -Destination $RuntimeBackup -Recurse }
    if (Test-Path -LiteralPath $RollbackHooks) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $HooksBackup) | Out-Null; Copy-Item -LiteralPath $RollbackHooks -Destination $HooksBackup }
    if ($env:CI -and $env:DEV_RIGOR_INSTALL_TEST_FAIL_AT -eq 'backup-finalization') { throw 'Injected CI backup-finalization failure' }
  }
  $TransactionSucceeded = $true
  Write-Host ""
  Write-Host "Installed $($Order.Count) skill(s) transactionally."
  if (-not $NoBackup -and ((Test-Path -LiteralPath $BackupRoot) -or (Test-Path -LiteralPath (Split-Path -Parent $RuntimeBackup)))) { Write-Host "Backups retained under the .backup directories for $Stamp" }
}
catch {
  $InstallError = $_.Exception.Message
  try {
    foreach ($Name in $Order) {
      $Dest = Join-Path $Target $Name
      $Saved = Join-Path $RollbackSkills $Name
      if (Test-Path -LiteralPath $Saved) { if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }; Move-Item -LiteralPath $Saved -Destination $Dest }
      elseif ($Created.Contains("skill:$Name") -and (Test-Path -LiteralPath $Dest)) { Remove-Item -LiteralPath $Dest -Recurse -Force }
    }
    if (Test-Path -LiteralPath $RollbackRuntime) { if (Test-Path -LiteralPath $HookDest) { Remove-Item -LiteralPath $HookDest -Recurse -Force }; Move-Item -LiteralPath $RollbackRuntime -Destination $HookDest }
    elseif ($Created.Contains('runtime') -and (Test-Path -LiteralPath $HookDest)) { Remove-Item -LiteralPath $HookDest -Recurse -Force }
    if (Test-Path -LiteralPath $RollbackHooks) { if (Test-Path -LiteralPath $HooksConfig) { Remove-Item -LiteralPath $HooksConfig -Force }; Move-Item -LiteralPath $RollbackHooks -Destination $HooksConfig }
    elseif ($Created.Contains('hooks') -and (Test-Path -LiteralPath $HooksConfig)) { Remove-Item -LiteralPath $HooksConfig -Force }
    $RollbackSucceeded = $true
  }
  catch {
    throw "Install failed ($InstallError) and automatic rollback was incomplete. Recovery data was preserved at $RollbackRoot. Rollback error: $($_.Exception.Message)"
  }
  throw "Install transaction failed and was rolled back: $InstallError"
}
finally {
  if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force }
  if (($TransactionSucceeded -or $RollbackSucceeded) -and (Test-Path -LiteralPath $RollbackRoot)) { Remove-Item -LiteralPath $RollbackRoot -Recurse -Force }
  Remove-EmptyTransactionScaffolding
}

Write-Host "Active Codex hooks installed with content-bound SHA-256 guards: SessionStart, SubagentStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop."
Write-Host "Open DevRigorHookActivator-1.6.3.exe, review the six definitions, approve their exact hashes, then restart Codex Desktop."
