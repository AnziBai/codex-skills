# Social Publisher Workspace

This workspace packages and tests the `social-publisher` Codex skill.

The product direction is:

- AI copy layer for titles, body text, tags, cover text, and publishing choices.
- Playwright CLI draft filler for deterministic upload and form filling.
- Human final publish click. Automation must stop at the ready-to-publish boundary.
- Browser Use or live browser inspection is diagnostic/exploratory, not the production path.

## Current Platform Status

As of 2026-05-12:

| Platform | Status | Notes |
| --- | --- | --- |
| Xiaohongshu | Stable to final publish boundary | Upload, Chinese title/body, topic token selection, collection, original declaration, content declaration, optional schedule, and publish-boundary verification are covered. |
| Douyin | Stable to final publish boundary | Multi-image upload, title/body, topic token selection, collection, personal-view declaration, first recommended music, schedule handling, and publish-boundary verification are covered. |
| WeChat Channels | Pending | Login blocked the first exploratory run. Implement this adapter next. |

## Useful Commands

Run the packaged skill from this repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" setup-draft-fill -Json
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" sample-run -Platform "xiaohongshu" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" preflight -WorkDir ".\work" -TargetId "xhs-main-note" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -Json
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" diagnose-failure -WorkDir ".\work" -TargetId "xhs-main-note" -Json
```

Run tests:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\test-social-publisher.ps1"
```

## Handoff

Read [docs/social-publisher-handoff.md](docs/social-publisher-handoff.md) before continuing platform work.

Important local-only state is intentionally ignored by Git:

- Chrome profiles and login state.
- `node_modules`.
- Generated test work directories.
- Logs, screenshots, DOM snapshots, result JSON, and local account configs.

