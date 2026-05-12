# Self-Evolution Memory System

This repository uses a bounded memory system so future agents get better at
gzhpublisher work without turning every session into permanent context.

## Default Policy

- **Project-local first:** repository facts, workflows, commands, and red lines
  live in `AGENTS.md`, `docs/`, and `skills/`.
- **Stage-close trigger:** memory review happens after meaningful milestones:
  completed implementation, push, publish-flow fix, repeated failure, or handoff.
- **Hook-assisted reminder:** repository Git hooks may create
  `.git/self-evolution-pending.md` after commits, merges, or before pushes. This
  file is a reminder only; it does not authorize silent memory writes.
- **Two-strike skill gate:** a repeated workflow, failure mode, or user correction
  becomes a skill rule after it appears twice. Hard red lines can be captured
  immediately.
- **Suggest before applying:** agents propose memory and skill updates before
  writing them, unless the user directly requested implementation.

## Installing Hooks In Another Project

Run this from the gzhpublisher repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install_self_evolution_hooks.ps1 -TargetRepo "C:\path\to\new-project" -InstallPolicy
```

The installer copies `.githooks/` and `scripts/self_evolution_hook.ps1`, sets
`core.hooksPath=.githooks`, and optionally creates starter policy files when they
do not already exist. It does not overwrite existing project policy unless
`-Force` is passed.

This follows the Agent Skills convention that reusable executable logic should
live in scripts and remain self-contained, while long guidance stays in docs or
references.

## Three Memory Layers

| Layer | Location | Use For | Avoid |
| --- | --- | --- | --- |
| Project memory | `AGENTS.md`, `README.md`, `docs/`, `skills/` | Stable repository facts, commands, red lines, workflows | Personal preferences unrelated to this repo |
| Knowledge wiki | `llm-wiki` wiki path | External articles, research synthesis, source-backed methods | Raw task logs and one-off project facts |
| Preference memory | Global agent memory, only after confirmation | Stable user preferences and cross-project red lines | Project-specific implementation details |

## Stage-Close Workflow

1. **Collect signals.** Review the latest work, changed files, user corrections,
   failed checks, repeated decisions, and `.git/self-evolution-pending.md` if it
   exists.
2. **Classify each signal.**
   - Project fact: update `AGENTS.md`, `README.md`, docs, or a project skill.
   - External reusable knowledge: ingest or update `llm-wiki`.
   - Stable preference/red line: propose preference memory.
   - Repeated procedure or mistake: mark as a skill candidate.
3. **Apply gates.**
   - One-off lesson: keep as a candidate or project note.
   - Seen twice: upgrade to an existing skill rule or a new skill if no existing
     skill fits.
   - User red line: record immediately in project memory and relevant skill.
4. **Produce a proposal.** Do not write memory by default. Show what would change
   and why.
5. **After confirmation, update the smallest sufficient layer.** Prefer editing
   existing files over adding new ones.

## Proposal Template

```markdown
## Memory Update Proposal

### Project Memory
- Add/update: ...
- Source: ...
- Why it matters: ...

### Wiki Knowledge
- Add/update: ...
- Source: ...
- Why it belongs in the wiki: ...

### Preference Memory
- Add/update: ...
- Confirmation needed because: ...

### Skill Candidates
- Candidate: ...
- Strike count: 1/2 or 2/2
- Action: keep candidate | update existing skill | create new skill
```

## gzhpublisher Pilot Rules

- Author red line: generated WeChat articles use `author: 桥博士`, never
  `author: 宽论`.
- Publish red line: `mcp__wenyan-mcp__publish_article` gets only `file` and
  `theme_id`, with `theme_id: "orangeheart"`.
- Skill writing: keep the `SKILL.md` router small and move detailed guidance to
  `references/`.
- Knowledge source handling: external best-practice sources belong in `llm-wiki`
  and distilled repository standards, not as long pasted text inside skills.

## Acceptance Checks

- A future agent can find project red lines without reading chat history.
- A stage-close review produces a proposal instead of silently changing memory.
- Git hooks create a pending review reminder without changing tracked memory.
- Temporary task logs are not promoted to long-term memory.
- Repeated failure modes have a path to become skill rules.
- Every long-term memory item has a source, boundary, and intended use.
