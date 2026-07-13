# AnziBai Skills

#### 在真实工作流里跑通、能交给同事复用的 Codex Skills

[![Skills](https://img.shields.io/badge/Skills-Codex-black)](https://github.com/AnziBai/codex-skills)
[![Primary Skill](https://img.shields.io/badge/Primary-filler-2f6fed)](skills/filler/SKILL.md)
[![Runtime](https://img.shields.io/badge/Runtime-Node.js%20%2B%20PowerShell-1f883d)](skills/filler/draft-fill/package.json)
[![Automation Boundary](https://img.shields.io/badge/Boundary-human%20final%20publish%20click-f59e0b)](skills/filler/README.md)

这里收纳的是我自己和团队会反复使用的 AI skills。不是灵感碎片，也不是一次性 prompt 仓库。

一个 skill 只有满足这几个条件，才值得进来：

- 在真实业务里跑过，不只是 demo。
- 能被同事从零安装、登录、验证、复现。
- 有明确边界，知道哪些事情该自动化，哪些事情必须停下来问人。
- 有文档、脚本、测试和故障诊断路径。
- 不提交账号、cookie、Chrome profile、截图、DOM dump、临时 workdir 或任何秘密。

设计参考了 [KKKKhazix/khazix-skills](https://github.com/KKKKhazix/khazix-skills) 的仓库门面思路：一句话讲清楚用途，目录能快速扫，安装方式足够短，每个 skill 都说明适合什么、不适合什么、怎么触发。

---

## Skills

| Skill | 一句话 | 状态 | 入口 |
| --- | --- | --- | --- |
| `filler` | 把已经完成的作品变成平台发布草稿：AI 写标题和文案，CLI 校验素材，Playwright 自动上传并填写小红书、抖音、视频号草稿；即时发布保存草稿，批量定时自动确认。 | 生产试运行 | [SKILL.md](skills/filler/SKILL.md) · [同事指南](skills/filler/README.md) |
| `publish-gzh` | 从选题、来源约束和中文写作开始，完成独立审稿、可选语义配图、确定性校验与微信公众号草稿箱发布。 | 候选发布 | [SKILL.md](skills/publish-gzh/SKILL.md) · [安装准备](skills/publish-gzh/references/setup.md) |

后续新的 skill 会继续放在 `skills/<skill-name>` 下。每个 skill 都应该可以单独安装、单独阅读、单独测试。

---

## 安装方式

如果你的 Codex 环境能访问这个仓库，直接让 Codex 安装目标 skill：

```text
帮我安装这个 skill：https://github.com/AnziBai/codex-skills/tree/main/skills/filler

帮我安装这个 skill：https://github.com/AnziBai/codex-skills/tree/main/skills/publish-gzh
```

手动方式：

```powershell
git clone https://github.com/AnziBai/codex-skills.git
cd codex-skills
```

然后运行 `filler` 的初始化命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\filler.ps1" setup-draft-fill -Json
```

安装 `publish-gzh` 到本机 Codex：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\publish-gzh\scripts\register-local-skill.ps1" -Json
```

安装完成后重启 Codex 或新建任务，让 Skill 元数据重新加载。公众号、GLM 和
wenyan-mcp 的前置配置见 [安装准备](skills/publish-gzh/references/setup.md)。

---

## Publish GZH

`publish-gzh` 把历史上分散在 Claude Agent、绝对路径脚本和本机配置里的公众号流程，
收敛成一个可移植的 Codex Skill：

```text
topic + source pack
        |
        v
source-backed Markdown draft
        |
        v
independent audit
        |
        v
optional GLM image plan
        |
        v
deterministic publish gate
        |
        v
WeChat draft box
        |
        v
human final send
```

核心边界：

- 作者固定为 `桥博士`，主题固定为 `orangeheart`。
- 不把无来源的战绩、盈利、媒体、人物或用户结果写进文章。
- 不提交 AppID/AppSecret、GLM Key、二维码、图库、文章语料或向量索引。
- 自动配图默认只生成计划；发送文章段落到外部 embedding API 前必须确认。
- 发布只创建微信公众号草稿；最终公开发送由人工完成。
- 公众号流程不会顺手提交或推送文章仓库，除非用户另外要求。

基础诊断与文章校验：

```powershell
python ".\skills\publish-gzh\scripts\publish_gzh.py" doctor --project-root "C:\path\to\article-project" --mode write --json
python ".\skills\publish-gzh\scripts\publish_gzh.py" validate --article "C:\path\to\article.md" --asset-root "C:\path\to\article-project\assets" --json
```

---

## Filler

`filler` 是这个仓库里的第一个生产级 skill。它解决的是一个很具体的问题：

> 作品已经做好了，但发布到小红书、抖音、视频号时，标题、正文、tag、合集、声明、音乐、定时和素材上传都要重复处理。

它不是要让 AI 临场操作网页，而是把工作拆成三层：

```text
finished work directory
        |
        v
AI copy layer
        |
        v
deterministic draft plan
        |
        v
Playwright draft filler
        |
        v
human final publish click
```

### 它会做什么

- 读取已经完成的作品目录和 `manifest.json`。
- 生成平台化标题、正文、tag、封面字和候选文案包。
- 让人选择文案候选，不直接覆盖原始作品。
- 生成 `draft-plan.json`，把素材路径、文案、平台设置变成确定性执行计划。
- 使用专用 Chrome profile 复用登录态。
- 自动上传图片或视频。
- 自动填写标题、正文、tag token、合集、原创或个人观点声明、音乐和定时设置。
- 基于已缓存的账号合集做确定性语义匹配，只有高置信匹配已有宽泛合集时才自动选择。
- 即时发布不会点击公开发布按钮，会保存草稿并关闭；多作品或多平台定时发布会在验证通过后自动确认定时发布。
- 输出 `draft-fill-result.json`、`logs/<target-id>/run.json` 和截图证据。

### 适合

- 已经完成内容生产，只想把发布准备工作标准化。
- 小红书、抖音、视频号这类页面字段很多、人工重复填写成本高的场景。
- 团队里多人发布，但希望流程、命名、日志和安全边界一致。
- 需要 AI 参与标题、介绍、tag 和平台化表达，但不希望 AI 随机点击网页。

### 不适合

- 想绕过登录、验证码、风控或平台限制。
- 想让程序直接点击即时公开发布按钮，或绕过定时读回验证。
- 没有整理作品目录、素材顺序和账号 profile 的临时发布。
- 平台页面刚大改，却不愿意先跑诊断和修 selector。

### 快速使用

创建样例 workdir：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\filler.ps1" sample-run -Platform "xiaohongshu" -Json
```

发布前提问和预检：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\filler.ps1" preflight -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -Json
```

真实填写草稿：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\filler.ps1" draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -ConfirmIntake -Json
```

批量填写草稿，串行执行并在当前项失败时停止：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\filler.ps1" batch-draft-fill -BatchPath ".\batch.json" -ConfirmIntake -Json
```

如果这是单条已经读回验证过时间的定时发布，并且你明确允许 CLI 点击平台的“定时发布”确认按钮：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\filler.ps1" draft-fill -WorkDir ".\work" -TargetId "xhs-main-note" -ProfileName "xhs-main" -ConfirmIntake -ConfirmScheduledPublish -Json
```

失败诊断：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\filler.ps1" diagnose-failure -WorkDir ".\work" -TargetId "xhs-main-note" -Json
```

### 平台状态

| 平台 | 状态 | 已覆盖 |
| --- | --- | --- |
| 小红书 | 批量定时已支持严格 gate 后确认，按钮不确定时转人工 | 多图上传、中文标题正文、话题 token、合集、原创声明、内容声明、定时读回、即时发布人工边界 |
| 抖音 | 支持人工合集/发布接管后的批量继续 | 多图和视频上传、标题正文、话题 token、合集或人工跳过、个人观点声明、推荐音乐、定时策略、返回作品管理/上传入口后继续 |
| 视频号 | 图文 `production-candidate`，支持人工合集/发布接管；视频仍实验 | 图文上传、标题正文、`#话题 + 空格` 蓝色 token、音乐、活动、定时和发布边界；合集/分类仍可能因账号差异返回 `needs_human` |

---

## 仓库结构

```text
.
|-- README.md
|-- AGENTS.md
|-- docs/
|   |-- filler-handoff.md
|   |-- filler-verification-evidence.md
|   `-- self-evolution-memory-system.md
|-- scripts/
|   `-- self_evolution_hook.ps1
`-- skills/
    |-- filler/
    |   |-- SKILL.md
    |   |-- agents/
    |   |-- draft-fill/
    |   |-- references/
    |   `-- scripts/
    `-- publish-gzh/
        |-- SKILL.md
        |-- agents/
        |-- references/
        `-- scripts/
```

`SKILL.md` 是给 Codex 看的入口；`references/` 放长文档和平台 runbook；`scripts/` 放可重复执行的确定性逻辑；`draft-fill/` 是 Playwright 执行层。

---

## 开发规则

新增或维护 skill 时，按这个标准收口：

1. `skills/<skill-name>/SKILL.md` 必须短、清楚、可触发。
2. 复杂说明放进 `references/`，不要把 `SKILL.md` 写成日志。
3. 能脚本化的流程放进 `scripts/`，不要每次让 Agent 重新发明。
4. 真实账号、cookie、profile、截图、DOM、临时 workdir 和依赖目录都不能提交。
5. 跑完一个阶段后看 `.git/self-evolution-pending.md`，先提出记忆更新建议，再修改长期记忆或 skill。

---

## 验证

`filler` 的基础验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\filler\scripts\test-filler.ps1"
```

Node 检查：

```powershell
cd ".\skills\filler\draft-fill"
npm run check
npm test
npm run robustness-matrix
```

`publish-gzh` 的离线验证（不调用 GLM，不写微信公众号）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\publish-gzh\scripts\test-publish-gzh.ps1"
```

如果只是文档改动，至少确认 README、`SKILL.md`、同事指南和 handoff 里的路径仍然一致：

```powershell
rg -n "skills\\filler|skills/filler|filler.ps1|final publish boundary|ConfirmIntake" README.md AGENTS.md docs skills/filler
```

---

## Handoff

继续开发前先读：

- [filler handoff](docs/filler-handoff.md)
- [verification evidence](docs/filler-verification-evidence.md)
- [production readiness](skills/filler/references/production-readiness.md)
- [failure diagnostics](skills/filler/references/failure-diagnostics.md)
- [WeChat Channels runbook](skills/filler/references/wechat-channels-real-publish-runbook.md)

当前最重要的下一步：用另一个两作品批次验证抖音和视频号的人工合集/发布接管循环，再把视频号图文的合集/分类缓存和账号指纹确认收口。
