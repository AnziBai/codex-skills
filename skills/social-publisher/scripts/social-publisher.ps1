param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet("validate", "publish", "resume", "retry-failed", "record-manual-result", "status", "copy-generate", "copy-select", "draft-plan", "setup-draft-fill", "draft-fill", "doctor", "preflight", "sample-run", "diagnose-failure")]
  [string]$Command,

  [string]$WorkDir,
  [string]$AccountsPath,
  [string]$TargetId,
  [string]$Url,
  [string]$RemoteId,
  [string]$Proof,
  [string]$CandidateId,
  [string]$ProfileName,
  [string]$Platform,
  [switch]$DryRun,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$ExitSuccess = 0
$ExitInternal = 1
$ExitValidation = 2
$ExitNotReady = 3
$ExitManualRequired = 4
$ExitPartialFailure = 5
$ExitLockHeld = 6

$SupportedStatuses = @(
  "pending", "not_ready", "blocked", "manual_required", "in_progress",
  "submitted", "in_review", "published", "rejected", "retryable_failed",
  "failed", "unknown"
)

$CapabilityRegistry = @{
  mock = @{
    mode = "mock"
    evidence_url = "local://social-publisher/mock"
    verified_at = "2026-05-11"
    capabilities = @("dry_run_publish")
  }
  xiaohongshu = @{
    mode = "manual"
    evidence_url = "manual-required://no-general-note-publish-api-verified"
    verified_at = "2026-05-11"
    capabilities = @()
  }
  wechat_sticker = @{
    mode = "manual"
    evidence_url = "manual-required://wechat-sticker-api-not-verified"
    verified_at = "2026-05-11"
    capabilities = @()
  }
  douyin = @{
    mode = "stub"
    evidence_url = "https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create"
    verified_at = "2026-05-11"
    capabilities = @("video_upload", "video_publish")
  }
  wechat_article = @{
    mode = "stub"
    evidence_url = "https://developers.weixin.qq.com/doc/offiaccount/"
    verified_at = "2026-05-11"
    capabilities = @("draft_create", "article_publish")
  }
  wechat_channels = @{
    mode = "manual"
    evidence_url = "manual-required://wechat-channels-browser-draft-assistant"
    verified_at = "2026-05-12"
    capabilities = @()
  }
}

function Write-Human {
  param([string]$Message)
  [Console]::Error.WriteLine($Message)
}

function Write-OutputObject {
  param([object]$Value)
  if ($Json) {
    $Value | ConvertTo-Json -Depth 30
  } else {
    if ($Value.message) { Write-Output $Value.message }
    else { Write-Output ($Value | ConvertTo-Json -Depth 8) }
  }
}

function Exit-With {
  param([int]$Code, [object]$Payload)
  Write-OutputObject $Payload
  exit $Code
}

function Invoke-DraftFillNode {
  param(
    [string]$NodeCommand,
    [string]$WorkRoot,
    [string]$TargetId,
    [string]$ProfileName,
    [string]$Platform,
    [bool]$DryRun,
    [bool]$JsonOutput
  )
  $runner = Join-Path (Split-Path -Parent $PSScriptRoot) "draft-fill\src\cli.mjs"
  if (!(Test-Path -LiteralPath $runner)) { throw "Draft-fill runner not found: $runner" }
  $args = @($runner, $NodeCommand)
  if (-not [string]::IsNullOrWhiteSpace($WorkRoot)) { $args += @("--work-dir", $WorkRoot) }
  if (-not [string]::IsNullOrWhiteSpace($TargetId)) { $args += @("--target-id", $TargetId) }
  if (-not [string]::IsNullOrWhiteSpace($ProfileName)) { $args += @("--profile-name", $ProfileName) }
  if ($DryRun) { $args += "--dry-run" }
  if ($JsonOutput) { $args += "--json" }
  if (-not [string]::IsNullOrWhiteSpace($Platform)) { $args += @("--platform", $Platform) }
  & node @args
  exit $LASTEXITCODE
}

function Install-DraftFillDependencies {
  $draftFillRoot = Join-Path (Split-Path -Parent $PSScriptRoot) "draft-fill"
  if (!(Test-Path -LiteralPath (Join-Path $draftFillRoot "package.json"))) {
    throw "Draft-fill package.json not found: $draftFillRoot"
  }
  Write-Human "Installing draft-fill dependencies in $draftFillRoot"
  Push-Location $draftFillRoot
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

function Read-JsonFile {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) { throw "File not found: $Path" }
  return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Save-JsonAtomic {
  param([string]$Path, [object]$Value)
  $dir = Split-Path -Parent $Path
  if (!(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $tmp = Join-Path $dir (".tmp-" + [guid]::NewGuid().ToString("N") + ".json")
  $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-Required {
  param([object]$Object, [string]$Name)
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop -or $null -eq $prop.Value -or [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
    return $null
  }
  return $prop.Value
}

function Get-WorkPath {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "-WorkDir is required." }
  if (!(Test-Path -LiteralPath $Path)) { throw "WorkDir not found: $Path" }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-WorkAsset {
  param([string]$WorkRoot, [string]$RelativePath)
  if ([string]::IsNullOrWhiteSpace($RelativePath)) { return $null }
  if ([System.IO.Path]::IsPathRooted($RelativePath)) {
    throw "Asset path must be relative to workdir: $RelativePath"
  }
  $rootFull = [System.IO.Path]::GetFullPath($WorkRoot).TrimEnd('\', '/')
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $WorkRoot $RelativePath))
  $prefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
  if (($candidate -ne $rootFull) -and (-not $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Asset path escapes workdir: $RelativePath"
  }
  if (!(Test-Path -LiteralPath $candidate)) {
    throw "Asset not found: $RelativePath"
  }
  return $candidate
}

function Get-MimeGuess {
  param([string]$Path)
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".jpg" { "image/jpeg"; break }
    ".jpeg" { "image/jpeg"; break }
    ".png" { "image/png"; break }
    ".gif" { "image/gif"; break }
    ".webp" { "image/webp"; break }
    ".mp4" { "video/mp4"; break }
    ".mov" { "video/quicktime"; break }
    default { "application/octet-stream" }
  }
}

function Get-AssetMetadata {
  param([string]$WorkRoot, [string]$RelativePath)
  $path = Resolve-WorkAsset $WorkRoot $RelativePath
  $item = Get-Item -LiteralPath $path
  $hash = Get-FileHash -LiteralPath $path -Algorithm SHA256
  return [ordered]@{
    path = $RelativePath
    size_bytes = $item.Length
    mime = Get-MimeGuess $path
    sha256 = $hash.Hash.ToLowerInvariant()
  }
}

function Read-Accounts {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return [pscustomobject]@{ accounts = @() }
  }
  if (!(Test-Path -LiteralPath $Path)) { throw "AccountsPath not found: $Path" }
  return Read-JsonFile $Path
}

function Find-Account {
  param([object]$Accounts, [string]$AccountId, [string]$Platform)
  foreach ($account in @($Accounts.accounts)) {
    if ([string]$account.account_id -eq $AccountId -and [string]$account.platform -eq $Platform) {
      return $account
    }
  }
  return $null
}

function Has-Capability {
  param([object]$Account, [string]$Capability)
  $configured = @($Account.configured_capabilities)
  $verified = @($Account.verified_scopes)
  return (($configured -contains $Capability) -and ($verified -contains $Capability))
}

function Redact-Object {
  param([object]$Value)
  $json = $Value | ConvertTo-Json -Depth 30
  $json = $json -replace '(?i)(access[_-]?token|authorization|appsecret|cookie|open[_-]?id)"?\s*:\s*"[^"]+', '$1":"[REDACTED]'
  $json = $json -replace '(?i)(access_token|token|appsecret|openid|open_id)=([^&\s"]+)', '$1=[REDACTED]'
  $json = $json -replace '1[3-9]\d{9}', '[REDACTED_PHONE]'
  return ($json | ConvertFrom-Json)
}

function Get-NowIso {
  return (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
}

function Join-TagText {
  param([object[]]$Tags)
  return ((@($Tags) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object { "#$($_.ToString().TrimStart('#'))" }) -join " ")
}

function Get-SellingPointText {
  param([object]$Manifest)
  $points = @($Manifest.selling_points) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
  if ($points.Count -eq 0) { return [string]$Manifest.summary }
  return ($points -join "; ")
}

function New-CopyCandidate {
  param(
    [object]$Manifest,
    [object]$Target,
    [int]$Index
  )
  $targetId = [string]$Target.target_id
  $platform = [string]$Target.platform
  $title = [string]$Manifest.title
  $summary = [string]$Manifest.summary
  $body = [string]$Manifest.body
  $audience = [string]$Manifest.audience
  $selling = Get-SellingPointText $Manifest
  $tone = [string]$Manifest.tone
  $tags = @($Manifest.tags)
  $tagText = Join-TagText $tags
  if ([string]::IsNullOrWhiteSpace($summary)) { $summary = $body }
  if ([string]::IsNullOrWhiteSpace($audience)) { $audience = "general audience" }
  if ([string]::IsNullOrWhiteSpace($tone)) { $tone = "clear and useful" }

  if ($platform -eq "xiaohongshu") {
    $titles = @(
      "${title}: $summary",
      "$title for $audience",
      "Why this work stands out: $title"
    )
    $bodies = @(
      "$summary`n`nHighlights: $selling`n`n$tagText",
      "For ${audience}: $body`n`nWorth noting: $selling`n`n$tagText",
      "$title`n`n$body`n`nTone: $tone`n`n$tagText"
    )
    $reasons = @("Balanced Xiaohongshu note with searchable terms.", "Audience-led version for discovery.", "Story-first version for browsing feeds.")
  } elseif ($platform -eq "douyin") {
    $titles = @(
      "$title $tagText",
      "$summary $tagText",
      "Watch this: $title"
    )
    $bodies = @(
      "$summary`n$selling",
      "For ${audience}: $summary",
      "$title`n$body"
    )
    $reasons = @("Short caption suitable for video feed.", "Audience-specific caption.", "Direct caption with work title upfront.")
  } elseif ($platform -eq "wechat_article") {
    $titles = @(
      "$title",
      "${title}: $summary",
      "Behind the work: $title"
    )
    $bodies = @(
      "$summary`n`n$body",
      "For $audience, this work focuses on $selling.`n`n$body",
      "This article introduces $title.`n`nKey points: $selling`n`n$body"
    )
    $reasons = @("Clean official-account article framing.", "Audience-first introduction.", "Longer editorial framing.")
  } else {
    $titles = @("$title", "${title}: $summary", "$title for $audience")
    $bodies = @("$summary`n`n$body", "$body`n`n$tagText", "$title`n`n$selling`n`n$body")
    $reasons = @("Generic platform copy.", "Tag-forward variant.", "Selling-point variant.")
  }

  $offset = $Index - 1
  return [ordered]@{
    candidate_id = "$targetId-$Index"
    title = $titles[$offset]
    body = $bodies[$offset]
    tags = $tags
    cover_text = if ($platform -in @("xiaohongshu", "douyin")) { $titles[$offset] } else { $null }
    reason = $reasons[$offset]
  }
}

function New-CopyPack {
  param([string]$WorkRoot)
  $manifest = Read-JsonFile (Join-Path $WorkRoot "manifest.json")
  if ([string]::IsNullOrWhiteSpace([string]$manifest.work_id)) { throw "Validation: manifest.work_id is required." }
  if ($null -eq $manifest.targets -or @($manifest.targets).Count -eq 0) { throw "Validation: manifest.targets is required." }

  $targets = [ordered]@{}
  foreach ($target in @($manifest.targets)) {
    $targetId = [string]$target.target_id
    if ([string]::IsNullOrWhiteSpace($targetId)) { throw "Validation: every target needs target_id." }
    $gaps = @()
    if ([string]::IsNullOrWhiteSpace([string]$manifest.audience)) { $gaps += "audience" }
    if ($null -eq $manifest.selling_points -or @($manifest.selling_points).Count -eq 0) { $gaps += "selling_points" }
    $candidates = @()
    foreach ($i in 1..3) { $candidates += New-CopyCandidate $manifest $target $i }
    $targets[$targetId] = [ordered]@{
      platform = [string]$target.platform
      recommended_candidate_id = "$targetId-2"
      candidates = $candidates
      information_gaps = $gaps
    }
  }

  return [ordered]@{
    schema_version = "1.0"
    work_id = [string]$manifest.work_id
    generated_at = Get-NowIso
    generation_mode = "cli_structured_draft"
    note = "Codex skill can replace these deterministic drafts with AI-generated candidates without requiring an API key."
    targets = $targets
  }
}

function Save-CopyPackMarkdown {
  param([string]$WorkRoot, [object]$CopyPack)
  $lines = @("# Copy Pack", "", "Work ID: $($CopyPack.work_id)", "Generated: $($CopyPack.generated_at)", "")
  foreach ($prop in $CopyPack.targets.GetEnumerator()) {
    $targetId = $prop.Key
    $target = $prop.Value
    $lines += @("## $targetId", "", "Platform: $($target.platform)", "Recommended: $($target.recommended_candidate_id)", "")
    foreach ($candidate in @($target.candidates)) {
      $lines += @("### $($candidate.candidate_id)", "", "Title:", "", [string]$candidate.title, "", "Body:", "", [string]$candidate.body, "", "Tags: $((@($candidate.tags) -join ', '))", "", "Reason: $($candidate.reason)", "")
    }
  }
  ($lines -join [Environment]::NewLine) | Set-Content -LiteralPath (Join-Path $WorkRoot "copy-pack.md") -Encoding UTF8
}

function Save-CopyPack {
  param([string]$WorkRoot)
  $copyPack = New-CopyPack $WorkRoot
  Save-JsonAtomic (Join-Path $WorkRoot "copy-pack.json") $copyPack
  Save-CopyPackMarkdown $WorkRoot $copyPack
  return $copyPack
}

function Select-CopyCandidate {
  param([string]$WorkRoot, [string]$TargetId, [string]$CandidateId)
  if ([string]::IsNullOrWhiteSpace($TargetId)) { throw "Validation: -TargetId is required." }
  if ([string]::IsNullOrWhiteSpace($CandidateId)) { throw "Validation: -CandidateId is required." }
  $copyPack = Read-JsonFile (Join-Path $WorkRoot "copy-pack.json")
  $targetProp = $copyPack.targets.PSObject.Properties[$TargetId]
  if ($null -eq $targetProp) { throw "Validation: copy-pack target not found: $TargetId" }
  $candidate = $null
  foreach ($item in @($targetProp.Value.candidates)) {
    if ([string]$item.candidate_id -eq $CandidateId) { $candidate = $item; break }
  }
  if ($null -eq $candidate) { throw "Validation: candidate not found: $CandidateId" }

  $selectedPath = Join-Path $WorkRoot "selected-copy.json"
  if (Test-Path -LiteralPath $selectedPath) {
    $selected = Read-JsonFile $selectedPath
    $targets = [ordered]@{}
    if ($selected.targets) {
      foreach ($prop in $selected.targets.PSObject.Properties) { $targets[$prop.Name] = $prop.Value }
    }
  } else {
    $selected = [ordered]@{ schema_version = "1.0"; work_id = [string]$copyPack.work_id; selected_at = Get-NowIso; targets = [ordered]@{} }
    $targets = [ordered]@{}
  }
  $targets[$TargetId] = [ordered]@{
    target_id = $TargetId
    platform = [string]$targetProp.Value.platform
    candidate_id = [string]$candidate.candidate_id
    title = [string]$candidate.title
    body = [string]$candidate.body
    tags = @($candidate.tags)
    cover_text = $candidate.cover_text
    reason = [string]$candidate.reason
    selected_at = Get-NowIso
  }
  $out = [ordered]@{ schema_version = "1.0"; work_id = [string]$copyPack.work_id; selected_at = Get-NowIso; targets = $targets }
  Save-JsonAtomic $selectedPath $out
  return $out
}

function Get-SelectedCopyMap {
  param([string]$WorkRoot)
  $path = Join-Path $WorkRoot "selected-copy.json"
  $map = [ordered]@{}
  if (!(Test-Path -LiteralPath $path)) { return $map }
  $selected = Read-JsonFile $path
  if ($selected.targets) {
    foreach ($prop in $selected.targets.PSObject.Properties) { $map[$prop.Name] = $prop.Value }
  }
  return $map
}

function Get-TargetById {
  param([object]$Manifest, [string]$TargetId)
  $targets = @($Manifest.targets)
  if ($targets.Count -eq 0) { throw "Validation: manifest.targets is required." }
  if ([string]::IsNullOrWhiteSpace($TargetId)) {
    if ($targets.Count -eq 1) { return $targets[0] }
    throw "Validation: -TargetId is required when manifest has multiple targets."
  }
  foreach ($target in $targets) {
    if ([string]$target.target_id -eq $TargetId) { return $target }
  }
  throw "Validation: target not found: $TargetId"
}

function Get-PropertyValue {
  param([object]$Object, [string]$Name, [object]$Fallback = $null)
  if ($null -eq $Object) { return $Fallback }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop -or $null -eq $prop.Value) { return $Fallback }
  return $prop.Value
}

function Get-OverrideValue {
  param([object]$Target, [string]$Name, [object]$Fallback = $null)
  if ($null -eq $Target -or $null -eq $Target.overrides) { return $Fallback }
  return Get-PropertyValue $Target.overrides $Name $Fallback
}

function Get-AbsoluteAssetPaths {
  param([string]$WorkRoot, [object]$Manifest)
  $paths = [ordered]@{
    cover = $null
    images = @()
    video = $null
  }
  if ($Manifest.assets) {
    if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.assets.cover)) {
      $paths.cover = Resolve-WorkAsset $WorkRoot ([string]$Manifest.assets.cover)
    }
    if ($Manifest.assets.images) {
      $items = @()
      foreach ($image in @($Manifest.assets.images)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$image)) {
          $items += Resolve-WorkAsset $WorkRoot ([string]$image)
        }
      }
      $paths.images = $items
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.assets.video)) {
      $paths.video = Resolve-WorkAsset $WorkRoot ([string]$Manifest.assets.video)
    }
  }
  return $paths
}

function Get-RelativeAssetPaths {
  param([object]$Manifest)
  $images = @()
  if ($Manifest.assets -and $Manifest.assets.images) {
    foreach ($image in @($Manifest.assets.images)) { $images += [string]$image }
  }
  return [ordered]@{
    cover = if ($Manifest.assets) { [string]$Manifest.assets.cover } else { $null }
    images = $images
    video = if ($Manifest.assets) { [string]$Manifest.assets.video } else { $null }
  }
}

function Get-DefaultDeclaration {
  param([string]$Platform)
  switch ($Platform) {
    "xiaohongshu" { return [ordered]@{ mode = "original"; label = "原创声明"; content_label = "内容来源声明"; source_label = "自主拍摄"; source_location = "上海"; source_date = (Get-Date).ToString("yyyy-MM-dd") } }
    "douyin" { return [ordered]@{ mode = "personal_opinion"; label = "内容为个人观点或见解" } }
    "wechat_channels" { return [ordered]@{ mode = "original"; label = "原创" } }
    default { return [ordered]@{ mode = "none"; label = $null } }
  }
}

function Get-DefaultMusic {
  param([string]$Platform)
  if ($Platform -eq "douyin") {
    return [ordered]@{ strategy = "first_recommended"; name = $null }
  }
  return [ordered]@{ strategy = "none"; name = $null }
}

function Get-DraftSchedule {
  param([object]$Manifest)
  if ([string]$Manifest.publish_mode -eq "scheduled") {
    return [ordered]@{ mode = "scheduled_exact"; publish_at = [string]$Manifest.publish_at }
  }
  return [ordered]@{ mode = "immediate"; publish_at = $null }
}

function Get-InferredCollection {
  param([object]$Manifest, [string]$Platform, [string]$Title, [string]$Body)

  if (@("douyin", "xiaohongshu") -notcontains $Platform) { return $null }

  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($value in @($Title, $Body, [string]$Manifest.summary, [string]$Manifest.audience)) {
    if (-not [string]::IsNullOrWhiteSpace($value)) { $parts.Add($value) }
  }
  foreach ($value in @($Manifest.selling_points)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $parts.Add([string]$value) }
  }
  foreach ($value in @($Manifest.tags)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $parts.Add([string]$value) }
  }
  $text = ($parts -join "`n")

  $kuanlunPattern = "宽论|带鱼|短鱼|CDVA|VA分型|C分型|D分型|V分型|A分型|QR|相对强弱|弹论|分仓明势定损|看大顺中逆小|量化平权|概率思维|概率优势|假突破|真突破|量价|海龟|桥博士|QMACD|MACD|K线形态"
  if ($text -match $kuanlunPattern) { return "宽论" }

  return $null
}

function New-DraftPlan {
  param([string]$WorkRoot, [string]$TargetId)
  $manifest = Read-JsonFile (Join-Path $WorkRoot "manifest.json")
  if ([string]$manifest.schema_version -ne "1.0") { throw "Validation: unsupported or missing manifest.schema_version." }
  if ([string]$manifest.status -ne "finished") { throw "Validation: manifest.status must be finished." }
  if ([string]::IsNullOrWhiteSpace([string]$manifest.work_id)) { throw "Validation: manifest.work_id is required." }
  $target = Get-TargetById $manifest $TargetId
  $targetId = [string]$target.target_id
  $platform = [string]$target.platform
  if ([string]::IsNullOrWhiteSpace($targetId)) { throw "Validation: target_id is required." }
  if ([string]::IsNullOrWhiteSpace($platform)) { throw "Validation: target.platform is required." }
  if (@("xiaohongshu", "douyin", "wechat_channels", "wechat_article") -notcontains $platform) {
    throw "Validation: draft-plan unsupported platform: $platform"
  }

  $selectedMap = Get-SelectedCopyMap $WorkRoot
  $selected = if ($selectedMap.Contains($targetId)) { $selectedMap[$targetId] } else { $null }
  $title = [string](Get-PropertyValue $selected "title" (Get-OverrideValue $target "title" (Get-OverrideValue $target "caption" $manifest.title)))
  $body = [string](Get-PropertyValue $selected "body" (Get-OverrideValue $target "body" $manifest.body))
  $tags = @(Get-PropertyValue $selected "tags" (Get-OverrideValue $target "tags" $manifest.tags))
  $coverText = Get-PropertyValue $selected "cover_text" (Get-OverrideValue $target "cover_text" $null)
  $collectionFallback = Get-PropertyValue $manifest "collection" (Get-InferredCollection $manifest $platform $title $body)
  $collection = Get-OverrideValue $target "collection" $collectionFallback
  $declaration = Get-OverrideValue $target "declaration" (Get-DefaultDeclaration $platform)
  $music = Get-OverrideValue $target "music" (Get-DefaultMusic $platform)
  $schedule = Get-OverrideValue $target "schedule" (Get-DraftSchedule $manifest)
  $assetPaths = Get-AbsoluteAssetPaths $WorkRoot $manifest

  if ([string]::IsNullOrWhiteSpace($title)) { throw "Validation: draft title is empty." }
  if ([string]::IsNullOrWhiteSpace($body)) { throw "Validation: draft body is empty." }
  if (($platform -in @("xiaohongshu", "douyin", "wechat_channels")) -and @($assetPaths.images).Count -eq 0 -and [string]::IsNullOrWhiteSpace([string]$assetPaths.video)) {
    throw "Validation: draft target requires at least one image or video asset."
  }

  return [ordered]@{
    schema_version = "1.0"
    plan_type = "social_publisher_draft_plan"
    generated_at = Get-NowIso
    work_id = [string]$manifest.work_id
    target_id = $targetId
    platform = $platform
    kind = [string]$target.kind
    account_id = [string]$target.account_id
    source_work_dir = $WorkRoot
    asset_paths = $assetPaths
    relative_asset_paths = Get-RelativeAssetPaths $manifest
    title = $title
    body = $body
    tags = @($tags | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    cover_text = $coverText
    collection = $collection
    declaration = $declaration
    music = $music
    schedule = $schedule
    stop_before_publish = $true
    safety = [ordered]@{
      never_click_publish = $true
      no_system_clipboard = $true
      upload_method = "chrome.debugger.DOM.setFileInputFiles"
    }
  }
}

function Save-DraftPlan {
  param([string]$WorkRoot, [string]$TargetId)
  $plan = New-DraftPlan $WorkRoot $TargetId
  Save-JsonAtomic (Join-Path $WorkRoot "draft-plan.json") $plan
  return $plan
}

function Ensure-DraftPlan {
  param([string]$WorkRoot, [string]$TargetId)
  $planPath = Join-Path $WorkRoot "draft-plan.json"
  if (!(Test-Path -LiteralPath $planPath)) {
    Save-DraftPlan $WorkRoot $TargetId | Out-Null
    return
  }
  if ([string]::IsNullOrWhiteSpace($TargetId)) { return }
  try {
    $existing = Read-JsonFile $planPath
    if ([string]$existing.target_id -ne $TargetId) {
      Save-DraftPlan $WorkRoot $TargetId | Out-Null
    }
  } catch {
    Save-DraftPlan $WorkRoot $TargetId | Out-Null
  }
}

function New-EmptyResult {
  param([string]$WorkId)
  return [ordered]@{
    schema_version = "1.0"
    work_id = $WorkId
    overall_status = "pending"
    targets = [ordered]@{}
    updated_at = Get-NowIso
  }
}

function Load-Result {
  param([string]$WorkRoot, [string]$WorkId)
  $path = Join-Path $WorkRoot "publish-result.json"
  if (!(Test-Path -LiteralPath $path)) { return New-EmptyResult $WorkId }
  try {
    $loaded = Read-JsonFile $path
    $targets = [ordered]@{}
    if ($loaded.targets) {
      foreach ($prop in $loaded.targets.PSObject.Properties) {
        $targets[$prop.Name] = $prop.Value
      }
    }
    return [ordered]@{
      schema_version = [string]$loaded.schema_version
      work_id = [string]$loaded.work_id
      overall_status = [string]$loaded.overall_status
      targets = $targets
      updated_at = [string]$loaded.updated_at
    }
  } catch {
    throw "publish-result.json is not valid JSON: $($_.Exception.Message)"
  }
}

function Set-TargetResult {
  param([object]$Result, [string]$TargetId, [object]$TargetResult)
  $Result.targets[$TargetId] = $TargetResult
  $Result.updated_at = Get-NowIso
  $Result.overall_status = Get-OverallStatus $Result.targets
}

function Get-OverallStatus {
  param([object]$Targets)
  $statuses = @()
  foreach ($key in $Targets.Keys) { $statuses += [string]$Targets[$key].status }
  if ($statuses.Count -eq 0) { return "pending" }
  if ($statuses -contains "blocked") { return "blocked" }
  if ($statuses -contains "not_ready") { return "not_ready" }
  if ($statuses -contains "failed" -or $statuses -contains "rejected" -or $statuses -contains "unknown") { return "partial_failure" }
  if ($statuses -contains "retryable_failed") { return "partial_failure" }
  if ($statuses -contains "manual_required") { return "manual_required" }
  if ($statuses -contains "in_progress" -or $statuses -contains "submitted" -or $statuses -contains "in_review") { return "in_progress" }
  if (($statuses | Where-Object { $_ -ne "published" }).Count -eq 0) { return "published" }
  return "partial_success"
}

function Get-ExitCodeForOverall {
  param([string]$Overall)
  switch ($Overall) {
    "published" { return $ExitSuccess }
    "pending" { return $ExitSuccess }
    "in_progress" { return $ExitSuccess }
    "not_ready" { return $ExitNotReady }
    "manual_required" { return $ExitManualRequired }
    "blocked" { return $ExitValidation }
    "partial_failure" { return $ExitPartialFailure }
    default { return $ExitPartialFailure }
  }
}

function Validate-Manifest {
  param([string]$WorkRoot, [object]$Accounts)
  $errors = New-Object System.Collections.Generic.List[string]
  $warnings = New-Object System.Collections.Generic.List[string]
  $targetStates = [ordered]@{}
  $assetMetadata = [ordered]@{}
  $manifestPath = Join-Path $WorkRoot "manifest.json"

  if (!(Test-Path -LiteralPath $manifestPath)) {
    $errors.Add("Missing manifest.json.")
    return [ordered]@{ valid = $false; overall_status = "blocked"; errors = $errors.ToArray(); warnings = $warnings.ToArray(); manifest = $null; target_states = $targetStates; asset_metadata = $assetMetadata }
  }

  try { $manifest = Read-JsonFile $manifestPath }
  catch {
    $errors.Add("manifest.json is not valid JSON: $($_.Exception.Message)")
    return [ordered]@{ valid = $false; overall_status = "blocked"; errors = $errors.ToArray(); warnings = $warnings.ToArray(); manifest = $null; target_states = $targetStates; asset_metadata = $assetMetadata }
  }

  if ([string]$manifest.schema_version -ne "1.0") { $errors.Add("Unsupported or missing schema_version. Expected 1.0.") }
  if ([string]$manifest.status -ne "finished") { $errors.Add("Manifest status must be finished.") }
  foreach ($field in @("work_id", "content_format", "title", "body")) {
    if ($null -eq (Get-Required $manifest $field)) { $errors.Add("Missing required field: $field.") }
  }
  if ($null -eq $manifest.targets -or @($manifest.targets).Count -eq 0) { $errors.Add("Missing required field: targets.") }
  if ($manifest.content_format -and (@("markdown", "html", "plain") -notcontains [string]$manifest.content_format)) {
    $errors.Add("content_format must be markdown, html, or plain.")
  }

  foreach ($assetField in @("cover", "video")) {
    if ($manifest.assets -and $manifest.assets.PSObject.Properties[$assetField] -and -not [string]::IsNullOrWhiteSpace([string]$manifest.assets.$assetField)) {
      try { $assetMetadata[$assetField] = Get-AssetMetadata $WorkRoot ([string]$manifest.assets.$assetField) }
      catch { $errors.Add($_.Exception.Message) }
    }
  }
  if ($manifest.assets -and $manifest.assets.images) {
    $items = @()
    foreach ($image in @($manifest.assets.images)) {
      try { $items += Get-AssetMetadata $WorkRoot ([string]$image) }
      catch { $errors.Add($_.Exception.Message) }
    }
    $assetMetadata["images"] = $items
  }

  $seen = @{}
  foreach ($target in @($manifest.targets)) {
    $targetId = [string]$target.target_id
    $platform = [string]$target.platform
    $kind = [string]$target.kind
    $accountId = [string]$target.account_id
    if ([string]::IsNullOrWhiteSpace($targetId)) { $errors.Add("Target missing target_id."); continue }
    if ($seen.ContainsKey($targetId)) { $errors.Add("Duplicate target_id: $targetId.") }
    $seen[$targetId] = $true
    if ([string]::IsNullOrWhiteSpace($platform)) { $errors.Add("Target $targetId missing platform.") }
    if ([string]::IsNullOrWhiteSpace($kind)) { $errors.Add("Target $targetId missing kind.") }
    if ([string]::IsNullOrWhiteSpace($accountId)) { $errors.Add("Target $targetId missing account_id.") }
    if (-not $CapabilityRegistry.ContainsKey($platform)) {
      $errors.Add("Target $targetId uses unsupported platform: $platform.")
      continue
    }
    $account = Find-Account $Accounts $accountId $platform
    if ($null -eq $account) {
      $errors.Add("Target $targetId references missing account $accountId for $platform.")
      continue
    }

    $mode = [string]$CapabilityRegistry[$platform].mode
    $status = "pending"
    $reason = $null
    if ($mode -eq "manual") {
      $status = "manual_required"
      $reason = "official_api_not_configured"
    } elseif ($platform -eq "douyin") {
      if ([string]::IsNullOrWhiteSpace([string]$manifest.assets.video)) {
        $status = "blocked"
        $reason = "missing_video"
        $errors.Add("Target $targetId requires assets.video.")
      } elseif ($target.overrides -and $target.overrides.caption -and ([string]$target.overrides.caption).Length -gt 1000) {
        $status = "blocked"
        $reason = "caption_too_long"
        $errors.Add("Target $targetId Douyin caption exceeds 1000 characters.")
      } elseif (-not (Has-Capability $account "video_upload") -or -not (Has-Capability $account "video_publish")) {
        $status = "manual_required"
        $reason = "capability_not_verified"
      } else {
        $status = "manual_required"
        $reason = "real_publish_disabled_in_v1"
      }
    } elseif ($platform -eq "wechat_article") {
      if (@("markdown", "html") -notcontains [string]$manifest.content_format) {
        $status = "blocked"
        $reason = "unsupported_article_content_format"
        $errors.Add("Target $targetId WeChat article requires markdown or html content_format.")
      } else {
        $status = "manual_required"
        $reason = "real_publish_disabled_in_v1"
      }
    } elseif ($platform -eq "mock") {
      if (-not (Has-Capability $account "dry_run_publish")) {
        $status = "blocked"
        $reason = "missing_dry_run_capability"
        $errors.Add("Target $targetId mock account lacks verified dry_run_publish capability.")
      } else {
        $status = "pending"
      }
    }
    $targetStates[$targetId] = [ordered]@{
      target_id = $targetId
      platform = $platform
      account_id = $accountId
      status = $status
      reason = $reason
    }
  }

  $notReady = $false
  if ([string]$manifest.publish_mode -eq "scheduled") {
    $parsed = [datetimeoffset]::MinValue
    if ([datetimeoffset]::TryParse([string]$manifest.publish_at, [ref]$parsed)) {
      if ($parsed -gt [datetimeoffset]::Now) { $notReady = $true }
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$manifest.publish_at)) {
      $errors.Add("publish_at must be ISO8601 with timezone.")
    }
  }

  if ($notReady) {
    foreach ($targetId in @($targetStates.Keys)) {
      if ($targetStates[$targetId].status -eq "pending") {
        $targetStates[$targetId].status = "not_ready"
        $targetStates[$targetId].reason = "publish_at_in_future"
      }
    }
  }

  $overall = "pending"
  if ($errors.Count -gt 0) { $overall = "blocked" }
  elseif ($notReady) { $overall = "not_ready" }
  elseif (($targetStates.Keys | Where-Object { $targetStates[$_].status -eq "manual_required" }).Count -gt 0) { $overall = "manual_required" }

  return [ordered]@{
    valid = ($errors.Count -eq 0)
    overall_status = $overall
    errors = $errors.ToArray()
    warnings = $warnings.ToArray()
    manifest = $manifest
    target_states = $targetStates
    asset_metadata = $assetMetadata
  }
}

function New-TargetResult {
  param([object]$Manifest, [object]$Target, [string]$Status, [string]$Reason)
  $targetId = [string]$Target.target_id
  return [ordered]@{
    target_id = $targetId
    platform = [string]$Target.platform
    kind = [string]$Target.kind
    account_id = [string]$Target.account_id
    status = $Status
    reason = $Reason
    idempotency_key = "$($Manifest.work_id):$targetId"
    attempts = @()
    manual_package = $null
    updated_at = Get-NowIso
  }
}

function New-ManualPackage {
  param([string]$WorkRoot, [object]$Manifest, [object]$Target, [string]$Reason, [object]$SelectedCopy)
  $manualDir = Join-Path $WorkRoot "manual"
  New-Item -ItemType Directory -Force -Path $manualDir | Out-Null
  $path = Join-Path $manualDir ("$($Target.target_id).md")
  $caption = if ($SelectedCopy -and $SelectedCopy.title) {
    [string]$SelectedCopy.title
  } elseif ($Target.overrides -and $Target.overrides.caption) {
    [string]$Target.overrides.caption
  } else {
    [string]$Manifest.title
  }
  $body = if ($SelectedCopy -and $SelectedCopy.body) { [string]$SelectedCopy.body } else { [string]$Manifest.body }
  $tagSource = if ($SelectedCopy -and $SelectedCopy.tags) { @($SelectedCopy.tags) } else { @($Manifest.tags) }
  $tags = ($tagSource | ForEach-Object { "#$($_.ToString().TrimStart('#'))" }) -join " "
  $lines = @(
    "# Manual Publish: $($Target.target_id)",
    "",
    "Platform: $($Target.platform)",
    "Account: $($Target.account_id)",
    "Reason: $Reason",
    "",
    "Title / Caption:",
    "",
    $caption,
    "",
    "Body:",
    "",
    $body,
    "",
    "Tags:",
    "",
    $tags,
    "",
    "Assets:",
    "- Cover: $($Manifest.assets.cover)",
    "- Video: $($Manifest.assets.video)",
    "Images:",
    $(foreach ($image in @($Manifest.assets.images)) { "- $image" }),
    "",
    "After publishing, run:",
    "social-publisher record-manual-result -WorkDir `"<workdir>`" -TargetId `"$($Target.target_id)`" -Url `"<published-url>`" -RemoteId `"<remote-id>`" -Json"
  )
  ($lines -join [Environment]::NewLine) | Set-Content -LiteralPath $path -Encoding UTF8
  return ("manual/" + [System.IO.Path]::GetFileName($path))
}

function Invoke-MockPublish {
  param([string]$WorkRoot, [object]$Manifest, [object]$Target)
  $logsDir = Join-Path $WorkRoot "logs"
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
  $raw = [ordered]@{
    adapter = "mock"
    remote_id = "mock-$($Manifest.work_id)-$($Target.target_id)"
    access_token = "test-secret-should-redact"
    open_id = "open-secret-should-redact"
  }
  $redacted = Redact-Object $raw
  $logName = "$($Target.target_id)-mock-response-redacted.json"
  Save-JsonAtomic (Join-Path $logsDir $logName) $redacted
  return [ordered]@{
    status = "published"
    remote_id = "mock-$($Manifest.work_id)-$($Target.target_id)"
    url = $null
    submitted_at = Get-NowIso
    published_at = Get-NowIso
    receipt = [ordered]@{
      summary = "mock published"
      raw_redacted_path = "logs/$logName"
    }
  }
}

function Acquire-Lock {
  param([string]$WorkRoot)
  $lockPath = Join-Path $WorkRoot ".publish.lock"
  try {
    $stream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $writer = New-Object System.IO.StreamWriter($stream)
    $payload = [ordered]@{ pid = $PID; host = $env:COMPUTERNAME; started_at = Get-NowIso }
    $writer.Write(($payload | ConvertTo-Json -Depth 4))
    $writer.Flush()
    $writer.Close()
    return $lockPath
  } catch {
    throw "Lock held: $lockPath"
  }
}

function Release-Lock {
  param([string]$LockPath)
  if ($LockPath -and (Test-Path -LiteralPath $LockPath)) {
    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
  }
}

function Publish-Work {
  param([string]$WorkRoot, [object]$Accounts, [string]$Mode)
  $validation = Validate-Manifest $WorkRoot $Accounts
  if (-not $validation.valid) { return $validation }
  if ($validation.overall_status -eq "not_ready") { return $validation }
  $manifest = $validation.manifest
  $result = Load-Result $WorkRoot ([string]$manifest.work_id)
  $selectedCopyMap = Get-SelectedCopyMap $WorkRoot

  foreach ($target in @($manifest.targets)) {
    $targetId = [string]$target.target_id
    $existing = $result.targets[$targetId]
    if ($existing -and [string]$existing.status -eq "published") { continue }
    if ($Mode -eq "retry-failed" -and ($null -eq $existing -or [string]$existing.status -ne "retryable_failed")) { continue }

    $state = $validation.target_states[$targetId]
    $targetResult = New-TargetResult $manifest $target ([string]$state.status) ([string]$state.reason)
    $selectedCopy = if ($selectedCopyMap.Contains($targetId)) { $selectedCopyMap[$targetId] } else { $null }
    if ($state.status -eq "manual_required") {
      $targetResult.manual_package = New-ManualPackage $WorkRoot $manifest $target ([string]$state.reason) $selectedCopy
    } elseif ($state.status -eq "pending") {
      if ([string]$target.platform -eq "mock") {
        $targetResult.status = "in_progress"
        $attempt = [ordered]@{ started_at = Get-NowIso; adapter = "mock" }
        $receipt = Invoke-MockPublish $WorkRoot $manifest $target
        $attempt.completed_at = Get-NowIso
        $attempt.status = "published"
        $targetResult.status = "published"
        $targetResult.remote_id = $receipt.remote_id
        $targetResult.url = $receipt.url
        $targetResult.submitted_at = $receipt.submitted_at
        $targetResult.published_at = $receipt.published_at
        $targetResult.receipt = $receipt.receipt
        $targetResult.attempts = @($attempt)
      } else {
        $targetResult.status = "manual_required"
        $targetResult.reason = "real_publish_disabled_in_v1"
        $targetResult.manual_package = New-ManualPackage $WorkRoot $manifest $target "real_publish_disabled_in_v1" $selectedCopy
      }
    }
    Set-TargetResult $result $targetId $targetResult
  }
  Save-JsonAtomic (Join-Path $WorkRoot "publish-result.json") $result
  return $result
}

function Record-ManualResult {
  param([string]$WorkRoot, [string]$TargetId, [string]$Url, [string]$RemoteId, [string]$Proof)
  if ([string]::IsNullOrWhiteSpace($TargetId)) { throw "Validation: -TargetId is required." }
  if ([string]::IsNullOrWhiteSpace($Url)) { throw "Validation: -Url is required for manual result." }
  if ([string]::IsNullOrWhiteSpace($RemoteId)) { throw "Validation: -RemoteId is required for manual result." }
  $manifest = Read-JsonFile (Join-Path $WorkRoot "manifest.json")
  $result = Load-Result $WorkRoot ([string]$manifest.work_id)
  if (-not $result.targets.Contains($TargetId)) { throw "Target not found in publish-result.json: $TargetId" }
  $targetResult = $result.targets[$TargetId]
  $targetResult | Add-Member -NotePropertyName status -NotePropertyValue "published" -Force
  $targetResult | Add-Member -NotePropertyName reason -NotePropertyValue "manual_result_recorded" -Force
  $targetResult | Add-Member -NotePropertyName url -NotePropertyValue $Url -Force
  $targetResult | Add-Member -NotePropertyName remote_id -NotePropertyValue $RemoteId -Force
  $targetResult | Add-Member -NotePropertyName proof -NotePropertyValue $Proof -Force
  $targetResult | Add-Member -NotePropertyName published_at -NotePropertyValue (Get-NowIso) -Force
  $targetResult | Add-Member -NotePropertyName updated_at -NotePropertyValue (Get-NowIso) -Force
  Set-TargetResult $result $TargetId $targetResult
  Save-JsonAtomic (Join-Path $WorkRoot "publish-result.json") $result
  return $result
}

try {
  if ($Command -eq "setup-draft-fill") {
    Install-DraftFillDependencies
    Invoke-DraftFillNode "setup" $null $null $ProfileName $Platform $false $Json
  }

  if ($Command -eq "doctor") {
    $workRootForDoctor = if ([string]::IsNullOrWhiteSpace($WorkDir)) { $null } else { Get-WorkPath $WorkDir }
    Invoke-DraftFillNode "doctor" $workRootForDoctor $TargetId $ProfileName $Platform $DryRun $Json
  }

  if ($Command -eq "preflight") {
    if ([string]::IsNullOrWhiteSpace($WorkDir)) { throw "-WorkDir is required." }
    $workRootForPreflight = Get-WorkPath $WorkDir
    Ensure-DraftPlan $workRootForPreflight $TargetId
    Invoke-DraftFillNode "preflight" $workRootForPreflight $TargetId $ProfileName $Platform $DryRun $Json
  }

  if ($Command -eq "sample-run") {
    Invoke-DraftFillNode "sample-run" $WorkDir $TargetId $ProfileName $Platform $DryRun $Json
  }

  if ($Command -eq "diagnose-failure") {
    if ([string]::IsNullOrWhiteSpace($WorkDir)) { throw "-WorkDir is required." }
    $workRootForDiagnose = Get-WorkPath $WorkDir
    Invoke-DraftFillNode "diagnose-failure" $workRootForDiagnose $TargetId $ProfileName $Platform $DryRun $Json
  }

  if ($Command -eq "draft-fill") {
    if ([string]::IsNullOrWhiteSpace($WorkDir)) { throw "-WorkDir is required." }
    $workRootForFill = Get-WorkPath $WorkDir
    Ensure-DraftPlan $workRootForFill $TargetId
    Invoke-DraftFillNode "draft-fill" $workRootForFill $TargetId $ProfileName $Platform $DryRun $Json
  }

  if ($Command -ne "status" -and [string]::IsNullOrWhiteSpace($WorkDir)) { throw "-WorkDir is required." }
  $workRoot = Get-WorkPath $WorkDir
  $accounts = Read-Accounts $AccountsPath

  if ($Command -eq "copy-generate") {
    $copyPack = Save-CopyPack $workRoot
    Exit-With $ExitSuccess $copyPack
  }

  if ($Command -eq "copy-select") {
    $selected = Select-CopyCandidate $workRoot $TargetId $CandidateId
    Exit-With $ExitSuccess $selected
  }

  if ($Command -eq "draft-plan") {
    $plan = Save-DraftPlan $workRoot $TargetId
    Exit-With $ExitSuccess $plan
  }

  if ($Command -eq "validate") {
    $validation = Validate-Manifest $workRoot $accounts
    $code = if (-not $validation.valid) { $ExitValidation } else { Get-ExitCodeForOverall $validation.overall_status }
    Exit-With $code $validation
  }

  if ($Command -eq "status") {
    $manifestPath = Join-Path $workRoot "manifest.json"
    $workId = if (Test-Path -LiteralPath $manifestPath) { [string](Read-JsonFile $manifestPath).work_id } else { "" }
    $result = Load-Result $workRoot $workId
    Exit-With (Get-ExitCodeForOverall $result.overall_status) $result
  }

  if ($Command -eq "record-manual-result") {
    $lock = Acquire-Lock $workRoot
    try { $result = Record-ManualResult $workRoot $TargetId $Url $RemoteId $Proof }
    finally { Release-Lock $lock }
    Exit-With (Get-ExitCodeForOverall $result.overall_status) $result
  }

  if (@("publish", "resume", "retry-failed") -contains $Command) {
    $lock = Acquire-Lock $workRoot
    try { $result = Publish-Work $workRoot $accounts $Command }
    finally { Release-Lock $lock }
    $overall = if ($result.overall_status) { [string]$result.overall_status } else { "blocked" }
    $code = if ($result.valid -eq $false) { $ExitValidation } else { Get-ExitCodeForOverall $overall }
    Exit-With $code $result
  }
} catch {
  $message = $_.Exception.Message
  if ($message -like "Lock held:*") {
    Exit-With $ExitLockHeld ([ordered]@{ schema_version = "1.0"; overall_status = "lock_held"; error = $message })
  }
  if ($message -like "Validation:*") {
    Exit-With $ExitValidation ([ordered]@{ schema_version = "1.0"; overall_status = "blocked"; error = $message.Substring("Validation:".Length).Trim() })
  }
  Write-Human $message
  Exit-With $ExitInternal ([ordered]@{ schema_version = "1.0"; overall_status = "internal_error"; error = $message })
}
