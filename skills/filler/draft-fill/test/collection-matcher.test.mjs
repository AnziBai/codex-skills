import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  chooseCollection,
  loadCollectionTaxonomy,
  planWithResolvedCollection,
  resolveCollectionDecision
} from "../src/collection-matcher.mjs";

const taxonomy = {
  schema_version: "1.0",
  collections: [
    {
      collection: "宽论",
      aliases: ["宽论", "宽论长期合集", "宽论交易课"],
      keywords: ["缠论", "MACD", "QMACD", "带鱼法则", "量价", "假突破", "交易认知", "概率"]
    },
    {
      collection: "交易心理",
      aliases: ["交易心理", "心态建设"],
      keywords: ["交易认知", "心态", "纪律", "亏损"]
    },
    {
      collection: "宏观复盘",
      aliases: ["宏观复盘"],
      keywords: ["宏观", "政策", "利率", "周期"]
    }
  ]
};

const exact = chooseCollection({
  plan: { title: "假突破背后的量价质量", body: "", tags: ["量价"], collection: "宽论" },
  collections: ["宽论", "宏观复盘"],
  taxonomy
});
assert.equal(exact.status, "done");
assert.equal(exact.selected_collection, "宽论");
assert.equal(exact.match_type, "exact");

const semantic = chooseCollection({
  plan: {
    title: "MACD 假突破背后的量价质量",
    body: "这是一组缠论交易认知图片。",
    tags: ["股票知识", "缠论"],
    collection: "宽论"
  },
  collections: ["宏观复盘", "宽论长期合集"],
  taxonomy
});
assert.equal(semantic.status, "done");
assert.equal(semantic.selected_collection, "宽论长期合集");
assert.equal(semantic.match_type, "taxonomy");
assert.ok(semantic.confidence >= 0.75);
assert.ok(semantic.matched_keywords.includes("MACD"));

const ambiguous = chooseCollection({
  plan: {
    title: "交易认知为什么比技巧更重要",
    body: "",
    tags: ["交易认知"],
    collection: "交易"
  },
  collections: ["宽论长期合集", "交易心理"],
  taxonomy
});
assert.equal(ambiguous.status, "needs_human");
assert.equal(ambiguous.reason_code, "ambiguous_collection_match");
assert.equal(ambiguous.selected_collection, null);

const noMatch = chooseCollection({
  plan: {
    title: "缠论 MACD 假突破复盘",
    body: "量价和概率优势。",
    tags: ["缠论"],
    collection: "宽论"
  },
  collections: ["美食", "育儿"],
  taxonomy
});
assert.equal(noMatch.status, "done");
assert.equal(noMatch.reason_code, "no_suitable_collection");
assert.equal(noMatch.selected_collection, null);

const cacheMismatch = await resolveCollectionDecision({
  plan: { title: "缠论", body: "", tags: ["MACD"], collection: "宽论" },
  cacheStatus: {
    status: "needs_human",
    error_code: "collection_cache_account_mismatch",
    message: "Collection cache account fingerprint does not match this run."
  },
  taxonomy
});
assert.equal(cacheMismatch.status, "needs_human");
assert.equal(cacheMismatch.reason_code, "collection_cache_account_mismatch");

const originalPlan = {
  target_id: "xhs-1",
  collection: "宽论",
  title: "MACD 量价复盘"
};
const adapterPlan = planWithResolvedCollection(originalPlan, semantic);
assert.notEqual(adapterPlan, originalPlan);
assert.equal(adapterPlan.collection, "宽论长期合集");
assert.equal(adapterPlan.collection_decision.selected_collection, "宽论长期合集");
assert.equal(originalPlan.collection, "宽论");
assert.equal("collection_decision" in originalPlan, false);

const skippedCollectionPlan = planWithResolvedCollection(originalPlan, noMatch);
assert.notEqual(skippedCollectionPlan, originalPlan);
assert.equal(skippedCollectionPlan.collection, null);
assert.equal(skippedCollectionPlan.collection_decision.reason_code, "no_suitable_collection");

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "collection-taxonomy-test-"));
try {
  await fs.writeFile(path.join(workDir, "taxonomy.json"), `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8");
  const loaded = await loadCollectionTaxonomy({ taxonomyPath: "taxonomy.json", workDir });
  assert.equal(loaded.collections[0].collection, "宽论");
  await assert.rejects(
    () => loadCollectionTaxonomy({ taxonomyPath: "..\\outside.json", workDir }),
    /escapes workdir/i
  );
} finally {
  await fs.rm(workDir, { recursive: true, force: true });
}

console.log("collection matcher tests passed.");
