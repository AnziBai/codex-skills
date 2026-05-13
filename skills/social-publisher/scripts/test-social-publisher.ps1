param(
  [string]$PublisherScript = (Join-Path $PSScriptRoot "social-publisher.ps1")
)

$ErrorActionPreference = "Stop"

$SkillRoot = Split-Path -Parent $PSScriptRoot

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Write-JsonFile {
  param([string]$Path, [object]$Value)
  $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Invoke-Publisher {
  param([string[]]$PublisherArgs)
  $stdoutFile = [System.IO.Path]::GetTempFileName()
  $stderrFile = [System.IO.Path]::GetTempFileName()
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $PublisherScript @PublisherArgs 1> $stdoutFile 2> $stderrFile
  $code = $LASTEXITCODE
  $ErrorActionPreference = $oldPreference
  $stdout = Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue
  $stderr = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
  return [pscustomobject]@{ Code = $code; Stdout = $stdout; Stderr = $stderr }
}

function New-Work {
  param(
    [string]$Root,
    [string]$WorkId = "work-1",
    [array]$Targets,
    [string]$PublishAt = "2026-05-12T09:00:00+08:00",
    [string]$PublishMode = "immediate"
  )
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "assets") | Out-Null
  "cover" | Set-Content -LiteralPath (Join-Path $Root "assets\cover.jpg") -Encoding UTF8
  "image" | Set-Content -LiteralPath (Join-Path $Root "assets\1.jpg") -Encoding UTF8
  "video" | Set-Content -LiteralPath (Join-Path $Root "assets\video.mp4") -Encoding UTF8
  Write-JsonFile (Join-Path $Root "manifest.json") ([ordered]@{
    schema_version = "1.0"
    work_id = $WorkId
    status = "finished"
    content_format = "markdown"
    title = "作品标题"
    body = "正文"
    summary = "摘要"
    assets = [ordered]@{
      cover = "assets/cover.jpg"
      images = @("assets/1.jpg")
      video = "assets/video.mp4"
    }
    tags = @("标签1")
    publish_mode = $PublishMode
    publish_at = $PublishAt
    targets = $Targets
  })
}

function New-Accounts {
  param([string]$Path)
  Write-JsonFile $Path ([ordered]@{
    accounts = @(
      [ordered]@{
        account_id = "xhs_main"
        platform = "xiaohongshu"
        auth = [ordered]@{ type = "none" }
        configured_capabilities = @()
        verified_scopes = @()
        last_verified_at = $null
      },
      [ordered]@{
        account_id = "sticker_main"
        platform = "wechat_sticker"
        auth = [ordered]@{ type = "none" }
        configured_capabilities = @()
        verified_scopes = @()
        last_verified_at = $null
      },
      [ordered]@{
        account_id = "mock_main"
        platform = "mock"
        auth = [ordered]@{ type = "none" }
        configured_capabilities = @("dry_run_publish")
        verified_scopes = @("dry_run_publish")
        last_verified_at = "2026-05-11T00:00:00+08:00"
      },
      [ordered]@{
        account_id = "douyin_main"
        platform = "douyin"
        auth = [ordered]@{ type = "env"; access_token_env = "DOUYIN_ACCESS_TOKEN"; open_id_env = "DOUYIN_OPEN_ID" }
        configured_capabilities = @("video_upload", "video_publish")
        verified_scopes = @()
        last_verified_at = $null
      }
    )
  })
}

function New-CopyWork {
  param([string]$Root)
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "assets") | Out-Null
  "cover" | Set-Content -LiteralPath (Join-Path $Root "assets\cover.jpg") -Encoding UTF8
  Write-JsonFile (Join-Path $Root "manifest.json") ([ordered]@{
    schema_version = "1.0"
    work_id = "copy-work"
    status = "finished"
    content_format = "markdown"
    title = "City night photo set"
    body = "A long-exposure city night photography work showing lights, streets, and movement."
    summary = "Long-exposure city night photography."
    audience = "beginner city photography fans"
    selling_points = @("long-exposure light trails", "beginner-friendly composition", "city atmosphere")
    tone = "professional but friendly"
    assets = [ordered]@{
      cover = "assets/cover.jpg"
      images = @("assets/cover.jpg")
      video = ""
    }
    tags = @("photography", "city night")
    publish_mode = "immediate"
    targets = @(
      [ordered]@{ target_id = "wechat-main-article"; platform = "wechat_article"; kind = "article"; account_id = "wechat_main"; overrides = [ordered]@{} },
      [ordered]@{ target_id = "xhs-main-note"; platform = "xiaohongshu"; kind = "note"; account_id = "xhs_main"; overrides = [ordered]@{} },
      [ordered]@{ target_id = "douyin-main-video"; platform = "douyin"; kind = "video"; account_id = "douyin_main"; overrides = [ordered]@{} }
    )
  })
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ("social-publisher-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $root | Out-Null
try {
  $accounts = Join-Path $root "accounts.json"
  New-Accounts $accounts

  $copyWork = Join-Path $root "copy-work"
  New-Item -ItemType Directory -Force -Path $copyWork | Out-Null
  New-CopyWork $copyWork
  $copyGenerate = Invoke-Publisher -PublisherArgs @("copy-generate", "-WorkDir", $copyWork, "-Json")
  Assert-True ($copyGenerate.Code -eq 0) "copy-generate should exit 0, got $($copyGenerate.Code): stdout=$($copyGenerate.Stdout) stderr=$($copyGenerate.Stderr)"
  Assert-True (Test-Path (Join-Path $copyWork "copy-pack.json")) "copy-generate should create copy-pack.json"
  Assert-True (Test-Path (Join-Path $copyWork "copy-pack.md")) "copy-generate should create copy-pack.md"
  $copyPack = Get-Content -LiteralPath (Join-Path $copyWork "copy-pack.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($targetId in @("wechat-main-article", "xhs-main-note", "douyin-main-video")) {
    Assert-True ($null -ne $copyPack.targets.$targetId) "copy-pack missing $targetId"
    Assert-True (@($copyPack.targets.$targetId.candidates).Count -ge 3) "$targetId should have at least 3 candidates"
  }
  $select = Invoke-Publisher -PublisherArgs @("copy-select", "-WorkDir", $copyWork, "-TargetId", "xhs-main-note", "-CandidateId", "xhs-main-note-2", "-Json")
  Assert-True ($select.Code -eq 0) "copy-select should exit 0, got $($select.Code): stdout=$($select.Stdout) stderr=$($select.Stderr)"
  Assert-True (Test-Path (Join-Path $copyWork "selected-copy.json")) "copy-select should create selected-copy.json"
  $selected = Get-Content -LiteralPath (Join-Path $copyWork "selected-copy.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True ($selected.targets.'xhs-main-note'.candidate_id -eq "xhs-main-note-2") "selected-copy should store chosen candidate"
  $draftPlan = Invoke-Publisher -PublisherArgs @("draft-plan", "-WorkDir", $copyWork, "-TargetId", "xhs-main-note", "-Json")
  Assert-True ($draftPlan.Code -eq 0) "draft-plan should exit 0, got $($draftPlan.Code): stdout=$($draftPlan.Stdout) stderr=$($draftPlan.Stderr)"
  Assert-True (Test-Path (Join-Path $copyWork "draft-plan.json")) "draft-plan should create draft-plan.json"
  $draftJson = $draftPlan.Stdout | ConvertFrom-Json
  Assert-True ($draftJson.plan_type -eq "social_publisher_draft_plan") "draft-plan should include plan_type"
  Assert-True ($draftJson.target_id -eq "xhs-main-note") "draft-plan target mismatch"
  Assert-True ($draftJson.stop_before_publish -eq $true) "draft-plan must stop before publish"
  Assert-True ($draftJson.safety.upload_method -eq "chrome.debugger.DOM.setFileInputFiles") "draft-plan should declare CDP upload method"
  Assert-True ([System.IO.Path]::IsPathRooted([string]$draftJson.asset_paths.cover)) "draft-plan cover path must be absolute for CDP upload"
  Assert-True (@($draftJson.asset_paths.images).Count -eq 1) "draft-plan should include image paths"
  Assert-True (@($draftJson.relative_asset_paths.images).Count -eq 1) "draft-plan should preserve relative image paths as an array"
  Assert-True ($draftJson.title -match "beginner") "draft-plan should use selected copy"
  $draftFillDryRun = Invoke-Publisher -PublisherArgs @("draft-fill", "-WorkDir", $copyWork, "-TargetId", "xhs-main-note", "-ProfileName", "xhs-test", "-DryRun", "-Json")
  Assert-True ($draftFillDryRun.Code -eq 0) "draft-fill dry-run should exit 0, got $($draftFillDryRun.Code): stdout=$($draftFillDryRun.Stdout) stderr=$($draftFillDryRun.Stderr)"
  $draftFillJson = $draftFillDryRun.Stdout | ConvertFrom-Json
  Assert-True ($draftFillJson.overall_status -eq "done") "draft-fill dry-run should report done"
  Assert-True ($draftFillJson.profile_name -eq "xhs-test") "draft-fill should honor ProfileName"
  Assert-True (Test-Path (Join-Path $copyWork "draft-fill-result.json")) "draft-fill should create draft-fill-result.json"
  Assert-True (Test-Path (Join-Path $copyWork "logs\xhs-main-note\run.json")) "draft-fill should write target run log"
  $stalePlanPath = Join-Path $copyWork "draft-plan.json"
  $stalePlan = Get-Content -LiteralPath $stalePlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $stalePlan.schedule = [ordered]@{ mode = "scheduled_exact"; publish_at = "2000-01-01T00:00:00+08:00" }
  Write-JsonFile $stalePlanPath $stalePlan
  $staleDraftFill = Invoke-Publisher -PublisherArgs @("draft-fill", "-WorkDir", $copyWork, "-TargetId", "xhs-main-note", "-ProfileName", "xhs-test", "-DryRun", "-Json")
  Assert-True ($staleDraftFill.Code -eq 2) "draft-fill should reject stale scheduled publish time"
  $draftPlanRestore = Invoke-Publisher -PublisherArgs @("draft-plan", "-WorkDir", $copyWork, "-TargetId", "xhs-main-note", "-Json")
  Assert-True ($draftPlanRestore.Code -eq 0) "draft-plan restore after stale schedule test should exit 0"
  $invalidSelect = Invoke-Publisher -PublisherArgs @("copy-select", "-WorkDir", $copyWork, "-TargetId", "xhs-main-note", "-CandidateId", "missing-candidate", "-Json")
  Assert-True ($invalidSelect.Code -eq 2) "missing candidate should be validation error"

  $manualWork = Join-Path $root "manual-work"
  New-Item -ItemType Directory -Force -Path $manualWork | Out-Null
  New-Work $manualWork "manual-work" @(
    [ordered]@{ target_id = "xhs-main-note"; platform = "xiaohongshu"; kind = "note"; account_id = "xhs_main"; overrides = [ordered]@{} },
    [ordered]@{ target_id = "wechat-sticker"; platform = "wechat_sticker"; kind = "sticker"; account_id = "sticker_main"; overrides = [ordered]@{} }
  )
  Copy-Item -LiteralPath (Join-Path $copyWork "copy-pack.json") -Destination (Join-Path $manualWork "copy-pack.json") -Force
  $selectForManual = Invoke-Publisher -PublisherArgs @("copy-select", "-WorkDir", $manualWork, "-TargetId", "xhs-main-note", "-CandidateId", "xhs-main-note-2", "-Json")
  Assert-True ($selectForManual.Code -eq 0) "copy-select for manual package should exit 0"
  $result = Invoke-Publisher -PublisherArgs @("publish", "-WorkDir", $manualWork, "-AccountsPath", $accounts, "-Json")
  Assert-True ($result.Code -eq 4) "manual publish should exit 4, got $($result.Code): stdout=$($result.Stdout) stderr=$($result.Stderr)"
  $json = $result.Stdout | ConvertFrom-Json
  Assert-True ($json.overall_status -eq "manual_required") "expected manual_required overall"
  Assert-True (Test-Path (Join-Path $manualWork "manual\xhs-main-note.md")) "missing xhs manual package"
  $manualText = Get-Content -LiteralPath (Join-Path $manualWork "manual\xhs-main-note.md") -Raw -Encoding UTF8
  Assert-True ($manualText -match "beginner") "manual package should use selected copy text"
  Assert-True (Test-Path (Join-Path $manualWork "publish-result.json")) "missing publish-result.json"
  $saved = Get-Content -LiteralPath (Join-Path $manualWork "publish-result.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True ($null -ne $saved.targets.'xhs-main-note') "result must be keyed by target_id"

  $record = Invoke-Publisher -PublisherArgs @("record-manual-result", "-WorkDir", $manualWork, "-TargetId", "xhs-main-note", "-Url", "https://example.com/note/1", "-RemoteId", "note-1", "-Json")
  Assert-True ($record.Code -eq 4) "record manual with remaining manual target should exit 4, got $($record.Code): stdout=$($record.Stdout) stderr=$($record.Stderr)"
  $recordJson = $record.Stdout | ConvertFrom-Json
  Assert-True ($recordJson.targets.'xhs-main-note'.status -eq "published") "manual record should mark target published"

  $missingReceipt = Invoke-Publisher -PublisherArgs @("record-manual-result", "-WorkDir", $manualWork, "-TargetId", "wechat-sticker", "-Json")
  Assert-True ($missingReceipt.Code -eq 2) "manual record without Url/RemoteId should be validation error"

  $mockWork = Join-Path $root "mock-work"
  New-Item -ItemType Directory -Force -Path $mockWork | Out-Null
  New-Work $mockWork "mock-work" @(
    [ordered]@{ target_id = "mock-one"; platform = "mock"; kind = "dry_run"; account_id = "mock_main"; overrides = [ordered]@{} }
  )
  $mock = Invoke-Publisher -PublisherArgs @("publish", "-WorkDir", $mockWork, "-AccountsPath", $accounts, "-Json")
  Assert-True ($mock.Code -eq 0) "mock publish should exit 0, got $($mock.Code): $($mock.Stderr)"
  $mockJson = $mock.Stdout | ConvertFrom-Json
  Assert-True ($mockJson.targets.'mock-one'.status -eq "published") "mock target should be published"
  $redactedPath = Join-Path $mockWork "logs\mock-one-mock-response-redacted.json"
  $redactedText = Get-Content -LiteralPath $redactedPath -Raw -Encoding UTF8
  Assert-True ($redactedText -notmatch "test-secret-should-redact") "redacted log leaked access token"
  Assert-True ($redactedText -notmatch "open-secret-should-redact") "redacted log leaked open_id"
  $rerun = Invoke-Publisher -PublisherArgs @("publish", "-WorkDir", $mockWork, "-AccountsPath", $accounts, "-Json")
  Assert-True ($rerun.Code -eq 0) "rerun should skip published target and exit 0"
  $rerunJson = $rerun.Stdout | ConvertFrom-Json
  Assert-True ($rerunJson.targets.'mock-one'.attempts.Count -eq 1) "rerun must not add another attempt"

  "locked" | Set-Content -LiteralPath (Join-Path $mockWork ".publish.lock") -Encoding UTF8
  $locked = Invoke-Publisher -PublisherArgs @("publish", "-WorkDir", $mockWork, "-AccountsPath", $accounts, "-Json")
  Assert-True ($locked.Code -eq 6) "publish with existing lock should exit lock-held code 6"
  Remove-Item -LiteralPath (Join-Path $mockWork ".publish.lock") -Force

  $futureWork = Join-Path $root "future-work"
  New-Item -ItemType Directory -Force -Path $futureWork | Out-Null
  New-Work $futureWork "future-work" @(
    [ordered]@{ target_id = "mock-future"; platform = "mock"; kind = "dry_run"; account_id = "mock_main"; overrides = [ordered]@{} }
  ) "2999-01-01T00:00:00+08:00" "scheduled"
  $future = Invoke-Publisher -PublisherArgs @("publish", "-WorkDir", $futureWork, "-AccountsPath", $accounts, "-Json")
  Assert-True ($future.Code -eq 3) "future publish should exit not-ready code 3"

  $badWork = Join-Path $root "bad-work"
  New-Item -ItemType Directory -Force -Path $badWork | Out-Null
  New-Work $badWork "bad-work" @(
    [ordered]@{ target_id = "dup"; platform = "mock"; kind = "dry_run"; account_id = "mock_main"; overrides = [ordered]@{} },
    [ordered]@{ target_id = "dup"; platform = "mock"; kind = "dry_run"; account_id = "mock_main"; overrides = [ordered]@{} }
  )
  $bad = Invoke-Publisher -PublisherArgs @("validate", "-WorkDir", $badWork, "-AccountsPath", $accounts, "-Json")
  Assert-True ($bad.Code -eq 2) "duplicate target_id should exit validation error"

  $escapeWork = Join-Path $root "escape-work"
  New-Item -ItemType Directory -Force -Path $escapeWork | Out-Null
  New-Work $escapeWork "escape-work" @(
    [ordered]@{ target_id = "escape"; platform = "mock"; kind = "dry_run"; account_id = "mock_main"; overrides = [ordered]@{} }
  )
  $manifest = Get-Content -LiteralPath (Join-Path $escapeWork "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  $manifest.assets.cover = "..\outside.jpg"
  $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $escapeWork "manifest.json") -Encoding UTF8
  $escape = Invoke-Publisher -PublisherArgs @("validate", "-WorkDir", $escapeWork, "-AccountsPath", $accounts, "-Json")
  Assert-True ($escape.Code -eq 2) "path escape should exit validation error"

  $extensionManifestPath = Join-Path $SkillRoot "extension\manifest.json"
  if (Test-Path -LiteralPath $extensionManifestPath) {
    $extensionManifest = Get-Content -LiteralPath $extensionManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True (@($extensionManifest.permissions) -contains "debugger") "extension must request debugger permission for CDP upload"
    Assert-True (Test-Path -LiteralPath (Join-Path $SkillRoot "extension\src\background.js")) "extension background.js should exist"
    Assert-True (Test-Path -LiteralPath (Join-Path $SkillRoot "extension\src\content.js")) "extension content.js should exist"
    $backgroundText = Get-Content -LiteralPath (Join-Path $SkillRoot "extension\src\background.js") -Raw -Encoding UTF8
    Assert-True ($backgroundText -match "DOM\.setFileInputFiles") "background should use DOM.setFileInputFiles"
    Assert-True ($backgroundText -match "chrome\.debugger\.detach") "background should detach debugger after upload"
  }
  $draftFillPackage = Join-Path $SkillRoot "draft-fill\package.json"
  Assert-True (Test-Path -LiteralPath $draftFillPackage) "draft-fill package.json should exist"
  $draftFillCli = Join-Path $SkillRoot "draft-fill\src\cli.mjs"
  Assert-True (Test-Path -LiteralPath $draftFillCli) "draft-fill CLI should exist"
  $draftFillCliText = Get-Content -LiteralPath $draftFillCli -Raw -Encoding UTF8
  Assert-True ($draftFillCliText -match "launchPersistentContext") "draft-fill should use persistent Chrome profiles"

  "All social-publisher tests passed."
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
