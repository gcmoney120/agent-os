---
file_class: CLASS_A_LIVE_CHAIN
owner: Command
write_rule: OVERWRITE_BY_COMMAND
purpose: Running chain record for [SLICE-ID]. Command creates this document at slice activation and updates it at every chain stage. Agents receive relevant excerpts from prior stages as dispatch context. Archived at slice closure.
---

# Chain Context — [SLICE-ID]

## Task

[Original task description as framed by the principal and scoped by Command at activation]

**Governance class:** [Trust-critical / Implementation / Administrative]
**Activated:** [ISO-8601 timestamp]
**Required closure gates:** [Sentinel PASS + Compass / Command review only / etc.]

---

## Dispatch Log

### Stage 1 — [Agent Name]

- **Dispatched:** [ISO-8601 timestamp]
- **Dispatch Criteria:** [What this agent was asked to do — exact task framing]
- **Output Summary:** [Brief summary of the agent's submission — populated after submission received]
- **Review Decision:** Approved / Rejected / Escalated
- **Review Reasoning:** [Why Command made this decision]
- **Challenge Findings:** [What adversarial review surfaced — including anything NOT flagged by the agent that Command found]
- **Key Decisions Made:** [Decisions from this stage that all downstream agents must respect]

### Stage 2 — [Agent Name]

- **Dispatched:** [ISO-8601 timestamp]
- **Dispatch Criteria:** [What this agent was asked to do]
- **Chain Context Provided:** [Which key decisions from Stage 1 were relayed to this agent]
- **Output Summary:** [Brief summary of the agent's submission]
- **Review Decision:** Approved / Rejected / Escalated
- **Review Reasoning:** [Why]
- **Challenge Findings:** [What adversarial review surfaced]
- **Key Decisions Made:** [Decisions downstream agents must respect]

### Stage 3 — Sentinel (parallel)

- **Dispatched:** [ISO-8601 timestamp]
- **Dispatch Criteria:** [Trust review scope for this slice]
- **Output Summary:** [Sentinel ruling summary]
- **Review Decision:** Approved / Rejected / Escalated
- **Review Reasoning:** [Why]
- **Challenge Findings:** [What Command found in adversarial review of Sentinel's ruling]
- **Key Decisions Made:** [e.g., specific findings carried to OPEN_ISSUES.md; HIGH severity items requiring principal ruling]

### Stage 3 — Compass (parallel)

- **Dispatched:** [ISO-8601 timestamp]
- **Dispatch Criteria:** [Validation scope for this slice]
- **Output Summary:** [Compass ruling summary]
- **Review Decision:** Approved / Rejected / Escalated
- **Review Reasoning:** [Why]
- **Challenge Findings:** [What Command found in adversarial review of Compass's ruling]
- **Key Decisions Made:** [e.g., carry-forward items for OPEN_ISSUES.md; CONDITIONALLY MET criteria requiring Command ruling]

---

## Corrections

[Each rejection logged here. If no corrections, write "None."]

- Stage [N] [Agent] — Rejected [ISO-8601]: [reason]. Correction context provided: [what was communicated]. Re-dispatch: [ISO-8601]. Correction count: [1 / 2].
- Stage [N] [Agent] — Rejected [ISO-8601] (correction 2): [reason]. Correction context: [what was communicated]. Re-dispatch: [ISO-8601]. (Note: If a third correction is required, escalate to principal.)

---

## Escalations

[Any escalations logged here. If none, write "None."]

- [ISO-8601] — Escalation trigger: [which trigger from COMMAND_ID.md fired]. Chain context at point of escalation: [brief summary]. Principal decision: [what was decided]. Chain resumed [ISO-8601] / Chain abandoned [ISO-8601].

---

## Status

- **Current stage:** [e.g., "Stage 1 — Atlas DISPATCHED, awaiting submission" / "Stage 2 — Forge APPROVED; Stage 3 Sentinel and Compass DISPATCHED in parallel, awaiting both" / "All stages approved — closure pending"]
- **Next action:** [single explicit action Command must take, e.g., "Review Forge submission in PENDING_FORGE.md and execute submission.md review protocol" / "Dispatch Sentinel for trust review"]
- **Chain complete:** [yes / no]

---

## Final State

[Populated at closure.]

- **Outcome:** completed / abandoned / escalated-open
- **Governed Artifacts Updated:** [list all control-plane files written or updated at closure]
- **Sentinel ruling:** [PASS / PASS WITH NOTES / FAIL — key points]
- **Compass ruling:** [Ready for closure / Ready with notes / Not ready — key points]
- **Closed:** [ISO-8601 timestamp]
- **DECISION_LOG.md entry:** [DL-XXX]
- **SLICE_LEDGER.md entry:** [SL-XXX]

---
---

# Express Variant — Chain Context Template

Use this template for Express Lane slices (Administrative class, no trust surfaces). See COMMAND_ID.md §41 and CONTROL_PLANE_OPERATING_MODEL.md §16.

---

```markdown
---
file_class: CLASS_A_LIVE_CHAIN
owner: Command
write_rule: OVERWRITE_BY_COMMAND
purpose: Running chain record for [SLICE-ID] (Express Lane). Command creates this document at Express activation and updates it at Forge review. Archived at slice closure.
---

# Chain Context — [SLICE-ID] (Express)

## Task

[Original task description as framed by the principal and scoped by Command at activation]

**Governance class:** Administrative (Express)
**Activated:** [ISO-8601 timestamp]
**Required closure gates:** Command review only

---

## Dispatch Log

### Stage 1 — Forge (Express: single stage)

- **Dispatched:** [ISO-8601 timestamp]
- **Dispatch Criteria:** [What Forge was asked to do — Command directive, no Atlas architecture]
- **Output Summary:** [Brief summary of the Forge submission — populated after submission received]
- **Review Decision:** Approved / Rejected / Elevated
- **Review Reasoning:** [Why Command made this decision]
- **Key Decisions Made:** [Any decisions relevant to audit trail]

---

## Corrections

[Each rejection logged here. If no corrections, write "None."]

---

## Escalations

[Any escalations or elevations logged here. If none, write "None."]

- If elevated to full pipeline: [ISO-8601] — Elevation trigger: [reason]. Slice continues as standard pipeline from this point.

---

## Status

- **Current stage:** [e.g., "Forge DISPATCHED, awaiting submission" / "Forge APPROVED — closure pending"]
- **Next action:** [single explicit action]
- **Chain complete:** [yes / no]

---

## Final State

[Populated at closure.]

- **Outcome:** completed / elevated / abandoned
- **Governed Artifacts Updated:** [list all control-plane files written or updated at closure]
- **Sentinel ruling:** N/A (Express Lane — no trust surfaces)
- **Compass ruling:** N/A (Express Lane — Command validated directly)
- **Closed:** [ISO-8601 timestamp]
- **DECISION_LOG.md entry:** [DL-XXX]
- **SLICE_LEDGER.md entry:** [SL-XXX]
```
