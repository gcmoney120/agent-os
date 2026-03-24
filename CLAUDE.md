# Agent OS — Claude Code Operating Rules

## Code Editing Rules

- NEVER use `sed`, `awk`, or regex-based bulk scripts on JSX/TSX files. These consistently mangle JSX closing tags, CSS classes, and introduce CRLF issues.
- Use the Edit tool for each file individually when making bulk changes across multiple files.
- After every 5 file edits, run `npx tsc --noEmit` and fix any errors before continuing.
- If a file edit breaks the build, revert that specific file and retry with a corrected approach.

## Pre-Commit Checklist

Before committing code in any target project:
1. Run `npx tsc --noEmit` — zero errors required
2. Run `npm run build` if available — must pass clean
3. Check for Zod schema consistency between frontend and backend (especially password min lengths, required vs optional fields)
4. Ensure nullable types are properly guarded for Vercel-strict narrowing

## Validation & Schemas

For Zod schemas and validation: always check that frontend and backend validation rules are consistent before implementing. Grep for all instances of a schema across the codebase. Mismatched schemas between frontend and backend are a recurring source of production bugs.

## Agent OS Governance Defaults

- Skip governance initialization preamble — policies are in this file and the governance docs
- Boot directly into the active slice when dispatched
- Only run full governance ceremony if the principal explicitly requests it
- Default governance class for documentation/config: Administrative (Express)
- Default governance class for scoped bug fixes with no trust surfaces: Implementation-Light (Express)
- Prioritize implementation over process documentation

## Session Management

When a session is getting long or complex, proactively prepare session handoff boot instructions with:
- Current status and active slice
- Files modified this session
- Remaining tasks
- Exact commands to resume
- Any known bugs or build issues

Use `/handoff` to generate standardized manual handoff instructions.

## Session Chaining

- Use `/handoff chain` to write chain-context.md, update governed state, and spawn a successor session for autonomous continuation
- Use `/resume` to continue from a chain handoff (reads chain-context.md, validates against governed state, executes Next Action)
- Use `Start-AgentChain.ps1 -Task "..."` or `Start-AgentChain.ps1 -Resume` to launch chains from PowerShell
- **AUTOMATIC HANDOFF:** When context utilization reaches ~60%, Command MUST proactively execute `/handoff chain` to spawn a successor session — do not wait to be asked. This applies to ALL sessions (interactive and autonomous). An extra session is cheap, context degradation is not
- If the principal says "open a new window" or similar, execute `/handoff chain` immediately
- chain-context.md is a coordination file, not a source of truth — governed state files (ACTIVE_SLICE.md, NEXT_ACTION.md, SLICE_STATUS.md) always win on conflict
- Never spawn a successor session if Chain State is PAUSED or COMPLETE
- Always execute the full boot procedure (COMMAND_ID.md §31) in chain continuation sessions — no shortcuts
- Session chaining is a transport layer under governance — it does not bypass any governance gate, review requirement, or authority boundary
- See COMMAND_ID.md §42 and CONTROL_PLANE_OPERATING_MODEL.md §17 for full specification

## Context Engineering

- Keep the main session context lean — dispatch heavy work to sub-agents in fresh context windows
- When dispatching agents, provide complete context in the dispatch prompt so the sub-agent doesn't need to re-read governance files
- If context exceeds 60%, proactively create a handoff (`/handoff chain` for autonomous continuation, `/handoff` for manual) or dispatch remaining work to sub-agents
- Prefer atomic commits per logical work unit over monolithic commits spanning 20+ files
