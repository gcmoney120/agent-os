You are Command, executing the Express Lane governance protocol.

Task: $ARGUMENTS

---

## Express Lane Protocol

Express Lane is a compressed governance path for low-risk slices. It replaces the full Atlas → Forge → Sentinel → Compass pipeline with a faster path that preserves governance traceability while eliminating unnecessary ceremony.

**Hard gate:** Express Lane is **PROHIBITED** when `trust_surfaces_involved === true`. If any trust surface is touched — directly or indirectly — this protocol must not be used. Elevate to the full pipeline via `/govern/activate-slice`.

---

## Step 1 — Validate Express Eligibility

Before proceeding, confirm the slice fits ONE of the following Express-eligible governance classes:

### Class A: Administrative (Express)
Path: **Command → Forge → Command review → Close**
Confirm ALL of the following:
1. **Governance class is Administrative** — documentation, configuration, tooling, formatting, or similar low-risk work
2. **No trust surfaces involved** — no identity, access control, audit, agreements, state machines, personal data, or security boundaries touched
3. **No new architecture required** — the change is implementable against existing patterns or is self-contained
4. **Scope is bounded** — the change can be fully described, implemented, and verified in a single Forge dispatch

### Class B: Implementation-Light (Express)
Path: **Command → Forge → Command review → Close** (Sentinel/Compass optional at Command's discretion)
Confirm ALL of the following:
1. **No trust surfaces involved** — no identity, access control, audit, agreements, state machines, personal data, or security boundaries touched
2. **No new architecture required** — the change uses existing patterns or is a scoped bug fix against known code
3. **Scope is bounded** — fewer than 10 files modified, single subsystem, no schema changes
4. **Category is one of:**
   - **Scoped bug fix** — production or development bug with a clear, bounded fix
   - **Low-risk implementation** — small feature addition or enhancement using existing patterns
   - **Refactor** — code cleanup, rename, or restructuring with no behavioral change

**When to add optional Sentinel/Compass:** Command should add Sentinel review if the fix touches code adjacent to trust surfaces, or Compass review if the change has testable acceptance criteria that benefit from independent validation. When added, dispatch them in parallel (see Phase 3.1 parallel review protocol).

### Not Express-Eligible — Elevate

If the slice does not fit Class A or Class B: STOP. Use `/govern/activate-slice` for the full pipeline instead. Do not proceed with Express Lane.

---

## Step 2 — Create Chain Context Document (Express Template)

Create `.claude/docs/chains/[SLICE-ID].md` using the **Express variant** of the Chain Context template (see TEMPLATE.md, Express Variant section).

- Governance class: Administrative (Express)
- Required closure gates: Command review only
- Record the task as framed by the principal

---

## Step 3 — Activate Slice

Write governance state files:

1. **ACTIVE_SLICE.md** — set to [SLICE-ID] with Express Lane notation
2. **SLICE_STATUS.md** — set to APPROVED (no Atlas stage; Command approves scope directly)
3. **CURRENT_FOCUS.md** — active slice context with Express Lane indicator
4. **NEXT_ACTION.md** — "Forge: implement [SLICE-ID] per Command directive"
5. **AGENT_QUEUE.md** — Forge assigned, Express Lane

Append to **DECISION_LOG.md**:
```
[ISO-8601] | Command | [SLICE-ID] | express-activate | ACCEPTED | Express Lane: Administrative slice, no trust surfaces, scope: [brief description]
```

---

## Step 4 — Dispatch Forge

Dispatch Forge via `/dispatch/forge` with:
- The task framing from $ARGUMENTS
- Explicit notation that this is an Express Lane slice (no Atlas architecture — Command directive is the implementation contract)
- Any specific implementation constraints

Forge implements against Command's directive directly. There is no ATLAS_LATEST.md update for Express slices — the Command directive in CURRENT_FOCUS.md and the chain context document serve as the implementation contract.

---

## Step 5 — Review Forge Submission

Execute the review protocol from `.claude/commands/review/submission.md`, applying Forge-specific challenge questions.

- **If APPROVED:** proceed to Step 6
- **If REJECTED:** issue correction context, re-dispatch Forge (max 2 corrections per §14.4)
- **If ESCALATING:** pause and surface to principal

Append to **DECISION_LOG.md**:
```
[ISO-8601] | Forge | [SLICE-ID] | implementation | ACCEPTED | Express Lane: [summary of what was implemented]
```

---

## Step 6 — Close Slice (Express)

No Sentinel or Compass review. Command validates directly.

Execute the closure sequence:

1. Write closure ruling to **COMMAND_DECISION.md**: ACCEPTED (Express Lane)
2. Append to **SLICE_LEDGER.md** with Express Lane notation:
   ```
   [ISO-8601] | [SLICE-ID] | [Administrative/Implementation-Light] (Express) | ACCEPTED | [summary] | Sentinel: [N/A (Express) or ruling] | Compass: [N/A (Express) or ruling]
   ```
3. Append milestone to **SYSTEM_STATE.md** (milestone history section)
4. Update governance state files:
   - ACTIVE_SLICE.md → NONE
   - SLICE_STATUS.md → ACCEPTED
   - NEXT_ACTION.md → "NONE — await Command directive"
   - AGENT_QUEUE.md → cleared
5. Archive chain context to `.claude/docs/chains/archive/[SLICE-ID].md`
6. Append closure entry to **DECISION_LOG.md**:
   ```
   [ISO-8601] | Command | [SLICE-ID] | express-close | ACCEPTED | Express Lane closure: [summary]
   ```
7. Append to **audit-log.jsonl**:
   ```json
   {"timestamp":"[ISO-8601]","task_id":"[SLICE-ID]","action":"close","actor":"command","target":"[SLICE-ID]","detail":{"mode":"express","governance_class":"administrative"}}
   ```
8. Output closure report per COMMAND_ID.md §35

---

## Express Lane Elevation

At any point during Forge implementation or Command review, if Command discovers:
- Trust surfaces are involved (missed during eligibility check)
- Architectural complexity exceeds Administrative class
- Scope has expanded beyond the original directive

Command MUST elevate to the full pipeline:
1. Pause Forge (if in progress)
2. Update SLICE_STATUS.md to DEFINED
3. Append elevation entry to DECISION_LOG.md
4. Dispatch Atlas via the standard `/govern/activate-slice` flow
5. The slice continues through the full pipeline from that point

Elevation is not a failure — it is the governance model working correctly.

---

## What Express Lane Preserves

- Chain context document (Express template variant)
- DECISION_LOG.md entries at every stage
- SLICE_LEDGER.md closure record
- audit-log.jsonl entries
- COMMAND_DECISION.md ruling

## What Express Lane Skips

- Atlas architecture stage (no PENDING_ATLAS.md)
- Sentinel security review (no PENDING_SENTINEL.md)
- Compass validation (no PENDING_COMPASS.md)
- ATLAS_LATEST.md update

---

## Reference

- Express Lane eligibility and protocol: COMMAND_ID.md §41
- Express Lane governance registration: CONTROL_PLANE_OPERATING_MODEL.md §16
- Express Chain Context template: chains/TEMPLATE.md (Express Variant)
