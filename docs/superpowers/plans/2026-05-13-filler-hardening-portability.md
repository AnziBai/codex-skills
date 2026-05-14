# Filler Subagent-Driven Hardening And Portability Plan

> Required implementation mode: use `superpowers:subagent-driven-development`.
> Execute task-by-task. Each implementation task gets a fresh implementer, then a spec reviewer and a code-quality reviewer. Do not run real platform browser flows in parallel on the same Chrome profile.

## Summary

The current Xiaohongshu and Douyin draft-fill flows are usable, and WeChat Channels image flow is a production candidate with a remaining collection caveat. The next work should not be a broad refactor. We will harden the production CLI first, then split adapters and polish migration docs only after the hardening gates are green.

Phase 1 focuses on stability and portability:

- UTF-8-safe result summaries.
- A portable dry robustness matrix.
- Shared browser profile launch and lock behavior.
- Collection discovery and a conservative decision cache.
- Evidence reconciliation so docs match what has truly been verified.

Phase 2 focuses on maintainability and teammate adoption:

- Adapter boundary cleanup without behavior changes.
- Skill, README, and runbook updates.
- Stage-close self-evolution proposal.
- Final release sync into the live skill only after checks pass.

The product boundary stays unchanged: the CLI fills platform drafts and always stops before the final public publish button.

## Current Implementation Facts

- Node entrypoint: `skills/filler/draft-fill/src/cli.mjs`.
- PowerShell entrypoint: `skills/filler/scripts/filler.ps1`.
- Adapter contract today is `adapter.run({ page, plan, logDir, profileName, workDir })`.
- Existing helper is `targetLogDir(workDir, targetId)`, not `getLogDir`.
- No shared browser helper exists yet; `draft-fill` and `inspect-wechat-channels` each launch Playwright inline.
- `draft-fill` intentionally leaves the browser open for human review.
- `inspect-wechat-channels` closes the browser context after exploration.
- `validatePlan` rejects scheduled times in the past.
- PowerShell wrapper currently does not support `-SourceRoot` or `-OutputRoot`.
- PowerShell wrapper currently routes most commands through a `Get-WorkPath` guard, so any command that intentionally runs without `-WorkDir` must be routed before the generic guard.
- Current Node lock errors would default to exit code `1`; V1 needs explicit lock-held exit code `6`.
- `.git/self-evolution-pending.md` exists, so stage close must produce a memory update proposal before changing memory, wiki knowledge, or skills.

## Phase 1: Hardening Core

### Task 0: Evidence Reconciliation Gate

Goal: make the claimed production status match actual artifacts before we build more around it.

Files:

- Create or update `docs/filler-verification-evidence.md`.
- Update only status labels in runbooks if evidence contradicts them.

Steps:

1. Record each verified platform case with:
   - platform
   - profile name
   - work directory
   - command
   - `draft-fill-result.json`
   - `logs/<target_id>/run.json`
   - screenshot path
   - `overall_status`
   - whether `publish_boundary` is present and not clicked
2. Classify each platform surface from evidence only. Do not pre-label a surface as production-ready before artifact review:
   - `production-ready`: multiple successful runs with required steps done.
   - `production-candidate`: main flow works but one non-critical step can return `needs_human`.
   - `experimental`: field map exists, but a real flow has not been verified.
3. Production-ready requires at least two dated evidence entries per platform/profile/account surface.
4. Current hypothesis before reconciliation:
   - Xiaohongshu image: `production-ready`, except absent collection can be `needs_human`.
   - Douyin image: `production-ready`.
   - WeChat Channels image: `production-candidate`, because collection selection still needs conservative handling.
   - WeChat Channels video: `experimental`.
5. Redact evidence docs:
   - no absolute profile paths
   - no account names, phone numbers, user IDs, cookies, localStorage, or auth headers
   - no raw DOM excerpts
   - no screenshot content embedded into docs
   - prefer relative artifact references and sanitized summaries

Acceptance:

- Evidence doc exists.
- WeChat Channels docs no longer claim more than the evidence supports.
- No screenshots, DOM dumps, profiles, cookies, or temporary work outputs are added to git.

### Task 1: UTF-8 Safe Result Summary

Goal: give teammates a stable command to inspect results without PowerShell 5 encoding traps.

Files:

- Create `skills/filler/draft-fill/src/result-summary.mjs`.
- Modify `skills/filler/draft-fill/src/cli.mjs`.
- Modify `skills/filler/scripts/filler.ps1`.
- Create `skills/filler/draft-fill/test/result-summary.test.mjs`.
- Modify `skills/filler/draft-fill/package.json`.

Implementation notes:

- Add Node command `result-summary`.
- Read `draft-fill-result.json` with `utf8`.
- Return compact JSON:
  - `ok`
  - `work_id`
  - `target_id`
  - `platform`
  - `overall_status`
  - `done_steps`
  - `needs_human_steps`
  - `failed_steps`
  - `publish_boundary_preserved`
- PowerShell should route `result-summary` through Node and should not parse the result before returning it.

Tests:

- Chinese step messages survive a read and summary.
- `needs_human` collection steps are surfaced clearly.
- `publish_boundary_preserved` is true only when the final publish step explicitly says it was not clicked.

Acceptance:

- `node test/result-summary.test.mjs` passes.
- Existing `npm test` passes.
- A real old output directory can be summarized with `-Json`.
- PowerShell route is added before any `Ensure-DraftPlan` or draft-plan validation path.
- `-WorkDir` means the work root containing `draft-fill-result.json`; direct result-file input is deferred unless explicitly added.

### Task 2: Portable Robustness Matrix

Goal: make robustness checks reproducible on a teammate machine, not tied to one desktop folder.

Files:

- Create `skills/filler/draft-fill/src/robustness-matrix.mjs`.
- Create `skills/filler/draft-fill/test/robustness-matrix.test.mjs`.
- Modify `skills/filler/draft-fill/src/cli.mjs`.
- Modify `skills/filler/draft-fill/package.json`.
- Modify `skills/filler/scripts/filler.ps1`.

Implementation notes:

- Add Node command `robustness-matrix`.
- Add PowerShell parameters `-SourceRoot` and `-OutputRoot`.
- Extend `Invoke-DraftFillNode` to forward `--source-root` and `--output-root`.
- Add `robustness-matrix` to the PowerShell early Node-routing block before the generic `Get-WorkPath` guard.
- Do not require `-WorkDir` for `robustness-matrix`.
- If `-SourceRoot` is omitted, generate a tiny local fixture under a temp or output directory.
- If `-SourceRoot` is present, build cases from that directory.
- Scheduled cases must use future times relative to Asia/Shanghai at runtime. Do not hard-code `2026-05-14`.
- The dry matrix should generate or validate case metadata. It must not open browsers.

Tests:

- Matrix can run without `-WorkDir`.
- Matrix can run without `Desktop\\21-40`.
- Scheduled publish times are future relative to the current clock.
- Negative missing-asset case returns a validation error.

Acceptance:

- `npm run check:all` passes.
- `filler robustness-matrix -Json` works on a clean machine after setup.
- Clean-machine dry checks cover Node/npm availability, Playwright dependency presence, PowerShell command discovery, and execution from a cwd outside the repo.
- `package.json` defines `check:all` by the end of this task. It runs syntax checks, unit tests, and the dry robustness matrix.

### Task 3: Browser Profile Helper And Profile Lock

Goal: make real browser runs predictable and prevent two CLI processes from fighting over one persistent Chrome profile.

Files:

- Create `skills/filler/draft-fill/src/browser-profile.mjs`.
- Modify `skills/filler/draft-fill/src/cli.mjs`.
- Create or update tests where practical without launching a browser.

Implementation notes:

- Add a helper for persistent profile launch:
  - accepts `profileName`, `platform`, `targetId`, `keepOpen`.
  - creates `profiles/<profile>.draft-fill.lock`.
  - lock contains `pid`, `platform`, `target_id`, `started_at`, `profile_name`, and `browser_lifecycle`.
  - same profile concurrent run returns a clear lock-held error.
  - stale lock recovery is allowed only when the owning process is not alive.
- Use this helper in `draft-fill`.
- Use this helper in `inspect-collections` when Task 4 adds it.
- Move existing `inspect-wechat-channels` to this helper in this task. It is a real browser flow and must not bypass profile locking.
- Choose the lifecycle explicitly:
  - For `draft-fill`, keep Node alive until the Playwright persistent context/browser window closes, then release the lock.
  - For inspection commands, close the context when the inspection finishes, then release the lock.
  - If a future implementation detaches Node while leaving Chrome open, the lock must be tied to a browser-owner signal, not just the Node PID. That is not the Phase 1 default.
- Lock-held errors must return JSON with `error_code: "profile_lock_held"` and process exit code `6`.
- PowerShell should propagate the Node exit code for Node-routed lock failures.
- Document the teammate UX: while a draft window is open for human review, another run using the same profile should fail fast with a lock-held message. Closing the browser unblocks the profile.

Tests:

- Lock file acquisition and release with fake process checks.
- Active lock returns an explicit error and non-zero exit.
- Stale lock can be replaced.
- `draft-fill -DryRun` does not create a browser lock.

Acceptance:

- Existing draft-fill behavior remains intact.
- Lock errors are visible in JSON.
- No real browser task can silently reuse a profile that is already locked, including `draft-fill`, `inspect-wechat-channels`, and `inspect-collections`.

### Task 4: Collection Discovery And Decision Cache

Goal: stop guessing collections during publish runs. Discover broad existing options first, cache them, and return `needs_human` when a requested option is absent.

Files:

- Modify `skills/filler/draft-fill/src/adapters.mjs`.
- Modify `skills/filler/draft-fill/src/cli.mjs`.
- Modify `skills/filler/scripts/filler.ps1`.
- Modify `skills/filler/draft-fill/test/adapters.test.mjs`.

Implementation notes:

- Add command `inspect-collections`.
- Use the shared browser profile helper from Task 3.
- Use platform-specific dropdown openers. Do not scrape the entire page body as the primary strategy.
- Normalize names through a pure helper such as `normalizeCollectionNames(values)`.
- Write `logs/<target_id>/collections.json`.
- Write or update `profiles/<profile>/collection-cache.json` with:
  - `schema_version`
  - `platform`
  - `profile_name`
  - required `account_id` or `account_fingerprint`
  - optional `account_hint`
  - `discovered_at`
  - `expires_at`
  - `collections`
  - `source_artifacts`
- Cache writes must be atomic and UTF-8.
- Cache reads must reject mismatched platform, profile, or account fingerprint.
- Cache should be treated stale when expired or when the profile/account cannot be verified.
- `preflight` should mention when a requested collection is missing from cache and suggest `inspect-collections`.
- Do not auto-create narrow collections in V1.

Tests:

- Collection normalization deduplicates names and filters UI chrome text.
- Cache read/write preserves Chinese names.
- Cache account/profile mismatch returns `needs_human` with a clear message.
- Missing collection yields `needs_human`, not `failed`.
- `inspect-collections` dry validation works without opening browser if a dry flag is supplied.

Acceptance:

- Xiaohongshu and Douyin collection discovery work against known logged-in profiles.
- WeChat Channels image collection discovery is allowed to return `needs_human` with artifacts if the UI cannot expose a list reliably.
- Draft fill never mistakes a missing collection for a full run failure.

## Phase 2: Maintainability And Migration

### Task 5: Adapter Boundary Cleanup

Goal: reduce cross-platform mixing without changing behavior.

Files:

- Create `skills/filler/draft-fill/src/platforms/common.mjs`.
- Create `skills/filler/draft-fill/src/platforms/xiaohongshu.mjs`.
- Create `skills/filler/draft-fill/src/platforms/douyin.mjs`.
- Create `skills/filler/draft-fill/src/platforms/wechat-channels.mjs`.
- Modify `skills/filler/draft-fill/src/adapters.mjs`.
- Update tests.

Implementation notes:

- Keep public adapter contract as `adapter.run(ctx)`.
- Move shared platform helpers first; `common.mjs` may include browser-mutating helpers when they are platform-neutral.
- Avoid circular imports.
- Re-export adapters from `adapters.mjs`.
- Do not change selectors, timings, or click logic in this task unless a test reveals a broken import.

Acceptance:

- All Phase 1 checks still pass.
- Real smoke for Xiaohongshu and Douyin still reaches publish boundary.

### Task 6: Teammate Migration Docs

Goal: make the skill reproducible for a coworker who did not sit through our debugging session.

Files:

- Update `skills/filler/SKILL.md`.
- Update or create `skills/filler/README.md`.
- Update `skills/filler/references/production-readiness.md`.
- Update `skills/filler/references/failure-diagnostics.md`.
- Update WeChat Channels runbook.

Docs must cover:

- One-time setup.
- Dedicated Chrome profile login.
- Run-intake questions before real automation:
  - which platforms to publish to
  - where the finished images/videos are stored and how the folder/order is structured
  - whether to optimize titles before drafting
  - whether to schedule, exact times, timezone, and per-platform intervals for batches
  - Douyin desktop Creator Center caveat: unscheduled desktop drafts may not persist like Xiaohongshu drafts, so batch operation may require scheduling/finalizing one item before preparing the next
  - Xiaohongshu draft behavior is more forgiving, while WeChat Channels draft persistence remains account-specific until verified
  - account/profile, collection strategy, declarations, music defaults, and final-publish boundary
- Why final publish remains manual.
- How to run `preflight`, `result-summary`, `robustness-matrix`, `inspect-collections`, and `draft-fill`.
- How to interpret `needs_human`.
- Platform-specific declarations:
  - Xiaohongshu original declaration with second confirmation.
  - Douyin personal-opinion declaration.
  - WeChat Channels image flow caveats.
- UTF-8 PowerShell guidance.
- Profile/account naming conventions and how a teammate creates their own profiles without inheriting local state.
- How to safely unblock a locked profile.
- What never gets committed: profiles, cookies, DOM snapshots, screenshots, temp outputs, `node_modules`.

### Task 7: Stage Close And Release Sync

Goal: finish the stage cleanly without leaking local state into the skill or repo.

Steps:

1. Run `npm run check:all`.
2. Run dry CLI checks:
   - `doctor`
   - `sample-run`
   - `preflight`
   - `result-summary`
   - `robustness-matrix`
3. Confirm real-world failure coverage exists for:
   - login-required page signature
   - wrong profile or wrong account
   - platform-adjusted schedule readback
   - missing publish boundary
   - absent Xiaohongshu/Douyin collection
   - file input accepted but page upload evidence missing
   - PowerShell 5 Chinese JSON pass-through
   - old `draft-fill-result.json` schema compatibility
4. Run serial real smoke checks only when accounts are logged in:
   - Xiaohongshu image.
   - Douyin image.
   - WeChat Channels image if login is available.
5. Run the self-evolution skill because `.git/self-evolution-pending.md` exists.
6. Produce a memory update proposal before changing memory or skills.
7. Sync to the live skill only after the project copy passes checks.

Do not commit:

- `node_modules`
- `profiles`
- cookies
- screenshots
- DOM snapshots
- `out`
- temporary work folders
- raw platform logs with account-sensitive data

## Subagent Execution Model

Use this pattern per task:

1. Main orchestrator assigns a narrow task with explicit file ownership.
2. Implementer edits only the assigned files.
3. Spec reviewer checks whether the task meets the plan and prior user corrections.
4. Code-quality reviewer checks maintainability, race conditions, and migration risks.
5. Main orchestrator integrates, runs checks, and updates the task status.

Do not run two implementers against `cli.mjs`, `adapters.mjs`, or `filler.ps1` at the same time.

## Test Strategy

Dry checks:

- `node --check` for changed Node files.
- `npm test`.
- `npm run check:all`.
- `filler robustness-matrix -Json` without `-WorkDir`.
- `filler result-summary -WorkDir <known-output> -Json`.

Real checks:

- Real browser flows must run serially per profile.
- They must never click final publish.
- A run is acceptable if the only non-done step is an intentionally absent collection returning `needs_human`.
- Upload, title/body, tag tokenization, declarations, music, schedule, and publish boundary must be individually reported.

## Risks And Mitigations

- Platform DOM changes: capture screenshot and DOM artifact, then use diagnosis before changing selectors.
- Profile contention: profile lock blocks concurrent runs.
- Encoding issues: Node reads/writes JSON as UTF-8 and PowerShell wrapper passes through JSON.
- Collection overfitting: inspect broad existing options and cache them; do not create narrow collections automatically.
- Subagent collisions: keep task ownership narrow and avoid parallel writes to shared files.

## Open Decisions

- Whether to sync the hardened project copy into the live user skill during this stage or after one more real three-platform smoke test.
- Whether WeChat Channels collection discovery should remain `production-candidate` until it succeeds on two separate content cases.
