# 公众号文章工作流

## 目录

1. 输入与模式判断
2. Checkpoint 1：任务清单
3. Checkpoint 2：写作
4. Checkpoint 3：独立审核
5. Checkpoint 4：配图与渲染检查
6. Checkpoint 5：发布门禁
7. Checkpoint 6：草稿箱与交付

## 输入与模式判断

先判断本次任务属于哪一种：

- 原创文章
- 基于参考稿的结构重写
- 旧稿修订
- 仅审核
- 仅配图
- 仅发布已经审核的 Markdown

不要一上来就写正文。先确认目标读者、核心问题、事实来源、文章路径、
可用图片、是否需要发布到草稿箱。缺少选题细节时，可以根据已有材料给出
一个明确默认方案；缺少事实来源时，不能用猜测补齐。

## Checkpoint 1：任务清单

输出一个短清单：

```yaml
mode: original | rewrite | revise | audit | images | publish
audience: ...
reader_problem: ...
core_conclusion: ...
article_path: ...
source_pack:
  - path_or_url: ...
    intended_claims: [...]
assets:
  image_dir: ...
  image_index: ...
publish_requested: false
risks: [...]
```

参考稿只用于拆解标题机制、开头功能、论证节奏、情绪曲线和结尾动作。
不得复制完整原文，不得要求“标题和第一段基本不变”，不得把换关键词当成重写。

## Checkpoint 2：写作

文章使用 Markdown 和 YAML frontmatter：

```yaml
---
title: 文章标题
author: 桥博士
date: YYYY-MM-DD
tags: [公众号]
---
```

写作顺序：

1. 首屏先给读者问题与核心结论。
2. 用短段落和明确小标题展开，专业词第一次出现时用人话解释。
3. 每个关键数字、战绩、媒体背书、人物经历都绑定来源；没有来源就删掉。
4. 宽论/QMACD 只在能解决当前问题时出现，不做机械植入。
5. 《概率的朋友》只在承接方法体系时自然出现，不强行塞在结尾。
6. 涉及交易和市场内容时加入固定免责声明。

作者、合规和表达规则见
[content-and-compliance.md](content-and-compliance.md)。

写作 Agent 的交付必须包含：文章绝对路径、使用的来源、未采用的可疑事实、
仍需人工确认的项目。不能只返回一段聊天文本。

## Checkpoint 3：独立审核

有子 Agent 时，把最终 Markdown、来源清单和审核标准交给一个没有参与写作的
审核 Agent。不要把“预期答案”或写作者的自我评价传给审核者。没有子 Agent 时，
先结束写作上下文，再以审核清单逐项重读。

审核顺序：

1. **P0 发布阻断**：作者错误、投资建议或收益保证、虚构事实、无来源高风险
   数据、缺少免责声明、残留密钥或私人信息。
2. **P1 渲染阻断**：标题缺失或过长、重复 frontmatter、本地 Markdown 图片、
   图片文件不存在、占位符、禁止导流文字。
3. **P2 内容质量**：首屏没有结论、结构跳跃、证据与结论不匹配、品牌植入生硬。
4. **P3 文字问题**：空泛过渡、重复、过长段落、AI 腔。

审核输出：

```yaml
status: PASS | FAIL
blockers:
  - location: ...
    rule: ...
    fix: ...
warnings: [...]
source_gaps: [...]
```

`FAIL` 后只能修改被指出的问题，再重新审核；不能带着阻断项继续发布。

## Checkpoint 4：配图与渲染检查

配图是可选能力，不是没有 GLM Key 就无法写稿的硬依赖。需要自动配图时，先按
[image-pipeline.md](image-pipeline.md) 生成计划，再由人或审核 Agent 检查图文相关性。

图片规则：

- 内容图优先使用有授权的项目图库或可访问 URL。
- 本地图片使用 HTML `<img>`，不用 `![](C:/...)`。
- `src` 使用规范化绝对路径，样式至少包含圆角和最大宽度。
- 自动选择后逐张读文件名与上下文；不匹配就删除，宁缺毋滥。
- 不提交二维码、书封、图库、向量索引或生成结果到 skills 仓库。

配图后必须重新运行审核和确定性校验。

## Checkpoint 5：发布门禁

运行：

```powershell
python <publish_gzh.py> validate `
  --article "C:\absolute\article.md" `
  --asset-root "C:\absolute\article-project\assets" `
  --json
```

只有同时满足以下条件才能发布：

- 校验脚本退出码为 0。
- 独立审核为 `PASS`。
- 每个本地封面和正文图片都位于显式 `--asset-root` 内，扩展名与文件存在性已通过。
- 用户已经明确要求把该文章送入微信草稿箱。
- Codex 中可见 `mcp__wenyan-mcp__publish_article`。
- 文章路径和目标公众号由操作者确认。

## Checkpoint 6：草稿箱与交付

调用发布工具时只传：

```text
file: 文章绝对路径
theme_id: orangeheart
```

不要传 `app_id`、`content` 或整篇 Markdown。成功后记录 Media ID，说明文章只进入
草稿箱，声明原创、选择合集、最终公开发送仍在公众号后台人工完成。

Git 提交、推送和 PR 不属于公众号发布的默认副作用。只有用户另行要求时才执行。
