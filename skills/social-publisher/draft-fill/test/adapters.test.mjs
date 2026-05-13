import assert from "node:assert/strict";
import {
  extractVisibleUploadedImageCount,
  textContainsContentFingerprint,
  textContainsPlainTags
} from "../src/adapters.mjs";

assert.equal(extractVisibleUploadedImageCount("编辑图片\n已添加5张图片\n继续添加"), 5);
assert.equal(extractVisibleUploadedImageCount("上传完成\n共 3 张图片"), 3);
assert.equal(extractVisibleUploadedImageCount("上传完成，但没有数量"), null);

assert.equal(textContainsPlainTags("正文内容\n\n#股票知识 #交易思维", ["股票知识"]), true);
assert.equal(textContainsPlainTags("正文内容\n\n股票知识: selected", ["股票知识"]), false);
assert.equal(textContainsPlainTags("正文内容 #量价分析", ["量价分析"]), true);

assert.equal(
  textContainsContentFingerprint(
    "\u7b2c1\u96c6|\u5047\u7a81\u7834\u592a\u591a\uff1f\u7a81\u7834\u4e0d\u91cd\u8981\uff0c\u7a81\u7834\u80cc\u540e\u7684\u91cf\u4ef7\u8d28\u91cf\u624d\u91cd\u8981\u3002 #\u80a1\u7968\u77e5\u8bc6",
    "\u7a81\u7834\u4e0d\u91cd\u8981\uff0c\u7a81\u7834\u80cc\u540e\u7684\u91cf\u4ef7\u8d28\u91cf\u624d\u91cd\u8981\u3002"
  ),
  true
);
assert.equal(textContainsContentFingerprint("\u53ea\u6709\u6807\u9898\u6ca1\u6709\u6b63\u6587", "\u7a81\u7834\u4e0d\u91cd\u8981"), false);

console.log("adapter helper tests passed.");
