# Agent OS — Autonomous Session Chaining

## Overview

Session chaining enables Claude Code sessions to execute governed work autonomously,
then spawn successor sessions when context capacity is reached or tasks complete.
The chain self-sustains until the work queue is empty or a review gate requires
principal approval.

Session chaining is a **transport layer under governance**. It does not alter any
governance gate, review requirement, or authority boundary. Every session in a
chain executes the full boot procedure and follows the standard governance flow.

## Architecture

```
Session 1                    Session 2                    Session 3
┌──────────────┐            ┌──────────────┐            ┌──────────────┐
│ Boot (§31)   │            │ /resume      │            │ /resume      │
│              │            │ ├ Read chain  │            │ ├ Read chain  │
│ Execute work │            │ │ context     │            │ │ context     │
│ (§39/§40)    │            │ ├ Full boot   │            │ ├ Full boot   │
│              │            │ ├ Validate    │            │ ├ Validate    │
│ /handoff     │──spawn──▶  │ ├ Execute     │──spawn──▶  │ ├ Execute     │
│ chain        │            │ │ work        │            │ │ work        │
│              │            │ └ /handoff    │            │ └ Chain State:│
│ Exit         │            │   chain       │            │   COMPLETE   │
└──────────────┘            └──────────────┘            └──────────────┘
```

### Three Protocol Layers

| Layer | Protocol | Scope |
|-------|----------|-------|
| Inner | §39 Session Boundary Protocol | Segment boundaries within agent dispatches |
| Middle | §40 Autonomous Orchestration Protocol | Agent dispatches within a single session |
| **Outer** | **§42 Session Chaining Protocol** | **Session → handoff → new session** |

## Files

```
.claude/
├── chain-context.md              # Living handoff file (overwritten each handoff)
├── commands/
│   ├── handoff.md                # Unified handoff (manual + chain modes)
│   └── resume.md                 # Chain resume command
Start-AgentChain.ps1              # PowerShell launcher (project root)
```

## Setup

### 1. Verify Agent OS governance files exist

The system expects these operational state files:

- `.claude/docs/ops/SYSTEM_STATE.md`
- `.claude/docs/ops/NEXT_ACTION.md`
- `.claude/docs/ops/ACTIVE_SLICE.md`
- `.claude/docs/ops/CURRENT_FOCUS.md`
- `.claude/docs/ops/SLICE_STATUS.md`
- `.claude/docs/ops/DECISION_LOG.md`
- `.claude/docs/ops/AGENT_QUEUE.md`

These are standard Agent OS files created during project initialization (`/govern:init-project`).

### 2. Verify Claude CLI is installed

```powershell
claude --version
```

### 3. No additional configuration needed

All files are placed during Agent OS setup. The launcher uses `$PSScriptRoot` to find the project path automatically when run from the project root.

## Usage

### Starting a new chain

```powershell
.\Start-AgentChain.ps1 -Task "Execute slice SC-1 implementation"
```

This opens a new PowerShell window, launches Claude Code with the task, and begins autonomous execution.

### Resuming a paused chain

```powershell
.\Start-AgentChain.ps1 -Resume
```

This reads the existing `.claude/chain-context.md` and continues from where the chain paused.

### Using a different project

```powershell
.\Start-AgentChain.ps1 -Resume -ProjectPath "C:\Users\Cyronick\Documents\clearpath"
```

### Manual single-session resume (interactive)

From within an active Claude Code session:

```
/resume
```

### Triggering a chain handoff (from within a session)

```
/handoff chain
```

### Stopping the chain

Close the active PowerShell window. The chain context file preserves the last known good state for later resumption.

## How the Chain Stops Itself

The chain pauses or completes autonomously when:

| Condition | Chain State | Successor Spawned? |
|-----------|-------------|-------------------|
| Work queue is empty, slice closed | `COMPLETE` | No |
| Review gate requires principal input | `PAUSED` | No |
| Escalation trigger fired (§14.4) | `PAUSED` | No |
| Principal decision required | `PAUSED` | No |
| Unresolvable error within slice scope | `PAUSED` | No |
| Work remains, context allows | `ACTIVE` | Yes (continues) |
| Work remains, context at ~60% | `ACTIVE` | Yes (proactive handoff) |

In all cases, `.claude/chain-context.md` contains a clear description of what was accomplished and what needs attention.

## Context Threshold

Sessions hand off proactively at approximately **60% context utilization**. Since Claude Code does not expose a precise context meter, Command uses these heuristics:

- 3+ full agent dispatch/review cycles processed in the session
- Substantial tool output accumulation
- Noticeable degradation in recall of earlier session details
- When in doubt, hand off early — an extra session is cheap, context degradation is not

## Safety Model

The `--dangerously-skip-permissions` flag removes Claude Code's per-action approval gate. In the Agent OS context, safety is provided at a higher level:

| Risk | Mitigation |
|------|-----------|
| Destructive file operations | Scoped slice packets, Git as safety net |
| Scope creep | Slice boundaries enforced by resume validation |
| Ungoverned decisions | DECISION_LOG.md append-only audit |
| Runaway execution | Review gates pause the chain; session count tracking |
| Context degradation | Fresh sessions, 60% proactive handoff |
| State corruption | Resume validates chain-context against governed state |
| Two sessions running | By design: current exits after spawning successor |

### Manual Override

If a human starts a session manually while a chain is ACTIVE, Command surfaces the active chain during boot and offers:
- Resume the chain: `/resume`
- Pause the chain: set Chain State to PAUSED
- Ignore the chain: proceed normally

The principal always has full authority over the chain.

## Distribution to Other Projects

The session chaining infrastructure is project-agnostic. To add it to another project (e.g., PestFree NZ, ClearPath, BrightSteps):

1. Copy `.claude/chain-context.md` (schema template)
2. Copy `.claude/commands/handoff.md` (unified handoff)
3. Copy `.claude/commands/resume.md` (chain resume)
4. Copy `Start-AgentChain.ps1` to the project root
5. Ensure the project has Agent OS governance state files (or run `/govern:init-project`)

The launcher auto-detects the project path from its location (`$PSScriptRoot`), so no hardcoded paths need updating.

## Known Issues and Mitigations

### Windows --resume + --dangerously-skip-permissions bug

There is an active bug (GitHub issue #36139, March 2026) where `--dangerously-skip-permissions` combined with `--resume` in print mode can have the Write tool blocked on Windows. This system avoids the issue by using fresh sessions with `-p` (print mode) rather than `--resume`. Each session is new; continuity comes from the chain context file on disk, not from Claude Code's session history.

### Context rot in long chains

Extended autonomous chains can accumulate subtle context drift. Mitigations:

- Each session starts fresh (no accumulated context)
- Chain context is structured and schema-driven (not freeform narrative)
- Governed state files are the source of truth, not conversation memory
- The handoff command forces a state reconciliation before each transition
- Resume validates chain-context against governed state before executing

### Scope creep risk

Claude Code with `--dangerously-skip-permissions` can modify files outside the intended scope. Mitigations:

- Slice packets define explicit scope boundaries
- The resume command validates that the next action is within slice scope
- Escalation triggers catch governance violations
- Append-only audit trail in DECISION_LOG.md and audit-log.jsonl

### Platform support

v1 is **Windows-only** (PowerShell launcher). Future enhancement: add `start-agent-chain.sh` for macOS/Linux.

## Governance Registration

Session chaining is registered in the Agent OS governance model:

- **COMMAND_ID.md §42** — Session Chaining Protocol
- **CONTROL_PLANE_OPERATING_MODEL.md §17** — Session Chaining Infrastructure
- **audit-log.jsonl** — `session_handoff` action type
- **CLAUDE.md** — Session chaining operating rules
