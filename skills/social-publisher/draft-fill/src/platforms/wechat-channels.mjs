import { STATUS, getUploadAssets, saveArtifacts, step } from "../utils.mjs";

import { collectionInspectResult, formatPlatformDateTime, normalizeCollectionNames, normalizeXhsTag, platformIdentityStep, readVisibleFrameCollectionOptionTexts, redactedTextEvidence, textContainsContentFingerprint } from "./common.mjs";

export const wechatChannelsAdapter = {
    async run(ctx) {
      const { page, plan } = ctx;
      const identity = platformIdentityStep(plan, "wechat_channels");
      if (identity) return [identity];
      const steps = [];
      steps.push(await openWechatChannelsComposer(page, plan));
      if (steps[steps.length - 1].status !== STATUS.done) return steps;
      const frame = await wechatContentFrame(page);
      steps.push(await uploadWechatChannelsFiles(page, frame, plan));
      steps.push(await fillWechatChannelsText(page, frame, plan));
      steps.push(await selectWechatChannelsTopics(page, frame, plan.tags || []));
      steps.push(await selectWechatChannelsCollection(frame, plan.collection));
      steps.push(await setWechatChannelsDeclaration(frame, plan.declaration, plan));
      steps.push(await setWechatChannelsMusic(frame, plan.music));
      steps.push(await setWechatChannelsActivity(frame, plan.activity));
      steps.push(await setWechatChannelsSchedule(frame, plan.schedule));
      steps.push(await verifyWechatChannelsPublishBoundary(frame));
      await saveArtifacts(page, ctx.logDir, "wechat-channels-final");
      return steps;
    }
  };

function isWechatChannelsVideoPlan(plan) {
  return !!plan.asset_paths?.video || plan.kind === "video";
}

async function openWechatChannelsComposer(page, plan) {
  try {
    if (isWechatChannelsVideoPlan(plan)) {
      await page.goto("https://channels.weixin.qq.com/platform/post/create", { waitUntil: "domcontentloaded" });
      const frame = await waitForWechatChannelsFrame(page, "post/create", 30000);
      const ready = await frame.locator(".input-editor[contenteditable], [contenteditable], input[type='file']").first().count().catch(() => 0);
      if (ready === 0) return step("composer", STATUS.needsHuman, "WeChat Channels video composer opened but editable controls were not detected.");
      return step("composer", STATUS.done, "WeChat Channels video composer ready.");
    }

    await page.goto("https://channels.weixin.qq.com/platform/post/finderNewLifePostList", { waitUntil: "domcontentloaded" });
    const listFrame = await waitForWechatChannelsFrame(page, "finderNewLifePostList", 30000);
    await waitForWechatChannelsVisibleSelector(listFrame, ".video-btn-wrap, .weui-desktop-btn_wrp, button", 30000);
    const clicked = await clickWechatFramePrimaryButton(listFrame);
    if (!clicked) return step("composer", STATUS.needsHuman, "WeChat Channels image publish entry was not found.");
    const createFrame = await waitForWechatChannelsFrame(page, "finderNewLifeCreate", 30000).catch(() => null);
    if (!createFrame) return step("composer", STATUS.needsHuman, "WeChat Channels image entry was clicked, but the create route did not open.");
    const ready = await waitForWechatChannelsImageReady(createFrame, 45000);
    return step("composer", ready ? STATUS.done : STATUS.needsHuman, ready ? "WeChat Channels image composer ready." : "WeChat Channels image composer did not become ready.");
  } catch (error) {
    return step("composer", STATUS.needsHuman, `WeChat Channels composer needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function wechatContentFrame(page) {
  const frame = page.frame({ name: "content" });
  if (!frame) throw new Error("WeChat Channels content iframe not found.");
  return frame;
}

async function waitForWechatChannelsFrame(page, route, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frame({ name: "content" });
    if (frame && frame.url().includes(route)) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error(`WeChat Channels content frame route not reached: ${route}`);
}

async function waitForWechatChannelsVisibleSelector(frame, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await frame.evaluate((selector) => Array.from(document.querySelectorAll(selector)).some((item) => {
      const rect = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }), selector).catch(() => false);
    if (visible) return true;
    await frame.page().waitForTimeout(500);
  }
  return false;
}

async function waitForWechatChannelsImageReady(frame, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await frame.evaluate(() => {
      const fileInput = document.querySelector("input[type='file']");
      const titleInput = Array.from(document.querySelectorAll("input[type='text']")).find((el) => {
        const placeholder = el.getAttribute("placeholder") || "";
        const rect = el.getBoundingClientRect();
        return rect.width > 100 && rect.height > 20 && (placeholder.includes("22") || placeholder.includes("\u6807\u9898"));
      });
      return !!fileInput && !!titleInput;
    }).catch(() => false);
    if (ready) return true;
    await frame.page().waitForTimeout(700);
  }
  return false;
}

async function clickWechatFramePrimaryButton(frame) {
  const publishImage = frame.locator(".video-btn-wrap, .weui-desktop-btn_wrp")
    .filter({ hasText: /\u53d1\u8868\u56fe\u6587|\u53d1\u8868\u52a8\u6001/ })
    .first();
  if ((await publishImage.count().catch(() => 0)) > 0) {
    await publishImage.click({ timeout: 5000, force: true }).catch(() => {});
    await frame.page().waitForTimeout(1000);
    return true;
  }
  return frame.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("button, .weui-desktop-btn_primary, .weui-desktop-btn_wrp, .video-btn-wrap"));
    const visible = nodes.filter((item) => {
      const rect = item.getBoundingClientRect();
      const disabled = item.disabled || String(item.className || "").includes("disabled");
      return rect.width > 0 && rect.height > 0 && !disabled;
    });
    const node = visible.find((item) => /发表图文|发表动态/.test(item.innerText || item.textContent || ""))
      || null;
    if (!node) return false;
    node.scrollIntoView({ block: "center", inline: "center" });
    node.click();
    return true;
  }).catch(() => false);
}

async function uploadWechatChannelsFiles(page, frame, plan) {
  const files = getUploadAssets(plan);
  if (files.length === 0) return step("upload_assets", STATUS.skipped, "No upload assets in plan.");
  try {
    const session = await page.context().newCDPSession(page);
    const result = await session.send("Runtime.evaluate", {
      expression: "document.querySelector('iframe[name=\"content\"]')?.contentDocument?.querySelector('input[type=\"file\"]')",
      objectGroup: "social-publisher-wechat-channels"
    });
    if (!result?.result?.objectId) return step("upload_assets", STATUS.needsHuman, "WeChat Channels file input not found in content iframe.");
    await session.send("DOM.setFileInputFiles", { objectId: result.result.objectId, files });
    await session.send("Runtime.callFunctionOn", {
      objectId: result.result.objectId,
      functionDeclaration: "function(){ this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); }"
    }).catch(() => {});
    await page.waitForTimeout(12000);
    const acceptedCount = await wechatChannelsAcceptedFileCount(page);
    const evidence = await waitForWechatChannelsUploadEvidence(frame, files.length, isWechatChannelsVideoPlan(plan) ? 30000 : 90000);
    if (!isWechatChannelsVideoPlan(plan)) {
      if (!evidence.ok && acceptedCount !== files.length) {
        return step("upload_assets", STATUS.needsHuman, `WeChat Channels image previews did not reach ${files.length}.`, { files, accepted_count: acceptedCount, evidence });
      }
    } else {
      await page.waitForTimeout(5000);
    }
    return step("upload_assets", STATUS.done, `Uploaded ${files.length} file(s) through WeChat Channels iframe.`, { files, accepted_count: acceptedCount, evidence });
  } catch (error) {
    return step("upload_assets", STATUS.failed, `WeChat Channels upload failed: ${error.message}`, { files });
  }
}

async function wechatChannelsAcceptedFileCount(page) {
  const session = await page.context().newCDPSession(page);
  const result = await session.send("Runtime.evaluate", {
    expression: "document.querySelector('iframe[name=\"content\"]')?.contentDocument?.querySelector('input[type=\"file\"]')?.files?.length ?? 0",
    returnByValue: true
  }).catch(() => null);
  return Number(result?.result?.value || 0);
}

async function waitForWechatChannelsUploadEvidence(frame, expectedCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = { ok: false, visible_images: 0, carousel_count: null, ...redactedTextEvidence("") };
  while (Date.now() < deadline) {
    latest = await readWechatChannelsUploadEvidence(frame, expectedCount);
    if (latest.ok) return latest;
    await frame.page().waitForTimeout(1000);
  }
  return latest;
}

async function readWechatChannelsUploadEvidence(frame, expectedCount) {
  return frame.evaluate((expectedCount) => {
    const text = document.body?.innerText || "";
    if (/上传失败|上传出错|失败/.test(text)) {
      return { ok: false, visible_images: 0, carousel_count: null, text_present: text.length > 0, text_length: text.length, text_line_count: text ? text.split(/\r\n|\r|\n/).length : 0, error_text: true };
    }
    const carouselMatch = text.match(/(?:^|\s)(?:0?1|1)\s*\/\s*(\d{1,2})(?:\s|$)/);
    const carouselCount = carouselMatch ? Number(carouselMatch[1]) : null;
    const visibleImages = Array.from(document.querySelectorAll("img, [style*='background-image']")).filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const source = node.currentSrc || node.getAttribute?.("src") || style.backgroundImage || "";
      return rect.width > 20 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden" && /blob:|data:|http|url\(/.test(source);
    }).length;
    return {
      ok: carouselCount >= expectedCount || visibleImages >= expectedCount,
      visible_images: visibleImages,
      carousel_count: carouselCount || null,
      text_present: text.length > 0,
      text_length: text.length,
      text_line_count: text ? text.split(/\r\n|\r|\n/).length : 0
    };
  }, expectedCount).catch((error) => ({ ok: false, visible_images: 0, carousel_count: null, ...redactedTextEvidence(""), error: error.message }));
}

export function parseWechatChannelsCarouselCount(text) {
  const value = String(text || "");
  const match = value.match(/(?:^|\s)(?:0?1|1)\s*\/\s*(\d{1,2})(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

const WECHAT_CHANNELS_TEXT = {
  titlePlaceholder: "\u586b\u5199\u6807\u9898",
  titleLimitHint: "22",
  description: "\u63cf\u8ff0",
  noMusic: "\u4e0d\u6dfb\u52a0\u97f3\u4e50",
  selectMusic: "\u9009\u62e9\u97f3\u4e50",
  noActivity: "\u4e0d\u53c2\u4e0e\u6d3b\u52a8",
  original: "\u539f\u521b",
  scheduled: "\u5b9a\u65f6",
  schedulePlaceholder: "\u8bf7\u9009\u62e9\u53d1\u8868\u65f6\u95f4",
  publish: "\u53d1\u8868"
};

const WECHAT_CHANNELS_TITLE_SELECTOR = [
  `input[placeholder*='${WECHAT_CHANNELS_TEXT.titlePlaceholder}']`,
  `input[placeholder*='${WECHAT_CHANNELS_TEXT.titleLimitHint}']`
].join(", ");

const WECHAT_CHANNELS_DESCRIPTION_SELECTORS = [
  ".post-desc-box .input-editor",
  ".post-desc-box [contenteditable]",
  ".input-editor[contenteditable]",
  "[contenteditable]",
  `textarea[placeholder*='${WECHAT_CHANNELS_TEXT.description}']`,
  ".post-desc-box"
];

const WECHAT_CHANNELS_SCHEDULE_SELECTOR = [
  ".post-time-wrap input[type='text']",
  `input[placeholder*='${WECHAT_CHANNELS_TEXT.schedulePlaceholder}']`,
  `input[placeholder*='\u53d1\u8868\u65f6\u95f4']`
].join(", ");

export function classifyWechatChannelsInput(input) {
  const placeholder = String(input?.placeholder || "");
  if (placeholder.includes(WECHAT_CHANNELS_TEXT.schedulePlaceholder) || placeholder.includes("\u53d1\u8868\u65f6\u95f4")) {
    return "schedule";
  }
  if (placeholder.includes(WECHAT_CHANNELS_TEXT.titlePlaceholder) || placeholder.includes(WECHAT_CHANNELS_TEXT.titleLimitHint)) {
    return "title";
  }
  return "unknown";
}

export function isWechatChannelsPublishButton(control) {
  const text = String(control?.text || control?.innerText || control?.accessibleName || "").trim();
  if (text !== WECHAT_CHANNELS_TEXT.publish) return false;
  const tag = String(control?.tag || control?.tagName || "").toUpperCase();
  const role = String(control?.role || "").toLowerCase();
  const className = String(control?.className || "");
  return tag === "BUTTON" || role === "button" || /btn|button/i.test(className);
}

export function appendPlainHashTags(text, tags) {
  const base = String(text || "").trimEnd();
  const normalizedTags = (tags || []).map(normalizeXhsTag).filter(Boolean);
  const missing = normalizedTags.filter((tag) => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`#${escaped}(?!\\S)`).test(base);
  });
  if (missing.length === 0) return base;
  const suffix = missing.map((tag) => `#${tag}`).join(" ");
  return `${base}${base ? "\n\n" : ""}${suffix}`;
}

async function fillWechatChannelsText(page, frame, plan) {
  try {
    if (!isWechatChannelsVideoPlan(plan)) {
      await replaceWechatChannelsTitleText(frame, String(plan.title || "").slice(0, 22));
    }
    const editor = await waitForWechatChannelsDescriptionEditor(frame);
    if (!editor.found) {
      return step("body", STATUS.needsHuman, "WeChat Channels description editor not found.");
    }
    const body = String(plan.body || "");
    await replaceWechatChannelsEditorText(frame, body);
    const titleValue = await readWechatChannelsTitle(frame);
    const bodyValue = await readWechatChannelsEditorText(frame);
    const titleOk = isWechatChannelsVideoPlan(plan) || !plan.title || titleValue.includes(String(plan.title).slice(0, 12));
    const bodyOk = !body || textContainsContentFingerprint(bodyValue, body);
    if (!titleOk || !bodyOk) {
      return step("body", STATUS.needsHuman, "WeChat Channels title/body were targeted, but readback did not match the plan.", {
        ...redactedTextEvidence(titleValue, "title_readback"),
        ...redactedTextEvidence(bodyValue, "body_readback"),
        title_matched: titleOk,
        body_matched: bodyOk
      });
    }
    return step("body", STATUS.done, "WeChat Channels title/body filled in label-scoped fields.", {
      ...redactedTextEvidence(titleValue, "title_readback"),
      ...redactedTextEvidence(bodyValue, "body_readback"),
      title_matched: titleOk,
      body_matched: bodyOk
    });
  } catch (error) {
    return step("body", STATUS.needsHuman, `WeChat Channels text needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function replaceWechatChannelsTitleText(frame, value) {
  if (!value) return { found: true, text: "" };
  const result = await frame.evaluate(({ value, titlePlaceholder, titleLimitHint }) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const input = Array.from(document.querySelectorAll("input[type='text'], textarea, input")).find((node) => {
      const placeholder = node.getAttribute("placeholder") || "";
      return visible(node) && (placeholder.includes(titlePlaceholder) || placeholder.includes(titleLimitHint));
    });
    if (!input) return { found: false, text: "" };
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Process", bubbles: true }));
    input.blur();
    return { found: true, text: input.value || "" };
  }, {
    value,
    titlePlaceholder: WECHAT_CHANNELS_TEXT.titlePlaceholder,
    titleLimitHint: WECHAT_CHANNELS_TEXT.titleLimitHint
  }).catch((error) => ({ found: false, text: "", error: error.message }));
  await frame.page().waitForTimeout(400);
  return result;
}

async function waitForWechatChannelsDescriptionEditor(frame, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = { found: false };
  while (Date.now() < deadline) {
    last = await wechatChannelsDescriptionEditorInfo(frame);
    if (last.found) return last;
    await frame.page().waitForTimeout(400);
  }
  return last;
}

async function wechatChannelsDescriptionEditorInfo(frame) {
  return frame.evaluate((selectors) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const resolveTarget = (node) => {
      if (!node) return null;
      if (node.matches?.("input, textarea, [contenteditable]")) return node;
      return node.querySelector?.(".input-editor, [contenteditable], textarea, input") || node;
    };
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const target = resolveTarget(node);
        if (!visible(node) && !visible(target)) continue;
        const text = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
          ? target.value || ""
          : target.innerText || target.textContent || "";
        return {
          found: true,
          selector,
          tag: target.tagName,
          className: String(target.className || ""),
          contentEditable: target.getAttribute?.("contenteditable") || "",
          text
        };
      }
    }
    return { found: false };
  }, WECHAT_CHANNELS_DESCRIPTION_SELECTORS).catch((error) => ({ found: false, error: error.message }));
}

async function replaceWechatChannelsEditorText(frame, value) {
  const result = await frame.evaluate(({ selectors, value }) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const resolveTarget = (node) => {
      if (!node) return null;
      if (node.matches?.("input, textarea, [contenteditable]")) return node;
      return node.querySelector?.(".input-editor, [contenteditable], textarea, input") || node;
    };
    const fireInput = (element, text) => {
      try {
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      } catch {
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "Process", bubbles: true }));
    };
    let target = null;
    for (const selector of selectors) {
      const node = Array.from(document.querySelectorAll(selector)).find((candidate) => visible(candidate) || visible(resolveTarget(candidate)));
      target = resolveTarget(node);
      if (target) break;
    }
    if (!target) return { found: false, text: "" };
    target.scrollIntoView({ block: "center", inline: "center" });
    target.focus();
    const text = String(value || "");
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(target.constructor.prototype, "value")?.set
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(target, text);
      else target.value = text;
    } else {
      target.textContent = text;
    }
    fireInput(target, text);
    return {
      found: true,
      tag: target.tagName,
      className: String(target.className || ""),
      text: target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value || "" : target.innerText || target.textContent || ""
    };
  }, { selectors: WECHAT_CHANNELS_DESCRIPTION_SELECTORS, value: String(value || "") }).catch((error) => ({ found: false, text: "", error: error.message }));
  await frame.page().waitForTimeout(500);
  return result;
}

async function readWechatChannelsEditorText(frame) {
  const info = await wechatChannelsDescriptionEditorInfo(frame);
  return info.text || "";
}

async function readWechatChannelsTitle(frame) {
  return frame.evaluate(({ titlePlaceholder, titleLimitHint }) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const input = Array.from(document.querySelectorAll("input[type='text'], textarea, input")).find((node) => {
      const placeholder = node.getAttribute("placeholder") || "";
      return visible(node) && (placeholder.includes(titlePlaceholder) || placeholder.includes(titleLimitHint));
    });
    return input?.value || "";
  }, {
    titlePlaceholder: WECHAT_CHANNELS_TEXT.titlePlaceholder,
    titleLimitHint: WECHAT_CHANNELS_TEXT.titleLimitHint
  }).catch(() => "");
}

async function readWechatChannelsTopicEvidence(frame, tags) {
  return frame.evaluate((tags) => {
    const text = document.body?.innerText || "";
    const tokens = Array.from(document.querySelectorAll(".hl.topic, span.hl, [class*='topic']")).map((node) => (node.innerText || node.textContent || "").trim()).filter(Boolean);
    const normalizedTags = tags.map((tag) => String(tag || "").replace(/^#+/, "").trim()).filter(Boolean);
    const matchedTags = normalizedTags.filter((tag) => text.includes(tag) || tokens.some((token) => token.includes(tag)));
    return {
      token_count: tokens.length,
      token_lengths: tokens.map((token) => token.length),
      text_present: text.length > 0,
      text_length: text.length,
      text_line_count: text ? text.split(/\r\n|\r|\n/).length : 0,
      matched_tag_count: matchedTags.length,
      all_tags_matched: matchedTags.length === normalizedTags.length
    };
  }, tags).catch((error) => ({ token_count: 0, token_lengths: [], text_present: false, text_length: 0, text_line_count: 0, matched_tag_count: 0, all_tags_matched: false, error: error.message }));
}

async function selectWechatChannelsTopics(page, frame, tags) {
  if (!tags || tags.length === 0) return step("topics", STATUS.skipped, "No tags in plan.");
  const editor = await waitForWechatChannelsDescriptionEditor(frame, 5000);
  if (!editor.found) return step("topics", STATUS.needsHuman, "WeChat Channels description editor not found for topic insertion.");
  const current = await readWechatChannelsEditorText(frame);
  const next = appendPlainHashTags(current, tags);
  await replaceWechatChannelsEditorText(frame, next);
  await page.waitForTimeout(700);
  const evidence = await readWechatChannelsTopicEvidence(frame, tags);
  const normalizedTags = tags.map(normalizeXhsTag).filter(Boolean);
  const readback = await readWechatChannelsEditorText(frame);
  const readbackMatches = normalizedTags.filter((tag) => readback.includes(`#${tag}`)).length;
  const ok = evidence.all_tags_matched || readbackMatches === normalizedTags.length;
  return step("topics", ok ? STATUS.done : STATUS.needsHuman, ok ? "WeChat Channels topics inserted in description." : "WeChat Channels topics were targeted, but readback did not contain every tag.", {
    ...evidence,
    ...redactedTextEvidence(readback, "editor_readback"),
    readback_matched_tag_count: readbackMatches,
    requested_tag_count: normalizedTags.length
  });
}

async function selectWechatChannelsCollection(frame, collection) {
  if (!collection) return step("collection", STATUS.skipped, "No value in plan.");
  try {
    const opened = await clickWechatChannelsFormControl(frame, "\u6dfb\u52a0\u5230\u5408\u96c6", [".post-album-wrap", ".post-album-display-wrap"]);
    if (!opened) return step("collection", STATUS.needsHuman, "WeChat Channels collection dropdown trigger not found.");
    await frame.page().waitForTimeout(800);
    const option = frame.getByText(String(collection), { exact: true }).last();
    if ((await option.count().catch(() => 0)) === 0) {
      return step("collection", STATUS.needsHuman, `WeChat Channels collection dropdown opened, but option was not found: ${collection}`);
    }
    await option.click({ timeout: 5000, force: true });
    return step("collection", STATUS.done, `WeChat Channels collection selected: ${collection}`);
  } catch (error) {
    return step("collection", STATUS.needsHuman, `WeChat Channels collection needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function setWechatChannelsDeclaration(frame, declaration, plan) {
  if (!declaration || declaration.mode === "none") return step("declaration", STATUS.skipped, "No declaration requested.");
  try {
    const evidence = await frame.evaluate((label) => {
      const text = document.body?.innerText || "";
      const matches = Array.from(document.querySelectorAll("button, label, span, div")).filter((node) => {
        const nodeText = (node.innerText || node.textContent || "").trim();
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return nodeText.includes(label) && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }).map((node) => ({
        text_present: (node.innerText || node.textContent || "").trim().length > 0,
        text_length: (node.innerText || node.textContent || "").trim().length,
        tag: node.tagName,
        className: String(node.className || "")
      }));
      return { text_present: text.length > 0, text_length: text.length, text_line_count: text ? text.split(/\r\n|\r|\n/).length : 0, matches };
    }, WECHAT_CHANNELS_TEXT.original).catch(() => ({ text_present: false, text_length: 0, text_line_count: 0, matches: [] }));
    if (evidence.matches.length === 0) {
      return step(
        "declaration",
        isWechatChannelsVideoPlan(plan) && declaration.mode === "original" ? STATUS.needsHuman : STATUS.skipped,
        isWechatChannelsVideoPlan(plan) && declaration.mode === "original"
          ? `WeChat Channels ${plan.kind || "post"} declaration requested, but no visible original declaration control was found.`
          : `WeChat Channels ${plan.kind || "post"} surface has no visible original declaration control; skipped.`,
        evidence
      );
    }
    return step("declaration", STATUS.needsHuman, "WeChat Channels declaration control was detected but is not automated yet.", evidence);
  } catch (error) {
    return step("declaration", STATUS.needsHuman, `WeChat Channels declaration needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function setWechatChannelsMusic(frame, music) {
  const strategy = music?.strategy || "none";
  try {
    if (strategy === "none") {
      const opened = await clickWechatChannelsFormControl(frame, "\u97f3\u4e50", [".bgm-form-content-wrap", ".post-link-wrap", ".form-item-body"]);
      if (!opened) return step("music", STATUS.needsHuman, "WeChat Channels music selector not found.");
      await frame.page().waitForTimeout(800);
      const clicked = await clickWechatChannelsNoMusicOption(frame) || await clickWechatChannelsVisibleText(frame, WECHAT_CHANNELS_TEXT.noMusic);
      if (!clicked) {
        return step("music", STATUS.needsHuman, "WeChat Channels music menu opened, but 'no music' option was not found.");
      }
      await frame.page().waitForTimeout(800);
      const state = await readWechatChannelsFormControlText(frame, "\u97f3\u4e50", [".bgm-form-content-wrap", ".bgm-form-content", ".link-display-wrap", ".form-item-body"]);
      const noMusicSelected = state.includes(WECHAT_CHANNELS_TEXT.noMusic) || state.includes(WECHAT_CHANNELS_TEXT.selectMusic) || state.includes("\u9009\u62e9\u80cc\u666f\u97f3\u4e50") || state.trim() === "";
      return step("music", noMusicSelected ? STATUS.done : STATUS.needsHuman, "WeChat Channels music set to no music.", redactedTextEvidence(state, "state"));
    }
    if (strategy === "first_recommended") {
      const state = await readWechatChannelsFormControlText(frame, "\u97f3\u4e50", [".bgm-form-content-wrap", ".bgm-form-content", ".link-display-wrap", ".form-item-body"]);
      if (state && !state.includes(WECHAT_CHANNELS_TEXT.noMusic)) {
        return step("music", STATUS.done, "WeChat Channels music already selected.", redactedTextEvidence(state, "state"));
      }
      const opened = await clickWechatChannelsFormControl(frame, "\u97f3\u4e50", [".bgm-form-content-wrap", ".post-link-wrap", ".form-item-body"]);
      if (!opened) return step("music", STATUS.needsHuman, "WeChat Channels music selector not found.");
      await frame.page().waitForTimeout(900);
      const clicked = await clickWechatChannelsFirstRecommendedMusic(frame);
      if (!clicked) return step("music", STATUS.needsHuman, "WeChat Channels music menu opened, but first recommended music was not found.");
      await frame.page().waitForTimeout(1200);
      const selected = await readWechatChannelsFormControlText(frame, "\u97f3\u4e50", [".bgm-form-content-wrap", ".bgm-form-content", ".link-display-wrap", ".form-item-body"]);
      const ok = selected && !selected.includes(WECHAT_CHANNELS_TEXT.noMusic) && !selected.includes(WECHAT_CHANNELS_TEXT.selectMusic) && !selected.includes("\u9009\u62e9\u80cc\u666f\u97f3\u4e50");
      return step(ok ? "music" : "music", ok ? STATUS.done : STATUS.needsHuman, ok ? "WeChat Channels first recommended music selected." : "WeChat Channels first recommended music was clicked, but selected state was not verified.", {
        ...redactedTextEvidence(state, "state_before"),
        ...redactedTextEvidence(selected, "state")
      });
    }
    return step("music", STATUS.skipped, `Music strategy not requested for WeChat Channels: ${strategy}`);
  } catch (error) {
    return step("music", STATUS.needsHuman, `WeChat Channels music needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function clickWechatChannelsNoMusicOption(frame) {
  const handle = await frame.evaluateHandle(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return Array.from(document.querySelectorAll(".link-list-options .no-add-wrap .wordings, .no-add-wrap .wordings")).find((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return visible(node) && text === "\u4e0d\u6dfb\u52a0\u97f3\u4e50";
    }) || null;
  }).catch(() => null);
  const element = handle?.asElement?.() || null;
  if (!element) {
    await handle?.dispose?.().catch(() => {});
    return false;
  }
  await element.click({ timeout: 5000, force: true }).catch(() => {});
  await element.dispose().catch(() => {});
  await frame.page().waitForTimeout(500);
  return true;
}

async function clickWechatChannelsFirstRecommendedMusic(frame) {
  const handle = await frame.evaluateHandle(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const items = Array.from(document.querySelectorAll(".link-list-options .bgm-item-wrap, .bgm-item-wrap")).filter(visible);
    return items[0] || null;
  }).catch(() => null);
  const element = handle?.asElement?.() || null;
  if (!element) {
    await handle?.dispose?.().catch(() => {});
    return false;
  }
  await element.click({ timeout: 5000, force: true }).catch(() => {});
  await element.dispose().catch(() => {});
  return true;
}

async function setWechatChannelsActivity(frame, activity) {
  if (activity?.name || activity?.mode) {
    return step("activity", STATUS.needsHuman, "WeChat Channels activity selection is not automated yet.");
  }
  const state = await readWechatChannelsFormControlText(frame, "\u6d3b\u52a8", [".post-activity-wrap", ".activity-display-wrap", ".not-involve", ".form-item-body"]);
  return step(
    "activity",
    state.includes(WECHAT_CHANNELS_TEXT.noActivity) ? STATUS.done : STATUS.skipped,
    state.includes(WECHAT_CHANNELS_TEXT.noActivity)
      ? "WeChat Channels activity left as not participating."
      : "No activity requested and no visible activity default was found."
  );
}

async function readWechatChannelsFormControlText(frame, label, selectors) {
  return frame.evaluate(({ label, selectors }) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const labelNode = Array.from(document.querySelectorAll(".label, span, div")).find((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return text === label && visible(node);
    });
    const row = labelNode?.closest(".form-item, .post-time-wrap") || labelNode?.parentElement || null;
    if (!row) return "";
    for (const selector of selectors) {
      const target = Array.from(row.querySelectorAll(selector)).find(visible);
      if (target) return (target.innerText || target.textContent || "").trim();
    }
    return (row.innerText || row.textContent || "").trim();
  }, { label, selectors }).catch(() => "");
}

async function clickWechatChannelsScheduledRadio(frame) {
  const clickedByRow = await clickWechatChannelsFormControl(frame, "\u5b9a\u65f6\u53d1\u8868", [".weui-desktop-radio-group"]);
  if (clickedByRow) {
    const visibleLabel = frame.getByText(new RegExp(`^${WECHAT_CHANNELS_TEXT.scheduled}$`)).last();
    if ((await visibleLabel.count().catch(() => 0)) > 0) {
      await visibleLabel.click({ timeout: 5000, force: true }).catch(() => {});
      await frame.page().waitForTimeout(500);
      if ((await frame.locator(WECHAT_CHANNELS_SCHEDULE_SELECTOR).count().catch(() => 0)) > 0) return true;
    }
  }
  return frame.evaluate(() => {
    const radio = Array.from(document.querySelectorAll("input[type='radio']")).find((node) => node.value === "1");
    if (!radio) return false;
    const clickable = radio.closest("label") || radio.parentElement || radio;
    clickable.click();
    radio.checked = true;
    radio.dispatchEvent(new Event("input", { bubbles: true }));
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }).catch(() => false);
}

async function waitForWechatChannelsScheduleInput(frame, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await frame.evaluate(() => Array.from(document.querySelectorAll(".post-time-wrap input[type='text'], input")).filter((input) => {
      const placeholder = input.getAttribute("placeholder") || "";
      const inTimeRow = !!input.closest(".post-time-wrap");
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (inTimeRow || placeholder.includes("\u8bf7\u9009\u62e9\u53d1\u8868\u65f6\u95f4") || placeholder.includes("\u53d1\u8868\u65f6\u95f4"));
    }).length).catch(() => 0);
    if (count > 0) return true;
    await frame.page().waitForTimeout(400);
  }
  return false;
}

async function setWechatChannelsSchedule(frame, schedule) {
  if (!schedule || schedule.mode === "immediate") return step("schedule", STATUS.done, "Immediate publish selected or already default.");
  try {
    const publishAt = formatPlatformDateTime(schedule.publish_at);
    const opened = await clickWechatChannelsScheduledRadio(frame);
    if (!opened) return step("schedule", STATUS.needsHuman, "WeChat Channels scheduled publish radio not found.");
    const scheduleInputVisible = await waitForWechatChannelsScheduleInput(frame, 8000);
    if (!scheduleInputVisible) return step("schedule", STATUS.needsHuman, "WeChat Channels scheduled publish input did not appear after selecting scheduled publish.");
    const actual = await setWechatChannelsScheduleValue(frame, publishAt);
    if (actual && comparePlatformDateTime(actual, publishAt) >= 0) {
      return step("schedule", STATUS.done, `WeChat Channels scheduled publish selected: ${actual}.`);
    }
    return step("schedule", STATUS.needsHuman, `WeChat Channels schedule option selected, but datetime was not verified: ${publishAt}`);
  } catch (error) {
    return step("schedule", STATUS.needsHuman, `WeChat Channels schedule needs manual handling: ${error.message.split("\n")[0]}`);
  }
}

async function setWechatChannelsScheduleValue(frame, publishAt) {
  const input = await wechatChannelsScheduleInputElement(frame);
  if (input) {
    await input.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await input.click({ timeout: 5000, force: true }).catch(() => {});
    await frame.page().waitForTimeout(500);
    const pickerResult = await setWechatChannelsScheduleWithPicker(frame, publishAt);
    if (pickerResult.ok) {
      const picked = await waitForStableWechatChannelsScheduleValue(frame, 4500);
      await input.dispose().catch(() => {});
      if (picked) return picked;
    }
    await input.fill(publishAt, { timeout: 5000 }).catch(() => {});
    await input.press("Enter", { timeout: 3000 }).catch(() => {});
    await input.evaluate((node) => {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.blur();
    }).catch(() => {});
    await input.dispose().catch(() => {});
    const typed = await waitForStableWechatChannelsScheduleValue(frame, 4500);
    if (typed) return typed;
  }
  await frame.evaluate((publishAt) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const publishTimeLabel = Array.from(document.querySelectorAll(".post-time-wrap .label, .label, span, div")).find((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return text === "\u53d1\u8868\u65f6\u95f4" && visible(node);
    });
    const row = publishTimeLabel?.closest(".form-item") || document.querySelector(".post-time-wrap");
    const input = Array.from(row?.querySelectorAll("input.weui-desktop-form__input, input[type='text'], input") || []).find((input) => {
      const rect = input.getBoundingClientRect();
      return visible(input) && rect.left >= 0 && rect.top >= 0;
    });
    if (!input) return "";
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, publishAt);
    else input.value = publishAt;
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    input.blur();
    return input.value || "";
  }, publishAt).catch(() => "");
  return waitForStableWechatChannelsScheduleValue(frame, 4500);
}

async function setWechatChannelsScheduleWithPicker(frame, publishAt) {
  const match = String(publishAt || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return { ok: false, reason: "unsupported_datetime_format" };
  const [, year, month, day, hour, minute] = match;
  const dateElement = await wechatChannelsDatePickerElement(frame, year, month, day);
  if (!dateElement) return { ok: false, reason: "day_not_found" };
  await dateElement.click({ timeout: 5000, force: true }).catch(() => {});
  await dateElement.dispose().catch(() => {});
  await frame.page().waitForTimeout(500);
  const timeInput = await wechatChannelsPickerTimeInputElement(frame);
  if (timeInput) {
    await timeInput.fill(`${hour}:${minute}`, { timeout: 5000 }).catch(() => {});
    await timeInput.press("Enter", { timeout: 3000 }).catch(() => {});
    await timeInput.evaluate((node) => {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.blur();
    }).catch(() => {});
    await timeInput.dispose().catch(() => {});
    await frame.page().waitForTimeout(700);
    return { ok: true };
  }
  let hourClicked = await clickWechatChannelsTimePickerValue(frame, hour, 0);
  if (!hourClicked.ok) {
    await frame.page().mouse.wheel(0, 420).catch(() => {});
    await frame.page().waitForTimeout(500);
    hourClicked = await clickWechatChannelsTimePickerValue(frame, hour, 0);
  }
  if (!hourClicked.ok) return { ok: false, reason: "hour_not_found", details: hourClicked };
  await frame.page().waitForTimeout(300);
  let minuteClicked = await clickWechatChannelsTimePickerValue(frame, minute, 1);
  if (!minuteClicked.ok) {
    await frame.page().mouse.wheel(0, 260).catch(() => {});
    await frame.page().waitForTimeout(500);
    minuteClicked = await clickWechatChannelsTimePickerValue(frame, minute, 1);
  }
  if (!minuteClicked.ok) return { ok: false, reason: "minute_not_found", details: minuteClicked };
  await frame.page().waitForTimeout(700);
  await frame.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
  return { ok: true };
}

async function wechatChannelsPickerTimeInputElement(frame) {
  const handle = await frame.evaluateHandle(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return Array.from(document.querySelectorAll("input")).find((input) => {
      const value = input.value || "";
      return visible(input) && /^\d{2}:\d{2}$/.test(value);
    }) || null;
  }).catch(() => null);
  const element = handle?.asElement?.() || null;
  if (!element) await handle?.dispose?.().catch(() => {});
  return element;
}

async function wechatChannelsDatePickerElement(frame, year, month, day) {
  const handle = await frame.evaluateHandle(({ year, month, day }) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const area = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const publishTimeLabel = Array.from(document.querySelectorAll(".post-time-wrap .label, .label, span, div")).find((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return text === "\u53d1\u8868\u65f6\u95f4" && visible(node);
    });
    const row = publishTimeLabel?.closest(".form-item") || document.querySelector(".post-time-wrap");
    const root = row?.querySelector(".form-item-body") || row || document.body;
    const candidates = Array.from(root.querySelectorAll("a, td, li, span, div")).filter((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      const className = String(node.className || "");
      return visible(node)
        && text === String(Number(day))
        && !node.closest(".weui-desktop-picker__time__panel")
        && !/disabled|faded/.test(className);
    });
    const node = candidates.sort((a, b) => area(a) - area(b))[0];
    return node?.closest("a, button, td, li") || node || null;
  }, { year, month, day }).catch(() => null);
  const element = handle?.asElement?.() || null;
  if (!element) await handle?.dispose?.().catch(() => {});
  return element;
}

async function clickWechatChannelsTimePickerValue(frame, value, panelIndex) {
  const handle = await frame.evaluateHandle(({ value, panelIndex }) => {
    const panels = Array.from(document.querySelectorAll(".weui-desktop-picker__time__panel")).filter((panel) => {
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const panel = panels[panelIndex];
    if (!panel) return null;
    const items = Array.from(panel.querySelectorAll("li")).filter((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      const className = String(node.className || "");
      return text === value && !className.includes("disabled");
    });
    const item = items[0];
    return item || null;
  }, { value, panelIndex }).catch(() => null);
  const element = handle?.asElement?.() || null;
  if (!element) {
    await handle?.dispose?.().catch(() => {});
    return { ok: false, reason: "value_not_found" };
  }
  await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await element.click({ timeout: 5000, force: true }).catch(() => {});
  await element.dispose().catch(() => {});
  return { ok: true, value };
}

async function wechatChannelsScheduleInputElement(frame) {
  const handle = await frame.evaluateHandle(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const publishTimeLabel = Array.from(document.querySelectorAll(".post-time-wrap .label, .label, span, div")).find((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return text === "\u53d1\u8868\u65f6\u95f4" && visible(node);
    });
    const row = publishTimeLabel?.closest(".form-item") || document.querySelector(".post-time-wrap");
    return Array.from(row?.querySelectorAll("input.weui-desktop-form__input, input[type='text'], input") || []).find(visible) || null;
  }).catch(() => null);
  const element = handle?.asElement?.() || null;
  if (!element) await handle?.dispose?.().catch(() => {});
  return element;
}

async function readWechatChannelsScheduleValue(frame) {
  return frame.evaluate(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const publishTimeLabel = Array.from(document.querySelectorAll(".post-time-wrap .label, .label, span, div")).find((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return text === "\u53d1\u8868\u65f6\u95f4" && visible(node);
    });
    const row = publishTimeLabel?.closest(".form-item") || document.querySelector(".post-time-wrap");
    const inputs = Array.from(row?.querySelectorAll("input.weui-desktop-form__input, input[type='text'], input") || []).filter(visible);
    return inputs.map((input) => input.value || "").find((value) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(value)) || "";
  }).catch(() => "");
}

async function waitForStableWechatChannelsScheduleValue(frame, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    const value = await readWechatChannelsScheduleValue(frame);
    if (value && value === previous) {
      stableCount += 1;
      if (stableCount >= 2) return value;
    } else {
      previous = value;
      stableCount = value ? 1 : 0;
    }
    await frame.page().waitForTimeout(700);
  }
  return previous || await readWechatChannelsScheduleValue(frame);
}

async function verifyWechatChannelsPublishBoundary(frame) {
  try {
    const buttons = await frame.evaluate((publishText) => Array.from(document.querySelectorAll("button, [role='button'], .weui-desktop-btn, .weui-desktop-btn_primary")).map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        text: (node.innerText || node.textContent || "").trim(),
        tag: node.tagName,
        role: node.getAttribute("role") || "",
        className: String(node.className || ""),
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      };
    }).filter((item) => item.visible && item.text === publishText), WECHAT_CHANNELS_TEXT.publish).catch(() => []);
    const count = buttons.filter(isWechatChannelsPublishButton).length;
    return step(
      "publish_boundary",
      count > 0 ? STATUS.done : STATUS.needsHuman,
      `WeChat Channels final publish button count=${count}; not clicked.`,
      { button_count: buttons.length, matching_publish_button_count: count }
    );
  } catch {
    return step("publish_boundary", STATUS.needsHuman, "WeChat Channels final publish boundary could not be verified; not clicked.");
  }
}

async function clickWechatChannelsFormControl(frame, label, selectors) {
  return frame.evaluate(({ label, selectors }) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const labelNode = Array.from(document.querySelectorAll(".label, span, div")).find((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return text === label && visible(node);
    });
    if (!labelNode) return false;
    const row = labelNode.closest(".form-item, .post-time-wrap") || labelNode.parentElement;
    if (!row) return false;
    for (const selector of selectors) {
      const target = Array.from(row.querySelectorAll(selector)).find(visible);
      if (target) {
        target.scrollIntoView({ block: "center", inline: "center" });
        target.click();
        return true;
      }
    }
    return false;
  }, { label, selectors }).catch(() => false);
}

async function clickWechatChannelsVisibleText(frame, text) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const clicked = await frame.evaluate((text) => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const nodes = Array.from(document.querySelectorAll("button, div, span, li"));
      const area = (node) => {
        const rect = node.getBoundingClientRect();
        return rect.width * rect.height;
      };
      const exact = nodes
        .filter((node) => (node.innerText || node.textContent || "").trim() === text && visible(node))
        .sort((a, b) => area(a) - area(b))[0];
      const partial = nodes
        .filter((node) => (node.innerText || node.textContent || "").includes(text) && visible(node))
        .sort((a, b) => ((a.innerText || a.textContent || "").length - (b.innerText || b.textContent || "").length) || (area(a) - area(b)))[0];
      const node = exact || partial;
      if (!node) return false;
      node.scrollIntoView({ block: "center", inline: "center" });
      node.click();
      return true;
    }, text).catch(() => false);
    if (clicked) return true;
    await frame.page().waitForTimeout(400);
  }
  return false;
}

async function clickWechatFrameFirstVisible(frame, selectors) {
  for (const selector of selectors) {
    const clicked = await frame.evaluate((selector) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const node = nodes.find((item) => {
        const rect = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      if (!node) return false;
      node.scrollIntoView({ block: "center", inline: "center" });
      node.click();
      return true;
    }, selector).catch(() => false);
    if (clicked) return true;
  }
  return false;
}

export async function inspectWechatChannelsCollections(page, plan, logDir) {
  const steps = [];
  const sourceArtifacts = {};
  const identity = platformIdentityStep(plan, "wechat_channels");
  if (identity) return collectionInspectResult([identity], [], sourceArtifacts);
  try {
    steps.push(await openWechatChannelsComposer(page, plan));
    if (steps[steps.length - 1].status === STATUS.done) {
      const frame = await wechatContentFrame(page);
      const opened = await clickWechatChannelsFormControl(frame, "\u6dfb\u52a0\u5230\u5408\u96c6", [".post-album-wrap", ".post-album-display-wrap"]);
      steps.push(step("open_collection_dropdown", opened ? STATUS.done : STATUS.needsHuman, opened ? "WeChat Channels collection dropdown opened." : "WeChat Channels collection dropdown trigger not found."));
      const values = opened ? await readVisibleFrameCollectionOptionTexts(frame, [
        ".weui-desktop-popover:visible li",
        ".weui-desktop-popover:visible [role='option']",
        ".weui-desktop-dialog:visible li",
        "[role='listbox']:visible [role='option']"
      ]) : [];
      const collections = normalizeCollectionNames(values);
      steps.push(step("collections", collections.length > 0 ? STATUS.done : STATUS.needsHuman, collections.length > 0 ? `Discovered ${collections.length} WeChat Channels collection(s).` : "WeChat Channels collection list was not reliably discoverable; capture artifacts and choose manually.", {
        collection_count: collections.length,
        collection_name_lengths: collections.map((item) => item.length)
      }));
      Object.assign(sourceArtifacts, await saveArtifacts(page, logDir, "collections"));
      return collectionInspectResult(steps, collections, sourceArtifacts);
    }
    Object.assign(sourceArtifacts, await saveArtifacts(page, logDir, "collections"));
    steps.push(step("collections", STATUS.needsHuman, "WeChat Channels collection discovery needs a ready composer.", { collections: [] }));
    return collectionInspectResult(steps, [], sourceArtifacts);
  } catch (error) {
    steps.push(step("inspect_collections", STATUS.needsHuman, `WeChat Channels collection inspection needs manual handling: ${error.message.split("\n")[0]}`));
    if (page) Object.assign(sourceArtifacts, await saveArtifacts(page, logDir, "collections-failure").catch(() => ({})));
    return collectionInspectResult(steps, [], sourceArtifacts);
  }
}
