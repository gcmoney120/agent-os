---
file_class: CLASS_A_PENDING
owner: Atlas
write_rule: OVERWRITE
purpose: Holds Atlas's current submission awaiting Command review. Atlas overwrites this file when submitting a new architecture proposal. Command reads this file to review the submission. This file is not a log — it is overwritten per submission. History is preserved in DECISION_LOG.md.
---

---
SUBMISSION: Atlas
SLICE: X2 — Physical Extraction
STATUS: COMPLETE
SUMMARY: X2 architecture defines the physical extraction of Agent OS into a standalone git repository. The extraction is a copy-not-move operation — all source files are copied from the current repo to a new agent-os repo under a workspace root directory; the current repo is not modified (X3 handles cleanup). The architecture specifies the exact directory structure, file copy plan, package.json amendments, governance tree snapshot, pre-control-plane file archival, and test validation procedure. 12 acceptance criteria cover every in-scope item.
KEY DECISIONS:
- Copy-not-move: X2 copies files to agent-os standalone; does NOT modify, delete, or move any file in the current repository. X3 handles current repo cleanup.
- Workspace root location is a principal decision — architecture uses $WORKSPACE_ROOT placeholder. Command must confirm the absolute path before dispatching Forge.
- Governance files copied as-is (snapshot): no governance state file modifications during extraction. Agent-os governance state reflects the system at extraction time and will diverge naturally post-X4.
- settings.local.json contains production credentials — must NOT be copied. Agent-os gets a new, clean settings file.
- Bulk copy operations: Forge should use cp -r for directory trees, not file-by-file operations, to stay within context limits.
- Segmentation recommendation: ~150 file operations total. Single segment is feasible if Forge uses bulk copy commands. Command should assess based on Forge context budget.
OUTPUT:

---

## Atlas Architecture Pack

**Slice:** X2 — Physical Extraction
**Type:** Additive (new repository creation; no modifications to current repo)
**Subsystem:** Repository extraction — Agent OS standalone

### Objective

Create the agent-os standalone git repository with fresh history under a workspace root directory, containing all AGENT-OS-ENGINE and AGENT-OS-GOVERNANCE files from the current repository, with tests passing independently.

### Scope

Physical extraction of Agent OS into a standalone repository. Copy all classified files per the extraction manifest. Initialize workspace root. Verify test suite passes in the new location. Create initial git commit.

### In Scope

- Workspace root directory creation with package.json → AC-X2-01
- agent-os directory structure creation → AC-X2-02
- AGENT-OS-ENGINE file copy (agent-os/src/, __tests__/, tests/, docs/, schemas/, core/, governance/, memory/, planner/, runtime/, review-artifacts/) → AC-X2-03, AC-X2-04
- agent-os package.json amendment (name, version, description) → AC-X2-05
- agent-os tsconfig.json and .gitignore copy → AC-X2-05
- AGENT-OS-GOVERNANCE file copy (.claude/ tree) → AC-X2-06
- Pre-control-plane boot file archival (AGENTS.md, *_BOOT.md) → AC-X2-07
- agent-os .claude/settings.local.json creation (new, clean) → AC-X2-08
- npm install in agent-os standalone → AC-X2-09
- Test suite validation → AC-X2-10
- Git repository initialization and initial commit → AC-X2-11
- Negative check: no PFNZ-STAYS or EXCLUDED files in agent-os → AC-X2-12

### Out of Scope

- Modifying any file in the current repository (X3 scope)
- Removing agent-os/ directory from current repo (X3 scope)
- Creating pest-free-nz .claude/ governance tree (X3 scope)
- Moving the current repo into the workspace root (X3 scope)
- Copying dispatch/identity files to pest-free-nz (X3 scope)
- Updating pest-free-nz package.json or .gitignore (X3 scope)
- Parallel operation validation (X4 scope)
- Byte-identity enforcement mechanism (deferred to X3/X4 per X1-TS-1)
- Any modification to governance state files (SYSTEM_STATE.md, CURRENT_FOCUS.md, etc.) — copied as-is

### Data / State Model

No data model changes. No schema changes. File system operations only.

### Invariants

**Preserved:**
- All governance files copied byte-for-byte — no content modifications during extraction
- agent-os test suite integrity: all tests must pass in the new location
- Zero cross-boundary imports: agent-os has no dependencies on files outside its own directory tree
- Append-only files (DECISION_LOG.md, SLICE_LEDGER.md) copied without modification
- Agent identity files copied without modification

**New:**
- Workspace root package.json is the sole npm workspace configuration file
- agent-os repository has fresh git history (single initial commit)
- agent-os .claude/settings.local.json is a new file with no credentials from the source repo

### Interface Contracts

**Workspace root package.json — exact content (fixed):**
```json
{
  "private": true,
  "workspaces": ["agent-os", "pest-free-nz"]
}
```

**agent-os package.json amendments — exact changes (fixed):**
```json
{
  "name": "@agent-os/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Agent OS — governed multi-agent execution engine"
}
```
All other fields (scripts, bin, devDependencies) preserved unchanged from source.

**agent-os .claude/settings.local.json — exact content (fixed):**
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
This is a minimal, clean settings file with no credentials. Forge may add additional safe permission patterns if needed for test execution, but must NOT copy any entries from the source settings.local.json that contain credentials or project-specific paths.

### Rules

**Write / Transition Rules:**
- Forge creates files ONLY in the workspace root and agent-os directories — never modifies the current repository
- All file copies are from current repo → agent-os standalone (one direction only)
- git init + git add + git commit happen AFTER all files are in place and tests pass

**Read / Access Rules:**
- Forge reads from the current repository to determine source file content
- Forge reads the extraction manifest as the authoritative disposition list

### File Plan

**Location notation:** `$WORKSPACE_ROOT` = workspace root directory (path confirmed by principal before Forge dispatch).

#### Workspace Root

| Target path | Action | Purpose |
|-------------|--------|---------|
| `$WORKSPACE_ROOT/package.json` | Create | npm workspace root configuration |

#### Agent OS — Engine Files (copy from current repo)

| Source | Target | Action |
|--------|--------|--------|
| `agent-os/src/` | `$WORKSPACE_ROOT/agent-os/src/` | Copy directory tree |
| `agent-os/__tests__/` | `$WORKSPACE_ROOT/agent-os/__tests__/` | Copy directory tree |
| `agent-os/tests/` | `$WORKSPACE_ROOT/agent-os/tests/` | Copy directory tree |
| `agent-os/docs/` | `$WORKSPACE_ROOT/agent-os/docs/` | Copy directory tree |
| `agent-os/schemas/` | `$WORKSPACE_ROOT/agent-os/schemas/` | Copy directory tree |
| `agent-os/core/` | `$WORKSPACE_ROOT/agent-os/core/` | Copy directory tree (.gitkeep) |
| `agent-os/governance/` | `$WORKSPACE_ROOT/agent-os/governance/` | Copy directory tree (.gitkeep) |
| `agent-os/memory/` | `$WORKSPACE_ROOT/agent-os/memory/` | Copy directory tree (.gitkeep) |
| `agent-os/planner/` | `$WORKSPACE_ROOT/agent-os/planner/` | Copy directory tree (.gitkeep) |
| `agent-os/runtime/` | `$WORKSPACE_ROOT/agent-os/runtime/` | Copy directory tree (.gitkeep) |
| `agent-os/package-lock.json` | `$WORKSPACE_ROOT/agent-os/package-lock.json` | Copy file |
| `agent-os/tsconfig.json` | `$WORKSPACE_ROOT/agent-os/tsconfig.json` | Copy file |
| `agent-os/.gitignore` | `$WORKSPACE_ROOT/agent-os/.gitignore` | Copy file |
| `review-artifacts/` | `$WORKSPACE_ROOT/agent-os/review-artifacts/` | Copy directory tree |

**Note:** `agent-os/node_modules/` is EXCLUDED — regenerated via npm install. `agent-os/package.json` is not copied — it is created new with amended fields (see Interface Contracts).

#### Agent OS — Governance Files (copy from current repo .claude/)

| Source | Target | Action |
|--------|--------|--------|
| `.claude/commands/` | `$WORKSPACE_ROOT/agent-os/.claude/commands/` | Copy entire directory tree (dispatch/, govern/, review/) |
| `.claude/docs/agents/` | `$WORKSPACE_ROOT/agent-os/.claude/docs/agents/` | Copy all 5 identity files |
| `.claude/docs/architecture/` | `$WORKSPACE_ROOT/agent-os/.claude/docs/architecture/` | Copy directory tree |
| `.claude/docs/governance/` | `$WORKSPACE_ROOT/agent-os/.claude/docs/governance/` | Copy directory tree |
| `.claude/docs/ops/` | `$WORKSPACE_ROOT/agent-os/.claude/docs/ops/` | Copy all files including archive/ subdirectory |
| `.claude/docs/chains/` | `$WORKSPACE_ROOT/agent-os/.claude/docs/chains/` | Copy all files including archive/ subdirectory |
| `.claude/docs/archive/` | `$WORKSPACE_ROOT/agent-os/.claude/docs/archive/` | Copy directory tree (CTRL-S5 archived files) |
| `.claude/docs/orchestration/` | `$WORKSPACE_ROOT/agent-os/.claude/docs/orchestration/` | Copy directory tree (9 pre-control-plane files) |

**NOT copied (PFNZ-STAYS):**
- `.claude/launch.json` — project-specific
- `.claude/settings.local.json` — contains production credentials; agent-os gets new clean file

#### Agent OS — Pre-Control-Plane Archive

| Source | Target | Action |
|--------|--------|--------|
| `AGENTS.md` (root) | `$WORKSPACE_ROOT/agent-os/.claude/docs/archive/pre-control-plane/AGENTS.md` | Copy |
| `FORGE_BOOT.md` (root) | `$WORKSPACE_ROOT/agent-os/.claude/docs/archive/pre-control-plane/FORGE_BOOT.md` | Copy |
| `SENTINEL_BOOT.md` (root) | `$WORKSPACE_ROOT/agent-os/.claude/docs/archive/pre-control-plane/SENTINEL_BOOT.md` | Copy |
| `COMPASS_BOOT.md` (root) | `$WORKSPACE_ROOT/agent-os/.claude/docs/archive/pre-control-plane/COMPASS_BOOT.md` | Copy |

#### Agent OS — New Files

| Target path | Action | Purpose |
|-------------|--------|---------|
| `$WORKSPACE_ROOT/agent-os/package.json` | Create | Amended package manifest (@agent-os/core v0.1.0) |
| `$WORKSPACE_ROOT/agent-os/.claude/settings.local.json` | Create | Clean Claude Code settings (no credentials) |

### Implementation Discretion

**Fixed by architecture:**
- Workspace root package.json content (exact JSON specified)
- agent-os package.json name, version, description, private, type fields (exact values specified)
- agent-os .claude/settings.local.json must NOT contain credentials from source
- Copy-not-move invariant: current repo unmodified
- File sources and targets as specified in File Plan
- Git initial commit message must reference X2 extraction
- Tests must pass before git commit

**Left to Forge:**
- Exact bash commands for bulk copy operations (cp -r recommended)
- Order of copy operations (no dependencies between directory copies)
- agent-os .claude/settings.local.json: may add safe permission patterns beyond the specified minimum (e.g., Bash(ls:*)) but must not include credentials
- Git commit message exact wording (must include "X2" and "extraction" as terms)
- Whether to create .gitkeep files in empty directories or rely on git tracking
- Internal sequencing of npm install, test run, and git operations

### Acceptance Criteria

- AC-X2-01: `$WORKSPACE_ROOT/package.json` exists with exact content: `{"private": true, "workspaces": ["agent-os", "pest-free-nz"]}`
- AC-X2-02: `$WORKSPACE_ROOT/agent-os/` directory exists as a valid git repository (`git -C $WORKSPACE_ROOT/agent-os status` succeeds)
- AC-X2-03: All AGENT-OS-ENGINE directories from extraction manifest §2.4 are present in `$WORKSPACE_ROOT/agent-os/`: src/, __tests__/, tests/, docs/, schemas/, core/, governance/, memory/, planner/, runtime/ — with all source files present
- AC-X2-04: `review-artifacts/` directory and all contents copied to `$WORKSPACE_ROOT/agent-os/review-artifacts/`
- AC-X2-05: `$WORKSPACE_ROOT/agent-os/package.json` has name "@agent-os/core", version "0.1.0", type "module", private true, description "Agent OS — governed multi-agent execution engine"; scripts and devDependencies unchanged from source; `tsconfig.json` and `.gitignore` present and unchanged from source
- AC-X2-06: All AGENT-OS-GOVERNANCE files from extraction manifest §2.5 are present in `$WORKSPACE_ROOT/agent-os/.claude/` — commands/ (8 files across 3 subdirectories), docs/agents/ (5 files), docs/architecture/, docs/governance/, docs/ops/ (all files including archive/), docs/chains/ (all files including archive/), docs/archive/, docs/orchestration/. PFNZ-STAYS files (launch.json, source settings.local.json) are NOT present.
- AC-X2-07: Pre-control-plane boot files (AGENTS.md, FORGE_BOOT.md, SENTINEL_BOOT.md, COMPASS_BOOT.md) present at `$WORKSPACE_ROOT/agent-os/.claude/docs/archive/pre-control-plane/`
- AC-X2-08: `$WORKSPACE_ROOT/agent-os/.claude/settings.local.json` exists, contains valid JSON with permissions configuration, and contains NO credentials (no database URLs, no passwords, no secrets, no project-specific absolute paths from the source file)
- AC-X2-09: `npm install` succeeds in `$WORKSPACE_ROOT/agent-os/` (exit code 0, node_modules/ populated)
- AC-X2-10: `npm test` passes all tests in `$WORKSPACE_ROOT/agent-os/` (all tests pass, 0 failures)
- AC-X2-11: `$WORKSPACE_ROOT/agent-os/` contains exactly one git commit (fresh history); commit message references X2 extraction
- AC-X2-12: No PFNZ-STAYS files present in `$WORKSPACE_ROOT/agent-os/`: no app/, components/, lib/, prisma/, public/, types/, scripts/, mcp/, .env*, next.config.mjs, tailwind.config.ts, middleware.ts, vercel.json, capacitor.config.ts, or any root-level pfnz config files. No .claude/launch.json. No source .claude/settings.local.json (which contains credentials).

### Expected Return

Forge Step Report with:
- Workspace root location (confirmed $WORKSPACE_ROOT path)
- File copy summary (directories copied, file counts)
- package.json diff (source vs. amended)
- npm install result
- Test run result (pass count, fail count)
- git log output showing single initial commit
- Negative check evidence (absence of PFNZ-STAYS files)

### Trade-Off Notes

**T1: Copy-not-move vs. move-and-symlink**
Chosen: Copy-not-move. Files are copied from the current repo to agent-os standalone. The current repo is not modified.
Alternative: Move files out of current repo and symlink back. This would make X3 simpler but would modify the current repo's working tree, potentially breaking the active governance chain (we're still executing X2 from this repo).
Why this is acceptable: The duplication is temporary — X3 removes agent-os/ from the current repo. The copy approach is safe, reversible, and doesn't disrupt the active working environment.

**T2: Governance file snapshot vs. post-extraction update**
Chosen: Copy governance files as-is (snapshot at extraction time). No modifications to SYSTEM_STATE.md, CURRENT_FOCUS.md, etc. in the new repo.
Alternative: Update governance files in agent-os to reflect a "post-extraction" state (reset ACTIVE_SLICE to NONE, etc.).
Why this is acceptable: The governance files accurately record the system's history. After X4 (parallel operation validation), agent-os will begin its own governance lifecycle and naturally update these files. Modifying them during extraction would introduce out-of-scope changes and risk inconsistency.

**T3: Workspace root location as principal decision**
The architecture does not fix the workspace root path. It uses $WORKSPACE_ROOT as a placeholder. The principal should choose a location that works for their development environment. This is a filesystem preference, not an architectural decision.
Recommendation: `C:\Users\Cyronick\Documents\pestfree-workspace\` — creates a clean workspace directory at a sibling level to the current repo.

### Evolution Constraints

- After X2, the current repo and agent-os repo both contain Agent OS files (temporary duplication). This duplication is resolved in X3 when agent-os/ is removed from the current repo.
- The workspace root's `pest-free-nz` workspace entry will not resolve until X3 moves the current repo into the workspace root. `npm install` from the workspace root will warn about the missing directory. This is expected and non-blocking.
- Post-X4, amendments to shared files (dispatch commands, identity files) must be applied to both repos in the same governed slice (per extraction manifest §4).

### Risks / Notes for Sentinel

- **TS-1 (CRITICAL):** Verify that `.claude/settings.local.json` in the agent-os repo does NOT contain any credentials from the source file (database URLs, passwords, API keys). The source file contains production Supabase credentials.
- **TS-2:** Verify copy-not-move invariant: no files deleted, moved, or modified in the current repository by X2 operations.
- **TS-3:** Verify governance file byte-identity: DECISION_LOG.md, SLICE_LEDGER.md, and all identity files must be byte-identical between source and agent-os copy (no content modifications during extraction).
- **TS-4:** Verify no EXCLUDED or PFNZ-STAYS files leaked into agent-os repo (AC-X2-12 negative check).
- **TS-5:** Verify agent-os .gitignore includes node_modules/ and dist/ (inherited from source — prevents accidental credential or binary commits).

### Validation Notes for Compass

- AC-X2-01: Read $WORKSPACE_ROOT/package.json; verify exact JSON content.
- AC-X2-02: Forge must provide `git -C ... status` output.
- AC-X2-03: Forge must provide directory listing or file count evidence for each engine directory.
- AC-X2-04: Forge must provide listing of review-artifacts/ in the new location.
- AC-X2-05: Forge must provide the full package.json content showing all required fields.
- AC-X2-06: Forge must provide evidence of governance file presence — listing of .claude/ tree in agent-os; explicit negative check for launch.json and source settings.local.json.
- AC-X2-07: Forge must provide listing showing 4 files in archive/pre-control-plane/.
- AC-X2-08: Forge must provide full content of agent-os .claude/settings.local.json for credential audit.
- AC-X2-09: Forge must provide npm install output (exit code).
- AC-X2-10: Forge must provide test output showing pass/fail count.
- AC-X2-11: Forge must provide `git log --oneline` output showing single commit.
- AC-X2-12: Forge must provide negative check evidence — e.g., `ls $WORKSPACE_ROOT/agent-os/app/ 2>/dev/null` returning empty.

### Procedure — Recommended Execution Order

This section is advisory — Forge may reorder within the Fixed constraints above.

1. **Create workspace root directory** at $WORKSPACE_ROOT
2. **Write workspace root package.json**
3. **Create agent-os directory structure** — mkdir -p for .claude/ subdirectories, archive/pre-control-plane/
4. **Copy engine files** — `cp -r` for each AGENT-OS-ENGINE directory from current agent-os/ to $WORKSPACE_ROOT/agent-os/
5. **Copy governance files** — `cp -r` for each .claude/ subdirectory to $WORKSPACE_ROOT/agent-os/.claude/
6. **Copy pre-control-plane boot files** to archive/pre-control-plane/
7. **Write agent-os package.json** (new, with amended fields)
8. **Write agent-os .claude/settings.local.json** (new, clean)
9. **Remove PFNZ-STAYS files** that may have been accidentally copied (launch.json, source settings.local.json)
10. **npm install** in $WORKSPACE_ROOT/agent-os/
11. **npm test** — verify all tests pass
12. **git init** in $WORKSPACE_ROOT/agent-os/
13. **git add . && git commit** with X2 extraction message
14. **Generate evidence** for Step Report (file listings, test output, git log)

---

RISKS FOR COMMAND:

1. **Workspace root location ($WORKSPACE_ROOT) must be confirmed by the principal before Forge dispatch.** The architecture uses a placeholder. Recommended: `C:\Users\Cyronick\Documents\pestfree-workspace\`. This is a principal decision, not architectural.

2. **Segmentation assessment:** ~150 file operations (mostly bulk cp -r). Single segment is feasible with bulk copy commands. However, if Forge hits context limits during the copy-verify-test-commit cycle, Command should be prepared to segment into S1 (copies + config) and S2 (npm install + tests + git init). Per §15.6, this is Command's determination.

3. **settings.local.json credential risk (Sentinel TS-1):** The source settings.local.json at `.claude/settings.local.json` contains production Supabase database credentials (line 32). The architecture explicitly prohibits copying this file and specifies a clean replacement. Sentinel must verify this is enforced. If Forge copies the file by accident (e.g., via `cp -r .claude/ ...`), credentials will be committed to the agent-os repo's git history.

4. **Test count may differ:** The 1398 count is from R3 closure. If tests have been added since (visible in git status as new untracked test files), the count may be higher. AC-X2-10 should be evaluated as "all tests pass" rather than strictly "exactly 1398."

5. **package-lock.json:** The source package-lock.json is copied but npm install in the new location will regenerate it based on the amended package.json name. The final package-lock.json may differ from the source. This is expected and correct.

OUTPUT CONTRACT FULFILLED: YES
---
