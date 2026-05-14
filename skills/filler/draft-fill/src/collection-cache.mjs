import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, exists, profileDir, readJson } from "./utils.mjs";

export const COLLECTION_CACHE_SCHEMA_VERSION = "1.0";

export function accountFingerprintFromPlan(plan) {
  return String(plan?.account_fingerprint || "").trim();
}

export function validateProfileName(profileName) {
  const raw = String(profileName || "");
  const value = raw.trim();
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (
    !value ||
    raw !== value ||
    value === "." ||
    value === ".." ||
    /[\\/:*?"<>|]/.test(value) ||
    path.isAbsolute(value) ||
    value.includes("..") ||
    reserved.test(value) ||
    /[. ]$/.test(value)
  ) {
    return {
      ok: false,
      status: "needs_human",
      error_code: "invalid_profile_name",
      message: "Invalid profile name. Use a simple profile name without path separators or traversal."
    };
  }
  return { ok: true, profile_name: value };
}

export function collectionCachePath(profileName) {
  assertValidProfileName(profileName);
  return path.join(profileDir(profileName), "collection-cache.json");
}

export async function writeCollectionCache({
  profileName,
  platform,
  accountFingerprint,
  accountVerified = false,
  accountVerification = null,
  accountId = null,
  accountHint = null,
  collections,
  sourceArtifacts = {},
  now = new Date(),
  ttlMs = 7 * 24 * 60 * 60 * 1000
}) {
  assertValidProfileName(profileName);
  const discoveredAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const verification = accountVerified && accountFingerprint
    ? accountVerification || "operator_confirmed"
    : "unverified";
  const payload = {
    schema_version: COLLECTION_CACHE_SCHEMA_VERSION,
    platform,
    profile_name: profileName,
    ...(accountFingerprint ? { account_fingerprint: accountFingerprint } : {}),
    ...(!accountFingerprint && accountId ? { account_id: accountId } : {}),
    account_verified: verification === "operator_confirmed",
    account_verification: verification,
    ...(accountHint ? { account_hint: accountHint } : {}),
    discovered_at: discoveredAt,
    expires_at: expiresAt,
    collections: Array.isArray(collections) ? collections : [],
    source_artifacts: sourceArtifacts || {}
  };
  const filePath = collectionCachePath(profileName);
  await ensureDir(path.dirname(filePath));
  const tmpPath = path.join(path.dirname(filePath), `.collection-cache.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
  return { path: filePath, cache: payload };
}

export async function readCollectionCache({
  profileName,
  platform,
  accountFingerprint,
  now = new Date()
}) {
  const profileValidation = validateProfileName(profileName);
  if (!profileValidation.ok) return profileValidation;
  const filePath = collectionCachePath(profileName);
  const pathHint = collectionCachePathHint(profileName);
  if (!(await exists(filePath))) {
    return {
      status: "needs_human",
      error_code: "collection_cache_missing",
      message: "Collection cache is missing; run inspect-collections. Account verification is still required before draft-fill can trust cached collections.",
      path_hint: pathHint
    };
  }

  let cache;
  try {
    cache = await readJson(filePath);
  } catch (error) {
    return {
      status: "needs_human",
      error_code: "collection_cache_unreadable",
      message: "Collection cache could not be read; run inspect-collections.",
      path_hint: pathHint
    };
  }

  const expectedFingerprint = String(accountFingerprint || "").trim();
  if (cache.schema_version !== COLLECTION_CACHE_SCHEMA_VERSION) {
    return mismatch(pathHint, "collection_cache_schema_mismatch", "Collection cache schema does not match; run inspect-collections.");
  }
  if (cache.platform !== platform) {
    return mismatch(pathHint, "collection_cache_platform_mismatch", `Collection cache is for ${cache.platform || "unknown"}, not ${platform}; run inspect-collections.`);
  }
  if (cache.profile_name !== profileName) {
    return mismatch(pathHint, "collection_cache_profile_mismatch", "Collection cache profile does not match the selected browser profile; run inspect-collections.");
  }
  if (!expectedFingerprint) {
    return mismatch(pathHint, "collection_cache_account_unverified", "Collection cache is untrusted because no verified account_fingerprint was supplied. Run inspect-collections and provide/confirm an account fingerprint once account verification is supported.");
  }
  if (!cache.account_verified || cache.account_verification !== "operator_confirmed" || !cache.account_fingerprint) {
    return mismatch(pathHint, "collection_cache_account_unverified", "Collection cache has only unverified account hints, so draft-fill cannot trust it. Run inspect-collections and explicitly confirm the account fingerprint for this profile.");
  }
  if (cache.account_fingerprint !== expectedFingerprint) {
    return mismatch(pathHint, "collection_cache_account_mismatch", "Collection cache account fingerprint does not match this run; run inspect-collections.");
  }
  const expiresAtMs = Date.parse(cache.expires_at || "");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    return mismatch(pathHint, "collection_cache_expired", "Collection cache is expired; run inspect-collections.");
  }
  return { status: "done", path_hint: pathHint, cache };
}

export function collectionCacheStep(cacheStatus, requestedCollection) {
  const details = collectionCacheSummary(cacheStatus);
  if (cacheStatus.status !== "done") {
    return {
      name: "collection_cache",
      status: "needs_human",
      message: cacheStatus.message,
      details
    };
  }
  if (!requestedCollection) {
    return {
      name: "collection_cache",
      status: "skipped_by_plan",
      message: "No collection requested in plan.",
      details
    };
  }
  const collections = Array.isArray(cacheStatus.cache.collections) ? cacheStatus.cache.collections : [];
  const found = collections.includes(requestedCollection);
  return {
    name: "collection_cache",
    status: found ? "done" : "needs_human",
    message: found
      ? `Requested collection is present in cache: ${requestedCollection}`
      : `Requested collection is missing from cache: ${requestedCollection}. Run inspect-collections before draft-fill.`,
    details: { ...details, collection: requestedCollection }
  };
}

export function collectionCacheSummary(cacheStatusOrCache, profileName = null) {
  const cache = cacheStatusOrCache?.cache || cacheStatusOrCache || null;
  const collections = Array.isArray(cache?.collections) ? cache.collections : [];
  const pathHint = cacheStatusOrCache?.path_hint || (profileName && validateProfileName(profileName).ok ? collectionCachePathHint(profileName) : null);
  return {
    status: cacheStatusOrCache?.status || (cache ? "done" : "needs_human"),
    collection_count: collections.length,
    expires_at: cache?.expires_at || null,
    account_verified: !!cache?.account_verified && cache?.account_verification === "operator_confirmed" && !!cache?.account_fingerprint,
    ...(cacheStatusOrCache?.error_code ? { error_code: cacheStatusOrCache.error_code } : {}),
    ...(pathHint ? { path_hint: pathHint } : {})
  };
}

function collectionCachePathHint(profileName) {
  return `profiles/${profileName}/collection-cache.json`;
}

function mismatch(pathHint, errorCode, message) {
  return {
    status: "needs_human",
    error_code: errorCode,
    message,
    path_hint: pathHint
  };
}

function assertValidProfileName(profileName) {
  const validation = validateProfileName(profileName);
  if (!validation.ok) throw new Error(validation.message);
}
