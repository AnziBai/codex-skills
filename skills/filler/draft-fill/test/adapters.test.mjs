import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  appendPlainHashTags,
  adapters,
  chooseWechatChannelsCollectionName,
  classifyWechatChannelsInput,
  collectionInspectors,
  douyinAdapter,
  extractVisibleUploadedImageCount,
  inspectCollections,
  isWechatChannelsImageEntryButton,
  isWechatChannelsPublishButton,
  normalizeCollectionNames,
  parseWechatChannelsCarouselCount,
  redactedTextEvidence,
  textContainsContentFingerprint,
  textContainsPlainTags,
  wechatChannelsAdapter,
  xiaohongshuAdapter
} from "../src/adapters.mjs";
import { lockFilePath } from "../src/browser-profile.mjs";
import { collectionCachePath, collectionCacheStep, readCollectionCache, writeCollectionCache } from "../src/collection-cache.mjs";
import { redactedArtifactHtml, targetLogDir, validatePlan } from "../src/utils.mjs";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.mjs");

assert.equal(typeof xiaohongshuAdapter.run, "function");
assert.equal(typeof douyinAdapter.run, "function");
assert.equal(typeof wechatChannelsAdapter.run, "function");
assert.deepEqual(Object.keys(adapters).sort(), ["douyin", "wechat_channels", "xiaohongshu"]);
assert.equal(adapters.xiaohongshu, xiaohongshuAdapter);
assert.equal(adapters.douyin, douyinAdapter);
assert.equal(adapters.wechat_channels, wechatChannelsAdapter);
assert.deepEqual(Object.keys(collectionInspectors).sort(), ["douyin", "wechat_channels", "xiaohongshu"]);

assert.deepEqual(redactedTextEvidence("alpha\nbeta", "sample"), {
  sample_present: true,
  sample_length: 10,
  sample_line_count: 2
});
assert.equal(JSON.stringify(redactedTextEvidence("sensitive draft text")).includes("sensitive"), false);

const mismatchedRunSteps = await douyinAdapter.run({ page: { goto: () => { throw new Error("should not navigate"); } }, plan: { platform: "xiaohongshu" } });
assert.equal(mismatchedRunSteps[0].name, "platform_identity");
assert.equal(mismatchedRunSteps[0].status, "failed");
assert.equal(mismatchedRunSteps[0].details.expected_platform, "douyin");

const mismatchedXhsSteps = await xiaohongshuAdapter.run({ page: { goto: () => { throw new Error("should not navigate"); } }, plan: { platform: "wechat_channels" } });
assert.equal(mismatchedXhsSteps[0].name, "platform_identity");
assert.equal(mismatchedXhsSteps[0].status, "failed");
assert.equal(mismatchedXhsSteps[0].details.expected_platform, "xiaohongshu");

const mismatchedWechatSteps = await wechatChannelsAdapter.run({ page: { goto: () => { throw new Error("should not navigate"); } }, plan: { platform: "douyin" } });
assert.equal(mismatchedWechatSteps[0].name, "platform_identity");
assert.equal(mismatchedWechatSteps[0].status, "failed");
assert.equal(mismatchedWechatSteps[0].details.expected_platform, "wechat_channels");

const fallbackCollections = await inspectCollections({ page: null, plan: { platform: "unknown" }, logDir: "" });
assert.equal(fallbackCollections.status, "failed");
assert.equal(fallbackCollections.collections.length, 0);

const dispatchPage = fakeSignatureFailurePage("https://example.test/not-platform");
const dispatchCollections = await inspectCollections({ page: dispatchPage, plan: { platform: "xiaohongshu" }, logDir: "" });
assert.equal(dispatchPage.gotoCalls, 1);
assert.equal(dispatchCollections.status, "needs_human");
assert.equal(dispatchCollections.steps[0].name, "page_signature");

const douyinDispatchPage = fakeSignatureFailurePage("https://example.test/not-platform");
const douyinCollections = await inspectCollections({ page: douyinDispatchPage, plan: { platform: "douyin" }, logDir: "" });
assert.equal(douyinDispatchPage.gotoCalls, 1);
assert.equal(douyinCollections.status, "needs_human");
assert.equal(douyinCollections.steps[0].name, "page_signature");

const wechatDispatchPage = fakeThrowingGotoPage();
const wechatCollections = await inspectCollections({ page: wechatDispatchPage, plan: { platform: "wechat_channels", kind: "image", asset_paths: { images: ["asset.png"] } }, logDir: "" });
assert.equal(wechatDispatchPage.gotoCalls, 1);
assert.equal(wechatCollections.status, "needs_human");
assert.equal(wechatCollections.steps[0].name, "composer");

assert.equal(extractVisibleUploadedImageCount("编辑图片\n已添加5张图片\n继续添加"), 5);
assert.equal(extractVisibleUploadedImageCount("上传完成\n共 3 张图片"), 3);
assert.equal(extractVisibleUploadedImageCount("上传完成，但没有数量"), null);

assert.equal(textContainsPlainTags("正文内容\n\n#股票知识 #交易思维", ["股票知识"]), true);
assert.equal(textContainsPlainTags("正文内容\n\n股票知识: selected", ["股票知识"]), false);
assert.equal(textContainsPlainTags("正文内容 #量价分析", ["量价分析"]), true);
assert.equal(appendPlainHashTags("正文", ["带鱼", "#假突破"]), "正文\n\n#带鱼 #假突破");
assert.equal(appendPlainHashTags("正文\n\n#带鱼", ["带鱼", "量价"]), "正文\n\n#带鱼\n\n#量价");

assert.equal(
  textContainsContentFingerprint(
    "\u7b2c1\u96c6|\u5047\u7a81\u7834\u592a\u591a\uff1f\u7a81\u7834\u4e0d\u91cd\u8981\uff0c\u7a81\u7834\u80cc\u540e\u7684\u91cf\u4ef7\u8d28\u91cf\u624d\u91cd\u8981\u3002 #\u80a1\u7968\u77e5\u8bc6",
    "\u7a81\u7834\u4e0d\u91cd\u8981\uff0c\u7a81\u7834\u80cc\u540e\u7684\u91cf\u4ef7\u8d28\u91cf\u624d\u91cd\u8981\u3002"
  ),
  true
);
assert.equal(textContainsContentFingerprint("\u53ea\u6709\u6807\u9898\u6ca1\u6709\u6b63\u6587", "\u7a81\u7834\u4e0d\u91cd\u8981"), false);

assert.equal(parseWechatChannelsCarouselCount("01 / 05"), 5);
assert.equal(parseWechatChannelsCarouselCount("1/5"), 5);
assert.equal(parseWechatChannelsCarouselCount("selected images"), null);

assert.equal(classifyWechatChannelsInput({ placeholder: "\u586b\u5199\u6807\u9898, 22\u4e2a\u5b57\u7b26\u5185" }), "title");
assert.equal(classifyWechatChannelsInput({ placeholder: "\u8bf7\u9009\u62e9\u53d1\u8868\u65f6\u95f4" }), "schedule");
assert.equal(classifyWechatChannelsInput({ placeholder: "" }), "unknown");

const wechatInputs = [
  { placeholder: "\u586b\u5199\u6807\u9898, 22\u4e2a\u5b57\u7b26\u5185", value: "2026-05-14 21:45" },
  { placeholder: "\u8bf7\u9009\u62e9\u53d1\u8868\u65f6\u95f4", value: "2026-05-13 14:00" }
];
assert.equal(wechatInputs.find((item) => classifyWechatChannelsInput(item) === "schedule").value, "2026-05-13 14:00");

assert.equal(isWechatChannelsPublishButton({ tag: "BUTTON", text: "\u53d1\u8868" }), true);
assert.equal(isWechatChannelsPublishButton({ tag: "DIV", text: "\u4fdd\u5b58\u8349\u7a3f \u624b\u673a\u9884\u89c8 \u53d1\u8868" }), false);
assert.equal(isWechatChannelsPublishButton({ tag: "DIV", className: "weui-desktop-btn_primary", text: "\u53d1\u8868" }), true);
assert.equal(isWechatChannelsPublishButton({ tag: "BUTTON", text: "\u53d1\u5e03\u56fe\u6587" }), false);
assert.equal(isWechatChannelsPublishButton({ tag: "BUTTON", text: "\u53d1\u8868\u56fe\u6587" }), false);
assert.equal(isWechatChannelsImageEntryButton("\u53d1\u8868\u56fe\u6587"), true);
assert.equal(isWechatChannelsImageEntryButton("\u53d1\u8868 \u56fe\u6587"), true);
assert.equal(isWechatChannelsImageEntryButton("\u53d1\u5e03\u56fe\u6587"), true);
assert.equal(isWechatChannelsImageEntryButton("\u65b0\u5efa\u56fe\u6587"), true);
assert.equal(isWechatChannelsImageEntryButton("\u53d1\u8868"), false);
assert.equal(isWechatChannelsImageEntryButton("\u4fdd\u5b58\u8349\u7a3f \u53d1\u8868"), false);

assert.deepEqual(
  normalizeCollectionNames(["  量价课程  ", "选择合集", "量价课程", "取消", "宏观复盘", "加载中", "", "Add to collection", "宏观复盘 "]),
  ["量价课程", "宏观复盘"]
);
assert.deepEqual(normalizeCollectionNames(["宽论", "3条", "2篇", "10 items", "合集"]), ["宽论"]);
assert.equal(chooseWechatChannelsCollectionName(["宽论", "宏观复盘"], "宽论"), "宽论");
assert.equal(chooseWechatChannelsCollectionName(["宽论长期合集"], "宽论"), "宽论长期合集");
assert.equal(chooseWechatChannelsCollectionName(["宏观复盘"], "宽论"), null);

const cacheProfile = `adapter-test-${Date.now()}`;
const cacheWrite = await writeCollectionCache({
  profileName: cacheProfile,
  platform: "xiaohongshu",
  accountFingerprint: "acct-1",
  accountVerified: true,
  collections: ["量价课程", "宏观复盘"],
  sourceArtifacts: { screenshot: "logs/x/collections.png" },
  now: new Date("2026-05-13T00:00:00.000Z")
});
const rawCache = await fs.readFile(cacheWrite.path, "utf8");
assert.match(rawCache, /量价课程/);
const cacheRead = await readCollectionCache({
  profileName: cacheProfile,
  platform: "xiaohongshu",
  accountFingerprint: "acct-1",
  now: new Date("2026-05-14T00:00:00.000Z")
});
assert.equal(cacheRead.status, "done");
assert.deepEqual(cacheRead.cache.collections, ["量价课程", "宏观复盘"]);

const accountMismatch = await readCollectionCache({
  profileName: cacheProfile,
  platform: "xiaohongshu",
  accountFingerprint: "acct-2",
  now: new Date("2026-05-14T00:00:00.000Z")
});
assert.equal(accountMismatch.status, "needs_human");
assert.equal(accountMismatch.error_code, "collection_cache_account_mismatch");

const platformMismatch = await readCollectionCache({
  profileName: cacheProfile,
  platform: "wechat_channels",
  accountFingerprint: "acct-1",
  now: new Date("2026-05-14T00:00:00.000Z")
});
assert.equal(platformMismatch.status, "needs_human");
assert.equal(platformMismatch.error_code, "collection_cache_platform_mismatch");

const profileMismatch = await readCollectionCache({
  profileName: `${cacheProfile}-missing`,
  platform: "xiaohongshu",
  accountFingerprint: "acct-1",
  now: new Date("2026-05-14T00:00:00.000Z")
});
assert.equal(profileMismatch.status, "needs_human");
assert.equal(profileMismatch.error_code, "collection_cache_missing");

const unverifiedProfile = `${cacheProfile}-unverified`;
const unverifiedWrite = await writeCollectionCache({
  profileName: unverifiedProfile,
  platform: "xiaohongshu",
  accountId: "acct-hint-only",
  collections: ["hint-only"],
  now: new Date("2026-05-13T00:00:00.000Z")
});
const unverifiedRead = await readCollectionCache({
  profileName: unverifiedProfile,
  platform: "xiaohongshu",
  accountFingerprint: "acct-hint-only",
  now: new Date("2026-05-14T00:00:00.000Z")
});
assert.equal(unverifiedRead.status, "needs_human");
assert.equal(unverifiedRead.error_code, "collection_cache_account_unverified");
assert.equal("path" in collectionCacheStep(unverifiedRead, "hint-only").details, false);

const callerFingerprintOnlyProfile = `${cacheProfile}-caller-fingerprint-only`;
const callerFingerprintOnlyWrite = await writeCollectionCache({
  profileName: callerFingerprintOnlyProfile,
  platform: "xiaohongshu",
  accountFingerprint: "caller-supplied",
  collections: ["caller-only"],
  now: new Date("2026-05-13T00:00:00.000Z")
});
const callerFingerprintOnlyRead = await readCollectionCache({
  profileName: callerFingerprintOnlyProfile,
  platform: "xiaohongshu",
  accountFingerprint: "caller-supplied",
  now: new Date("2026-05-14T00:00:00.000Z")
});
assert.equal(callerFingerprintOnlyRead.status, "needs_human");
assert.equal(callerFingerprintOnlyRead.error_code, "collection_cache_account_unverified");

const invalidProfileRead = await readCollectionCache({
  profileName: "../bad",
  platform: "xiaohongshu",
  accountFingerprint: "acct-1",
  now: new Date("2026-05-14T00:00:00.000Z")
});
assert.equal(invalidProfileRead.status, "needs_human");
assert.equal(invalidProfileRead.error_code, "invalid_profile_name");
assert.equal("path_hint" in invalidProfileRead, false);

const unreadableProfile = `${cacheProfile}-unreadable`;
const unreadablePath = collectionCachePath(unreadableProfile);
await fs.mkdir(path.dirname(unreadablePath), { recursive: true });
await fs.writeFile(unreadablePath, "{not-json", "utf8");
const unreadableRead = await readCollectionCache({
  profileName: unreadableProfile,
  platform: "xiaohongshu",
  accountFingerprint: "acct-1",
  now: new Date("2026-05-14T00:00:00.000Z")
});
assert.equal(unreadableRead.status, "needs_human");
assert.equal(unreadableRead.error_code, "collection_cache_unreadable");
assert.equal(JSON.stringify(unreadableRead).includes("C:"), false);

const missingCollectionStep = collectionCacheStep(cacheRead, "不存在的合集");
assert.equal(missingCollectionStep.status, "needs_human");
assert.match(missingCollectionStep.message, /inspect-collections/);

await fs.rm(path.dirname(cacheWrite.path), { recursive: true, force: true });
await fs.rm(path.dirname(unverifiedWrite.path), { recursive: true, force: true });
await fs.rm(path.dirname(unreadablePath), { recursive: true, force: true });

const cliWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "inspect-collections-dry-test-"));
const cliAsset = path.join(cliWorkDir, "asset.png");
await fs.writeFile(cliAsset, "asset", "utf8");
const cliProfile = `adapter-cli-${Date.now()}`;
const cliPlan = {
  schema_version: "1.0",
  plan_type: "social_publisher_draft_plan",
  generated_at: "2026-05-13T00:00:00.000Z",
  work_id: "inspect-dry",
  target_id: "inspect-dry-target",
  platform: "xiaohongshu",
  kind: "image",
  account_id: "hint-only",
  account_fingerprint: "verified-fingerprint",
  source_work_dir: cliWorkDir,
  asset_paths: { cover: cliAsset, images: [cliAsset], video: null },
  title: "Inspect dry",
  body: "Inspect dry body",
  tags: ["tag"],
  collection: "trusted-collection",
  declaration: { mode: "original", label: "original" },
  music: { strategy: "none", name: null },
  schedule: { mode: "immediate", publish_at: null },
  stop_before_publish: true,
  safety: { never_click_publish: true, no_system_clipboard: true }
};
await fs.writeFile(path.join(cliWorkDir, "draft-plan.json"), `${JSON.stringify(cliPlan, null, 2)}\n`, "utf8");
await assert.rejects(
  execFileAsync(process.execPath, [cliPath, "inspect-collections", "--work-dir", cliWorkDir, "--profile-name", `${cliProfile}-missing`, "--dry-run", "--json"]),
  (error) => {
    assert.equal(error.code, 4);
    const payload = JSON.parse(error.stdout);
    assert.equal(payload.overall_status, "needs_human");
    return true;
  }
);
const trustedWrite = await writeCollectionCache({
  profileName: cliProfile,
  platform: "xiaohongshu",
  accountFingerprint: "verified-fingerprint",
  accountVerified: true,
  collections: ["trusted-collection"],
  now: new Date("2026-05-13T00:00:00.000Z")
});
const { stdout: trustedStdout } = await execFileAsync(process.execPath, [cliPath, "inspect-collections", "--work-dir", cliWorkDir, "--profile-name", cliProfile, "--dry-run", "--json"]);
const trustedPayload = JSON.parse(trustedStdout);
assert.equal(trustedPayload.overall_status, "done");
assert.equal(trustedPayload.collection_cache.account_verified, true);

const unsupportedInspectProfile = `unsupported-inspect-${Date.now()}`;
await fs.writeFile(path.join(cliWorkDir, "draft-plan.json"), `${JSON.stringify({
  ...cliPlan,
  target_id: "unsupported-inspect",
  platform: "unsupported_platform",
  collection: "whatever"
}, null, 2)}\n`, "utf8");
await assert.rejects(
  execFileAsync(process.execPath, [cliPath, "inspect-collections", "--work-dir", cliWorkDir, "--profile-name", unsupportedInspectProfile, "--json"]),
  (error) => {
    assert.equal(error.code, 2);
    const payload = JSON.parse(error.stdout);
    assert.equal(payload.error_code, "unsupported_collection_inspector");
    return true;
  }
);
await assert.rejects(fs.access(lockFilePath(unsupportedInspectProfile)), { code: "ENOENT" });
await fs.writeFile(path.join(cliWorkDir, "draft-plan.json"), `${JSON.stringify(cliPlan, null, 2)}\n`, "utf8");

const badTargetPlan = { ...cliPlan, target_id: "../../escape" };
const badTargetErrors = await validatePlan(badTargetPlan, cliWorkDir, "../../escape");
assert.equal(badTargetErrors.some((item) => item.includes("target_id must be a simple stable id")), true);
assert.throws(() => targetLogDir(cliWorkDir, "../../escape"), /target_id must be a simple stable id/);
await fs.writeFile(path.join(cliWorkDir, "draft-plan.json"), `${JSON.stringify(badTargetPlan, null, 2)}\n`, "utf8");
await assert.rejects(
  execFileAsync(process.execPath, [cliPath, "draft-fill", "--work-dir", cliWorkDir, "--dry-run", "--json"]),
  (error) => {
    assert.equal(error.code, 2);
    const payload = JSON.parse(error.stdout);
    assert.equal(payload.overall_status, "failed");
    return true;
  }
);
await assert.rejects(
  execFileAsync(process.execPath, [cliPath, "setup", "--profile-name", "../escape", "--json"]),
  assertInvalidProfileCliError
);
await assert.rejects(
  execFileAsync(process.execPath, [cliPath, "setup", "--profile-name", "bad:profile", "--json"]),
  assertInvalidProfileCliError
);
await assert.rejects(
  execFileAsync(process.execPath, [cliPath, "setup", "--profile-name", "con", "--json"]),
  assertInvalidProfileCliError
);
await assert.rejects(
  execFileAsync(process.execPath, [cliPath, "setup", "--profile-name", "ok ", "--json"]),
  assertInvalidProfileCliError
);
const redactedHtml = redactedArtifactHtml("test", "https://example.com/path?token=secret#frag");
assert.equal(redactedHtml.includes("token=secret"), false);
assert.match(redactedHtml, /Raw DOM is intentionally not persisted/);

await fs.rm(path.dirname(trustedWrite.path), { recursive: true, force: true });
await fs.rm(cliWorkDir, { recursive: true, force: true });
await fs.rm(path.dirname(callerFingerprintOnlyWrite.path), { recursive: true, force: true });

console.log("adapter helper tests passed.");

function assertInvalidProfileCliError(error) {
  assert.equal(error.code, 2);
  const payload = JSON.parse(error.stdout);
  assert.equal(payload.error_code, "invalid_profile_name");
  return true;
}

function fakeSignatureFailurePage(url) {
  return {
    gotoCalls: 0,
    async goto() {
      this.gotoCalls += 1;
    },
    async waitForLoadState() {},
    url() {
      return url;
    },
    locator() {
      return {
        async innerText() {
          return "unrecognized page";
        }
      };
    }
  };
}

function fakeThrowingGotoPage() {
  return {
    gotoCalls: 0,
    async goto() {
      this.gotoCalls += 1;
      throw new Error("synthetic navigation stop");
    },
    async screenshot() {},
    url() {
      return "https://channels.weixin.qq.com/platform/post/finderNewLifePostList";
    }
  };
}
