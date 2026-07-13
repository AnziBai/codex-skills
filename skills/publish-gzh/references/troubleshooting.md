# 故障排查

## `mcp__wenyan-mcp__publish_article` 不可见

1. 检查 Codex 用户级 `config.toml` 是否有 `[mcp_servers.wenyan-mcp]`。
2. 检查 `node` 和 `npx` 是否在 PATH。
3. 修改配置后完全重启 Codex，并新建任务。
4. 工具仍不可见时停止发布；不要改用包含明文凭据的临时脚本。

## 微信错误 `40164`

当前公网 IP 不在公众号 API 白名单。到公众号后台“开发 / 基本配置”更新白名单，
再从同一篇已经审核的文章重试。不要把 IP 白名单错误误判为文章格式错误。

## 找不到标题

发布器读取 YAML frontmatter 的 `title`，不是正文 `# 标题`。运行 `validate`，补齐
唯一的一段 frontmatter。

## 作者错误

当前唯一合法值是 `author: 桥博士`。旧 README、旧文章或旧 Agent 中的
`author: 宽论` 已过期，不能照抄。

## 图片显示成路径文字

本地图片不能写成 `![](C:/...)`。改用 HTML：

```html
<img src="C:/path/to/image.jpg" alt="图片说明" style="border-radius: 8px; max-width: 100%;" />
```

校验本地图片时必须传 `--asset-root`。脚本会拒绝不存在的文件、非图片扩展名和
资产根目录之外的路径，避免把本机其他文件误当作公众号图片上传。

## 图片索引在新机器全部失效

旧索引保存了绝对路径。优先运行 `migrate-index` 按文件名迁移已有 embedding；
没有旧 embedding 或图库发生实质变化时才运行 `build-index`。

## frontmatter 重复

不要手工拼接旧配图脚本的输出。当前 `add-images` 只更新解析出的唯一
frontmatter，并通过原子替换写回。`validate` 检测到重复时先修复，再发布。

## API Key 缺失或泄露

- 缺失：只影响自动配图，不阻塞写作、人工配图或文章审核。
- 曾写进源码或提交：立即在服务端撤销/轮换；仅删除文件中的值不够。
- 新密钥只放进本机环境变量或受控凭据配置，不放进 Git。

## 外部处理未获批准

`build-index` 会发送图片文件名描述，`add-images` 会发送候选文章段落。操作者没有
确认时命令应退出，不要绕过 `--confirm-external-processing`。

## 自动配图不足或不相关

Embedding 是召回工具，不是编辑判断。删除不相关图片，允许少于目标数量；不要
为了通过数量规则插入误导性图片。配图后必须重新审核和校验。

## 旧资料中的盈利、媒体或从业年限冲突

把它们视为未解决事实。要求逐条来源并核对口径；没有来源就删除，不按出现次数
决定真伪。
