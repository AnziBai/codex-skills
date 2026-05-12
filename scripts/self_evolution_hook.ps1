#!/usr/bin/env pwsh
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("post-commit", "post-merge", "pre-push")]
    [string]$Event
)

$ErrorActionPreference = "Continue"

$RepoCandidate = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = git -C $RepoCandidate rev-parse --show-toplevel 2>$null
if (-not $RepoRoot) {
    exit 0
}

$GitDir = git -C $RepoRoot rev-parse --git-dir 2>$null
if (-not $GitDir) {
    exit 0
}

if (-not [System.IO.Path]::IsPathRooted($GitDir)) {
    $GitDir = Join-Path $RepoRoot $GitDir
}

$Branch = git -C $RepoRoot branch --show-current 2>$null
if (-not $Branch) {
    $Branch = "detached"
}

$Head = git -C $RepoRoot rev-parse --short HEAD 2>$null
if (-not $Head) {
    $Head = "unknown"
}

$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$PendingFile = Join-Path $GitDir "self-evolution-pending.md"

$Content = @"
# Self-Evolution Pending

Generated: $Timestamp
Event: $Event
Branch: $Branch
HEAD: $Head

Run the `self-evolution` skill before the next stage closes. Produce a memory
update proposal first; do not silently modify project memory, wiki knowledge,
preference memory, or skills.

Project policy: docs/self-evolution-memory-system.md
"@

Set-Content -Path $PendingFile -Value $Content -Encoding UTF8

Write-Host ""
Write-Host "[self-evolution] Pending memory review recorded: $PendingFile"
Write-Host "[self-evolution] Next agent should run the self-evolution skill and propose updates before writing memory."
