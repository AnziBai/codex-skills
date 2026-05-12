#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { adapters } from "./adapters.mjs";
import {
  STATUS,
  defaultProfileName,
  draftFillRoot,
  ensureDir,
  exists,
  overallStatus,
  parseArgs,
  profileDir,
  readJson,
  skillRoot,
  step,
  targetLogDir,
  validatePlan,
  writeJson,
  writeRunResult
} from "./utils.mjs";

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  try {
    if (command === "setup") return await setup(args);
    if (command === "doctor") return await doctor(args);
    if (command === "preflight") return await preflight(args);
    if (command === "sample-run") return await sampleRun(args);
    if (command === "diagnose-failure") return await diagnoseFailure(args);
    if (command === "draft-fill") return await draftFill(args);
    return exit(2, { ok: false, error: `Unknown draft-fill command: ${command}` }, args.json);
  } catch (error) {
    return exit(1, { ok: false, error: String(error && error.message ? error.message : error) }, args.json);
  }
}

async function setup(args) {
  const profilesRoot = path.join(skillRoot, "profiles");
  await ensureDir(profilesRoot);
  const profiles = args.profileName ? [args.profileName] : ["xhs-main", "douyin-main", "wechat-channels-main"];
  for (const profile of profiles) await ensureDir(profileDir(profile));
  const packagePath = path.join(draftFillRoot, "package.json");
  const nodeModules = path.join(draftFillRoot, "node_modules", "playwright");
  const result = {
    ok: true,
    command: "setup",
    package_path: packagePath,
    profiles_root: profilesRoot,
    profiles,
    playwright_installed: await exists(nodeModules),
    next_steps: [
      "Run npm install in the draft-fill directory if playwright_installed is false.",
      "Run draft-fill once per platform profile and log in when the browser opens."
    ]
  };
  return exit(0, result, args.json);
}

async function doctor(args) {
  const steps = [];
  steps.push(step("node", STATUS.done, process.version));
  steps.push(step("draft_fill_root", (await exists(draftFillRoot)) ? STATUS.done : STATUS.failed, draftFillRoot));
  try {
    await import("playwright");
    steps.push(step("playwright", STATUS.done, "Playwright import succeeded."));
  } catch (error) {
    steps.push(step("playwright", STATUS.failed, `Playwright import failed. Run npm install in ${draftFillRoot}. ${error.message}`));
  }
  if (args.workDir) {
    const planPath = path.join(args.workDir, "draft-plan.json");
    if (await exists(planPath)) {
      const plan = await readJson(planPath);
      const errors = await validatePlan(plan, args.workDir, args.targetId);
      steps.push(step("draft_plan", errors.length === 0 ? STATUS.done : STATUS.failed, errors.length === 0 ? "draft-plan.json valid." : errors.join("; ")));
    } else {
      steps.push(step("draft_plan", STATUS.failed, `draft-plan.json not found: ${planPath}`));
    }
  }
  const result = { ok: steps.every((item) => item.status === STATUS.done), command: "doctor", steps };
  return exit(result.ok ? 0 : 2, result, args.json);
}

async function preflight(args) {
  if (!args.workDir) return exit(2, { ok: false, error: "--work-dir is required." }, args.json);
  const workDir = path.resolve(args.workDir);
  const planPath = path.join(workDir, "draft-plan.json");
  const manifestPath = path.join(workDir, "manifest.json");
  const steps = [];
  const questions = [];
  const confirmations = [];

  if (!(await exists(manifestPath))) {
    steps.push(step("manifest", STATUS.failed, `manifest.json not found: ${manifestPath}`));
  } else {
    steps.push(step("manifest", STATUS.done, "manifest.json found."));
  }
  if (!(await exists(planPath))) {
    steps.push(step("draft_plan", STATUS.failed, `draft-plan.json not found: ${planPath}`));
  } else {
    const plan = await readJson(planPath);
    const errors = await validatePlan(plan, workDir, args.targetId);
    steps.push(step("draft_plan", errors.length === 0 ? STATUS.done : STATUS.failed, errors.length === 0 ? "draft-plan.json valid." : errors.join("; ")));
    collectPreflightPrompts(plan, questions, confirmations);
  }

  const profileName = args.profileName || (await inferProfileName(planPath));
  const profilePath = profileName ? profileDir(profileName) : null;
  if (profileName) {
    steps.push(step("browser_profile", (await exists(profilePath)) ? STATUS.done : STATUS.needsHuman, (await exists(profilePath)) ? profilePath : `Profile not initialized: ${profilePath}`));
  } else {
    questions.push({
      id: "profile_name",
      question: "Which browser profile should this target use?",
      why: "Each platform account needs a dedicated persistent Chrome profile so login state and account selection are stable."
    });
  }

  const status = steps.some((item) => item.status === STATUS.failed)
    ? "failed"
    : questions.length > 0 || steps.some((item) => item.status === STATUS.needsHuman)
      ? "needs_human"
      : "done";
  const result = { ok: status === "done", command: "preflight", overall_status: status, steps, questions, confirmations };
  return exit(status === "failed" ? 2 : 0, result, args.json);
}

async function inferProfileName(planPath) {
  try {
    const plan = await readJson(planPath);
    return defaultProfileName(plan.platform);
  } catch {
    return null;
  }
}

function collectPreflightPrompts(plan, questions, confirmations) {
  confirmations.push({
    id: "final_publish_boundary",
    message: "Automation will stop before the final public publish button. A human must click publish after reviewing the prepared draft."
  });
  confirmations.push({
    id: "asset_upload",
    message: `Upload ${assetCount(plan)} asset(s) from local absolute paths.`
  });
  if (!plan.title || looksLikeFilename(plan.title)) {
    questions.push({
      id: "title_optimization",
      question: "Should the title be optimized before draft filling?",
      why: "The title is a distribution lever; file-like or internal titles should be rewritten before publishing."
    });
  }
  if (!Array.isArray(plan.tags) || plan.tags.length === 0) {
    questions.push({
      id: "tags",
      question: "Which platform tags/topics should be used?",
      why: "Tags must be selected through the platform topic UI; empty tags reduce discoverability and can hide selector failures."
    });
  }
  if (!plan.collection) {
    questions.push({
      id: "collection",
      question: "Which broad collection should this work enter, or should collection selection be skipped?",
      why: "Collection choice is content-aware and should not be guessed from one title word when product knowledge is missing."
    });
  }
  if (!plan.schedule || plan.schedule.mode === "immediate") {
    questions.push({
      id: "schedule",
      question: "Publish immediately or schedule this draft?",
      why: "Scheduling affects traffic cadence. For batches, collect start time and interval before filling drafts."
    });
  } else if (!plan.schedule.publish_at) {
    questions.push({
      id: "schedule_time",
      question: "What exact publish time should be used?",
      why: "Scheduled publishing needs an explicit time with timezone to avoid accidental immediate publishing."
    });
  } else {
    confirmations.push({
      id: "schedule",
      message: `Requested scheduled publish time: ${plan.schedule.publish_at}. Platforms may adjust to the next allowed time slot; the CLI will report the actual value.`
    });
  }
  if (plan.platform === "douyin" && (!plan.music || plan.music.strategy === "none")) {
    questions.push({
      id: "douyin_music",
      question: "Should Douyin select recommended music?",
      why: "The current production default is to choose the first recommended music unless the user opts out."
    });
  }
  if (plan.platform === "xiaohongshu") {
    confirmations.push({
      id: "xhs_original",
      message: "Xiaohongshu original declaration requires the second confirmation dialog to close before the step is considered done."
    });
  }
  if (plan.platform === "douyin") {
    confirmations.push({
      id: "douyin_declaration",
      message: "Douyin declaration is platform-specific; trading education defaults to personal opinion/viewpoint, not Xiaohongshu-style originality."
    });
  }
}

function assetCount(plan) {
  const assets = plan.asset_paths || {};
  if (assets.video) return 1;
  if (Array.isArray(assets.images)) return assets.images.length;
  return assets.cover ? 1 : 0;
}

function looksLikeFilename(value) {
  return /[\\/]|\.png$|\.jpg$|\.jpeg$|\.mp4$|\.md$|^\d+[-_]/i.test(String(value || ""));
}

async function sampleRun(args) {
  const platform = args.platform || "xiaohongshu";
  if (!["xiaohongshu", "douyin", "wechat_channels"].includes(platform)) {
    return exit(2, { ok: false, error: `Unsupported sample platform: ${platform}` }, args.json);
  }
  const root = path.resolve(args.workDir || path.join(os.tmpdir(), "social-publisher-sample", platform));
  await ensureDir(path.join(root, "assets"));
  const imagePath = path.join(root, "assets", "1.png");
  await fs.writeFile(imagePath, Buffer.from(SAMPLE_PNG_BASE64, "base64"));
  const targetId = `${platform}-sample`;
  const manifest = sampleManifest(platform, targetId);
  await writeJson(path.join(root, "manifest.json"), manifest);
  const plan = sampleDraftPlan(root, manifest, platform, targetId, imagePath);
  await writeJson(path.join(root, "draft-plan.json"), plan);
  const errors = await validatePlan(plan, root, targetId);
  const result = {
    ok: errors.length === 0,
    command: "sample-run",
    platform,
    work_dir: root,
    target_id: targetId,
    dry_run_valid: errors.length === 0,
    errors,
    next_steps: [
      `Run preflight: social-publisher preflight -WorkDir "${root}" -TargetId "${targetId}" -Json`,
      `Run dry draft-fill: social-publisher draft-fill -WorkDir "${root}" -TargetId "${targetId}" -DryRun -Json`,
      "For real browser testing, log into the platform profile first and omit -DryRun."
    ]
  };
  return exit(result.ok ? 0 : 2, result, args.json);
}

function sampleManifest(platform, targetId) {
  return {
    schema_version: "1.0",
    work_id: `sample-${platform}-001`,
    status: "finished",
    content_format: "markdown",
    title: "样例作品标题",
    body: "这是用于验证 social-publisher 环境的样例正文。不会自动点击最终发布按钮。",
    summary: "环境验证样例",
    audience: "内部测试同事",
    selling_points: ["验证上传", "验证字段填写", "验证发布边界"],
    tone: "清晰可靠",
    assets: { cover: "assets/1.png", images: ["assets/1.png"], video: "" },
    tags: ["自动化测试", "发布助手"],
    collection: platform === "douyin" ? "宽论" : "测试",
    publish_mode: "immediate",
    publish_at: null,
    targets: [{ target_id: targetId, platform, kind: "image", account_id: `${platform}_main` }]
  };
}

function sampleDraftPlan(root, manifest, platform, targetId, imagePath) {
  return {
    schema_version: "1.0",
    plan_type: "social_publisher_draft_plan",
    generated_at: new Date().toISOString(),
    work_id: manifest.work_id,
    target_id: targetId,
    platform,
    kind: "image",
    account_id: `${platform}_main`,
    source_work_dir: root,
    asset_paths: { cover: imagePath, images: [imagePath], video: null },
    relative_asset_paths: { cover: "assets/1.png", images: ["assets/1.png"], video: "" },
    title: manifest.title,
    body: manifest.body,
    tags: manifest.tags,
    cover_text: manifest.title,
    collection: manifest.collection,
    declaration: platform === "douyin"
      ? { mode: "personal_opinion", label: "内容为个人观点或见解" }
      : { mode: "original", label: platform === "xiaohongshu" ? "原创声明" : "原创" },
    music: platform === "douyin" ? { strategy: "first_recommended", name: null } : { strategy: "none", name: null },
    schedule: { mode: "immediate", publish_at: null },
    stop_before_publish: true,
    safety: { never_click_publish: true, no_system_clipboard: true }
  };
}

async function diagnoseFailure(args) {
  if (!args.workDir) return exit(2, { ok: false, error: "--work-dir is required." }, args.json);
  const workDir = path.resolve(args.workDir);
  let targetId = args.targetId;
  if (!targetId) {
    const planPath = path.join(workDir, "draft-plan.json");
    if (await exists(planPath)) targetId = (await readJson(planPath)).target_id;
  }
  if (!targetId) return exit(2, { ok: false, error: "--target-id is required when draft-plan.json is missing." }, args.json);
  const logDir = targetLogDir(workDir, targetId);
  const runPath = path.join(logDir, "run.json");
  if (!(await exists(runPath))) return exit(2, { ok: false, error: `run.json not found: ${runPath}` }, args.json);
  const run = await readJson(runPath);
  const badSteps = (run.steps || []).filter((item) => ![STATUS.done, STATUS.skipped].includes(item.status));
  const screenshotDir = path.join(logDir, "screenshots");
  const files = await listDiagnosticFiles(logDir, screenshotDir);
  const recommendations = badSteps.map(recommendForStep);
  const result = {
    ok: badSteps.length === 0,
    command: "diagnose-failure",
    target_id: targetId,
    overall_status: run.overall_status,
    bad_steps: badSteps,
    recommendations,
    artifacts: files
  };
  return exit(0, result, args.json);
}

async function listDiagnosticFiles(logDir, screenshotDir) {
  const files = [];
  for (const file of ["run.json"]) {
    const full = path.join(logDir, file);
    if (await exists(full)) files.push(full);
  }
  try {
    const entries = await fs.readdir(logDir);
    for (const entry of entries) {
      if (entry.endsWith(".html") || entry.endsWith(".json")) files.push(path.join(logDir, entry));
    }
  } catch {}
  try {
    const shots = await fs.readdir(screenshotDir);
    for (const shot of shots) files.push(path.join(screenshotDir, shot));
  } catch {}
  return [...new Set(files)];
}

function recommendForStep(item) {
  const name = item.name || "unknown";
  const message = item.message || "";
  if (name === "page_signature" || /Login required/i.test(message)) {
    return { step: name, action: "Open the dedicated profile, log into the platform, then rerun doctor before draft-fill." };
  }
  if (name === "upload_assets" || name === "composer") {
    return { step: name, action: "Check file existence, platform upload limits, and whether the page transitioned to the post editor. The Douyin adapter retries once before asking for help." };
  }
  if (name === "topics") {
    return { step: name, action: "Verify the platform topic suggestion list appeared. Tags must be selected one by one from the first suggestion, not pasted as plain text." };
  }
  if (name === "schedule") {
    return { step: name, action: "Compare requested and actual times. Platform adjustment to a later allowed slot is acceptable; earlier times require user confirmation." };
  }
  if (name === "declaration") {
    return { step: name, action: "Inspect the declaration dropdown or confirmation dialog. Do not mix Xiaohongshu original declaration with Douyin personal-opinion declaration." };
  }
  return { step: name, action: "Open the latest screenshot and DOM snapshot, then update the platform adapter or ask the user for the missing decision." };
}

async function draftFill(args) {
  if (!args.workDir) return exit(2, { ok: false, error: "--work-dir is required." }, args.json);
  const workDir = path.resolve(args.workDir);
  const planPath = path.join(workDir, "draft-plan.json");
  const plan = await readJson(planPath);
  const errors = await validatePlan(plan, workDir, args.targetId);
  const targetId = plan.target_id;
  const logDir = targetLogDir(workDir, targetId);
  await ensureDir(logDir);
  if (errors.length > 0) {
    const result = resultPayload(plan, [step("draft_plan", STATUS.failed, errors.join("; "))], args.profileName, true);
    await writeRunResult(workDir, targetId, result);
    return exit(2, result, args.json);
  }

  const profileName = args.profileName || defaultProfileName(plan.platform);
  const steps = [step("draft_plan", STATUS.done, "draft-plan.json valid.")];
  if (args.dryRun) {
    steps.push(step("dry_run", STATUS.done, "Validated plan and adapter mapping without opening browser."));
    const result = resultPayload(plan, steps, profileName, true);
    await writeRunResult(workDir, targetId, result);
    return exit(0, result, args.json);
  }

  let browserContext;
  try {
    const { chromium } = await import("playwright");
    await ensureDir(profileDir(profileName));
    browserContext = await chromium.launchPersistentContext(profileDir(profileName), {
      headless: false,
      viewport: { width: 1440, height: 960 },
      acceptDownloads: true
    });
    const page = browserContext.pages()[0] || await browserContext.newPage();
    const adapter = adapters[plan.platform];
    if (!adapter) {
      steps.push(step("adapter", STATUS.failed, `No adapter for platform: ${plan.platform}`));
    } else {
      steps.push(step("browser_profile", STATUS.done, profileDir(profileName)));
      const adapterSteps = await adapter.run({ page, plan, logDir, profileName, workDir });
      steps.push(...adapterSteps);
    }
  } catch (error) {
    steps.push(step("draft_fill", STATUS.failed, String(error && error.message ? error.message : error)));
  } finally {
    if (browserContext) {
      // Keep the browser open for human final review unless the run failed before page creation.
    }
  }

  const result = resultPayload(plan, steps, profileName, false);
  await writeRunResult(workDir, targetId, result);
  return exit(result.overall_status === "failed" ? 5 : 0, result, args.json);
}

const SAMPLE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function resultPayload(plan, steps, profileName, dryRun) {
  return {
    schema_version: "1.0",
    command: "draft-fill",
    work_id: plan.work_id,
    target_id: plan.target_id,
    platform: plan.platform,
    profile_name: profileName,
    dry_run: !!dryRun,
    stop_before_publish: true,
    ran_at: new Date().toISOString(),
    overall_status: overallStatus(steps),
    steps
  };
}

async function exit(code, payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (payload.error) {
    process.stderr.write(`${payload.error}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  process.exit(code);
}

main();
