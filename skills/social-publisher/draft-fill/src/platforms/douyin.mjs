import { STATUS, getUploadAssets, platformPublishUrl, saveArtifacts, step } from "../utils.mjs";

import { collectionInspectResult, comparePlatformDateTime, dismissKnownOverlays, escapeRegExp, expectText, fillFirst, formatPlatformDateTime, normalizeCollectionNames, normalizeXhsTag, platformIdentityStep, readLocatorValue, readVisibleCollectionOptionTexts, shouldStopEarly, textContainsContentFingerprint, verifyPublishBoundary, verifyVisibleUploadedImages, waitForUploadProgress } from "./common.mjs";

export const douyinAdapter = {
    async run(ctx) {
      const { page, plan } = ctx;
      const identity = platformIdentityStep(plan, "douyin");
      if (identity) return [identity];
      const steps = [];
      await page.goto(platformPublishUrl(plan.platform), { waitUntil: "domcontentloaded" });
      steps.push(await expectText(page, "page_signature", /作品描述|发布设置|上传/));
      if (shouldStopEarly(steps)) return steps;
      await dismissKnownOverlays(page);
      steps.push(await ensureDouyinComposer(page));
      if (steps[steps.length - 1].status !== STATUS.done) return steps;
      steps.push(await uploadDouyinFiles(page, plan, "input[type='file']", "upload_assets"));
      steps.push(await ensureDouyinComposer(page, { requireEditable: true }));
      if (steps[steps.length - 1].status !== STATUS.done) return steps;
      steps.push(await fillFirst(page, "title", ["input[placeholder*='添加作品标题']", "textarea[placeholder*='添加作品标题']"], plan.title));
      steps.push(await fillDouyinBody(page, plan.body));
      steps.push(await selectTopics(page, plan.tags || [], { appendAfterBody: true, delayMs: 900 }));
      steps.push(await selectCollection(page, plan.collection));
      steps.push(await selectDouyinDeclaration(page, plan.declaration));
      steps.push(await selectFirstRecommendedMusic(page, plan.music));
      steps.push(await setSchedule(page, plan.schedule));
      steps.push(await verifyPublishBoundary(page));
      await saveArtifacts(page, ctx.logDir, "douyin-final");
      return steps;
    }
  };

async function ensureDouyinComposer(page, options = {}) {
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await dismissKnownOverlays(page);
      const abandonDraft = page.getByText("放弃", { exact: true }).first();
      if (options.allowDiscardDraft && (await abandonDraft.count()) > 0 && page.url().includes("/content/upload")) {
        await abandonDraft.click({ timeout: 5000, force: true });
        await page.waitForTimeout(1200);
      } else if ((await abandonDraft.count()) > 0 && page.url().includes("/content/upload")) {
        return step("composer", STATUS.needsHuman, "Douyin has an existing upload draft; refusing to discard it during this operation.");
      }
      const titleField = page.locator("input[placeholder*='添加作品标题'], textarea[placeholder*='添加作品标题']").first();
      const uploadInput = page.locator("input[type='file']").first();
      if ((await titleField.count()) > 0) {
        return step("composer", STATUS.done, `Douyin composer ready: ${page.url()}`);
      }
      if (!options.requireEditable && (await uploadInput.count()) > 0) {
        return step("composer", STATUS.done, `Douyin composer ready: ${page.url()}`);
      }

      const continueEdit = page.getByText(/继续编辑/).first();
      if ((await continueEdit.count()) > 0) {
        await continueEdit.click({ timeout: 5000, force: true });
        await page.waitForTimeout(2000);
        continue;
      }

      const publishImage = page.getByText(/发布图文/).first();
      if ((await publishImage.count()) > 0) {
        await publishImage.click({ timeout: 5000, force: true });
        await page.waitForTimeout(2500);
        continue;
      }

      await page.goto(platformPublishUrl("douyin"), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
    }
    return step("composer", STATUS.needsHuman, `Douyin composer not reachable from current page: ${page.url()}`);
  } catch (error) {
    return step("composer", STATUS.needsHuman, `Douyin composer needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function uploadDouyinFiles(page, plan, selector, name) {
  const files = getUploadAssets(plan);
  if (files.length === 0) return step(name, STATUS.skipped, "No upload assets in plan.");
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await setDouyinUploadFiles(page, selector, files);
      const editorReady = await waitForDouyinPostEditor(page, attempt === 1 ? 90000 : 120000);
      if (editorReady) break;
      if (attempt === 2) {
        return step(name, STATUS.needsHuman, "Douyin upload did not transition to the post editor after two attempts.", { files });
      }
      await page.goto(platformPublishUrl("douyin"), { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    const uploadState = await waitForUploadProgress(page);
    if (uploadState.status !== STATUS.done) {
      return step(name, uploadState.status, uploadState.message, { files });
    }
    if (["douyin", "xiaohongshu"].includes(plan.platform) && Array.isArray(plan.asset_paths?.images) && plan.asset_paths.images.length > 0) {
      const visibleUpload = await verifyVisibleUploadedImages(page, files.length, plan.platform);
      if (visibleUpload.status !== STATUS.done) {
        return step(name, visibleUpload.status, visibleUpload.message, { files, ...visibleUpload.details });
      }
      return step(name, STATUS.done, `Uploaded ${files.length} file(s); page shows ${visibleUpload.details.visible_count} image(s).`, {
        files,
        visible_count: visibleUpload.details.visible_count,
        visible_marker: visibleUpload.details.visible_marker
      });
    }
    return step(name, STATUS.done, `Uploaded ${files.length} file(s).`, { files });
  } catch (error) {
    return step(name, STATUS.failed, `Upload failed: ${error.message}`, { files });
  }
}

async function setDouyinUploadFiles(page, selector, files) {
  let fileChooserUsed = false;
  const uploadButton = page.getByText(/上传图文|上传视频|点击上传/).last();
  if ((await uploadButton.count().catch(() => 0)) > 0) {
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
    await uploadButton.click({ timeout: 5000, force: true }).catch(() => {});
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(files);
      fileChooserUsed = true;
    }
  }
  if (!fileChooserUsed) {
    const input = page.locator(selector).last();
    await input.waitFor({ state: "attached", timeout: 15000 });
    await input.setInputFiles(files);
  }
}

async function waitForDouyinPostEditor(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/\/content\/post\/image|\/content\/post\/video/.test(page.url())) {
      const titleField = page.locator("input[placeholder*='添加作品标题'], textarea[placeholder*='添加作品标题']").first();
      if ((await titleField.count().catch(() => 0)) > 0) return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function fillDouyinBody(page, value) {
  if (!value) return step("body", STATUS.skipped, "No value in plan.");
  const selectors = ["textarea[placeholder*='添加作品描述']", "[contenteditable='true']"];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) === 0) continue;
      await locator.waitFor({ state: "visible", timeout: 3000 });
      await locator.fill(value, { timeout: 10000 });
      await page.waitForTimeout(700);
      const actual = await readLocatorValue(locator);
      const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      if (textContainsContentFingerprint(actual, value) || textContainsContentFingerprint(pageText, value)) {
        return step("body", STATUS.done, `Douyin body filled and verified using ${selector}.`);
      }
      return step("body", STATUS.needsHuman, "Douyin body was filled, but neither the editor nor page preview showed the expected text.");
    } catch {
      // Try the next selector.
    }
  }
  return step("body", STATUS.needsHuman, "No stable editable field found for Douyin body.");
}

async function selectTopics(page, tags, options = {}) {
  if (!tags || tags.length === 0) return step("topics", STATUS.skipped, "No tags in plan.");
  const results = [];
  if (options.appendAfterBody) await moveBodyCursorToTagAppendArea(page);
  for (const rawTag of tags) {
    const tag = normalizeXhsTag(rawTag);
    if (!tag) continue;
    try {
      await page.getByText(/#添加话题|添加话题|话题/).first().click({ timeout: 5000 });
      await page.waitForTimeout(options.delayMs || 500);
      await page.keyboard.type(tag, { delay: 80 });
      await page.waitForTimeout(options.delayMs || 700);
      await clickFirstTopicCandidate(page, tag);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(options.delayMs || 500);
      results.push(`${tag}: selected`);
    } catch (error) {
      results.push(`${tag}: needs_human (${error.message.split("\n")[0]})`);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  const ok = results.every((item) => item.includes(": selected"));
  return step("topics", ok ? STATUS.done : STATUS.needsHuman, results.join("; "));
}

async function clickFirstTopicCandidate(page, tag) {
  const panel = page.locator("[class*='mention-suggest']").first();
  await panel.waitFor({ state: "visible", timeout: 5000 });
  const box = await panel.boundingBox();
  if (!box) throw new Error(`topic candidate panel not visible after typing: ${tag}`);
  await page.mouse.click(box.x + Math.min(80, box.width / 2), box.y + 24);
}

async function moveBodyCursorToTagAppendArea(page) {
  const body = page.locator("textarea[placeholder*='添加作品描述'], [contenteditable='true']").first();
  try {
    await body.click({ timeout: 5000 });
    await body.evaluate((element) => {
      element.focus();
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        element.setSelectionRange(element.value.length, element.value.length);
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.type("\n\n", { delay: 40 });
    await page.waitForTimeout(500);
  } catch {
    // Topic insertion can still fall back to the platform's current cursor behavior.
  }
}

export async function inspectDouyinCollections(page, plan, logDir) {
  const steps = [];
  const sourceArtifacts = {};
  const identity = platformIdentityStep(plan, "douyin");
  if (identity) return collectionInspectResult([identity], [], sourceArtifacts);
  try {
    await page.goto(platformPublishUrl(plan.platform), { waitUntil: "domcontentloaded" });
    steps.push(await expectText(page, "page_signature", /作品描述|发布设置|上传|浣滃搧鎻忚堪|鍙戝竷璁剧疆|涓婁紶/));
    if (shouldStopEarly(steps)) return collectionInspectResult(steps, [], sourceArtifacts);
    await dismissKnownOverlays(page);
    steps.push(await ensureDouyinComposer(page));
    if (shouldStopEarly(steps)) return collectionInspectResult(steps, [], sourceArtifacts);
    const opened = await openDouyinCollectionDropdown(page);
    steps.push(step("open_collection_dropdown", opened ? STATUS.done : STATUS.needsHuman, opened ? "Douyin collection dropdown opened." : "Douyin collection dropdown trigger not found."));
    const values = opened ? await readVisibleCollectionOptionTexts(page, [
      ".semi-select-option:visible",
      ".semi-popover:visible [role='option']",
      ".semi-popover:visible .semi-select-option",
      "[role='listbox']:visible [role='option']"
    ]) : [];
    const collections = normalizeCollectionNames(values);
    steps.push(step("collections", collections.length > 0 ? STATUS.done : STATUS.needsHuman, collections.length > 0 ? `Discovered ${collections.length} Douyin collection(s).` : "No Douyin collections were visible after opening the dropdown.", { collections }));
    Object.assign(sourceArtifacts, await saveArtifacts(page, logDir, "collections"));
    return collectionInspectResult(steps, collections, sourceArtifacts);
  } catch (error) {
    steps.push(step("inspect_collections", STATUS.needsHuman, `Douyin collection inspection needs manual handling: ${error.message.split("\n")[0]}`));
    if (page) Object.assign(sourceArtifacts, await saveArtifacts(page, logDir, "collections-failure").catch(() => ({})));
    return collectionInspectResult(steps, [], sourceArtifacts);
  }
}

async function openDouyinCollectionDropdown(page) {
  const opener = page.getByText(/不选择合集|添加合集|选择合集|加入合集|涓嶉€夋嫨鍚堥泦|娣诲姞鍚堥泦/, { exact: false }).first();
  if ((await opener.count().catch(() => 0)) === 0) return false;
  await opener.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await opener.click({ timeout: 5000, force: true });
  await page.waitForTimeout(700);
  return true;
}

async function selectCollection(page, collection) {
  if (!collection) return step("collection", STATUS.skipped, "No value in plan.");
  try {
    const beforeUrl = page.url();
    if (await verifyCollectionSelected(page, collection)) {
      return step("collection", STATUS.done, `Collection already selected: ${collection}`);
    }
    const opener = page.getByText("不选择合集", { exact: true }).first();
    if ((await opener.count()) === 0) {
      return step("collection", STATUS.needsHuman, "Draft collection dropdown not found; refusing to click generic collection navigation.");
    }
    await opener.scrollIntoViewIfNeeded({ timeout: 5000 });
    await opener.click({ timeout: 5000, force: true });
    await page.waitForTimeout(600);
    const option = page.getByText(String(collection), { exact: true }).last();
    if ((await option.count()) > 0) {
      await option.click({ timeout: 8000, force: true });
    } else {
      const searchedOption = await searchDouyinCollectionDropdown(page, collection);
      if (!searchedOption) {
        return step("collection", STATUS.needsHuman, `Collection option was not found in the opened dropdown: ${collection}. Run inspect-collections and choose an existing broad collection.`);
      }
    }
    await page.waitForTimeout(500);
    if (!page.url().includes("/content/upload") && !page.url().includes("/content/post")) {
      return step("collection", STATUS.failed, `Collection click navigated away from draft page: ${beforeUrl} -> ${page.url()}`);
    }
    const selected = await verifyCollectionSelected(page, collection);
    if (!selected) return step("collection", STATUS.needsHuman, `Collection option clicked, but page did not show selected collection: ${collection}`);
    return step("collection", STATUS.done, `Collection selected: ${collection}`);
  } catch (error) {
    return step("collection", STATUS.needsHuman, `Collection not found: ${collection}. ${error.message.split("\n")[0]}`);
  }
}

async function searchDouyinCollectionDropdown(page, collection) {
  const dropdown = page.locator(".semi-popover:visible, [role='listbox']:visible").last();
  if ((await dropdown.count().catch(() => 0)) === 0) return false;
  const searchInput = dropdown.locator("input:not([type='hidden']), textarea").first();
  if ((await searchInput.count().catch(() => 0)) === 0) return false;
  await searchInput.fill(String(collection), { timeout: 5000 });
  await page.waitForTimeout(800);
  const exactOption = dropdown
    .locator(".semi-select-option, [role='option'], li, div")
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(String(collection))}\\s*$`) })
    .first();
  if ((await exactOption.count().catch(() => 0)) === 0) return false;
  const optionText = await exactOption.innerText({ timeout: 3000 }).catch(() => "");
  if (optionText.trim() !== String(collection).trim()) return false;
  await exactOption.click({ timeout: 8000, force: true });
  await page.waitForTimeout(500);
  return true;
}

async function verifyCollectionSelected(page, collection) {
  const collectionRow = page.locator("div").filter({ hasText: /添加合集/ }).filter({ hasText: new RegExp(escapeRegExp(String(collection))) }).first();
  if ((await collectionRow.count()) > 0) return true;
  const notSelected = page.getByText("不选择合集", { exact: true }).first();
  return (await notSelected.count()) === 0;
}

async function selectDouyinDeclaration(page, declaration) {
  const label = declaration?.label || "内容为个人观点或见解";
  try {
    if ((await page.getByText(new RegExp(escapeRegExp(label))).count().catch(() => 0)) > 0) {
      return step("declaration", STATUS.done, `Declaration already selected: ${label}`);
    }
    await page.getByText(/请选择自主声明|自主声明/).first().click({ timeout: 5000, force: true });
    await page.waitForTimeout(600);

    const optionPatterns = [
      new RegExp(escapeRegExp(label)),
      /个人观点|观点|见解/
    ];
    let selected = false;
    for (const pattern of optionPatterns) {
      const option = page.getByText(pattern).first();
      if ((await option.count()) === 0) continue;
      try {
        await option.click({ timeout: 3000, force: true });
        selected = true;
        break;
      } catch {
        // Try a broader radio fallback below.
      }
    }
    if (!selected) {
      const radio = page.getByRole("radio").first();
      if ((await radio.count()) > 0) {
        await radio.click({ timeout: 3000, force: true });
        selected = true;
      }
    }
    if (!selected) {
      const radioLike = page.locator("label, [role='radio'], .semi-radio, .semi-radio-wrapper, div").filter({ hasText: /个人观点|观点|见解/ }).first();
      if ((await radioLike.count()) > 0) {
        await radioLike.click({ timeout: 3000, force: true });
        selected = true;
      }
    }
    if (!selected) throw new Error("declaration radio option not found");

    await page.waitForTimeout(300);
    const confirm = page.getByRole("button", { name: /确定|确认/ }).last();
    if ((await confirm.count()) > 0) await confirm.click({ timeout: 5000, force: true });
    await page.waitForTimeout(500);
    return step("declaration", STATUS.done, `Declaration selected: ${label}`);
  } catch (error) {
    return step("declaration", STATUS.needsHuman, `Declaration needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function selectFirstRecommendedMusic(page, music) {
  if (!music || music.strategy !== "first_recommended") return step("music", STATUS.skipped, "No music selection requested.");
  try {
    const triggers = page.getByText(/选择音乐|修改音乐/);
    const trigger = triggers.nth(Math.max(0, (await triggers.count()) - 1));
    await trigger.scrollIntoViewIfNeeded({ timeout: 5000 });
    await trigger.click({ timeout: 5000, force: true });
    await page.waitForTimeout(1200);
    const sideSheet = page.locator(".semi-sidesheet").last();
    await sideSheet.waitFor({ state: "visible", timeout: 8000 });
    const firstSong = sideSheet.locator("[class*='song-info']").first();
    if ((await firstSong.count()) > 0) {
      await firstSong.hover({ timeout: 3000 }).catch(() => {});
    }
    const useButton = sideSheet.getByRole("button", { name: "使用" }).first();
    if ((await useButton.count()) > 0) {
      await useButton.click({ timeout: 8000, force: true });
    } else {
      return step("music", STATUS.needsHuman, "Music side sheet opened, but no usable first-song button was found.");
    }
    await page.waitForTimeout(1200);
    const bodyText = await page.locator("body").innerText({ timeout: 5000 });
    if (/点击添加合适作品风格音乐/.test(bodyText) && !/修改音乐/.test(bodyText)) {
      return step("music", STATUS.needsHuman, "Music picker opened, but selected music was not verified on the page.");
    }
    return step("music", STATUS.done, "First recommended music selected and page state changed.");
  } catch (error) {
    return step("music", STATUS.needsHuman, `Music needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function setSchedule(page, schedule) {
  if (!schedule || schedule.mode === "immediate") {
    return step("schedule", STATUS.done, "Immediate publish requested; no schedule control was changed.");
  }
  try {
    const publishAt = formatPlatformDateTime(schedule.publish_at);
    const scheduleOption = page.getByText("定时发布", { exact: true }).last();
    await scheduleOption.scrollIntoViewIfNeeded({ timeout: 5000 });
    await scheduleOption.click({ timeout: 5000, force: true });
    await page.waitForTimeout(600);
    const input = page.locator("input[placeholder='日期和时间'], input[placeholder*='日期']").first();
    await input.waitFor({ state: "visible", timeout: 8000 });
    await input.fill(publishAt, { timeout: 5000 });
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(500);
    const actual = await input.inputValue({ timeout: 3000 });
    if (actual !== publishAt) {
      const comparison = comparePlatformDateTime(actual, publishAt);
      if (comparison >= 0) {
        return step("schedule", STATUS.done, `Scheduled publish selected: ${actual} (platform adjusted from requested ${publishAt}).`);
      }
      return step("schedule", STATUS.needsHuman, `Scheduled time input did not retain expected value: expected ${publishAt}, actual ${actual}`);
    }
    return step("schedule", STATUS.done, `Scheduled publish selected: ${publishAt}`);
  } catch (error) {
    return step("schedule", STATUS.needsHuman, `Schedule needs manual handling: ${error.message.split("\n")[0]}`);
  }
}
