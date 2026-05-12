# Platform Notes

These notes guide safe publishing decisions. Platform capabilities change, so verify official docs before implementing live posting.

## WeChat Official Account

Preferred automation path:

1. Upload images/materials through official account APIs.
2. Create or update a draft.
3. Submit publish action if the account has permission and the user has approved the content.
4. Store returned media IDs, article IDs, and publish IDs in the audit log.

Fallback:

- Generate HTML/Markdown content, cover checklist, title, author, digest, and manual publishing steps.

## WeChat Image/Video Account

The phrase "贴图号" can mean different workflows. Treat it as a manual target until the user confirms whether they mean Video Account, image-only account operations, or another WeChat surface.

Fallback:

- Generate a short caption, image/video list, cover choice, topics, and manual publishing checklist.

## Xiaohongshu

Default to manual or assisted publishing. Public API access for note publishing is not generally safe to assume.

Package requirements:

- title tuned for discovery
- short first paragraph
- image order
- hashtags
- product or advertising disclosure if relevant
- manual posting checklist

Avoid:

- private API reverse engineering
- CAPTCHA bypass
- bulk cookie automation without explicit user risk acceptance

## Douyin

Preferred automation path:

1. Upload video through official OpenAPI.
2. Create video with text, topics, cover timestamp or uploaded cover.
3. Record returned item/video IDs.
4. Poll status if available.

Known constraints to verify:

- posting scope is approved
- user OAuth token is valid
- video length and size meet platform limits
- daily posting limits and audit delay are acceptable

Fallback:

- Generate caption, hashtags, cover instruction, and manual upload checklist.
