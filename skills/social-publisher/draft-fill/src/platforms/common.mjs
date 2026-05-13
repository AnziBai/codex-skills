import { STATUS, getUploadAssets, step } from "../utils.mjs";

export function normalizeCollectionNames(values) {
  const chrome = [
    "不选择合集",
    "选择合集",
    "加入合集",
    "添加到合集",
    "合集",
    "新建合集",
    "创建合集",
    "管理合集",
    "搜索合集",
    "请输入合集名称",
    "取消",
    "确定",
    "确认",
    "完成",
    "保存",
    "全部",
    "暂无数据",
    "暂无合集",
    "加载中",
    "选择",
    "add to collection",
    "select collection",
    "collection",
    "collections",
    "create collection",
    "new collection",
    "manage collections",
    "search",
    "cancel",
    "confirm",
    "ok",
    "done",
    "save",
    "loading",
    "no data"
  ];
  const seen = new Set();
  const normalized = [];
  for (const value of values || []) {
    const name = String(value || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (chrome.some((item) => lower === item.toLowerCase())) continue;
    if (/^[+＋]?$/.test(name)) continue;
    if (/^\d+\s*(个|items?)?$/i.test(name)) continue;
    if (/^(请选择|搜索|创建|新建|管理|取消|确定|确认|完成|保存|loading|select|search|create|cancel|confirm|done|save)\b/i.test(name)) continue;
    if (name.length > 80) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

export async function expectText(page, name, pattern) {
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

export function shouldStopEarly(steps) {
  const last = steps[steps.length - 1];
  return last && last.name === "page_signature" && last.status !== STATUS.done;
}

export function platformIdentityStep(plan, expectedPlatform) {
  const actualPlatform = plan?.platform || "";
  if (actualPlatform === expectedPlatform) return null;
  return step(
    "platform_identity",
    STATUS.failed,
    `Adapter platform mismatch: expected ${expectedPlatform}, got ${actualPlatform || "unknown"}. Refusing to run platform selectors.`,
    {
      expected_platform: expectedPlatform,
      actual_platform: actualPlatform || null,
      matched: false
    }
  );
}

export function redactedTextEvidence(value, prefix = "text") {
  const text = String(value || "");
  return {
    [`${prefix}_present`]: text.length > 0,
    [`${prefix}_length`]: text.length,
    [`${prefix}_line_count`]: text.length > 0 ? text.split(/\r\n|\r|\n/).length : 0
  };
}

export async function uploadFiles(page, plan, selector, name) {
  const files = getUploadAssets(plan);
  if (files.length === 0) return step(name, STATUS.skipped, "No upload assets in plan.");
  try {
    const input = page.locator(selector).first();
    await input.waitFor({ state: "attached", timeout: 15000 });
    await input.setInputFiles(files);
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

export async function verifyVisibleUploadedImages(page, expectedCount, platform) {
  const deadline = Date.now() + 30000;
  let lastText = "";
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const visibleCount = extractVisibleUploadedImageCount(text);
    if (visibleCount !== null) {
      const marker = visibleImageCountMarker(text) || `${visibleCount} image(s)`;
      if (visibleCount === expectedCount) {
        return {
          status: STATUS.done,
          message: `${platform} page confirms ${expectedCount} uploaded image(s).`,
          details: { visible_count: visibleCount, visible_marker: marker }
        };
      }
      return {
        status: STATUS.needsHuman,
        message: `${platform} page shows ${visibleCount} uploaded image(s), expected ${expectedCount}.`,
        details: { visible_count: visibleCount, visible_marker: marker }
      };
    }
    if (platform === "xiaohongshu") {
      const previewCount = await countXhsVisibleImagePreviews(page);
      if (previewCount !== null) {
        if (previewCount === expectedCount) {
          return {
            status: STATUS.done,
            message: `Xiaohongshu page shows ${expectedCount} image preview(s).`,
            details: { visible_count: previewCount, visible_marker: "image-preview" }
          };
        }
        return {
          status: STATUS.needsHuman,
          message: `Xiaohongshu page shows ${previewCount} image preview(s), expected ${expectedCount}.`,
          details: { visible_count: previewCount, visible_marker: "image-preview" }
        };
      }
    }
    lastText = text;
    await page.waitForTimeout(1000);
  }
  return {
    status: STATUS.needsHuman,
    message: `${platform} upload count was not visible after upload; expected ${expectedCount} image(s).`,
    details: { visible_count: 0, visible_marker: "", ...redactedTextEvidence(lastText) }
  };
}

async function countXhsVisibleImagePreviews(page) {
  const count = await page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const cards = Array.from(document.querySelectorAll(".image-preview")).filter(isVisible);
    const uniquePreviewSources = new Set();
    for (const image of document.querySelectorAll(".preivew-image, .preview-image")) {
      if (!isVisible(image)) continue;
      const src = image.currentSrc || image.getAttribute("src") || image.style.backgroundImage || "";
      if (src) uniquePreviewSources.add(src);
    }
    return Math.max(cards.length, uniquePreviewSources.size);
  }).catch(() => 0);
  return count > 0 ? count : null;
}

export function extractVisibleUploadedImageCount(text) {
  const value = String(text || "");
  const patterns = [
    /已添加\s*(\d+)\s*张图片/,
    /共\s*(\d+)\s*张图片/,
    /已上传\s*(\d+)\s*张图片/,
    /(\d+)\s*\/\s*\d+\s*张/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function visibleImageCountMarker(text) {
  const value = String(text || "");
  return value.match(/已添加\s*\d+\s*张图片|共\s*\d+\s*张图片|已上传\s*\d+\s*张图片|\d+\s*\/\s*\d+\s*张/)?.[0] || "";
}

export function textContainsPlainTags(text, tags) {
  const value = String(text || "");
  return (tags || []).some((rawTag) => {
    const tag = normalizeXhsTag(rawTag);
    if (!tag) return false;
    return new RegExp(`#\\s*${escapeRegExp(tag)}(?=\\s|$|[，。！？,.!?])`, "u").test(value);
  });
}

export function textContainsContentFingerprint(text, expected) {
  const fingerprint = normalizeReadbackText(expected);
  if (!fingerprint) return true;
  const haystack = normalizeReadbackText(text);
  const prefixLength = Math.min(fingerprint.length, Math.max(8, Math.min(20, fingerprint.length)));
  return haystack.includes(fingerprint.slice(0, prefixLength));
}

function normalizeReadbackText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?;:*|#]/g, "");
}

export async function waitForUploadProgress(page) {
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

export async function fillFirst(page, name, selectors, value) {
  if (!value) return step(name, STATUS.skipped, "No value in plan.");
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) === 0) continue;
      await locator.waitFor({ state: "visible", timeout: 3000 });
      await locator.fill(value, { timeout: 10000 });
      await page.waitForTimeout(300);
      const actual = await readLocatorValue(locator);
      if (!textContainsContentFingerprint(actual, value)) {
        return step(name, STATUS.needsHuman, `${name} field did not retain expected text after filling.`);
      }
      return step(name, STATUS.done, `${name} filled using ${selector}.`);
    } catch {
      // Try the next selector.
    }
  }
  return step(name, STATUS.needsHuman, `No stable editable field found for ${name}.`);
}

export async function readLocatorValue(locator) {
  const inputValue = await locator.inputValue({ timeout: 1500 }).catch(() => null);
  if (inputValue !== null && inputValue !== undefined) return String(inputValue);
  return String(await locator.textContent({ timeout: 1500 }).catch(() => "") || "");
}

export function normalizeXhsTag(value) {
  return String(value || "").replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "").trim();
}

export function collectionInspectResult(steps, collections, sourceArtifacts) {
  return {
    status: overallCollectionInspectStatus(steps),
    collections,
    steps,
    source_artifacts: sourceArtifacts
  };
}

function overallCollectionInspectStatus(steps) {
  if (steps.some((item) => item.status === STATUS.failed)) return STATUS.failed;
  if (steps.some((item) => item.status === STATUS.needsHuman)) return STATUS.needsHuman;
  return STATUS.done;
}

export async function readVisibleCollectionOptionTexts(page, selectors) {
  const values = [];
  for (const selector of selectors) {
    const texts = await page.locator(selector).allInnerTexts().catch(() => []);
    values.push(...texts);
  }
  return values.flatMap(splitCollectionText);
}

export async function readVisibleFrameCollectionOptionTexts(frame, selectors) {
  const values = [];
  for (const selector of selectors) {
    const texts = await frame.locator(selector).allInnerTexts().catch(() => []);
    values.push(...texts);
  }
  return values.flatMap(splitCollectionText);
}

function splitCollectionText(value) {
  return String(value || "").split(/\r?\n| {2,}/).map((item) => item.trim()).filter(Boolean);
}

export function formatPlatformDateTime(value) {
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

export function comparePlatformDateTime(actual, expected) {
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

export async function verifyPublishBoundary(page) {
  try {
    const publishButtons = await page.getByRole("button", { name: /发布|提交|确认发布/ }).count();
    return step("publish_boundary", STATUS.done, `Final publish button count=${publishButtons}; not clicked.`);
  } catch {
    return step("publish_boundary", STATUS.done, "Final publish boundary preserved; not clicked.");
  }
}

export async function dismissKnownOverlays(page) {
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

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
