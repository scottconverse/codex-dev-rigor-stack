#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PublishedExecutable,
  [Parameter(Mandatory = $true)][string]$RebuiltExecutable
)

$ErrorActionPreference = 'Stop'

function Find-Bytes([byte[]]$Haystack, [byte[]]$Needle) {
  for ($offset = 0; $offset -le $Haystack.Length - $Needle.Length; $offset++) {
    $matches = $true
    for ($index = 0; $index -lt $Needle.Length; $index++) {
      if ($Haystack[$offset + $index] -ne $Needle[$index]) { $matches = $false; break }
    }
    if ($matches) { return $offset }
  }
  return -1
}

function Clear-Bytes([byte[]]$Bytes, [int]$Offset, [int]$Count) {
  for ($index = 0; $index -lt $Count; $index++) { $Bytes[$Offset + $index] = 0 }
}

function Get-NormalizedBytes([string]$Path) {
  $Resolved = (Resolve-Path -LiteralPath $Path).Path
  [byte[]]$Bytes = [IO.File]::ReadAllBytes($Resolved)
  if ($Bytes.Length -lt 256 -or $Bytes[0] -ne 0x4d -or $Bytes[1] -ne 0x5a) {
    throw "$Resolved is not a Windows PE executable."
  }

  $PeOffset = [BitConverter]::ToInt32($Bytes, 0x3c)
  if ([Text.Encoding]::ASCII.GetString($Bytes, $PeOffset, 4) -ne "PE`0`0") {
    throw "$Resolved has no valid PE signature."
  }
  # Classic .NET Framework csc varies only the PE timestamp and the assembly's
  # ModuleVersionId (stored once as text and once in the GUID metadata heap).
  Clear-Bytes $Bytes ($PeOffset + 8) 4

  $Assembly = [Reflection.Assembly]::LoadFile($Resolved)
  $Mvid = $Assembly.ManifestModule.ModuleVersionId
  [byte[]]$MvidBinary = $Mvid.ToByteArray()
  [byte[]]$MvidText = [Text.Encoding]::ASCII.GetBytes($Mvid.ToString('D').ToUpperInvariant())
  $BinaryOffset = Find-Bytes $Bytes $MvidBinary
  $TextOffset = Find-Bytes $Bytes $MvidText
  if ($BinaryOffset -lt 0 -or $TextOffset -lt 0) {
    throw "Could not locate both ModuleVersionId representations in $Resolved."
  }
  Clear-Bytes $Bytes $BinaryOffset $MvidBinary.Length
  Clear-Bytes $Bytes $TextOffset $MvidText.Length
  return $Bytes
}

[byte[]]$Published = Get-NormalizedBytes $PublishedExecutable
[byte[]]$Rebuilt = Get-NormalizedBytes $RebuiltExecutable
if ($Published.Length -ne $Rebuilt.Length) {
  throw "Binary provenance FAILED: lengths differ ($($Published.Length) vs $($Rebuilt.Length))."
}
for ($index = 0; $index -lt $Published.Length; $index++) {
  if ($Published[$index] -ne $Rebuilt[$index]) {
    throw "Binary provenance FAILED: first substantive byte difference at offset $index."
  }
}
Write-Host 'Binary provenance: byte-identical after normalizing PE timestamp and ModuleVersionId identity bytes'
