import { STATUS, step } from "./utils.mjs";

import { douyinAdapter, inspectDouyinCollections } from "./platforms/douyin.mjs";

import { wechatChannelsAdapter, inspectWechatChannelsCollections } from "./platforms/wechat-channels.mjs";

import { xiaohongshuAdapter, inspectXhsCollections } from "./platforms/xiaohongshu.mjs";

export { douyinAdapter } from "./platforms/douyin.mjs";

export { wechatChannelsAdapter } from "./platforms/wechat-channels.mjs";

export { xiaohongshuAdapter } from "./platforms/xiaohongshu.mjs";

export { extractVisibleUploadedImageCount, normalizeCollectionNames, platformIdentityStep, redactedTextEvidence, textContainsContentFingerprint, textContainsPlainTags } from "./platforms/common.mjs";

export { appendPlainHashTags, chooseWechatChannelsCollectionName, classifyWechatChannelsInput, isWechatChannelsImageEntryButton, isWechatChannelsPublishButton, parseWechatChannelsCarouselCount, wechatChannelsTopicEvidenceOk } from "./platforms/wechat-channels.mjs";

export const adapters = {
  xiaohongshu: xiaohongshuAdapter,
  douyin: douyinAdapter,
  wechat_channels: wechatChannelsAdapter
};

export const collectionInspectors = {
  xiaohongshu: inspectXhsCollections,
  douyin: inspectDouyinCollections,
  wechat_channels: inspectWechatChannelsCollections
};

export async function inspectCollections({ page, plan, logDir }) {
  const inspector = collectionInspectors[plan.platform];
  if (inspector) return inspector(page, plan, logDir);
  return {
    status: STATUS.failed,
    collections: [],
    steps: [step("inspect_collections", STATUS.failed, `No collection inspector for platform: ${plan.platform}`)],
    source_artifacts: {}
  };
}
