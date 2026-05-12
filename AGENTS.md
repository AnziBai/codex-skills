# Agent Memory

This project uses hook-assisted self-evolution reminders.

## Stage-Close Protocol

1. If .git/self-evolution-pending.md exists, treat it as a reminder to review
   memory, docs, wiki knowledge, and skill candidates.
2. Run the self-evolution skill.
3. Produce a proposal before changing project memory, preference memory, wiki
   knowledge, or skills.
4. Store project-specific facts locally, not in global memory, unless the user
   confirms they are cross-project preferences.
