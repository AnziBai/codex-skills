[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$SkillRoot = Split-Path -Parent $PSScriptRoot
$PythonTest = Join-Path $SkillRoot 'tests\test_publish_gzh.py'
$RegisterScript = Join-Path $PSScriptRoot 'register-local-skill.ps1'

python $PythonTest
if ($LASTEXITCODE -ne 0) {
    throw "Python tests failed with exit code $LASTEXITCODE."
}

$TextFiles = Get-ChildItem -LiteralPath $SkillRoot -Recurse -File |
    Where-Object { $_.Extension -in '.md', '.py', '.ps1', '.yaml', '.yml', '.json', '.toml' }
$SecretPattern = @(
    'gho_[A-Za-z0-9]{20,}'
    'github_pat_[A-Za-z0-9_]{20,}'
    'sk-[A-Za-z0-9]{20,}'
    'AKIA[0-9A-Z]{16}'
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
) -join '|'
$PrivatePathPattern = 'C:[\\/]+Users[\\/]+(?:Administrator|anzib)(?:[\\/]|$)'

$SecretMatches = $TextFiles | Select-String -Pattern $SecretPattern
if ($SecretMatches) {
    throw "Secret-like content found in publish-gzh: $($SecretMatches.Path -join ', ')"
}

$PrivatePathMatches = $TextFiles | Select-String -Pattern $PrivatePathPattern
if ($PrivatePathMatches) {
    throw "Machine-specific user path found in publish-gzh: $($PrivatePathMatches.Path -join ', ')"
}

if (-not (Test-Path -LiteralPath (Join-Path $SkillRoot 'agents\openai.yaml') -PathType Leaf)) {
    throw 'agents/openai.yaml is missing.'
}

$TemporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('publish-gzh-test-' + [guid]::NewGuid().ToString('N'))
$TemporarySkills = Join-Path $TemporaryRoot 'skills'

try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $RegisterScript `
        -DestinationRoot $TemporarySkills -Json | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Registration test failed with exit code $LASTEXITCODE."
    }

    $InstalledSkill = Join-Path $TemporarySkills 'publish-gzh'
    if (-not (Test-Path -LiteralPath (Join-Path $InstalledSkill 'SKILL.md') -PathType Leaf)) {
        throw "Registration test did not install SKILL.md under $InstalledSkill."
    }

    & powershell -NoProfile -ExecutionPolicy Bypass -File $RegisterScript `
        -DestinationRoot $TemporarySkills -Force -Json | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Registration replacement test failed with exit code $LASTEXITCODE."
    }

    $InstalledCli = Join-Path $InstalledSkill 'scripts\publish_gzh.py'
    python $InstalledCli doctor --project-root $TemporaryRoot --mode write --json | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Installed CLI smoke test failed with exit code $LASTEXITCODE."
    }
}
finally {
    if (Test-Path -LiteralPath $TemporaryRoot) {
        $ResolvedTemp = [System.IO.Path]::GetFullPath($TemporaryRoot)
        $SystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if (-not $ResolvedTemp.StartsWith($SystemTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clean a path outside the system temp directory: $ResolvedTemp"
        }
        Remove-Item -LiteralPath $ResolvedTemp -Recurse -Force
    }
}

Write-Output 'publish-gzh tests passed.'
