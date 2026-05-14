import assert from "node:assert/strict";
import {
  evaluateScheduledPublishGate,
  maybeConfirmScheduledPublish
} from "../src/scheduled-publish.mjs";

const scheduledPlan = {
  platform: "douyin",
  schedule: { mode: "scheduled_exact", publish_at: "2026-05-15T20:00:00+08:00" }
};

const immediatePlan = {
  platform: "douyin",
  schedule: { mode: "immediate", publish_at: null }
};

const doneSteps = [
  { name: "upload_assets", status: "done" },
  { name: "title", status: "done" },
  { name: "body", status: "done" },
  { name: "topics", status: "done" },
  { name: "collection_decision", status: "done" },
  { name: "collection", status: "done" },
  { name: "declaration", status: "done" },
  { name: "music", status: "done" },
  { name: "schedule", status: "done", message: "Scheduled publish selected: 2026-05-15 20:00." },
  { name: "publish_boundary", status: "done", message: "Final publish button count=1; not clicked." }
];

let gate = evaluateScheduledPublishGate({ plan: scheduledPlan, steps: doneSteps, confirmScheduledPublish: false });
assert.equal(gate.allowed, false);
assert.equal(gate.status, "skipped_by_plan");
assert.equal(gate.reason_code, "confirm_scheduled_publish_not_enabled");

gate = evaluateScheduledPublishGate({ plan: immediatePlan, steps: doneSteps, confirmScheduledPublish: true });
assert.equal(gate.allowed, false);
assert.equal(gate.status, "needs_human");
assert.equal(gate.reason_code, "not_scheduled");

gate = evaluateScheduledPublishGate({
  plan: scheduledPlan,
  steps: doneSteps.map((item) => item.name === "schedule" ? { ...item, status: "needs_human" } : item),
  confirmScheduledPublish: true
});
assert.equal(gate.allowed, false);
assert.equal(gate.status, "needs_human");
assert.equal(gate.reason_code, "schedule_not_verified");

gate = evaluateScheduledPublishGate({
  plan: scheduledPlan,
  steps: doneSteps.map((item) => item.name === "collection" ? { ...item, status: "needs_human" } : item),
  confirmScheduledPublish: true
});
assert.equal(gate.allowed, false);
assert.equal(gate.status, "needs_human");
assert.equal(gate.reason_code, "critical_step_not_done");

const skipped = await maybeConfirmScheduledPublish({
  page: fakeButtonPage(["定时发布"]),
  plan: scheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: false
});
assert.equal(skipped.status, "skipped_by_plan");
assert.equal(skipped.details.click_count, 0);

const allowedPage = fakeButtonPage(["定时发布"]);
const confirmed = await maybeConfirmScheduledPublish({
  page: allowedPage,
  plan: scheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: true
});
assert.equal(confirmed.status, "done");
assert.equal(confirmed.details.click_count, 1);
assert.equal(allowedPage.clickedLabels.join(","), "定时发布");

const ambiguousPage = fakeButtonPage(["定时发布", "定时发布"]);
const ambiguous = await maybeConfirmScheduledPublish({
  page: ambiguousPage,
  plan: scheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: true
});
assert.equal(ambiguous.status, "needs_human");
assert.equal(ambiguous.details.click_count, 0);
assert.equal(ambiguous.details.button_count, 2);

function fakeButtonPage(labels) {
  const page = {
    clickedLabels: [],
    getByRole(role, options = {}) {
      assert.equal(role, "button");
      const matcher = options.name;
      const matches = labels.filter((label) => matcher.test(label));
      return {
        async count() {
          return matches.length;
        },
        first() {
          return {
            async click() {
              page.clickedLabels.push(matches[0]);
            }
          };
        }
      };
    }
  };
  return page;
}

console.log("scheduled publish tests passed.");
