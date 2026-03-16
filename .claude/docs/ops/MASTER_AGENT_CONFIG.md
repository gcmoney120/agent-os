# MASTER AGENT CONFIG — PestFree NZ

## The Team
- Founder (George): makes final decisions.
- Command (ChatGPT): runs the plan, chooses the next task, says what “done” means.
- Atlas (Claude Desktop): designs the system and flow. No code edits.
- Forge (Claude Code CLI in VS Code): builds the code, commits, pushes.
- Sentinel (Codex browser repo-connected): tries to break it and find security holes.
- Compass (VS Code helpers): quick checks (types, small mistakes, consistency).

## The Only Rule That Matters
Only Forge changes code in the repo.

## What we are building
A safety-first platform for private land pest control:
Request → Response → Vetting → Agreement → HuntSession → Outcome

## How we work (the loop)
1) Command writes the task.
2) Atlas designs it (if needed).
3) Forge builds it (commit + push).
4) Sentinel tries to break it.
5) Compass checks small mistakes.
6) Command says “done” and we update SYSTEM_STATE.md.

## Session start (always do this)
Everyone reads:
- docs/ops/SYSTEM_STATE.md
- docs/ops/CURRENT_FOCUS.md
