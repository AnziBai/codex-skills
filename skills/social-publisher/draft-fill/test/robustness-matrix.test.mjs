import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { powerShellEnvironmentCheck, runRobustnessMatrix } from "../src/robustness-matrix.mjs";

const cliPath = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

function assertFutureIso(value) {
  const parsed = new Date(value);
  assert.equal(Number.isNaN(parsed.getTime()), false, `Expected valid date: ${value}`);
  assert.ok(parsed.getTime() > Date.now(), `Expected ${value} to be in the future`);
  assert.match(value, /\+08:00$/);
}

const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-robustness-test-output-"));
try {
  const matrix = await runRobustnessMatrix({ outputRoot });
  assert.equal(matrix.ok, true);
  assert.equal(matrix.command, "robustness-matrix");
  assert.equal(matrix.dry_run, true);
  assert.equal(matrix.opened_browser, false);
  assert.equal(matrix.source_mode, "generated_fixture");
  assert.ok(matrix.fixture_root.startsWith(outputRoot));
  assert.ok(!matrix.fixture_root.includes("Desktop"));

  const scheduled = matrix.cases.find((item) => item.id === "scheduled-future");
  assert.ok(scheduled, "generated fixture should include scheduled-future case");
  assert.equal(Object.hasOwn(scheduled, "plan"), false);
  assert.equal(scheduled.asset_count, 1);
  assertFutureIso(scheduled.publish_at);
  assert.equal(scheduled.validation.valid, true, JSON.stringify(scheduled.validation.errors));

  const missingAsset = matrix.cases.find((item) => item.id === "missing-asset");
  assert.ok(missingAsset, "generated fixture should include missing-asset case");
  assert.equal(missingAsset.validation.valid, false);
  assert.equal(missingAsset.expected_valid, false);
  assert.equal(missingAsset.case_ok, true);
  assert.equal(Object.hasOwn(missingAsset, "plan"), false);
  assert.deepEqual(Object.keys(missingAsset).sort(), [
    "asset_count",
    "case_ok",
    "draft_plan_path",
    "expected_valid",
    "id",
    "kind",
    "platform",
    "publish_at",
    "schedule_mode",
    "target_id",
    "validation",
    "work_dir"
  ].sort());
  assert.match(missingAsset.validation.errors.join("\n"), /asset path not found/i);
} finally {
  await fs.rm(outputRoot, { recursive: true, force: true });
}

const firstDefault = await runRobustnessMatrix();
const secondDefault = await runRobustnessMatrix();
assert.notEqual(firstDefault.output_root, secondDefault.output_root);
assert.ok(firstDefault.output_root.includes("social-publisher-robustness-matrix-"));
assert.ok(secondDefault.output_root.includes("social-publisher-robustness-matrix-"));

const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-robustness-source-"));
const sourceOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fill-robustness-source-output-"));
try {
  const caseDir = path.join(sourceRoot, "custom-case");
  const assetDir = path.join(caseDir, "assets");
  await fs.mkdir(assetDir, { recursive: true });
  const assetPath = path.join(assetDir, "1.png");
  await fs.writeFile(assetPath, Buffer.from("iVBORw0KGgo=", "base64"));
  await fs.writeFile(path.join(caseDir, "draft-plan.json"), `${JSON.stringify({
    schema_version: "1.0",
    plan_type: "social_publisher_draft_plan",
    generated_at: new Date().toISOString(),
    work_id: "custom-work",
    target_id: "custom-xhs",
    platform: "xiaohongshu",
    kind: "image",
    account_id: "xhs_main",
    source_work_dir: caseDir,
    asset_paths: { cover: assetPath, images: [assetPath], video: null },
    relative_asset_paths: { cover: "assets/1.png", images: ["assets/1.png"], video: "" },
    title: "Custom portable case",
    body: "Matrix should validate source-root draft plans.",
    tags: ["portable"],
    collection: "test",
    declaration: { mode: "original", label: "original" },
    music: { strategy: "none", name: null },
    schedule: { mode: "immediate", publish_at: null },
    stop_before_publish: true,
    safety: { never_click_publish: true, no_system_clipboard: true }
  }, null, 2)}\n`, "utf8");

  const matrix = await runRobustnessMatrix({ sourceRoot, outputRoot: sourceOutputRoot });
  assert.equal(matrix.source_mode, "source_root");
  assert.equal(matrix.source_root, path.resolve(sourceRoot));
  assert.equal(matrix.cases.length, 1);
  assert.equal(matrix.cases[0].id, "custom-case");
  assert.equal(matrix.cases[0].validation.valid, true, JSON.stringify(matrix.cases[0].validation.errors));
} finally {
  await fs.rm(sourceRoot, { recursive: true, force: true });
  await fs.rm(sourceOutputRoot, { recursive: true, force: true });
}

const cli = spawnSync(process.execPath, [cliPath, "robustness-matrix", "--json"], {
  cwd: os.tmpdir(),
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const parsed = JSON.parse(cli.stdout);
assert.equal(parsed.command, "robustness-matrix");
assert.equal(parsed.work_dir_required, false);
assert.equal(parsed.opened_browser, false);
assert.ok(parsed.cases.length >= 3);
assert.equal(Object.hasOwn(parsed.cases[0], "plan"), false);

const missingSource = spawnSync(process.execPath, [cliPath, "robustness-matrix", "--source-root", path.join(os.tmpdir(), "missing-robustness-source-root"), "--json"], {
  cwd: os.tmpdir(),
  encoding: "utf8"
});
assert.equal(missingSource.status, 2, missingSource.stderr || missingSource.stdout);
assert.match(JSON.parse(missingSource.stdout).error, /--source-root not found/i);

const emptySourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "empty-robustness-source-"));
try {
  const emptySource = spawnSync(process.execPath, [cliPath, "robustness-matrix", "--source-root", emptySourceRoot, "--json"], {
    cwd: os.tmpdir(),
    encoding: "utf8"
  });
  assert.equal(emptySource.status, 2, emptySource.stderr || emptySource.stdout);
  assert.match(JSON.parse(emptySource.stdout).error, /No draft-plan\.json cases found/i);
} finally {
  await fs.rm(emptySourceRoot, { recursive: true, force: true });
}

const nonWindowsPowerShell = powerShellEnvironmentCheck({
  platform: "linux",
  spawn: () => ({ status: null, stdout: "", stderr: "" })
});
assert.equal(nonWindowsPowerShell.ok, true);
assert.equal(nonWindowsPowerShell.optional, true);
assert.equal(nonWindowsPowerShell.status, "skipped");

console.log("robustness matrix tests passed.");
