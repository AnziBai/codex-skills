# Social Publisher

Production-oriented social publishing assistant for finished creative works.

`social-publisher` turns a prepared work directory into platform-ready copy,
browser-fill plans, repeatable draft automation, logs, screenshots, and a clear
handoff state. It is built as a Codex skill plus CLI so teammates can run the
same workflow without replaying a long chat history.

The core rule is simple: the CLI may prepare the draft, but a human clicks the
final public publish button.

## Why This Exists

Publishing work is not hard because buttons exist. It is hard because every
platform asks for slightly different decisions:

- a title that earns traffic without lying about the asset
- platform-native body copy and tags
- collection/category choice
- original or content-source declarations
- music and schedule settings
- stable recovery when a page changes or upload stalls

This project splits those concerns cleanly:

```text
finished work directory
        |
        v
AI copy layer
        |
        v
draft-plan.json
        |
        v
Playwright draft filler
        |
        v
ready-to-review platform draft
        |
        v
human final publish click
```

## Architecture

| Layer | Responsibility | Output |
| --- | --- | --- |
| AI copy layer | Generate and select titles, body text, tags, cover text, and platform-specific phrasing. | `copy-pack.json`, `selected-copy.json` |
| Publish kernel | Validate work directories, accounts, assets, status, idempotency, and manual packages. | `publish-result.json`, `manual/*.md` |
| Draft planner | Convert selected copy and assets into a deterministic browser execution plan. | `draft-plan.json` |
| Playwright draft filler | Reuse dedicated Chrome profiles, upload assets, fill fields, verify state, and stop before publish. | `draft-fill-result.json`, logs, screenshots |
| Diagnostics | Explain failed runs from artifacts instead of guessing from memory. | `logs/<target-id>/run.json`, DOM snapshots |

Browser Use and live browser inspection are reserved for exploration and repair.
They are not the production path for routine publishing.

## Platform Status

As of 2026-05-12:

| Platform | Status | Covered |
| --- | --- | --- |
| Xiaohongshu | Stable to final publish boundary | Image upload, Chinese title/body, topic token selection, collection, original declaration, content declaration, optional schedule, publish-boundary verification |
| Douyin | Stable to final publish boundary | Multi-image upload with visible count verification, title/body, topic token selection, collection, personal-view declaration, first recommended music, schedule handling, publish-boundary verification |
| WeChat Channels | Pending | First exploratory run stopped at login; logged-in page mapping is next |

## Repository Layout

```text
.
|-- README.md
|-- AGENTS.md
|-- docs/
|   |-- social-publisher-handoff.md
|   `-- self-evolution-memory-system.md
|-- scripts/
|-- skills/
|   `-- social-publisher/
|       |-- SKILL.md
|       |-- draft-fill/
|       |-- references/
|       `-- scripts/
```

Local browser state, generated work directories, logs, screenshots, DOM
snapshots, account configs, and `node_modules` are intentionally ignored.

## Quick Start

Run the packaged skill from this repository.

Install draft-fill dependencies and create dedicated Chrome profiles:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" setup-draft-fill -Json
```

Create a sample work directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" sample-run -Platform "xiaohongshu" -Json
```

Check unresolved choices before touching a real browser:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" preflight -WorkDir ".\work" -TargetId "xhs-main-note" -Json
```

Fill a platform draft:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -Json
```

Diagnose a failed run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\social-publisher.ps1" diagnose-failure -WorkDir ".\work" -TargetId "xhs-main-note" -Json
```

## Work Directory Contract

```text
work/
|-- manifest.json
|-- assets/
|-- copy-pack.json
|-- selected-copy.json
|-- draft-plan.json
|-- publish-result.json
|-- manual/
`-- logs/
```

The work directory is the interface between upstream content generation,
copywriting, browser draft filling, and final human review.

## Production Rules

- Never click the final public publish button in automation.
- Run `preflight` before real browser automation and ask the user about unclear
  title, schedule, collection, music, account, or batch-cadence decisions.
- Keep platform adapters separate. Share only generic utilities such as logging,
  screenshots, retries, file validation, and status modeling.
- Add tags through the platform suggestion UI. Plain pasted hashtags are not
  accepted as valid topic tokens.
- On failure, inspect `run.json`, screenshots, and DOM snapshots before changing
  selectors.
- Do not commit Chrome profiles, cookies, local storage, account configs,
  screenshots, DOM snapshots, generated work directories, or installed
  dependencies.

## Validation

Run the test suite:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\social-publisher\scripts\test-social-publisher.ps1"
```

Useful targeted checks:

```powershell
node --check ".\skills\social-publisher\draft-fill\src\cli.mjs"
node --check ".\skills\social-publisher\draft-fill\src\adapters.mjs"
node --check ".\skills\social-publisher\draft-fill\src\utils.mjs"
```

## Handoff

Read [docs/social-publisher-handoff.md](docs/social-publisher-handoff.md) before
continuing platform work. It records the latest platform status, validation
results, and the next steps for WeChat Channels.
