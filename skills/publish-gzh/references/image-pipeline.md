# 可移植配图流程

## 原则

- Skill 不包含图库和向量索引；它们属于业务项目和资产权限范围。
- `GLM_API_KEY` 只从环境变量读取。
- 新索引保存相对路径，不保存用户名或某台电脑的绝对路径。
- 自动配图默认只生成计划；必须显式加 `--write` 才修改文章。
- 修改使用同目录临时文件和原子替换；失败时原文章保持不变。
- 发送文章段落到外部 API 前，必须告知操作者并得到确认。

## 1. 建立相对路径索引

```powershell
python <publish_gzh.py> build-index `
  --image-dir "C:\path\to\article-project\assets\article-images" `
  --output "C:\path\to\article-project\config\image-index.json" `
  --confirm-external-processing `
  --json
```

图片描述默认来自文件名。文件名应说明图表含义，避免只有 `IMG_001.jpg`。

## 2. 迁移旧绝对路径索引

已有 embedding 时不用重新付费生成。把旧索引按文件名映射到新图库：

```powershell
python <publish_gzh.py> migrate-index `
  --legacy-index "C:\old\image_embeddings_index.json" `
  --image-dir "C:\path\to\article-project\assets\article-images" `
  --output "C:\path\to\article-project\config\image-index.json" `
  --json
```

任何找不到或重名的文件都会成为 blocker，不能静默猜路径。

## 3. 只生成插图计划

下面命令会把候选文章段落发送到 GLM embedding API，但不会修改文章：

```powershell
python <publish_gzh.py> add-images `
  --article "C:\path\to\article.md" `
  --image-dir "C:\path\to\article-project\assets\article-images" `
  --index "C:\path\to\article-project\config\image-index.json" `
  --confirm-external-processing `
  --json
```

检查输出中的段落预览、图片文件名和相似度。Embedding 只能做候选召回，不能替代
人对图意、数据口径、版权和文章上下文的判断。

## 4. 写入文章

确认计划后重复命令并加 `--write`：

```powershell
python <publish_gzh.py> add-images `
  --article "C:\path\to\article.md" `
  --image-dir "C:\path\to\article-project\assets\article-images" `
  --index "C:\path\to\article-project\config\image-index.json" `
  --confirm-external-processing `
  --write `
  --json
```

脚本保留 frontmatter，不重复已有图片，使用正斜杠 HTML 路径，并把第一张匹配图
写入 `cover`。写入后用 `--asset-root <图片资产上级目录>` 重新运行 `validate`，
再做独立审核。

## 降级路径

- 没有 GLM Key：跳过自动匹配，人工选择有授权图片。
- 外部处理不获批准：不能运行 `build-index` 或 `add-images`；人工配图。
- 少于理想图片数：宁缺毋滥，不为了凑数插入无关图。
- API 失败：不修改文章，记录精确错误后重试或改人工流程。
