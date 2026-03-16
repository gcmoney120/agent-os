---
file_class: CLASS_A_LIVE
owner: Command
write_rule: OVERWRITE
purpose: Records which agent is active, what they are authorized to do, and in what order. Command maintains this file. Agents read it to understand their queue position. Assignment detail lives in the corresponding PENDING_* file.
---

# AGENT_QUEUE

## Assignment model
```
Command authorizes work for an agent:
  → Command sets lane to IN_PROGRESS in this file
  → Command overwrites the agent's PENDING_* file with the assignment specification
  → Agent reads PENDING_* for assignment details
  → Agent executes and overwrites PENDING_* with governed output
  → Command reviews PENDING_*, writes to COMMAND_DECISION.md, appends to DECISION_LOG.md
  → Command sets lane to IDLE (or next assignment) in this file
  → Command clears or archives PENDING_* as appropriate
```

**No agent writes to another agent's PENDING_* file.**
**No agent writes to any Command-owned CLASS A file.**

---

## Current queue

| Lane | Agent | Assignment | Status | PENDING_* file |
|------|-------|------------|--------|----------------|
| Atlas | Atlas | X2 architecture — COMPLETE (DL-037) | IDLE | PENDING_ATLAS.md |
| Forge | Forge | X2 Physical Extraction implementation | AUTHORIZED | PENDING_FORGE.md |
| Sentinel | Sentinel | X2 trust review (pending Forge delivery) | QUEUED | PENDING_SENTINEL.md |
| Compass | Compass | X2 validation (pending Forge delivery) | QUEUED | PENDING_COMPASS.md |

---

## Current state
X-Series active. X2 — Physical Extraction APPROVED (DL-037). Forge authorized. Workspace root: C:\Users\Cyronick\Documents\pestfree-workspace\.
