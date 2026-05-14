---
name: filler
description: Use when preparing, validating, filling, diagnosing, retrying, or handing off completed social content for Xiaohongshu, Douyin, WeChat Channels, WeChat Official Account, WeChat sticker posts, or dry-run publishing.
---

# Filler

Use this skill for finished social works that need platform copy, draft plans,
browser draft filling, result summaries, diagnostics, or teammate handoff.

## Hard Boundaries

- Do not click a final public publish/submit/confirm button from automation.
- Do not bypass CAPTCHA, login checks, private APIs, or platform risk controls.
- Do not commit or distribute Chrome profiles, cookies, local storage, account
  configs, real work dirs, logs, screenshots, DOM artifacts, temp outputs, or
  `node_modules`.
- Keep platform adapters separate. Share only generic helpers such as logging,
  upload validation, profile handling, screenshots, status output, and retries.
- Treat `publish-result.json` and `draft-fill-result.json` as local evidence,
  not as files to commit.

## Required Intake Before Real Runs

Before running real skill/CLI/browser work, ask or confirm:

- Target platforms and target account/profile for each platform.
- Where the finished images/videos are stored, the folder structure, and the
  exact image/video order to upload.
- Whether scheduling is needed.
- For multiple platforms or multiple works, the interval/cadence per platform.
- Whether titles should be optimized for distribution.
- Collection strategy: desired collection, whether to inspect collections, and
  whether a broad collection is better than a one-off one.
- Platform declarations: Xiaohongshu original declaration, Douyin personal
  opinion/declaration, and WeChat Channels declaration/category only after the
  logged-in UI confirms what exists.
- Music defaults, especially Douyin recommended/default music behavior.
- Final publish boundary: automation prepares and verifies the draft; a human
  reviews and performs the public publish action.

If the user does not want scheduling, warn before Douyin desktop Creator Center
runs that Douyin may not preserve drafts like Xiaohongshu. A Douyin batch may
require scheduling or finalizing one item before preparing the next. Xiaohongshu
can usually save drafts. WeChat Channels draft retention is unknown and
account-specific until verified for the logged-in profile.

## Command Shape

From the repository root:

```powershell
$Publisher = Join-Path (Get-Location) "skills\filler\scripts\filler.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher setup-draft-fill -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher copy-generate -WorkDir ".\work" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher copy-select -WorkDir ".\work" -TargetId "xhs-main-note" -CandidateId "xhs-main-note-2" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-plan -WorkDir ".\work" -TargetId "xhs-main-note" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher preflight -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher inspect-collections -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -ConfirmIntake -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher result-summary -WorkDir ".\work" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher diagnose-failure -WorkDir ".\work" -TargetId "xhs-main-note" -Json
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher robustness-matrix -Json
```

Use `-DryRun` before opening real platform pages. Real non-dry `draft-fill`
requires `-ConfirmIntake`; only pass it after the operator answered preflight
questions and reviewed confirmations. Use `-ConfirmAccountFingerprint`
only after the operator has verified that the current profile is the intended
account and `draft-plan.json` contains the expected `account_fingerprint`.

`needs_human` and exit code `4` mean the tool stopped intentionally for an
operator decision or manual platform step. Read `questions`, `confirmations`,
and `steps`; do not retry blindly.

## Reference Map

- Teammate quickstart and production flow: `README.md`.
- Production readiness and migration checklist:
  `references/production-readiness.md`.
- Failure triage, exit codes, profile locks, and artifact reading:
  `references/failure-diagnostics.md`.
- Xiaohongshu real runbook: `references/xhs-real-publish-runbook.md`.
- Douyin real runbook: `references/douyin-real-publish-runbook.md`.
- WeChat Channels real runbook:
  `references/wechat-channels-real-publish-runbook.md`.

Run docs-safe verification after documentation changes, such as `rg` checks for
required handoff terms and Markdown/link sanity. Run the full test script only
when code behavior changed or the user asks for it:

```powershell
rg -n "needs_human|final publish boundary|inspect-collections|robustness-matrix" skills/filler
```
