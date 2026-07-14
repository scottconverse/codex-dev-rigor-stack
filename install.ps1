#!/usr/bin/env pwsh
# Codex Desktop installer for codex-dev-rigor-stack.
[CmdletBinding()]
param(
  [string]$Target,
  [string]$CodexHome,
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
$Version = '1.7.0'

$Repo = $PSScriptRoot
if (-not $CodexHome) {
  if ($Target) {
    $CodexHome = Split-Path -Parent ([IO.Path]::GetFullPath($Target))
  } else {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
  }
}
if (-not $Target) { $Target = Join-Path $CodexHome 'skills' }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required by the Dev Rigor installer, but node was not found on PATH.'
}

$Coordinator = Join-Path $Repo 'codex\install-transaction.js'
if (-not (Test-Path -LiteralPath $Coordinator -PathType Leaf)) {
  throw "The shared Dev Rigor transaction coordinator is missing: $Coordinator"
}

$Arguments = @(
  $Coordinator,
  'install',
  '--repo', $Repo,
  '--codex-home', ([IO.Path]::GetFullPath($CodexHome)),
  '--target', ([IO.Path]::GetFullPath($Target))
)
if ($NoBackup) { $Arguments += '--no-backup' }

& node @Arguments
$ExitCode = $LASTEXITCODE
if ($ExitCode -ne 0) { exit $ExitCode }
