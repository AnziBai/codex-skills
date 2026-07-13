[CmdletBinding()]
param(
    [string]$DestinationRoot,
    [switch]$Force,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'

$SkillRoot = Split-Path -Parent $PSScriptRoot
$SkillName = Split-Path -Leaf $SkillRoot

if (-not $DestinationRoot) {
    $CodexHome = if ($env:CODEX_HOME) {
        $env:CODEX_HOME
    }
    else {
        Join-Path $HOME '.codex'
    }
    $DestinationRoot = Join-Path $CodexHome 'skills'
}

$DestinationRoot = [System.IO.Path]::GetFullPath($DestinationRoot)
$Destination = Join-Path $DestinationRoot $SkillName
$Source = [System.IO.Path]::GetFullPath($SkillRoot)

if ($Source.TrimEnd('\') -ieq ([System.IO.Path]::GetFullPath($Destination)).TrimEnd('\')) {
    $Result = [ordered]@{
        status = 'PASS'
        action = 'already_registered'
        source = $Source
        destination = $Destination
    }
    if ($Json) { $Result | ConvertTo-Json -Depth 4 } else { $Result }
    exit 0
}

$DestinationExists = Test-Path -LiteralPath $Destination
if ($DestinationExists -and -not $Force) {
    throw "Destination already exists: $Destination. Re-run with -Force only after reviewing the existing skill."
}

New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
$Temporary = Join-Path $DestinationRoot ('.' + $SkillName + '.install-' + [guid]::NewGuid().ToString('N'))
$Backup = Join-Path $DestinationRoot ('.' + $SkillName + '.backup-' + [guid]::NewGuid().ToString('N'))

try {
    Copy-Item -LiteralPath $Source -Destination $Temporary -Recurse
    if (-not (Test-Path -LiteralPath (Join-Path $Temporary 'SKILL.md') -PathType Leaf)) {
        throw 'Copied skill is missing SKILL.md.'
    }
    if ($DestinationExists) {
        Move-Item -LiteralPath $Destination -Destination $Backup
    }
    try {
        Move-Item -LiteralPath $Temporary -Destination $Destination
    }
    catch {
        if (Test-Path -LiteralPath $Backup) {
            Move-Item -LiteralPath $Backup -Destination $Destination
        }
        throw
    }
    if (Test-Path -LiteralPath $Backup) {
        Remove-Item -LiteralPath $Backup -Recurse -Force
    }
}
finally {
    if (Test-Path -LiteralPath $Temporary) {
        Remove-Item -LiteralPath $Temporary -Recurse -Force
    }
    if ((Test-Path -LiteralPath $Backup) -and -not (Test-Path -LiteralPath $Destination)) {
        Move-Item -LiteralPath $Backup -Destination $Destination
    }
}

$Result = [ordered]@{
    status = 'PASS'
    action = if ($DestinationExists) { 'replaced' } else { 'installed' }
    source = $Source
    destination = $Destination
    restart_required = $true
}

if ($Json) {
    $Result | ConvertTo-Json -Depth 4
}
else {
    $Result
}
