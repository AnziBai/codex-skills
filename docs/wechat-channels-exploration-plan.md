# WeChat Channels Exploration Plan

## Goal

Build the WeChat Channels adapter from observed page structure, not from guesses.

The next stage is read-only exploration plus artifact capture. Production adapter changes happen only after the page map is reviewed.

## Current Findings

- The outer app is `https://channels.weixin.qq.com/platform/...`.
- The actual content surface is a `content` frame backed by the WeChat Channels micro frontend.
- Video and image posts use different routes and controls.
- Directly opening the image-create route can render an empty micro frontend. The safer entry is the image list route, then click the visible publish-image entry.
- Image upload works through CDP against the file input inside the `content` frame.
- Uploaded image verification can use visible `img.slider-img` count.
- The image title is a normal text input with a 22-character limit.
- The image description is a custom contenteditable editor.
- Topic tags can be typed as `#tag` then confirmed with Enter; verified tokens render as `span.hl.topic`.
- Final public publish is the visible final publish button and must never be clicked.

## Architecture Decision

Use a three-step pipeline:

1. `inspect`: capture frame URLs, redacted visible-control metadata, screenshots, and candidate selectors.
2. `map`: convert inspection output into a reviewed `wechat-channels-map.json` with stable control contracts.
3. `adapter`: implement production behavior from the reviewed map only.

This keeps exploration code out of the production draft-fill path and protects the already working Xiaohongshu and Douyin adapters.

## Required Artifacts

For each surface, save:

- `frames.json`: all frame names, redacted URLs, load state, and text lengths, without raw visible text.
- `controls.json`: visible buttons, inputs, textareas, contenteditable elements, role/button areas, placeholders, bounding boxes, relevant classes, and text-present/text-length metadata only.
- `screenshot.png`: full-page screenshot.
- `dom.html`: redacted HTML placeholder, not raw outer page HTML.
- `frame-content.html`: redacted HTML placeholder, not raw content frame HTML.
- `network-notes.md`: only route observations, no cookies, tokens, localStorage, or request bodies.

Artifacts should be written under:

```text
out/wechat-channels-inspect/<timestamp>/<surface>/
```

## Surfaces To Inspect

1. Logged-out or expired login state.
2. Video publish page.
3. Image list page.
4. Image publish/create page.
5. Image upload after 1 image.
6. Image upload after 5 images.
7. Topic entry after each token is selected.
8. Collection dropdown opened.
9. Music dropdown opened.
10. Schedule controls opened.
11. Final ready-to-publish state.

## Implementation Path

### Phase 1: Inspector CLI

Add a separate inspector command or script, not a production adapter change:

```powershell
social-publisher inspect-wechat-channels -WorkDir ".\work" -TargetId "wechat-channels-main-image" -ProfileName "wechat-channels-main" -Json
```

Responsibilities:

- Open the dedicated Chrome profile.
- Navigate to a requested surface.
- Capture artifacts.
- Optionally perform explicitly scoped safe actions:
  - click the image-list publish-image entry
  - upload local test images
  - type sample title/body/tags
  - open dropdowns
- Never click final publish, save draft, or any irreversible account/action button.

### Phase 2: Page Map

Create `skills/social-publisher/references/wechat-channels-page-map.json`.

The map should describe:

- route strategy for image and video posts
- frame selection rules
- upload input discovery rules
- upload verification rules
- title selector and constraints
- description editor selector
- topic token verification rules
- collection dropdown behavior
- music default/selection behavior
- schedule field behavior
- publish-boundary verification

### Phase 3: Production Adapter

Only after the page map is reviewed:

- replace the generic `wechat_channels` adapter with platform-specific image/video branches
- keep each platform adapter isolated
- add helper tests for route choice, topic-token verification, upload-count parsing, and publish-boundary detection
- run live dry tests before real profile tests

## Risk Review

### Architecture

- Risk: direct create URLs can render empty frames.
  - Mitigation: route through list page and click the platform entry point when mapping confirms it.

- Risk: duplicate adapter keys or live-skill-only edits can silently override stable behavior.
  - Mitigation: repo is source of truth; live skill is synced from repo after tests.

- Risk: non-ASCII selectors can corrupt through ad hoc PowerShell pipes.
  - Mitigation: implementation code lives in UTF-8 files; temporary scripts read copy from JSON files or use escaped strings.

### Code Quality

- Keep WeChat Channels helpers separate from Xiaohongshu and Douyin helpers.
- Avoid large generic `clickByText` fallbacks for production actions.
- Prefer selector plus visible-state verification over coordinate clicks.
- Coordinate clicks are allowed only in inspector diagnostics and must be labeled as unstable.

### Tests

Required before adapter production:

- route choice for image vs video
- frame route matching
- upload count verification from `img.slider-img`
- title length truncation or blocking policy
- topic token verification using `.hl.topic`
- missing collection returns `needs_human`
- missing schedule input returns `needs_human`
- publish button is found but never clicked

### Performance

- Inspector should use bounded waits.
- Live adapter should not wait longer than necessary per step.
- Avoid full DOM dumps in normal production runs; reserve them for diagnostics.

## Open Decisions

- Whether WeChat Channels image posts should keep the default auto-selected music or explicitly remove/replace it.
- Whether collection is required for WeChat Channels, or only best-effort like current V1.
- Whether scheduled publishing should be mandatory for batches or a preflight-only decision.
- Whether to create collections automatically on WeChat Channels or require human setup.

## Recommended Next Step

Implement only the inspector first, then run it on the logged-in profile and review `wechat-channels-map.json` before touching the production adapter.
