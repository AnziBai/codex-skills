import assert from "node:assert/strict";
import { STATUS, step } from "../src/utils.mjs";
import { maybeSaveDraftAndExit } from "../src/draft-exit.mjs";

const cleanSteps = [
  step("upload_assets", STATUS.done, "uploaded"),
  step("title", STATUS.done, "title"),
  step("body", STATUS.done, "body"),
  step("topics", STATUS.done, "topics"),
  step("schedule", STATUS.done, "immediate"),
  step("publish_boundary", STATUS.done, "Final publish button count=1; not clicked.")
];

const doneAdapter = {
  async saveDraftAndExit() {
    return step("draft_exit", STATUS.done, "Draft saved.");
  }
};

const context = fakeContext();
const saved = await maybeSaveDraftAndExit({
  adapter: doneAdapter,
  page: {},
  context,
  plan: { platform: "xiaohongshu", schedule: { mode: "immediate" } },
  steps: cleanSteps
});
assert.equal(saved.status, STATUS.done);
assert.equal(saved.details.closed, true);
assert.equal(context.closeCount, 1);

const missing = await maybeSaveDraftAndExit({
  adapter: {},
  page: {},
  context: fakeContext(),
  plan: { platform: "douyin", schedule: { mode: "immediate" } },
  steps: cleanSteps
});
assert.equal(missing.status, STATUS.needsHuman);
assert.equal(missing.details.reason_code, "draft_exit_handler_missing");

const blockedContext = fakeContext();
const blocked = await maybeSaveDraftAndExit({
  adapter: doneAdapter,
  page: {},
  context: blockedContext,
  plan: { platform: "xiaohongshu", schedule: { mode: "immediate" } },
  steps: [...cleanSteps, step("collection", STATUS.needsHuman, "needs human")]
});
assert.equal(blocked.status, STATUS.needsHuman);
assert.equal(blocked.details.reason_code, "critical_step_not_done");
assert.equal(blockedContext.closeCount, 0);

const ambiguousPage = fakeSaveButtonPage(["保存草稿", "保存草稿"]);
const xhsNeedsHuman = await maybeSaveDraftAndExit({
  adapter: {
    async saveDraftAndExit({ page }) {
      const buttons = page.getByRole("button", { name: /^(保存草稿|暂存草稿)$/ });
      const count = await buttons.count();
      if (count !== 1) {
        return step("draft_exit", STATUS.needsHuman, "Save draft button is not unique.", { button_count: count });
      }
      await buttons.first().click();
      return step("draft_exit", STATUS.done, "Draft saved.");
    }
  },
  page: ambiguousPage,
  context: fakeContext(),
  plan: { platform: "xiaohongshu", schedule: { mode: "immediate" } },
  steps: cleanSteps
});
assert.equal(xhsNeedsHuman.status, STATUS.needsHuman);
assert.equal(ambiguousPage.clickedLabels.length, 0);

function fakeContext() {
  return {
    closeCount: 0,
    async close() {
      this.closeCount += 1;
    }
  };
}

function fakeSaveButtonPage(labels) {
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

console.log("draft exit tests passed.");
