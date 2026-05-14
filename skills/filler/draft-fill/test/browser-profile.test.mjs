import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  ProfileLockHeldError,
  acquireProfileLock,
  lockFilePath,
  releaseProfileLock
} from "../src/browser-profile.mjs";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.mjs");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-profile-lock-"));

const profileName = "xhs-main";
const lockPath = lockFilePath(profileName, root);
const lock = await acquireProfileLock({
  profilesRoot: root,
  profileName,
  platform: "xiaohongshu",
  targetId: "target-1",
  browserLifecycle: "keep_open",
  pid: 12345,
  now: () => new Date("2026-05-13T01:02:03.000Z"),
  isProcessAlive: () => false
});

assert.equal(lock.path, lockPath);
assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), {
  pid: 12345,
  platform: "xiaohongshu",
  target_id: "target-1",
  started_at: "2026-05-13T01:02:03.000Z",
  profile_name: "xhs-main",
  browser_lifecycle: "keep_open"
});

await releaseProfileLock(lock);
await assert.rejects(fs.access(lockPath), { code: "ENOENT" });

await acquireProfileLock({
  profilesRoot: root,
  profileName,
  platform: "xiaohongshu",
  targetId: "target-2",
  browserLifecycle: "close_on_finish",
  pid: 22222,
  isProcessAlive: () => false
});

await assert.rejects(
  acquireProfileLock({
    profilesRoot: root,
    profileName,
    platform: "xiaohongshu",
    targetId: "target-3",
    browserLifecycle: "keep_open",
    pid: 33333,
    isProcessAlive: () => true
  }),
  (error) => {
    assert.equal(error instanceof ProfileLockHeldError, true);
    assert.equal(error.errorCode, "profile_lock_held");
    assert.equal(error.payload.error_code, "profile_lock_held");
    assert.equal(error.payload.profile_name, profileName);
    assert.equal(error.payload.platform, "xiaohongshu");
    assert.equal(error.payload.browser_lifecycle, "close_on_finish");
    assert.equal(typeof error.payload.started_at, "string");
    assert.equal("lock_path" in error.payload, false);
    assert.equal("lock" in error.payload, false);
    assert.equal(JSON.stringify(error.payload).includes("target-2"), false);
    return true;
  }
);

const recovered = await acquireProfileLock({
  profilesRoot: root,
  profileName,
  platform: "douyin",
  targetId: "target-4",
  browserLifecycle: "keep_open",
  pid: 44444,
  isProcessAlive: () => false
});
const recoveredContent = JSON.parse(await fs.readFile(lockPath, "utf8"));
assert.equal(recoveredContent.pid, 44444);
assert.equal(recoveredContent.platform, "douyin");
assert.equal(recoveredContent.target_id, "target-4");
await releaseProfileLock(recovered);

await acquireProfileLock({
  profilesRoot: root,
  profileName,
  platform: "xiaohongshu",
  targetId: "keep-open-stale",
  browserLifecycle: "keep_open",
  pid: 55555,
  isProcessAlive: () => false
});
await assert.rejects(
  acquireProfileLock({
    profilesRoot: root,
    profileName,
    platform: "xiaohongshu",
    targetId: "target-after-keep-open",
    browserLifecycle: "close_on_finish",
    pid: 66666,
    isProcessAlive: () => false
  }),
  (error) => {
    assert.equal(error instanceof ProfileLockHeldError, true);
    assert.equal(error.payload.error_code, "profile_lock_held");
    assert.equal(error.payload.status, "stale_keep_open_requires_manual_cleanup");
    assert.equal(error.payload.browser_lifecycle, "keep_open");
    assert.equal(JSON.stringify(error.payload).includes("keep-open-stale"), false);
    return true;
  }
);
await fs.rm(lockPath, { force: true });

await acquireProfileLock({
  profilesRoot: root,
  profileName,
  platform: "xiaohongshu",
  targetId: "stale-before-race",
  browserLifecycle: "close_on_finish",
  pid: 77777,
  isProcessAlive: () => false
});
await assert.rejects(
  acquireProfileLock({
    profilesRoot: root,
    profileName,
    platform: "xiaohongshu",
    targetId: "race-loser",
    browserLifecycle: "close_on_finish",
    pid: 88888,
    isProcessAlive: () => false,
    onBeforeStaleRemove: async () => {
      await fs.writeFile(lockPath, `${JSON.stringify({
        pid: process.pid,
        platform: "xiaohongshu",
        target_id: "fresh-winner",
        started_at: "2026-05-13T02:00:00.000Z",
        profile_name: profileName,
        browser_lifecycle: "close_on_finish"
      }, null, 2)}\n`, "utf8");
    }
  }),
  (error) => {
    assert.equal(error instanceof ProfileLockHeldError, true);
    assert.equal(error.payload.error_code, "profile_lock_held");
    assert.equal(error.payload.status, "lock_changed_during_stale_recovery");
    assert.equal(JSON.stringify(error.payload).includes("fresh-winner"), false);
    return true;
  }
);
const changedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
assert.equal(changedLock.target_id, "fresh-winner");
await fs.rm(lockPath, { force: true });

const dryRunProfile = "dry-run-profile";
assert.equal(lockFilePath(dryRunProfile, root), path.join(root, "dry-run-profile.draft-fill.lock"));
await assert.rejects(fs.access(lockFilePath(dryRunProfile, root)), { code: "ENOENT" });

const dryRunWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-dry-run-"));
const dryRunAsset = path.join(dryRunWorkDir, "asset.png");
await fs.writeFile(dryRunAsset, Buffer.from("iVBORw0KGgo=", "base64"));
await fs.writeFile(
  path.join(dryRunWorkDir, "draft-plan.json"),
  `${JSON.stringify({
    schema_version: "1.0",
    plan_type: "social_publisher_draft_plan",
    generated_at: "2026-05-13T00:00:00.000Z",
    work_id: "dry-run-work",
    target_id: "dry-run-target",
    platform: "xiaohongshu",
    kind: "image",
    account_id: "dry-run-account",
    source_work_dir: dryRunWorkDir,
    asset_paths: { cover: dryRunAsset, images: [dryRunAsset], video: null },
    title: "Dry run",
    body: "Dry run body",
    tags: ["dry"],
    collection: "dry",
    declaration: { mode: "original", label: "original" },
    music: { strategy: "none", name: null },
    schedule: { mode: "immediate", publish_at: null },
    stop_before_publish: true,
    safety: { never_click_publish: true, no_system_clipboard: true }
  }, null, 2)}\n`,
  "utf8"
);
const dryRunLockPath = lockFilePath(`dry-run-${Date.now()}`);
const dryRunCliProfile = path.basename(dryRunLockPath, ".draft-fill.lock");
await fs.rm(dryRunLockPath, { force: true });
const { stdout } = await execFileAsync(process.execPath, [
  cliPath,
  "draft-fill",
  "--work-dir",
  dryRunWorkDir,
  "--profile-name",
  dryRunCliProfile,
  "--dry-run",
  "--json"
]);
const dryRunResult = JSON.parse(stdout);
assert.equal(dryRunResult.ok, undefined);
assert.equal(dryRunResult.dry_run, true);
await assert.rejects(fs.access(dryRunLockPath), { code: "ENOENT" });

await assert.rejects(
  execFileAsync(process.execPath, [
    cliPath,
    "draft-fill",
    "--work-dir",
    dryRunWorkDir,
    "--profile-name",
    dryRunCliProfile,
    "--confirm-intake",
    "false",
    "--json"
  ]),
  (error) => {
    assert.equal(error.code, 4);
    const payload = JSON.parse(error.stdout);
    assert.equal(payload.overall_status, "needs_human");
    assert.equal(payload.steps.some((item) => item.name === "preflight_intake" && item.status === "needs_human"), true);
    return true;
  }
);
await assert.rejects(fs.access(dryRunLockPath), { code: "ENOENT" });
await fs.rm(dryRunWorkDir, { recursive: true, force: true });

const activeCliWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-active-lock-"));
const activeCliAsset = path.join(activeCliWorkDir, "asset.png");
await fs.writeFile(activeCliAsset, "asset", "utf8");
await fs.writeFile(
  path.join(activeCliWorkDir, "draft-plan.json"),
  `${JSON.stringify({
    schema_version: "1.0",
    plan_type: "social_publisher_draft_plan",
    generated_at: "2026-05-13T00:00:00.000Z",
    work_id: "active-lock-work",
    target_id: "active-lock-target",
    platform: "xiaohongshu",
    kind: "image",
    account_id: "active-lock-account",
    source_work_dir: activeCliWorkDir,
    asset_paths: { cover: activeCliAsset, images: [activeCliAsset], video: null },
    title: "Active lock",
    body: "Active lock body",
    tags: ["lock"],
    collection: "lock",
    declaration: { mode: "original", label: "original" },
    music: { strategy: "none", name: null },
    schedule: { mode: "immediate", publish_at: null },
    stop_before_publish: true,
    safety: { never_click_publish: true, no_system_clipboard: true }
  }, null, 2)}\n`,
  "utf8"
);
const activeCliProfile = `active-lock-${Date.now()}`;
const activeCliLock = await acquireProfileLock({
  profileName: activeCliProfile,
  platform: "xiaohongshu",
  targetId: "existing-target",
  browserLifecycle: "keep_open"
});
await assert.rejects(
  execFileAsync(process.execPath, [
    cliPath,
    "draft-fill",
    "--work-dir",
    activeCliWorkDir,
    "--profile-name",
    activeCliProfile,
    "--confirm-intake",
    "--json"
  ]),
  (error) => {
    assert.equal(error.code, 6);
    const payload = JSON.parse(error.stdout);
    assert.equal(payload.error_code, "profile_lock_held");
    assert.equal(payload.profile_name, activeCliProfile);
    assert.equal(payload.browser_lifecycle, "keep_open");
    assert.equal("lock_path" in payload, false);
    assert.equal("lock" in payload, false);
    assert.equal(JSON.stringify(payload).includes("existing-target"), false);
    return true;
  }
);
await releaseProfileLock(activeCliLock);
await fs.rm(activeCliWorkDir, { recursive: true, force: true });

await fs.rm(root, { recursive: true, force: true });

console.log("browser profile lock tests passed.");
