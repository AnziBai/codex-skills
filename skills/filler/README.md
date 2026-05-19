# Filler Teammate Guide

This guide is for a coworker taking over `filler` without reading the
implementation first. The tool prepares platform copy, builds draft plans,
opens dedicated Chrome profiles, fills platform drafts, records evidence,
confirms verified multi-item scheduled publishes, and saves immediate drafts
instead of clicking public publish.

## Non-Negotiables

- Automation must not click an immediate public publish/submit button.
- Multi-work or multi-platform scheduled runs confirm scheduled publish after
  schedule readback and critical-step verification.
- Immediate runs save or temporarily store the draft and close the dedicated
  profile only after the save is verified.
- Use a dedicated Chrome profile per platform account. Never use a daily
  browsing profile.
- Do not commit profiles, cookies, local storage, account configs, real work
  dirs, logs, screenshots, DOM artifacts, temp outputs, or `node_modules`.
- Treat `needs_human` and exit code `4` as a safe stop, not a crash.
- Run guided preflight before touching a live platform page. Do not ask the
  operator to fill a long form; infer defaults and ask only the remaining 1-3
  decisions with clickable choices when available.

## One-Time Setup

From the repository root:

```powershell
$Publisher = Join-Path (Get-Location) "skills\filler\scripts\filler.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher setup-draft-fill -Json
```

When updating the local Codex skill registration from this repository, copy
only tracked skill files with the safe registration script:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\register-local-skill.ps1" -Json
```

The script installs to `$HOME\.codex\skills\filler` by default, preserves any
local `profiles/` folder, and refuses to copy or delete platform cookies,
browser cache, logs, screenshots, DOM dumps, temp outputs, or `node_modules`.

`setup-draft-fill` installs the draft-fill dependencies and creates profile
folders under `skills/filler/profiles/`. If a teammate needs only one
profile, pass `-ProfileName`:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher setup-draft-fill -ProfileName "xhs-main" -Json
```

Open the exact same persistent profile for human login before a real run:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher open-profile -ProfileName "xhs-main" -Platform "xiaohongshu" -Json
```

`open-profile` also has the alias `login-profile`. It uses the same Playwright
persistent profile path as `draft-fill` and avoids shell quoting bugs around
workspace paths that contain spaces. Close the visible browser after login so
the profile lock is released before `inspect-collections` or `draft-fill`.

Recommended profile names:

- `xhs-main`
- `douyin-main`
- `wechat-channels-main`

Use simple ASCII names with no spaces, slashes, colons, trailing dots, or path
segments. One profile should mean one platform account. If the business account
changes, create a new profile name instead of silently reusing the old one.

## Login Flow

Open or run the relevant profile once, log into the platform, and leave the
profile dedicated to that account. Future runs reuse the same profile so cookies
and session state stay local.

If a run exits with `profile_lock_held` or exit code `6`, another process or
kept-open browser is using that profile. Close the visible browser first. If the
payload says `stale_keep_open_requires_manual_cleanup`, verify no Chrome window
is using that profile, then remove only the matching lock file under
`skills/filler/profiles/<profile>.draft-fill.lock`. Do not delete the
profile folder unless you intentionally want to log in again.

## Guided Real-Run Intake

Before real skill/CLI/browser runs, inspect first and ask second. The preferred
flow is:

1. Read `manifest.json`, `selected-copy.json`, `draft-plan.json`, and the work
   directory shape.
2. Auto-check local setup: draft-fill package files, Playwright, browser profile
   name, profile folder, collection cache, and target platform adapter.
3. Confirm inferred facts in prose.
4. Ask only the unresolved 1-3 decisions. Use `questions[].options` from
   `preflight` as clickable choices in any wrapper UI.

The operator should not see a blank technical template. If the client supports
choice chips, render the options directly. If it does not, ask compact numbered
choices and keep exact-path/time input for the rare cases where it is necessary.

Typical decisions:

- Target platforms: Xiaohongshu, Douyin, WeChat Channels, WeChat Official
  Account, WeChat sticker posts, or dry run.
- Account/profile for each platform.
- Finished asset location, folder structure, and upload order. Image order comes
  from `manifest.json` and `draft-plan.json`, not from a visual guess.
- Whether scheduling is needed.
- For multi-platform or multi-work batches, the interval/cadence for each
  platform. Do not assume all platforms use the same cadence.
- If no scheduling is requested, warn that Douyin desktop Creator Center may not
  preserve drafts like Xiaohongshu. Douyin batches may require scheduling or
  finalizing one work before preparing the next. Xiaohongshu can usually save
  drafts. WeChat Channels draft behavior is unknown and account-specific until
  the logged-in profile proves otherwise.
- Whether titles should be optimized for distribution.
- Collection strategy: requested collection, whether to inspect collections, and
  whether a broad collection is preferable to a one-off collection.
- Platform declarations: Xiaohongshu original declaration, Douyin personal
  opinion/declaration, and WeChat Channels category/declaration only after the
  logged-in UI confirms the available controls.
- Music defaults, especially Douyin recommended music.
- Final immediate publish boundary: the tool prepares and verifies the draft,
  then saves it. The human operator performs any immediate public publish later.
  Multi-item scheduled runs are confirmed by the CLI after verification.

Recommended defaults for low-friction use:

- Platforms: use manifest targets; if the user says "三平台", use Xiaohongshu,
  Douyin, and WeChat Channels.
- Assets: numbered images in each work folder upload in numeric order, for
  example `1.png` to `5.png`.
- Title optimization: on.
- Scheduling: ask as a choice; do not assume batch cadence.
- Collections: infer broad reusable collections from product knowledge; do not
  create narrow one-off collections automatically.
- Music: Douyin and WeChat Channels default to first recommended music unless
  the user opts out.

## Work Directory Shape

Use one work directory per finished work:

```text
work/
  manifest.json
  assets/
    01.jpg
    02.jpg
    video.mp4
  copy-pack.json
  copy-pack.md
  selected-copy.json
  draft-plan.json
  draft-fill-result.json
  publish-result.json
  logs/
```

The source assets in `manifest.json` must be relative paths inside the work
directory. Confirm image/video order before drafting. For image posts, prefer
stable names such as `01.jpg`, `02.jpg`, `03.jpg` and preserve the order in
`assets.images`.

## Production Run Flow

Generate copy:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher copy-generate -WorkDir ".\work" -Json
```

Select the human-approved candidate:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher copy-select -WorkDir ".\work" -TargetId "xhs-main-note" -CandidateId "xhs-main-note-2" -Json
```

Build the browser draft plan:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-plan -WorkDir ".\work" -TargetId "xhs-main-note" -Json
```

Run preflight before opening a real platform page:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher preflight -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -Json
```

If preflight returns `needs_human` or exit code `4`, answer the returned
`questions` and review the `confirmations`. Each question includes
`input_mode`, `options`, and `default_option` when it can be rendered as a
single-choice prompt. The response also includes `interaction`, whose
`primary_question_ids` keeps wrappers from showing more than three questions in
one round. Typical stable IDs include `target_platforms`,
`asset_location_order`, `profile_login`, `scheduling_needed`,
`batch_schedule_cadence`, and the `douyin_unscheduled_draft_warning`
confirmation when Douyin has no schedule.

`preflight` also checks configuration before a real run. It verifies package
metadata, Playwright importability, profile name safety, and profile folder
existence. Missing profile folders are created automatically; the remaining
manual step is logging into the visible dedicated browser profile once. During
`draft-fill`, platform adapters detect login/auth pages and return
`needs_human` with a clear login message instead of continuing blindly.

Inspect collections when requested:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher inspect-collections -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -Json
```

`inspect-collections` writes a local cache at
`profiles/<profile>/collection-cache.json`. The cache is local evidence for that
profile only and must not be committed. Draft filling trusts the cache only when
the profile, platform, collection, freshness, and account fingerprint match.
After the cache is trusted, the CLI performs deterministic semantic collection
matching against the built-in taxonomy or `draft-plan.collection_taxonomy_path`.
It selects an existing broad collection only on high confidence; ambiguous or
stale choices return `needs_human` instead of clicking the first option.

Use `-ConfirmAccountFingerprint` only after the operator verifies the visible
logged-in account and the plan includes the intended `account_fingerprint`:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher inspect-collections -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -ConfirmAccountFingerprint -Json
```

If `account_fingerprint` is missing, that command returns validation error
instead of trusting the cache.

Dry-run draft filling:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -DryRun -Json
```

Run the real draft fill only after intake, preflight, and any required
collection inspection are complete. Non-dry `draft-fill` refuses to open the
browser unless `-ConfirmIntake` is present, so this switch is the operator's
explicit acknowledgement that the preflight questions and confirmations were
handled:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -ConfirmIntake -Json
```

For a single scheduled target, clicking the platform's scheduled-publish
confirmation is a separate explicit decision. Multi-work or multi-platform
scheduled runs do this automatically after schedule readback and critical-step
verification. Immediate publish buttons remain manual; the CLI saves the draft
instead:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -ConfirmIntake -ConfirmScheduledPublish -Json
```

Batch draft fill runs items serially and stops at the first item that needs
human help:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher batch-draft-fill -BatchPath ".\batch.json" -ConfirmIntake -Json
```

Afterward, summarize the result:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher result-summary -WorkDir ".\work" -Json
```

If a run fails or stops for a human, diagnose from local artifacts:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher diagnose-failure -WorkDir ".\work" -TargetId "xhs-main-note" -Json
```

Before handing the tool to a teammate or after platform changes, run the dry
metadata matrix:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher robustness-matrix -Json
```

To run the matrix against prepared draft-plan cases:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher robustness-matrix -SourceRoot ".\matrix-cases" -OutputRoot ".\matrix-output" -Json
```

## Interpreting Results

Important exit codes:

- `0`: success or dry-run success.
- `2`: validation or blocked input.
- `3`: not ready.
- `4`: manual action required. Read `questions`, `confirmations`, and
  `needs_human` steps.
- `5`: failed or partial failure.
- `6`: lock held.

`needs_human` means the tool deliberately stopped before guessing. The right
next action is usually to answer a question, inspect a screenshot, log in,
choose a collection, confirm an account, or manually complete a platform-only
step. Do not rerun repeatedly without changing the missing condition.

## PowerShell UTF-8

Use UTF-8 when reading or writing JSON and Markdown. At the start of a Windows
PowerShell session:

```powershell
chcp 65001 > $null
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$env:PYTHONUTF8 = "1"
```

When manually inspecting files, prefer:

```powershell
Get-Content -LiteralPath ".\work\draft-plan.json" -Raw -Encoding UTF8
```

## Platform Notes

Xiaohongshu:

- Drafts can usually be saved.
- Tags/topics must become selected platform tokens.
- `cover_text` is important for image notes because the first image is often the
  strongest title surface.
- Original declaration should be completed for finished original works.
- Collection selection is content-aware and should favor broad reusable
  collections.

Douyin:

- Desktop Creator Center may not preserve drafts reliably.
- For batches without scheduling, prepare/finalize one item at a time.
- Topics must be selected through the platform UI.
- Douyin declaration is not Xiaohongshu originality. Treat it as the
  platform-specific personal opinion/declaration flow.
- Recommended/default music must be confirmed before real runs.

WeChat Channels:

- Draft retention is unknown and account-specific until proven in the logged-in
  profile.
- Image posting is a production candidate only after visible upload state,
  title/body fields, category/collection/declaration behavior, schedule, and the
  final boundary are verified.
- The image-post entry can appear late and may be labeled `发布图文`,
  `发表图文`, `发布动态`, `新建图文`, or compact `发图文`. The adapter waits for
  matching entry evidence in the outer page and content frame before stopping
  for human help.
- Video posting remains experimental unless a fresh runbook says otherwise.
- Do not borrow Xiaohongshu or Douyin selectors/declarations by analogy.

## Why Final Publish Is Manual

The browser assistant can upload assets and prepare drafts, but the public
publish click changes the platform-visible state and may trigger platform risk
controls. Keeping that click manual gives the operator one last review of the
account, title, assets, collection, declarations, music, schedule, and legal or
brand-sensitive details. It also avoids training the automation to bypass
platform friction.

## What To Read Next

- `references/production-readiness.md` for the teammate migration checklist.
- `references/failure-diagnostics.md` for triage and artifact reading.
- `references/xhs-real-publish-runbook.md` for Xiaohongshu.
- `references/douyin-real-publish-runbook.md` for Douyin.
- `references/wechat-channels-real-publish-runbook.md` for WeChat Channels.
