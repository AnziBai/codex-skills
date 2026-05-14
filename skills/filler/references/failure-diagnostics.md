# Failure Diagnostics

Use this reference when `preflight`, `inspect-collections`, `draft-fill`, or
`result-summary` returns `needs_human`, `failed`, exit code `4`, `5`, or `6`.

## First Response

Do not guess from chat history. Read the latest machine output and artifacts.

Start with:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher result-summary -WorkDir ".\work" -Json
```

If the run did not produce a usable summary, or any step is not done:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher diagnose-failure -WorkDir ".\work" -TargetId "<target-id>" -Json
```

Read `bad_steps`, `recommendations`, and `artifacts` before changing selectors,
rerunning, or asking the user for more information.

## Exit Codes And Statuses

| Code | Meaning | Operator response |
| --- | --- | --- |
| `0` | Success | Review `result-summary` and final publish boundary. |
| `2` | Validation or blocked input | Fix the plan, profile name, missing files, stale schedule, or unsupported platform. |
| `3` | Not ready | Finish upstream work or required copy/asset selection. |
| `4` | Manual action required | Read `questions`, `confirmations`, and `needs_human` steps; ask or act deliberately. |
| `5` | Failed or partial failure | Run `diagnose-failure`; inspect artifacts. |
| `6` | Lock held | Resolve the profile or publish lock before retrying. |

`needs_human` is intentional. It protects the account from unsafe guesses. The
correct fix is usually a human decision, login, collection inspection, account
confirmation, platform-only selection, or manual preservation of a draft.

## Artifact Reading Order

1. `draft-fill-result.json`
2. `logs/<target-id>/run.json`
3. `logs/<target-id>/collections.json`, if collection inspection ran
4. `logs/<target-id>/screenshots/*.png`
5. Redacted DOM/control metadata or inspect JSON, if present
6. Platform-specific runbook notes

Do not commit any of these artifacts. They can contain account hints, page
state, URLs, collection names, or unpublished content.

## Common Failure Classes

| Step or symptom | Meaning | First action |
| --- | --- | --- |
| `page_signature` | Login required or platform page changed | Open the dedicated profile, log in, then run `doctor`. |
| `browser_profile` | Missing or invalid profile name | Run `setup-draft-fill`; use a simple profile name. |
| `profile_lock_held` | Another run or kept-open browser owns the profile | Close the browser or clear only a verified stale lock. |
| `draft_plan` | Missing, stale, unsafe, or invalid plan | Re-run `draft-plan` after fixing manifest/copy/schedule. |
| `upload_assets` | File path, upload limit, format, or upload-state issue | Verify assets and screenshot-visible upload state. |
| `composer` | Upload did not reach the editable draft surface | Check current URL and latest screenshot before retry. |
| `topics` | Platform suggestion UI was not selected | Select tags through the platform token/autocomplete UI. |
| `collection_cache` | Missing, untrusted, expired, or wrong-account collection cache | Run `inspect-collections`; confirm fingerprint only after account verification. |
| `collection` | Requested collection missing or dropdown changed | Inspect collections and ask before creating or changing collection. |
| `declaration` | Platform declaration not selected or unknown | Do not borrow declaration behavior from another platform. |
| `music` | Douyin music drawer or default changed | Inspect the drawer screenshot and ask about defaults. |
| `schedule` | Requested time invalid or platform-adjusted | Report actual time; reject earlier or past times. |
| `publish_boundary` | Final boundary not proven | Stop. A human must verify the draft before public publish. |

## Profile Lock Recovery

Real browser commands create `profiles/<profile>.draft-fill.lock`.

Use the returned payload:

- `status: active`: another process still owns the profile. Wait or close that
  run.
- `status: stale_keep_open_requires_manual_cleanup`: a kept-open browser ended
  without cleanup. Confirm no browser window uses that profile, then delete only
  the matching lock file.
- `status: lock_changed_during_stale_recovery`: another process raced with you.
  Stop and re-check.

Never delete a whole profile folder to clear a lock. That discards login state
and can hide the actual conflict.

## Collection Cache Diagnostics

Collection failures are often account-safety failures, not selector failures.

Run:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher inspect-collections -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "<profile>" -Json
```

If the operator has verified the visible account and `draft-plan.json` contains
the intended `account_fingerprint`, run:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $Publisher inspect-collections -WorkDir ".\work" -TargetId "<target-id>" -ProfileName "<profile>" -ConfirmAccountFingerprint -Json
```

Semantics:

- Without a trusted fingerprint, the cache remains untrusted for real draft
  filling.
- With `-ConfirmAccountFingerprint` and no plan fingerprint, validation fails.
- A profile/platform/fingerprint mismatch means the cache belongs to a different
  account or run context.
- Expired cache should be refreshed instead of manually edited.

## Platform-Specific Lessons

Xiaohongshu:

- Editor text is not enough for topics; tags must become selected topic tokens.
- Original declaration is complete only after any consent/source dialog closes
  and the control remains enabled.
- Collection selection should favor broad reusable collections and may require
  `inspect-collections`.

Douyin:

- Desktop Creator Center may not preserve unscheduled drafts like Xiaohongshu.
- Upload is not done until the page reaches the post editor and visible upload
  state confirms the assets.
- Topics must be selected through the topic UI.
- Personal-opinion/declaration controls are Douyin-specific.
- Music defaults can change; do not assume the first recommendation is acceptable
  without prior confirmation.

WeChat Channels:

- Draft behavior is unknown and account-specific until proven for the logged-in
  profile.
- Image posting must verify visible uploaded image state, field mapping,
  category/collection/declaration behavior, schedule handling, and final
  boundary.
- Do not reuse Xiaohongshu or Douyin selectors, declarations, or scheduling
  assumptions.

## PowerShell Encoding Checks

If titles, tags, or collections look corrupted in terminal output, verify the
source files in UTF-8:

```powershell
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
Get-Content -LiteralPath ".\work\draft-plan.json" -Raw -Encoding UTF8
```

Do not "fix" selectors or copy based only on mojibake displayed by a console.

## Retry Discipline

Retry only after one of these changed:

- The user answered a preflight or `needs_human` question.
- The operator logged into the dedicated profile.
- The work manifest, selected copy, schedule, or draft plan was regenerated.
- A collection cache was refreshed and account-verified.
- A stale lock was verified and cleared.
- A platform adapter or selector changed.

If none of those changed, rerunning is usually noise and can increase platform
risk.
