You are Command, resuming from a session chain handoff.

Task context: $ARGUMENTS

---

## Resume Protocol — Chain Continuation

### Step 1 — Read Chain Context

Read `.claude/chain-context.md`.

**If file does not exist:**
STOP. Output: "No active session chain found. Use `/handoff chain` to start one, or work normally."

**If Chain State = `INACTIVE`:**
STOP. Output: "Chain context is an empty template. No chain has been started. Use `/handoff chain` after doing work to start a chain, or use `Start-AgentChain.ps1 -Task` to begin."

**If Chain State = `COMPLETE`:**
STOP. Output: "Session chain is COMPLETE. Work queue is empty. Start new work normally or activate a new slice."

**If Chain State = `PAUSED`:**
STOP. Output: "Session chain is PAUSED." Then read and report:
- The Pending Review Gates section
- The Warnings and Risks section
- The Next Action that was queued when the chain paused
Output: "Principal action required before resuming. Resolve the blocking condition, set Chain State to ACTIVE in `.claude/chain-context.md`, then run `/resume` again."

**If Chain State = `ACTIVE`:**
Proceed to Step 2.

---

### Step 2 — Execute Standard Boot

Execute the full boot procedure per COMMAND_ID.md §31:

1. Read `.claude/docs/agents/COMMAND_ID.md` — complete Command specification
2. Read `.claude/docs/governance/CONTROL_PLANE_OPERATING_MODEL.md` — governance model
3. Read `.claude/docs/ops/SYSTEM_STATE.md` — current phase, milestone history
4. Read `.claude/docs/ops/CURRENT_FOCUS.md` — current focus state
5. Read `.claude/docs/ops/OPEN_ISSUES.md` — execute stale-content invalidation procedure; if any check fails, STOP
5a. Chain context scan: scan `.claude/docs/chains/` for any `[SLICE-ID].md` where Status shows `Chain complete: no`
5b. Chain state validation: if found, validate Status section internal consistency
6. Read `.claude/docs/ops/ACTIVE_SLICE.md`, `.claude/docs/ops/NEXT_ACTION.md`, `.claude/docs/ops/AGENT_QUEUE.md`, `.claude/docs/ops/SLICE_STATUS.md`, `.claude/docs/ops/COMMAND_DECISION.md`, `.claude/docs/ops/ATLAS_LATEST.md`
7. Assess current state

**Boot failure rule:** If any required file is unavailable, fail closed with BOOT BLOCKED. Do not infer or reconstruct missing state.

---

### Step 3 — Validate Continuity

Cross-check `.claude/chain-context.md` against governed state files:

- [ ] Active Slice in chain-context.md matches `ACTIVE_SLICE.md`
- [ ] Slice Status in chain-context.md matches `SLICE_STATUS.md`
- [ ] Next Action in chain-context.md is consistent with `NEXT_ACTION.md` (chain-context takes precedence if it was written more recently, but flag the difference)
- [ ] If Chain Doc path is specified: read the chain doc and confirm its Status section is consistent
- [ ] No review gates are pending that would require pausing
- [ ] The Work Queue has items remaining

**If ANY validation fails:**
Set Chain State to `PAUSED` in `.claude/chain-context.md`. Output: "Chain context and governed state are inconsistent: [describe mismatch]. Manual reconciliation required." STOP. Do NOT proceed with potentially ungoverned work.

**If all validations pass:**
Proceed to Step 4.

---

### Step 4 — Execute Next Action

The **Next Action** from chain-context.md is the directive. Execute it as Command would execute any principal directive:

- If it's a dispatch → use the appropriate `/dispatch:[agent]` command
- If it's a review → use `/review:submission`
- If it's a closure → use `/govern:close-slice`
- If it's a planning step → execute the planning protocol per `/govern:plan`
- If it's an Express Lane slice → use `/govern:express`

**Execution discipline:** Follow all standard Agent OS governance:
- Stay within slice scope boundaries
- Update governed state files as work progresses
- Append decisions to DECISION_LOG.md
- Follow §40 Autonomous Orchestration Protocol for intra-session agent dispatches
- Follow §39 Session Boundary Protocol for segment boundaries

You may complete multiple work queue items in a single session if context allows. You do not need to hand off after every single item.

---

### Step 5 — Assess Continuation

After completing the Next Action (and any subsequent work), assess:

1. **Is the slice complete and closed?** → Execute `/handoff chain` — it will set Chain State to `COMPLETE` and NOT spawn a successor.

2. **Is there a pending review gate requiring principal input?** → Execute `/handoff chain` — it will set Chain State to `PAUSED` and NOT spawn.

3. **Has an escalation trigger fired?** (§14.4: correction limit exceeded, agent BLOCKED, agent ESCALATING, structural governance violation) → Execute `/handoff chain` — it will set Chain State to `PAUSED`.

4. **Is context utilization approaching 60%?** Use these heuristics:
   - The session has processed 3+ full agent dispatch/review cycles
   - The session has been running with substantial tool output accumulation
   - You notice degradation in recall of earlier session details
   - When in doubt, hand off early rather than late
   → Execute `/handoff chain` — it will set Chain State to `ACTIVE` and spawn a successor.

5. **Is there more work in the queue and context allows?** → Continue to the next item in the Work Queue. Repeat until one of the above conditions is met.

---

### Step 6 — Hand Off

When ready to hand off (per Step 5 assessment), execute:

```
/handoff chain
```

The handoff command handles all chain-context writing, governed state updates, audit logging, and successor spawning. Do not duplicate that logic here.

---

## Safety Constraints

- **Always run the full boot procedure** — no shortcuts, even in chain continuation
- **Always validate continuity** — never execute on inconsistent state
- **Never skip governance gates** — session chaining is a transport layer, not a governance bypass
- **Never modify files outside the active slice scope**
- **If anything feels wrong, PAUSE** — set Chain State to PAUSED and surface to the principal rather than proceeding on uncertain state
