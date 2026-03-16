# Agent OS Build Plan Master
Status: LOCKED DRAFT FOR COMMAND USE
Owner: Command
Host Repo: PestFree NZ
Build Location: /agent-os
Operating Model: Command in chat, execution via Claude Code, artifact-based relay across surfaces
---
## 1. Purpose
This document defines the authoritative phased build plan for Agent OS while it is being developed inside the PestFree NZ repository.
Agent OS is a reusable multi-agent operating system for governed software delivery.
It must remain:
- extraction-safe
- project-agnostic in core
- trust-governed
- deterministic
- auditable
PestFree NZ is the current host repository and reference implementation.
This build plan exists so all agents know:
- what Agent OS is
- what has already been locked
- what phases exist
- what order work must happen in
- what must not be skipped
- what artifacts govern implementation
---
## 2. Operating Model (Locked)
### Authority Model
- GC is Founder and final decision authority
- Command is orchestration and governance authority
- Atlas defines architecture only
- Forge implements only approved slices
- Sentinel reviews security and trust boundaries
- Compass validates acceptance criteria and completeness
### Claude Surface Model
Locked operating model:
Command -> Chat
Atlas -> Chat
Forge -> Claude Code
Sentinel -> Chat or Claude Code review lane
Compass -> Chat or Claude Code validation lane
### Cross-Surface Communication Model
No direct agent-to-agent live messaging is assumed between chat and Claude Code surfaces.
Cross-surface coordination is performed via repo artifacts.
Canonical relay artifacts include:
- CURRENT_FOCUS.md
- Slice Packets
- Step Reports
- Sentinel review artifacts
- Compass validation artifacts
- SYSTEM_STATE.md
- architecture specs
- approval decisions
This is the official relay protocol until Agent OS automates it.
---
## 3. Repo Boundary (Locked)
Agent OS is currently hosted inside the PestFree NZ repo as a temporary execution decision.
This does not change the long-term intent for Agent OS to become a standalone reusable system.
### Required Boundary
Agent OS must remain isolated under:
/agent-os
Recommended structure:
/agent-os
/core
/memory
/planner
/runtime
/governance
/schemas
/adapters
/docs
### PestFree Adapter Boundary
PestFree-specific logic must not leak into Agent OS core.
Project-specific bindings must be isolated through an adapter layer.
/pestfree-adapter
### Extraction Rule
Everything under /agent-os must be designed so it can later move to a separate repository with minimal refactoring.
---
## 4. Core System Goal
Agent OS orchestrates governed software delivery through:
- deterministic execution
- role-bound agents
- immutable execution context
- capability-gated outputs
- formal approvals
- append-only run artifacts
- governed memory
- project adapter isolation
Agent OS is not a chatbot wrapper.
Agent OS is an execution and governance system.
---
## 5. Build Principles
All phases must obey these principles:
1. Trust first
2. No architecture drift
3. No undefined scope expansion
4. One active governed slice at a time
5. No implementation before architecture is locked
6. No merge without Sentinel PASS and Compass PASS where required
7. Every major phase must update SYSTEM_STATE.md
8. Every cross-surface handoff must use explicit artifacts
9. Memory may inform but never govern
10. PestFree-specific assumptions must not contaminate Agent OS core
---
## 6. Build Phases
### Phase 0 — Governance Foundation
Role definitions, process discipline, and trust-change protocol.
### Phase 1 — Project Adapter Loader
Adapter contract and project isolation layer.
### Phase 2 — Foreman Execution Core
Deterministic execution runtime.
### Phase 3 — Step Report & Relay System
Standardized artifact outputs for every agent action.
### Phase 4 — Planner Subsystem
Structured planning before execution.
### Phase 5 — Claude Operating Profile
Defines role behavior and cross-surface relay protocol.
### Phase 6 — Knowledge Layer (Memory Engine)
Sub-slices:
K1 — Memory Engine Foundation
K2 — Retrieval Authorization Layer
K3 — Memory Writer Pipeline
K4 — Embedding Pipeline
K5 — Learning Feedback Loop
### Phase 7 — Review & Enforcement Layer
Sentinel and Compass as formal enforcement gates.
### Phase 8 — Tool Governance Layer
Capability registry and tool performance tracking.
### Phase 9 — Autonomy Policy Layer
Defines what agents may do without Command approval.
### Phase 10 — Host Integration Layer
PestFree adapter and runtime integration.
### Phase 11 — Extraction Readiness
Prepare Agent OS to move to its own repo.
---
## 7. Immediate Execution Roadmap
1. Save this build plan
2. Save Memory Engine Architecture Spec v1.1
3. Update CURRENT_FOCUS to K1
4. Create SLICE_PACKET_K1.md
5. Begin K1 implementation
6. Run Sentinel review
7. Run Compass validation
8. Update SYSTEM_STATE.md
---
## 8. K-Series Slice Plan
K1 — Memory Engine Foundation
K2 — Retrieval Authorization
K3 — Memory Writer
K4 — Embedding Pipeline
K5 — Learning Feedback Loop
---
## 9. Required Canonical Files
.claude/docs/architecture/AGENT_OS_BUILD_PLAN_MASTER.md
.claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md
.claude/docs/orchestration/CURRENT_FOCUS.md
.claude/docs/orchestration/SLICE_PACKET_K1.md
.claude/docs/orchestration/STEP_REPORT_K1.md
.claude/docs/orchestration/SENTINEL_REVIEW_K1.md
.claude/docs/orchestration/COMPASS_VALIDATION_K1.md
docs/ops/SYSTEM_STATE.md
AGENTS.md
---
END OF DOCUMENT
