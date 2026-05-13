# WeChat Channels Real Publish Runbook

Use this runbook when implementing or testing the `wechat_channels` draft-fill adapter.

## Current Status

As of 2026-05-13, WeChat Channels is not production-ready. The first real run stopped at:

```text
https://channels.weixin.qq.com/login.html
```

Do not infer field selectors from Xiaohongshu or Douyin. WeChat Channels needs its own page mapping.

## Development Order

1. Log into the dedicated `wechat-channels-main` Chrome profile.
2. Run `preflight` against the WeChat Channels work directory.
3. Run `draft-fill` once and stop at the first `needs_human` or `failed` step.
4. Inspect `logs/<target-id>/run.json`, screenshots, and DOM snapshots.
5. Map the real page fields:
   - upload control
   - visible uploaded asset count or thumbnail state
   - title field, if present
   - body/description editor
   - topic/tag selector, if present
   - collection/category controls, if present
   - original/content declaration controls, if present
   - schedule controls
   - final publish button boundary
6. Implement only the confirmed fields in the `wechat_channels` adapter.
7. Re-run one real draft-fill and then repeated robustness checks.

## Acceptance Bar

The adapter is not done until the run log proves:

- The upload step verifies visible page state, not only file input success.
- Title/body are filled into the correct WeChat Channels fields.
- Tags/topics are selected through the platform UI when the platform requires tokenized suggestions.
- Collection/category and declaration behavior is either completed or explicitly reported as `needs_human`.
- Schedule uses the requested time or reports a platform-adjusted time.
- The final publish button is visible but not clicked.

## Safety

- Never click the final public publish button.
- Do not read or export cookies, local storage, or account secrets.
- Do not mix Xiaohongshu originality declaration or Douyin personal-opinion declaration into WeChat Channels without seeing the actual WeChat UI.
- If login is required, stop with `needs_human` and preserve artifacts.

