# 微信草稿箱发布

## 发布前确认

发布是外部写操作。只有用户明确要求发布指定文章，并且以下检查全部通过时执行：

- 文章绝对路径已确认。
- `validate` 退出码为 0；所有本地图片都通过显式 `--asset-root` 约束。
- 独立内容审核为 `PASS`。
- frontmatter 作者为 `桥博士`。
- 主题为 `orangeheart`。
- 目标公众号和凭据由操作者确认。
- Codex 已加载 `mcp__wenyan-mcp__publish_article`。

## 工具调用契约

只传两个字段：

```js
mcp__wenyan-mcp__publish_article({
  file: "C:\\absolute\\path\\article.md",
  theme_id: "orangeheart"
})
```

不要传：

- `app_id`
- `content`
- 原始 Markdown 正文
- 其他没有在当前项目验证过的参数

凭据由本机 MCP 配置提供，不放进工具参数。

## 成功交付

记录并返回：

```text
Published to WeChat draft box.
Article: <absolute path>
Theme: orangeheart
Media ID: <returned id>
Final public send: manual in WeChat backend
```

## 发布后人工步骤

在微信公众号后台检查封面、图片、样式、原创声明和合集，再由人决定是否公开发送。
创建草稿成功不等于已经公开发布。

除非用户另行要求，不要因为创建了公众号草稿而自动执行 `git add`、`git commit`
或 `git push`。
