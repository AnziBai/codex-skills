---
name: social-publisher
description: CLI-first AI copy layer plus safe publishing kernel for finished social works. Use when the user wants to generate platform copy candidates, select copy, validate, publish, resume, retry, or record results for completed work directories targeting WeChat official account articles, WeChat sticker posts, Xiaohongshu, Douyin, or dry-run publishing.
---

# Social Publisher

Use this skill for completed social works that need platform-ready publishing prep and safe execution.

V1 has three layers:

- AI copy layer: generate title/body/tag/caption candidates for each target, then let a human choose.
- Deterministic publish kernel: validate assets/accounts, create manual packages, write status/results, and preserve idempotency.
- Playwright CLI draft filler: reuse dedicated Chrome profiles, upload assets, fill platform drafts deterministically, then stop before final publish.

Default stance:

- Do not change `manifest.json` during copy generation or selection.
- Do not use browser automation in V1 publish paths.
- Do not bypass CAPTCHA, private APIs, or platform risk controls.
- Prefer manual or dry-run paths unless a real official adapter is explicitly implemented and verified.
- Final public posting remains human-confirmed unless the user intentionally enables a future real adapter.
- For real platform browser flows, never click the final public `发布` / `提交` / `确认发布` button. Automation stops after preparing and verifying the ready-to-publish draft; the human operator performs the final click to reduce platform automation-risk signals.

## V1 Commands

Run the V1 CLI:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" copy-generate -WorkDir ".\work" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" copy-select -WorkDir ".\work" -TargetId "xhs-main-note" -CandidateId "xhs-main-note-2" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" draft-plan -WorkDir ".\work" -TargetId "xhs-main-note" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" setup-draft-fill -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" doctor -WorkDir ".\work" -TargetId "xhs-main-note" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" sample-run -Platform "xiaohongshu" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" preflight -WorkDir ".\work" -TargetId "xhs-main-note" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" diagnose-failure -WorkDir ".\work" -TargetId "xhs-main-note" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" validate -WorkDir ".\work" -AccountsPath ".\accounts.json" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" publish -WorkDir ".\work" -AccountsPath ".\accounts.json" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" resume -WorkDir ".\work" -AccountsPath ".\accounts.json" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" retry-failed -WorkDir ".\work" -AccountsPath ".\accounts.json" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" record-manual-result -WorkDir ".\work" -TargetId "xhs-main-note" -Url "https://..." -RemoteId "..." -Json
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" status -WorkDir ".\work" -Json
```

Machine-readable output is stdout when `-Json` is present. Human/errors go to stderr. `publish-result.json` is the publish source of truth.

## Copy Layer Contract

`copy-generate` reads `manifest.json` and writes:

```text
work/
  copy-pack.json
  copy-pack.md
```

The CLI generator is a deterministic fallback draft generator for testing and team portability. When Codex is running this skill interactively, Codex may generate richer AI candidates, but it must write the same `copy-pack.json` and `copy-pack.md` contract and must not require teammates to configure an API key.

`copy-pack.json` shape:

```json
{
  "schema_version": "1.0",
  "work_id": "stable-unique-id",
  "generated_at": "2026-05-12T09:00:00+08:00",
  "generation_mode": "cli_structured_draft",
  "targets": {
    "xhs-main-note": {
      "platform": "xiaohongshu",
      "recommended_candidate_id": "xhs-main-note-2",
      "information_gaps": [],
      "candidates": [
        {
          "candidate_id": "xhs-main-note-1",
          "title": "Candidate title",
          "body": "Candidate body",
          "tags": ["tag1"],
          "cover_text": "Cover text",
          "reason": "Why this version may work"
        }
      ]
    }
  }
}
```

`copy-select` reads `copy-pack.json` and writes `selected-copy.json`. The publish kernel uses `selected-copy.json` first when producing manual packages, then falls back to target overrides and manifest fields.

`draft-plan` reads `manifest.json` plus `selected-copy.json` and writes `draft-plan.json`. This is the Playwright draft-fill input. It contains absolute `asset_paths`, selected title/body/tags, platform declaration, music strategy, schedule, and `stop_before_publish: true`.

For Xiaohongshu image notes, treat `cover_text` as a first-class field. The most important title is often the large headline on the first image, not only the platform title input. Copy generation should provide a short, punchy first-image headline separately from the body text so a future cover-image/RPA step can place it onto the first image before draft filling.

## Playwright Draft Fill

The production draft filler lives in `draft-fill/`. It is a Node + Playwright CLI called through the PowerShell entrypoint.

Run setup once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\social-publisher.ps1" setup-draft-fill -Json
```

It creates dedicated Chrome profile folders under `profiles/`. Log into each platform once in its profile; later runs reuse that profile and avoid interfering with daily Chrome.

Workflow:

1. Generate/select copy with the CLI.
2. Run `draft-plan` for the target.
3. Run `preflight` and resolve every returned question before touching the real platform.
4. Run `draft-fill` with the target profile.
5. CLI opens the platform publish page, uploads assets, fills fields, and records logs/screenshots.
6. Review any `needs_human` steps. Use `diagnose-failure` for a concise failure report.
7. Human clicks final publish only after review.

The old Chrome Extension under `extension/` is experimental only. Do not use it as the production path unless explicitly testing extension behavior.

## Production UX Contract

Treat the CLI as a publishing assistant, not a silent script.

- Run `doctor` before real draft filling when a profile is new, a page changed, or a user reports flaky behavior.
- Run `preflight` before real draft filling. If it returns `questions`, stop and ask the user those decisions in plain language.
- Tell the user what will happen before real browser work: platform, profile, asset count, title, tags, collection, declaration, music, schedule, and the final publish boundary.
- During execution, surface each step status: upload, title, body, topics, collection, declaration, music, schedule, and publish boundary.
- After a failure, run `diagnose-failure` and use the latest `run.json`, screenshot, and DOM snapshot instead of guessing.
- Never click the final public publish button in automation.

For detailed productization guidance, read `references/production-readiness.md` when packaging this skill for teammates. Read `references/failure-diagnostics.md` when a run fails or when adding a new platform adapter.

## Draft Fill Reality Checks

Draft filling is not a generic paste operation. Before considering a platform draft flow verified, test each required interaction on the real target surface.

Xiaohongshu specifics:

- Use a real Chrome session for file-upload verification. The Codex in-app browser can validate login and text fields, but it does not prove local file upload works.
- Production draft filling uses the Playwright CLI with dedicated Chrome profiles. Codex-side Chrome/browser-use sessions are exploratory QA and repair diagnostics, not the team workflow.
- Do not paste tags as plain text and assume they are valid. Each hashtag must be entered through the platform's topic picker/autocomplete and visibly converted into the platform's selected topic token.
- Turn on the original-content declaration for finished original works before publishing. Verification must confirm the `原创声明` checkbox/switch is enabled.
- Treat `cover_text` as the first-image headline. The displayed first image is often the primary title surface; form title is secondary metadata.
- Collection selection is content-aware. The draft assistant should inspect available collections and choose the best match from work metadata, account strategy, or an explicit target override.
- Scheduled publishing is content-aware. The draft assistant should recommend and set a time from `publish_at`, platform constraints, and account cadence, then stop before final publish.
- Verification must check visible selected state for image upload, selected topic tokens, selected collection, original declaration, scheduled time when used, and unpublished final state.

## Product Knowledge And Collection Strategy

## Copy And Scheduling Questions

Before filling or publishing a real platform draft, ask whether the user wants optimized traffic-oriented titles. Treat the platform title as a first-order distribution lever, not a literal copy of the first image or manifest title. Use the work's actual content, product knowledge, audience, and platform style to propose a stronger title when appropriate, while preserving factual accuracy and avoiding clickbait that the asset cannot support.

For Xiaohongshu, Douyin, and WeChat video/account posting flows, ask whether the user wants scheduled publishing before final submission. If yes, ask for the target publish time. When multiple works are being published in one batch, also ask for the interval between scheduled posts and apply that cadence consistently unless a per-work override is provided.

## Real Xiaohongshu Runbook

For real Xiaohongshu publish tests, follow `references/xhs-real-publish-runbook.md`. It captures the current production lessons: optimize titles as distribution assets, ask or honor scheduling decisions, verify topic tokens, choose collections using product knowledge, complete the two-step original declaration flow, stop before the final publish click, and preserve the live Chrome draft if the Codex browser automation transport fails.

## Real Douyin Runbook

For real Douyin publish tests, follow `references/douyin-real-publish-runbook.md`. It captures the current production lessons: Douyin topics must be selected through the platform topic UI instead of pasted plain hashtags, `自主声明` is a Douyin-specific content declaration and not Xiaohongshu-style originality, collection/scheduling controls are in different page sections, and automation must stop before the human final publish click.

## Real WeChat Channels Runbook

For real WeChat Channels publish tests, follow `references/wechat-channels-real-publish-runbook.md`. This adapter is not production-ready until a logged-in profile has been inspected and the run log proves visible upload state, correct title/body fields, platform-specific tag/category/declaration handling, schedule behavior, and the final publish boundary.

When a product knowledge base is available, use it to choose a broad collection. Do not choose only from surface title words. Prefer collections that can hold a reusable class of works instead of overly narrow one-off collections.

For `概率的朋友` / Bridge Doctor / 宽论 content:

- `宽论`: use for works about the core theory system and its three tools, including `弹论`, `CDVA`, `带鱼/短鱼`, signal validation, trend-vs-noise logic, and standing on probability advantage.
- `KDJ指标详解`, `MACD指标详解`, `均线指标`: use only when the work is primarily about that specific technical indicator.
- `交易心得`: use for broad trading discipline, behavior, mindset, review habits, and practical experience that is not clearly one of the named theory/indicator systems.
- `概率的朋友` or book/reading-club style collections, if present, fit book-selling points, Bridge Doctor IP, QMACD community, paid products, reading club, and learning-method content.
- If no suitable broad collection exists, create one broad collection such as `宽论体系`, `交易认知`, or `概率的朋友`, not a highly specific collection for a single post.

## Work Directory Contract

```text
work/
  manifest.json
  assets/
  copy-pack.json
  copy-pack.md
  selected-copy.json
  publish-result.json
  manual/
  logs/
  .publish.lock
```

Recommended `manifest.json` shape:

```json
{
  "schema_version": "1.0",
  "work_id": "stable-unique-id",
  "status": "finished",
  "content_format": "markdown",
  "title": "Original work title",
  "body": "Original body or description",
  "summary": "Short summary",
  "audience": "Target audience",
  "selling_points": ["Point 1", "Point 2"],
  "tone": "Professional but friendly",
  "assets": {
    "cover": "assets/cover.jpg",
    "images": ["assets/1.jpg"],
    "video": "assets/video.mp4"
  },
  "tags": ["tag1"],
  "publish_mode": "immediate",
  "publish_at": "2026-05-12T09:00:00+08:00",
  "targets": [
    {
      "target_id": "xhs-main-note",
      "platform": "xiaohongshu",
      "kind": "note",
      "account_id": "xhs_main",
      "overrides": {
        "caption": "Platform-specific caption #tag1"
      }
    }
  ]
}
```

Rules:

- `target_id` is mandatory and stable.
- Results are keyed by `target_id`, not platform.
- Idempotency key is `work_id:target_id`.
- Asset paths must be relative and stay inside the work directory.
- `finished` means upstream approved the work, not that every platform requirement passes.

## Accounts Contract

Use local account config. Never put secrets in the work directory.

```json
{
  "accounts": [
    {
      "account_id": "mock_main",
      "platform": "mock",
      "auth": { "type": "none" },
      "configured_capabilities": ["dry_run_publish"],
      "verified_scopes": ["dry_run_publish"],
      "last_verified_at": "2026-05-11T00:00:00+08:00"
    }
  ]
}
```

V1 supports:

- `mock`: deterministic dry-run publish.
- `xiaohongshu`: manual package.
- `wechat_sticker`: manual package.
- `douyin`: validation/stub only; real publish disabled in V1.
- `wechat_article`: validation/stub only; real publish disabled in V1.

## Status Model

Target statuses:

`pending`, `not_ready`, `blocked`, `manual_required`, `in_progress`, `submitted`, `in_review`, `published`, `rejected`, `retryable_failed`, `failed`, `unknown`.

Important behavior:

- API submit is not treated as published.
- Existing `published` targets are skipped.
- There is no generic force republish in V1.
- `record-manual-result` moves a manual target to `published`.
- `manual_required` generates `manual/<target_id>.md`.

Exit codes:

- `0`: success
- `1`: internal error
- `2`: validation/blocked
- `3`: not ready
- `4`: manual required
- `5`: partial failure
- `6`: lock held

## Validation And Tests

Run tests after changes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.codex\skills\social-publisher\scripts\test-social-publisher.ps1"
```

The test script covers copy generation, copy selection, draft-plan generation, draft-fill dry-run, selected-copy manual package integration, manual result recording, dry-run publishing, idempotent reruns, future scheduled work, duplicate target IDs, and asset path escape rejection.
