import assert from "node:assert/strict";
import { determinePublishClosePolicy } from "../src/publish-close-policy.mjs";

const immediate = { platform: "xiaohongshu", schedule: { mode: "immediate", publish_at: null } };
const scheduled = { platform: "douyin", schedule: { mode: "scheduled_exact", publish_at: "2026-05-15T20:00:00+08:00" } };

assert.equal(determinePublishClosePolicy({ plan: immediate }).policy, "immediate_save_draft_exit");

assert.equal(determinePublishClosePolicy({ plan: scheduled }).policy, "manual_boundary");

assert.equal(
  determinePublishClosePolicy({ plan: scheduled, confirmScheduledPublish: true }).policy,
  "scheduled_batch_confirm"
);

assert.equal(
  determinePublishClosePolicy({
    plan: scheduled,
    manifest: { targets: [{ target_id: "a" }, { target_id: "b" }] }
  }).policy,
  "scheduled_batch_confirm"
);

assert.equal(
  determinePublishClosePolicy({
    plan: scheduled,
    manifest: { batch: { work_count: 2 }, targets: [{ target_id: "a" }] }
  }).policy,
  "scheduled_batch_confirm"
);

assert.equal(
  determinePublishClosePolicy({
    plan: immediate,
    batchItemCount: 3
  }).policy,
  "immediate_save_draft_exit"
);

console.log("publish close policy tests passed.");
