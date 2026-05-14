import { STATUS, step } from "./utils.mjs";

const SAFE_SCHEDULED_CONFIRMATION_PATTERN = /^(定时发布|确认定时发布|确认并定时发布|定时发表|确认定时发表)$/;

export function evaluateScheduledPublishGate({ plan, steps, confirmScheduledPublish }) {
  const items = Array.isArray(steps) ? steps : [];
  const schedule = plan?.schedule || {};
  const scheduled = schedule.mode && schedule.mode !== "immediate";
  const requestedAt = schedule.publish_at || null;
  const scheduleStep = lastStep(items, "schedule");
  const publishBoundary = lastStep(items, "publish_boundary");
  const scheduleActualAt = readScheduleActualAt(scheduleStep);
  const details = {
    confirm_scheduled_publish: !!confirmScheduledPublish,
    scheduled: !!scheduled,
    schedule_requested_at: requestedAt,
    schedule_actual_at: scheduleActualAt
  };

  if (!scheduled) {
    return blocked(
      confirmScheduledPublish ? STATUS.needsHuman : STATUS.skipped,
      "not_scheduled",
      confirmScheduledPublish
        ? "ConfirmScheduledPublish was provided, but the plan is not scheduled. Refusing to click any publish button."
        : "Plan is not scheduled; scheduled publish confirmation is not applicable.",
      details
    );
  }

  if (!confirmScheduledPublish) {
    return blocked(
      STATUS.skipped,
      "confirm_scheduled_publish_not_enabled",
      "Scheduled publish confirmation was not explicitly enabled; stopped at the publish boundary.",
      details
    );
  }

  const futureCheck = isFutureDateTime(requestedAt);
  if (!futureCheck.ok) {
    return blocked(STATUS.needsHuman, futureCheck.reason_code, futureCheck.message, details);
  }

  if (!scheduleStep || scheduleStep.status !== STATUS.done || !scheduleActualAt) {
    return blocked(
      STATUS.needsHuman,
      "schedule_not_verified",
      "Scheduled publish time was not verified by page readback; refusing to confirm.",
      details
    );
  }

  if (!publishBoundary || publishBoundary.status !== STATUS.done) {
    return blocked(
      STATUS.needsHuman,
      "publish_boundary_not_verified",
      "Final publish boundary was not verified; refusing to confirm scheduled publish.",
      details
    );
  }

  const criticalMissing = missingCriticalSteps(plan, items);
  if (criticalMissing.length > 0) {
    return blocked(
      STATUS.needsHuman,
      "critical_step_missing",
      `Critical draft-fill step(s) were not recorded: ${criticalMissing.join(", ")}.`,
      { ...details, critical_steps: criticalMissing }
    );
  }

  const blockedStep = items.find((item) => [STATUS.failed, STATUS.needsHuman, STATUS.retrying].includes(item.status));
  if (blockedStep) {
    return blocked(
      STATUS.needsHuman,
      "critical_step_not_done",
      `Step ${blockedStep.name || "unknown"} is ${blockedStep.status}; refusing to confirm scheduled publish.`,
      { ...details, blocked_step: blockedStep.name || null, blocked_status: blockedStep.status || null }
    );
  }

  return {
    allowed: true,
    status: STATUS.done,
    reason_code: "scheduled_publish_confirmation_allowed",
    message: "All scheduled publish confirmation gates passed.",
    details
  };
}

export async function maybeConfirmScheduledPublish({ page, plan, steps, confirmScheduledPublish }) {
  const gate = evaluateScheduledPublishGate({ plan, steps, confirmScheduledPublish });
  if (!gate.allowed) {
    return step("scheduled_publish_confirmation", gate.status, gate.message, {
      ...gate.details,
      reason_code: gate.reason_code,
      click_count: 0
    });
  }

  const buttons = page.getByRole("button", { name: SAFE_SCHEDULED_CONFIRMATION_PATTERN });
  const count = await buttons.count();
  if (count !== 1) {
    return step(
      "scheduled_publish_confirmation",
      STATUS.needsHuman,
      `Scheduled publish confirmation button was not uniquely identifiable; found ${count}.`,
      {
        ...gate.details,
        reason_code: "scheduled_confirmation_button_not_unique",
        button_count: count,
        click_count: 0
      }
    );
  }

  await buttons.first().click({ timeout: 5000, force: true });
  return step(
    "scheduled_publish_confirmation",
    STATUS.done,
    "Scheduled publish confirmation clicked intentionally after explicit runtime authorization.",
    {
      ...gate.details,
      reason_code: "scheduled_publish_confirmed",
      button_count: count,
      click_count: 1
    }
  );
}

function blocked(status, reasonCode, message, details) {
  return {
    allowed: false,
    status,
    reason_code: reasonCode,
    message,
    details
  };
}

function lastStep(steps, name) {
  return [...steps].reverse().find((item) => item?.name === name) || null;
}

function missingCriticalSteps(plan, steps) {
  const names = new Set(steps.map((item) => item?.name).filter(Boolean));
  const required = ["upload_assets", "body", "topics", "schedule", "publish_boundary"];
  if (plan?.platform !== "wechat_channels" && plan?.title) required.push("title");
  if (plan?.collection) required.push("collection_decision", "collection");
  if (plan?.declaration && plan.declaration.mode && plan.declaration.mode !== "none") required.push("declaration");
  if (plan?.music && plan.music.strategy && plan.music.strategy !== "none") required.push("music");
  return [...new Set(required)].filter((name) => !names.has(name));
}

function readScheduleActualAt(scheduleStep) {
  if (!scheduleStep || scheduleStep.status !== STATUS.done) return null;
  const detailsActual = scheduleStep.details?.actual_at || scheduleStep.details?.actualAt;
  if (detailsActual) return String(detailsActual);
  const message = String(scheduleStep.message || "");
  const adjusted = message.match(/actual(?:_at)?[:=]\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/i);
  if (adjusted) return adjusted[1].replace("T", " ");
  const selected = message.match(/(?:selected|选择|选中|定时发布|scheduled publish selected)[:：]?\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/i);
  if (selected) return selected[1].replace("T", " ");
  const firstDate = message.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
  return firstDate ? firstDate[1].replace("T", " ") : null;
}

function isFutureDateTime(value) {
  if (!value) {
    return {
      ok: false,
      reason_code: "schedule_time_missing",
      message: "Scheduled publish plan is missing schedule.publish_at."
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      ok: false,
      reason_code: "schedule_time_invalid",
      message: `Scheduled publish time is invalid: ${value}`
    };
  }
  if (date.getTime() <= Date.now()) {
    return {
      ok: false,
      reason_code: "schedule_time_not_future",
      message: `Scheduled publish time is not in the future: ${value}`
    };
  }
  return { ok: true };
}
