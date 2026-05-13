import { STATUS, getUploadAssets, platformPublishUrl, saveArtifacts, step } from "./utils.mjs";

export const adapters = {
  xiaohongshu: {
    async run(ctx) {
      const { page, plan } = ctx;
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
    }
  },
  douyin: {
    async run(ctx) {
      const { page, plan } = ctx;
      const steps = [];
      await page.goto(platformPublishUrl(plan.platform), { waitUntil: "domcontentloaded" });
      steps.push(await expectText(page, "page_signature", /作品描述|发布设置|上传/));
      if (shouldStopEarly(steps)) return steps;
      await dismissKnownOverlays(page);
      steps.push(await ensureDouyinComposer(page));
      if (steps[steps.length - 1].status !== STATUS.done) return steps;
      steps.push(await uploadFiles(page, plan, "input[type='file']", "upload_assets"));
      steps.push(await ensureDouyinComposer(page, { requireEditable: true }));
      if (steps[steps.length - 1].status !== STATUS.done) return steps;
      steps.push(await fillFirst(page, "title", ["input[placeholder*='添加作品标题']", "textarea[placeholder*='添加作品标题']"], plan.title));
      steps.push(await fillFirst(page, "body", ["textarea[placeholder*='添加作品描述']", "[contenteditable='true']"], plan.body));
      steps.push(await selectTopics(page, plan.tags || [], { appendAfterBody: true, delayMs: 900 }));
      steps.push(await selectCollection(page, plan.collection));
      steps.push(await selectDouyinDeclaration(page, plan.declaration));
      steps.push(await selectFirstRecommendedMusic(page, plan.music));
      steps.push(await setSchedule(page, plan.schedule));
      steps.push(await verifyPublishBoundary(page));
      await saveArtifacts(page, ctx.logDir, "douyin-final");
      return steps;
    }
  },
  wechat_channels: {
    async run(ctx) {
      const { page, plan } = ctx;
      const steps = [];
      await page.goto(platformPublishUrl(plan.platform), { waitUntil: "domcontentloaded" });
      steps.push(await expectText(page, "page_signature", /视频号|发表|发布|上传/));
      if (shouldStopEarly(steps)) return steps;
      await dismissKnownOverlays(page);
      steps.push(await uploadFiles(page, plan, "input[type='file']", "upload_assets"));
      steps.push(await fillFirst(page, "title", ["input[placeholder*='标题']", "textarea[placeholder*='标题']"], plan.title));
      steps.push(await fillFirst(page, "body", ["textarea[placeholder*='描述']", "textarea[placeholder*='正文']", "[contenteditable='true']"], plan.body));
      steps.push(await setSchedule(page, plan.schedule));
      steps.push(await verifyPublishBoundary(page));
      await saveArtifacts(page, ctx.logDir, "wechat-channels-final");
      return steps;
    }
  }
};

async function expectText(page, name, pattern) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const url = page.url();
    if (/login|passport|sso|auth/i.test(url)) return step(name, STATUS.needsHuman, `Login required: ${url}`);
    const text = await page.locator("body").innerText({ timeout: 10000 });
    if (/creator\.xiaohongshu\.com\/publish|creator\.douyin\.com\/creator-micro\/content|channels\.weixin\.qq\.com/.test(url)) {
      return step(name, STATUS.done, `Platform URL matched: ${url}`);
    }
    if (!pattern.test(text)) return step(name, STATUS.needsHuman, `Page loaded but expected markers were missing: ${pattern}`);
    return step(name, STATUS.done, "Platform page signature matched.");
  } catch (error) {
    return step(name, STATUS.failed, `Could not verify page signature: ${error.message}`);
  }
}

async function ensureDouyinComposer(page, options = {}) {
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await dismissKnownOverlays(page);
      const abandonDraft = page.getByText("放弃", { exact: true }).first();
      if ((await abandonDraft.count()) > 0 && page.url().includes("/content/upload")) {
        await abandonDraft.click({ timeout: 5000, force: true });
        await page.waitForTimeout(1200);
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

function shouldStopEarly(steps) {
  const last = steps[steps.length - 1];
  return last && last.name === "page_signature" && last.status !== STATUS.done;
}

async function uploadFiles(page, plan, selector, name) {
  const files = getUploadAssets(plan);
  if (files.length === 0) return step(name, STATUS.skipped, "No upload assets in plan.");
  try {
    if (plan.platform === "douyin") {
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
    } else {
      const input = page.locator(selector).first();
      await input.waitFor({ state: "attached", timeout: 15000 });
      await input.setInputFiles(files);
    }
    const uploadState = await waitForUploadProgress(page);
    if (uploadState.status !== STATUS.done) {
      return step(name, uploadState.status, uploadState.message, { files });
    }
    if (plan.platform === "douyin" && Array.isArray(plan.asset_paths?.images) && plan.asset_paths.images.length > 0) {
      const visibleUpload = await verifyDouyinUploadedImages(page, files.length);
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

async function verifyDouyinUploadedImages(page, expectedCount) {
  const deadline = Date.now() + 30000;
  const exactCountPattern = new RegExp(`已添加\\s*${expectedCount}\\s*张图片`);
  let lastExcerpt = "";
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const marker = text.match(/已添加\s*\d+\s*张图片/);
    if (marker) {
      const visibleCount = Number((marker[0].match(/\d+/) || [])[0]);
      if (exactCountPattern.test(marker[0])) {
        return {
          status: STATUS.done,
          message: `Douyin page confirms ${expectedCount} uploaded image(s).`,
          details: { visible_count: visibleCount, visible_marker: marker[0] }
        };
      }
      return {
        status: STATUS.needsHuman,
        message: `Douyin page shows ${visibleCount} uploaded image(s), expected ${expectedCount}.`,
        details: { visible_count: visibleCount, visible_marker: marker[0] }
      };
    }
    lastExcerpt = text.slice(0, 500);
    await page.waitForTimeout(1000);
  }
  return {
    status: STATUS.needsHuman,
    message: `Douyin upload count was not visible after upload; expected ${expectedCount} image(s).`,
    details: { visible_count: 0, visible_marker: "", text_excerpt: lastExcerpt }
  };
}

async function waitForUploadProgress(page) {
  const deadline = Date.now() + 90000;
  let lastProgress = "";
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/上传失败|上传出错|失败/.test(text)) return { status: STATUS.failed, message: "Upload failed according to page text." };
    const progresses = text.match(/\b(?:100|[1-9]?\d)%\b/g) || [];
    lastProgress = progresses.join(", ");
    if (progresses.length === 0) return { status: STATUS.done, message: "Upload progress completed." };
    await page.waitForTimeout(1500);
  }
  return { status: STATUS.needsHuman, message: `Upload still shows progress after timeout: ${lastProgress || "unknown"}` };
}

async function fillFirst(page, name, selectors, value) {
  if (!value) return step(name, STATUS.skipped, "No value in plan.");
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) === 0) continue;
      await locator.waitFor({ state: "visible", timeout: 3000 });
      await locator.fill(value, { timeout: 10000 });
      await page.waitForTimeout(300);
      return step(name, STATUS.done, `${name} filled using ${selector}.`);
    } catch {
      // Try the next selector.
    }
  }
  return step(name, STATUS.needsHuman, `No stable editable field found for ${name}.`);
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

async function fillXhsBody(page, value) {
  if (!value) return step("body", STATUS.skipped, "No value in plan.");
  try {
    const editor = page.locator(".tiptap.ProseMirror, [contenteditable='true']").first();
    await editor.waitFor({ state: "visible", timeout: 8000 });
    await editor.click({ timeout: 5000, force: true });
    await editor.fill(value, { timeout: 10000 });
    await page.waitForTimeout(500);
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

function normalizeXhsTag(value) {
  return String(value || "").replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "").trim();
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

async function clickByText(page, name, text) {
  if (!text) return step(name, STATUS.skipped, "No value in plan.");
  try {
    await page.getByText(String(text), { exact: false }).first().click({ timeout: 5000 });
    return step(name, STATUS.done, `${name} selected: ${text}`);
  } catch (error) {
    return step(name, STATUS.needsHuman, `${name} not found: ${text}. ${error.message.split("\n")[0]}`);
  }
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
      await page.keyboard.type(String(collection), { delay: 80 });
      await page.waitForTimeout(800);
      await page.keyboard.press("Enter");
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
    try {
      await page.getByText("立即发布", { exact: false }).first().click({ timeout: 5000 });
    } catch {
      // Some platforms default to immediate without a clickable control.
    }
    return step("schedule", STATUS.done, "Immediate publish selected or already default.");
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

function formatPlatformDateTime(value) {
  if (!value) throw new Error("schedule.publish_at is required for scheduled mode");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid schedule.publish_at: ${value}`);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function comparePlatformDateTime(actual, expected) {
  const actualTime = parsePlatformDateTime(actual);
  const expectedTime = parsePlatformDateTime(expected);
  if (actualTime === null || expectedTime === null) return -1;
  return actualTime - expectedTime;
}

function parsePlatformDateTime(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`).getTime();
}

async function verifyPublishBoundary(page) {
  try {
    const publishButtons = await page.getByRole("button", { name: /发布|提交|确认发布/ }).count();
    return step("publish_boundary", STATUS.done, `Final publish button count=${publishButtons}; not clicked.`);
  } catch {
    return step("publish_boundary", STATUS.done, "Final publish boundary preserved; not clicked.");
  }
}

async function dismissKnownOverlays(page) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const pattern of [/我知道了/, /知道了/, /稍后再说/, /取消/]) {
    try {
      const button = page.getByText(pattern).first();
      if ((await button.count()) > 0) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(300);
      }
    } catch {
      // Non-blocking onboarding/modal cleanup.
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
