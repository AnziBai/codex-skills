import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readBatchFile(batchPath) {
  const text = await fs.readFile(path.resolve(batchPath), "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

export async function runBatchDraftFill({ batch, args = {}, batchDir = process.cwd(), invoke = defaultInvokeDraftFill }) {
  const items = normalizeItems(batch, batchDir);
  const results = [];
  let stop = false;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (stop) {
      results.push({
        index,
        work_dir: item.work_dir,
        target_id: item.target_id || null,
        profile_name: item.profile_name || null,
        status: "skipped_after_failure",
        reason_code: "previous_item_failed"
      });
      continue;
    }
    const existing = await readExistingConfirmedResult(item, args, batch);
    if (existing) {
      results.push({
        index,
        work_dir: item.work_dir,
        target_id: item.target_id || null,
        profile_name: item.profile_name || null,
        status: "skipped_existing_success",
        exit_code: 0,
        reason_code: "scheduled_publish_already_confirmed",
        result: existing
      });
      continue;
    }
    const run = await invoke(item, index, { args, batch, batchItemCount: items.length });
    const parsed = parseRunStdout(run.stdout);
    const status = run.code === 0 ? "done" : parsed?.overall_status || "failed";
    results.push({
      index,
      work_dir: item.work_dir,
      target_id: item.target_id || null,
      profile_name: item.profile_name || null,
      status,
      exit_code: run.code,
      result: parsed,
      stderr: run.stderr || ""
    });
    if (run.code !== 0) stop = true;
  }
  const overallStatus = results.some((item) => item.status === "failed") ? "failed"
    : results.some((item) => item.status === "needs_human" || item.status === "skipped_after_failure") ? "needs_human"
      : "done";
  return {
    schema_version: "1.0",
    command: "batch-draft-fill",
    ok: overallStatus === "done",
    overall_status: overallStatus,
    item_count: items.length,
    items: results
  };
}

async function readExistingConfirmedResult(item, args, batch) {
  if (args.dryRun || batch?.dry_run) return null;
  const resultPath = path.join(item.work_dir, "draft-fill-result.json");
  let result;
  try {
    result = JSON.parse((await fs.readFile(resultPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  return isScheduledPublishConfirmedResult(result) ? result : null;
}

export function isScheduledPublishConfirmedResult(result) {
  if (!result || typeof result !== "object") return false;
  if (result.overall_status !== "done") return false;
  if (result.publish_action === "scheduled_publish_confirmed") return true;
  return Array.isArray(result.steps) && result.steps.some((item) =>
    item?.name === "scheduled_publish_confirmation"
      && item?.status === "done"
      && item?.details?.click_count === 1
  );
}

function normalizeItems(batch, batchDir) {
  const items = Array.isArray(batch?.items) ? batch.items : [];
  if (items.length === 0) throw new Error("batch.json must contain a non-empty items array.");
  return items.map((item) => {
    if (!item?.work_dir) throw new Error("Every batch item must include work_dir.");
    const workDir = path.isAbsolute(item.work_dir) ? item.work_dir : path.resolve(batchDir, item.work_dir);
    return {
      ...item,
      work_dir: workDir
    };
  });
}

async function defaultInvokeDraftFill(item, index, { args, batch, batchItemCount }) {
  const cliPath = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  const argv = [
    cliPath,
    "draft-fill",
    "--work-dir",
    item.work_dir,
    "--batch-item-count",
    String(batchItemCount),
    "--json"
  ];
  if (item.target_id) argv.push("--target-id", item.target_id);
  if (item.profile_name) argv.push("--profile-name", item.profile_name);
  if (item.platform) argv.push("--platform", item.platform);
  if (args.dryRun || batch?.dry_run) argv.push("--dry-run");
  if (args.confirmIntake || batch?.confirm_intake) argv.push("--confirm-intake");
  if (args.confirmAccountFingerprint || batch?.confirm_account_fingerprint) argv.push("--confirm-account-fingerprint");
  if (args.confirmScheduledPublish || batch?.confirm_scheduled_publish) argv.push("--confirm-scheduled-publish");
  try {
    const run = await execFileAsync(process.execPath, argv, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10
    });
    return { code: 0, stdout: run.stdout, stderr: run.stderr };
  } catch (error) {
    return {
      code: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || String(error.message || error)
    };
  }
}

function parseRunStdout(stdout) {
  try {
    return JSON.parse(String(stdout || "").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}
