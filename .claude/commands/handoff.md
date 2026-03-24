Generate a session handoff for continuity. Supports two modes: manual (default) and chain (autonomous).

Task context: $ARGUMENTS

---

## Mode Detection

Parse $ARGUMENTS to determine mode:

- If $ARGUMENTS contains **"chain"** or **"auto"** → **CHAIN MODE** (autonomous session continuation)
- If $ARGUMENTS is empty, contains **"manual"**, or contains any other text → **MANUAL MODE** (static handoff document)

---

# MANUAL MODE

*Backward-compatible static handoff. Writes `.claude/docs/ops/HANDOFF.md` for human-initiated session resumption.*

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

### Step 5 — Write Handoff Document

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

**END OF MANUAL MODE — do not continue to Chain Mode steps.**

---

# CHAIN MODE

*Autonomous session continuation. Writes `.claude/chain-context.md`, updates governed state, and spawns a successor Claude Code session if work remains.*

### Step 1 — Gather State

Read and capture all of the following:

1. `.claude/docs/ops/SYSTEM_STATE.md` — current phase (read first 60 lines for summary)
2. `.claude/docs/ops/ACTIVE_SLICE.md` — active slice identifier
3. `.claude/docs/ops/SLICE_STATUS.md` — current lifecycle status
4. `.claude/docs/ops/NEXT_ACTION.md` — next authorized action
5. `.claude/docs/ops/CURRENT_FOCUS.md` — current focus context
6. `.claude/docs/ops/AGENT_QUEUE.md` — assigned agents
7. `.claude/docs/chains/[SLICE-ID].md` — active governance chain doc (if a slice is active; use the slice ID from ACTIVE_SLICE.md)
8. `.claude/chain-context.md` — prior session chain state (for session count and Chain History table)

### Step 2 — Determine Chain State

Assess the current situation and set Chain State:

| Condition | Chain State |
|-----------|-------------|
| Work remains in the current slice or work queue | `ACTIVE` |
| Context approaching 60% but work remains | `ACTIVE` (proactive handoff) |
| Review gate pending that requires principal input | `PAUSED` |
| Escalation trigger has fired (§14.4) | `PAUSED` |
| Principal decision required before proceeding | `PAUSED` |
| Error that cannot be resolved within slice scope | `PAUSED` |
| Slice complete and closed, work queue empty | `COMPLETE` |

### Step 3 — Write chain-context.md

Overwrite `.claude/chain-context.md` with the complete schema. Preserve the file header (file_class, owner, write_rule, purpose).

**Fields to populate:**

- **Chain State:** From Step 2
- **Handoff Timestamp:** Current time in ISO-8601 format
- **Session Count:** Increment from prior chain-context.md session count (or 1 if this is the first handoff)
- **System State Snapshot:**
  - Phase: from SYSTEM_STATE.md
  - Active Slice: from ACTIVE_SLICE.md
  - Slice Status: from SLICE_STATUS.md
  - Chain Doc: path to `.claude/docs/chains/[SLICE-ID].md` if applicable, else "None"
- **Completed This Session:** Bullet list of concrete deliverables — file paths, test results, decisions made. Be specific.
- **Next Action:** The exact task the successor session should execute first. Must be precise and unambiguous — the successor executes this literally.
- **Pending Review Gates:** Any review gates that block further autonomous execution. If Chain State is PAUSED, this must explain why.
- **Warnings and Risks:** Known issues, failed tests, flaky areas, architectural concerns. "None" if clean.
- **Work Queue Remaining:** Ordered list of remaining work items. Successor picks up from the top after completing the Next Action.
- **Chain History:** Carry forward ALL prior rows from the previous chain-context.md, then append one new row for this session:
  ```
  | [session count] | [timestamp] | [summary of this session] | [next action for successor] |
  ```

### Step 4 — Update Governed State Files

Ensure all governed state files are current before spawning:

1. **NEXT_ACTION.md** — must reflect the Next Action from chain-context.md
2. **SLICE_STATUS.md** — must reflect current slice status accurately
3. **ACTIVE_SLICE.md** — confirm it reflects the current slice (update if it changed)
4. **Governance chain doc** (if exists) — verify its Status section is current and consistent

Append decisions made this session to **DECISION_LOG.md** if not already appended.

Append to **audit-log.jsonl**:
```json
{"timestamp":"[ISO-8601]","task_id":"[SLICE-ID or 'no-slice']","action":"session_handoff","actor":"command","target":"chain-context.md","detail":{"session_count":[N],"chain_state":"[ACTIVE|PAUSED|COMPLETE]","next_action":"[brief description]"}}
```

### Step 5 — Spawn or Stop

**If Chain State is `PAUSED` or `COMPLETE`:**
Do NOT spawn a successor session. Output:
- Chain state: [PAUSED/COMPLETE]
- Reason: [why the chain stopped]
- What was accomplished: [summary]
- What needs attention: [blocking condition or "Work complete"]
- How to resume (if PAUSED): "Resolve the blocking condition, set Chain State to ACTIVE in `.claude/chain-context.md`, then run `/resume` or `Start-AgentChain.ps1 -Resume`"

**If Chain State is `ACTIVE`:**
Spawn a successor session. Execute via Bash:

```powershell
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location 'PROJECT_PATH'; claude -p '/resume' --dangerously-skip-permissions"
```

Replace `PROJECT_PATH` with the actual absolute path to the project root (the directory containing `.claude/` and `CLAUDE.md`).

### Step 6 — Confirm and Exit

Output:
- Session [N] complete.
- Chain state written to `.claude/chain-context.md`
- Summary: [what was accomplished this session]
- Next session will: [Next Action]
- Chain state: [ACTIVE/PAUSED/COMPLETE]

If successor was spawned: "Successor session launched in new PowerShell window. This session will now exit."
If not spawned: "Chain [paused/complete]. No successor spawned."

---

## Safety Constraints (Chain Mode)

- **Never spawn a successor if Chain State is PAUSED or COMPLETE**
- **Never spawn a successor if a Sentinel review gate is pending**
- **Never modify files outside the active slice scope**
- **Always write chain-context.md BEFORE spawning** — if the spawn fails, the chain context file is still available for manual resumption
- **Always update DECISION_LOG.md before handoff** — no decisions lost at session boundaries
- **Always update governed state files before handoff** — the successor must boot into consistent state
