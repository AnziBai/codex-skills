import fs from "node:fs/promises";
import path from "node:path";
import { validateProfileName } from "./collection-cache.mjs";
import { ensureDir, profileDir, skillRoot } from "./utils.mjs";

export class ProfileLockHeldError extends Error {
  constructor(payload) {
    super(payload.error);
    this.name = "ProfileLockHeldError";
    this.errorCode = "profile_lock_held";
    this.payload = payload;
  }
}

export function lockFilePath(profileName, profilesRoot = defaultProfilesRoot()) {
  assertProfileName(profileName);
  return path.join(profilesRoot, `${profileName}.draft-fill.lock`);
}

export async function acquireProfileLock({
  profilesRoot = defaultProfilesRoot(),
  profileName,
  platform,
  targetId,
  browserLifecycle,
  pid = process.pid,
  now = () => new Date(),
  isProcessAlive = defaultIsProcessAlive,
  onBeforeStaleRemove = null
}) {
  assertProfileName(profileName);
  await ensureDir(profilesRoot);
  const lockPath = lockFilePath(profileName, profilesRoot);
  const lock = {
    pid,
    platform,
    target_id: targetId,
    started_at: now().toISOString(),
    profile_name: profileName,
    browser_lifecycle: browserLifecycle
  };

  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return { path: lockPath, lock };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readExistingLock(lockPath, profileName);
      if (existing.lock.pid && isProcessAlive(existing.lock.pid)) {
        throw new ProfileLockHeldError(lockHeldPayload(lockPath, existing.lock, "active"));
      }
      if (!existing.lock.pid) {
        throw new ProfileLockHeldError(lockHeldPayload(lockPath, existing.lock, "unreadable"));
      }
      if (existing.lock?.browser_lifecycle === "keep_open") {
        throw new ProfileLockHeldError(lockHeldPayload(lockPath, existing.lock, "stale_keep_open_requires_manual_cleanup"));
      }
      if (onBeforeStaleRemove) await onBeforeStaleRemove(existing.lock);
      const claimed = await claimStaleLock(lockPath, existing.raw);
      if (claimed === "missing") continue;
      if (claimed.lockChanged) {
        throw new ProfileLockHeldError(lockHeldPayload(lockPath, claimed.lock || existing.lock, "lock_changed_during_stale_recovery"));
      }
      await fs.rm(claimed.claimPath, { force: true });
    }
  }
}

export async function releaseProfileLock(acquired) {
  if (!acquired?.path) return;
  const current = await readJsonIfExists(acquired.path);
  if (!current) return;
  if (
    current.pid === acquired.lock?.pid &&
    current.profile_name === acquired.lock?.profile_name &&
    current.started_at === acquired.lock?.started_at
  ) {
    await fs.unlink(acquired.path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function launchPersistentProfile({
  profileName,
  platform,
  targetId,
  keepOpen,
  profilesRoot = defaultProfilesRoot(),
  chromium,
  launchOptions = {}
}) {
  const browserLifecycle = keepOpen ? "keep_open" : "close_on_finish";
  const acquiredLock = await acquireProfileLock({
    profilesRoot,
    profileName,
    platform,
    targetId,
    browserLifecycle
  });
  let context;
  let released = false;
  let cleanupInstalled = false;
  const signalCleanups = [];
  const release = async () => {
    if (released) return;
    released = true;
    if (cleanupInstalled) {
      for (const cleanup of signalCleanups) removeSignalCleanup(cleanup);
    }
    await releaseProfileLock(acquiredLock);
  };

  try {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const cleanup = async () => {
        try {
          if (context) await context.close().catch(() => {});
          await release();
        } finally {
          process.exit(signal === "SIGINT" ? 130 : 143);
        }
      };
      signalCleanups.push({ signal, cleanup });
      installSignalCleanup(signal, cleanup);
    }
    cleanupInstalled = true;
    const browser = chromium || (await import("playwright")).chromium;
    await ensureDir(profileDir(profileName));
    context = await browser.launchPersistentContext(profileDir(profileName), {
      headless: false,
      acceptDownloads: true,
      ...launchOptions
    });
    const closed = new Promise((resolve) => context.once("close", resolve)).finally(release);
    const page = context.pages()[0] || await context.newPage();
    return {
      context,
      page,
      lock: acquiredLock.lock,
      lockPath: acquiredLock.path,
      release,
      closed
    };
  } catch (error) {
    await release();
    throw error;
  }
}

export function lockHeldPayload(lockPath, lock, status = "active") {
  const startedAt = lock?.started_at || null;
  return {
    ok: false,
    error_code: "profile_lock_held",
    error: `Browser profile is already in use: ${lock.profile_name || path.basename(lockPath, ".draft-fill.lock")}`,
    profile_name: lock.profile_name || path.basename(lockPath, ".draft-fill.lock"),
    platform: lock.platform || null,
    browser_lifecycle: lock.browser_lifecycle || "unknown",
    started_at: startedAt,
    lock_age_seconds: startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)) : null,
    status
  };
}

function defaultProfilesRoot() {
  return path.join(skillRoot, "profiles");
}

function assertProfileName(profileName) {
  const validation = validateProfileName(profileName);
  if (!validation.ok) throw new Error(validation.message);
}

async function readExistingLock(lockPath, profileName) {
  const raw = await readTextIfExists(lockPath);
  const lock = raw ? parseLockJson(raw) : null;
  if (lock) return { raw, lock };
  return {
    raw,
    lock: {
      pid: null,
      profile_name: profileName,
      browser_lifecycle: "unknown",
      lock_read_error: true
    }
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function parseLockJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function claimStaleLock(lockPath, expectedRaw) {
  const claimPath = `${lockPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.stale`;
  try {
    await fs.rename(lockPath, claimPath);
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
  const claimedRaw = await readTextIfExists(claimPath);
  if (claimedRaw !== expectedRaw) {
    await restoreChangedClaim(lockPath, claimPath, claimedRaw);
    return { claimPath, lockChanged: true, lock: claimedRaw ? parseLockJson(claimedRaw) : null };
  }
  return { claimPath, lockChanged: false };
}

async function restoreChangedClaim(lockPath, claimPath, claimedRaw) {
  if (claimedRaw !== null) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(claimedRaw, "utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  await fs.rm(claimPath, { force: true });
}

function installSignalCleanup(signal, cleanup) {
  process.once(signal, cleanup);
}

function removeSignalCleanup(entry) {
  if (!entry) return;
  process.removeListener(entry.signal, entry.cleanup);
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
