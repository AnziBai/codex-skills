# Social Publisher Handoff

Last updated: 2026-05-12.

## Branch And Commit

- Repository: `C:\Users\Administrator\Documents\New project 5`
- Branch: `codex/social-publisher-production-cli`
- Latest local commit: `6e2ec29 feat: package social publisher skill`
- Push status: blocked because no `origin` remote is configured and GitHub CLI is not available.

## Completed Work

- Packaged the `social-publisher` skill under `skills/social-publisher/`.
- Added the production CLI path: AI copy, `draft-plan`, `preflight`, Playwright `draft-fill`, and `diagnose-failure`.
- Added distribution guardrails through `.gitignore` so profiles, local sessions, generated logs, and secrets are not committed.
- Added runbooks and references for Xiaohongshu, Douyin, production readiness, and failure diagnostics.

## Validation

Completed on 2026-05-12:

- Node syntax checks passed for `cli.mjs`, `adapters.mjs`, and `utils.mjs`.
- `sample-run` passed for Xiaohongshu and Douyin.
- `preflight` passed for the Douyin test work directory.
- `diagnose-failure` returned clean status for the current Douyin run.
- On 2026-05-13, Douyin upload validation was tightened so the run log must prove visible page state such as `已添加5张图片`.
- `test-social-publisher.ps1` passed for the packaged repository copy.
- Skill validation passed when run with UTF-8 enabled and the bundled Python 3.12.10.

## Platform Run Status

### Xiaohongshu

Status: stable to the final publish boundary.

Covered behavior:

- Upload image assets.
- Fill Chinese title and body.
- Add each tag by typing one tag and immediately clicking the first suggestion, so it becomes a platform topic token.
- Choose a broad collection, currently the Kuanlun collection for the tested work.
- Complete content declaration and original declaration, including the second confirmation.
- Set schedule when requested.
- Verify the final publish button exists without clicking it.

### Douyin

Status: stable to the final publish boundary.

Covered behavior:

- Upload multi-image assets and verify the page-visible uploaded image count.
- Fill Chinese title and body.
- Add each topic through the first suggestion.
- Choose the Kuanlun collection.
- Mark the content as personal viewpoint or opinion when requested by the plan.
- Choose the first recommended music item.
- Set schedule and report platform-adjusted later times.
- Verify the final publish button exists without clicking it.

Latest robustness result: five consecutive Douyin runs completed with `overall_status: done` after schedule handling was fixed.

### WeChat Channels

Status: pending.

The first exploratory run stopped at login:

```text
https://channels.weixin.qq.com/login.html
```

Existing test work:

```text
C:\Users\Administrator\Documents\New project 5\wechat-channels-test-work
```

Suggested next command after logging into the dedicated profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" draft-fill -WorkDir ".\wechat-channels-test-work" -TargetId "wechat-channels-main-image" -ProfileName "wechat-channels-main" -Json
```

Read `skills/social-publisher/references/wechat-channels-real-publish-runbook.md` before implementing selectors.

## Engineering Rules To Preserve

- Keep platform adapters separate. Share utilities only for logging, screenshots, profile handling, retries, file validation, and generic status output.
- Do not click the final public publish button.
- Do not commit or distribute Chrome profiles, cookies, local storage, account configs, screenshots, DOM snapshots, generated work directories, or `node_modules`.
- Run `preflight` before real browser automation and ask the user about unclear schedule, collection, music, profile, or title-optimization choices.
- On failure, read `run.json`, screenshots, and DOM snapshots before changing selectors.

## Next Steps

1. Configure a GitHub remote or working GitHub connector, then push `codex/social-publisher-production-cli`.
2. Decide whether to delete or preserve the current untracked QA/sample JSON files.
3. Log into WeChat Channels in the `wechat-channels-main` profile.
4. Run the WeChat Channels draft fill command and collect page structure, screenshots, and failure artifacts.
5. Implement the `wechat_channels` adapter until it reaches the final publish boundary.
6. Run repeated robustness checks for WeChat Channels.
