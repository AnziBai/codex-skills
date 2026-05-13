# Production Readiness

Use this reference when packaging `social-publisher` for teammates, preparing a
real batch, or deciding whether a platform adapter is ready for production use.

## Migration Checklist

- Ship only source-controlled skill files, scripts, references, `package.json`,
  and `package-lock.json`.
- Do not ship or commit `profiles/`, cookies, local storage, account configs,
  screenshots, DOM artifacts, draft logs, real work directories, temp outputs,
  or `node_modules`.
- Each teammate runs `setup-draft-fill` locally and logs into every platform
  profile they will use.
- Name profiles by platform and account role, for example `xhs-main`,
  `douyin-main`, or `wechat-channels-main`.
- Keep `SKILL.md` small. Put coworker onboarding in `README.md` and platform
  details in `references/`.
- Treat every profile as account-bound. If the account changes, either update
  the account fingerprint deliberately or create a new profile.

## UTF-8 PowerShell Baseline

Use UTF-8 for Chinese titles, captions, tags, collection names, and JSON:

```powershell
chcp 65001 > $null
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$env:PYTHONUTF8 = "1"
```

Use `Get-Content -Raw -Encoding UTF8` when inspecting JSON or Markdown. Use
`Set-Content -Encoding UTF8` for any manual local scratch file. Do not rely on
terminal output if it shows mojibake; inspect the UTF-8 file directly.

## One-Time Setup

From the repository root:

```powershell
$Publisher = Join-Path (Get-Location) "skills\social-publisher\scripts\social-publisher.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher setup-draft-fill -Json
```

Setup creates dedicated profile directories and installs draft-fill
dependencies. To initialize one profile:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher setup-draft-fill -ProfileName "xhs-main" -Json
```

After setup, open the relevant profile through the first real or diagnostic run
and log into the platform. The profile folder is local secret-bearing state and
must not be copied between teammates.

## Required Intake Before Real Runs

Before real skill/CLI/browser execution, the assistant must ask or confirm:

- Target platforms and target account/profile for each platform.
- Where finished images/videos are stored.
- Folder structure and exact upload order for images and videos.
- Whether scheduling is needed.
- For multiple works or platforms, the per-platform interval/cadence.
- If no scheduling is needed, the Douyin warning: desktop Creator Center may not
  preserve drafts like Xiaohongshu, so Douyin batches may need one scheduled or
  finalized item before preparing the next. Xiaohongshu can usually save drafts.
  WeChat Channels draft retention is unknown and account-specific until verified.
- Whether platform titles should be optimized for distribution.
- Collection strategy, including whether `inspect-collections` should be run.
- Declarations and compliance controls per platform.
- Music defaults, especially Douyin recommended music.
- Final publish boundary: automation stops before public publish; the operator
  performs the final click.

Do not treat preflight as a substitute for user-facing intake. Preflight is the
machine check; intake is where ambiguous product, account, cadence, and platform
decisions become explicit.

Preflight mirrors that intake with stable `questions` / `confirmations` IDs:
`target_platforms`, `asset_location_order`, `scheduling_needed`,
`batch_schedule_cadence`, and `douyin_unscheduled_draft_warning`. Exit code `4`
is expected when any unresolved intake question remains. Non-dry `draft-fill`
will also stop with exit code `4` until the operator reruns it with
`-ConfirmIntake`, which is the explicit acknowledgement that the questions and
confirmations were handled before real browser work.

## Work And Asset Readiness

The minimum work directory contains:

```text
work/
  manifest.json
  assets/
  selected-copy.json
  draft-plan.json
```

`manifest.json` should keep asset paths relative to the work directory. The CLI
expands them to absolute `asset_paths` in `draft-plan.json` for browser upload
while preserving `relative_asset_paths` for review.

Before a real draft fill:

- Confirm the asset count.
- Confirm the first image or cover.
- Confirm image order.
- Confirm whether the video, if present, is the primary asset.
- Confirm title, body, tags, collection, declaration, music, and schedule.
- Reject stale scheduled times before opening the browser.

## Production Run Flow

Use this sequence for a normal target:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher copy-generate -WorkDir ".\work" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher copy-select -WorkDir ".\work" -TargetId "<target-id>" -CandidateId "<candidate-id>" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-plan -WorkDir ".\work" -TargetId "<target-id>" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher preflight -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "<profile>" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-fill -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "<profile>" -DryRun -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-fill -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "<profile>" -ConfirmIntake -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher result-summary -WorkDir ".\work" -Json
```

Run `inspect-collections` between `preflight` and real `draft-fill` whenever the
plan uses a collection and no trusted local cache exists:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher inspect-collections -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "<profile>" -Json
```

Run `diagnose-failure` after a failed or human-stopped run:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher diagnose-failure -WorkDir ".\work" -TargetId "<target-id>" -Json
```

Run `robustness-matrix` before teammate handoff, after adapter changes, or when
checking dry metadata coverage:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher robustness-matrix -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher robustness-matrix -SourceRoot ".\matrix-cases" -OutputRoot ".\matrix-output" -Json
```

The matrix is docs-safe and browser-free when using generated fixtures. Do not
commit its temp output.

## Collection Inspection And Cache Trust

`inspect-collections` opens the selected profile, reads available collections,
and writes a local cache under `profiles/<profile>/collection-cache.json`.

The cache is trusted only when:

- The profile name matches the run.
- The platform matches the run.
- The cache has not expired.
- The requested collection exists in the cache.
- The plan supplies an `account_fingerprint`.
- The cache was written with operator-confirmed account verification.
- The cached fingerprint equals the current plan fingerprint.

`-ConfirmAccountFingerprint` is an operator assertion. Use it only after the
visible logged-in account has been checked against the plan. If the plan has no
`account_fingerprint`, the command must fail validation instead of trusting a
cache.

This design prevents a teammate from accidentally using collections discovered
under the wrong account or a reused profile.

## Profile Lock And Unblock

Real browser commands acquire a lock under `profiles/<profile>.draft-fill.lock`.

- Exit code `6` with `profile_lock_held` means another process owns the profile
  or a previous kept-open browser needs manual cleanup.
- If the lock owner is still alive, close or wait for that run.
- If the status is `stale_keep_open_requires_manual_cleanup`, first verify no
  browser window is using the profile, then remove only the matching lock file.
- Do not delete the profile directory unless the operator wants to discard login
  state and log in again.

## Platform Declaration Rules

Do not reuse declaration semantics across platforms:

- Xiaohongshu: original declaration is for original finished works and may have
  a consent/source dialog.
- Douyin: declaration is platform-specific personal opinion or similar
  disclosure. It is not Xiaohongshu originality.
- WeChat Channels: declaration/category controls must be discovered from the
  logged-in WeChat Channels UI before automation relies on them.

If the declaration control cannot be verified, report `needs_human` and preserve
artifacts instead of guessing.

## Scheduling Rules

- Ask whether scheduling is needed before real runs.
- Ask exact start time and timezone when scheduling is needed.
- For batches, ask per-platform interval/cadence.
- Report platform-adjusted times when a platform normalizes the requested time.
- Reject times in the past.
- If no scheduling is requested, warn about Douyin desktop draft persistence
  before preparing a batch.

## Adapter Production Bar

A platform adapter is production-ready only after evidence shows:

- `doctor` can detect missing login, missing dependencies, or invalid plans.
- `preflight` asks unresolved product/account/schedule/collection decisions.
- `draft-fill` records every meaningful step in `draft-fill-result.json` and
  `logs/<target-id>/run.json`.
- Upload verification checks visible platform state, not only file-input
  success.
- Title/body/tags are filled into the correct platform fields.
- Topics/tags become platform-selected tokens when required.
- Collection/category/declaration/music/schedule are either completed or
  explicitly reported as `needs_human`.
- The final publish boundary is visible and preserved.
- `result-summary` reports `publish_boundary_preserved: true`.
- Failure artifacts point to the run log, screenshots, and redacted DOM or
  control metadata when available.

## Exit Code Expectations

- `0`: success.
- `2`: validation or blocked input.
- `3`: not ready.
- `4`: manual action required.
- `5`: failed or partial failure.
- `6`: profile or publish lock held.

Exit code `4` is expected in safe workflows. It means the assistant should ask a
human, inspect a cache, log in, select a platform-only option, or preserve the
draft for manual finalization.
