#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$PublishDirectory,
  [switch]$RunIntegrationTest,
  [string]$IntegrationCwd
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $Root 'dist' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$Compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Compiler)) {
  $Compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $Compiler)) { throw 'The Windows .NET Framework C# compiler was not found.' }

$Output = Join-Path $OutputDirectory 'DevRigorHookActivator.exe'
& $Compiler /nologo /target:winexe /optimize+ /platform:anycpu /out:$Output `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Drawing.dll `
  /reference:System.Web.Extensions.dll `
  /reference:System.Windows.Forms.dll `
  (Join-Path $Root 'DevRigorHookActivator.cs')
if ($LASTEXITCODE -ne 0) { throw "Activator build failed with exit code $LASTEXITCODE" }

$VersionInfo = (Get-Item -LiteralPath $Output).VersionInfo
if ($VersionInfo.FileVersion -ne '1.7.0.0') { throw "Unexpected FileVersion: $($VersionInfo.FileVersion)" }
if ($VersionInfo.ProductVersion -notlike '1.7.0*') { throw "Unexpected ProductVersion: $($VersionInfo.ProductVersion)" }
if ($VersionInfo.ProductName -ne 'Dev Rigor Stack') { throw "Unexpected ProductName: $($VersionInfo.ProductName)" }
$AssemblyVersion = [Reflection.AssemblyName]::GetAssemblyName($Output).Version.ToString()
if ($AssemblyVersion -ne '1.7.0.0') { throw "Unexpected assembly version: $AssemblyVersion" }

$SelfTest = Join-Path $OutputDirectory 'OwnershipSelfTest.exe'
& $Compiler /nologo /target:exe /optimize+ /platform:anycpu `
  /main:DevRigorStack.Desktop.OwnershipSelfTest /out:$SelfTest `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
  /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll `
  (Join-Path $Root 'DevRigorHookActivator.cs') (Join-Path $Root 'OwnershipSelfTest.cs')
if ($LASTEXITCODE -ne 0) { throw "Ownership self-test build failed with exit code $LASTEXITCODE" }
& $SelfTest
if ($LASTEXITCODE -ne 0) { throw "Ownership self-test failed with exit code $LASTEXITCODE" }
Remove-Item -LiteralPath $SelfTest -Force

if ($RunIntegrationTest) {
  if (-not $env:CODEX_HOME) { throw 'RunIntegrationTest requires an isolated CODEX_HOME.' }
  if (-not $IntegrationCwd) { $IntegrationCwd = Split-Path -Parent $Root }
  $UiTest = Join-Path $OutputDirectory 'ActivatorUiSelfTest.exe'
  & $Compiler /nologo /target:exe /optimize+ /platform:anycpu `
    /main:DevRigorStack.Desktop.ActivatorUiSelfTest /out:$UiTest `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
    /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll `
    (Join-Path $Root 'DevRigorHookActivator.cs') (Join-Path $Root 'ActivatorUiSelfTest.cs')
  if ($LASTEXITCODE -ne 0) { throw "Activator UI self-test build failed with exit code $LASTEXITCODE" }
  & $UiTest $IntegrationCwd
  if ($LASTEXITCODE -ne 0) { throw "Activator UI self-test failed with exit code $LASTEXITCODE" }
  Remove-Item -LiteralPath $UiTest -Force

  $IntegrationTest = Join-Path $OutputDirectory 'ActivatorIntegrationSelfTest.exe'
  & $Compiler /nologo /target:exe /optimize+ /platform:anycpu `
    /main:DevRigorStack.Desktop.ActivatorIntegrationSelfTest /out:$IntegrationTest `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
    /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll `
    (Join-Path $Root 'DevRigorHookActivator.cs') (Join-Path $Root 'ActivatorIntegrationSelfTest.cs')
  if ($LASTEXITCODE -ne 0) { throw "Activator integration self-test build failed with exit code $LASTEXITCODE" }
  & $IntegrationTest $IntegrationCwd
  if ($LASTEXITCODE -ne 0) { throw "Activator integration self-test failed with exit code $LASTEXITCODE" }
  Remove-Item -LiteralPath $IntegrationTest -Force
}

$Hash = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $OutputDirectory 'DevRigorHookActivator.exe.sha256') `
  -Value "$Hash  DevRigorHookActivator.exe" -Encoding ascii
Write-Host "Built $Output"
Write-Host "SHA256 $Hash"

if ($PublishDirectory) {
  New-Item -ItemType Directory -Force -Path $PublishDirectory | Out-Null
  $PublishedName = 'DevRigorHookActivator-1.7.0.exe'
  $Published = Join-Path $PublishDirectory $PublishedName
  Copy-Item -LiteralPath $Output -Destination $Published -Force
  Copy-Item -LiteralPath (Join-Path $Root 'DevRigorHookActivator.cs') `
    -Destination (Join-Path $PublishDirectory 'DevRigorHookActivator-1.7.0.cs') -Force
  Set-Content -LiteralPath "$Published.sha256" -Value "$Hash  $PublishedName" -Encoding ascii
  $SourceHash = (Get-FileHash -LiteralPath (Join-Path $Root 'DevRigorHookActivator.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
  $CompilerVersion = (Get-Item -LiteralPath $Compiler).VersionInfo.FileVersion
  $BuildRecord = [ordered]@{
    version = '1.7.0'
    binary_sha256 = $Hash
    source_sha256 = $SourceHash
    compiler = '.NET Framework csc.exe'
    compiler_version = $CompilerVersion
    assembly_version = $AssemblyVersion
    file_version = $VersionInfo.FileVersion
    product_version = $VersionInfo.ProductVersion
    source = 'desktop/DevRigorHookActivator.cs'
  } | ConvertTo-Json
  Set-Content -LiteralPath (Join-Path $PublishDirectory 'DevRigorHookActivator-1.7.0.build.json') `
    -Value $BuildRecord -Encoding ascii
  Write-Host "Published $Published"
}
