# 同事安装与前置准备

## 目录

1. 需要什么
2. 安装 Skill
3. 准备文章项目
4. 配置可选 GLM 配图
5. 配置 wenyan-mcp
6. 首次验收

## 需要什么

基础能力：

- Codex，能够加载 `$CODEX_HOME/skills` 或 `$HOME/.codex/skills`。
- Python 3.10 或更高版本。
- 一个可写的文章项目目录。

自动配图额外需要：

- 有合法使用权的本地图片目录。
- BigModel/GLM API Key；文章段落会发送给该服务生成 embedding。

发布到微信公众号草稿箱额外需要：

- Node.js 18+ 与 `npx`。
- 可管理目标公众号的 AppID/AppSecret。
- 当前公网 IP 已加入公众号 API 白名单。
- Codex 已配置本地 `wenyan-mcp`，并在新任务中能看到
  `mcp__wenyan-mcp__publish_article`。

## 安装 Skill

克隆仓库后运行：

```powershell
git clone https://github.com/AnziBai/codex-skills.git
cd codex-skills
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\publish-gzh\scripts\register-local-skill.ps1" -Json
```

如果目标目录已存在，脚本会停止。只有确认要覆盖旧版本时才使用 `-Force`。
安装后重启 Codex 或新建任务，让 Skill 元数据重新加载。

也可以把 `skills/publish-gzh` 整个目录复制到：

```text
%CODEX_HOME%\skills\publish-gzh
```

未设置 `CODEX_HOME` 时使用：

```text
%USERPROFILE%\.codex\skills\publish-gzh
```

## 准备文章项目

Skill 不捆绑业务文章、品牌私料或图片。建议项目结构：

```text
article-project/
|-- articles/
|   |-- drafts/
|   `-- published/
|-- assets/
|   `-- article-images/
|-- config/
|   `-- image-index.json
`-- sources/
```

项目根目录可以放在任何位置，不要依赖固定用户名。当前 PowerShell 会话可设置：

```powershell
$env:GZH_PROJECT_ROOT = "C:\path\to\article-project"
```

## 配置可选 GLM 配图

只在需要自动配图的终端会话里设置密钥：

```powershell
$env:GLM_API_KEY = "<your-key>"
```

不要把值写进 Python、Markdown、Git 配置或文章。对旧项目中曾硬编码或提交过的
密钥，先在服务端撤销并新建，再开始迁移。

## 配置 wenyan-mcp

在本机 Codex 用户级 `config.toml` 中配置本地 MCP。路径通常位于
`%CODEX_HOME%\config.toml`；未设置 `CODEX_HOME` 时位于
`%USERPROFILE%\.codex\config.toml`。

```toml
[mcp_servers.wenyan-mcp]
command = "npx"
args = ["-y", "wenyan-mcp"]
startup_timeout_sec = 30

[mcp_servers.wenyan-mcp.env]
WECHAT_APP_ID = "<your-app-id>"
WECHAT_APP_SECRET = "<your-app-secret>"
```

凭据只留在本机配置。不要把真实值粘进对话、Skill、文章项目或 Git。修改配置后
重启 Codex，并先确认工具已加载；如果工具不可见，不要尝试发布。

## 首次验收

先运行离线测试和核心写作模式诊断；这一步不要求 GLM 或微信公众号：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\skills\publish-gzh\scripts\test-publish-gzh.ps1"
python ".\skills\publish-gzh\scripts\publish_gzh.py" doctor --project-root "$env:GZH_PROJECT_ROOT" --mode write --json
python ".\skills\publish-gzh\scripts\publish_gzh.py" validate --article "C:\path\to\test.md" --asset-root "$env:GZH_PROJECT_ROOT\assets" --json
```

配置完 GLM、图库、索引、Node 和 wenyan-mcp 后，再运行完整集成诊断：

```powershell
python ".\skills\publish-gzh\scripts\publish_gzh.py" doctor --project-root "$env:GZH_PROJECT_ROOT" --mode full --json
```

再用一篇不含真实业务数据的测试文章运行 `validate`。首次验收只验证到草稿箱，
最终公开发送必须由公众号后台人工完成。
