#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { adapters, collectionInspectors, inspectCollections } from "./adapters.mjs";
import { ProfileLockHeldError, launchPersistentProfile } from "./browser-profile.mjs";
import { accountFingerprintFromPlan, collectionCacheSummary, readCollectionCache, validateProfileName, writeCollectionCache } from "./collection-cache.mjs";
import { planWithResolvedCollection, resolveCollectionDecision } from "./collection-matcher.mjs";
import { ResultSummaryInputError, summarizeResultFile } from "./result-summary.mjs";
import { RobustnessMatrixInputError, runRobustnessMatrix } from "./robustness-matrix.mjs";
import {
  STATUS,
  defaultProfileName,
  draftFillRoot,
  ensureDir,
  exists,
  getUploadAssets,
  overallStatus,
  parseArgs,
  profileDir,
  platformPublishUrl,
  redactArtifactUrl,
  redactedArtifactHtml,
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
    if (command === "open-profile" || command === "login-profile") return await openProfile(args, command);
    if (command === "doctor") return await doctor(args);
    if (command === "preflight") return await preflight(args);
    if (command === "sample-run") return await sampleRun(args);
    if (command === "diagnose-failure") return await diagnoseFailure(args);
    if (command === "result-summary") return await resultSummary(args);
    if (command === "robustness-matrix") return await robustnessMatrix(args);
    if (command === "inspect-collections") return await inspectCollectionsCommand(args);
    if (command === "inspect-wechat-channels") return await inspectWechatChannels(args);
    if (command === "draft-fill") return await draftFill(args);
    return exit(2, { ok: false, error: `Unknown draft-fill command: ${command}` }, args.json);
  } catch (error) {
    if (error instanceof ProfileLockHeldError) {
      return exit(6, error.payload, args.json);
    }
    return exit(1, { ok: false, error: String(error && error.message ? error.message : error) }, args.json);
  }
}

async function openProfile(args, command = "open-profile") {
  const platform = args.platform || inferPlatformFromProfileName(args.profileName) || "xiaohongshu";
  const profileName = args.profileName || defaultProfileName(platform);
  const profileValidation = validateProfileName(profileName);
  if (!profileValidation.ok) {
    return exit(2, { ok: false, command, error_code: profileValidation.error_code, error: profileValidation.message }, args.json);
  }

  const steps = [];
  await collectRuntimeReadiness(steps);
  if (steps.some((item) => item.status === STATUS.failed)) {
    return exit(2, { ok: false, command, profile_name: profileName, platform, steps }, args.json);
  }

  if (args.dryRun) {
    const profilePath = profileDir(profileName);
    return exit(0, {
      ok: true,
      command,
      dry_run: true,
      profile_name: profileName,
      platform,
      profile_dir: profilePath,
      profile_exists: await exists(profilePath),
      profile_created: false,
      steps: [...steps, step("open_profile", STATUS.done, "Validated profile launch request without opening browser.")]
    }, args.json);
  }

  const readiness = await ensureProfileReadiness(steps, profileName, platform, { autoCreate: true });
  if (steps.some((item) => item.status === STATUS.failed)) {
    return exit(2, { ok: false, command, profile_name: profileName, platform, steps }, args.json);
  }

  let profile;
  try {
    profile = await launchPersistentProfile({
      profileName,
      platform,
      targetId: command,
      keepOpen: true,
      launchOptions: {
        viewport: { width: 1440, height: 960 }
      }
    });
    const page = profile.page;
    const url = platformPublishUrl(platform);
    if (url && url !== "about:blank") {
      await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    const openedAt = new Date().toISOString();
    await profile.closed.catch(() => {});
    return exit(0, {
      ok: true,
      command,
      profile_name: profileName,
      platform,
      profile_dir: profileDir(profileName),
      opened_at: openedAt,
      browser_lifecycle: "closed_by_operator",
      steps: [
        ...steps,
        step("open_profile", STATUS.done, `Opened visible browser for ${profileName}. Close it after login is complete.`)
      ]
    }, args.json);
  } finally {
    if (profile?.release) await profile.release().catch(() => {});
  }
}

function inferPlatformFromProfileName(profileName) {
  const value = String(profileName || "").toLowerCase();
  if (value.startsWith("xhs") || value.includes("xiaohongshu")) return "xiaohongshu";
  if (value.includes("douyin")) return "douyin";
  if (value.includes("wechat") || value.includes("channels") || value.includes("shipinhao")) return "wechat_channels";
  return null;
}

async function resultSummary(args) {
  if (!args.workDir) return exit(2, { ok: false, error: "--work-dir is required." }, args.json);
  let summary;
  try {
    summary = await summarizeResultFile(args.workDir);
  } catch (error) {
    if (error instanceof ResultSummaryInputError) {
      return exit(2, { ok: false, error: error.message }, args.json);
    }
    throw error;
  }
  return exit(summary.ok ? 0 : 5, summary, args.json);
}

async function robustnessMatrix(args) {
  let result;
  try {
    result = await runRobustnessMatrix({
      sourceRoot: args.sourceRoot,
      outputRoot: args.outputRoot
    });
  } catch (error) {
    if (error instanceof RobustnessMatrixInputError) {
      return exit(2, { ok: false, command: "robustness-matrix", error: error.message }, args.json);
    }
    throw error;
  }
  return exit(result.ok ? 0 : 5, result, args.json);
}

async function setup(args) {
  const profilesRoot = path.join(skillRoot, "profiles");
  await ensureDir(profilesRoot);
  const profiles = args.profileName ? [args.profileName] : ["xhs-main", "douyin-main", "wechat-channels-main"];
  for (const profile of profiles) {
    const validation = validateProfileName(profile);
    if (!validation.ok) {
      return exit(2, { ok: false, command: "setup", error_code: validation.error_code, error: validation.message }, args.json);
    }
    await ensureDir(profileDir(profile));
  }
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
  let manifest = null;
  let plan = null;

  if (!(await exists(manifestPath))) {
    steps.push(step("manifest", STATUS.failed, `manifest.json not found: ${manifestPath}`));
  } else {
    try {
      manifest = await readJson(manifestPath);
      steps.push(step("manifest", STATUS.done, "manifest.json found."));
    } catch (error) {
      steps.push(step("manifest", STATUS.failed, `manifest.json could not be read: ${error.message}`));
    }
  }
  if (!(await exists(planPath))) {
    steps.push(step("draft_plan", STATUS.failed, `draft-plan.json not found: ${planPath}`));
  } else {
    plan = await readJson(planPath);
    const errors = await validatePlan(plan, workDir, args.targetId);
    steps.push(step("draft_plan", errors.length === 0 ? STATUS.done : STATUS.failed, errors.length === 0 ? "draft-plan.json valid." : errors.join("; ")));
    collectPreflightPrompts(plan, manifest, questions, confirmations);
  }
  await collectRuntimeReadiness(steps);

  const profileName = args.profileName || (await inferProfileName(planPath));
  if (profileName) {
    const profileValidation = validateProfileName(profileName);
    if (!profileValidation.ok) {
      steps.push(step("browser_profile", STATUS.failed, profileValidation.message, { error_code: profileValidation.error_code }));
    } else {
      const readiness = await ensureProfileReadiness(steps, profileName, plan?.platform, { autoCreate: true });
      if (readiness.created) addQuestion(questions, profileLoginQuestion(plan?.platform, profileName));
    }
  } else {
    addQuestion(questions, {
      id: "profile_name",
      question: "这次发布要使用哪个浏览器 Profile？",
      why: "Each platform account needs a dedicated persistent Chrome profile so login state and account selection are stable.",
      ...choiceSet([
        choice("默认 Profile (Recommended)", `使用 ${defaultProfileName(plan?.platform) || "平台默认 Profile"}。`, "default", true),
        choice("换一个 Profile", "提供另一个已登录的 Profile 名称。", "custom_profile"),
        choice("先配置登录", "暂停草稿填写，先完成 Profile 初始化和登录。", "setup_first")
      ], "default")
    });
  }
  if (plan?.collection && profileName && validateProfileName(profileName).ok) {
    if (!accountFingerprintFromPlan(plan)) {
      addQuestion(questions, {
        id: "account_fingerprint",
        question: "合集缓存要如何绑定当前账号？",
        why: "Collection caches are account-specific. Without a verified account fingerprint, inspect-collections can discover options but draft-fill will not trust them automatically.",
        ...choiceSet([
          choice("跳过合集自动化 (Recommended)", "本次不信任合集缓存，避免选错账号合集。", "skip_collection_cache", true),
          choice("使用账号 ID", "人工确认已登录账号后，把 plan account_id 作为临时指纹。", "use_account_id"),
          choice("填写账号指纹", "提供这个 Profile 的稳定 account_fingerprint。", "provide_fingerprint")
        ], "skip_collection_cache")
      });
    }
    const cacheStatus = await readCollectionCache({
      profileName,
      platform: plan.platform,
      accountFingerprint: accountFingerprintFromPlan(plan)
    });
    const collectionStep = await collectionDecisionStepForPlan({ plan, cacheStatus, workDir });
    steps.push(collectionStep);
    if (collectionStep.status === STATUS.needsHuman) {
      addQuestion(questions, {
        id: "collection_decision",
        question: `合集没有高置信匹配，怎么处理？`,
        why: "The CLI only selects an existing visible collection after a trusted cache and high-confidence semantic match.",
        ...choiceSet([
          choice("检查合集 (Recommended)", "重新打开 Profile 缓存页面可见合集选项。", "inspect", true),
          choice("本次跳过合集", "自动填草稿，但不自动选择合集。", "skip"),
          choice("人工指定合集", "提供一个确定存在且语义匹配的合集名称。", "manual")
        ], "inspect")
      });
    }
  }

  const status = steps.some((item) => item.status === STATUS.failed)
    ? "failed"
    : questions.length > 0 || steps.some((item) => item.status === STATUS.needsHuman)
      ? "needs_human"
      : "done";
  const result = { ok: status === "done", command: "preflight", overall_status: status, steps, questions, confirmations, interaction: guidedInteraction(questions) };
  return exit(status === "failed" ? 2 : status === "needs_human" ? 4 : 0, result, args.json);
}

async function inferProfileName(planPath) {
  try {
    const plan = await readJson(planPath);
    return defaultProfileName(plan.platform);
  } catch {
    return null;
  }
}

async function collectionDecisionStepForPlan({ plan, cacheStatus, workDir }) {
  try {
    const decision = await resolveCollectionDecision({ plan, cacheStatus, workDir });
    return step(
      "collection_decision",
      decision.status,
      decision.message,
      sanitizeCollectionDecision(decision)
    );
  } catch (error) {
    return step("collection_decision", STATUS.failed, `Collection decision failed: ${error.message}`);
  }
}

function sanitizeCollectionDecision(decision) {
  return {
    reason_code: decision.reason_code,
    requested_collection: decision.requested_collection,
    selected_collection: decision.selected_collection,
    confidence: decision.confidence,
    match_type: decision.match_type,
    matched_keywords: Array.isArray(decision.matched_keywords) ? decision.matched_keywords : [],
    candidate_count: decision.candidate_count || 0,
    candidates: Array.isArray(decision.candidates)
      ? decision.candidates.slice(0, 3).map((candidate) => ({
          selected_collection: candidate.selected_collection,
          taxonomy_collection: candidate.taxonomy_collection,
          score: candidate.score,
          confidence: candidate.confidence,
          match_type: candidate.match_type,
          matched_keywords: candidate.matched_keywords || []
        }))
      : []
  };
}

function collectPreflightPrompts(plan, manifest, questions, confirmations) {
  collectManifestIntakePrompts(plan, manifest, questions, confirmations);
  addConfirmation(confirmations, {
    id: "final_publish_boundary",
    message: "Automation will stop before the final public publish button. A human must click publish after reviewing the prepared draft."
  });
  addConfirmation(confirmations, {
    id: "asset_upload",
    message: `Upload ${assetCount(plan)} asset(s) from local absolute paths.`
  });
  if (!plan.title || looksLikeFilename(plan.title)) {
    addQuestion(questions, {
      id: "title_optimization",
      question: "标题是否需要先优化？",
      why: "The title is a distribution lever; file-like or internal titles should be rewritten before publishing.",
      ...choiceSet([
        choice("优化标题 (Recommended)", "先生成更适合平台分发的标题。", "optimize", true),
        choice("保留原标题", "完全使用当前标题。", "keep_original"),
        choice("只生成候选", "生成候选标题，等待人工选择。", "candidates_only")
      ], "optimize")
    });
  }
  if (!Array.isArray(plan.tags) || plan.tags.length === 0) {
    addQuestion(questions, {
      id: "tags",
      question: "平台话题/tag 怎么处理？",
      why: "Tags must be selected through the platform topic UI; empty tags reduce discoverability and can hide selector failures.",
      ...choiceSet([
        choice("根据内容生成 (Recommended)", "根据标题、正文和产品知识生成 tag。", "generate", true),
        choice("使用 manifest", "只使用 manifest.json 里已有的 tags。", "manifest"),
        choice("我来指定", "向操作者询问精确平台 tag。", "provide")
      ], "generate")
    });
  }
  if (!plan.collection) {
    addQuestion(questions, {
      id: "collection",
      question: "合集怎么处理？",
      why: "Collection choice is content-aware and should not be guessed from one title word when product knowledge is missing.",
      ...choiceSet([
        choice("推断宽泛合集 (Recommended)", "根据产品知识选择可复用的宽泛合集。", "infer_broad", true),
        choice("跳过合集", "本次草稿不选择合集。", "skip"),
        choice("我指定合集", "询问精确的已有合集名称。", "provide")
      ], "infer_broad")
    });
  }
  if (!plan.schedule || plan.schedule.mode === "immediate") {
    addQuestion(questions, {
      id: "scheduling_needed",
      question: "这次需要定时发布吗？",
      why: "Scheduling changes batching order, platform cadence, and whether drafts can be safely prepared ahead of final publish.",
      ...choiceSet([
        choice("不定时 (Recommended)", "只准备草稿并停在发布前。", "none", true),
        choice("单条定时", "询问这条作品的精确发布时间。", "single_schedule"),
        choice("批量定时", "询问起始时间和平台间隔。", "batch_schedule")
      ], "none")
    });
    addQuestion(questions, {
      id: "schedule",
      question: "发布模式选择哪一种？",
      why: "Scheduling affects traffic cadence. For batches, collect start time and interval before filling drafts.",
      ...choiceSet([
        choice("立即草稿 (Recommended)", "保持不定时，停在最终发布按钮前。", "immediate", true),
        choice("设置定时", "填写一个未来发布时间。", "scheduled"),
        choice("稍后决定", "先不要进入依赖定时的草稿填写。", "ask_later")
      ], "immediate")
    });
    collectUnscheduledWarnings(plan, manifest, confirmations);
  } else if (!plan.schedule.publish_at) {
    addQuestion(questions, {
      id: "schedule_time",
      question: "要定时到哪个具体时间？",
      why: "Scheduled publishing needs an explicit time with timezone to avoid accidental immediate publishing.",
      ...choiceSet([
        choice("询问精确时间 (Recommended)", "让操作者提供带时区的未来时间。", "ask_exact", true),
        choice("下个 20:00", "如果平台允许，使用本地下一次 20:00。", "next_2000"),
        choice("取消定时", "改回不定时后再填草稿。", "cancel_schedule")
      ], "ask_exact")
    });
  } else {
    addConfirmation(confirmations, {
      id: "schedule",
      message: `Requested scheduled publish time: ${plan.schedule.publish_at}. Platforms may adjust to the next allowed time slot; the CLI will report the actual value.`
    });
  }
  collectBatchCadencePrompts(plan, manifest, questions);
  if (plan.platform === "douyin" && (!plan.music || plan.music.strategy === "none")) {
    addQuestion(questions, {
      id: "douyin_music",
      question: "抖音音乐怎么处理？",
      why: "The current production default is to choose the first recommended music unless the user opts out.",
      ...choiceSet([
        choice("第一首推荐 (Recommended)", "选择推荐音乐面板里的第一首。", "first_recommended", true),
        choice("不选音乐", "跳过音乐选择。", "none"),
        choice("逐条询问", "看到具体素材后再决定。", "ask_each")
      ], "first_recommended")
    });
  }
  if (plan.platform === "xiaohongshu") {
    addConfirmation(confirmations, {
      id: "xhs_original",
      message: "Xiaohongshu original declaration requires the second confirmation dialog to close before the step is considered done."
    });
  }
  if (plan.platform === "douyin") {
    addConfirmation(confirmations, {
      id: "douyin_declaration",
      message: "Douyin declaration is platform-specific; trading education defaults to personal opinion/viewpoint, not Xiaohongshu-style originality."
    });
  }
  if (plan.platform === "wechat_channels") {
    addConfirmation(confirmations, {
      id: "wechat_channels_status",
      severity: "warning",
      message: "WeChat Channels image flow is production-candidate: it can reach the final publish boundary, but collection/category behavior may still require account-specific inspection. Video flow remains experimental."
    });
    if (plan.music?.strategy === "first_recommended") {
      addConfirmation(confirmations, {
        id: "wechat_channels_music",
        message: "WeChat Channels will try to select the first recommended music item because the draft plan requests first_recommended."
      });
    } else if (!plan.music || plan.music.strategy === "none") {
      addQuestion(questions, {
        id: "wechat_channels_music",
        question: "视频号音乐怎么处理？",
        why: "WeChat Channels music behavior is account/page specific; confirm the desired default before real draft filling.",
        ...choiceSet([
          choice("第一首推荐 (Recommended)", "如果页面提供推荐音乐，就选第一首。", "first_recommended", true),
          choice("不选音乐", "跳过音乐选择。", "none"),
          choice("逐条询问", "看到页面后让操作者决定。", "ask_each")
        ], "first_recommended")
      });
    }
  }
}

function collectManifestIntakePrompts(plan, manifest, questions, confirmations) {
  const targets = manifestTargets(manifest);
  const platforms = targetPlatformSummaries(plan, targets);
  if (platforms.length === 0 || platforms.some((item) => !item.platform)) {
    addQuestion(questions, {
      id: "target_platforms",
      question: "这次要准备哪些平台和账号？",
      why: "The assistant must confirm platform/account scope before CLI or browser work so it does not prepare the wrong surface.",
      ...choiceSet([
        choice("使用 manifest (Recommended)", "严格按 manifest.json 声明的 targets 准备。", "manifest_targets", true),
        choice("三平台", "准备小红书、抖音和视频号。", "xhs_douyin_wechat_channels"),
        choice("我来选择", "询问精确平台列表。", "choose")
      ], "manifest_targets")
    });
  } else {
    addConfirmation(confirmations, {
      id: "target_platforms",
      message: `Target platform scope: ${platforms.map(formatPlatformSummary).join("; ")}.`
    });
  }

  const assetSummary = summarizeAssetLocationOrder(plan, manifest);
  if (assetSummary) {
    addConfirmation(confirmations, {
      id: "asset_location_order",
      message: assetSummary
    });
  } else {
    addQuestion(questions, {
      id: "asset_location_order",
      question: "素材路径和顺序怎么确认？",
      why: "Upload order must come from manifest/draft-plan data, not a visual guess or directory listing.",
      ...choiceSet([
        choice("按 1..N 推断 (Recommended)", "每个作品文件夹按 1.png 到 N.png 上传。", "infer_numbered", true),
        choice("使用 manifest", "只使用 manifest.json 声明的顺序。", "manifest"),
        choice("我提供路径", "询问素材目录和排序规则。", "provide")
      ], "infer_numbered")
    });
  }
}

function collectBatchCadencePrompts(plan, manifest, questions) {
  if (!isScheduled(plan)) return;
  const targets = manifestTargets(manifest);
  const multiPlatform = new Set(targets.map((item) => item.platform).filter(Boolean)).size > 1;
  const multiWork = Number(manifest?.batch?.work_count || manifest?.work_count || 0) > 1;
  if ((multiPlatform || multiWork) && !hasBatchCadence(manifest, targets)) {
    addQuestion(questions, {
      id: "batch_schedule_cadence",
      question: "批量定时间隔怎么设置？",
      why: "Multi-platform or multi-work scheduled runs need explicit per-platform spacing; do not assume one global interval fits every platform.",
      ...choiceSet([
        choice("每平台 30 分钟 (Recommended)", "同一平台作品之间间隔 30 分钟。", "30m", true),
        choice("每平台 60 分钟", "同一平台作品之间间隔 60 分钟。", "60m"),
        choice("我指定间隔", "询问每个平台的精确间隔。", "provide")
      ], "30m")
    });
  }
}

function collectUnscheduledWarnings(plan, manifest, confirmations) {
  const platforms = new Set(targetPlatformSummaries(plan, manifestTargets(manifest)).map((item) => item.platform).filter(Boolean));
  if (platforms.has("douyin")) {
    addConfirmation(confirmations, {
      id: "douyin_unscheduled_draft_warning",
      severity: "warning",
      message: "No scheduling is set. Douyin desktop Creator Center may not preserve drafts like Xiaohongshu, so unscheduled Douyin batches may require finalizing one item before preparing the next. Xiaohongshu can usually save drafts. WeChat Channels draft retention is unknown until the logged-in profile proves it."
    });
  }
  if (platforms.has("wechat_channels")) {
    addConfirmation(confirmations, {
      id: "wechat_channels_unscheduled_draft_warning",
      severity: "warning",
      message: "No scheduling is set for WeChat Channels. Draft retention is account-specific and not fully proven; for batches, prefer scheduling or prepare one draft at a time."
    });
  }
}

function manifestTargets(manifest) {
  return Array.isArray(manifest?.targets) ? manifest.targets : [];
}

function targetPlatformSummaries(plan, targets) {
  const source = targets.length > 0 ? targets : [{
    target_id: plan?.target_id,
    platform: plan?.platform,
    account_id: plan?.account_id
  }];
  return source.map((target) => ({
    target_id: target.target_id || null,
    platform: target.platform || null,
    account_id: target.account_id || null
  }));
}

function formatPlatformSummary(item) {
  const parts = [item.target_id, item.platform, item.account_id].filter(Boolean);
  return parts.join(" / ");
}

function summarizeAssetLocationOrder(plan, manifest) {
  const relative = plan?.relative_asset_paths || manifest?.assets || {};
  const images = Array.isArray(relative.images) ? relative.images.filter(Boolean) : [];
  const parts = [];
  if (relative.cover) parts.push(`cover=${relative.cover}`);
  if (images.length > 0) parts.push(`images=${images.join(", ")}`);
  if (relative.video) parts.push(`video=${relative.video}`);
  if (parts.length === 0) return null;
  return `Asset location/order from work manifest: ${parts.join("; ")}. Confirm this is the intended upload order before browser work.`;
}

function isScheduled(plan) {
  return !!plan?.schedule && plan.schedule.mode !== "immediate";
}

function hasBatchCadence(manifest, targets) {
  if (!manifest) return false;
  const manifestCadence = manifest.batch_schedule_cadence || manifest.schedule_cadence || manifest.cadence || manifest.batch?.schedule_cadence || manifest.batch?.cadence;
  if (hasText(manifestCadence)) return true;
  if (manifest.platform_cadence && Object.keys(manifest.platform_cadence).length > 0) return true;
  return targets.length > 0 && targets.every((target) => hasText(target?.overrides?.schedule_cadence || target?.overrides?.cadence || target?.schedule_cadence || target?.cadence));
}

function hasText(value) {
  return ![null, undefined, ""].includes(value) && String(value).trim().length > 0;
}

function addQuestion(questions, question) {
  if (questions.some((item) => item.id === question.id)) return;
  questions.push(normalizeQuestion(question));
}

function addConfirmation(confirmations, confirmation) {
  if (!confirmations.some((item) => item.id === confirmation.id)) confirmations.push(confirmation);
}

async function collectRuntimeReadiness(steps) {
  const packagePath = path.join(draftFillRoot, "package.json");
  steps.push(step(
    "draft_fill_package",
    (await exists(packagePath)) ? STATUS.done : STATUS.failed,
    (await exists(packagePath)) ? "draft-fill package metadata found." : `draft-fill package metadata missing: ${packagePath}`
  ));
  try {
    await import("playwright");
    steps.push(step("playwright", STATUS.done, "Playwright is installed and importable."));
  } catch (error) {
    steps.push(step("playwright", STATUS.failed, `Playwright is not ready. Run setup-draft-fill first. ${error.message}`));
  }
}

async function ensureProfileReadiness(steps, profileName, platform, options = {}) {
  const profilePath = profileDir(profileName);
  const profileExists = await exists(profilePath);
  if (profileExists) {
    steps.push(step("browser_profile", STATUS.done, `Browser profile exists: ${profileName}. Login is checked automatically when the platform page opens.`, {
      profile_name: profileName,
      platform: platform || null,
      auto_created: false
    }));
    return { exists: true, created: false };
  }
  if (options.autoCreate) {
    await ensureDir(profilePath);
    steps.push(step("browser_profile", STATUS.needsHuman, `Browser profile was created: ${profileName}. Log in once in the opened profile before real draft filling.`, {
      profile_name: profileName,
      platform: platform || null,
      auto_created: true
    }));
    return { exists: false, created: true };
  }
  steps.push(step("browser_profile", STATUS.needsHuman, `Browser profile is not initialized: ${profileName}`, {
    profile_name: profileName,
    platform: platform || null,
    auto_created: false
  }));
  return { exists: false, created: false };
}

function profileLoginQuestion(platform, profileName) {
  return {
    id: "profile_login",
    question: `${profileName} 是新 Profile，登录怎么处理？`,
    why: "The CLI can create and reuse a profile automatically, but the platform login itself must be completed by the operator in the visible browser.",
    ...choiceSet([
      choice("打开并登录 (Recommended)", "下一次真实 draft-fill 打开专用 Profile，让操作者登录一次。", "open_login", true),
      choice("已登录，重试", "如果你已经在别处完成登录，直接重试。", "retry"),
      choice("换 Profile", "切换到另一个已登录的 Profile。", "change_profile")
    ], "open_login"),
    details: {
      platform: platform || null,
      profile_name: profileName
    }
  };
}

function isTruthyFlag(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return ["1", "true", "yes", "y"].includes(String(value).trim().toLowerCase());
}

function choice(label, description, value, recommended = false) {
  return { label, description, value, recommended };
}

function choiceSet(options, defaultOption) {
  return {
    input_mode: "single_choice",
    options,
    default_option: defaultOption
  };
}

function normalizeQuestion(question) {
  const normalized = { ...question };
  if (Array.isArray(normalized.options) && normalized.options.length > 0) {
    normalized.input_mode = normalized.input_mode || "single_choice";
    if (!normalized.default_option) {
      normalized.default_option = normalized.options.find((item) => item.recommended)?.value || normalized.options[0].value;
    }
  } else {
    normalized.input_mode = normalized.input_mode || "free_text";
  }
  return normalized;
}

function guidedInteraction(questions) {
  return {
    style: "guided_intake",
    max_questions_per_round: 3,
    render_hint: "Render single_choice questions as clickable options when the client supports it; otherwise ask only the primary_question_ids in one short message.",
    primary_question_ids: questions.slice(0, 3).map((item) => item.id)
  };
}

async function readManifestForIntake(workDir) {
  try {
    return await readJson(path.join(workDir, "manifest.json"));
  } catch {
    return null;
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
  const root = path.resolve(args.workDir || path.join(os.tmpdir(), "filler-sample", platform));
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
      `Run preflight: filler preflight -WorkDir "${root}" -TargetId "${targetId}" -Json`,
      `Run dry draft-fill: filler draft-fill -WorkDir "${root}" -TargetId "${targetId}" -DryRun -Json`,
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
    body: "这是用于验证 filler 环境的样例正文。不会自动点击最终发布按钮。",
    summary: "环境验证样例",
    audience: "内部测试同事",
    selling_points: ["验证上传", "验证字段填写", "验证发布边界"],
    tone: "清晰可靠",
    assets: { cover: "assets/1.png", images: ["assets/1.png"], video: "" },
    tags: ["自动化测试", "发布助手"],
    collection: ["douyin", "wechat_channels"].includes(platform) ? "宽论" : "测试",
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
    music: ["douyin", "wechat_channels"].includes(platform) ? { strategy: "first_recommended", name: null } : { strategy: "none", name: null },
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

async function inspectCollectionsCommand(args) {
  if (!args.workDir) return exit(2, { ok: false, error: "--work-dir is required." }, args.json);
  const workDir = path.resolve(args.workDir);
  const planPath = path.join(workDir, "draft-plan.json");
  if (!(await exists(planPath))) return exit(2, { ok: false, error: `draft-plan.json not found: ${planPath}` }, args.json);
  const plan = await readJson(planPath);
  const targetId = args.targetId || plan.target_id;
  const errors = await validatePlan(plan, workDir, targetId);
  if (errors.length > 0) return exit(2, { ok: false, command: "inspect-collections", errors }, args.json);
  const profileName = args.profileName || defaultProfileName(plan.platform);
  const profileValidation = validateProfileName(profileName);
  if (!profileValidation.ok) {
    return exit(2, { ok: false, command: "inspect-collections", error_code: profileValidation.error_code, error: profileValidation.message }, args.json);
  }
  if (!collectionInspectors[plan.platform]) {
    return exit(2, {
      ok: false,
      command: "inspect-collections",
      error_code: "unsupported_collection_inspector",
      error: `No collection inspector for platform: ${plan.platform}`
    }, args.json);
  }
  const accountFingerprint = accountFingerprintFromPlan(plan);
  const accountFingerprintConfirmed = !!args.confirmAccountFingerprint && !!accountFingerprint;
  if (args.confirmAccountFingerprint && !accountFingerprint) {
    return exit(2, {
      ok: false,
      command: "inspect-collections",
      error_code: "missing_account_fingerprint",
      error: "--confirm-account-fingerprint requires draft-plan.json account_fingerprint."
    }, args.json);
  }
  const logDir = targetLogDir(workDir, targetId);

  if (args.dryRun) {
    const cacheStatus = await readCollectionCache({
      profileName,
      platform: plan.platform,
      accountFingerprint
    });
    const collectionDecisionStep = await collectionDecisionStepForPlan({ plan, cacheStatus, workDir });
    const steps = [
      step("draft_plan", STATUS.done, "draft-plan.json valid."),
      step("dry_run", STATUS.done, "Validated inspect-collections plan and cache semantics without opening browser."),
      collectionDecisionStep
    ];
    const status = overallStatus(steps);
    return exit(status === STATUS.failed ? 5 : status === STATUS.needsHuman ? 4 : 0, {
      ok: status === STATUS.done,
      command: "inspect-collections",
      dry_run: true,
      target_id: targetId,
      platform: plan.platform,
      profile_name: profileName,
      collection_cache: collectionCacheSummary(cacheStatus),
      collection_decision: collectionDecisionStep.details || null,
      overall_status: status,
      steps
    }, args.json);
  }

  await ensureDir(logDir);
  let profile;
  let result;
  try {
    profile = await launchPersistentProfile({
      profileName,
      platform: plan.platform,
      targetId,
      keepOpen: false,
      launchOptions: {
        viewport: { width: 1600, height: 1000 }
      }
    });
    const inspection = await inspectCollections({ page: profile.page, plan, logDir, profileName, workDir });
    const sourceArtifacts = relativizeArtifacts(inspection.source_artifacts, workDir);
    let cacheSummary = null;
    const steps = [
      step("draft_plan", STATUS.done, "draft-plan.json valid."),
      step("browser_profile", STATUS.done, `Using browser profile: ${profileName}`),
      ...inspection.steps
    ];
    if (inspection.collections.length > 0) {
      const written = await writeCollectionCache({
        profileName,
        platform: plan.platform,
        accountFingerprint,
        accountVerified: accountFingerprintConfirmed,
        accountVerification: accountFingerprintConfirmed ? "operator_confirmed" : "unverified",
        accountId: plan.account_id || null,
        accountHint: plan.account_hint || plan.account_name || null,
        collections: inspection.collections,
        sourceArtifacts
      });
      cacheSummary = collectionCacheSummary(
        accountFingerprintConfirmed
          ? written.cache
          : {
              status: STATUS.needsHuman,
              error_code: "collection_cache_account_unverified",
              cache: written.cache
            },
        profileName
      );
      steps.push(step(
        "collection_cache",
        accountFingerprintConfirmed ? STATUS.done : STATUS.needsHuman,
        accountFingerprintConfirmed
          ? `Updated operator-confirmed collection cache with ${inspection.collections.length} collection(s).`
          : `Updated collection cache with ${inspection.collections.length} collection(s), but the account fingerprint was not explicitly confirmed. Draft-fill will require --confirm-account-fingerprint before trusting it.`,
        cacheSummary
      ));
    } else {
      cacheSummary = collectionCacheSummary(null, profileName);
      steps.push(step("collection_cache", STATUS.needsHuman, "Collection cache was not updated because no reliable collections were discovered.", cacheSummary));
    }
    result = {
      schema_version: "1.0",
      command: "inspect-collections",
      target_id: targetId,
      platform: plan.platform,
      profile_name: profileName,
      discovered_at: new Date().toISOString(),
      overall_status: overallStatus(steps),
      collections: inspection.collections,
      collection_cache: cacheSummary,
      source_artifacts: sourceArtifacts,
      steps
    };
  } catch (error) {
    if (error instanceof ProfileLockHeldError) return exit(6, error.payload, args.json);
    const steps = [
      step("draft_plan", STATUS.done, "draft-plan.json valid."),
      step("inspect_collections", STATUS.failed, String(error && error.message ? error.message : error))
    ];
    result = {
      schema_version: "1.0",
      command: "inspect-collections",
      target_id: targetId,
      platform: plan.platform,
      profile_name: profileName,
      discovered_at: new Date().toISOString(),
      overall_status: overallStatus(steps),
      collections: [],
      source_artifacts: {},
      steps
    };
  } finally {
    if (profile?.context) await profile.context.close().catch(() => {});
    if (profile?.closed) await profile.closed.catch(() => {});
    if (profile?.release) await profile.release().catch(() => {});
  }

  await writeJson(path.join(logDir, "collections.json"), result);
  return exit(result.overall_status === "failed" ? 5 : result.overall_status === "needs_human" ? 4 : 0, result, args.json);
}

function relativizeArtifacts(value, rootDir) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([key, artifactPath]) => {
    if (typeof artifactPath !== "string") return [key, artifactPath];
    const absolute = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
    const relative = path.relative(rootDir, absolute).replace(/\\/g, "/");
    return [key, relative && !relative.startsWith("..") ? relative : path.basename(artifactPath)];
  }));
}

async function inspectWechatChannels(args) {
  if (!args.workDir) return exit(2, { ok: false, error: "--work-dir is required." }, args.json);
  const workDir = path.resolve(args.workDir);
  const planPath = path.join(workDir, "draft-plan.json");
  if (!(await exists(planPath))) return exit(2, { ok: false, error: `draft-plan.json not found: ${planPath}` }, args.json);
  const plan = await readJson(planPath);
  const targetId = args.targetId || plan.target_id;
  const errors = await validatePlan(plan, workDir, targetId);
  if (errors.length > 0) return exit(2, { ok: false, command: "inspect-wechat-channels", errors }, args.json);
  if (plan.platform !== "wechat_channels") {
    return exit(2, { ok: false, command: "inspect-wechat-channels", error: `Expected wechat_channels plan, got ${plan.platform}` }, args.json);
  }
  const surface = args.surface || defaultWechatInspectSurface(plan);
  const allowedSurfaces = new Set(["video-create", "image-list", "image-create", "image-upload-1", "image-upload-all", "image-topics", "collection-open", "music-open", "schedule-open"]);
  if (!allowedSurfaces.has(surface)) {
    return exit(2, {
      ok: false,
      command: "inspect-wechat-channels",
      error_code: "invalid_surface",
      error: `Unsupported WeChat Channels inspect surface: ${surface}`
    }, args.json);
  }
  const profileName = args.profileName || defaultProfileName(plan.platform);
  const profileValidation = validateProfileName(profileName);
  if (!profileValidation.ok) {
    return exit(2, { ok: false, command: "inspect-wechat-channels", error_code: profileValidation.error_code, error: profileValidation.message }, args.json);
  }
  if (args.dryRun) {
    return exit(0, {
      ok: true,
      command: "inspect-wechat-channels",
      dry_run: true,
      target_id: targetId,
      surface
    }, args.json);
  }

  const stamp = timestampForPath(new Date());
  const root = path.join(workDir, "logs", targetId, "wechat-channels-inspect", stamp, sanitizePathSegment(surface));
  const steps = [
    step("draft_plan", STATUS.done, "draft-plan.json valid."),
    step("browser_profile", STATUS.done, `Using browser profile: ${profileName}`, { profile_name: profileName }),
    step("surface", STATUS.done, surface)
  ];

  let profile;
  let page;
  try {
    profile = await launchPersistentProfile({
      profileName,
      platform: plan.platform,
      targetId,
      keepOpen: false,
      launchOptions: {
        viewport: { width: 1600, height: 1000 }
      }
    });
    page = profile.page;
    const actionSteps = await driveWechatInspectSurface(page, plan, surface);
    steps.push(...actionSteps);
    const artifacts = await captureWechatInspectArtifacts(page, root, surface);
    steps.push(step("artifacts", STATUS.done, root, artifacts));
  } catch (error) {
    if (error instanceof ProfileLockHeldError) return exit(6, error.payload, args.json);
    steps.push(step("inspect", STATUS.failed, String(error && error.message ? error.message : error)));
    if (page) {
      try {
        const artifacts = await captureWechatInspectArtifacts(page, root, `${surface}-failure`);
        steps.push(step("artifacts", STATUS.done, root, artifacts));
      } catch (artifactError) {
        steps.push(step("artifacts", STATUS.failed, `Could not capture failure artifacts: ${artifactError.message}`));
      }
    }
  } finally {
    if (profile?.context) await profile.context.close().catch(() => {});
    if (profile?.closed) await profile.closed.catch(() => {});
    if (profile?.release) await profile.release().catch(() => {});
  }

  const result = {
    command: "inspect-wechat-channels",
    target_id: targetId,
    surface,
    profile_name: profileName,
    overall_status: overallStatus(steps),
    output_dir: root,
    steps
  };
  result.ok = result.overall_status === "done";
  return exit(result.overall_status === "failed" ? 5 : result.overall_status === "needs_human" ? 4 : 0, result, args.json);
}

function defaultWechatInspectSurface(plan) {
  return Array.isArray(plan?.asset_paths?.images) && plan.asset_paths.images.length > 0 ? "image-list" : "video-create";
}

async function driveWechatInspectSurface(page, plan, surface) {
  const steps = [];
  if (surface === "video-create") {
    await page.goto("https://channels.weixin.qq.com/platform/post/create", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    steps.push(step("navigate", STATUS.done, "Opened video create route."));
    return steps;
  }

  await page.goto("https://channels.weixin.qq.com/platform/post/finderNewLifePostList", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  steps.push(step("navigate", STATUS.done, "Opened image list route."));
  if (surface === "image-list") return steps;

  const listFrame = await waitForFrameRoute(page, "finderNewLifePostList", 30000);
  const clicked = await clickWechatImagePublishEntryInFrame(listFrame);
  if (!clicked) {
    steps.push(step("open_image_create", STATUS.needsHuman, "Could not find image-list primary publish entry."));
    return steps;
  }
  const createFrame = await waitForFrameRoute(page, "finderNewLifeCreate", 30000);
  await waitForWechatImageCreateReady(createFrame, 45000);
  steps.push(step("open_image_create", STATUS.done, "Opened image create surface through the list entry."));
  if (surface === "image-create") return steps;

  if (["image-upload-1", "image-upload-all", "image-topics", "collection-open", "music-open", "schedule-open"].includes(surface)) {
    const files = getUploadAssets(plan);
    const count = surface === "image-upload-1" ? 1 : files.length;
    if (count > 0) {
      await setWechatFrameInputFiles(page, files.slice(0, count));
      await page.waitForTimeout(12000);
      steps.push(step("upload_assets", STATUS.done, `Set ${count} file(s) on the WeChat Channels image input.`));
    }
  }

  const frame = await waitForFrameRoute(page, "finderNewLifeCreate", 30000);
  if (surface === "image-topics") {
    await fillWechatInspectText(page, frame, plan);
    steps.push(step("fill_text", STATUS.done, "Filled sample title, body, and topic tokens for inspection."));
  }
  if (surface === "collection-open") {
    const opened = await clickFrameFirstVisible(frame, [".post-album-wrap", ".post-album-display-wrap"]);
    steps.push(step("open_collection", opened ? STATUS.done : STATUS.needsHuman, opened ? "Opened collection dropdown." : "Collection dropdown trigger not found."));
  }
  if (surface === "music-open") {
    const opened = await clickFrameFirstVisible(frame, [".bgm-form-content-wrap", ".post-link-wrap:has(.bgm-form-content-wrap)"]);
    steps.push(step("open_music", opened ? STATUS.done : STATUS.needsHuman, opened ? "Opened music dropdown." : "Music dropdown trigger not found."));
  }
  if (surface === "schedule-open") {
    const opened = await frame.evaluate(() => {
      const input = Array.from(document.querySelectorAll("input[type='radio']")).find((node) => node.value === "1");
      if (!input) return false;
      input.click();
      return true;
    }).catch(() => false);
    steps.push(step("open_schedule", opened ? STATUS.done : STATUS.needsHuman, opened ? "Selected scheduled publish option." : "Scheduled publish radio not found."));
  }
  return steps;
}

async function fillWechatInspectText(page, frame, plan) {
  const title = String(plan.title || "").slice(0, 22);
  const titleInput = frame.locator("input[placeholder*='22']").first();
  if ((await titleInput.count().catch(() => 0)) > 0) {
    await titleInput.fill(title, { timeout: 5000 }).catch(() => {});
  }
  const editor = frame.locator(".input-editor[contenteditable], [contenteditable]").first();
  if ((await editor.count().catch(() => 0)) === 0) return;
  await editor.click({ timeout: 5000, force: true });
  await page.keyboard.type(String(plan.body || ""), { delay: 15 });
  for (const tag of Array.isArray(plan.tags) ? plan.tags : []) {
    await page.keyboard.type(`#${tag}`, { delay: 15 });
    await page.waitForTimeout(900);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }
}

async function setWechatFrameInputFiles(page, files) {
  const session = await page.context().newCDPSession(page);
  const result = await session.send("Runtime.evaluate", {
    expression: "document.querySelector('iframe[name=\"content\"]')?.contentDocument?.querySelector('input[type=\"file\"]')",
    objectGroup: "filler-inspect"
  });
  if (!result?.result?.objectId) throw new Error("WeChat Channels file input not found in content frame.");
  await session.send("DOM.setFileInputFiles", { objectId: result.result.objectId, files });
}

async function waitForFrameRoute(page, route, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frame({ name: "content" });
    if (frame && frame.url().includes(route)) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error(`content frame route not reached: ${route}`);
}

async function waitForFrameText(frame, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await frame.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (pattern.test(text)) return true;
    await frame.page().waitForTimeout(500);
  }
  return false;
}

async function waitForWechatImageCreateReady(frame, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await frame.evaluate(() => {
      const fileInput = document.querySelector("input[type='file']");
      const titleInput = Array.from(document.querySelectorAll("input[type='text']")).find((el) => {
        const rect = el.getBoundingClientRect();
        const placeholder = el.getAttribute("placeholder") || "";
        return rect.width > 100 && rect.height > 20 && (placeholder.includes("\u6807\u9898") || placeholder.includes("22"));
      });
      const bodyText = document.body?.innerText || "";
      return !!fileInput && !!titleInput && bodyText.length > 20;
    }).catch(() => false);
    if (ready) return true;
    await frame.page().waitForTimeout(700);
  }
  throw new Error("WeChat Channels image create form did not become ready.");
}

async function clickWechatImagePublishEntryInFrame(frame) {
  return frame.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, .weui-desktop-btn_primary, .weui-desktop-btn_wrp, .video-btn-wrap"));
    const candidates = buttons.filter((node) => {
      const rect = node.getBoundingClientRect();
      const disabled = node.disabled || String(node.className || "").includes("disabled");
      return rect.width > 0 && rect.height > 0 && !disabled;
    });
    const button = candidates.find((node) => /发表图文|发表动态/.test(node.innerText || node.textContent || ""));
    if (!button) return false;
    button.scrollIntoView({ block: "center", inline: "center" });
    button.click();
    return true;
  }).catch(() => false);
}

async function clickFrameText(frame, text) {
  return frame.evaluate((text) => {
    const nodes = Array.from(document.querySelectorAll("button,a,span,div,label"));
    const node = nodes.find((item) => (item.innerText || item.textContent || "").trim() === text);
    if (!node) return false;
    node.scrollIntoView({ block: "center", inline: "center" });
    node.click();
    return true;
  }, text).catch(() => false);
}

async function clickFrameFirstVisible(frame, selectors) {
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

async function captureWechatInspectArtifacts(page, root, surface) {
  await ensureDir(root);
  const screenshotPath = path.join(root, "screenshot.png");
  const domPath = path.join(root, "dom.html");
  const framesPath = path.join(root, "frames.json");
  const controlsPath = path.join(root, "controls.json");
  const frameContentPath = path.join(root, "frame-content.html");
  const notesPath = path.join(root, "network-notes.md");

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await fs.writeFile(domPath, redactedArtifactHtml("WeChat Channels DOM snapshot redacted", page.url()), "utf8");

  const frames = [];
  const controls = [];
  for (const frame of page.frames()) {
    const frameInfo = await frame.evaluate(() => ({
      title_present: !!document.title,
      text_length: (document.body?.innerText || "").length,
      body_count: document.querySelectorAll("body").length
    })).catch((error) => ({ error: String(error.message || error) }));
    frames.push({ name: frame.name(), url: redactArtifactUrl(frame.url()), ...frameInfo });

    const frameControls = await frame.evaluate(() => Array.from(document.querySelectorAll("button,a,input,textarea,[contenteditable='true'],[role],span,div"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        return {
          tag: node.tagName,
          role: node.getAttribute("role"),
          type: node.getAttribute("type"),
          placeholder: node.getAttribute("placeholder"),
          text_present: !!(node.innerText || node.textContent || node.value || "").trim(),
          class_name: String(node.className || "").slice(0, 140),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible
        };
      })
      .filter((item) => item.visible && (item.text || item.placeholder || item.role || item.type))
      .slice(0, 600)).catch((error) => [{ error: String(error.message || error) }]);
    controls.push({ frame_name: frame.name(), frame_url: redactArtifactUrl(frame.url()), controls: frameControls });

    if (frame.name() === "content") {
      await fs.writeFile(frameContentPath, redactedArtifactHtml("WeChat Channels content frame redacted", frame.url()), "utf8");
    }
  }

  await writeJson(framesPath, frames);
  await writeJson(controlsPath, controls);
  await fs.writeFile(notesPath, [
    `# WeChat Channels Inspect Notes`,
    ``,
    `Surface: ${surface}`,
    `Captured at: ${new Date().toISOString()}`,
    `Page URL: ${redactArtifactUrl(page.url())}`,
    ``,
    `Only redacted route and control metadata were captured. Raw DOM, frame HTML, visible text values, cookies, localStorage, tokens, and request bodies were not read or persisted.`
  ].join("\n"), "utf8");

  return {
    screenshot: screenshotPath,
    dom: domPath,
    frames: framesPath,
    controls: controlsPath,
    frame_content: frameContentPath,
    network_notes: notesPath
  };
}

function timestampForPath(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function sanitizePathSegment(value) {
  return String(value || "snapshot").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
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
  return { step: name, action: "Open the latest screenshot and redacted diagnostic artifacts, then update the platform adapter or ask the user for the missing decision." };
}

async function draftFill(args) {
  if (!args.workDir) return exit(2, { ok: false, error: "--work-dir is required." }, args.json);
  const workDir = path.resolve(args.workDir);
  const planPath = path.join(workDir, "draft-plan.json");
  const plan = await readJson(planPath);
  const errors = await validatePlan(plan, workDir, args.targetId);
  const targetId = plan.target_id;
  if (errors.length > 0) {
    const result = resultPayload(plan, [step("draft_plan", STATUS.failed, errors.join("; "))], args.profileName, true);
    return exit(2, result, args.json);
  }
  const logDir = targetLogDir(workDir, targetId);
  await ensureDir(logDir);

  const profileName = args.profileName || defaultProfileName(plan.platform);
  const profileValidation = validateProfileName(profileName);
  if (!profileValidation.ok) {
    const result = resultPayload(plan, [step("draft_plan", STATUS.done, "draft-plan.json valid."), step("browser_profile", STATUS.failed, profileValidation.message, { error_code: profileValidation.error_code })], profileName, false);
    await writeRunResult(workDir, targetId, result);
    return exit(2, result, args.json);
  }
  const steps = [step("draft_plan", STATUS.done, "draft-plan.json valid.")];
  await collectRuntimeReadiness(steps);
  const readiness = args.dryRun ? { exists: false, created: false } : await ensureProfileReadiness(steps, profileName, plan.platform, { autoCreate: true });
  if (steps.some((item) => item.status === STATUS.failed)) {
    const result = resultPayload(plan, steps, profileName, false);
    await writeRunResult(workDir, targetId, result);
    return exit(2, result, args.json);
  }
  if (args.dryRun) {
    steps.push(step("dry_run", STATUS.done, "Validated plan and adapter mapping without opening browser."));
    const result = resultPayload(plan, steps, profileName, true);
    await writeRunResult(workDir, targetId, result);
    return exit(0, result, args.json);
  }
  if (!isTruthyFlag(args.confirmIntake)) {
    const manifest = await readManifestForIntake(workDir);
    const questions = [];
    const confirmations = [];
    collectPreflightPrompts(plan, manifest, questions, confirmations);
    if (readiness.created) addQuestion(questions, profileLoginQuestion(plan.platform, profileName));
    steps.push(step("preflight_intake", STATUS.needsHuman, "Run preflight, answer/confirm the intake questions, then rerun draft-fill with --confirm-intake.", {
      question_ids: questions.map((item) => item.id),
      confirmation_ids: confirmations.map((item) => item.id)
    }));
    const result = {
      ...resultPayload(plan, steps, profileName, false),
      questions,
      confirmations,
      interaction: guidedInteraction(questions)
    };
    await writeRunResult(workDir, targetId, result);
    return exit(4, result, args.json);
  }
  steps.push(step("preflight_intake", STATUS.done, "Operator confirmed preflight intake before real browser work."));
  const adapter = adapters[plan.platform];
  if (!adapter) {
    steps.push(step("adapter", STATUS.failed, `No adapter for platform: ${plan.platform}`));
    const result = resultPayload(plan, steps, profileName, false);
    await writeRunResult(workDir, targetId, result);
    return exit(2, result, args.json);
  }

  let profile;
  try {
    profile = await launchPersistentProfile({
      profileName,
      platform: plan.platform,
      targetId,
      keepOpen: true,
      launchOptions: {
        viewport: { width: 1600, height: 1000 }
      }
    });
    const page = profile.page;
    steps.push(step("browser_profile", STATUS.done, `Using browser profile: ${profileName}`, { profile_name: profileName }));
    let adapterPlan = plan;
    if (plan.collection) {
      const cacheStatus = await readCollectionCache({
        profileName,
        platform: plan.platform,
        accountFingerprint: accountFingerprintFromPlan(plan)
      });
      const collectionStep = await collectionDecisionStepForPlan({ plan, cacheStatus, workDir });
      steps.push(collectionStep);
      if (collectionStep.status !== STATUS.done) {
        const result = resultPayload(plan, steps, profileName, false);
        await writeRunResult(workDir, targetId, result);
        if (profile?.context) await profile.context.close().catch(() => {});
        if (profile?.closed) await profile.closed.catch(() => {});
        if (profile?.release) await profile.release().catch(() => {});
        return exit(4, result, args.json);
      }
      adapterPlan = planWithResolvedCollection(plan, collectionStep.details);
    }
    const adapterSteps = await adapter.run({ page, plan: adapterPlan, logDir, profileName, workDir });
    steps.push(...adapterSteps);
  } catch (error) {
    if (error instanceof ProfileLockHeldError) return exit(6, error.payload, args.json);
    if (isPersistentProfileSessionOpenError(error)) {
      steps.push(step("browser_profile", STATUS.needsHuman, `Browser profile appears to be open in another Chrome session: ${profileName}. Close that dedicated profile window and rerun draft-fill.`, {
        error_code: "profile_browser_session_open",
        profile_name: profileName
      }));
    } else {
      steps.push(step("draft_fill", STATUS.failed, String(error && error.message ? error.message : error)));
    }
  }

  const result = resultPayload(plan, steps, profileName, false);
  await writeRunResult(workDir, targetId, result);
  if (profile?.closed) {
    await profile.closed.catch(() => {});
  } else if (profile?.release) {
    await profile.release().catch(() => {});
  }
  return exit(result.overall_status === "failed" ? 5 : result.overall_status === "needs_human" ? 4 : 0, result, args.json);
}

function isPersistentProfileSessionOpenError(error) {
  const message = String(error && error.message ? error.message : error);
  return /launchPersistentContext/i.test(message)
    && /Target page, context or browser has been closed/i.test(message)
    && /user-data-dir=.*profiles/i.test(message);
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
