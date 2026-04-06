#Requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSCommandPath
Set-Location $repoRoot

& (Join-Path $repoRoot "make.ps1") deploy @args
exit $LASTEXITCODE
