import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STATUS = {
  done: "done",
  retrying: "retrying",
  needsHuman: "needs_human",
  failed: "failed",
  skipped: "skipped_by_plan"
};

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const draftFillRoot = path.resolve(__dirname, "..");
export const skillRoot = path.resolve(draftFillRoot, "..");

export function step(name, status, message, details = undefined) {
  return {
    name,
    status,
    message,
    ...(details === undefined ? {} : { details })
  };
}

export function overallStatus(steps) {
  if (steps.some((item) => item.status === STATUS.failed)) return "failed";
  if (steps.some((item) => item.status === STATUS.needsHuman)) return "needs_human";
  if (steps.some((item) => item.status === STATUS.retrying)) return "retrying";
  return "done";
}

export async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

export function defaultProfileName(platform) {
  if (platform === "xiaohongshu") return "xhs-main";
  if (platform === "douyin") return "douyin-main";
  if (platform === "wechat_channels") return "wechat-channels-main";
  return "default";
}

export function profileDir(profileName) {
  return path.join(skillRoot, "profiles", profileName);
}

export function targetLogDir(workDir, targetId) {
  return path.join(workDir, "logs", targetId || "draft-fill");
}

export function platformPublishUrl(platform) {
  if (platform === "xiaohongshu") {
    return "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image&openFilePicker=false";
  }
  if (platform === "douyin") {
    return "https://creator.douyin.com/creator-micro/content/upload?default-tab=3";
  }
  if (platform === "wechat_channels") {
    return "https://channels.weixin.qq.com/platform/post/create";
  }
  return "about:blank";
}

export async function validatePlan(plan, workDir, targetId) {
  const errors = [];
  if (!plan || plan.plan_type !== "social_publisher_draft_plan") errors.push("draft-plan.json has unexpected plan_type.");
  if (targetId && plan.target_id !== targetId) errors.push(`draft-plan target_id ${plan.target_id} does not match ${targetId}.`);
  for (const field of ["platform", "target_id", "title", "body", "asset_paths"]) {
    if (plan[field] === undefined || plan[field] === null || plan[field] === "") errors.push(`draft-plan missing ${field}.`);
  }
  if (plan.stop_before_publish !== true) errors.push("draft-plan must set stop_before_publish=true.");
  const assets = getUploadAssets(plan);
  if (assets.length === 0) errors.push("draft-plan has no uploadable image or video assets.");
  for (const asset of assets) {
    if (!path.isAbsolute(asset)) errors.push(`asset path is not absolute: ${asset}`);
    else if (!(await exists(asset))) errors.push(`asset path not found: ${asset}`);
  }
  if (plan.schedule && plan.schedule.mode && plan.schedule.mode !== "immediate" && plan.schedule.publish_at) {
    const scheduledAt = new Date(plan.schedule.publish_at);
    if (Number.isNaN(scheduledAt.getTime())) {
      errors.push(`schedule publish_at is not a valid datetime: ${plan.schedule.publish_at}`);
    } else if (scheduledAt.getTime() <= Date.now()) {
      errors.push(`schedule publish_at is in the past: ${plan.schedule.publish_at}`);
    }
  }
  if (workDir && path.resolve(workDir) !== path.resolve(plan.source_work_dir || workDir)) {
    // Non-fatal in case the work directory was moved; assets remain authoritative.
  }
  return errors;
}

export function getUploadAssets(plan) {
  const assets = plan.asset_paths || {};
  if (assets.video) return [assets.video];
  if (Array.isArray(assets.images) && assets.images.length > 0) return assets.images;
  if (assets.cover) return [assets.cover];
  return [];
}

export async function saveArtifacts(page, logDir, name) {
  await ensureDir(path.join(logDir, "screenshots"));
  const screenshot = path.join(logDir, "screenshots", `${name}.png`);
  const dom = path.join(logDir, `${name}.dom.html`);
  try {
    await page.screenshot({ path: screenshot, fullPage: true });
  } catch {
    // Screenshot failure should not hide the primary failure.
  }
  try {
    await fs.writeFile(dom, await page.content(), "utf8");
  } catch {
    // DOM snapshot is diagnostic only.
  }
  return { screenshot, dom };
}

export async function writeRunResult(workDir, targetId, result) {
  const logDir = targetLogDir(workDir, targetId);
  await writeJson(path.join(logDir, "run.json"), result);
  await writeJson(path.join(workDir, "draft-fill-result.json"), result);
}
