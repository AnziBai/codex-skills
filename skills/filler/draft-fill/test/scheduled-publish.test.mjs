import assert from "node:assert/strict";
import {
  evaluateScheduledPublishGate,
  findXhsBottomRedButtonCandidatesFromRgba,
  maybeConfirmScheduledPublish,
  resolveScheduledPublishButton
} from "../src/scheduled-publish.mjs";

const scheduledPlan = {
  platform: "douyin",
  title: "test",
  collection: "宽论",
  declaration: { mode: "original" },
  schedule: { mode: "scheduled_exact", publish_at: "2099-05-15T20:00:00+08:00" }
};

const autoScheduledPlan = {
  ...scheduledPlan,
  platform: "generic"
};

const xhsScheduledPlan = {
  ...scheduledPlan,
  platform: "xiaohongshu"
};

const wechatScheduledPlan = {
  ...scheduledPlan,
  platform: "wechat_channels"
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
  { name: "schedule", status: "done", message: "Scheduled publish selected: 2099-05-15 20:00." },
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

const skippedPage = fakeButtonPage({ roleLabels: ["定时发布"] });
const skipped = await maybeConfirmScheduledPublish({
  page: skippedPage,
  plan: scheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: false
});
assert.equal(skipped.status, "skipped_by_plan");
assert.equal(skipped.details.click_count, 0);
assert.equal(skippedPage.clickedLabels.length, 0);

const allowedPage = fakeButtonPage({ roleLabels: ["定时发布"], postClickSuccess: true });
const confirmed = await maybeConfirmScheduledPublish({
  page: allowedPage,
  plan: autoScheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: true
});
assert.equal(confirmed.status, "done");
assert.equal(confirmed.details.click_count, 1);
assert.equal(confirmed.details.button_strategy, "dom");
assert.equal(confirmed.details.button_locator_strategy, "role_button");
assert.equal(confirmed.details.post_click_outcome.ok, true);
assert.equal(allowedPage.clickedLabels.join(","), "定时发布");

const failedAfterClickPage = fakeButtonPage({ roleLabels: ["定时发布"], postClickFailure: true });
const failedAfterClick = await maybeConfirmScheduledPublish({
  page: failedAfterClickPage,
  plan: autoScheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: true
});
assert.equal(failedAfterClick.status, "needs_human");
assert.equal(failedAfterClick.details.click_count, 1);
assert.equal(failedAfterClick.details.reason_code, "platform_failure_after_click");
assert.equal(failedAfterClick.details.post_click_outcome.ok, false);

const ambiguousPage = fakeButtonPage({ roleLabels: ["定时发布", "定时发布"] });
const ambiguous = await maybeConfirmScheduledPublish({
  page: ambiguousPage,
  plan: autoScheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: true
});
assert.equal(ambiguous.status, "needs_human");
assert.equal(ambiguous.details.click_count, 0);
assert.equal(ambiguous.details.button_count, 2);

const xhsComponentPage = fakeButtonPage({ xhsButtonLabels: ["暂存离开", "定时发布"], postClickSuccess: true });
const xhsResolved = await resolveScheduledPublishButton(xhsComponentPage, xhsScheduledPlan);
assert.equal(xhsResolved.count, 1);
assert.equal(xhsResolved.locator_strategy, "xhs_publish_button_css");
await xhsResolved.locator.click();
const manualHandoffPage = fakeButtonPage({
  humanReturnSnapshots: [
    filledPublishSnapshot(),
    { ...filledPublishSnapshot(), return_button_visible: true },
    cleanPublishSnapshot()
  ]
});
const manualHandoff = await maybeConfirmScheduledPublish({
  page: manualHandoffPage,
  plan: xhsScheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: true,
  manualConfirmationTimeoutMs: 50,
  manualConfirmationPollMs: 1
});
assert.equal(manualHandoff.status, "done");
assert.equal(manualHandoff.details.reason_code, "scheduled_publish_confirmed_by_human");
assert.equal(manualHandoff.details.button_strategy, "manual_handoff");
assert.equal(manualHandoff.details.click_count, 0);
assert.equal(manualHandoff.details.post_click_outcome.signal, "returned_to_publish_page");
assert.equal(manualHandoffPage.clickedLabels.length, 0);
assert.equal(xhsComponentPage.clickedLabels.join(","), "定时发布");

const wechatManualHandoffPage = fakeButtonPage({
  humanReturnSnapshots: [
    filledWechatPublishSnapshot(),
    { ...filledWechatPublishSnapshot(), return_button_visible: true },
    cleanWechatPublishSnapshot()
  ]
});
const wechatManualHandoff = await maybeConfirmScheduledPublish({
  page: wechatManualHandoffPage,
  plan: wechatScheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: true,
  manualConfirmationTimeoutMs: 50,
  manualConfirmationPollMs: 1
});
assert.equal(wechatManualHandoff.status, "done");
assert.equal(wechatManualHandoff.details.reason_code, "scheduled_publish_confirmed_by_human");
assert.equal(wechatManualHandoff.details.button_strategy, "manual_handoff");
assert.equal(wechatManualHandoff.details.click_count, 0);
assert.equal(wechatManualHandoffPage.clickedLabels.length, 0);

const fallbackTouchedPage = fakeButtonPage({ roleLabels: ["定时发布"], throwOnScreenshot: true });
const immediate = await maybeConfirmScheduledPublish({
  page: fallbackTouchedPage,
  plan: immediatePlan,
  steps: doneSteps,
  confirmScheduledPublish: true
});
assert.equal(immediate.status, "needs_human");
assert.equal(fallbackTouchedPage.screenshotCalls, 0);

const singleRed = redCanvas(1600, 1000, [{ left: 740, top: 790, width: 120, height: 34 }]);
const singleCandidates = findXhsBottomRedButtonCandidatesFromRgba({
  ...singleRed,
  viewport: { width: 1600, height: 1000 }
});
assert.equal(singleCandidates.length, 1);
assert.deepEqual(singleCandidates[0].point, { x: 800, y: 807 });

const multipleRed = redCanvas(1600, 1000, [
  { left: 660, top: 790, width: 110, height: 34 },
  { left: 820, top: 790, width: 110, height: 34 }
]);
const multipleCandidates = findXhsBottomRedButtonCandidatesFromRgba({
  ...multipleRed,
  viewport: { width: 1600, height: 1000 }
});
assert.equal(multipleCandidates.length, 2);

const tinySwitch = redCanvas(1600, 1000, [{ left: 1000, top: 760, width: 28, height: 18 }]);
assert.equal(findXhsBottomRedButtonCandidatesFromRgba(tinySwitch).length, 0);

function fakeButtonPage({
  roleLabels = [],
  xhsButtonLabels = [],
  postClickSuccess = false,
  postClickFailure = false,
  throwOnScreenshot = false,
  humanReturnSnapshots = null
} = {}) {
  let humanSnapshotIndex = 0;
  const page = {
    clickedLabels: [],
    screenshotCalls: 0,
    mouse: {
      async click(x, y) {
        page.clickedLabels.push(`point:${Math.round(x)},${Math.round(y)}`);
        page.clicked = true;
      }
    },
    getByRole(role, options = {}) {
      assert.equal(role, "button");
      return fakeLocatorCollection(page, roleLabels.filter((label) => options.name.test(label)));
    },
    locator(selector) {
      if (selector === "#web xhs-publish-btn button, xhs-publish-btn button") {
        return fakeLocatorCollection(page, xhsButtonLabels);
      }
      if (String(selector).startsWith("xpath=")) {
        return fakeLocatorCollection(page, []);
      }
      return {
        async count() { return 0; },
        async evaluateAll() { return []; },
        first() { return fakeLocator(page, ""); },
        nth() { return fakeLocator(page, ""); }
      };
    },
    async evaluate(fn) {
      const source = String(fn || "");
      if (source.includes("rect.width > 40") && source.includes("xhs-publish-btn")) return null;
      if (source.includes("document.body.querySelectorAll(\"*\"")) return [];
      if (source.includes("returnButtonVisible") || source.includes("mediaPreviewCount")) {
        if (Array.isArray(humanReturnSnapshots) && humanReturnSnapshots.length > 0) {
          const snapshot = humanReturnSnapshots[Math.min(humanSnapshotIndex, humanReturnSnapshots.length - 1)];
          humanSnapshotIndex += 1;
          return snapshot;
        }
      }
      return {
        url: page.clicked ? "https://creator.xiaohongshu.com/creator/home" : "https://creator.xiaohongshu.com/publish/publish",
        title: "",
        success_text: page.clicked && postClickSuccess ? "定时发布成功" : null,
        failure_text: page.clicked && postClickFailure ? "发布失败" : null,
        editor_visible: !page.clicked,
        publish_control_visible: !page.clicked,
        publish_button_disabled: false
      };
    },
    async waitForTimeout() {},
    async screenshot() {
      page.screenshotCalls += 1;
      if (throwOnScreenshot) throw new Error("screenshot should not be called");
      return Buffer.alloc(0);
    },
    viewportSize() {
      return { width: 1600, height: 1000 };
    },
    url() {
      return page.clicked ? "https://creator.xiaohongshu.com/creator/home" : "https://creator.xiaohongshu.com/publish/publish";
    }
  };
  return page;
}

function filledPublishSnapshot() {
  return {
    url: "https://creator.xiaohongshu.com/publish/publish",
    title: "",
    success_text: null,
    failure_text: null,
    has_publish_url: true,
    media_preview_count: 5,
    image_preview_count: 5,
    blob_media_count: 0,
    upload_input_count: 1,
    text_input_value_length: 32,
    editor_text_length: 160,
    publish_control_visible: true,
    return_button_visible: false
  };
}

function cleanPublishSnapshot() {
  return {
    url: "https://creator.xiaohongshu.com/publish/publish",
    title: "",
    success_text: null,
    failure_text: null,
    has_publish_url: true,
    media_preview_count: 0,
    image_preview_count: 0,
    blob_media_count: 0,
    upload_input_count: 1,
    text_input_value_length: 0,
    editor_text_length: 0,
    publish_control_visible: false,
    return_button_visible: false
  };
}

function filledWechatPublishSnapshot() {
  return {
    ...filledPublishSnapshot(),
    url: "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate",
    has_publish_url: true,
    clean_publish_marker_visible: false
  };
}

function cleanWechatPublishSnapshot() {
  return {
    ...cleanPublishSnapshot(),
    url: "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate",
    has_publish_url: true,
    clean_publish_marker_visible: true
  };
}

function wechatManagementSnapshot() {
  return {
    ...cleanPublishSnapshot(),
    url: "https://channels.weixin.qq.com/platform/post/finderNewLifePostList",
    has_publish_url: false,
    has_wechat_management_url: true,
    clean_publish_marker_visible: false,
    wechat_management_visible: true,
    wechat_publish_entry_visible: true
  };
}

function filledDouyinPublishSnapshot() {
  return {
    ...filledPublishSnapshot(),
    url: "https://creator.douyin.com/creator-micro/content/post/image",
    has_publish_url: true,
    has_douyin_publish_url: true,
    douyin_publish_entry_visible: false
  };
}

function cleanDouyinPublishSnapshot() {
  return {
    ...cleanPublishSnapshot(),
    url: "https://creator.douyin.com/creator-micro/content/upload?default-tab=3",
    has_publish_url: true,
    has_douyin_publish_url: true,
    upload_input_count: 1,
    douyin_publish_entry_visible: true
  };
}

function fakeLocatorCollection(page, labels) {
  return {
    async count() { return labels.length; },
    first() { return fakeLocator(page, labels[0]); },
    nth(index) { return fakeLocator(page, labels[index]); },
    async evaluateAll() { return []; }
  };
}

function fakeLocator(page, label) {
  return {
    async click() {
      page.clickedLabels.push(label);
      page.clicked = true;
    },
    async innerText() {
      return label;
    }
  };
}

function redCanvas(width, height, rects) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
  for (const rect of rects) {
    for (let y = rect.top; y < rect.top + rect.height; y += 1) {
      for (let x = rect.left; x < rect.left + rect.width; x += 1) {
        const index = (y * width + x) * 4;
        data[index] = 255;
        data[index + 1] = 36;
        data[index + 2] = 80;
        data[index + 3] = 255;
      }
    }
  }
  return { data, width, height };
}

const wechatBlockedCollectionPage = fakeButtonPage({
  humanReturnSnapshots: [
    filledWechatPublishSnapshot(),
    wechatManagementSnapshot()
  ]
});
const wechatBlockedCollection = await maybeConfirmScheduledPublish({
  page: wechatBlockedCollectionPage,
  plan: wechatScheduledPlan,
  steps: doneSteps.map((item) => item.name === "collection" ? { ...item, status: "needs_human" } : item),
  confirmScheduledPublish: true,
  manualConfirmationTimeoutMs: 50,
  manualConfirmationPollMs: 1
});
assert.equal(wechatBlockedCollection.status, "done");
assert.equal(wechatBlockedCollection.details.reason_code, "scheduled_publish_confirmed_by_human");
assert.deepEqual(wechatBlockedCollection.details.operator_accepted_blocked_steps, ["collection"]);
assert.equal(wechatBlockedCollection.details.post_click_outcome.signal, "returned_to_publish_page");
assert.equal(wechatBlockedCollection.details.post_click_outcome.last_snapshot.has_wechat_management_url, true);

const wechatBlockedCollectionAndSchedulePage = fakeButtonPage({
  humanReturnSnapshots: [
    filledWechatPublishSnapshot(),
    wechatManagementSnapshot()
  ]
});
const wechatBlockedCollectionAndSchedule = await maybeConfirmScheduledPublish({
  page: wechatBlockedCollectionAndSchedulePage,
  plan: wechatScheduledPlan,
  steps: doneSteps.map((item) => {
    if (item.name === "collection") return { ...item, status: "needs_human" };
    if (item.name === "schedule") return { ...item, status: "needs_human", message: "Schedule option selected, but datetime was not verified." };
    return item;
  }),
  confirmScheduledPublish: true,
  manualConfirmationTimeoutMs: 50,
  manualConfirmationPollMs: 1
});
assert.equal(wechatBlockedCollectionAndSchedule.status, "done");
assert.deepEqual(wechatBlockedCollectionAndSchedule.details.operator_accepted_blocked_steps.sort(), ["collection", "schedule"]);

const douyinManualHandoffPage = fakeButtonPage({
  humanReturnSnapshots: [
    filledDouyinPublishSnapshot(),
    cleanDouyinPublishSnapshot()
  ]
});
const douyinManualHandoff = await maybeConfirmScheduledPublish({
  page: douyinManualHandoffPage,
  plan: scheduledPlan,
  steps: doneSteps,
  confirmScheduledPublish: true,
  manualConfirmationTimeoutMs: 50,
  manualConfirmationPollMs: 1
});
assert.equal(douyinManualHandoff.status, "done");
assert.equal(douyinManualHandoff.details.reason_code, "scheduled_publish_confirmed_by_human");
assert.equal(douyinManualHandoff.details.click_count, 0);
assert.equal(douyinManualHandoffPage.clickedLabels.length, 0);
assert.equal(douyinManualHandoff.details.post_click_outcome.last_snapshot.has_douyin_publish_url, true);

const douyinBlockedCollectionPage = fakeButtonPage({
  humanReturnSnapshots: [
    filledDouyinPublishSnapshot(),
    cleanDouyinPublishSnapshot()
  ]
});
const douyinBlockedCollection = await maybeConfirmScheduledPublish({
  page: douyinBlockedCollectionPage,
  plan: scheduledPlan,
  steps: doneSteps.map((item) => item.name === "collection" ? { ...item, status: "needs_human" } : item),
  confirmScheduledPublish: true,
  manualConfirmationTimeoutMs: 50,
  manualConfirmationPollMs: 1
});
assert.equal(douyinBlockedCollection.status, "done");
assert.deepEqual(douyinBlockedCollection.details.operator_accepted_blocked_steps, ["collection"]);

const douyinBlockedSchedulePage = fakeButtonPage({
  humanReturnSnapshots: [
    filledDouyinPublishSnapshot(),
    cleanDouyinPublishSnapshot()
  ]
});
const douyinBlockedSchedule = await maybeConfirmScheduledPublish({
  page: douyinBlockedSchedulePage,
  plan: scheduledPlan,
  steps: doneSteps.map((item) => item.name === "schedule" ? { ...item, status: "needs_human" } : item),
  confirmScheduledPublish: true,
  manualConfirmationTimeoutMs: 50,
  manualConfirmationPollMs: 1
});
assert.equal(douyinBlockedSchedule.status, "needs_human");
assert.equal(douyinBlockedSchedule.details.reason_code, "schedule_not_verified");

console.log("scheduled publish tests passed.");
