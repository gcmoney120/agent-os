Generate a structured session handoff document for continuity across sessions.

Task context: $ARGUMENTS

---

## Handoff Protocol

Gather the following information and write a complete handoff document to `.claude/docs/ops/HANDOFF.md`.

### Step 1 — Git State

Run these commands and capture output:
- `git branch --show-current` — current branch
- `git log --oneline -5` — last 5 commits
- `git diff --name-only` — uncommitted modified files
- `git diff --staged --name-only` — staged files

### Step 2 — Governance State

Read and summarize (1-2 lines each):
- `.claude/docs/ops/ACTIVE_SLICE.md` — active slice ID and name
- `.claude/docs/ops/SLICE_STATUS.md` — current lifecycle status
- `.claude/docs/ops/CURRENT_FOCUS.md` — what we're working on
- `.claude/docs/ops/NEXT_ACTION.md` — what happens next
- `.claude/docs/ops/AGENT_QUEUE.md` — who is assigned

### Step 3 — Session Work Summary

Summarize:
- What was accomplished this session
- Key decisions made (reference DECISION_LOG.md entry IDs if applicable)
- Any known bugs, build issues, or blockers encountered
- Files created or significantly modified

### Step 4 — Remaining Work

List:
- Tasks still pending from the current slice
- Any carry-forward items from OPEN_ISSUES.md that are in scope
- Specific next steps the resuming session should take

### Step 5 — Boot Instructions

Write the complete handoff to `.claude/docs/ops/HANDOFF.md` using this format:

```markdown
# Session Handoff — [date]

## Resume Command
[The exact slash command or instruction to resume work, e.g., "/dispatch:forge [task]" or "/govern:close-slice [slice-id]"]

## Git State
- Branch: [branch]
- Last commit: [hash] [message]
- Uncommitted changes: [list or "none"]

## Governance State
- Active slice: [ID] — [name]
- Status: [status]
- Next action: [action]

## Session Summary
[2-3 sentences on what was done]

## Key Decisions
[Bullet list with DL-XXX references, or "None"]

## Known Issues
[Bullet list, or "None"]

## Remaining Work
[Numbered list of specific next steps]
```

After writing HANDOFF.md, output a brief confirmation with the resume command so the user can copy it directly.
