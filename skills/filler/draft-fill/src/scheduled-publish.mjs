import zlib from "node:zlib";

import { STATUS, step } from "./utils.mjs";

const SAFE_SCHEDULED_CONFIRMATION_PATTERN = /^(定时发布|确认定时发布|确认并定时发布|定时发表|确认定时发表)$/;
const SUCCESS_TEXT_PATTERN = /(定时发布成功|发布成功|提交成功|已定时|已预约|发布任务已创建|操作成功)/;
const FAILURE_TEXT_PATTERN = /(发布失败|提交失败|定时发布失败|验证码|风险|异常|请稍后|频繁|失败原因)/;

export function evaluateScheduledPublishGate({ plan, steps, confirmScheduledPublish }) {
  const items = Array.isArray(steps) ? steps : [];
  const schedule = plan?.schedule || {};
  const scheduled = schedule.mode && schedule.mode !== "immediate";
  const requestedAt = schedule.publish_at || null;
  const scheduleStep = lastStep(items, "schedule");
  const publishBoundary = lastStep(items, "publish_boundary");
  const scheduleActualAt = readScheduleActualAt(scheduleStep);
  const details = {
    confirm_scheduled_publish: !!confirmScheduledPublish,
    scheduled: !!scheduled,
    schedule_requested_at: requestedAt,
    schedule_actual_at: scheduleActualAt
  };

  if (!scheduled) {
    return blocked(
      confirmScheduledPublish ? STATUS.needsHuman : STATUS.skipped,
      "not_scheduled",
      confirmScheduledPublish
        ? "ConfirmScheduledPublish was provided, but the plan is not scheduled. Refusing to click any publish button."
        : "Plan is not scheduled; scheduled publish confirmation is not applicable.",
      details
    );
  }

  if (!confirmScheduledPublish) {
    return blocked(
      STATUS.skipped,
      "confirm_scheduled_publish_not_enabled",
      "Scheduled publish confirmation was not explicitly enabled; stopped at the publish boundary.",
      details
    );
  }

  const futureCheck = isFutureDateTime(requestedAt);
  if (!futureCheck.ok) {
    return blocked(STATUS.needsHuman, futureCheck.reason_code, futureCheck.message, details);
  }

  if (!scheduleStep || scheduleStep.status !== STATUS.done || !scheduleActualAt) {
    return blocked(
      STATUS.needsHuman,
      "schedule_not_verified",
      "Scheduled publish time was not verified by page readback; refusing to confirm.",
      details
    );
  }

  if (!publishBoundary || publishBoundary.status !== STATUS.done) {
    return blocked(
      STATUS.needsHuman,
      "publish_boundary_not_verified",
      "Final publish boundary was not verified; refusing to confirm scheduled publish.",
      details
    );
  }

  const criticalMissing = missingCriticalSteps(plan, items);
  if (criticalMissing.length > 0) {
    return blocked(
      STATUS.needsHuman,
      "critical_step_missing",
      `Critical draft-fill step(s) were not recorded: ${criticalMissing.join(", ")}.`,
      { ...details, critical_steps: criticalMissing }
    );
  }

  const blockedStep = items.find((item) => [STATUS.failed, STATUS.needsHuman, STATUS.retrying].includes(item.status));
  if (blockedStep) {
    return blocked(
      STATUS.needsHuman,
      "critical_step_not_done",
      `Step ${blockedStep.name || "unknown"} is ${blockedStep.status}; refusing to confirm scheduled publish.`,
      { ...details, blocked_step: blockedStep.name || null, blocked_status: blockedStep.status || null }
    );
  }

  return {
    allowed: true,
    status: STATUS.done,
    reason_code: "scheduled_publish_confirmation_allowed",
    message: "All scheduled publish confirmation gates passed.",
    details
  };
}

export async function maybeConfirmScheduledPublish({
  page,
  plan,
  steps,
  confirmScheduledPublish,
  manualConfirmationTimeoutMs = 15 * 60 * 1000,
  manualConfirmationPollMs = 1000
}) {
  const gate = evaluateScheduledPublishGate({ plan, steps, confirmScheduledPublish });
  if (!gate.allowed) {
    if (shouldUseManualHandoffDespiteGate(plan, gate, confirmScheduledPublish, steps)) {
      return await waitForHumanScheduledPublishReturn({
        page,
        gate: relaxedManualHandoffGate(plan, gate, steps),
        button: {
          count: 0,
          strategy: "operator_required",
          diagnostics: {
            reason_code: `${plan.platform}_operator_completes_blocked_steps_and_confirms_scheduled_publish`,
            original_gate_reason_code: gate.reason_code,
            blocked_step: gate.details?.blocked_step || null,
            critical_steps: gate.details?.critical_steps || null
          }
        },
        timeoutMs: manualConfirmationTimeoutMs,
        pollMs: manualConfirmationPollMs
      });
    }
    return step("scheduled_publish_confirmation", gate.status, gate.message, {
      ...gate.details,
      reason_code: gate.reason_code,
      click_count: 0
    });
  }

  if (isOperatorScheduledPublishPlatform(plan?.platform)) {
    return await waitForHumanScheduledPublishReturn({
      page,
      gate,
      button: {
        count: 0,
        strategy: "operator_required",
        diagnostics: { reason_code: `${plan.platform}_operator_confirms_scheduled_publish` }
      },
      timeoutMs: manualConfirmationTimeoutMs,
      pollMs: manualConfirmationPollMs
    });
  }

  const button = await resolveScheduledPublishButton(page, plan);
  if (button.count !== 1) {
    if (plan?.platform === "xiaohongshu") {
      return await waitForHumanScheduledPublishReturn({
        page,
        gate,
        button,
        timeoutMs: manualConfirmationTimeoutMs,
        pollMs: manualConfirmationPollMs
      });
    }
    return step(
      "scheduled_publish_confirmation",
      STATUS.needsHuman,
      `Scheduled publish confirmation button was not uniquely identifiable; found ${button.count}.`,
      {
        ...gate.details,
        reason_code: "scheduled_confirmation_button_not_unique",
        button_count: button.count,
        button_strategy: button.strategy || null,
        button_locator_strategy: button.locator_strategy || null,
        button_point: button.point || null,
        diagnostics: button.diagnostics || null,
        click_count: 0
      }
    );
  }

  const beforeClick = await readPostClickSnapshot(page);
  try {
    if (button.locator) {
      await button.locator.click({ timeout: 5000, force: true });
    } else {
      await page.mouse.click(button.point.x, button.point.y);
    }
  } catch (error) {
    return step("scheduled_publish_confirmation", STATUS.needsHuman, "Scheduled publish confirmation click failed before the platform accepted it.", {
      ...gate.details,
      reason_code: "scheduled_confirmation_click_failed",
      button_count: button.count,
      button_strategy: button.strategy || null,
      button_locator_strategy: button.locator_strategy || null,
      button_point: button.point || null,
      diagnostics: { ...(button.diagnostics || {}), error: String(error && error.message ? error.message : error).split("\n")[0] },
      click_count: 0
    });
  }

  const postClickOutcome = await verifyScheduledPublishPostClick(page, beforeClick);
  const details = {
    ...gate.details,
    button_count: button.count,
    button_strategy: button.strategy || null,
    button_locator_strategy: button.locator_strategy || null,
    button_point: button.point || null,
    diagnostics: button.diagnostics || null,
    click_count: 1,
    post_click_outcome: postClickOutcome
  };

  if (!postClickOutcome.ok) {
    return step(
      "scheduled_publish_confirmation",
      STATUS.needsHuman,
      "Scheduled publish was clicked, but post-click success was not verified.",
      {
        ...details,
        reason_code: postClickOutcome.reason_code || "post_click_not_verified"
      }
    );
  }

  return step(
    "scheduled_publish_confirmation",
    STATUS.done,
    "Scheduled publish confirmation clicked and verified after explicit runtime authorization.",
    {
      ...details,
      reason_code: "scheduled_publish_confirmed"
    }
  );
}

function isOperatorScheduledPublishPlatform(platform) {
  return ["wechat_channels", "douyin"].includes(platform);
}

function shouldUseManualHandoffDespiteGate(plan, gate, confirmScheduledPublish, steps) {
  if (!isOperatorScheduledPublishPlatform(plan?.platform) || !confirmScheduledPublish || !gate || gate.allowed) return false;
  if (!gate.details?.scheduled) return false;
  const items = Array.isArray(steps) ? steps : [];
  const publishBoundary = lastStep(items, "publish_boundary");
  if (!publishBoundary || publishBoundary.status !== STATUS.done) return false;
  const allowedManualStepNames = new Set(plan.platform === "wechat_channels" ? ["collection", "schedule"] : ["collection"]);
  const disallowedBlockingStep = items.find((item) =>
    [STATUS.failed, STATUS.retrying].includes(item?.status)
    || (item?.status === STATUS.needsHuman && !allowedManualStepNames.has(item?.name))
  );
  if (disallowedBlockingStep) return false;
  if (gate.reason_code === "critical_step_not_done") {
    return allowedManualStepNames.has(gate.details?.blocked_step);
  }
  if (gate.reason_code === "critical_step_missing") {
    const missing = Array.isArray(gate.details?.critical_steps) ? gate.details.critical_steps : [];
    return missing.length > 0 && missing.every((name) => allowedManualStepNames.has(name));
  }
  if (plan.platform === "wechat_channels" && gate.reason_code === "schedule_not_verified") {
    return lastStep(items, "schedule")?.status === STATUS.needsHuman;
  }
  return false;
}

function relaxedManualHandoffGate(plan, gate, steps) {
  const allowedManualStepNames = new Set(plan.platform === "wechat_channels" ? ["collection", "schedule"] : ["collection"]);
  const acceptedSteps = new Set();
  if (gate.reason_code === "critical_step_not_done" && gate.details?.blocked_step) {
    acceptedSteps.add(gate.details.blocked_step);
  }
  if (gate.reason_code === "critical_step_missing") {
    for (const name of Array.isArray(gate.details?.critical_steps) ? gate.details.critical_steps : []) acceptedSteps.add(name);
  }
  if (plan.platform === "wechat_channels" && gate.reason_code === "schedule_not_verified") acceptedSteps.add("schedule");
  for (const item of Array.isArray(steps) ? steps : []) {
    if (item?.status === STATUS.needsHuman && allowedManualStepNames.has(item?.name)) acceptedSteps.add(item.name);
  }
  return {
    allowed: true,
    status: STATUS.done,
    reason_code: `${plan.platform}_manual_handoff_allowed`,
    message: `${plan.platform} remaining manual step(s) will be completed or accepted by the human operator before scheduled publish confirmation.`,
    details: {
      ...gate.details,
      original_gate_reason_code: gate.reason_code,
      original_gate_message: gate.message,
      operator_accepted_blocked_steps: [...acceptedSteps],
      manual_handoff_reason_code: `${plan.platform}_operator_confirms_remaining_steps`
    }
  };
}

export async function resolveScheduledPublishButton(page, plan) {
  const roleButton = await locateRoleButton(page);
  if (roleButton) return roleButton;

  const visualTextButton = await locateVisualTextButton(page);
  if (visualTextButton) return visualTextButton;

  const xhsButton = plan?.platform === "xiaohongshu" ? await locateXhsPublishButton(page) : null;
  if (xhsButton) return xhsButton;

  const redTextButton = await locateRedTextTarget(page);
  if (redTextButton) return redTextButton;

  const screenshotButton = plan?.platform === "xiaohongshu" ? await locateXhsScreenshotButton(page) : null;
  if (screenshotButton) return screenshotButton;

  return {
    count: 0,
    strategy: "none",
    diagnostics: {
      role_count: await countRoleButtons(page),
      visual_button_count: await countVisualTextButtons(page),
      xhs_button_count: plan?.platform === "xiaohongshu" ? await countXhsPublishButtons(page) : null
    }
  };
}

async function locateRoleButton(page) {
  const buttons = page.getByRole("button", { name: SAFE_SCHEDULED_CONFIRMATION_PATTERN });
  const count = await buttons.count().catch(() => 0);
  if (count > 1) {
    return {
      count,
      strategy: "dom",
      locator_strategy: "role_button",
      diagnostics: { ambiguous_role_button_count: count }
    };
  }
  if (count !== 1) return null;
  return {
    count: 1,
    locator: buttons.first(),
    strategy: "dom",
    locator_strategy: "role_button"
  };
}

async function countRoleButtons(page) {
  return page.getByRole("button", { name: SAFE_SCHEDULED_CONFIRMATION_PATTERN }).count().catch(() => 0);
}

async function locateVisualTextButton(page) {
  const visualButtons = page.locator("button, [role='button'], .d-button, .el-button, [class*='button']");
  const matches = await visualButtons.evaluateAll((elements, source) => {
    const pattern = new RegExp(source);
    return elements.map((element, index) => {
      const text = String(element.textContent || "").replace(/\s+/g, "");
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible = rect.width > 0
        && rect.height > 0
        && style.visibility !== "hidden"
        && style.display !== "none"
        && !element.hasAttribute("disabled")
        && element.getAttribute("aria-disabled") !== "true";
      return { index, text, visible };
    }).filter((item) => item.visible && pattern.test(item.text));
  }, SAFE_SCHEDULED_CONFIRMATION_PATTERN.source).catch(() => []);

  const indexes = [...new Set(matches.map((item) => item.index))];
  if (indexes.length !== 1) return null;
  return {
    count: 1,
    locator: visualButtons.nth(indexes[0]),
    strategy: "dom",
    locator_strategy: "visual_button_text"
  };
}

async function countVisualTextButtons(page) {
  const visualButtons = page.locator("button, [role='button'], .d-button, .el-button, [class*='button']");
  const matches = await visualButtons.evaluateAll((elements, source) => {
    const pattern = new RegExp(source);
    return elements.filter((element) => pattern.test(String(element.textContent || "").replace(/\s+/g, ""))).length;
  }, SAFE_SCHEDULED_CONFIRMATION_PATTERN.source).catch(() => 0);
  return matches;
}

async function locateXhsPublishButton(page) {
  const cssButton = await locateXhsCssPublishButton(page);
  if (cssButton) return cssButton;

  const xpathButton = await locateXhsXPathPublishButton(page);
  if (xpathButton) return xpathButton;

  const hostPoint = await page.evaluate(() => {
    const host = document.querySelector("#web xhs-publish-btn, xhs-publish-btn");
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const style = window.getComputedStyle(host);
    const visible = rect.width > 40
      && rect.height > 20
      && rect.width <= 420
      && rect.height <= 100
      && style.visibility !== "hidden"
      && style.display !== "none";
    if (!visible) return null;
    return {
      x: rect.left + rect.width * 0.75,
      y: rect.top + rect.height / 2,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }).catch(() => null);

  if (!hostPoint || !Number.isFinite(hostPoint.x) || !Number.isFinite(hostPoint.y)) return null;
  return {
    count: 1,
    point: roundPoint(hostPoint),
    strategy: "dom_geometry",
    locator_strategy: "xhs_publish_host_right_half",
    diagnostics: { host_rect: hostPoint.rect }
  };
}

async function locateXhsCssPublishButton(page) {
  const buttons = page.locator("#web xhs-publish-btn button, xhs-publish-btn button");
  const count = await buttons.count().catch(() => 0);
  if (count < 2) return null;
  const second = buttons.nth(1);
  const text = await second.innerText({ timeout: 1000 }).catch(() => "");
  if (!SAFE_SCHEDULED_CONFIRMATION_PATTERN.test(String(text).replace(/\s+/g, ""))) return null;
  return {
    count: 1,
    locator: second,
    strategy: "dom",
    locator_strategy: "xhs_publish_button_css",
    diagnostics: { xhs_button_count: count }
  };
}

async function locateXhsXPathPublishButton(page) {
  const button = page.locator("xpath=//*[@id='web']/div/div/div[2]/div/div/div[1]/xhs-publish-btn//div/div/button[2]");
  const count = await button.count().catch(() => 0);
  if (count !== 1) return null;
  const text = await button.first().innerText({ timeout: 1000 }).catch(() => "");
  if (!SAFE_SCHEDULED_CONFIRMATION_PATTERN.test(String(text).replace(/\s+/g, ""))) return null;
  return {
    count: 1,
    locator: button.first(),
    strategy: "dom",
    locator_strategy: "xhs_publish_button_xpath"
  };
}

async function countXhsPublishButtons(page) {
  return page.locator("#web xhs-publish-btn button, xhs-publish-btn button").count().catch(() => 0);
}

async function locateRedTextTarget(page) {
  const targets = await page.evaluate((source) => {
    const pattern = new RegExp(source);
    const normalized = (value) => String(value || "").replace(/\s+/g, "");
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== "hidden"
        && style.display !== "none"
        && style.opacity !== "0";
    };
    const redish = (element) => {
      const color = window.getComputedStyle(element).backgroundColor || "";
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!match) return false;
      const red = Number(match[1]);
      const green = Number(match[2]);
      const blue = Number(match[3]);
      return red >= 200 && green <= 120 && blue <= 150 && red - green >= 80 && red - blue >= 60;
    };
    const redAncestor = (element) => {
      let current = element;
      for (let depth = 0; current && current !== document.body && depth < 8; depth += 1) {
        if (visible(current) && redish(current)) return current;
        current = current.parentElement;
      }
      return null;
    };
    const points = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const text = normalized(element.textContent);
      if (!pattern.test(text) || !visible(element)) continue;
      if (Array.from(element.children || []).some((child) => normalized(child.textContent) === text)) continue;
      const target = redAncestor(element);
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      if (rect.height < 20 || rect.width < 40) continue;
      points.push({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        key: `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
      });
    }
    const seen = new Set();
    return points.filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  }, SAFE_SCHEDULED_CONFIRMATION_PATTERN.source).catch(() => []);

  if (!Array.isArray(targets) || targets.length !== 1) return null;
  return {
    count: 1,
    point: roundPoint(targets[0]),
    strategy: "dom_geometry",
    locator_strategy: "red_text_target"
  };
}

async function locateXhsScreenshotButton(page) {
  let png;
  try {
    png = await page.screenshot({ type: "png", fullPage: false });
  } catch (error) {
    return {
      count: 0,
      strategy: "screenshot",
      diagnostics: { screenshot_error: String(error && error.message ? error.message : error).split("\n")[0] }
    };
  }

  let image;
  try {
    image = decodePngToRgba(png);
  } catch (error) {
    return {
      count: 0,
      strategy: "screenshot",
      diagnostics: { screenshot_decode_error: String(error && error.message ? error.message : error).split("\n")[0] }
    };
  }

  const viewport = page.viewportSize() || { width: image.width, height: image.height };
  const candidates = findXhsBottomRedButtonCandidatesFromRgba({ ...image, viewport });
  if (candidates.length !== 1) {
    return {
      count: candidates.length,
      strategy: "screenshot",
      diagnostics: {
        viewport,
        screenshot: { width: image.width, height: image.height },
        red_button_candidates: candidates.map(({ point, rect, red_area }) => ({ point, rect, red_area }))
      }
    };
  }

  return {
    count: 1,
    point: candidates[0].point,
    strategy: "screenshot",
    locator_strategy: "xhs_bottom_red_button",
    diagnostics: {
      viewport,
      screenshot: { width: image.width, height: image.height },
      rect: candidates[0].rect,
      red_area: candidates[0].red_area
    }
  };
}

export function findXhsBottomRedButtonCandidatesFromRgba({ data, width, height, viewport = null }) {
  if (!data || !width || !height) return [];
  const yMin = Math.floor(height * 0.70);
  const yMax = Math.floor(height * 0.96);
  const xMin = Math.floor(width * 0.20);
  const xMax = Math.floor(width * 0.80);
  const visited = new Uint8Array(width * height);
  const candidates = [];
  const scaleX = viewport?.width ? viewport.width / width : 1;
  const scaleY = viewport?.height ? viewport.height / height : 1;

  for (let y = yMin; y < yMax; y += 1) {
    for (let x = xMin; x < xMax; x += 1) {
      const offset = y * width + x;
      if (visited[offset] || !isPublishRedPixel(data, offset * 4)) continue;
      const component = floodRedComponent({ data, width, height, x, y, xMin, xMax, yMin, yMax, visited });
      if (!isLikelyBottomPublishButton(component, width, height)) continue;
      const centerX = component.left + component.width / 2;
      const centerY = component.top + component.height / 2;
      candidates.push({
        point: roundPoint({ x: centerX * scaleX, y: centerY * scaleY }),
        rect: {
          left: Math.round(component.left * scaleX),
          top: Math.round(component.top * scaleY),
          width: Math.round(component.width * scaleX),
          height: Math.round(component.height * scaleY)
        },
        red_area: component.area
      });
    }
  }
  return candidates.sort((left, right) => left.rect.left - right.rect.left || left.rect.top - right.rect.top);
}

function floodRedComponent({ data, width, height, x, y, xMin, xMax, yMin, yMax, visited }) {
  const queue = [[x, y]];
  let left = x;
  let right = x;
  let top = y;
  let bottom = y;
  let area = 0;
  visited[y * width + x] = 1;

  for (let index = 0; index < queue.length; index += 1) {
    const [cx, cy] = queue[index];
    area += 1;
    left = Math.min(left, cx);
    right = Math.max(right, cx);
    top = Math.min(top, cy);
    bottom = Math.max(bottom, cy);
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < xMin || nx >= xMax || ny < yMin || ny >= yMax) continue;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const offset = ny * width + nx;
      if (visited[offset] || !isPublishRedPixel(data, offset * 4)) continue;
      visited[offset] = 1;
      queue.push([nx, ny]);
    }
  }

  return {
    left,
    right,
    top,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
    area
  };
}

function isPublishRedPixel(data, index) {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const alpha = data[index + 3];
  return alpha > 160
    && red >= 210
    && green <= 120
    && blue <= 150
    && red - green >= 80
    && red - blue >= 60;
}

function isLikelyBottomPublishButton(component, width, height) {
  const centerY = component.top + component.height / 2;
  const aspect = component.width / Math.max(1, component.height);
  const density = component.area / Math.max(1, component.width * component.height);
  return component.width >= Math.max(46, width * 0.025)
    && component.width <= width * 0.20
    && component.height >= Math.max(22, height * 0.018)
    && component.height <= Math.max(80, height * 0.08)
    && centerY >= height * 0.72
    && centerY <= height * 0.93
    && aspect >= 1.5
    && aspect <= 7
    && density >= 0.35;
}

function decodePngToRgba(buffer) {
  const signature = "89504e470d0a1a0a";
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Invalid PNG signature.");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}.`);
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8ClampedArray(width * height * 4);
  let inputOffset = 0;
  let previous = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const raw = inflated.subarray(inputOffset, inputOffset + rowBytes);
    inputOffset += rowBytes;
    const row = unfilterPngRow(raw, previous, filter, bytesPerPixel);
    for (let x = 0; x < width; x += 1) {
      const source = x * bytesPerPixel;
      const target = (y * width + x) * 4;
      rgba[target] = row[source];
      rgba[target + 1] = row[source + 1];
      rgba[target + 2] = row[source + 2];
      rgba[target + 3] = colorType === 6 ? row[source + 3] : 255;
    }
    previous = row;
  }
  return { width, height, data: rgba };
}

function unfilterPngRow(raw, previous, filter, bytesPerPixel) {
  const row = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previous[index] || 0;
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] || 0 : 0;
    if (filter === 0) row[index] = raw[index];
    else if (filter === 1) row[index] = (raw[index] + left) & 0xff;
    else if (filter === 2) row[index] = (raw[index] + up) & 0xff;
    else if (filter === 3) row[index] = (raw[index] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[index] = (raw[index] + paeth(left, up, upLeft)) & 0xff;
    else throw new Error(`Unsupported PNG filter: ${filter}.`);
  }
  return row;
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

async function verifyScheduledPublishPostClick(page, beforeClick, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout?.(500).catch(() => {});
    const snapshot = await readPostClickSnapshot(page);
    lastSnapshot = snapshot;
    if (snapshot.failure_text) {
      return {
        ok: false,
        reason_code: "platform_failure_after_click",
        signal: "failure_text",
        evidence: snapshot.failure_text,
        url_changed: snapshot.url && beforeClick?.url ? snapshot.url !== beforeClick.url : false
      };
    }
    if (snapshot.success_text) {
      return {
        ok: true,
        reason_code: "post_click_verified",
        signal: "success_text",
        evidence: snapshot.success_text,
        url_changed: snapshot.url && beforeClick?.url ? snapshot.url !== beforeClick.url : false
      };
    }
    if (beforeClick?.url && snapshot.url && snapshot.url !== beforeClick.url && !/\/publish\/publish/i.test(snapshot.url)) {
      return {
        ok: true,
        reason_code: "post_click_verified",
        signal: "url_changed",
        url_changed: true
      };
    }
    if (beforeClick?.editor_visible && snapshot.editor_visible === false && snapshot.publish_control_visible === false) {
      return {
        ok: true,
        reason_code: "post_click_verified",
        signal: "composer_closed",
        url_changed: snapshot.url && beforeClick?.url ? snapshot.url !== beforeClick.url : false
      };
    }
    if (snapshot.publish_button_disabled) {
      return {
        ok: true,
        reason_code: "post_click_verified",
        signal: "publish_button_disabled",
        url_changed: snapshot.url && beforeClick?.url ? snapshot.url !== beforeClick.url : false
      };
    }
  }

  return {
    ok: false,
    reason_code: "post_click_not_verified",
    signal: "timeout",
    last_snapshot: compactSnapshot(lastSnapshot)
  };
}

async function waitForHumanScheduledPublishReturn({ page, gate, button, timeoutMs, pollMs }) {
  const beforeManual = await readHumanReturnSnapshot(page);
  const postClickOutcome = await waitForHumanReturnToPublishPage(page, beforeManual, timeoutMs, pollMs);
  const details = {
    ...gate.details,
    button_count: button.count,
    button_strategy: "manual_handoff",
    button_locator_strategy: button.locator_strategy || null,
    button_point: null,
    diagnostics: {
      auto_button_strategy: button.strategy || null,
      auto_button_diagnostics: button.diagnostics || null,
      initial_snapshot: compactHumanSnapshot(beforeManual)
    },
    click_count: 0,
    human_click_required: true,
    post_click_outcome: postClickOutcome
  };

  if (postClickOutcome.ok) {
    return step(
      "scheduled_publish_confirmation",
      STATUS.done,
      "Scheduled publish was completed by human handoff and the returned publish page was verified.",
      {
        ...details,
        reason_code: "scheduled_publish_confirmed_by_human"
      }
    );
  }

  return step(
    "scheduled_publish_confirmation",
    STATUS.needsHuman,
    "Scheduled publish confirmation button was not uniquely identifiable, and human handoff did not verify a return to the publish page.",
    {
      ...details,
      reason_code: postClickOutcome.reason_code || "human_handoff_not_verified"
    }
  );
}

async function waitForHumanReturnToPublishPage(page, beforeManual, timeoutMs = 15 * 60 * 1000, pollMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  let seenSuccessText = false;
  let seenReturnButton = false;

  while (Date.now() < deadline) {
    if (typeof page.waitForTimeout === "function") {
      await page.waitForTimeout(pollMs).catch(() => {});
    } else {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, 50)));
    }

    const snapshot = await readHumanReturnSnapshot(page);
    lastSnapshot = snapshot;
    seenSuccessText ||= !!snapshot.success_text;
    seenReturnButton ||= !!snapshot.return_button_visible;

    if (snapshot.failure_text) {
      return {
        ok: false,
        reason_code: "platform_failure_after_human_click",
        signal: "failure_text",
        evidence: snapshot.failure_text,
        last_snapshot: compactHumanSnapshot(snapshot)
      };
    }

    if (isReturnedToCleanPublishPage(snapshot, beforeManual)) {
      return {
        ok: true,
        reason_code: "post_click_verified",
        signal: "returned_to_publish_page",
        seen_success_text: seenSuccessText,
        seen_return_button: seenReturnButton,
        last_snapshot: compactHumanSnapshot(snapshot)
      };
    }
  }

  return {
    ok: false,
    reason_code: "human_handoff_timeout",
    signal: "timeout",
    seen_success_text: seenSuccessText,
    seen_return_button: seenReturnButton,
    last_snapshot: compactHumanSnapshot(lastSnapshot)
  };
}

async function readHumanReturnSnapshot(page) {
  const snapshots = [];
  snapshots.push(await readHumanReturnSnapshotFromContext(page));
  if (typeof page.frames === "function") {
    for (const frame of page.frames()) {
      if (!frame || frame === page.mainFrame?.()) continue;
      snapshots.push(await readHumanReturnSnapshotFromContext(frame));
    }
  }
  return mergeHumanReturnSnapshots(snapshots, typeof page.url === "function" ? page.url() : "");
}

async function readHumanReturnSnapshotFromContext(context) {
  const successSource = SUCCESS_TEXT_PATTERN.source;
  const failureSource = FAILURE_TEXT_PATTERN.source;
  try {
    return await context.evaluate(({ successSource, failureSource }) => {
      const text = String(document.body?.innerText || "").replace(/\s+/g, "");
      const success = text.match(new RegExp(successSource));
      const failure = text.match(new RegExp(failureSource));
      const visible = (node) => {
        if (!node || typeof node.getBoundingClientRect !== "function") return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
        return rect.width > 0 && rect.height > 0 && (!style || (style.visibility !== "hidden" && style.display !== "none"));
      };
      const draftTextContext = (input) => {
        const placeholder = input.getAttribute("placeholder") || "";
        const label = input.closest(".form-item, .post-time-wrap, label, div")?.innerText || "";
        return `${placeholder}\n${label}`;
      };
      const valueInputs = Array.from(document.querySelectorAll("input, textarea"))
        .filter(visible)
        .filter((input) => {
          const type = String(input.getAttribute("type") || input.type || "text").toLowerCase();
          return !["file", "hidden", "checkbox", "radio", "button", "submit", "reset"].includes(type);
        })
        .filter((input) => {
          const context = draftTextContext(input);
          return !/(时间|日期|定时|发表|发布|位置|地点|城市|location|date|time)/i.test(context);
        });
      const textInputValueLength = valueInputs.reduce((sum, input) => sum + String(input.value || "").trim().length, 0);
      const editorTextLength = Array.from(document.querySelectorAll(".tiptap.ProseMirror, [contenteditable='true']"))
        .filter(visible)
        .reduce((sum, node) => sum + String(node.textContent || "").trim().length, 0);
      const imagePreviewCount = Array.from(document.querySelectorAll(".image-preview, [class*='image-preview'], [class*='ImagePreview'], [class*='preview-item'], [class*='PreviewItem']"))
        .filter(visible)
        .length;
      const blobMediaCount = Array.from(document.querySelectorAll("img[src^='blob:'], video[src^='blob:']"))
        .filter(visible)
        .length;
      const uploadInputCount = Array.from(document.querySelectorAll("input[type='file']")).filter(visible).length;
      const publishHost = document.querySelector("#web xhs-publish-btn, xhs-publish-btn");
      const hostRect = publishHost ? publishHost.getBoundingClientRect() : null;
      const publishControlVisible = !!hostRect && hostRect.width > 0 && hostRect.height > 0;
      const returnButtonVisible = Array.from(document.querySelectorAll("button, [role='button']"))
        .filter(visible)
        .some((button) => /立即返回|返回发布|返回/.test(String(button.textContent || "").replace(/\s+/g, "")));
      const cleanPublishMarkerVisible = /填写标题|添加描述|图文标题|上传图片|发布图片动态|选择合集|添加到合集|不定时/.test(String(document.body?.innerText || ""));
      const wechatManagementVisible = /图文管理|发表图文|发布图文|新建图文|发图文|发表动态/.test(String(document.body?.innerText || ""));
      const wechatPublishEntryVisible = Array.from(document.querySelectorAll("button, [role='button'], .weui-desktop-btn_primary, .video-btn-wrap"))
        .filter(visible)
        .some((button) => /发表图文|发布图文|新建图文|发图文|发表动态/.test(String(button.textContent || "").replace(/\s+/g, "")));
      const douyinPublishEntryVisible = Array.from(document.querySelectorAll("button, [role='button'], div, span"))
        .filter(visible)
        .some((button) => /\u53d1\u5e03\u56fe\u6587|\u4e0a\u4f20\u56fe\u6587|\u70b9\u51fb\u4e0a\u4f20|\u4e0a\u4f20\u89c6\u9891/.test(String(button.textContent || "").replace(/\s+/g, "")));
      const mediaPreviewCount = Math.max(imagePreviewCount, blobMediaCount);
      return {
        url: location.href,
        title: document.title || "",
        success_text: success ? success[0] : null,
        failure_text: failure ? failure[0] : null,
        has_publish_url: /\/publish\/publish/i.test(location.href) || /channels\.weixin\.qq\.com\/platform\/post\/(create|finderNewLifeCreate)/i.test(location.href),
        has_wechat_management_url: /channels\.weixin\.qq\.com\/platform\/post\/(finderNewLifePostList|list|manage|management)/i.test(location.href),
        has_douyin_publish_url: /creator\.douyin\.com\/creator-micro\/content\/upload/i.test(location.href),
        media_preview_count: mediaPreviewCount,
        image_preview_count: imagePreviewCount,
        blob_media_count: blobMediaCount,
        upload_input_count: uploadInputCount,
        text_input_value_length: textInputValueLength,
        editor_text_length: editorTextLength,
        publish_control_visible: publishControlVisible,
        return_button_visible: returnButtonVisible,
        clean_publish_marker_visible: cleanPublishMarkerVisible,
        wechat_management_visible: wechatManagementVisible,
        wechat_publish_entry_visible: wechatPublishEntryVisible,
        douyin_publish_entry_visible: douyinPublishEntryVisible
      };
    }, { successSource, failureSource });
  } catch (error) {
    const url = typeof context.url === "function" ? context.url() : "";
    return {
      url,
      evaluate_error: String(error && error.message ? error.message : error).split("\n")[0],
      has_publish_url: isSupportedPublishUrl(url),
      has_wechat_management_url: isWechatChannelsManagementUrl(url),
      has_douyin_publish_url: isDouyinPublishUrl(url),
      media_preview_count: null,
      image_preview_count: null,
      blob_media_count: null,
      upload_input_count: null,
      text_input_value_length: null,
      editor_text_length: null,
      publish_control_visible: null,
      return_button_visible: false,
      clean_publish_marker_visible: false,
      wechat_management_visible: false,
      wechat_publish_entry_visible: false,
      douyin_publish_entry_visible: false
    };
  }
}

function mergeHumanReturnSnapshots(snapshots, fallbackUrl = "") {
  const items = snapshots.filter(Boolean);
  const main = items[0] || {};
  const first = (key) => items.find((item) => item?.[key])?.[key] || null;
  const sum = (key) => items.reduce((total, item) => total + Number(item?.[key] || 0), 0);
  const any = (key) => items.some((item) => !!item?.[key]);
  const urls = items.map((item) => item.url).filter(Boolean);
  const url = main.url || fallbackUrl || urls[0] || "";
  return {
    url,
    title: main.title || "",
    success_text: first("success_text"),
    failure_text: first("failure_text"),
    has_publish_url: urls.some(isSupportedPublishUrl) || isSupportedPublishUrl(url),
    has_wechat_management_url: urls.some(isWechatChannelsManagementUrl) || isWechatChannelsManagementUrl(url) || any("has_wechat_management_url"),
    has_douyin_publish_url: urls.some(isDouyinPublishUrl) || isDouyinPublishUrl(url) || any("has_douyin_publish_url"),
    media_preview_count: sum("media_preview_count"),
    image_preview_count: sum("image_preview_count"),
    blob_media_count: sum("blob_media_count"),
    upload_input_count: sum("upload_input_count"),
    text_input_value_length: sum("text_input_value_length"),
    editor_text_length: sum("editor_text_length"),
    publish_control_visible: any("publish_control_visible"),
    return_button_visible: any("return_button_visible"),
    clean_publish_marker_visible: any("clean_publish_marker_visible"),
    wechat_management_visible: any("wechat_management_visible"),
    wechat_publish_entry_visible: any("wechat_publish_entry_visible"),
    douyin_publish_entry_visible: any("douyin_publish_entry_visible"),
    evaluate_error: first("evaluate_error")
  };
}

function isReturnedToCleanPublishPage(snapshot, beforeManual) {
  if (!snapshot || snapshot.return_button_visible) return false;
  if ((snapshot.has_wechat_management_url || snapshot.wechat_management_visible) && snapshot.wechat_publish_entry_visible) return true;
  if (snapshot.has_douyin_publish_url
    && (snapshot.douyin_publish_entry_visible || Number(snapshot.upload_input_count || 0) > 0)
    && Number(snapshot.media_preview_count || 0) === 0
    && Number(snapshot.editor_text_length || 0) === 0) {
    return true;
  }
  if (!snapshot.has_publish_url) return false;
  const hadDraftMedia = Number(beforeManual?.media_preview_count || 0) > 0;
  const hadDraftText = Number(beforeManual?.editor_text_length || 0) > 0
    || Number(beforeManual?.text_input_value_length || 0) > 0;
  const mediaCleared = Number(snapshot.media_preview_count || 0) === 0;
  const editorCleared = Number(snapshot.editor_text_length || 0) === 0;
  const inputCleared = Number(snapshot.text_input_value_length || 0) === 0;
  if (hadDraftMedia) return mediaCleared && editorCleared;
  if (hadDraftText) return editorCleared && (inputCleared || snapshot.clean_publish_marker_visible);
  return false;
}

function isSupportedPublishUrl(url) {
  return /\/publish\/publish/i.test(String(url || ""))
    || /channels\.weixin\.qq\.com\/platform\/post\/(create|finderNewLifeCreate)/i.test(String(url || ""))
    || isDouyinPublishUrl(url);
}

function isWechatChannelsManagementUrl(url) {
  return /channels\.weixin\.qq\.com\/platform\/post\/(finderNewLifePostList|list|manage|management)/i.test(String(url || ""));
}

function isDouyinPublishUrl(url) {
  return /creator\.douyin\.com\/creator-micro\/content\/(upload|post\/(?:image|video))/i.test(String(url || ""));
}

async function readPostClickSnapshot(page) {
  const successSource = SUCCESS_TEXT_PATTERN.source;
  const failureSource = FAILURE_TEXT_PATTERN.source;
  try {
    return await page.evaluate(({ successSource, failureSource }) => {
      const text = String(document.body?.innerText || "").replace(/\s+/g, "");
      const success = text.match(new RegExp(successSource));
      const failure = text.match(new RegExp(failureSource));
      const editorVisible = !!document.querySelector(".tiptap.ProseMirror, [contenteditable='true'], input[type='file']");
      const publishHost = document.querySelector("#web xhs-publish-btn, xhs-publish-btn");
      const hostRect = publishHost ? publishHost.getBoundingClientRect() : null;
      const publishControlVisible = !!hostRect && hostRect.width > 0 && hostRect.height > 0;
      const buttons = Array.from(document.querySelectorAll("button"));
      const publishButtonDisabled = buttons.some((button) => /定时发布|确认定时发布|定时发表/.test(String(button.textContent || "").replace(/\s+/g, ""))
        && (button.disabled || button.getAttribute("aria-disabled") === "true"));
      return {
        url: location.href,
        title: document.title || "",
        success_text: success ? success[0] : null,
        failure_text: failure ? failure[0] : null,
        editor_visible: editorVisible,
        publish_control_visible: publishControlVisible,
        publish_button_disabled: publishButtonDisabled
      };
    }, { successSource, failureSource });
  } catch (error) {
    return {
      url: typeof page.url === "function" ? page.url() : "",
      evaluate_error: String(error && error.message ? error.message : error).split("\n")[0],
      editor_visible: null,
      publish_control_visible: null,
      publish_button_disabled: false
    };
  }
}

function compactSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    url: snapshot.url || "",
    title: snapshot.title || "",
    success_text: snapshot.success_text || null,
    failure_text: snapshot.failure_text || null,
    editor_visible: snapshot.editor_visible,
    publish_control_visible: snapshot.publish_control_visible,
    publish_button_disabled: snapshot.publish_button_disabled,
    evaluate_error: snapshot.evaluate_error || null
  };
}

function compactHumanSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    url: snapshot.url || "",
    title: snapshot.title || "",
    success_text: snapshot.success_text || null,
    failure_text: snapshot.failure_text || null,
    has_publish_url: snapshot.has_publish_url,
    has_wechat_management_url: snapshot.has_wechat_management_url,
    has_douyin_publish_url: snapshot.has_douyin_publish_url,
    media_preview_count: snapshot.media_preview_count,
    image_preview_count: snapshot.image_preview_count,
    blob_media_count: snapshot.blob_media_count,
    upload_input_count: snapshot.upload_input_count,
    text_input_value_length: snapshot.text_input_value_length,
    editor_text_length: snapshot.editor_text_length,
    publish_control_visible: snapshot.publish_control_visible,
    return_button_visible: snapshot.return_button_visible,
    clean_publish_marker_visible: snapshot.clean_publish_marker_visible,
    wechat_management_visible: snapshot.wechat_management_visible,
    wechat_publish_entry_visible: snapshot.wechat_publish_entry_visible,
    douyin_publish_entry_visible: snapshot.douyin_publish_entry_visible,
    evaluate_error: snapshot.evaluate_error || null
  };
}

function roundPoint(point) {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y)
  };
}

function blocked(status, reasonCode, message, details) {
  return {
    allowed: false,
    status,
    reason_code: reasonCode,
    message,
    details
  };
}

function lastStep(steps, name) {
  return [...steps].reverse().find((item) => item?.name === name) || null;
}

function missingCriticalSteps(plan, steps) {
  const names = new Set(steps.map((item) => item?.name).filter(Boolean));
  const required = ["upload_assets", "body", "topics", "schedule", "publish_boundary"];
  if (plan?.platform !== "wechat_channels" && plan?.title) required.push("title");
  if (plan?.collection) required.push("collection_decision", "collection");
  if (plan?.declaration && plan.declaration.mode && plan.declaration.mode !== "none") required.push("declaration");
  if (plan?.music && plan.music.strategy && plan.music.strategy !== "none") required.push("music");
  return [...new Set(required)].filter((name) => !names.has(name));
}

function readScheduleActualAt(scheduleStep) {
  if (!scheduleStep || scheduleStep.status !== STATUS.done) return null;
  const detailsActual = scheduleStep.details?.actual_at || scheduleStep.details?.actualAt;
  if (detailsActual) return String(detailsActual);
  const message = String(scheduleStep.message || "");
  const adjusted = message.match(/actual(?:_at)?[:=]\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/i);
  if (adjusted) return adjusted[1].replace("T", " ");
  const selected = message.match(/(?:selected|选择|选中|定时发布|scheduled publish selected)[:：]?\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/i);
  if (selected) return selected[1].replace("T", " ");
  const firstDate = message.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
  return firstDate ? firstDate[1].replace("T", " ") : null;
}

function isFutureDateTime(value) {
  if (!value) {
    return {
      ok: false,
      reason_code: "schedule_time_missing",
      message: "Scheduled publish plan is missing schedule.publish_at."
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      ok: false,
      reason_code: "schedule_time_invalid",
      message: `Scheduled publish time is invalid: ${value}`
    };
  }
  if (date.getTime() <= Date.now()) {
    return {
      ok: false,
      reason_code: "schedule_time_not_future",
      message: `Scheduled publish time is not in the future: ${value}`
    };
  }
  return { ok: true };
}
