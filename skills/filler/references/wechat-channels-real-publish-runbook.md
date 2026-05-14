# WeChat Channels Real Publish Runbook

Use this runbook when testing, diagnosing, or handing off the
`wechat_channels` draft-fill adapter.

## Current Status

As of 2026-05-13, WeChat Channels image posting is `production-candidate` only
for accounts whose logged-in profile has been inspected and verified. Prior real
image draft-fill runs reached the final publish boundary without clicking it,
but collection/category behavior can still return `needs_human` when the
requested option is missing or the UI is account-specific.

The adapter can inspect and cache visible collection names, but draft filling
trusts that cache only when `draft-plan.json` has a stable
`account_fingerprint` and the operator runs `inspect-collections` with
`-ConfirmAccountFingerprint` after checking the visible account.

WeChat Channels video posting remains `experimental` unless a newer run log
proves the complete video path.

Do not infer fields, selectors, declarations, scheduling behavior, or draft
retention from Xiaohongshu or Douyin. WeChat Channels must be mapped from its
own logged-in page.

## Before A Real Run

Ask or confirm:

- Target WeChat Channels account and Chrome profile, usually
  `wechat-channels-main`.
- Whether the work is image or video.
- Finished asset folder and exact image/video order.
- Whether scheduling is needed.
- For multiple works, the WeChat Channels cadence/interval. Do not copy the
  Xiaohongshu or Douyin cadence unless the user says so.
- If no scheduling is needed, warn that WeChat Channels draft retention is
  unknown and account-specific until verified for this profile.
- Title optimization preference.
- Category/collection strategy, if the logged-in UI exposes one.
- Stable `account_fingerprint` for this profile when automatic collection
  selection is required.
- Declaration/compliance controls, only after the logged-in UI confirms what
  WeChat Channels currently provides.
- Final publish boundary: automation stops before the public publish action.

## Setup

Initialize and log into the profile:

```powershell
$Publisher = "C:\Users\Administrator\Documents\New project 5\skills\filler\scripts\filler.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher setup-draft-fill -ProfileName "wechat-channels-main" -Json
```

Use only this dedicated profile for the target account. Do not copy cookies or
profile folders between machines.

## Recommended Run Order

Build the plan:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-plan -WorkDir ".\work" -TargetId "<target-id>" -Json
```

Preflight:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher preflight -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "wechat-channels-main" -Json
```

If preflight returns `needs_human` or exit code `4`, answer the questions before
opening the real page.

If collection selection should be automatic, add a stable
`account_fingerprint` to the manifest or target override before inspecting
collections.

Inspect collections and trust the cache only after the visible account is
verified:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher inspect-collections -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "wechat-channels-main" -ConfirmAccountFingerprint -Json
```

Optional page inspection for mapping work:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher inspect-wechat-channels -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "wechat-channels-main" -Surface "post" -Json
```

Dry-run:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-fill -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "wechat-channels-main" -DryRun -Json
```

Real draft fill:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher draft-fill -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "wechat-channels-main" -ConfirmIntake -Json
```

Summarize:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher result-summary -WorkDir ".\work" -Json
```

Diagnose on any stop:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher diagnose-failure -WorkDir ".\work" -TargetId "<target-id>" -Json
```

## Image Posting Caveats

WeChat Channels image posting is not a generic upload form. Verify each real
profile and account:

- The upload step must prove visible uploaded image state, such as thumbnails or
  count, not only file input success.
- Preserve the requested image order from `draft-plan.json`.
- Confirm whether the first image acts as cover, preview, or just the first item.
- Confirm title and body fields separately; some surfaces may expose only a body
  or description.
- Confirm whether tags/topics exist and whether they require suggestion tokens.
- Confirm category/collection controls from the logged-in UI. The adapter clicks
  only a discovered matching collection and then reads selected state back. If
  the requested option or readback is unclear, return `needs_human`.
- Confirm declaration/compliance controls from the logged-in UI. Do not apply
  Xiaohongshu originality or Douyin personal-opinion logic by analogy.
- Confirm schedule controls and report any platform-adjusted time.
- Preserve a screenshot or redacted control artifact when a field is unknown.

## Video Posting Caveats

Treat video as experimental until current evidence proves:

- Accepted video format and size for the account.
- Upload progress and completion state.
- Cover selection behavior.
- Title/body field mapping.
- Category/collection/declaration controls.
- Schedule behavior.
- Final publish boundary.

If any of these are unknown, stop with `needs_human` or run page inspection
instead of pretending image evidence covers video behavior.

## Acceptance Bar

The WeChat Channels adapter is production-ready for a specific account only when
the run log proves:

- Login state is valid in the dedicated profile.
- Upload verifies visible image or video state.
- Title/body are filled into the correct fields.
- Tags/topics are selected through the WeChat Channels UI when required.
- Category/collection behavior is completed or intentionally reported as
  `needs_human`.
- Declaration/compliance controls are completed or intentionally reported as
  `needs_human`.
- Schedule uses the requested time or reports a platform-adjusted time.
- `publish_boundary` proves the final public publish button was not clicked.
- `result-summary` reports `publish_boundary_preserved: true`.

## Failure Handling

On `needs_human`, exit code `4`, or failure:

1. Run `result-summary`.
2. Run `diagnose-failure` if any step needs attention.
3. Inspect `logs/<target-id>/run.json` and screenshots.
4. Ask the operator for the missing account, category, declaration, schedule, or
   final-review decision.
5. Retry only after the missing condition changed.

Do not commit the run log, screenshots, DOM/control artifacts, profile state, or
collection/account cache.

## Safety

- Never click the final public publish button.
- Do not read, export, or copy cookies, local storage, or account secrets.
- Do not reuse Xiaohongshu or Douyin declarations/selectors.
- If login is required, stop with `needs_human`.
- If draft retention is unverified and the user does not want scheduling, warn
  that the operator may need to finalize or preserve one draft before preparing
  the next.
