---
file_class: CLASS_A_LIVE
owner: Command
write_rule: OVERWRITE
purpose: Holds the most recent Command ruling on the most recent agent submission. Overwritten per decision cycle. Agents read this to learn whether their submission was ACCEPTED or REJECTED. DECISION_LOG.md is the auditable history; this file is the live signal.
---

# COMMAND_DECISION

## Authorization loop
```
[1] Agent writes output to own PENDING_* file → notifies Command

[2] Command reads PENDING_* content
      → writes ruling to this file (OVERWRITE)
      → appends entry to DECISION_LOG.md

[3a] ACCEPTED:
      → if Atlas submission: Command promotes content into ATLAS_LATEST.md
      → Command updates CLASS A state files as needed
      → agent proceeds per NEXT_ACTION.md
      → on slice closure: originating agents write archive files;
        Command appends to SLICE_LEDGER.md and SYSTEM_STATE.md milestone

[3b] REJECTED:
      → SLICE_STATUS.md set to REJECTED (or BLOCKED if systemic)
      → NEXT_ACTION.md updated with revised directive
      → agent does not carry forward any part of the rejected submission
      → PENDING_* file remains until agent overwrites with revised submission
```

**Critical invariant:** No agent output is operative until a corresponding ACCEPTED entry exists in DECISION_LOG.md. An agent must not act on a submission that has no DECISION_LOG.md entry.

---

## Most recent ruling

**Date:** 2026-03-16
**Submission:** Atlas X2 — Physical Extraction architecture pack
**Outcome:** APPROVED
**DECISION_LOG.md entry:** DL-037
**Detail:** Atlas X2 architecture pack accepted. 12 ACs, complete file plan, exact interface contracts. Copy-not-move operation — current repo unmodified. Workspace root: C:\Users\Cyronick\Documents\pestfree-workspace\. Credential protection flagged (Sentinel TS-1 CRITICAL). Single segment. Architecture promoted to ATLAS_LATEST.md. Forge authorized for X2 implementation.

---

## Current authorized agents

**Atlas:** IDLE.
**Forge:** AUTHORIZED — X2 Physical Extraction implementation. Workspace root: C:\Users\Cyronick\Documents\pestfree-workspace\.
**Sentinel:** QUEUED — pending Forge delivery.
**Compass:** QUEUED — pending Forge delivery.
