# 同事 Quick Start：在 Codex 中启用公众号文章工作流

这条最短路径会完成四件事：安装 `$publish-gzh`、配置 Codex 的
`wenyan-mcp`、创建文章项目、跑通离线自检。离线自检不会调用 GLM，也不会写入
微信公众号。

## 1. 检查本机环境

基础写作环境先检查：

```powershell
python --version
git --version
```

需要 Python 3.10+。需要发布到微信公众号草稿箱时，再检查：

```powershell
node --version
npx --version
```

发布需要 Node.js 18+ 和 `npx`。如果当前只写文章，可以先不配置 Node.js 和
公众号凭据。

## 2. 安装 Skill

```powershell
git clone https://github.com/AnziBai/codex-skills.git
cd codex-skills
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\publish-gzh\scripts\register-local-skill.ps1" -Json
```

看到 `"status": "PASS"` 和 `"restart_required": true` 后，重启 Codex 或
新建任务。已有旧版本时，脚本会停止；确认要替换后再在命令末尾加 `-Force`。

## 3. 配置 Codex 的微信公众号 MCP

如果只写文章，跳到第 4 步。需要创建公众号草稿时，编辑 Codex 用户级
`config.toml`：

- 设置了 `CODEX_HOME`：`%CODEX_HOME%\config.toml`
- 未设置 `CODEX_HOME`：`%USERPROFILE%\.codex\config.toml`

加入以下配置：

```toml
[mcp_servers.wenyan-mcp]
command = "npx"
args = ["-y", "wenyan-mcp"]
startup_timeout_sec = 30

[mcp_servers.wenyan-mcp.env]
WECHAT_APP_ID = "<your-app-id>"
WECHAT_APP_SECRET = "<your-app-secret>"
```

把占位符替换为目标公众号的 AppID 和 AppSecret，并把当前公网 IP 加入公众号
API 白名单。`config.toml` 只留在本机，不要把真实凭据提交到 Git、粘贴到对话，
或写进文章项目。修改后重启 Codex。

## 4. 创建文章项目

仍在仓库根目录的 PowerShell 中运行：

```powershell
$ProjectRoot = Join-Path $HOME "Documents\gzh-article-project"
New-Item -ItemType Directory -Force `
  (Join-Path $ProjectRoot "articles\drafts"), `
  (Join-Path $ProjectRoot "articles\published"), `
  (Join-Path $ProjectRoot "assets\article-images"), `
  (Join-Path $ProjectRoot "config"), `
  (Join-Path $ProjectRoot "sources") | Out-Null
$env:GZH_PROJECT_ROOT = $ProjectRoot
$env:GZH_PROJECT_ROOT
```

文章、来源材料和图片属于项目数据，不要复制到 Skill 目录。

## 5. 跑离线自检

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\publish-gzh\scripts\test-publish-gzh.ps1"
python ".\skills\publish-gzh\scripts\publish_gzh.py" doctor `
  --project-root "$env:GZH_PROJECT_ROOT" --mode write --json
```

成功标志：第一条命令输出 `publish-gzh tests passed.`，第二条结果的顶层
`status` 是 `PASS`。如果失败，先按输出中的 `block` 项修复，不要进入发布。

## 6. 在 Codex 中做首次检查

新建 Codex 任务并发送：

```text
使用 $publish-gzh，只检查配置，不发布。对我的文章项目运行 write 模式 doctor；
如果配置了公众号发布，再确认 mcp__wenyan-mcp__publish_article 是否可用。
项目根目录：<第 4 步输出的绝对路径>
```

Codex 能识别 `$publish-gzh`，且 `doctor` 返回 `PASS`，说明写作模式已就绪。
发布模式的 `doctor` 会保留一次人工确认，因此工具可见时返回 `NEEDS_HUMAN`
是正常结果，不代表配置失败。

## 7. 创建第一篇测试文章

先使用不含真实业务秘密的来源材料，发送：

```text
使用 $publish-gzh，根据 sources 目录中的材料写一篇公众号测试稿。
作者必须是桥博士。先完成草稿和独立审核，不调用 GLM，不发布到公众号。
项目根目录：<第 4 步输出的绝对路径>
```

确认文章内容后，再明确要求 Codex 校验指定文章。只有 `validate` 和独立审核都为
`PASS` 时，才能要求它创建微信公众号草稿。创建草稿不等于公开发布；最终发送
必须在微信公众号后台人工完成。

## 可选：启用 GLM 自动配图

只在需要配图的 PowerShell 会话中设置：

```powershell
$env:GLM_API_KEY = "<your-key>"
```

文章段落会发送给外部 embedding 服务。必须先获得操作者明确确认，并先生成配图
计划；没有审阅计划前不要使用 `add-images --write`。完整命令见
[图片索引与自动配图](image-pipeline.md)。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| Codex 不识别 `$publish-gzh` | 确认安装结果中的目标路径，然后重启 Codex 或新建任务。 |
| `doctor --mode write` 失败 | 修复输出里的 `block` 项；最常见的是 Python 版本过低或项目目录不存在。 |
| 看不到 `mcp__wenyan-mcp__publish_article` | 检查 Node.js 18+、`npx`、`config.toml` 段名和凭据，然后重启 Codex。 |
| 微信接口返回 IP 相关错误 | 把当前公网 IP 加入公众号 API 白名单后重试。 |
| 校验提示作者错误 | frontmatter 必须是 `author: 桥博士`，不能写 `宽论`。 |
| 本地图片校验失败 | 使用文章项目 `assets` 目录，并在校验时显式传入 `--asset-root`。 |

完整前置要求见[安装与准备](setup.md)，标准工作流见[工作流程](workflow.md)，
发布边界见[微信草稿箱发布](publishing.md)，错误码见[故障排查](troubleshooting.md)。
