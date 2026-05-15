import fs from "node:fs/promises";
import path from "node:path";
import { draftFillRoot } from "./utils.mjs";

export const DEFAULT_COLLECTION_TAXONOMY_PATH = path.join(draftFillRoot, "src", "collection-taxonomy.default.json");
const MAX_TAXONOMY_BYTES = 1024 * 1024;
const MIN_HIGH_CONFIDENCE_SCORE = 10;
const MIN_CONFIDENCE_MARGIN = 3;

export async function loadCollectionTaxonomy({ taxonomyPath = null, workDir = process.cwd() } = {}) {
  const resolvedPath = resolveTaxonomyPath({ taxonomyPath, workDir });
  if (path.extname(resolvedPath).toLowerCase() !== ".json") {
    throw new Error(`collection taxonomy path must be a .json file: ${resolvedPath}`);
  }
  const stat = await fs.stat(resolvedPath);
  if (stat.size > MAX_TAXONOMY_BYTES) {
    throw new Error(`collection taxonomy is too large: ${resolvedPath}`);
  }
  const parsed = JSON.parse((await fs.readFile(resolvedPath, "utf8")).replace(/^\uFEFF/, ""));
  return normalizeTaxonomy(parsed);
}

export async function resolveCollectionDecision({ plan, cacheStatus, taxonomy = null, workDir = process.cwd() }) {
  if (!plan?.collection) {
    return {
      status: "skipped_by_plan",
      reason_code: "no_collection_requested",
      requested_collection: null,
      selected_collection: null,
      confidence: 0,
      match_type: "none",
      message: "No collection requested in plan."
    };
  }
  if (!cacheStatus || cacheStatus.status !== "done") {
    return {
      status: "needs_human",
      reason_code: cacheStatus?.error_code || "collection_cache_untrusted",
      requested_collection: String(plan.collection),
      selected_collection: null,
      confidence: 0,
      match_type: "none",
      message: cacheStatus?.message || "Collection cache is not trusted for this run."
    };
  }
  const loadedTaxonomy = taxonomy || await loadCollectionTaxonomy({
    taxonomyPath: plan.collection_taxonomy_path,
    workDir
  });
  return chooseCollection({
    plan,
    collections: cacheStatus.cache?.collections || [],
    taxonomy: loadedTaxonomy
  });
}

export function chooseCollection({ plan, collections, taxonomy }) {
  const requested = cleanText(plan?.collection);
  const options = normalizeOptions(collections);
  if (!requested) {
    return decision("skipped_by_plan", "no_collection_requested", plan, null, 0, "none", [], "No collection requested in plan.");
  }
  if (options.length === 0) {
    return decision("done", "no_visible_collections", plan, null, 0, "none", [], "No visible collection options were available; continuing without selecting a collection.");
  }

  const exact = options.find((option) => option.key === normalizeKey(requested));
  if (exact) {
    return decision("done", "exact_collection_match", plan, exact.label, 1, "exact", [], `Exact collection match: ${exact.label}`);
  }

  const normalizedTaxonomy = normalizeTaxonomy(taxonomy);
  const cues = contentCues(plan);
  const candidates = [];
  for (const option of options) {
    for (const entry of normalizedTaxonomy.collections) {
      const scored = scoreOption(option.label, requested, cues, entry);
      if (scored.score <= 0) continue;
      candidates.push({
        selected_collection: option.label,
        taxonomy_collection: entry.collection,
        score: scored.score,
        confidence: confidenceFromScore(scored.score),
        match_type: scored.matchType,
        matched_keywords: scored.matchedKeywords
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.selected_collection.localeCompare(right.selected_collection, "zh-Hans-CN"));
  const top = candidates[0];
  if (!top || top.score < MIN_HIGH_CONFIDENCE_SCORE) {
    return decision("done", "no_suitable_collection", plan, null, top ? top.confidence : 0, "none", candidates.slice(0, 3), "No existing collection crossed the high-confidence threshold; continuing without selecting a collection.");
  }
  const second = candidates.find((item) => item.selected_collection !== top.selected_collection);
  if (second && top.score - second.score < MIN_CONFIDENCE_MARGIN) {
    return decision("needs_human", "ambiguous_collection_match", plan, null, top.confidence, "ambiguous", candidates.slice(0, 3), "Multiple existing collections were plausible; refusing to guess.");
  }
  return decision("done", "semantic_collection_match", plan, top.selected_collection, top.confidence, top.match_type, candidates.slice(0, 3), `Selected existing collection by ${top.match_type}: ${top.selected_collection}`);
}

export function planWithResolvedCollection(plan, collectionDecision) {
  if (!collectionDecision || collectionDecision.status !== "done") return plan;
  if (!collectionDecision.selected_collection && shouldSkipCollectionSelection(collectionDecision.reason_code)) {
    return {
      ...plan,
      collection: null,
      collection_decision: collectionDecision
    };
  }
  if (!collectionDecision.selected_collection) return plan;
  return {
    ...plan,
    collection: collectionDecision.selected_collection,
    collection_decision: collectionDecision
  };
}

function shouldSkipCollectionSelection(reasonCode) {
  return ["no_suitable_collection", "no_visible_collections"].includes(reasonCode);
}

function resolveTaxonomyPath({ taxonomyPath, workDir }) {
  if (!taxonomyPath) return DEFAULT_COLLECTION_TAXONOMY_PATH;
  const raw = String(taxonomyPath);
  if (path.isAbsolute(raw)) return path.resolve(raw);
  const root = path.resolve(workDir || process.cwd());
  const resolved = path.resolve(root, raw);
  const prefix = `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`collection taxonomy path escapes workdir: ${taxonomyPath}`);
  }
  return resolved;
}

function normalizeTaxonomy(taxonomy) {
  if (!taxonomy || !Array.isArray(taxonomy.collections)) {
    throw new Error("collection taxonomy must contain a collections array.");
  }
  return {
    schema_version: taxonomy.schema_version || "1.0",
    collections: taxonomy.collections.map((entry) => ({
      collection: cleanText(entry.collection),
      aliases: uniqueText([entry.collection, ...(entry.aliases || [])]),
      keywords: uniqueText(entry.keywords || [])
    })).filter((entry) => entry.collection)
  };
}

function normalizeOptions(collections) {
  const seen = new Set();
  const options = [];
  for (const collection of collections || []) {
    const label = cleanText(collection);
    const key = normalizeKey(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    options.push({ label, key });
  }
  return options;
}

function contentCues(plan) {
  return [
    plan?.title,
    plan?.body,
    plan?.summary,
    ...(Array.isArray(plan?.tags) ? plan.tags : []),
    ...(Array.isArray(plan?.selling_points) ? plan.selling_points : [])
  ].map(cleanText).filter(Boolean).join("\n");
}

function scoreOption(visibleCollection, requestedCollection, cues, entry) {
  const visibleKey = normalizeKey(visibleCollection);
  const requestedKey = normalizeKey(requestedCollection);
  const aliasKeys = entry.aliases.map(normalizeKey);
  const keywordMatches = entry.keywords.filter((keyword) => textIncludes(cues, keyword));
  const visibleKeywordMatches = entry.keywords.filter((keyword) => textIncludes(visibleCollection, keyword));
  const visibleAliasMatch = aliasKeys.some((alias) => alias === visibleKey);
  const visiblePartialAliasMatch = aliasKeys.some((alias) => alias && (visibleKey.includes(alias) || alias.includes(visibleKey)));
  const visibleKeywordMatch = visibleKeywordMatches.length > 0;
  if (!visibleAliasMatch && !visiblePartialAliasMatch && !visibleKeywordMatch) return { score: 0, matchType: "none", matchedKeywords: [] };

  let score = 0;
  let matchType = "taxonomy";
  if (visibleAliasMatch) score += 8;
  else if (visiblePartialAliasMatch) score += 6;
  if (visibleKeywordMatch) score += Math.min(4, visibleKeywordMatches.length * 2);
  if (aliasKeys.includes(requestedKey)) score += 4;
  else if (requestedKey && (visibleKey.includes(requestedKey) || requestedKey.includes(visibleKey))) score += 2;
  score += Math.min(10, keywordMatches.length * 2);
  if (visibleAliasMatch && aliasKeys.includes(requestedKey) && keywordMatches.length === 0) matchType = "alias";
  return { score, matchType, matchedKeywords: keywordMatches };
}

function confidenceFromScore(score) {
  return Math.min(1, Number((score / 20).toFixed(2)));
}

function decision(status, reasonCode, plan, selectedCollection, confidence, matchType, candidates, message) {
  return {
    status,
    reason_code: reasonCode,
    requested_collection: plan?.collection ? String(plan.collection) : null,
    selected_collection: selectedCollection,
    confidence,
    match_type: matchType,
    matched_keywords: candidates[0]?.matched_keywords || [],
    candidate_count: candidates.length,
    candidates,
    message
  };
}

function uniqueText(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanText(value);
    const key = normalizeKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase();
}

function textIncludes(text, needle) {
  const normalizedNeedle = normalizeKey(needle);
  return !!normalizedNeedle && normalizeKey(text).includes(normalizedNeedle);
}
