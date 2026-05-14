import { STATUS, platformPublishUrl, saveArtifacts, step } from "../utils.mjs";

import { collectionInspectResult, dismissKnownOverlays, escapeRegExp, expectText, formatPlatformDateTime, normalizeCollectionNames, normalizeXhsTag, platformIdentityStep, readLocatorValue, readVisibleCollectionOptionTexts, saveDraftWithVisibleButton, shouldStopEarly, uploadFiles, verifyPublishBoundary } from "./common.mjs";

export const xiaohongshuAdapter = {
    async run(ctx) {
      const { page, plan } = ctx;
      const identity = platformIdentityStep(plan, "xiaohongshu");
      if (identity) return [identity];
      const steps = [];
      await page.goto(platformPublishUrl(plan.platform), { waitUntil: "domcontentloaded" });
      steps.push(await expectText(page, "page_signature", /上传图片|发布笔记|创作服务平台/));
      if (shouldStopEarly(steps)) return steps;
      await dismissKnownOverlays(page);
      steps.push(await uploadFiles(page, plan, "input[type='file']", "upload_assets"));
      steps.push(await fillXhsTitle(page, plan.title));
      steps.push(await fillXhsBody(page, normalizeXhsBody(plan.body, plan.tags || [])));
      steps.push(await selectXhsTopics(page, plan.tags || []));
      steps.push(await selectXhsCollection(page, plan.collection));
      steps.push(await selectXhsContentDeclaration(page, plan.declaration));
      steps.push(await setXhsSchedule(page, plan.schedule));
      steps.push(await selectXhsOriginalDeclaration(page));
      steps.push(await verifyPublishBoundary(page));
      await saveArtifacts(page, ctx.logDir, "xiaohongshu-final");
      return steps;
    },
    async saveDraftAndExit({ page }) {
      return saveDraftWithVisibleButton(page, "Xiaohongshu", /^(保存草稿|暂存草稿|存草稿|存为草稿|保存并离开)$/);
    }
  };

async function fillXhsBody(page, value) {
  if (!value) return step("body", STATUS.skipped, "No value in plan.");
  try {
    const editor = page.locator(".tiptap.ProseMirror, [contenteditable='true']").first();
    await editor.waitFor({ state: "visible", timeout: 8000 });
    await editor.click({ timeout: 5000, force: true });
    await editor.fill(value, { timeout: 10000 });
    await page.waitForTimeout(500);
    const actual = await readLocatorValue(editor);
    if (!actual.includes(String(value).slice(0, Math.min(20, String(value).length)))) {
      return step("body", STATUS.needsHuman, "Xiaohongshu body editor did not retain expected text after filling.");
    }
    return step("body", STATUS.done, "body filled using Xiaohongshu ProseMirror editor.");
  } catch (error) {
    return step("body", STATUS.needsHuman, `Xiaohongshu body needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function fillXhsTitle(page, value) {
  if (!value) return step("title", STATUS.skipped, "No value in plan.");
  try {
    const title = page.locator([
      "input[placeholder='填写标题会有更多赞哦']",
      "input[placeholder*='标题']",
      "input[type='text']"
    ].join(", ")).first();
    await title.waitFor({ state: "visible", timeout: 8000 });
    await title.scrollIntoViewIfNeeded({ timeout: 3000 });
    const cleaned = String(value).replace(/[<>]/g, "").slice(0, 20);
    await title.click({ timeout: 5000, force: true });
    await title.fill("", { timeout: 5000 }).catch(() => {});
    await title.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await page.keyboard.type(cleaned, { delay: 40 });
    await page.waitForTimeout(500);
    const actual = await title.inputValue({ timeout: 3000 });
    if (!actual) return step("title", STATUS.needsHuman, "Xiaohongshu title input stayed empty after typing.");
    if (actual !== cleaned) return step("title", STATUS.needsHuman, `Xiaohongshu title mismatch after typing: expected ${cleaned}, actual ${actual}`);
    return step("title", STATUS.done, `Xiaohongshu title filled: ${actual}`);
  } catch (error) {
    return step("title", STATUS.needsHuman, `Xiaohongshu title needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

function normalizeXhsBody(body, tags) {
  let value = String(body || "").trim();
  for (const rawTag of tags || []) {
    const tag = String(rawTag).replace(/^#/, "").trim();
    if (!tag) continue;
    value = value.replace(new RegExp(`\\s*#${escapeRegExp(tag)}(?=\\s|$|[。！？.!?])`, "gi"), "");
    value = value.replace(new RegExp(`\\s*#${escapeRegExp(normalizeXhsTag(tag))}(?=\\s|$|[。！？.!?])`, "gi"), "");
  }
  value = value.replace(/\s*#[\p{L}\p{N}_-]+(?=\s|$|[。！？.!?])/gu, "");
  return value.trim();
}

async function selectXhsTopics(page, tags) {
  if (!tags || tags.length === 0) return step("topics", STATUS.skipped, "No tags in plan.");
  const results = [];
  const editor = page.locator(".tiptap.ProseMirror, [contenteditable='true']").first();
  for (const rawTag of tags) {
    const original = String(rawTag || "").replace(/^#/, "").trim();
    const tag = normalizeXhsTag(original);
    if (!tag) continue;
    try {
      await placeCursorAtEnd(editor);
      const beforeTopicCount = await countXhsEditorTopics(editor);
      await page.locator("button.topic-btn").first().click({ timeout: 5000, force: true });
      await page.waitForTimeout(500);
      await page.keyboard.insertText(tag);
      await page.waitForTimeout(1000);
      const firstSuggestion = page.locator("[data-tippy-root]:visible .item").first();
      await firstSuggestion.waitFor({ state: "visible", timeout: 5000 });
      const box = await firstSuggestion.boundingBox();
      if (!box) throw new Error(`Xiaohongshu first topic suggestion was not clickable for ${tag}`);
      await page.mouse.click(box.x + Math.min(80, box.width / 2), box.y + box.height / 2);
      await page.waitForTimeout(800);
      const afterTopicCount = await countXhsEditorTopics(editor);
      if (afterTopicCount <= beforeTopicCount) {
        throw new Error(`Xiaohongshu topic token did not appear after selecting first suggestion for ${tag}`);
      }
      if ((await page.locator("[data-tippy-root]:visible .item").count().catch(() => 0)) > 0) {
        await page.keyboard.press("Escape").catch(() => {});
      }
      await page.waitForTimeout(500);
      const normalizedNote = original === tag ? "" : ` (normalized from ${original})`;
      results.push(`${tag}: selected${normalizedNote}`);
    } catch (error) {
      results.push(`${tag}: needs_human (${error.message.split("\n")[0]})`);
    }
  }
  const ok = results.every((item) => item.includes(": selected"));
  return step("topics", ok ? STATUS.done : STATUS.needsHuman, results.join("; "));
}

async function countXhsEditorTopics(editor) {
  return editor.evaluate((element) => element.querySelectorAll("a.tiptap-topic").length).catch(() => 0);
}

async function placeCursorAtEnd(locator) {
  await locator.click({ timeout: 5000, force: true });
  await locator.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function selectXhsOriginalDeclaration(page) {
  try {
    const wrapper = page.locator(".custom-switch-wrapper").filter({ hasText: /^原创声明$/ }).first();
    await wrapper.scrollIntoViewIfNeeded({ timeout: 5000 });
    const beforeClass = await wrapper.locator(".d-switch-simulator").first().getAttribute("class").catch(() => "");
    if (isSwitchEnabledClass(beforeClass)) {
      return step("declaration", STATUS.done, "Xiaohongshu original declaration already enabled.");
    }
    await clickLocatorCenter(page, wrapper.locator(".d-switch-simulator").first(), "Xiaohongshu original declaration switch");
    await page.waitForTimeout(1200);

    const dialog = page.locator(".el-overlay:visible, [role='dialog']:visible, body").filter({ hasText: /声明原创|原创声明须知|我已阅读并同意/ }).last();
    const agree = dialog.getByText(/我已阅读并同意/, { exact: false }).last();
    if ((await agree.count().catch(() => 0)) > 0) {
      await clickLeftOfLocator(page, agree, 18, "Xiaohongshu original declaration agreement checkbox");
      await page.waitForTimeout(500);
    }
    const confirm = page.locator(".d-button, button").filter({ hasText: /^声明原创$/ }).last();
    if ((await confirm.count().catch(() => 0)) > 0) {
      await clickLocatorCenter(page, confirm, "Xiaohongshu original declaration confirm");
      await page.waitForTimeout(1000);
    }
    if ((await page.locator(".el-overlay:visible, [role='dialog']:visible, .d-modal:visible").filter({ hasText: /原创声明|声明原创/ }).count().catch(() => 0)) > 0) {
      const textConfirm = page.getByText("声明原创", { exact: true }).last();
      if ((await textConfirm.count().catch(() => 0)) > 0) {
        await clickLocatorCenter(page, textConfirm, "Xiaohongshu original declaration text confirm").catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
    if ((await page.locator(".el-overlay:visible, [role='dialog']:visible, .d-modal:visible").filter({ hasText: /原创声明|声明原创/ }).count().catch(() => 0)) > 0) {
      const dialog = page.locator(".el-dialog:visible, [role='dialog']:visible, .d-modal:visible").filter({ hasText: /原创声明|声明原创/ }).last();
      const box = await dialog.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width - 92, box.y + box.height - 44).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    const freshWrapper = page.locator(".custom-switch-wrapper").filter({ hasText: /^原创声明$/ }).first();
    const afterClass = await freshWrapper.locator(".d-switch-simulator").first().getAttribute("class").catch(() => "");
    if (!isSwitchEnabledClass(afterClass)) {
      return step("declaration", STATUS.needsHuman, "Xiaohongshu original declaration switch did not become enabled after confirmation.");
    }
    if ((await page.locator(".el-overlay:visible, [role='dialog']:visible, .d-modal:visible").filter({ hasText: /原创声明|声明原创/ }).count().catch(() => 0)) > 0) {
      return step("declaration", STATUS.needsHuman, "Xiaohongshu original declaration enabled, but confirmation dialog is still open.");
    }
    return step("declaration", STATUS.done, "Xiaohongshu original declaration enabled.");
  } catch (error) {
    return step("declaration", STATUS.needsHuman, `Xiaohongshu original declaration needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

function isSwitchEnabledClass(value) {
  const className = String(value || "");
  if (/(^|\s)unchecked(\s|$)/.test(className)) return false;
  return /(^|\s)checked(\s|$)|--color-bg-primary/.test(className);
}

async function setXhsSchedule(page, schedule) {
  if (!schedule || schedule.mode === "immediate") {
    return step("schedule", STATUS.done, "Immediate publish selected or already default.");
  }
  try {
    const publishAt = formatPlatformDateTime(schedule.publish_at);
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(800);
    const wrapper = page.locator(".custom-switch-wrapper").filter({ hasText: /^定时发布$/ }).first();
    await wrapper.scrollIntoViewIfNeeded({ timeout: 5000 });
    const simulator = wrapper.locator(".d-switch-simulator").first();
    const beforeClass = await simulator.getAttribute("class").catch(() => "");
    if (!isSwitchEnabledClass(beforeClass)) {
      await clickLocatorCenter(page, wrapper.locator(".d-switch-simulator").first(), "Xiaohongshu schedule switch");
      await page.waitForTimeout(1000);
    }

    const input = page.locator(".post-time-wrapper input").last();
    await input.waitFor({ state: "visible", timeout: 8000 });
    await input.click({ timeout: 5000, force: true });
    await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await page.keyboard.type(publishAt, { delay: 20 });
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape").catch(() => {});
    const actual = await input.inputValue({ timeout: 3000 });
    if (actual !== publishAt) {
      return step("schedule", STATUS.needsHuman, `Xiaohongshu scheduled time did not retain expected value: expected ${publishAt}, actual ${actual}`);
    }
    return step("schedule", STATUS.done, `Xiaohongshu scheduled publish selected: ${publishAt}`);
  } catch (error) {
    return step("schedule", STATUS.needsHuman, `Xiaohongshu schedule needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function selectXhsContentDeclaration(page, declaration) {
  const label = declaration?.content_label || declaration?.content_type_label || "内容来源声明";
  const sourceLabel = declaration?.source_label || "自主拍摄";
  const sourceLocation = declaration?.source_location || "";
  const sourceDate = declaration?.source_date || "";
  try {
    const trigger = page.locator(".d-select-wrapper")
      .filter({ hasText: /添加内容类型声明|内容类型声明/ })
      .first();
    await trigger.scrollIntoViewIfNeeded({ timeout: 5000 });
    await clickLocatorRight(page, trigger, 26, "Xiaohongshu content declaration trigger");
    await page.waitForTimeout(800);

    const popover = page.locator(".d-popover:visible, .d-dropdown:visible").filter({ hasText: /内容来源声明|AI合成|营销广告|虚构演绎/ }).last();
    const option = popover.locator(".d-option, .d-option-content, .d-grid-item")
      .filter({ hasText: new RegExp(escapeRegExp(label) + "|内容来源声明") })
      .first();
    if ((await option.count()) === 0) {
      return step("content_declaration", STATUS.needsHuman, `Xiaohongshu content declaration option not found: ${label}`);
    }
    await clickLocatorCenter(page, option, `Xiaohongshu content declaration option ${label}`);
    await page.waitForTimeout(800);
    const sourceOption = page.locator(".d-popover:visible .d-option, .d-popover:visible .d-option-content, .d-dropdown:visible .d-option, .d-dropdown:visible .d-option-content, .d-popover:visible .d-grid-item")
      .filter({ hasText: new RegExp(escapeRegExp(sourceLabel) + "|自主拍摄") })
      .first();
    if ((await sourceOption.count().catch(() => 0)) > 0) {
      await clickLocatorCenter(page, sourceOption, `Xiaohongshu content source option ${sourceLabel}`);
      await page.waitForTimeout(800);
      const modal = page.locator(".el-overlay:visible, [role='dialog']:visible, .d-modal:visible").filter({ has: page.locator("input") }).last();
      const locationInput = page.locator("input[placeholder*='地点'], input[placeholder*='选择地点']").last();
      const dateInput = page.locator("input[placeholder*='日期'], input[placeholder*='选择日期']").last();
      const hasSourceModal = (await modal.count().catch(() => 0)) > 0
        || (await locationInput.count().catch(() => 0)) > 0
        || (await dateInput.count().catch(() => 0)) > 0;
      if (hasSourceModal) {
        if (!sourceLocation || !sourceDate) {
          await page.keyboard.press("Escape").catch(() => {});
          return step("content_declaration", STATUS.needsHuman, "Xiaohongshu content source requires source_location and source_date.");
        }
        await locationInput.click({ timeout: 5000, force: true });
        await locationInput.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
        await page.keyboard.type(String(sourceLocation), { delay: 60 });
        await page.waitForTimeout(1200);
        const firstLocation = page.locator(".d-popover:visible .d-option, .d-dropdown:visible .d-option, .el-popper:visible li, .el-popper:visible [role='option']").first();
        if ((await firstLocation.count().catch(() => 0)) > 0) {
          await clickLocatorCenter(page, firstLocation, "Xiaohongshu source location first option").catch(async () => {
            await page.keyboard.press("Enter").catch(() => {});
          });
        } else {
          await page.keyboard.press("Enter").catch(() => {});
        }
        await page.waitForTimeout(500);
        await dateInput.click({ timeout: 5000, force: true });
        await dateInput.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
        await page.keyboard.type(String(sourceDate), { delay: 30 });
        await page.keyboard.press("Enter").catch(() => {});
        await page.waitForTimeout(500);
        const confirm = page.locator(".el-overlay:visible .d-button, .el-overlay:visible button, [role='dialog']:visible .d-button, [role='dialog']:visible button, .d-modal:visible .d-button, .d-modal:visible button")
          .filter({ hasText: /^确认$/ })
          .last();
        if ((await confirm.count().catch(() => 0)) > 0) {
          await clickLocatorCenter(page, confirm, "Xiaohongshu content source confirm");
          await page.waitForTimeout(1000);
        }
        const stillOpen = (await page.locator("input[placeholder*='地点'], input[placeholder*='选择地点'], input[placeholder*='日期'], input[placeholder*='选择日期']").count().catch(() => 0)) > 0;
        if (stillOpen) {
          await closeVisibleModal(page, "Xiaohongshu content source modal");
          const visibleText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
          if (new RegExp(`${escapeRegExp(sourceLabel)}|自主拍摄`).test(visibleText)) {
            return step("content_declaration", STATUS.done, `Xiaohongshu content declaration selected: ${label} / ${sourceLabel}`);
          }
          return step("content_declaration", STATUS.needsHuman, "Xiaohongshu content source modal did not confirm; closed it so later steps can continue.");
        }
      }
    }
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (!new RegExp(`${escapeRegExp(sourceLabel)}|${escapeRegExp(label)}|内容来源声明|自主拍摄`).test(bodyText)) {
      return step("content_declaration", STATUS.needsHuman, "Xiaohongshu content declaration clicked, but selected state was not visible.");
    }
    await page.keyboard.press("Escape").catch(() => {});
    return step("content_declaration", STATUS.done, `Xiaohongshu content declaration selected: ${label} / ${sourceLabel}`);
  } catch (error) {
    return step("content_declaration", STATUS.needsHuman, `Xiaohongshu content declaration needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function clickLocatorCenter(page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 5000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} was not clickable`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function clickLeftOfLocator(page, locator, offset, label) {
  await locator.waitFor({ state: "visible", timeout: 5000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} was not clickable`);
  await page.mouse.click(Math.max(0, box.x - offset), box.y + box.height / 2);
}

async function clickLocatorRight(page, locator, offset, label) {
  await locator.waitFor({ state: "visible", timeout: 5000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} was not clickable`);
  await page.mouse.click(box.x + box.width - offset, box.y + box.height / 2);
}

async function closeVisibleModal(page, label) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  const close = page.locator(".el-overlay:visible .el-dialog__close, .el-overlay:visible [aria-label='Close'], [role='dialog']:visible .el-dialog__close, .d-modal:visible .d-icon-close, .d-modal:visible .close").last();
  if ((await close.count().catch(() => 0)) > 0) {
    await clickLocatorCenter(page, close, `${label} close`).catch(() => {});
    await page.waitForTimeout(500);
  }
  if ((await page.locator(".el-overlay:visible, [role='dialog']:visible, .d-modal:visible").count().catch(() => 0)) > 0) {
    const dialog = page.locator(".el-dialog:visible, [role='dialog']:visible, .d-modal:visible").last();
    const box = await dialog.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width - 32, box.y + 24).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

export async function inspectXhsCollections(page, plan, logDir) {
  const steps = [];
  const sourceArtifacts = {};
  const identity = platformIdentityStep(plan, "xiaohongshu");
  if (identity) return collectionInspectResult([identity], [], sourceArtifacts);
  try {
    await page.goto(platformPublishUrl(plan.platform), { waitUntil: "domcontentloaded" });
    steps.push(await expectText(page, "page_signature", /上传图片|发布笔记|创作服务平台/));
    if (shouldStopEarly(steps)) return collectionInspectResult(steps, [], sourceArtifacts);
    await dismissKnownOverlays(page);
    const opened = await openXhsCollectionDropdown(page);
    steps.push(step("open_collection_dropdown", opened ? STATUS.done : STATUS.needsHuman, opened ? "Xiaohongshu collection dropdown opened." : "Xiaohongshu collection dropdown trigger not found."));
    const values = opened ? await readVisibleCollectionOptionTexts(page, [
      ".el-overlay:visible .el-select-dropdown__item",
      ".el-overlay:visible .d-option",
      ".d-popover:visible .d-option",
      ".d-dropdown:visible .d-option",
      "[role='listbox']:visible [role='option']"
    ]) : [];
    const collections = normalizeCollectionNames(values);
    steps.push(step("collections", collections.length > 0 ? STATUS.done : STATUS.needsHuman, collections.length > 0 ? `Discovered ${collections.length} Xiaohongshu collection(s).` : "No Xiaohongshu collections were visible after opening the dropdown.", { collections }));
    Object.assign(sourceArtifacts, await saveArtifacts(page, logDir, "collections"));
    return collectionInspectResult(steps, collections, sourceArtifacts);
  } catch (error) {
    steps.push(step("inspect_collections", STATUS.needsHuman, `Xiaohongshu collection inspection needs manual handling: ${error.message.split("\n")[0]}`));
    if (page) Object.assign(sourceArtifacts, await saveArtifacts(page, logDir, "collections-failure").catch(() => ({})));
    return collectionInspectResult(steps, [], sourceArtifacts);
  }
}

async function openXhsCollectionDropdown(page) {
  const row = page.locator("div").filter({ hasText: /加入合集|添加到合集|选择合集/ }).first();
  if ((await row.count().catch(() => 0)) === 0) return false;
  await row.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const trigger = row.getByText(/选择合集|加入合集|添加到合集|不加入合集|宽论/, { exact: false }).last();
  if ((await trigger.count().catch(() => 0)) === 0) return false;
  await trigger.click({ timeout: 5000, force: true });
  await page.waitForTimeout(800);
  return true;
}

async function selectXhsCollection(page, collection) {
  if (!collection) return step("collection", STATUS.skipped, "No value in plan.");
  try {
    const row = page.locator("div").filter({ hasText: /加入合集/ }).first();
    await row.scrollIntoViewIfNeeded({ timeout: 5000 });
    if (await row.getByText(String(collection), { exact: true }).count().catch(() => 0)) {
      return step("collection", STATUS.done, `Xiaohongshu collection already selected: ${collection}`);
    }

    const trigger = row.getByText(/选择合集|加入合集|宽论/, { exact: false }).last();
    await trigger.click({ timeout: 5000, force: true });
    await page.waitForTimeout(800);

    const option = page.locator(".el-overlay, .d-popover, .d-dropdown, body")
      .getByText(String(collection), { exact: true })
      .last();
    if ((await option.count()) === 0) {
      return step("collection", STATUS.needsHuman, `Xiaohongshu collection dropdown opened, but option was not found: ${collection}`);
    }
    await option.click({ timeout: 5000, force: true });
    await page.waitForTimeout(800);

    if (!(await row.getByText(String(collection), { exact: true }).count().catch(() => 0))) {
      return step("collection", STATUS.needsHuman, `Xiaohongshu collection clicked, but selected state was not visible: ${collection}`);
    }
    return step("collection", STATUS.done, `Xiaohongshu collection selected: ${collection}`);
  } catch (error) {
    return step("collection", STATUS.needsHuman, `Xiaohongshu collection needs manual handling: ${error.message.split("\n")[0]}`);
  }
}
