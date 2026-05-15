import { STATUS, step } from "./utils.mjs";

export async function maybeSaveDraftAndExit({ adapter, page, context, plan, steps }) {
  const blockedStep = (Array.isArray(steps) ? steps : []).find((item) => (
    [STATUS.failed, STATUS.needsHuman, STATUS.retrying].includes(item?.status)
  ));
  if (blockedStep) {
    return step("draft_exit", STATUS.needsHuman, `Step ${blockedStep.name || "unknown"} is ${blockedStep.status}; refusing to save and close automatically.`, {
      reason_code: "critical_step_not_done",
      blocked_step: blockedStep.name || null,
      blocked_status: blockedStep.status || null,
      closed: false
    });
  }
  if (typeof adapter?.saveDraftAndExit !== "function") {
    return step("draft_exit", STATUS.needsHuman, `No save-draft handler for platform: ${plan?.platform || "unknown"}.`, {
      reason_code: "draft_exit_handler_missing",
      closed: false
    });
  }
  const result = await adapter.saveDraftAndExit({ page, plan });
  const normalized = result?.name === "draft_exit"
    ? result
    : step("draft_exit", result?.status || STATUS.needsHuman, result?.message || "Draft exit handler returned no message.", result?.details);
  if (normalized.status !== STATUS.done) {
    return withDetails(normalized, { closed: false });
  }
  await context?.close?.();
  return withDetails(normalized, { closed: true });
}

function withDetails(item, extra) {
  return {
    ...item,
    details: {
      ...(item.details || {}),
      ...extra
    }
  };
}
