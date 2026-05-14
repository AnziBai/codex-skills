# Filler Verification Evidence

Last updated: 2026-05-13

This document records sanitized evidence for the social publisher draft-fill flows. It intentionally stores only relative artifact references and status summaries. Do not paste screenshots, raw DOM, cookies, localStorage, account names, phone numbers, user IDs, auth headers, or absolute Chrome profile paths here.

## Classification Rules

- `production-ready`: at least two dated evidence entries for the same platform surface/profile class, with required steps verified and the final publish button not clicked. An intentionally absent collection can be `needs_human` if the run otherwise reaches the publish boundary.
- `production-candidate`: main flow reaches the publish boundary, but a non-critical step still needs conservative manual handling.
- `experimental`: page map or adapter exists, but the real flow does not yet have enough evidence.

## Current Surface Status

| Platform surface | Status | Evidence summary |
| --- | --- | --- |
| Xiaohongshu image note | `production-ready` | Two image cases reached the publish boundary; one scheduled single-image case was fully `done`, one multi-image case only needed human collection handling. |
| Douyin image post | `production-ready` | Two image cases were `done`, including immediate and scheduled runs. |
| WeChat Channels image post | `production-candidate` | Two image cases reached the publish boundary; both still needed human collection handling. |
| WeChat Channels video post | `experimental` | No completed real video draft-fill evidence recorded in this table. |

## Evidence Entries

| Date | Case | Platform | Profile alias | Target | Overall | Non-done steps | Publish boundary preserved | Sanitized artifact references |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-13 | `douyin_immediate_single_smallfund` | `douyin` | `douyin-main` | `douyin_immediate_single_smallfund_target` | `done` | none | yes, final publish button not clicked | `out/robustness-20260513-1327/douyin_immediate_single_smallfund/draft-fill-result.json`; `out/robustness-20260513-1327/douyin_immediate_single_smallfund/logs/douyin_immediate_single_smallfund_target/run.json`; `out/robustness-20260513-1327/douyin_immediate_single_smallfund/logs/douyin_immediate_single_smallfund_target/screenshots/douyin-final.png` |
| 2026-05-13 | `douyin_scheduled_cycle` | `douyin` | `douyin-main` | `douyin_scheduled_cycle_target` | `done` | none | yes, final publish button not clicked | `out/robustness-20260513-1327/douyin_scheduled_cycle/draft-fill-result.json`; `out/robustness-20260513-1327/douyin_scheduled_cycle/logs/douyin_scheduled_cycle_target/run.json`; `out/robustness-20260513-1327/douyin_scheduled_cycle/logs/douyin_scheduled_cycle_target/screenshots/douyin-final.png` |
| 2026-05-13 | `xhs_immediate_ma` | `xiaohongshu` | `xhs-main` | `xhs_immediate_ma_target` | `needs_human` | `collection:needs_human` | yes, final publish button not clicked | `out/robustness-20260513-1327/xhs_immediate_ma/draft-fill-result.json`; `out/robustness-20260513-1327/xhs_immediate_ma/logs/xhs_immediate_ma_target/run.json`; `out/robustness-20260513-1327/xhs_immediate_ma/logs/xhs_immediate_ma_target/screenshots/xiaohongshu-final.png` |
| 2026-05-13 | `xhs_scheduled_single_breakout` | `xiaohongshu` | `xhs-main` | `xhs_scheduled_single_breakout_target` | `done` | none | yes, final publish button not clicked | `out/robustness-20260513-1327/xhs_scheduled_single_breakout/draft-fill-result.json`; `out/robustness-20260513-1327/xhs_scheduled_single_breakout/logs/xhs_scheduled_single_breakout_target/run.json`; `out/robustness-20260513-1327/xhs_scheduled_single_breakout/logs/xhs_scheduled_single_breakout_target/screenshots/xiaohongshu-final.png` |
| 2026-05-13 | `wechat_immediate_discipline` | `wechat_channels` | `wechat-channels-main` | `wechat_immediate_discipline_target` | `needs_human` | `collection:needs_human` | yes, final publish button not clicked | `out/robustness-20260513-1327/wechat_immediate_discipline/draft-fill-result.json`; `out/robustness-20260513-1327/wechat_immediate_discipline/logs/wechat_immediate_discipline_target/run.json`; `out/robustness-20260513-1327/wechat_immediate_discipline/logs/wechat_immediate_discipline_target/screenshots/wechat-channels-final.png` |
| 2026-05-13 | `wechat_scheduled_music` | `wechat_channels` | `wechat-channels-main` | `wechat_scheduled_music_target` | `needs_human` | `collection:needs_human` | yes, final publish button not clicked | `out/robustness-20260513-1327/wechat_scheduled_music/draft-fill-result.json`; `out/robustness-20260513-1327/wechat_scheduled_music/logs/wechat_scheduled_music_target/run.json`; `out/robustness-20260513-1327/wechat_scheduled_music/logs/wechat_scheduled_music_target/screenshots/wechat-channels-final.png` |

## Evidence Gaps

- WeChat Channels collection discovery now has a conservative inspector/cache path, but it still needs new real evidence with a verified account fingerprint before image flow can be called production-ready.
- WeChat Channels video flow still needs a separate real upload and field verification pass.
- Artifact references above point to local generated output and must not cause `out/`, screenshots, DOM snapshots, cookies, or Chrome profiles to be committed.
