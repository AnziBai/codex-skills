# Xiaohongshu Real Publish Runbook

Use this runbook when testing or operating the real Xiaohongshu publish flow through Chrome.

## Problem Statement

Real social publishing is not only a mechanical form-fill task. The flow must combine:

- AI title/copy decisions.
- Platform-specific validation.
- Real Chrome upload verification.
- Human-owned final publish submission.
- Recovery behavior when browser automation fails.

## Required Pre-Publish Decisions

Before final draft filling or submission, decide these without making the user repeat platform mechanics:

1. Title optimization.
   - Ask whether to optimize the title for traffic when the preference is unknown.
   - If the user has already authorized optimization, choose a factual, content-supported title directly.
   - Do not blindly copy the manifest title or first-image headline when a stronger platform title is appropriate.

2. Scheduling.
   - Ask whether to publish immediately or schedule when the preference is unknown.
   - If scheduling is requested, collect the publish time.
   - For batches, collect the interval between works and apply that cadence unless overridden.

## Xiaohongshu Draft Checks

Verify all of these before final publish:

- Images uploaded in the correct order, with visible upload count/preview.
- Title filled with the selected or optimized title.
- Body filled with the selected copy.
- Tags are selected topic tokens, not pasted plain text.
- Collection is selected from product knowledge or explicit override.
- Original declaration is fully completed.
- Scheduling state matches the user's decision.
- Final publish button is present and enabled, but automation must not click it. The human operator performs the final publish click to reduce platform automation-risk signals.

## Final Publish Boundary

Never click the real public `发布` / `提交` / `确认发布` button in platform automation.

The automation boundary is:

1. Upload assets.
2. Fill or select title, body, tags, collection, declarations, visibility, and scheduling.
3. Verify the draft is ready and the publish button is visible/enabled.
4. Stop and hand off to the human operator for the final click.
5. After the human publishes, resume only to verify the result page/status and record the outcome.

This applies even if the user has broadly authorized testing. The final public submission action belongs to the human.

## Original Declaration

Do not treat the switch alone as enough.

Xiaohongshu can show a second confirmation dialog after enabling `原创声明`.

The complete flow is:

1. Turn on `原创声明`.
2. In the dialog, check the consent box.
3. Click `声明原创`.
4. Verify the dialog closes.
5. Verify the switch remains enabled.
6. Verify the preview/status contains `已声明原创`.

The `checkbox [checked]` state alone can be a false positive while the dialog is still pending.

## Chrome Automation Failure Recovery

If Chrome automation calls time out or return `Transport closed`:

1. Check whether Chrome, the Codex Chrome Extension, and native host are healthy:
   - `scripts/chrome-is-running.js --check`
   - `scripts/check-extension-installed.js --json`
   - `scripts/check-native-host-manifest.js --json`
2. Check for stale Node REPL active exec metadata:
   - `$HOME\.codex\node_repl\active_execs`
3. Do not kill `node_repl` from inside an active Codex tool session unless the session can be restarted afterward. Killing the REPL server can convert a timeout into `Transport closed`.
4. If the transport is already closed, preserve the user's live Chrome draft tab and restart the Codex app/session before continuing.
5. Do not fall back to the in-app browser for real upload verification.

## Current Known Pitfall

The real Chrome page can remain valid while the Codex-side automation bridge is dead. In that case, the safe action is to preserve the draft and resume after tool-channel recovery, not to recreate the draft elsewhere.
