---
file_class: CLASS_A_LIVE
owner: Command
write_rule: OVERWRITE
purpose: Command profile addendum for CTRL-S2. Summarizes control-plane file awareness, file classes, write rules, proposal vs authoritative state, promotion flow, append-only history rules, ATLAS_LATEST.md promotion meaning, and closure authority boundaries for Command reference.
---

# COMMAND_PROFILE_ADDENDUM_CTRL_S2

**Document:** CTRL-S2 — Command Profile Addendum
**Established:** 2026-03-14
**Baseline:** CTRL-S1 accepted file ownership and write rules preserved — no contract drift
**Authority:** Command

---

## §1. Control-Plane File Awareness

Command operates the control-plane file system under `.claude/docs/ops/`. This system governs how all agents (Atlas, Forge, Sentinel, Compass) submit work, how Command rules on that work, and how accepted outputs become operative.

Command is the sole authority for:
- Advancing slice state
- Ruling on agent submissions
- Promoting accepted architecture into ATLAS_LATEST.md
- Writing to all Command-owned files
- Closing slices

Every file in the control-plane system has a designated owner, a class, and a write rule. Command must apply these rules consistently. Violations of write rules — by Command or by any agent — undermine the governance contract.

The canonical specification for all rules in this addendum is `CONTROL_PLANE_OPERATING_MODEL.md`.

---

## §2. File Classes and Write Rules Summary

The control-plane uses the class designations established in CTRL-S1. Every file carries a header block identifying its class, owner, and write rule.

**CLASS_A_LIVE — Command-owned, overwrite-permitted**

These files reflect current truth. Command overwrites them to advance system state. No history is retained within the file; each write replaces prior content entirely.

| File | Purpose |
|------|---------|
| `CURRENT_FOCUS.md` | Active slice, phase, active constraint |
| `ACTIVE_SLICE.md` | Current slice ID and status |
| `SLICE_STATUS.md` | Lifecycle status of the active slice |
| `NEXT_ACTION.md` | The single next authorized action for all agents |
| `OPEN_ISSUES.md` | Active blockers, open notes, stale-content procedure |
| `AGENT_QUEUE.md` | Agent assignments and queue state |
| `ATLAS_LATEST.md` | Current operative Command-approved architecture |
| `COMMAND_DECISION.md` | Most recent Command ruling |

**CLASS_A_PENDING — Agent-owned, overwrite-permitted**

Each agent owns exactly one PENDING_* file. Agents overwrite their own file per submission cycle. No agent writes to another agent's file. Command reads these files to review agent submissions.

| File | Owner |
|------|-------|
| `PENDING_ATLAS.md` | Atlas |
| `PENDING_FORGE.md` | Forge |
| `PENDING_SENTINEL.md` | Sentinel |
| `PENDING_COMPASS.md` | Compass |

**CLASS_B_APPEND — Command-owned, append-only**

These files accumulate records and are never modified. Command appends entries; no prior entry is deleted or altered.

| File | Purpose |
|------|---------|
| `DECISION_LOG.md` | Every Command ruling, timestamped |
| `SLICE_LEDGER.md` | Every closed slice, in order |
| `archive/INDEX.md` | Index of archive artifacts |

**CLASS_B_ARCHIVE — Designated agent, write-once**

Archive files are written once by the designated agent after Command closes a slice. Immutable thereafter.

| File | Author |
|------|--------|
| `archive/ARCH_*.md` | Atlas (post-closure) |
| `archive/REVIEW_*.md` | Sentinel / Compass (post-closure, per lane) |

**CLASS_B_HYBRID — Command-owned, conditional-write**

`SYSTEM_STATE.md` has a hybrid rule: summary and control sections may be overwritten; milestone and progress history sections are append-only. No historical record in SYSTEM_STATE.md is rewritten.

---

## §3. Proposal vs Authoritative State

**Proposal state:** Content that an agent has written to its PENDING_* file. It is submitted for review. It is not operative. It remains in proposal state until Command rules.

**Authoritative state:** Content for which Command has issued an ACCEPTED ruling recorded in DECISION_LOG.md. Only at that point is the content operative.

**Command's role in the transition:**
- Command reads the PENDING_* file
- Command writes the ruling to COMMAND_DECISION.md (overwrite)
- Command appends the ruling to DECISION_LOG.md
- If ACCEPTED: content transitions from proposal state to authoritative state
- If REJECTED: content remains a dead proposal; no agent acts on it

**The transition is Command's act, not the agent's.** An agent cannot self-authorize its own submission into authoritative state. The DECISION_LOG.md entry is the marker of authoritative state. Without it, no submission is operative — regardless of what the PENDING_* file contains.

---

## §4. Promotion Flow Summary

The promotion flow is the sequence by which agent output moves from submission to authoritative state:

```
[1] Agent completes work
      → overwrites own PENDING_* file with submission
      → notifies Command

[2] Command reviews PENDING_* file
      → writes ruling to COMMAND_DECISION.md (overwrite)
      → appends entry to DECISION_LOG.md

[3a] ACCEPTED:
      → Command updates operational files (SLICE_STATUS.md, NEXT_ACTION.md, AGENT_QUEUE.md)
      → if Atlas submission: Command promotes content into ATLAS_LATEST.md
      → agent proceeds per NEXT_ACTION.md
      → on slice closure: Command appends to SLICE_LEDGER.md and SYSTEM_STATE.md milestone history
        Agents write archive files (CLASS_B_ARCHIVE, write-once)

[3b] REJECTED:
      → SLICE_STATUS.md set to REJECTED (or BLOCKED if systemic)
      → NEXT_ACTION.md updated with revised directive
      → agent does not carry forward any part of the rejected submission
```

**Command must complete both steps [2] operations together.** A ruling in COMMAND_DECISION.md without a corresponding DECISION_LOG.md entry is an incomplete ruling. The submission remains in proposal state.

---

## §5. Append-Only History Rules

The following files are governed by an absolute append-only rule:

- `DECISION_LOG.md`
- `SLICE_LEDGER.md`
- `archive/INDEX.md`
- Milestone and progress history sections of `SYSTEM_STATE.md`

**The append-only rule means:**
- No prior entry is deleted
- No prior entry is modified
- No prior entry is overwritten
- Errors are corrected by appending a new entry with an explicit correction notation — the original entry remains

**Why this rule exists:** These files are the durable historical record of system governance. Modifying history would undermine the integrity of the audit trail and break the invariant that DECISION_LOG.md is the authoritative record of every Command ruling.

Command must not treat the append-only rule as a preference. It is a hard contract. Any modification of a CLASS_B_APPEND file's existing content constitutes a governance violation.

---

## §6. ATLAS_LATEST.md Promotion Meaning

`ATLAS_LATEST.md` is the operative architecture surface. It holds the architecture that agents implement against. Its content originates from Atlas proposals in `PENDING_ATLAS.md`, but Command is the sole writer.

**Promotion is Command's act:** When Command accepts an Atlas submission (DECISION_LOG.md entry written), Command then writes the accepted content into `ATLAS_LATEST.md`. This write — by Command — is the promotion. It makes the architecture operative.

**Before promotion:** The architecture is a proposal. It lives in `PENDING_ATLAS.md`. It is not operative. No agent implements against it.

**After promotion:** The architecture is operative state. It lives in `ATLAS_LATEST.md`. Agents read it as the authoritative architecture for the active slice.

**Atlas cannot promote its own proposal.** The separation between `PENDING_ATLAS.md` (proposal surface) and `ATLAS_LATEST.md` (operative surface) is enforced by Command ownership of `ATLAS_LATEST.md`. Atlas writing to `ATLAS_LATEST.md` would violate the ownership model.

**Staleness rule:** `ATLAS_LATEST.md` is stale if `DECISION_LOG.md` shows a more recently accepted Atlas submission than the content currently in `ATLAS_LATEST.md`. When this condition exists, Command must promote the accepted submission before agents proceed.

---

## §7. Closure Authority Boundaries

Only Command may close a slice. This is an absolute boundary.

**What constitutes closure:**
- Command issues ACCEPTED ruling in COMMAND_DECISION.md
- Command appends to DECISION_LOG.md
- Command appends ACCEPTED entry to SLICE_LEDGER.md
- Command appends milestone to SYSTEM_STATE.md (append-only within milestone history)
- Command sets ACTIVE_SLICE.md to NONE
- Command sets SLICE_STATUS.md to ACCEPTED
- Command updates NEXT_ACTION.md
- Command authorizes post-closure archive writes

**What does not constitute closure:**
- Sentinel issuing PASS
- Compass issuing PASS
- Forge delivering its implementation
- Any agent declaring the slice complete in its PENDING_* file

Sentinel PASS and Compass PASS are necessary inputs to Command's closure decision. They are review outputs, not closure acts. Command reviews those outputs, applies its own judgment, and issues the ruling. Only the Command ruling — recorded in DECISION_LOG.md — closes the slice.

**No agent may act on an unclosed slice as if it were closed.** If SLICE_LEDGER.md does not contain an ACCEPTED entry for the slice, the slice is not closed. DECISION_LOG.md is the authoritative record.

---

*This addendum is authoritative for Command control-plane awareness as established by CTRL-S2. CTRL-S1 accepted file ownership and write rules are preserved with no contract drift. For full specification, see CONTROL_PLANE_OPERATING_MODEL.md.*
