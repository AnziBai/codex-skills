import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isScheduledPublishConfirmedResult, runBatchDraftFill } from "../src/batch-draft-fill.mjs";

const calls = [];
const result = await runBatchDraftFill({
  batch: {
    items: [
      { work_dir: "w1", target_id: "t1", profile_name: "p1" },
      { work_dir: "w2", target_id: "t2", profile_name: "p1" },
      { work_dir: "w3", target_id: "t3", profile_name: "p2" }
    ]
  },
  args: { json: true, confirmIntake: true },
  invoke: async (item, index) => {
    calls.push({ item, index });
    if (index === 1) return { code: 4, stdout: JSON.stringify({ overall_status: "needs_human" }), stderr: "" };
    return { code: 0, stdout: JSON.stringify({ overall_status: "done" }), stderr: "" };
  }
});

assert.equal(result.ok, false);
assert.equal(result.overall_status, "needs_human");
assert.equal(calls.length, 2);
assert.deepEqual(result.items.map((item) => item.status), ["done", "needs_human", "skipped_after_failure"]);
assert.equal(result.items[2].reason_code, "previous_item_failed");

const success = await runBatchDraftFill({
  batch: {
    items: [
      { work_dir: "w1", target_id: "t1", profile_name: "p1" },
      { work_dir: "w2", target_id: "t2", profile_name: "p2" }
    ]
  },
  args: { json: true, confirmIntake: true },
  invoke: async () => ({ code: 0, stdout: JSON.stringify({ overall_status: "done" }), stderr: "" })
});
assert.equal(success.ok, true);
assert.equal(success.overall_status, "done");
assert.equal(success.items.every((item) => item.status === "done"), true);

assert.equal(isScheduledPublishConfirmedResult({
  overall_status: "done",
  publish_action: "scheduled_publish_confirmed"
}), true);
assert.equal(isScheduledPublishConfirmedResult({
  overall_status: "needs_human",
  publish_action: "scheduled_publish_confirmed"
}), false);

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "batch-draft-fill-"));
const alreadyDoneDir = path.join(tmpRoot, "already-done");
const nextDir = path.join(tmpRoot, "next");
await fs.mkdir(alreadyDoneDir, { recursive: true });
await fs.mkdir(nextDir, { recursive: true });
await fs.writeFile(path.join(alreadyDoneDir, "draft-fill-result.json"), JSON.stringify({
  overall_status: "done",
  publish_action: "scheduled_publish_confirmed",
  steps: [
    { name: "scheduled_publish_confirmation", status: "done", details: { click_count: 1 } }
  ]
}), "utf8");

const resumeCalls = [];
const resumed = await runBatchDraftFill({
  batch: {
    items: [
      { work_dir: alreadyDoneDir, target_id: "already", profile_name: "p1" },
      { work_dir: nextDir, target_id: "next", profile_name: "p1" }
    ]
  },
  args: { json: true, confirmIntake: true },
  invoke: async (item, index) => {
    resumeCalls.push({ item, index });
    return { code: 0, stdout: JSON.stringify({ overall_status: "done" }), stderr: "" };
  }
});
assert.equal(resumed.ok, true);
assert.deepEqual(resumed.items.map((item) => item.status), ["skipped_existing_success", "done"]);
assert.equal(resumed.items[0].reason_code, "scheduled_publish_already_confirmed");
assert.deepEqual(resumeCalls.map((call) => call.item.target_id), ["next"]);

const dryRunCalls = [];
const dryRunDoesNotSkip = await runBatchDraftFill({
  batch: {
    dry_run: true,
    items: [
      { work_dir: alreadyDoneDir, target_id: "already", profile_name: "p1" }
    ]
  },
  args: { json: true },
  invoke: async (item, index) => {
    dryRunCalls.push({ item, index });
    return { code: 0, stdout: JSON.stringify({ overall_status: "done" }), stderr: "" };
  }
});
assert.equal(dryRunDoesNotSkip.ok, true);
assert.equal(dryRunCalls.length, 1);

console.log("batch draft-fill tests passed.");
