param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $false)]
  [string]$OutputDir = ".\publishing-out"
)

$ErrorActionPreference = "Stop"

function New-Slug {
  param([string]$Text)
  $slug = $Text.ToLowerInvariant() -replace '[^a-z0-9\u4e00-\u9fff]+', '-'
  $slug = $slug.Trim('-')
  if ([string]::IsNullOrWhiteSpace($slug)) { return "post" }
  if ($slug.Length -gt 48) { return $slug.Substring(0, 48).Trim('-') }
  return $slug
}

function Join-Lines {
  param([string[]]$Lines)
  return ($Lines -join [Environment]::NewLine)
}

function Resolve-InputRelativePath {
  param(
    [string]$Path,
    [string]$BaseDir
  )
  if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
  return (Join-Path $BaseDir $Path)
}

if (!(Test-Path -LiteralPath $InputPath)) {
  throw "InputPath not found: $InputPath"
}

$inputFile = Resolve-Path -LiteralPath $InputPath
$inputDir = Split-Path -Parent $inputFile.Path
$raw = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8
$post = $raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($post.title)) { throw "Input JSON requires title." }
if ([string]::IsNullOrWhiteSpace($post.body)) { throw "Input JSON requires body." }

$supportedPlatforms = @("wechat_official", "wechat_image_video", "xiaohongshu", "douyin")
$platforms = @()
if ($post.platforms) {
  foreach ($p in $post.platforms) {
    $platform = ([string]$p).Trim().ToLowerInvariant()
    if ($supportedPlatforms -notcontains $platform) {
      throw "Unsupported platform '$p'. Supported platforms: $($supportedPlatforms -join ', ')"
    }
    if ($platforms -notcontains $platform) { $platforms += $platform }
  }
} else {
  $platforms = $supportedPlatforms
}

$tags = @()
if ($post.tags) {
  foreach ($tag in $post.tags) { $tags += ([string]$tag).Trim('#') }
}

$images = @()
if ($post.images) {
  foreach ($image in $post.images) { $images += [string]$image }
}

$video = ""
if ($post.video) { $video = [string]$post.video }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$slug = New-Slug $post.title
$packageDir = Join-Path $OutputDir "$timestamp-$slug"
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

$missing = New-Object System.Collections.Generic.List[string]
if ($images.Count -eq 0) { $missing.Add("No images provided.") }
foreach ($image in $images) {
  $imagePath = Resolve-InputRelativePath $image $inputDir
  if (!(Test-Path -LiteralPath $imagePath)) { $missing.Add("Image not found: $image") }
}
if ([string]::IsNullOrWhiteSpace($video) -and ($platforms -contains "douyin")) { $missing.Add("Douyin target selected but no video provided.") }
if (![string]::IsNullOrWhiteSpace($video)) {
  $videoPath = Resolve-InputRelativePath $video $inputDir
  if (!(Test-Path -LiteralPath $videoPath)) { $missing.Add("Video not found: $video") }
}

$tagText = ""
if ($tags.Count -gt 0) {
  $tagText = (($tags | ForEach-Object { "#$_" }) -join " ")
}

$summary = ""
if ($post.summary) { $summary = [string]$post.summary }
if ([string]::IsNullOrWhiteSpace($summary)) {
  $summary = ([string]$post.body)
  if ($summary.Length -gt 120) { $summary = $summary.Substring(0, 120) }
}

$status = if ($missing.Count -gt 0) { "blocked" } else { "manual_review_required" }

$manifest = [ordered]@{
  title = [string]$post.title
  summary = $summary
  body_length = ([string]$post.body).Length
  images = $images
  video = $video
  tags = $tags
  platforms = $platforms
  publish_at = [string]$post.publish_at
  package_created_at = (Get-Date).ToString("s")
  status = $status
  missing = $missing.ToArray()
}

($manifest | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath (Join-Path $packageDir "manifest.json") -Encoding UTF8

$generatedFiles = New-Object System.Collections.Generic.List[string]

if ($platforms -contains "wechat_official") {
  $wechatOfficial = @(
    "# WeChat Official Account",
    "",
    "Title: $($post.title)",
    "",
    "Digest: $summary",
    "",
    "Cover candidates:",
    $(if ($images.Count -gt 0) { ($images | ForEach-Object { "- $_" }) } else { "- MISSING: add cover image" }),
    "",
    "Body:",
    "",
    [string]$post.body,
    "",
    "Manual/API checklist:",
    "- Confirm title, digest, author, cover, and original/source settings.",
    "- Upload images through official media workflow or paste into editor.",
    "- Save as draft first.",
    "- Publish only after human review."
  )
  Join-Lines $wechatOfficial | Set-Content -LiteralPath (Join-Path $packageDir "wechat-official.md") -Encoding UTF8
  $generatedFiles.Add("wechat-official.md")
}

if ($platforms -contains "wechat_image_video") {
  $wechatImageVideo = @(
    "# WeChat Image/Video Account",
    "",
    "Caption:",
    "$($post.title)",
    "",
    "$summary",
    "",
    $tagText,
    "",
    "Assets:",
    $(if ($images.Count -gt 0) { ($images | ForEach-Object { "- image: $_" }) } else { "- image: MISSING" }),
    $(if ($video) { "- video: $video" } else { "- video: optional/not provided" }),
    "",
    "Checklist:",
    "- Confirm whether target is Video Account or another WeChat surface.",
    "- Verify aspect ratio, cover frame, and account permissions.",
    "- Publish manually unless API support is confirmed."
  )
  Join-Lines $wechatImageVideo | Set-Content -LiteralPath (Join-Path $packageDir "wechat-image-video.md") -Encoding UTF8
  $generatedFiles.Add("wechat-image-video.md")
}

if ($platforms -contains "xiaohongshu") {
  $xhs = @(
    "# Xiaohongshu",
    "",
    "Title:",
    "$($post.title)",
    "",
    "Note body:",
    "$summary",
    "",
    [string]$post.body,
    "",
    $tagText,
    "",
    "Image order:",
    $(if ($images.Count -gt 0) { ($images | ForEach-Object { "- $_" }) } else { "- MISSING: Xiaohongshu normally needs strong images" }),
    "",
    "Checklist:",
    "- Confirm first image is the strongest cover.",
    "- Keep title natural and searchable.",
    "- Add disclosure if this is ad, affiliate, sponsored, or product placement.",
    "- Publish manually by default."
  )
  Join-Lines $xhs | Set-Content -LiteralPath (Join-Path $packageDir "xiaohongshu.md") -Encoding UTF8
  $generatedFiles.Add("xiaohongshu.md")
}

if ($platforms -contains "douyin") {
  $douyin = @(
    "# Douyin",
    "",
    "Caption:",
    "$($post.title) $tagText",
    "",
    "Video:",
    $(if ($video) { $video } else { "MISSING: Douyin publishing requires video." }),
    "",
    "Cover:",
    $(if ($images.Count -gt 0) { $images[0] } else { "Use best video frame or provide cover image." }),
    "",
    "Checklist:",
    "- Verify OpenAPI posting scope before any automated publish.",
    "- Confirm video duration, size, and audit expectations.",
    "- If no approved API token is available, publish manually."
  )
  Join-Lines $douyin | Set-Content -LiteralPath (Join-Path $packageDir "douyin.md") -Encoding UTF8
  $generatedFiles.Add("douyin.md")
}

$checklist = @(
  "# Manual Publishing Checklist",
  "",
  "- [ ] Source content reviewed",
  "- [ ] Images/video paths exist locally",
  "- [ ] Platform copy reviewed",
  "- [ ] Sensitive/regulated claims checked",
  "- [ ] Ad or affiliate disclosure added where needed",
  "- [ ] Human approval recorded",
  "- [ ] Published URLs or IDs copied back into audit log",
  "",
  "Blocking gaps:",
  $(if ($missing.Count -gt 0) { ($missing | ForEach-Object { "- $_" }) } else { "- None detected by CLI precheck." })
)
Join-Lines $checklist | Set-Content -LiteralPath (Join-Path $packageDir "manual-checklist.md") -Encoding UTF8

$audit = @(
  "# Audit Log",
  "",
  "Created: $((Get-Date).ToString('s'))",
  "Input: $((Resolve-Path -LiteralPath $InputPath).Path)",
  "Status: $status",
  "",
  "Events:",
  "- Package generated.",
  "- Awaiting human review.",
  "",
  "Publish receipts:",
  $(foreach ($platform in $platforms) { "- $($platform): pending" })
)
Join-Lines $audit | Set-Content -LiteralPath (Join-Path $packageDir "audit-log.md") -Encoding UTF8
$generatedFiles.Add("manifest.json")
$generatedFiles.Add("manual-checklist.md")
$generatedFiles.Add("audit-log.md")

Write-Output "PACKAGE_DIR=$packageDir"
Write-Output "PLATFORMS=$($platforms -join ',')"
Write-Output "GENERATED_FILES=$($generatedFiles.ToArray() -join ',')"
if ($missing.Count -gt 0) {
  Write-Output "BLOCKING_GAPS=$($missing -join ' | ')"
} else {
  Write-Output "BLOCKING_GAPS=none"
}
