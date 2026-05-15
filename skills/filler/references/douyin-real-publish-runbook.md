# Douyin Real Publish Runbook

Use this runbook when testing or operating the real Douyin creator-center publish flow through Chrome.

## Final Publish Boundary

Never click the real public `发布` / `提交` / `确认发布` button in automation.

Automation prepares and verifies the draft, then stops. The human operator performs the final publish click. After the human publishes, automation may verify result/status.

## Douyin Is Not Xiaohongshu

Do not reuse Xiaohongshu assumptions.

- Douyin image/text publishing uses a `作品描述` area with a short title field, not the Xiaohongshu note title/body surface.
- Douyin topics must be selected through `#添加话题` or the platform suggestion list. Plain pasted hashtags in the description are not enough if they do not become recognized topic tokens.
- Douyin `自主声明` is a content declaration such as `内容为个人观点或见解`; it is not the same as Xiaohongshu `原创声明`.
- Collection, declaration, and scheduling controls are in different sections and positions from Xiaohongshu.
- Douyin may request location permission. Do not grant location unless the work requires a location.
- Douyin may request SMS verification after the human final publish click. The human handles verification.

## Required Draft Checks

Verify all of these before handoff:

- Images uploaded in the correct order and upload count is visible.
- Title fits the title limit.
- Description is filled and contains no accidental suggested topic text.
- Topic tokens are selected through Douyin topic UI, not only pasted text.
- `自主声明` is selected appropriately; for trading education/opinion content, use `内容为个人观点或见解` unless an explicit override says otherwise.
- A suitable collection is selected. Do not leave `不选择合集` unless the user explicitly says not to use a collection or no suitable collection exists after inspection.
- `自主声明` is selected as `内容为个人观点或见解` for trading education/opinion content unless an explicit override says otherwise.
- Music is selected. Default to the first recommended music item unless the user or work metadata specifies a music choice.
- Visibility is `公开`.
- Scheduling matches the user's decision. Ask whether to schedule before handoff. If yes, ask the exact time. For multiple works, ask the starting time and interval between works. If the user selected no schedule, `立即发布` must be checked.
- Publish button is visible/enabled, but automation stops before clicking.

## Manual Collection And Publish Queue

Use this mode when the operator says that all Douyin collections and publish
clicks will be handled manually.

- Leave `draft-plan.json` `collection` as `null` so the adapter skips automatic
  collection selection.
- Automation may still upload assets, fill title/body, select topic tokens,
  choose the personal-viewpoint declaration, choose music, and set schedule.
- Automation must stop at the final publish boundary. The operator selects the
  collection and clicks publish.
- For a multi-work scheduled batch, the queue should wait for Douyin to return
  to works management or the upload entry after the operator publishes, then
  continue with the next work. Do not require the operator to close the browser
  window between items.
- This queue behavior was validated on 2026-05-14 and then moved into the
  committed scheduled handoff flow. Keep the earlier local `out/` prototype and
  any real run logs, screenshots, DOM dumps, or profile artifacts uncommitted.

Douyin may reject scheduled times that are too soon. On 2026-05-14 the platform
adjusted a requested `2026-05-14 20:30` time to `2026-05-14 21:25` and displayed
that scheduled posts must be at least two hours later and within 14 days. Always
read back and report the platform-adjusted scheduled time.

## Topic Selection

Preferred flow:

1. Click `#添加话题`.
2. Type or paste one topic keyword.
3. Select a platform suggestion.
4. Verify the topic appears as a recognized topic entry/token in the DOM or preview.
5. Repeat for each topic.

Avoid leaving unrelated platform suggestions in the description, such as accidental activity or trending topics.

## Music Selection

Default flow:

1. Open `选择音乐`.
2. Use the platform's recommended list.
3. Select the first recommended music item.
4. Verify music is no longer empty/default-only in the preview or music field.

Do not over-optimize music in V1 unless the user explicitly asks for platform-specific music strategy.

## Scheduling Questions

Before ready-to-publish handoff:

- Single work: ask whether to schedule. If yes, ask the exact publish time.
- Multiple works: ask whether to schedule, the starting time, and the interval between works.
- If the user says no schedule, verify `立即发布` is selected and `定时发布` is not selected.
