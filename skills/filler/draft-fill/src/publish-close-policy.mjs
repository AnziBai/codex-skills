export const PUBLISH_CLOSE_POLICIES = {
  scheduledBatchConfirm: "scheduled_batch_confirm",
  immediateSaveDraftExit: "immediate_save_draft_exit",
  manualBoundary: "manual_boundary"
};

export function determinePublishClosePolicy({
  plan,
  manifest = null,
  confirmScheduledPublish = false,
  batchItemCount = 1
} = {}) {
  const scheduled = !!plan?.schedule?.mode && plan.schedule.mode !== "immediate";
  const multiItem = isMultiItem({ manifest, batchItemCount });
  if (!scheduled) {
    return {
      policy: PUBLISH_CLOSE_POLICIES.immediateSaveDraftExit,
      reason_code: "immediate_save_draft_exit",
      scheduled: false,
      multi_item: multiItem
    };
  }
  if (multiItem || confirmScheduledPublish) {
    return {
      policy: PUBLISH_CLOSE_POLICIES.scheduledBatchConfirm,
      reason_code: multiItem ? "scheduled_multi_item_auto_confirm" : "scheduled_explicit_confirm",
      scheduled: true,
      multi_item: multiItem
    };
  }
  return {
    policy: PUBLISH_CLOSE_POLICIES.manualBoundary,
    reason_code: "single_scheduled_requires_explicit_confirm",
    scheduled: true,
    multi_item: false
  };
}

function isMultiItem({ manifest, batchItemCount }) {
  if (Number(batchItemCount || 0) > 1) return true;
  const targets = Array.isArray(manifest?.targets) ? manifest.targets : [];
  if (targets.length > 1) return true;
  const workCount = Number(manifest?.batch?.work_count || manifest?.work_count || 0);
  return workCount > 1;
}
