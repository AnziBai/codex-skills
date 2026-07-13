---
name: publish-gzh
description: Use when creating, rewriting, auditing, image-matching, validating, or publishing Kuanlun/QMACD Chinese WeChat Official Account articles in the gzhpublisher workflow; also use for teammate setup, portable image-index migration, and wenyan-mcp troubleshooting.
---

# Publish GZH

Run the article pipeline as explicit checkpoints: intake, source-backed draft,
independent audit, optional image matching, deterministic validation, and WeChat
draft-box publishing. Keep credentials and private content outside the skill.

## Choose The Path

- New article or rewrite: read [workflow.md](references/workflow.md) and
  [content-and-compliance.md](references/content-and-compliance.md).
- Teammate installation or a new machine: follow
  [quick-start.md](references/quick-start.md). Read
  [setup.md](references/setup.md) for the full prerequisite matrix, then run
  `doctor` before doing article work.
- Image matching or an old absolute-path image index: read
  [image-pipeline.md](references/image-pipeline.md).
- Draft-box publishing or failure recovery: read
  [publishing.md](references/publishing.md) and
  [troubleshooting.md](references/troubleshooting.md).
- Audit-only: read the article and its source pack, then apply the publish gate
  in [workflow.md](references/workflow.md). Do not rewrite silently.

## Hard Boundaries

- Set frontmatter `author: 桥博士`; reject `author: 宽论`.
- Use only source-backed facts. Never invent people, dates, media mentions,
  awards, trading results, testimonials, survey data, or user outcomes.
- Position Kuanlun/QMACD as quant-analysis technology and methodology education,
  not investment advice, stock tips, account diagnosis, or guaranteed profit.
- Treat benchmark articles as structural references. Do not copy their wording,
  opening paragraph, or full text into the deliverable or skill.
- Never store API keys, WeChat credentials, cookies, account state, private
  source packs, QR codes, article corpora, or generated image indexes in this
  skill or in git.
- Before sending article text to an external embedding API, disclose that data
  transfer and require explicit operator confirmation.
- Publishing creates a WeChat draft only after the user has requested it and all
  blockers pass. The final public send remains manual in the WeChat backend.
- Do not commit or push article/project changes unless the user separately asks.

## Run The Checkpoints

1. **Intake:** identify mode, audience, article path, project root, evidence
   sources, asset availability, and whether draft publishing is in scope.
2. **Draft:** write Markdown with YAML frontmatter. Save claims with a source
   map; omit or mark unresolved claims instead of guessing.
3. **Audit:** use an independent context or subagent when available. Return
   `PASS` or `FAIL`, with blockers before style issues and exact locations.
4. **Images:** make an insertion plan first. Use `add-images --write` only after
   the operator confirms external processing and reviews the plan.
5. **Validate:** run the deterministic validator. A nonzero exit blocks publish.
6. **Publish:** call `mcp__wenyan-mcp__publish_article` with only the absolute
   article `file` and `theme_id: "orangeheart"`. Record the returned Media ID.

## Resolve The CLI

Prefer the repository copy while developing this skill; otherwise use the
registered copy under `$CODEX_HOME/skills` or `$HOME/.codex/skills`.

```powershell
$RepoCli = Join-Path (Get-Location) "skills\publish-gzh\scripts\publish_gzh.py"
$CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$LocalCli = Join-Path $CodexHome "skills\publish-gzh\scripts\publish_gzh.py"
$Cli = if (Test-Path -LiteralPath $RepoCli) { $RepoCli } else { $LocalCli }
if (-not (Test-Path -LiteralPath $Cli)) { throw "publish-gzh CLI not found: $Cli" }

python $Cli doctor --project-root "C:\path\to\article-project" --mode full --json
python $Cli validate --article "C:\path\to\article.md" `
  --asset-root "C:\path\to\article-project\assets" --json
```

For image commands, follow [image-pipeline.md](references/image-pipeline.md).
Never add `--write` during the planning pass.

## Output Contract

At each checkpoint report:

- status: `PASS`, `FAIL`, `NEEDS_INPUT`, or `NEEDS_HUMAN`
- artifact: absolute article or report path
- evidence: source files or validation result used
- blockers: exact issue and one concrete fix
- next action: the smallest safe next step

After successful draft publishing, report the article path, `orangeheart`
theme, Media ID, and that final public sending is still manual.
