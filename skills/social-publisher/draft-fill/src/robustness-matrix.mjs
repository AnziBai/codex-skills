import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { draftFillRoot, ensureDir, exists, getUploadAssets, readJson, validatePlan, writeJson } from "./utils.mjs";

const SAMPLE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

export class RobustnessMatrixInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "RobustnessMatrixInputError";
  }
}

export async function runRobustnessMatrix(args = {}) {
  const outputRoot = args.outputRoot
    ? path.resolve(args.outputRoot)
    : await fs.mkdtemp(path.join(os.tmpdir(), "social-publisher-robustness-matrix-"));
  await ensureDir(outputRoot);
  const sourceRoot = normalizeSourceRoot(args);
  const fixtureRoot = sourceRoot || path.join(outputRoot, "fixture");
  const sourceMode = sourceRoot ? "source_root" : "generated_fixture";
  const caseDirs = sourceRoot ? await findCaseDirs(sourceRoot) : await createFixtureCases(fixtureRoot);
  const cases = [];

  for (const caseDir of caseDirs) {
    const planPath = path.join(caseDir, "draft-plan.json");
    const id = path.basename(caseDir);
    const metadata = {
      id,
      work_dir: caseDir,
      draft_plan_path: planPath,
      validation: { valid: false, errors: [] }
    };
    try {
      const plan = await readJson(planPath);
      const errors = await validatePlan(plan, caseDir, plan.target_id);
      const expectedValid = expectedValidationValid(plan);
      const valid = errors.length === 0;
      cases.push({
        ...metadata,
        ...summarizePlan(plan),
        expected_valid: expectedValid,
        case_ok: valid === expectedValid,
        validation: { valid, errors }
      });
    } catch (error) {
      cases.push({
        ...metadata,
        expected_valid: true,
        case_ok: false,
        validation: { valid: false, errors: [String(error && error.message ? error.message : error)] }
      });
    }
  }

  const environment = runEnvironmentChecks();
  const result = {
    schema_version: "1.0",
    command: "robustness-matrix",
    ok: cases.every((item) => item.case_ok) && environment.ok,
    dry_run: true,
    opened_browser: false,
    work_dir_required: false,
    generated_at: new Date().toISOString(),
    source_mode: sourceMode,
    source_root: sourceRoot,
    output_root: outputRoot,
    fixture_root: sourceRoot ? null : fixtureRoot,
    environment,
    cases
  };
  await writeJson(path.join(outputRoot, "robustness-matrix.json"), result);
  return result;
}

function normalizeSourceRoot(args) {
  if (!Object.hasOwn(args, "sourceRoot") || args.sourceRoot === undefined || args.sourceRoot === null) return null;
  if (typeof args.sourceRoot !== "string" || args.sourceRoot.trim() === "") {
    throw new RobustnessMatrixInputError("--source-root must be a non-empty path.");
  }
  return path.resolve(args.sourceRoot);
}

async function findCaseDirs(sourceRoot) {
  if (!(await exists(sourceRoot))) throw new RobustnessMatrixInputError(`--source-root not found: ${sourceRoot}`);
  const dirs = [];
  if (await exists(path.join(sourceRoot, "draft-plan.json"))) dirs.push(sourceRoot);
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(sourceRoot, entry.name);
    if (await exists(path.join(dir, "draft-plan.json"))) dirs.push(dir);
  }
  if (dirs.length === 0) throw new RobustnessMatrixInputError(`No draft-plan.json cases found under --source-root: ${sourceRoot}`);
  return dirs;
}

async function createFixtureCases(fixtureRoot) {
  await ensureDir(fixtureRoot);
  const validImmediate = await writeFixtureCase(fixtureRoot, "valid-immediate", {
    platform: "xiaohongshu",
    targetId: "matrix-xhs-immediate",
    schedule: { mode: "immediate", publish_at: null }
  });
  const scheduledFuture = await writeFixtureCase(fixtureRoot, "scheduled-future", {
    platform: "douyin",
    targetId: "matrix-douyin-scheduled",
    schedule: { mode: "scheduled_exact", publish_at: asiaShanghaiFutureIso({ hours: 26 }) }
  });
  const missingAsset = await writeFixtureCase(fixtureRoot, "missing-asset", {
    platform: "wechat_channels",
    targetId: "matrix-wechat-missing-asset",
    schedule: { mode: "immediate", publish_at: null },
    missingAsset: true,
    expectedValid: false
  });
  return [validImmediate, scheduledFuture, missingAsset];
}

async function writeFixtureCase(fixtureRoot, id, options) {
  const caseDir = path.join(fixtureRoot, id);
  const assetsDir = path.join(caseDir, "assets");
  await ensureDir(assetsDir);
  const assetPath = path.join(assetsDir, "1.png");
  if (!options.missingAsset) {
    await fs.writeFile(assetPath, Buffer.from(SAMPLE_PNG_BASE64, "base64"));
  }
  const plan = fixturePlan({
    root: caseDir,
    id,
    platform: options.platform,
    targetId: options.targetId,
    assetPath,
    schedule: options.schedule
  });
  if (typeof options.expectedValid === "boolean") {
    plan.robustness_matrix = { expected_valid: options.expectedValid };
  }
  await writeJson(path.join(caseDir, "draft-plan.json"), plan);
  await writeJson(path.join(caseDir, "manifest.json"), fixtureManifest(options.platform, options.targetId));
  return caseDir;
}

function fixtureManifest(platform, targetId) {
  return {
    schema_version: "1.0",
    work_id: `matrix-${targetId}`,
    status: "finished",
    content_format: "markdown",
    title: "Portable robustness matrix fixture",
    body: "Dry metadata validation fixture.",
    assets: { cover: "assets/1.png", images: ["assets/1.png"], video: "" },
    tags: ["portable"],
    collection: "test",
    publish_mode: "immediate",
    publish_at: null,
    targets: [{ target_id: targetId, platform, kind: "image", account_id: `${platform}_main` }]
  };
}

function fixturePlan({ root, id, platform, targetId, assetPath, schedule }) {
  return {
    schema_version: "1.0",
    plan_type: "social_publisher_draft_plan",
    generated_at: new Date().toISOString(),
    work_id: `matrix-${id}`,
    target_id: targetId,
    platform,
    kind: "image",
    account_id: `${platform}_main`,
    source_work_dir: root,
    asset_paths: { cover: assetPath, images: [assetPath], video: null },
    relative_asset_paths: { cover: "assets/1.png", images: ["assets/1.png"], video: "" },
    title: "Portable robustness matrix fixture",
    body: "Dry metadata validation fixture.",
    tags: ["portable"],
    collection: "test",
    declaration: platform === "douyin"
      ? { mode: "personal_opinion", label: "personal opinion" }
      : { mode: "original", label: "original" },
    music: platform === "douyin" ? { strategy: "first_recommended", name: null } : { strategy: "none", name: null },
    schedule,
    stop_before_publish: true,
    safety: { never_click_publish: true, no_system_clipboard: true }
  };
}

function expectedValidationValid(plan) {
  if (typeof plan.expected_validation_valid === "boolean") return plan.expected_validation_valid;
  if (typeof plan.robustness_matrix?.expected_valid === "boolean") return plan.robustness_matrix.expected_valid;
  return true;
}

function summarizePlan(plan) {
  const assets = getUploadAssets(plan);
  return {
    platform: plan.platform || null,
    target_id: plan.target_id || null,
    kind: plan.kind || null,
    asset_count: assets.length,
    schedule_mode: plan.schedule?.mode || "immediate",
    publish_at: plan.schedule?.publish_at || null
  };
}

export function asiaShanghaiFutureIso({ hours = 24 } = {}) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  const shanghaiEpoch = date.getTime() + 8 * 60 * 60 * 1000;
  return `${new Date(shanghaiEpoch).toISOString().replace(/\.\d{3}Z$/, "")}+08:00`;
}

function runEnvironmentChecks() {
  const checks = [
    commandCheck("node", process.execPath, ["--version"]),
    commandCheck("npm", commandName("npm"), ["--version"]),
    powerShellEnvironmentCheck()
  ];
  checks.push(playwrightCheck());
  checks.push(outsideCwdCheck());
  return { ok: checks.every((item) => item.ok), checks };
}

function commandName(name) {
  return process.platform === "win32" && name === "npm" ? "npm.cmd" : name;
}

function commandCheck(name, command, args) {
  const run = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32" && name === "npm", timeout: 20000 });
  return {
    name,
    ok: run.status === 0,
    command,
    exit_code: run.status,
    message: (run.stdout || run.stderr || "").trim().split(/\r?\n/)[0] || null
  };
}

export function powerShellEnvironmentCheck({ platform = process.platform, spawn = spawnSync } = {}) {
  const commands = platform === "win32" ? ["powershell"] : ["pwsh", "powershell"];
  const attempts = [];
  for (const command of commands) {
    const run = spawn(commandName(command), ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      encoding: "utf8",
      timeout: 20000
    });
    attempts.push({
      command,
      exit_code: run.status,
      message: (run.stdout || run.stderr || "").trim().split(/\r?\n/)[0] || null
    });
    if (run.status === 0) {
      return {
        name: "powershell",
        ok: true,
        command,
        exit_code: 0,
        message: attempts.at(-1).message
      };
    }
  }
  if (platform !== "win32") {
    return {
      name: "powershell",
      ok: true,
      optional: true,
      status: "skipped",
      command: commands.join("|"),
      exit_code: null,
      message: "PowerShell not found; optional on non-Windows hosts.",
      attempts
    };
  }
  return {
    name: "powershell",
    ok: false,
    command: "powershell",
    exit_code: attempts.at(-1)?.exit_code ?? null,
    message: attempts.at(-1)?.message || "PowerShell not found.",
    attempts
  };
}

function playwrightCheck() {
  const run = spawnSync(process.execPath, ["-e", "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))"], {
    cwd: draftFillRoot,
    encoding: "utf8",
    timeout: 20000
  });
  return {
    name: "playwright_dependency",
    ok: run.status === 0,
    exit_code: run.status,
    message: run.status === 0 ? "Playwright import succeeded." : "Playwright import failed; run npm install in draft-fill."
  };
}

function outsideCwdCheck() {
  const cliPath = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [cliPath, "doctor", "--json"], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    timeout: 30000
  });
  return {
    name: "execution_from_cwd_outside_repo",
    ok: run.status === 0 || run.status === 2,
    cwd: os.tmpdir(),
    exit_code: run.status,
    message: "Invoked cli.mjs by absolute path from outside the repo."
  };
}
