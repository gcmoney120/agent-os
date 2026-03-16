---
file_class: CLASS_B_ARCHIVE
status: DEPRECATED
deprecated_by: CTRL-S6
deprecated_at: 2026-03-14
superseded_by: .claude/docs/agents/COMMAND_ID.md v4.0
original_location: .claude/docs/governance/COMMAND_CHAT_BOOT_MANIFEST.md
reason: Command Reunification — single-surface operating model replaced the dual-surface model established by CTRL-S5
---

> **DEPRECATED** — This file was superseded by CTRL-S6. The content below is preserved for historical reference only. The authoritative Command specification is `.claude/docs/agents/COMMAND_ID.md`.

# COMMAND CHAT BOOT MANIFEST

**Purpose:** Defines the minimum required boot surface for Command Chat sessions that access the repository.

---

## 1. Canonical Governed Boot Surface

The canonical governed boot surface is repo-internal. All authoritative governed state lives within the repository file tree under `.claude/docs/`.

Command Chat must boot from repo-backed files. Command Chat must not rely on local-path assumptions, cached state, prior session memory, or externally reconstructed governance context. The repository is the single source of truth.

---

## 2. Minimum Required Boot Files

Command Chat must read the following files at session start, in this order, before taking any governing action:

### Identity and Governance Model

1. `.claude/docs/agents/COMMAND_ID.md` — shared Command governance foundation
2. `.claude/docs/agents/COMMAND_CHAT_ID.md` — Command Chat surface identity and operating model
3. `.claude/docs/governance/CONTROL_PLANE_OPERATING_MODEL.md` — canonical control-plane specification

### Live System State

4. `.claude/docs/ops/SYSTEM_STATE.md` — current phase, completed slices, milestone history
5. `.claude/docs/ops/CURRENT_FOCUS.md` — active slice context and constraints
6. `.claude/docs/ops/OPEN_ISSUES.md` — open blockers, stale-content invalidation procedure

### Operational Files

7. `.claude/docs/ops/ACTIVE_SLICE.md` — current active slice identifier
8. `.claude/docs/ops/SLICE_STATUS.md` — lifecycle status of the active slice
9. `.claude/docs/ops/COMMAND_DECISION.md` — most recent Command ruling
10. `.claude/docs/ops/NEXT_ACTION.md` — currently authorized action
11. `.claude/docs/ops/AGENT_QUEUE.md` — agent assignments and queue state
12. `.claude/docs/ops/ATLAS_LATEST.md` — current operative architecture

---

## 3. Boot Failure Rule

If any required file listed in Section 2 is unavailable at boot, Command Chat must fail closed with **BOOT BLOCKED**. Command Chat must not infer, reconstruct, or approximate missing governed state. No governing action is authorized until the full boot surface is confirmed available and read.

---

## 4. Surface Authority

Command Chat is the sole decisional and authorship surface for Command. All governing decisions, slice activations, agent rulings, and authoritative state changes originate in Command Chat.

Command Code is the verification-only surface. Command Code may read and inspect but holds no write authority on Command-owned control-plane files and may not issue governing directives.

---

## 5. Interaction Name

"Command" is the direct interaction name used by agents and the principal when addressing the Command authority. "Command Chat" is the surface label that distinguishes the primary governing surface from the verification-only Command Code surface.

---

*This manifest is a repo-preparation artifact. It does not establish new governance semantics, extend the control-plane operating model, or modify any authority boundary defined in CONTROL_PLANE_OPERATING_MODEL.md.*
