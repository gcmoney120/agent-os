---
file_class: CLASS_A_LIVE
owner: Command
write_rule: OVERWRITE
purpose: Holds the current operative, Command-approved architecture. Command promotes accepted Atlas proposals into this file after approval. Atlas does not write this file. PENDING_ATLAS.md is the proposal surface; this is the authoritative operative surface.
---

# ATLAS_LATEST

## Ownership note
This file is written by Command only. Atlas submits architecture proposals to PENDING_ATLAS.md. Command reviews, approves via COMMAND_DECISION.md and DECISION_LOG.md, then promotes the accepted content here. Atlas cannot make its own proposal operative.

---

## Current operative architecture

**Series:** X — Repository Extraction (X1 → X2 → X3 → X4)
**Architecture version:** X2 v1 — Physical Extraction (Atlas submission 2026-03-16)
**Accepted:** 2026-03-16
**DECISION_LOG.md entry:** DL-037
**Manifest:** `.claude/docs/ops/extraction-manifest.md` (13 sections, ~495 lines)
**Workspace root:** `C:\Users\Cyronick\Documents\pestfree-workspace\`

### X2 Summary

Physical extraction of Agent OS into a standalone git repository. Copy-not-move operation — all AGENT-OS-ENGINE and AGENT-OS-GOVERNANCE files copied from current repo to new agent-os repo under workspace root. Current repo unmodified (X3 handles cleanup). 12 acceptance criteria.

### Key Architectural Decisions (X2)

1. **Copy-not-move:** X2 copies files to agent-os standalone; does NOT modify, delete, or move any file in the current repository. X3 handles cleanup.
2. **Workspace root:** `C:\Users\Cyronick\Documents\pestfree-workspace\` — confirmed by principal.
3. **Governance snapshot:** Governance files copied as-is (no modifications). Agent-os governance state reflects the system at extraction time.
4. **Credential protection:** settings.local.json contains production Supabase credentials — must NOT be copied. Agent-os gets new clean file. Sentinel TS-1 CRITICAL.
5. **Single segment:** ~150 file operations via bulk cp -r. No segmentation required.
6. **Pre-control-plane archive:** Root boot files (AGENTS.md, *_BOOT.md) archived to `.claude/docs/archive/pre-control-plane/` in agent-os.

### Interface Contracts

**Workspace root package.json:**
```json
{
  "private": true,
  "workspaces": ["agent-os", "pest-free-nz"]
}
```

**agent-os package.json:**
```json
{
  "name": "@agent-os/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Agent OS — governed multi-agent execution engine"
}
```
All other fields (scripts, bin, devDependencies) preserved from source.

**agent-os .claude/settings.local.json:**
```json
{
  "permissions": {
    "allow": [
      "Bash(node --version:*)",
      "Bash(npm:*)",
      "Bash(npx tsc:*)",
      "Bash(npx tsx:*)",
      "Bash(git:*)"
    ]
  }
}
```

### Acceptance Criteria (12)

- AC-X2-01: Workspace root package.json exists with exact workspaces content
- AC-X2-02: agent-os is valid git repository
- AC-X2-03: All AGENT-OS-ENGINE directories present with all source files
- AC-X2-04: review-artifacts/ copied
- AC-X2-05: package.json fields correct; tsconfig.json and .gitignore unchanged from source
- AC-X2-06: All AGENT-OS-GOVERNANCE files present in .claude/; no PFNZ-STAYS files
- AC-X2-07: Pre-control-plane boot files in archive/pre-control-plane/
- AC-X2-08: Clean settings.local.json with NO credentials
- AC-X2-09: npm install succeeds
- AC-X2-10: All tests pass, 0 failures
- AC-X2-11: Single git commit, message references X2 extraction
- AC-X2-12: No PFNZ-STAYS or EXCLUDED files in agent-os

### Sentinel Review Points

- TS-1 (CRITICAL): settings.local.json credential exclusion verification
- TS-2: Copy-not-move invariant — no current repo modifications
- TS-3: Governance file byte-identity between source and copy
- TS-4: No EXCLUDED/PFNZ-STAYS file leakage
- TS-5: .gitignore includes node_modules/ and dist/

---

### Prior operative architecture

**X1:** Extraction Readiness Audit — COMPLETE (DL-035, SL-012)
- Complete extraction manifest. Zero cross-boundary imports. Zero AMBIGUOUS items.
- 10 key architectural decisions locked (see extraction manifest)

**B-Series (B-1 + B-2):** Session Boundary Protocol + Command Orchestration Layer — COMPLETE
**A-Series (AS-1 + AS-2):** Automation Layer — COMPLETE
**R-Series (R1→R2→R3):** Runtime Integration Layer — COMPLETE (1398/1398 tests, 0 tsc errors)
