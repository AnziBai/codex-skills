# Failure Diagnostics

Use this reference after `draft-fill` returns `needs_human` or `failed`.

## First Command

Run:

```powershell
social-publisher diagnose-failure -WorkDir ".\work" -TargetId "<target-id>" -Json
```

Read the `bad_steps`, `recommendations`, and `artifacts` fields before changing selectors.

## Common Failure Classes

| Step | Meaning | First action |
| --- | --- | --- |
| `page_signature` | Login required or platform page changed | Open the dedicated profile, log in, then run `doctor` |
| `upload_assets` | File path, upload limit, or upload transition problem | Check asset paths and latest screenshot |
| `composer` | Upload did not reach editable draft page | Verify URL and editor fields; retry only from upload page |
| `topics` | Platform suggestion UI was not selected | Input one tag, click the first suggestion, then repeat |
| `collection` | Collection list did not open or matching option missing | Inspect available collections; ask user before creating a new one |
| `declaration` | Platform-specific declaration not selected | Do not mix Xiaohongshu originality with Douyin personal-opinion declaration |
| `music` | Douyin music drawer changed or no recommended item found | Inspect side drawer screenshot before changing code |
| `schedule` | Time input was adjusted or rejected | Accept later platform-adjusted times; reject earlier times |

## Artifact Reading Order

1. `logs/<target-id>/run.json`
2. `logs/<target-id>/screenshots/*.png`
3. `logs/<target-id>/*.dom.html`
4. Platform-specific inspect JSON, if present

Do not guess from chat history when artifacts exist.

## Known Production Lessons

- Douyin may accept a typed scheduled time but normalize it to a later allowed slot. Report the actual time.
- Douyin upload is not complete until the URL is under `/content/post/` and the title field exists.
- Douyin image upload must also verify visible page state such as `已添加5张图片`; file input success alone is not enough.
- Xiaohongshu topic text in the editor is not enough; the platform topic token must be selected from the popup.
- Xiaohongshu original declaration is complete only after the consent dialog closes and the switch remains enabled.
- WeChat Channels must be mapped from its own logged-in page. Do not reuse Xiaohongshu or Douyin selectors by analogy.
