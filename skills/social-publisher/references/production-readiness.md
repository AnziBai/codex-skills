# Production Readiness

Use this reference when packaging `social-publisher` for teammates or tightening the CLI user experience.

## Distribution Rules

- Ship code, scripts, references, `package.json`, and `package-lock.json`.
- Do not ship `profiles/`, cookies, local storage, platform sessions, `node_modules/`, draft logs, screenshots, or real work directories.
- Each teammate runs `setup-draft-fill` locally and logs into each dedicated profile once.
- Keep `SKILL.md` short. Put platform details and long runbooks in `references/`.

## User Journey

1. `setup-draft-fill`: install dependencies and create profile folders.
2. Login: user opens each profile and logs into the target platform once.
3. `sample-run`: create a local sample work directory and verify the CLI contract.
4. `copy-generate` / `copy-select`: prepare title, body, tags, and cover text.
5. `draft-plan`: create machine-readable browser execution input.
6. `preflight`: ask missing decisions before any real browser action.
7. `draft-fill`: upload and fill the draft, then stop before final publish.
8. `diagnose-failure`: explain failed steps with artifact paths and next actions.

## Preflight Questions

Ask the user before browser execution when any of these are unclear:

- Whether to optimize the title for traffic.
- Whether to schedule; if yes, the exact time.
- For batches, starting time and interval between works.
- Which broad collection to use when product knowledge is insufficient.
- Whether to use default Douyin recommended music.
- Which account profile should be used when not obvious.

## Platform Isolation

- Keep Xiaohongshu, Douyin, and WeChat Channels adapter logic separate.
- Share only generic helpers: upload, logging, screenshots, status modeling, date parsing, and publish-boundary verification.
- Never reuse Xiaohongshu declarations for Douyin or Douyin schedule controls for Xiaohongshu.

## Acceptance Bar

A platform adapter is production-ready only after:

- `doctor` can detect missing login or page mismatch.
- `preflight` lists missing user decisions.
- `draft-fill` logs every step and writes `draft-fill-result.json`.
- Failure artifacts include `run.json`, at least one screenshot, and a DOM snapshot when a page exists.
- Repeated real runs pass without clicking final publish.
