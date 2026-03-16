---
file_class: CLASS_A_LIVE
owner: Command
write_rule: OVERWRITE
purpose: Canonical specification of the control-plane operating model for Agent OS. Defines file purposes, classes, ownership, write rules, promotion mechanics, authority flows, and lifecycle governance for all agents operating within the control-plane file system.
---

# CONTROL_PLANE_OPERATING_MODEL

**Document:** CTRL-S2 — Canonical Operating Model Specification
**Established:** 2026-03-14
**Baseline:** CTRL-S1 accepted file ownership and write rules preserved — no contract drift
**Authority:** Command
**Amended by:** CTRL-S5 — Dual-Surface Command Operating Model (added §13); CTRL-S6 — Command Reunification (revised §13 to single-surface model); B-2 — Session Boundary Protocol implementation (added §15)

---

## §1. Purpose and Scope

This document is the canonical specification governing how the control-plane file system under `.claude/docs/ops/` operates. It formalizes the steady-state governance model that follows the control-plane establishment completed under CTRL-S1.

This document defines:

- The purpose of every control-plane file
- The classification of files into the established file classes
- The ownership assignment for each file
- The write rules that constrain who may write what and when
- The authority boundaries for Command, Atlas, Forge, Sentinel, and Compass
- The promotion mechanics by which agent proposals become operative architecture
- The slice lifecycle from activation through closure
- The roles of each file in the governed workflow
- The rules for detecting and handling stale content
- The bootstrap exceptions that bounded the initial control-plane establishment
- The steady-state rules that govern all operations after bootstrap
- The Command identity model (§13)

All agents must read this document as authoritative for the governance contract. This document does not define enforcement tooling; compliance is operational.

---

## §2. File Inventory

All control-plane files live under `.claude/docs/ops/`.

The file class designations in this table are the canonical CTRL-S1 header classes. The write rules are as established by CTRL-S1 and preserved by CTRL-S2.

| File | Class | Owner | Write Rule |
|------|-------|-------|------------|
| `SYSTEM_STATE.md` | CLASS_B_HYBRID | Command | Conditional-Write (see §5.3) |
| `CURRENT_FOCUS.md` | CLASS_A_LIVE | Command | Overwrite |
| `ACTIVE_SLICE.md` | CLASS_A_LIVE | Command | Overwrite |
| `SLICE_STATUS.md` | CLASS_A_LIVE | Command | Overwrite |
| `NEXT_ACTION.md` | CLASS_A_LIVE | Command | Overwrite |
| `OPEN_ISSUES.md` | CLASS_A_LIVE | Command | Overwrite |
| `AGENT_QUEUE.md` | CLASS_A_LIVE | Command | Overwrite |
| `ATLAS_LATEST.md` | CLASS_A_LIVE | Command | Overwrite |
| `COMMAND_DECISION.md` | CLASS_A_LIVE | Command | Overwrite |
| `DECISION_LOG.md` | CLASS_B_APPEND | Command | Append-only |
| `SLICE_LEDGER.md` | CLASS_B_APPEND | Command | Append-only |
| `PENDING_ATLAS.md` | CLASS_A_PENDING | Atlas | Overwrite |
| `PENDING_FORGE.md` | CLASS_A_PENDING | Forge | Overwrite |
| `PENDING_SENTINEL.md` | CLASS_A_PENDING | Sentinel | Overwrite |
| `PENDING_COMPASS.md` | CLASS_A_PENDING | Compass | Overwrite |
| `archive/INDEX.md` | CLASS_B_APPEND | Command | Append-only |
| `archive/ARCH_*.md` | CLASS_B_ARCHIVE | Atlas (post-closure) | Write-once |
| `archive/REVIEW_*.md` | CLASS_B_ARCHIVE | Sentinel / Compass (post-closure, per lane) | Write-once |
| `audit-log.jsonl` | CLASS_B_APPEND | Command | Append-only |

---

## §3. File Classes

The control-plane file system uses the class designations established in CTRL-S1. These classes define technical governance at the file level and appear in every file's header block. This section also introduces three behavioral groupings — Authoritative, Proposal, and Operational — which describe governance roles in plain language. The behavioral groupings complement the established class system; they do not replace it.

### §3.1 Authoritative Files

**Behavioral meaning:** Authoritative files hold the canonical, accepted record of system state, decisions, and history. No agent output becomes authoritative until Command has issued a corresponding ACCEPTED ruling recorded in DECISION_LOG.md.

**CTRL-S1 classes in this group:** CLASS_B_APPEND, CLASS_B_ARCHIVE, CLASS_B_HYBRID, and CLASS_A_LIVE files that hold Command rulings (COMMAND_DECISION.md).

Files in this group: `SYSTEM_STATE.md`, `COMMAND_DECISION.md`, `DECISION_LOG.md`, `SLICE_LEDGER.md`, `archive/INDEX.md`, `archive/ARCH_*.md`, `archive/REVIEW_*.md`.

Defining characteristics:
- Content is operative — agents may act on it without further qualification
- Historical records within these files are never rewritten; errors are corrected by forward-looking entries
- Write authority is constrained by ownership (§4) and write rules (§5)

### §3.2 Proposal Files

**Behavioral meaning:** Proposal files hold agent output awaiting Command review. Content in a PENDING_* file is a proposal — not operative. A proposal does not become operative by virtue of existing in a PENDING_* file. It becomes operative only after Command issues an ACCEPTED ruling recorded in DECISION_LOG.md.

**CTRL-S1 class:** CLASS_A_PENDING.

Files in this group: `PENDING_ATLAS.md`, `PENDING_FORGE.md`, `PENDING_SENTINEL.md`, `PENDING_COMPASS.md`.

Defining characteristics:
- Each file is owned by exactly one agent
- Content is overwritten per submission cycle — CLASS_A_PENDING files are not logs
- No agent writes to another agent's PENDING_* file
- The history of proposals is preserved in DECISION_LOG.md, not in the PENDING_* file itself

**Proposal vs. authoritative state — key distinction:**

Proposal state: content that an agent has written to its PENDING_* file and submitted for Command review. It is pending. It is not operative. It may be accepted, rejected, or revised.

Authoritative state: content for which Command has issued an ACCEPTED ruling recorded in DECISION_LOG.md. Only at that point is the content operative. An agent must not act on a submission as if it were authoritative until the DECISION_LOG.md entry exists.

Example: Atlas writes an architecture proposal to `PENDING_ATLAS.md`. This is proposal state. Command reviews it, accepts it, writes the ruling to `COMMAND_DECISION.md`, and appends to `DECISION_LOG.md`. The architecture is now authoritative. Command may then promote it into `ATLAS_LATEST.md` as operative state. If Command rejects the proposal, it is a dead proposal — no agent may act on it as accepted.

### §3.3 Operational Files

**Behavioral meaning:** Operational files hold live system state. They are Command-owned, overwritten to reflect current truth, and do not accumulate history. They are authoritative for current state but not for historical record — for history, see the Authoritative files.

**CTRL-S1 class:** CLASS_A_LIVE (Command-owned subset).

Files in this group: `CURRENT_FOCUS.md`, `ACTIVE_SLICE.md`, `SLICE_STATUS.md`, `NEXT_ACTION.md`, `OPEN_ISSUES.md`, `AGENT_QUEUE.md`, `ATLAS_LATEST.md`.

Defining characteristics:
- Command is the sole writer
- Content reflects current state as of the last Command update
- Agents read these files to understand current authorized context before acting
- Stale content in these files is a blocking condition (see §10)

---

## §4. Ownership Model

File ownership assigns write authority. An agent may read any control-plane file. An agent may write only files it owns, subject to the write rules in §5.

| Owner | Files Owned |
|-------|-------------|
| Command | All CLASS_A_LIVE files; all CLASS_B_APPEND files; `SYSTEM_STATE.md` |
| Atlas | `PENDING_ATLAS.md`; `archive/ARCH_*.md` (post-closure, write-once) |
| Forge | `PENDING_FORGE.md` |
| Sentinel | `PENDING_SENTINEL.md`; its own `archive/REVIEW_*.md` artifact (post-closure, write-once) |
| Compass | `PENDING_COMPASS.md`; its own `archive/REVIEW_*.md` artifact (post-closure, write-once) |

**No agent writes to another agent's PENDING_* file.** No agent writes to any Command-owned file. These are hard ownership rules, not preferences.

**archive/REVIEW_*.md ownership:** Sentinel and Compass each author their own separate review archive artifact post-closure. Each lane is solely responsible for its own artifact. The exact filenames are specified in Command's post-closure directive.

---

## §5. Write Rules

Write rules define the permitted write operations for each file. Ownership (§4) determines who may execute these operations; write rules define how.

### §5.1 Overwrite-Permitted Files

The following files may be overwritten in place by their owner. Each overwrite replaces prior content entirely. The file always reflects current truth after an overwrite.

| File | Class | Owner |
|------|-------|-------|
| `CURRENT_FOCUS.md` | CLASS_A_LIVE | Command |
| `ACTIVE_SLICE.md` | CLASS_A_LIVE | Command |
| `SLICE_STATUS.md` | CLASS_A_LIVE | Command |
| `NEXT_ACTION.md` | CLASS_A_LIVE | Command |
| `OPEN_ISSUES.md` | CLASS_A_LIVE | Command |
| `AGENT_QUEUE.md` | CLASS_A_LIVE | Command |
| `ATLAS_LATEST.md` | CLASS_A_LIVE | Command |
| `COMMAND_DECISION.md` | CLASS_A_LIVE | Command |
| `PENDING_ATLAS.md` | CLASS_A_PENDING | Atlas |
| `PENDING_FORGE.md` | CLASS_A_PENDING | Forge |
| `PENDING_SENTINEL.md` | CLASS_A_PENDING | Sentinel |
| `PENDING_COMPASS.md` | CLASS_A_PENDING | Compass |

### §5.2 Append-Only Files

The following files accumulate records. No prior entry may be deleted, overwritten, or altered. New entries are appended only. These files are the durable historical record of the system.

| File | Class | Owner |
|------|-------|-------|
| `DECISION_LOG.md` | CLASS_B_APPEND | Command |
| `SLICE_LEDGER.md` | CLASS_B_APPEND | Command |
| `archive/INDEX.md` | CLASS_B_APPEND | Command |
| `audit-log.jsonl` | CLASS_B_APPEND | Command |

**Append-only invariant:** If an entry is found to be in error, the correction is made by a subsequent entry with an explicit correction notation. Prior entries are not modified.

### §5.3 Conditional-Write Files

The following files have write rules that depend on the section or lifecycle phase:

**`SYSTEM_STATE.md` (CLASS_B_HYBRID)**
- Summary and control sections: Command may overwrite in place to reflect current state.
- Milestone and progress history sections: Append-only. No historical record is rewritten. If a milestone requires correction, a corrective entry is appended; the original entry is not modified.
- Rationale: SYSTEM_STATE.md serves a dual purpose — it is a live state summary (overwrite-permitted sections) and a durable milestone history (append-only sections). The hybrid rule preserves both functions without collapsing them.

**`archive/ARCH_*.md`, `archive/REVIEW_*.md` (CLASS_B_ARCHIVE)**
- Write-once: written by the designated agent once, after Command closes the slice. Immutable thereafter. No further writes or modifications are permitted by any agent, including the author.

---

## §6. Authority Flow

### §6.1 Command Authority Boundaries

Command holds sole authority over:
- Which slice is active (ACTIVE_SLICE.md)
- The status of the active slice (SLICE_STATUS.md)
- The next authorized action for all agents (NEXT_ACTION.md)
- Open issues and blocking conditions (OPEN_ISSUES.md)
- Which agent is assigned to what (AGENT_QUEUE.md)
- The current operative architecture (ATLAS_LATEST.md)
- The ruling on every agent submission (COMMAND_DECISION.md)
- The append-only decision record (DECISION_LOG.md)
- The append-only closed-slice record (SLICE_LEDGER.md)
- Slice activation, closure, and scope changes
- Promotion of Atlas proposals into ATLAS_LATEST.md

Command does not implement, architect, or review in the agent sense; Command authorizes, rules, and closes.

### §6.2 Atlas Authority Boundaries

Atlas may:
- Write architecture proposals to `PENDING_ATLAS.md`
- Write its own `archive/ARCH_*.md` artifact post-closure (write-once)
- Read all control-plane files

Atlas may not:
- Promote its own proposals into `ATLAS_LATEST.md`
- Write to any Command-owned file
- Activate or close a slice
- Write to any other agent's PENDING_* file

### §6.3 Forge Authority Boundaries

Forge may:
- Write implementation deliverables to `PENDING_FORGE.md`
- Read all control-plane files

Forge may not:
- Write to any Command-owned file
- Write to any other agent's PENDING_* file
- Declare a slice closed or approved
- Write archive files of any class

### §6.4 Sentinel/Compass Authority Boundaries

Sentinel and Compass may:
- Write review and validation outputs to their respective PENDING_* files
- Write their own `archive/REVIEW_*.md` artifact post-closure (write-once, per lane)
- Read all control-plane files

Sentinel and Compass may not:
- Write to any Command-owned file
- Write to each other's PENDING_* file or to PENDING_FORGE.md or PENDING_ATLAS.md
- Issue formal slice approval or closure — their outputs are inputs to Command's ruling, not the ruling itself

---

## §7. Promotion Flow

### §7.1 PENDING_* → COMMAND_DECISION.md

The promotion flow for agent submissions:

1. Agent completes work (implementation, architecture, review, or validation)
2. Agent overwrites its own PENDING_* file with the submission
3. Agent notifies Command
4. Command reads the PENDING_* file
5. Command writes ruling to `COMMAND_DECISION.md` (overwrite): ACCEPTED or REJECTED with detail
6. Command appends entry to `DECISION_LOG.md`:
   ```
   [ISO-8601] | [agent] | [slice ref] | [submission type] | [ACCEPTED|REJECTED] | [reason]
   ```
7. If ACCEPTED:
   - Command updates relevant operational files (SLICE_STATUS.md, NEXT_ACTION.md, AGENT_QUEUE.md)
   - If Atlas submission: Command promotes content into ATLAS_LATEST.md (see §7.3)
   - Agent proceeds per NEXT_ACTION.md
8. If REJECTED:
   - Command sets SLICE_STATUS.md to REJECTED (or BLOCKED if systemic)
   - Command updates NEXT_ACTION.md with revised directive
   - Agent does not carry forward any part of the rejected submission
   - Agent overwrites its PENDING_* file with a revised submission on next attempt

**Critical invariant:** No agent output is operative until a corresponding ACCEPTED entry exists in DECISION_LOG.md. An agent must not act on a submission that has no matching DECISION_LOG.md entry.

### §7.2 COMMAND_DECISION.md → DECISION_LOG.md

`COMMAND_DECISION.md` holds the most recent ruling only. It is overwritten each decision cycle. The permanent, append-only record of all decisions is `DECISION_LOG.md`.

The relationship:
- `COMMAND_DECISION.md` = current signal: most recent ruling, readable by agents to determine current status
- `DECISION_LOG.md` = auditable history: every ruling in order, never modified

Every ruling written to `COMMAND_DECISION.md` must also be appended to `DECISION_LOG.md`. These two operations are coupled; a ruling that appears in `COMMAND_DECISION.md` but not in `DECISION_LOG.md` is incomplete.

The append-only rule for `DECISION_LOG.md` is absolute. Entries are never deleted, modified, or superseded in place. Corrections appear as new entries with explicit correction notations.

### §7.3 ATLAS_LATEST.md Promotion Meaning

`ATLAS_LATEST.md` is the operative architecture record. Its content originates from Atlas proposals but is always promoted by Command, never by Atlas.

Promotion means:
1. Command has reviewed an Atlas submission in `PENDING_ATLAS.md`
2. Command has issued an ACCEPTED ruling in `COMMAND_DECISION.md` and appended it to `DECISION_LOG.md`
3. Command writes the accepted architecture content into `ATLAS_LATEST.md` (overwrite)
4. The architecture is now operative state

Before promotion: the architecture is a proposal (proposal state). After Command writes to `ATLAS_LATEST.md`: the architecture is operative state. The act of Command writing to `ATLAS_LATEST.md` is the promotion. No other action constitutes promotion.

Atlas cannot make its own proposal operative. `PENDING_ATLAS.md` is the proposal surface; `ATLAS_LATEST.md` is the operative surface. These are separated by Command authority. This separation is the mechanism by which Command controls what architecture governs the system.

---

## §8. Slice Lifecycle

Each slice passes through five phases. Only Command advances a slice from one phase to the next.

### §8.1 Activation

Command opens a slice:
- Sets `ACTIVE_SLICE.md` to the new slice identifier and status
- Sets `SLICE_STATUS.md` to DEFINED (if architecture does not yet exist) or APPROVED (if architecture is pre-accepted)
- Updates `NEXT_ACTION.md` with the first authorized action
- Updates `AGENT_QUEUE.md` with the authorized agent and assignment
- Updates `CURRENT_FOCUS.md` with the active slice context

If Atlas architecture does not yet exist, SLICE_STATUS.md is set to DEFINED and Command authorizes Atlas to produce an architecture proposal. Once Atlas submits and Command accepts, SLICE_STATUS.md advances to APPROVED and Forge is authorized to implement.

### §8.2 Implementation

Forge implements the approved architecture:
- Reads `ACTIVE_SLICE.md`, `CURRENT_FOCUS.md`, and the approved architecture in `ATLAS_LATEST.md`
- Implements within the authorized scope only
- Delivers via `PENDING_FORGE.md`
- Command sets `SLICE_STATUS.md` to IMPLEMENTED after delivery

### §8.3 Review

Sentinel and Compass review the Forge deliverable:
- Sentinel performs security and trust review; delivers via `PENDING_SENTINEL.md`
- Compass performs completeness and consistency validation; delivers via `PENDING_COMPASS.md`
- Command reads both review outputs
- Command sets `SLICE_STATUS.md` to VALIDATED when both reviews are satisfactory

### §8.4 Validation

Command reviews the full slice package (architecture, implementation, Sentinel review, Compass validation):
- Issues ruling via `COMMAND_DECISION.md`
- Appends to `DECISION_LOG.md`
- If ACCEPTED: advances to Closure
- If any gate fails: Command issues revised directive; `SLICE_STATUS.md` set to REJECTED or BLOCKED

### §8.5 Closure

Command closes the slice:
- Appends slice ACCEPTED entry to `SLICE_LEDGER.md` (append-only)
- Appends milestone to `SYSTEM_STATE.md` (append-only within milestone history sections)
- Sets `ACTIVE_SLICE.md` to NONE
- Sets `SLICE_STATUS.md` to ACCEPTED
- Updates `NEXT_ACTION.md`
- Authorizes post-closure archive writes: Atlas writes its `archive/ARCH_*.md` artifact; Sentinel and Compass each write their own `archive/REVIEW_*.md` artifact

Only Command may close a slice. No agent may declare its own slice closed. Sentinel PASS and Compass PASS are necessary inputs to Command's closure decision; they are not themselves closure.

---

## §9. File Roles

### §9.1 ACTIVE_SLICE.md

Identifies the single slice currently authorized for implementation. Command overwrites this file when activating a new slice or closing the current one. When active slice is NONE, no implementation, architecture, or review work is authorized without an explicit Command directive.

Agents must read `ACTIVE_SLICE.md` before acting to confirm they are working on the slice they believe is active.

### §9.2 SLICE_STATUS.md

Tracks the lifecycle status of the active slice. Status vocabulary is a closed set:

| Status | Meaning |
|--------|---------|
| `DEFINED` | Architecture pack exists; awaiting Command approval |
| `APPROVED` | Command has approved architecture; Forge authorized to implement |
| `IMPLEMENTED` | Forge has delivered; awaiting review |
| `VALIDATED` | Review complete; awaiting Command acceptance |
| `ACCEPTED` | Slice fully closed by Command |
| `ACCEPTED_WITH_NOTE` | Slice closed with recorded caveat in DECISION_LOG.md |
| `REJECTED` | Command rejected at a gate; slice returns to DEFINED with revised directive in NEXT_ACTION.md |
| `BLOCKED` | Slice cannot progress; blocking condition documented in OPEN_ISSUES.md |

Command is the sole writer. No agent modifies `SLICE_STATUS.md`.

### §9.3 NEXT_ACTION.md

States the single next action any agent is authorized to take. Command overwrites this file each time a new directive is issued. Agents must read `NEXT_ACTION.md` before acting. If `NEXT_ACTION.md` says "NONE — await Command directive," no agent proceeds.

### §9.4 OPEN_ISSUES.md

Tracks open blockers, named notes, and unresolved flags. Contains two sections:

1. **Stale-Content Invalidation Procedure** — executable checklist agents run at session start before reading any CLASS_A_LIVE file as authoritative (see §10 for rules)
2. **Open Issues** — named, tracked blocking conditions with raise date, scope, and constraint

Command integrates new issues into `OPEN_ISSUES.md`. Agents propose issue additions via their own PENDING_* file; Command integrates after ruling. Agents do not write to `OPEN_ISSUES.md` directly.

### §9.5 AGENT_QUEUE.md

Records which agent is assigned to what, in what order. Command maintains this file. Agents read it to understand their current authorization and queue position. Assignment detail lives in the corresponding PENDING_* file.

### §9.6 ATLAS_LATEST.md

Holds the current Command-approved operative architecture. Content originates from Atlas proposals in `PENDING_ATLAS.md`; Command promotes accepted proposals here after issuing an ACCEPTED ruling. Atlas does not write this file.

`ATLAS_LATEST.md` is the operative architecture surface — agents implement against it. `PENDING_ATLAS.md` is the proposal surface — Command reviews it. These two files serve distinct purposes and must not be confused.

### §9.7 COMMAND_DECISION.md

Holds the most recent Command ruling. Overwritten per decision cycle. Agents read this file to learn whether their submission was ACCEPTED or REJECTED. If an agent's submission has no corresponding entry in this file, the submission is in PENDING state — the agent does not proceed until a ruling appears.

`COMMAND_DECISION.md` is the live signal. `DECISION_LOG.md` is the permanent record. Both are updated together per ruling.

### §9.8 DECISION_LOG.md

The append-only, timestamped record of every Command ruling. Entry format:

```
[ISO-8601] | [agent] | [slice ref] | [submission type] | [ACCEPTED|REJECTED] | [reason]
```

No entry is ever modified or deleted. Corrections are made by subsequent entries with explicit correction notations. This file is the authoritative history of all governance decisions.

### §9.9 PENDING_* Files

Per-agent CLASS_A_PENDING proposal surfaces. Each agent owns exactly one PENDING_* file:

| Agent | File |
|-------|------|
| Atlas | `PENDING_ATLAS.md` |
| Forge | `PENDING_FORGE.md` |
| Sentinel | `PENDING_SENTINEL.md` |
| Compass | `PENDING_COMPASS.md` |

Rules:
- Each agent overwrites its own PENDING_* file when delivering a submission
- No agent writes to another agent's PENDING_* file
- PENDING_* files are not logs — they are overwritten per submission cycle
- Content in a PENDING_* file is a proposal; it is not operative
- The history of submissions is preserved in DECISION_LOG.md, not in the PENDING_* file itself

---

## §10. Stale-Content Rules

A stale CLASS_A file is not a warning. It is a blocking condition. No agent proceeds on stale content.

**When content is stale:**

1. **CURRENT_FOCUS.md** is stale if it references a slice that SLICE_LEDGER.md records as ACCEPTED or ACCEPTED_WITH_NOTE and CURRENT_FOCUS.md has not been updated since that close date.

2. **ACTIVE_SLICE.md** is stale if the slice ID it contains does not match the slice ID recorded in SLICE_STATUS.md.

3. **SLICE_STATUS.md** is stale if it does not reflect the outcome recorded in SLICE_LEDGER.md for the current slice.

4. **NEXT_ACTION.md** is stale if it references an action that has already been completed and no new directive has superseded it.

5. **COMMAND_DECISION.md** is stale if a new PENDING_* file has been written since the referenced decision without a corresponding new DECISION_LOG.md entry.

6. **ATLAS_LATEST.md** is stale if DECISION_LOG.md shows a more recently accepted Atlas submission than the architecture currently in ATLAS_LATEST.md.

7. **Any stale CLASS_A file = blocking condition.** Stop. Surface the stale condition to Command. Do not proceed until Command updates the stale file.

8. **CLASS_B files do not go stale.** For SYSTEM_STATE.md, read the milestone history sections (append-only, authoritative) rather than the summary sections (potentially pending a Command update).

**Session start procedure:** Agents execute the stale-content checks (detailed executable procedure in OPEN_ISSUES.md) before reading any CLASS_A file as authoritative for the session.

---

## §11. Bootstrap Exceptions

The bootstrap exceptions bounded the initial establishment of the control-plane file surface under CTRL-S1. This document formalizes the steady-state governance model that follows the control-plane establishment completed under CTRL-S1.

The bootstrap exceptions are documented here for completeness.

**Bootstrap exception 1:** During initial control-plane establishment (CTRL-S1), Command authorized Forge to create control-plane files that would normally be Command-only writes. This was a structural necessity — the promotion flow cannot be used to establish the files that constitute the promotion flow.

**Bootstrap exception 2:** ATLAS_LATEST.md was initialized by Forge during CTRL-S1 bootstrap — a one-time structural exception recorded in DECISION_LOG.md (DL-002). All subsequent writes to ATLAS_LATEST.md are Command-only per the write rules in §5.

**Bootstrap exception 3:** During bootstrap, files were created by agents without a prior PENDING_* → COMMAND_DECISION.md flow, because those files did not yet exist to support that flow.

**Bootstrap scope:** These exceptions were bounded to CTRL-S1 and do not recur. This document records the steady-state governance model intended to govern control-plane operations after Command acceptance of CTRL-S2.

---

## §12. Steady-State Rules

In steady state, the following rules govern all control-plane operations:

1. **One active slice at a time.** Command activates a new slice only after the previous slice is closed. Agents do not begin work on a slice that is not active.

2. **No agent self-authorizes.** No agent promotes its own output to authoritative state. Every agent output requires a Command ACCEPTED ruling before it is operative.

3. **All agent submissions flow through PENDING_*.** Agents deliver work by writing to their own CLASS_A_PENDING file and notifying Command. No other delivery mechanism is valid.

4. **All Command rulings flow through COMMAND_DECISION.md and DECISION_LOG.md.** A ruling that is not recorded in DECISION_LOG.md is not a ruling; the submission remains in proposal state.

5. **CLASS_A_LIVE operational files are Command-only writes.** No agent writes to CURRENT_FOCUS.md, ACTIVE_SLICE.md, SLICE_STATUS.md, NEXT_ACTION.md, OPEN_ISSUES.md, AGENT_QUEUE.md, or ATLAS_LATEST.md.

6. **CLASS_B_APPEND files grow forward only.** DECISION_LOG.md, SLICE_LEDGER.md, and archive/INDEX.md are never modified — only appended. CLASS_B_ARCHIVE files are immutable after initial write.

7. **Stale-content checks at session start.** Every agent executes the stale-content invalidation procedure from OPEN_ISSUES.md before acting on any CLASS_A file. A stale file stops the session until Command resolves it.

8. **No cross-agent PENDING_* writes.** An agent writing to another agent's PENDING_* file violates the ownership model unconditionally.

9. **No undocumented implementation.** Forge implements only against an active, Command-approved slice with accepted architecture in ATLAS_LATEST.md.

10. **Closure authority is Command-only.** Sentinel PASS and Compass PASS are inputs to Command's closure decision. They do not constitute closure. Only Command may close a slice.

---

## §13. Command Identity Model

### §13.1 Overview

Command operates through a single unified identity file. There is no surface separation, no split identity, and no alternative path to authoritative state.

### §13.2 Command Identity File

| File | Location | Role |
|------|----------|------|
| `COMMAND_ID.md` | `.claude/docs/agents/` | Complete Command specification — governance, orchestration, judgment, persona, communication, process, and output |

This single file is authoritative for all Command operating behavior, persona, and governance contracts.

### §13.3 Command Authority

Command holds exclusive write authority over all Command-owned control-plane files. All governing decisions, slice activations, agent rulings, and authoritative state changes originate from Command as defined in `COMMAND_ID.md`.

### §13.4 Preservation of Existing Contracts

The Command identity model does not alter:
- File ownership assignments (§4)
- Write rules for any file class (§5)
- Authority boundaries for Atlas, Forge, Sentinel, or Compass (§6)
- The promotion flow (§7)
- The slice lifecycle (§8)
- Stale-content rules (§10)
- Steady-state rules (§12)

The single-file Command identity structure is a simplification. No prior contract from CTRL-S1, CTRL-S2, CTRL-S4, or CTRL-S5 is modified beyond the surface model collapse.

---

*This document is authoritative for the control-plane operating model as established by CTRL-S2, amended by CTRL-S5, amended by CTRL-S6, amended by AS-2, amended by B-2, and amended by X3-0A (Express Lane Governance). CTRL-S1 accepted file ownership and write rules are preserved with no contract drift. CTRL-S6 revised §13 (Command Identity Model — single-surface reunification); AS-2 added §14 (A-Series Command Infrastructure); B-2 added §15 (Session Boundary Protocol); X3-0A added §16 (Express Lane Governance); no prior contracts beyond the surface model were altered.*

---

## §16. Express Lane Governance

**Established by:** X3-0A
**Authority:** Command

### §16.1 Overview

The Express Lane is a governed alternative pipeline for Administrative-class slices that do not touch trust surfaces and do not require new architecture. It compresses the standard four-agent pipeline (Atlas → Forge → Sentinel → Compass) into a single-agent path (Forge only) with Command review.

Express Lane is registered as a governed operating mode. It does not replace the standard pipeline — it provides a lighter path for qualifying work while preserving the audit trail.

### §16.2 Command File

| File | Location | Purpose |
|------|----------|---------|
| `express.md` | `.claude/commands/govern/` | Express Lane governance protocol slash command |

Write authority: Created under Command authorization. Post-creation amendments require a Command directive and are implemented by Forge as a governed slice.

### §16.3 Express Lane Pipeline

```
Command → Forge → Command review → Close
```

Skipped stages: Atlas architecture, Sentinel security review, Compass validation. Command validates directly at review.

### §16.4 Eligibility

Express Lane is available only when ALL conditions are met:
1. Governance class is Administrative
2. No trust surfaces are involved (directly or indirectly)
3. No new architecture is required
4. Scope is bounded to a single Forge dispatch

**Hard gate:** Express Lane is prohibited when `trust_surfaces_involved === true`. This is non-negotiable.

### §16.5 File Ownership and Write Rules

All file ownership rules from §4 and write rules from §5 continue to apply without modification. Express Lane does not alter any file class, ownership assignment, or write rule.

Specifically:
- Command remains the sole writer of all CLASS_A_LIVE files
- DECISION_LOG.md and SLICE_LEDGER.md remain append-only
- Forge writes only to PENDING_FORGE.md
- Chain context documents remain Command-owned

### §16.6 Required Audit Trail

Express Lane slices MUST produce:
- Chain context document (Express variant template)
- DECISION_LOG.md entries (activation, Forge approval, closure)
- SLICE_LEDGER.md closure record (with Express Lane notation)
- audit-log.jsonl entry
- COMMAND_DECISION.md closure ruling

### §16.7 Entries Not Created

Express Lane slices do NOT create:
- PENDING_ATLAS.md submission (no Atlas stage)
- PENDING_SENTINEL.md submission (no Sentinel review)
- PENDING_COMPASS.md submission (no Compass validation)
- ATLAS_LATEST.md update (no architecture change)

### §16.8 Elevation

Command may elevate an Express Lane slice to the full pipeline at any point during execution if trust surfaces are discovered, complexity exceeds Administrative class, or scope expands. Elevation is governed by COMMAND_ID.md §41.4. The slice continues through the full pipeline from the point of elevation.

---

## §14. A-Series Command Infrastructure

**Established by:** AS-1 (Atlas architecture) / AS-2 (Forge implementation)
**Authority:** Command

### §14.1 Overview

The A-Series Automation Layer introduces two new file surfaces not covered by the original §2 file inventory: the `.claude/commands/` directory (command infrastructure) and the `.claude/docs/chains/` directory (Chain Context Documents). This section registers these surfaces in the governance model.

### §14.2 `.claude/commands/` — Command Infrastructure Files

Command infrastructure files are markdown prompt templates invoked as slash commands in Claude Code. They are not governed state files in the CLASS_A/CLASS_B sense — they do not hold authoritative system state. They are operational dispatch mechanisms.

| Directory | Files | Purpose |
|-----------|-------|---------|
| `.claude/commands/dispatch/` | `atlas.md`, `forge.md`, `sentinel.md`, `compass.md` | Agent dispatch commands |
| `.claude/commands/review/` | `submission.md` | Command review protocol command |
| `.claude/commands/govern/` | `activate-slice.md`, `close-slice.md`, `plan.md`, `express.md`, `init-project.md` | Slice governance commands |

**Write authority:** Forge creates these files in AS-2 under Command authorization. Post-creation, amendments require a Command directive and are implemented by Forge as a governed slice. No agent modifies command files without Command authorization.

**Read authority:** Any agent may read command files. Agents do not treat command files as authoritative state — they are operational templates, not governance records.

### §14.3 `.claude/docs/chains/` — Chain Context Documents

Chain Context Documents are the running audit trail for each slice's chain execution. They are Command-owned CLASS_A_LIVE_CHAIN files.

| Path | Class | Owner | Write Rule |
|------|-------|-------|------------|
| `.claude/docs/chains/TEMPLATE.md` | COMMAND_INFRASTRUCTURE | Forge (creation, AS-2) | Read-only post-creation; Command authorizes amendments |
| `.claude/docs/chains/[SLICE-ID].md` | CLASS_A_LIVE_CHAIN | Command | Overwrite (Command updates at each chain stage) |
| `.claude/docs/chains/archive/[SLICE-ID].md` | CLASS_B_ARCHIVE | Command (moves at closure); agents (populate Final State section per post-closure authorization) | Write-once after Command archives |

**Stale-content rules for Chain Context Documents:** Chain Context Documents do not go stale in the CLASS_A sense — they are the audit trail, not a live signal file. Agents read them for context; they are not authoritative for governed decisions. ATLAS_LATEST.md and COMMAND_DECISION.md remain the authoritative sources for architecture and ruling state.

**Ownership clarification:** The archive/ARCH_*.md and archive/REVIEW_*.md artifacts referenced in §2 are written by Atlas, Sentinel, and Compass respectively post-closure. The Chain Context Document archive files (`.claude/docs/chains/archive/`) are a separate surface — Command moves the chain document; agents then populate the Final State section under post-closure authorization. These are distinct from the `.claude/docs/ops/archive/` surface.

### §14.4 Escalation Trigger Definitions

The following conditions constitute escalation triggers (closed set). Any one of these triggers requires Command to pause the chain and surface to the principal:

1. **Correction limit exceeded** — an agent has been rejected at the same stage twice (2 corrections) and a third correction would be required
2. **Agent declares BLOCKED** — an agent cannot proceed without a Command ruling and has written STATUS: BLOCKED to its PENDING_*.md
3. **Agent submits ESCALATING** — an agent has identified a condition (trust violation, architectural conflict, unresolvable gap) requiring principal awareness and has written STATUS: ESCALATING
4. **Structural governance violation detected** — Command identifies a violation of a core governance contract during chain execution (e.g., unauthorized write to a CLASS_A file, stale-content check failure that cannot be resolved, out-of-scope change that was not authorized)

### §14.5 Principal-in-Loop Boundary

Command governs chain execution autonomously. The principal is engaged only:

- At the planning stage (when the principal initiates a slice or series)
- When an escalation trigger fires (§14.4 above)

Between these points, Command dispatches agents, reviews submissions, issues corrections, and closes slices without surfacing to the principal. This is the intended operating model. The principal's attention is protected; routine chain governance is Command's responsibility.

---

## §15. Session Boundary Protocol

**Established by:** B-1 (Atlas architecture) / B-2 (Forge implementation)
**Authority:** Command

### §15.1 Overview

This section was established under B-1 (Atlas architecture) and B-2 (Forge implementation) by Command authority. It formalizes the session boundary invariant that governs all agent dispatches, registers the Continuation Context block and Segment-Complete submission type as governed constructs within the control-plane model, and assigns task segmentation authority exclusively to Command.

### §15.2 Session Boundary Invariant

Every agent dispatch is a fresh session. No agent may rely on information from a prior session unless that information is conveyed through one of exactly two valid mechanisms:

(a) **Governed files read during boot** — information present in control-plane files that the agent reads as part of its authorized boot sequence.

(b) **Command-authored Continuation Context block** — a structured block explicitly authored by Command and embedded in the dispatch (`$ARGUMENTS`) for multi-segment tasks.

There is no other valid context channel. Compliance with this invariant is operational.

### §15.3 Continuation Context Block

The Continuation Context block is a Command-governed construct with the following properties:

- **Command-authored only** — only Command authors a Continuation Context block; no agent self-populates or modifies it
- **Embedded in `$ARGUMENTS`** — the block appears in the task framing passed at dispatch; it is not a separate file or dispatch field
- **Structured per COMMAND_ID.md §39.2** — the exact eight-field format and field population rules are defined there
- **Present for all segments of a multi-segment task** — including segment 1, where prior-state fields (COMPLETED UNITS, KEY DECISIONS MADE, PENDING STATE) are populated with "None — first segment"
- **Not self-populated** — no agent writes, modifies, or supplements a Continuation Context block

**CHAIN CONTEXT vs. CONTINUATION CONTEXT:** These are distinct constructs serving distinct purposes.
- **CHAIN CONTEXT** — inter-agent context; carries key decisions from prior chain stages (e.g., Atlas's architectural decisions carried forward to Forge). Governed by COMMAND_ID.md §38.
- **CONTINUATION CONTEXT** — intra-assignment context; carries state from prior segments of the same agent's work assignment (e.g., Forge segment 1 state carried forward to Forge segment 2). Governed by COMMAND_ID.md §39.2.

Both may appear in the same dispatch. They are not substitutes for each other.

### §15.4 Segment-Complete Submission Type

SEGMENT-COMPLETE is a valid submission type alongside COMPLETE, BLOCKED, and ESCALATING. The format is defined in COMMAND_ID.md §39.4.

**Governance flow for segmented tasks:**

1. Command dispatches Segment N with Continuation Context block embedded in `$ARGUMENTS`
2. Agent completes Segment N work and writes a Segment-Complete report to its PENDING_*.md file
3. Command reviews the Segment-Complete report; appends a `chain-segment-complete` entry to DECISION_LOG.md
4. Command constructs the Continuation Context block for Segment N+1 using the field mapping in COMMAND_ID.md §39.4
5. Command dispatches Segment N+1 with the fully populated Continuation Context
6. Repeat until the final segment (N = M) delivers a standard COMPLETE submission

### §15.5 SLICE_STATUS During Segmented Implementation

SLICE_STATUS remains APPROVED throughout all segments of a segmented implementation. No new SLICE_STATUS values are introduced by this protocol.

SLICE_STATUS advances to IMPLEMENTED only after Command accepts the final-segment COMPLETE submission from Forge. A Segment-Complete report from a non-final segment does not advance SLICE_STATUS.

### §15.6 Task Segmentation Authority

Task segmentation is Command's responsibility and authority. Command determines at dispatch time whether a task must be segmented. No agent initiates, proposes, or decides segmentation — Command makes this determination before dispatching.

Segmentation criteria and the segmentation procedure are defined in COMMAND_ID.md §39.3.
