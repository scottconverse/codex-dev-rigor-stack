#!/usr/bin/env pwsh
# Transactional Codex Desktop uninstaller for owned dev-rigor-stack components.
[CmdletBinding()]
param(
  [string]$Target,
  [string]$CodexHome,
  [switch]$SkipTrustRevocation
)

$ErrorActionPreference = 'Stop'
if ($SkipTrustRevocation -and -not $env:CI) { throw '-SkipTrustRevocation is restricted to isolated CI profiles.' }
if (-not $CodexHome) { $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' } }
if (-not $Target) { $Target = Join-Path $CodexHome 'skills' }

$Order = @('dev-rigor-stack','dev-rigor-stack-continuity','dev-rigor-stack-plan','dev-rigor-stack-build','dev-rigor-stack-proof-gate','dev-rigor-stack-audit-lite','dev-rigor-stack-audit-team','dev-rigor-stack-walkthrough','dev-rigor-stack-visitor-audit','dev-rigor-stack-gauntletgate','dev-rigor-stack-merge-gate','dev-rigor-stack-docs-gate','dev-rigor-stack-release','coder-tdd-qa','proof-gate','audit-lite','audit-team','gauntletgate','visitor-audit')
$HookDest = Join-Path $CodexHome 'dev-rigor-stack'
$HooksConfig = Join-Path $CodexHome 'hooks.json'
$Wire = Join-Path $HookDest 'hooks\wire-hooks.js'
$Revoker = Join-Path $HookDest 'hooks\revoke-trust.js'
if (-not (Test-Path -LiteralPath $Wire)) { throw "Installed Dev Rigor runtime is incomplete; refusing an ambiguous uninstall: $HookDest" }

$TransactionId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID-$([guid]::NewGuid().ToString('N'))"
$StageRoot = Join-Path $CodexHome ".staging\codex-dev-rigor-uninstall\$TransactionId"
$StageConfig = Join-Path $StageRoot 'config'
$RollbackRoot = Join-Path $CodexHome ".rollback\codex-dev-rigor-uninstall\$TransactionId"
$RollbackSkills = Join-Path $RollbackRoot 'skills'
$RollbackRuntime = Join-Path $RollbackRoot 'runtime'
$RollbackHooks = Join-Path $RollbackRoot 'hooks.json'
$TrustConfig = Join-Path $CodexHome 'config.toml'
$RollbackTrustConfig = Join-Path $RollbackRoot 'config.toml'
$HooksExisted = Test-Path -LiteralPath $HooksConfig
$TrustConfigExisted = Test-Path -LiteralPath $TrustConfig
$Committed = $false
$RolledBack = $false

function Remove-EmptyDirectory([string]$Path) {
  if ((Test-Path -LiteralPath $Path -PathType Container) -and -not (Get-ChildItem -LiteralPath $Path -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $Path -Force
  }
}
function Remove-EmptyScaffolding {
  foreach ($Path in @(
    (Join-Path $CodexHome '.staging\codex-dev-rigor-uninstall'),
    (Join-Path $CodexHome '.staging'),
    (Join-Path $CodexHome '.rollback\codex-dev-rigor-uninstall'),
    (Join-Path $CodexHome '.rollback')
  )) { Remove-EmptyDirectory $Path }
}

try {
  New-Item -ItemType Directory -Force -Path $StageConfig, $RollbackSkills | Out-Null
  if ($HooksExisted) { Copy-Item -LiteralPath $HooksConfig -Destination (Join-Path $StageConfig 'hooks.json') }
  if ($TrustConfigExisted) { Copy-Item -LiteralPath $TrustConfig -Destination $RollbackTrustConfig }
  & node $Wire --remove $StageConfig $HookDest $HookDest
  if ($LASTEXITCODE -ne 0) { throw "Hook-removal staging failed with exit code $LASTEXITCODE" }

  if (-not $SkipTrustRevocation) {
    & node $Revoker $CodexHome $PSScriptRoot
    if ($LASTEXITCODE -ne 0) { throw "Hook trust revocation failed with exit code $LASTEXITCODE" }
  }

  $Count = 0
  foreach ($Name in $Order) {
    $Skill = Join-Path $Target $Name
    if (Test-Path -LiteralPath $Skill) { Move-Item -LiteralPath $Skill -Destination (Join-Path $RollbackSkills $Name) }
    $Count++
    if ($env:CI -and $env:DEV_RIGOR_UNINSTALL_TEST_FAIL_AT -eq 'mid-remove' -and $Count -eq 5) { throw 'Injected CI mid-remove uninstall failure' }
  }
  Move-Item -LiteralPath $HookDest -Destination $RollbackRuntime
  if ($HooksExisted) { Move-Item -LiteralPath $HooksConfig -Destination $RollbackHooks }
  Move-Item -LiteralPath (Join-Path $StageConfig 'hooks.json') -Destination $HooksConfig
  if ($env:CI -and $env:DEV_RIGOR_UNINSTALL_TEST_FAIL_AT -eq 'config-commit') { throw 'Injected CI config-commit uninstall failure' }
  $Committed = $true
}
catch {
  $Failure = $_.Exception.Message
  try {
    foreach ($Name in $Order) {
      $Saved = Join-Path $RollbackSkills $Name
      $Skill = Join-Path $Target $Name
      if (Test-Path -LiteralPath $Saved) { if (Test-Path -LiteralPath $Skill) { Remove-Item -LiteralPath $Skill -Recurse -Force }; Move-Item -LiteralPath $Saved -Destination $Skill }
    }
    if (Test-Path -LiteralPath $RollbackRuntime) { if (Test-Path -LiteralPath $HookDest) { Remove-Item -LiteralPath $HookDest -Recurse -Force }; Move-Item -LiteralPath $RollbackRuntime -Destination $HookDest }
    if (Test-Path -LiteralPath $RollbackHooks) { if (Test-Path -LiteralPath $HooksConfig) { Remove-Item -LiteralPath $HooksConfig -Force }; Move-Item -LiteralPath $RollbackHooks -Destination $HooksConfig }
    elseif (-not $HooksExisted -and (Test-Path -LiteralPath $HooksConfig)) { Remove-Item -LiteralPath $HooksConfig -Force }
    if (Test-Path -LiteralPath $RollbackTrustConfig) { Copy-Item -LiteralPath $RollbackTrustConfig -Destination $TrustConfig -Force }
    elseif (-not $TrustConfigExisted -and (Test-Path -LiteralPath $TrustConfig)) { Remove-Item -LiteralPath $TrustConfig -Force }
    $RolledBack = $true
  } catch { throw "Uninstall failed ($Failure) and rollback was incomplete. Recovery data remains at $RollbackRoot. $($_.Exception.Message)" }
  throw "Uninstall transaction failed and was rolled back: $Failure"
}
finally {
  if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force }
  if (($Committed -or $RolledBack) -and (Test-Path -LiteralPath $RollbackRoot)) { Remove-Item -LiteralPath $RollbackRoot -Recurse -Force }
  Remove-EmptyScaffolding
}

if (Test-Path -LiteralPath $RollbackRoot) { throw "Uninstall recovery data unexpectedly remains: $RollbackRoot" }
Write-Host "Removed all owned Dev Rigor skills, runtime, hook definitions, and trusted hashes. Foreign configuration was preserved."
