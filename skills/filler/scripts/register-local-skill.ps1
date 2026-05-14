param(
  [string]$Destination = (Join-Path $HOME ".codex\skills\filler"),
  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Write-Result {
  param([object]$Payload)
  if ($Json) {
    $Payload | ConvertTo-Json -Depth 8
  } else {
    $Payload
  }
}

function Resolve-FullPath {
  param([string]$Path)
  $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "register-local-skill must be run inside the codex-skills repository."
}
$repoRoot = Resolve-FullPath $repoRoot.Trim()
$sourceRoot = Join-Path $repoRoot "skills\filler"
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "SKILL.md"))) {
  throw "filler source skill not found: $sourceRoot"
}

$destinationRoot = Resolve-FullPath $Destination
$skillRoot = Resolve-FullPath (Join-Path $HOME ".codex\skills")
$tempRoot = Resolve-FullPath ([System.IO.Path]::GetTempPath())
$isSkillDestination = $destinationRoot.StartsWith($skillRoot, [System.StringComparison]::OrdinalIgnoreCase)
$isTempDestination = $destinationRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)
if (-not ($isSkillDestination -or $isTempDestination)) {
  throw "Destination must stay under $skillRoot or $tempRoot"
}
$destinationLeaf = Split-Path -Leaf ($destinationRoot.TrimEnd([char[]]@("\", "/")))
if ($isSkillDestination -and $destinationLeaf -ne "filler") {
  throw "Skill destination must be the filler skill directory, not $destinationRoot"
}
if ($isTempDestination -and $destinationLeaf -notlike "filler-register-test-*") {
  throw "Temporary test destination must be named filler-register-test-*, not $destinationRoot"
}

$denySegments = @("node_modules", "profiles", "logs", "out", "tmp", "temp", ".cache", ".git")
$denyExtensions = @(".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".webm")
$tracked = & git -C $repoRoot ls-files -- "skills/filler"
if ($LASTEXITCODE -ne 0) { throw "git ls-files failed." }

New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null

$removed = 0
$preservedProfiles = Test-Path -LiteralPath (Join-Path $destinationRoot "profiles")
Get-ChildItem -LiteralPath $destinationRoot -Force | Where-Object { $_.Name -ne "profiles" } | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Recurse -Force
  $script:removed += 1
}

$copied = 0
$skipped = @()
foreach ($repoRelRaw in $tracked) {
  $repoRel = [string]$repoRelRaw
  if (-not $repoRel.StartsWith("skills/filler/")) { continue }
  $rel = $repoRel.Substring("skills/filler/".Length)
  $parts = $rel -split "/"
  $extension = [System.IO.Path]::GetExtension($rel).ToLowerInvariant()
  if ($parts | Where-Object { $denySegments -contains $_ }) {
    $skipped += $rel
    continue
  }
  if ($denyExtensions -contains $extension -or $rel -like "*.dom.html") {
    $skipped += $rel
    continue
  }
  $src = Join-Path $repoRoot ($repoRel -replace "/", "\")
  $dst = Join-Path $destinationRoot ($rel -replace "/", "\")
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-Item -LiteralPath $src -Destination $dst -Force
  $copied += 1
}

$keyFiles = @(
  "SKILL.md",
  "README.md",
  "scripts\filler.ps1",
  "scripts\register-local-skill.ps1",
  "draft-fill\src\cli.mjs",
  "draft-fill\src\browser-profile.mjs"
)
$hashes = @()
foreach ($rel in $keyFiles) {
  $src = Join-Path $sourceRoot $rel
  $dst = Join-Path $destinationRoot $rel
  $hashes += [pscustomobject]@{
    file = $rel
    source_exists = Test-Path -LiteralPath $src
    destination_exists = Test-Path -LiteralPath $dst
    match = ((Test-Path -LiteralPath $src) -and (Test-Path -LiteralPath $dst) -and ((Get-FileHash -Algorithm SHA256 -LiteralPath $src).Hash -eq (Get-FileHash -Algorithm SHA256 -LiteralPath $dst).Hash))
  }
}

Write-Result ([pscustomobject]@{
  ok = ($hashes | Where-Object { -not $_.match }).Count -eq 0
  source = $sourceRoot
  destination = $destinationRoot
  copied_files = $copied
  skipped_files = $skipped.Count
  skipped = $skipped
  removed_destination_entries = $removed
  preserved_profiles = $preservedProfiles
  key_hashes = $hashes
})
