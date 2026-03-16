---
file_class: CLASS_A_LIVE
owner: Command
write_rule: OVERWRITE
purpose: Records which agent is active, what they are authorized to do, and in what order. Command maintains this file. Agents read it to understand their queue position. Assignment detail lives in the corresponding PENDING_* file.
---

# AGENT_QUEUE

## Current queue

| Lane | Agent | Assignment | Status | PENDING_* file |
|------|-------|------------|--------|----------------|
| Atlas | Atlas | — | IDLE | PENDING_ATLAS.md |
| Forge | Forge | — | IDLE | PENDING_FORGE.md |
| Sentinel | Sentinel | — | IDLE | PENDING_SENTINEL.md |
| Compass | Compass | — | IDLE | PENDING_COMPASS.md |

## Current state
X-Series complete. No active slice. Awaiting Command directive.
