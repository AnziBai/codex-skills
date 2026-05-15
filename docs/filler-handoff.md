# Filler Handoff

Last updated: 2026-05-15.

## Branch And Commit

- Repository: this workspace root.
- Branch: `codex/filler-production-cli`
- Latest verified pushed base before this sync:
  `444a0aa Document Douyin manual queue handoff`
- Push status: pushed to `origin/codex/filler-production-cli`.
- Pull request: https://github.com/AnziBai/codex-skills/pull/3

## Completed Work

- Packaged the `filler` skill under `skills/filler/`.
- Added the production CLI path: AI copy, `draft-plan`, `preflight`, Playwright `draft-fill`, and `diagnose-failure`.
- Added distribution guardrails through `.gitignore` so profiles, local sessions, generated logs, and secrets are not committed.
- Added runbooks and references for Xiaohongshu, Douyin, production readiness, and failure diagnostics.
- Hardened scheduled publish handoff and batch draft-fill behavior for
  Xiaohongshu, Douyin, and WeChat Channels.
- Added real-profile safeguards for workspaces whose paths contain spaces.
- Confirmed the 2026-05-14 `21-40` operator flow can prepare drafts across the
  three target platforms while preserving the human final-publish boundary.
- Recorded the operator-assisted scheduled queue pattern for Douyin and WeChat
  Channels: automation fills the draft, the operator handles collection/final
  scheduled publish when needed, and automation continues after it verifies the
  platform returned to the publish entry or management surface.

## Validation

Completed on 2026-05-12:

- Node syntax checks passed for `cli.mjs`, `adapters.mjs`, and `utils.mjs`.
- `sample-run` passed for Xiaohongshu and Douyin.
- `preflight` passed for the Douyin test work directory.
- `diagnose-failure` returned clean status for the current Douyin run.
- On 2026-05-13, Douyin upload validation was tightened so the run log must prove visible page state such as `已添加5张图片`.
- `test-filler.ps1` passed for the packaged repository copy.
- Skill validation passed when run with UTF-8 enabled and the bundled Python 3.12.10.

## Platform Run Status

## Known Issues For Next Iteration

Tracking issues created from the 2026-05-14 `21-40` batch test:

- [#1 filler: fix profile launch and update scheduled batch publish behavior](https://github.com/AnziBai/codex-skills/issues/1)
- [#2 filler: choose platform collections from title meaning and user knowledge base](https://github.com/AnziBai/codex-skills/issues/2)

### Login Profile Launch Can Split Operator State

Observed on 2026-05-14 during the `21-40` Xiaohongshu batch intake:

- The skill/default Playwright launch path opened `xhs-main`, but repeated
  `inspect-collections` attempts still captured the Xiaohongshu SMS login page.
- A later directly opened local Chrome window using the dedicated profile was
  the one the operator saw and considered logged in.
- Hidden or background `Start-Process` launches made this worse because the
  child browser could be running without an obvious foreground window.
- The same confusion repeated on 2026-05-14 when a matching Xiaohongshu URL was
  misreported as entering the publish page. A URL or `page_signature` match is
  not enough; only visible logged-in composer controls prove publish-editor
  readiness.
- The immediate root cause was confirmed later: an unquoted
  `--user-data-dir` value under the workspace path `New project 5` was parsed
  by Chrome as a truncated path ending before the first space, so automation and
  the operator were not consistently using the intended
  `skills/filler/profiles/<profile>` directory.

Iteration note:

- Add an explicit `login-profile` or `open-profile` command that opens a visible
  foreground browser for the exact same profile directory used by
  `draft-fill`, `inspect-collections`, and `preflight`.
- Launch Chrome/Edge with an argument builder that preserves spaces in
  `--user-data-dir`, and add a regression check for workspaces whose paths
  contain spaces.
- Do not launch human login windows with hidden process settings.
- After the operator says login is complete, verify login state from the same
  automation path before continuing to collection inspection or draft filling.
- Preserve the rule that profile folders, cookies, local storage, screenshots,
  DOM dumps, and account identifiers stay local and are not committed.

### Xiaohongshu

Status: stable through strict scheduled-confirmation and manual handoff
boundaries.

Covered behavior:

- Upload image assets.
- Fill Chinese title and body.
- Add each tag by typing one tag and immediately clicking the first suggestion, so it becomes a platform topic token.
- Choose a broad collection, currently the Kuanlun collection for the tested work.
- Complete content declaration and original declaration, including the second confirmation.
- Set schedule when requested.
- For immediate runs, preserve the human publish boundary and save/leave a
  draft when the platform can verify it.
- For batch or multi-platform scheduled runs, confirm scheduled publish only
  after schedule readback, collection, declarations, topics, and the publish
  boundary are all verified. If the button is not safely resolvable, hand off to
  the operator instead of guessing.

### Douyin

Status: stable to the final publish boundary.

Covered behavior:

- Upload multi-image assets and verify the page-visible uploaded image count.
- Fill Chinese title and body.
- Add each topic through the first suggestion.
- Choose the Kuanlun collection.
- Skip collection selection when the operator wants to choose every collection
  manually.
- Mark the content as personal viewpoint or opinion when requested by the plan.
- Choose the first recommended music item.
- Set schedule and report platform-adjusted later times.
- Verify the final publish button exists without clicking it.

Latest robustness result: five consecutive Douyin runs completed with `overall_status: done` after schedule handling was fixed.

Operator queue note from 2026-05-14:

- The committed scheduled handoff flow now supports the desired loop for Douyin
  scheduled batches: automation fills one work, the operator manually selects
  collection and clicks publish when requested, Douyin returns to works
  management or the upload entry, and automation continues to the next work.
- The earlier `out/` prototype remains intentionally uncommitted because `out/`
  may contain local publishing artifacts.
- The queue detector should wait for a return to works management/upload state,
  not for the operator to close the browser window.

### WeChat Channels

Status: image flow is `production-candidate`; video flow is still
`experimental`.

Existing test work:

```text
.\wechat-channels-test-work
```

Suggested next command after logging into the dedicated profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\filler.ps1" draft-fill -WorkDir ".\wechat-channels-test-work" -TargetId "wechat-channels-main-image" -ProfileName "wechat-channels-main" -ConfirmIntake -Json
```

Current evidence says two image runs reached the final publish boundary without
clicking it, but both still needed human handling for collection/category. The
adapter now treats collection choice conservatively: it verifies a discovered
option, clicks only a matching collection, reads selected state back, and returns
`needs_human` if the option or readback is unclear.

Operator note from the 2026-05-14 batch test:

- WeChat Channels topics must be entered one by one as `#topic` followed by a
  space so the UI turns each one into a blue topic token. Plain pasted hashtags
  do not count as completed topic selection.
- The operator may handle collection choice and final scheduled publish. The
  queue should continue only after detecting a return to `图文管理` or the
  visible `发表图文` / `发布图文` publish entry.

Read `skills/filler/references/wechat-channels-real-publish-runbook.md` before
changing selectors.

## Engineering Rules To Preserve

- Keep platform adapters separate. Share utilities only for logging, screenshots, profile handling, retries, file validation, and generic status output.
- Do not click the final public publish button.
- Do not commit or distribute Chrome profiles, cookies, local storage, account configs, screenshots, DOM snapshots, generated work directories, or `node_modules`.
- Run `preflight` before real browser automation and ask the user about unclear schedule, collection, music, profile, or title-optimization choices.
- On failure, read `run.json`, screenshots, and DOM snapshots before changing selectors.

## Next Steps

1. Fix the login-profile UX issue above so operator login, Playwright
   automation, and direct Chrome fallback all use one verified profile state.
2. Verify the committed Douyin and WeChat Channels operator-assisted scheduled
   queue on another two-work batch, without committing real run logs,
   screenshots, DOM dumps, or account-specific profile state.
3. In the logged-in `wechat-channels-main` profile, run `preflight` and then
   `inspect-collections` with an explicit `account_fingerprint` in the plan if
   collection selection should be automatic.
4. Run one immediate and one scheduled WeChat Channels image draft-fill and
   verify the collection step, music step, schedule readback, and publish
   boundary.
5. Add the sanitized evidence to `docs/filler-verification-evidence.md`.
6. Only after image flow is stable, test WeChat Channels video upload as a
   separate surface.
