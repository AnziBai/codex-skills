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

## Guided Intake Before Real Runs

Do not dump a long form or ask the user to fill a template. First inspect the
work directory, manifest, draft plan, known profiles, collection cache, and the
user's latest request. Infer safe defaults, then ask only the unresolved
decisions.

- Ask at most 1-3 questions in one round. Prefer clickable single-choice
  options when the client supports them; otherwise present the same choices as
  short numbered bullets.
- Put the recommended option first and mark it clearly. Avoid free-form input
  unless the operator must provide a path, exact time, or exact collection name.
- Confirm inferred facts instead of asking for them: target platforms, account
  profile, asset folder/order, title source, tags, collection, schedule, and
  final publish boundary.
- Before any real browser work, run `preflight`. It now performs config checks
  for draft-fill package files, Playwright availability, profile validity, and
  profile creation. If a profile is missing, it is created automatically and the
  user is only asked to log in once.
- Login itself is never bypassed. Platform adapters check the opened page for
  login/auth URLs and stop with `needs_human` instead of failing mysteriously.
- If scheduling is absent, warn that Douyin desktop Creator Center may not
  preserve drafts like Xiaohongshu. A Douyin batch may require scheduling or
  finalizing one item before preparing the next. Xiaohongshu can usually save
  drafts. WeChat Channels draft retention is unknown until the logged-in profile
  proves it.
- Final publish boundary is a confirmation, not a question: automation prepares
  and verifies the draft; a human reviews and performs the public publish click.

Good intake shape:

```text
我已识别：小红书 + 抖音，素材来自 21-40 的 18 个子文件夹，每组按 1.png 到 5.png 上传；标题默认从首图/文件夹名优化；最终发布按钮由人工点击。

还需要你点选 3 项：
1. 是否定时：不定时 (Recommended) / 单条定时 / 批量定时
2. 平台：小红书+抖音 (Recommended) / 三平台 / 自定义
3. 合集策略：自动选择宽泛合集 (Recommended) / 跳过合集 / 我指定合集
```

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
