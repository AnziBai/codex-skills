import fs from "node:fs/promises";
import path from "node:path";

const SUMMARY_FIELDS = [
  "ok",
  "work_id",
  "target_id",
  "platform",
  "overall_status",
  "done_steps",
  "needs_human_steps",
  "failed_steps",
  "publish_boundary_preserved"
];

export class ResultSummaryInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResultSummaryInputError";
  }
}

export async function summarizeResultFile(workDir) {
  if (!workDir) throw new Error("--work-dir is required.");
  const resultPath = path.join(path.resolve(workDir), "draft-fill-result.json");
  let text;
  try {
    text = await fs.readFile(resultPath, "utf8");
  } catch (error) {
    throw new ResultSummaryInputError(`Could not read draft-fill-result.json at ${resultPath}: ${error.message}`);
  }
  let result;
  try {
    result = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new ResultSummaryInputError(`Could not parse draft-fill-result.json at ${resultPath}: ${error.message}`);
  }
  return summarizeResult(result);
}

export function summarizeResult(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const publishBoundaryPreserved = steps.some((item) => (
    item?.name === "publish_boundary"
    && item?.status === "done"
    && messageSaysFinalPublishWasNotClicked(item?.message)
  ));
  const statusOk = typeof result?.ok === "boolean"
    ? result.ok
    : result?.overall_status === "done";
  const summary = {
    ok: statusOk && publishBoundaryPreserved,
    work_id: result?.work_id ?? null,
    target_id: result?.target_id ?? null,
    platform: result?.platform ?? null,
    overall_status: result?.overall_status ?? null,
    done_steps: summarizeSteps(steps, "done"),
    needs_human_steps: summarizeSteps(steps, "needs_human"),
    failed_steps: summarizeSteps(steps, "failed"),
    publish_boundary_preserved: publishBoundaryPreserved
  };
  return Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, summary[field]]));
}

function summarizeSteps(steps, status) {
  return steps
    .filter((item) => item?.status === status)
    .map((item) => ({
      name: item?.name ?? null,
      message: item?.message ?? ""
    }));
}

function messageSaysFinalPublishWasNotClicked(message) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const hasFinalPublishContext = lower.includes("final publish")
    || /\u6700\u7ec8\u53d1\u5e03|\u53d1\u5e03/.test(text);
  const hasNotClickedEvidence = lower.includes("not clicked")
    || lower.includes("did not click")
    || /\u672a\u70b9\u51fb|\u6ca1\u6709\u70b9\u51fb/.test(text);
  return hasFinalPublishContext && hasNotClickedEvidence;
}
