import assert from "node:assert/strict";
import { runBatchDraftFill } from "../src/batch-draft-fill.mjs";

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

console.log("batch draft-fill tests passed.");
