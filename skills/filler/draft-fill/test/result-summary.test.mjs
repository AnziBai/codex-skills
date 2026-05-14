import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeResultFile } from "../src/result-summary.mjs";

const cliPath = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

async function withWorkDir(result, fn) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-result-summary-"));
  await fs.writeFile(path.join(workDir, "draft-fill-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  try {
    return await fn(workDir);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

await withWorkDir({
  work_id: "work-cn-1",
  target_id: "xhs-cn-1",
  platform: "xiaohongshu",
  overall_status: "done",
  steps: [
    { name: "fill_title", status: "done", message: "\u6807\u9898\u5df2\u586b\u5199\uff1a\u91cf\u4ef7\u7a81\u7834\u590d\u76d8" },
    { name: "publish_boundary", status: "done", message: "Final publish was not clicked; \u5df2\u505c\u5728\u53d1\u5e03\u524d\u786e\u8ba4\u9875\u3002" }
  ]
}, async (workDir) => {
  const summary = await summarizeResultFile(workDir);
  assert.deepEqual(Object.keys(summary), [
    "ok",
    "work_id",
    "target_id",
    "platform",
    "overall_status",
    "done_steps",
    "needs_human_steps",
    "failed_steps",
    "publish_boundary_preserved",
    "scheduled_publish_confirmed",
    "publish_action",
    "schedule_requested_at",
    "schedule_actual_at"
  ]);
  assert.equal(summary.ok, true);
  assert.equal(summary.publish_boundary_preserved, true);
  assert.deepEqual(summary.done_steps, [
    { name: "fill_title", message: "\u6807\u9898\u5df2\u586b\u5199\uff1a\u91cf\u4ef7\u7a81\u7834\u590d\u76d8" },
    { name: "publish_boundary", message: "Final publish was not clicked; \u5df2\u505c\u5728\u53d1\u5e03\u524d\u786e\u8ba4\u9875\u3002" }
  ]);
});

await withWorkDir({
  work_id: "work-mixed-1",
  target_id: "douyin-1",
  platform: "douyin",
  overall_status: "failed",
  steps: [
    { name: "upload_assets", status: "needs_human", message: "\u9700\u8981\u624b\u52a8\u9009\u62e9\u89c6\u9891\u6587\u4ef6\u3002" },
    { name: "collection", status: "needs_human", message: "Collection dropdown requires human selection." },
    { name: "topics", status: "failed", message: "\u8bdd\u9898\u9009\u62e9\u5931\u8d25\u3002" },
    { name: "publish_boundary", status: "done", message: "Stopped before final publish; did not click publish." }
  ]
}, async (workDir) => {
  const summary = await summarizeResultFile(workDir);
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.needs_human_steps, [
    { name: "upload_assets", message: "\u9700\u8981\u624b\u52a8\u9009\u62e9\u89c6\u9891\u6587\u4ef6\u3002" },
    { name: "collection", message: "Collection dropdown requires human selection." }
  ]);
  assert.deepEqual(summary.failed_steps, [
    { name: "topics", message: "\u8bdd\u9898\u9009\u62e9\u5931\u8d25\u3002" }
  ]);
  assert.equal(summary.publish_boundary_preserved, true);
});

await withWorkDir({
  work_id: "work-scheduled-confirmed",
  target_id: "douyin-scheduled-1",
  platform: "douyin",
  overall_status: "done",
  publish_action: "scheduled_publish_confirmed",
  steps: [
    { name: "schedule", status: "done", message: "Scheduled publish selected: 2026-05-15 20:00.", details: { requested_at: "2026-05-15 20:00", actual_at: "2026-05-15 20:00" } },
    { name: "publish_boundary", status: "done", message: "Final publish button count=1; not clicked." },
    { name: "scheduled_publish_confirmation", status: "done", message: "Scheduled publish confirmation clicked intentionally.", details: { click_count: 1 } }
  ]
}, async (workDir) => {
  const summary = await summarizeResultFile(workDir);
  assert.equal(summary.ok, true);
  assert.equal(summary.publish_action, "scheduled_publish_confirmed");
  assert.equal(summary.scheduled_publish_confirmed, true);
  assert.equal(summary.schedule_requested_at, "2026-05-15 20:00");
  assert.equal(summary.schedule_actual_at, "2026-05-15 20:00");
});

await withWorkDir({
  work_id: "work-immediate-saved",
  target_id: "xhs-immediate-1",
  platform: "xiaohongshu",
  overall_status: "done",
  steps: [
    { name: "publish_boundary", status: "done", message: "Final publish button count=1; not clicked." },
    { name: "draft_exit", status: "done", message: "Xiaohongshu draft saved and verified.", details: { closed: true } }
  ]
}, async (workDir) => {
  const summary = await summarizeResultFile(workDir);
  assert.equal(summary.ok, true);
  assert.equal(summary.publish_action, "immediate_draft_saved_and_closed");
  assert.equal(summary.publish_boundary_preserved, true);
});

await withWorkDir({
  work_id: "work-boundary-history",
  target_id: "xhs-history-1",
  platform: "xiaohongshu",
  overall_status: "done",
  steps: [
    { name: "publish_boundary", status: "done", message: "Final publish button count=1; not clicked." }
  ]
}, async (workDir) => {
  const summary = await summarizeResultFile(workDir);
  assert.equal(summary.ok, true);
  assert.equal(summary.publish_boundary_preserved, true);
});

await withWorkDir({
  work_id: "work-boundary-unsafe",
  target_id: "wechat-1",
  platform: "wechat_channels",
  overall_status: "done",
  steps: [
    { name: "publish_boundary", status: "done", message: "Reached final publish screen." }
  ]
}, async (workDir) => {
  const summary = await summarizeResultFile(workDir);
  assert.equal(summary.ok, false);
  assert.equal(summary.publish_boundary_preserved, false);
});

await withWorkDir({
  work_id: "work-boundary-not-clickable",
  target_id: "xhs-not-clickable-1",
  platform: "xiaohongshu",
  overall_status: "done",
  steps: [
    { name: "publish_boundary", status: "done", message: "Final publish button is not clickable." }
  ]
}, async (workDir) => {
  const summary = await summarizeResultFile(workDir);
  assert.equal(summary.ok, false);
  assert.equal(summary.publish_boundary_preserved, false);
});

const cliWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-result-summary-cli-"));
try {
  await fs.writeFile(path.join(cliWorkDir, "draft-fill-result.json"), `${JSON.stringify({
    work_id: "work-cli-1",
    target_id: "xhs-cli-1",
    platform: "xiaohongshu",
    overall_status: "done",
    steps: [
      { name: "publish_boundary", status: "done", message: "Final publish was not clicked." }
    ]
  })}\n`, "utf8");
  const run = spawnSync(process.execPath, [cliPath, "result-summary", "--work-dir", cliWorkDir, "--json"], {
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.work_id, "work-cli-1");
  assert.equal(parsed.publish_boundary_preserved, true);
} finally {
  await fs.rm(cliWorkDir, { recursive: true, force: true });
}

const missingResultWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-result-summary-missing-"));
try {
  const run = spawnSync(process.execPath, [cliPath, "result-summary", "--work-dir", missingResultWorkDir, "--json"], {
    encoding: "utf8"
  });
  assert.equal(run.status, 2, run.stderr || run.stdout);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /draft-fill-result\.json/i);
} finally {
  await fs.rm(missingResultWorkDir, { recursive: true, force: true });
}

const malformedResultWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-result-summary-malformed-"));
try {
  await fs.writeFile(path.join(malformedResultWorkDir, "draft-fill-result.json"), "{not-json", "utf8");
  const run = spawnSync(process.execPath, [cliPath, "result-summary", "--work-dir", malformedResultWorkDir, "--json"], {
    encoding: "utf8"
  });
  assert.equal(run.status, 2, run.stderr || run.stdout);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /parse draft-fill-result\.json/i);
} finally {
  await fs.rm(malformedResultWorkDir, { recursive: true, force: true });
}

console.log("result summary tests passed.");
