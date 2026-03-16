# X1 — Extraction Manifest

**Version:** 1.0
**Status:** Atlas submission — awaiting Command review
**Date:** 2026-03-16
**Slice:** X1 — Extraction Readiness Audit

---

## 1. Extraction Model Summary

**Confirmed model:** Two separate git repositories.

| Property | Value |
|----------|-------|
| Current repo | Becomes `pest-free-nz` — app code stays in place |
| agent-os/ | Extracted to standalone git repo |
| Local dev integration | npm workspace root links both as siblings |
| Production integration | Published npm package (future) |
| Git history for agent-os | **Fresh repo** (see §9 for rationale) |
| Git history for pest-free-nz | Retains full current history |

---

## 2. File Disposition — Complete Classification

### 2.1 Root-Level Files

| File | Disposition | Notes |
|------|------------|-------|
| `package.json` | PFNZ-STAYS | PestFree NZ Next.js app dependencies. Remove agent-os references if any after extraction. |
| `package-lock.json` | PFNZ-STAYS | Regenerated after extraction |
| `tsconfig.json` | PFNZ-STAYS | Add `agent-os` to exclude array after extraction (currently `**/*.ts` captures agent-os/) |
| `next.config.mjs` | PFNZ-STAYS | Next.js config |
| `tailwind.config.ts` | PFNZ-STAYS | Tailwind config |
| `postcss.config.mjs` | PFNZ-STAYS | PostCSS config |
| `capacitor.config.ts` | PFNZ-STAYS | Capacitor mobile config |
| `.eslintrc.json` | PFNZ-STAYS | ESLint config |
| `middleware.ts` | PFNZ-STAYS | Next.js middleware |
| `instrumentation.ts` | PFNZ-STAYS | Sentry instrumentation |
| `next-env.d.ts` | PFNZ-STAYS | Next.js type declarations |
| `vitest.config.ts` | PFNZ-STAYS | Vitest config for pfnz tests |
| `vercel.json` | PFNZ-STAYS | Vercel deployment config |
| `sentry.client.config.ts` | PFNZ-STAYS | Sentry client config |
| `sentry.server.config.ts` | PFNZ-STAYS | Sentry server config |
| `sentry.edge.config.ts` | PFNZ-STAYS | Sentry edge config |
| `.gitignore` | PFNZ-STAYS | Update: remove agent-os-specific entries after extraction |
| `.env.example` | PFNZ-STAYS | PestFree NZ env template |
| `.env.local` | EXCLUDED | Gitignored, local environment |
| `.env.production` | PFNZ-STAYS | Production env (currently untracked — listed in git status as `??`) |
| `README.md` | PFNZ-STAYS | Update to reflect post-extraction state |
| `AGENTS.md` | AGENT-OS-GOVERNANCE | Pre-control-plane agent contracts — historical, moves with Agent OS |
| `FORGE_BOOT.md` | AGENT-OS-GOVERNANCE | Pre-control-plane boot file — historical, moves with Agent OS |
| `SENTINEL_BOOT.md` | AGENT-OS-GOVERNANCE | Pre-control-plane boot file — historical, moves with Agent OS |
| `COMPASS_BOOT.md` | AGENT-OS-GOVERNANCE | Pre-control-plane boot file — historical, moves with Agent OS |
| `cmd_msg.json` | EXCLUDED | Transient artifact (untracked, listed as `??` in git status) — delete |
| `relay_review-*.tar.gz` | EXCLUDED | Gitignored relay artifact |
| `tsconfig.tsbuildinfo` | EXCLUDED | Gitignored build cache |

### 2.2 Application Directories — PFNZ-STAYS

All of these stay in the current repo (pest-free-nz) unchanged:

| Directory | Disposition | Content |
|-----------|------------|---------|
| `app/` | PFNZ-STAYS | Next.js pages and API routes (36 subdirectories) |
| `components/` | PFNZ-STAYS | React components |
| `lib/` | PFNZ-STAYS | Shared utilities (auth, email, encryption, prisma, etc.) |
| `prisma/` | PFNZ-STAYS | Database schema and migrations |
| `public/` | PFNZ-STAYS | Static assets |
| `types/` | PFNZ-STAYS | TypeScript type definitions |
| `scripts/` | PFNZ-STAYS | Utility scripts (seed, pre-submission check, PDF generation) |
| `tests/` | PFNZ-STAYS | PestFree NZ API tests (vitest) |
| `docs/` | PFNZ-STAYS | Product documentation (DB setup, nav redesign, product spine) |

### 2.3 Infrastructure Directories

| Directory | Disposition | Notes |
|-----------|------------|-------|
| `.git/` | PFNZ-STAYS | Current repo retains git history. Agent-os gets fresh repo. |
| `.github/` | PFNZ-STAYS | CI workflow (`ci.yml`) — pfnz specific. Agent-os creates own CI later. |
| `.next/` | EXCLUDED | Build output, gitignored |
| `.vercel/` | EXCLUDED | Vercel project config, gitignored |
| `.foreman/` | EXCLUDED | Gitignored runtime output (directory is empty) |
| `node_modules/` | EXCLUDED | Dependencies, gitignored |
| `runs/` | EXCLUDED | Gitignored runtime artifacts |
| `review-artifacts/` | AGENT-OS-ENGINE | Agent OS review artifacts from governed runs — moves with engine |
| `mcp/` | PFNZ-STAYS | MCP agent-router subproject — see §2.6 for detail |

### 2.4 Agent OS Directory — AGENT-OS-ENGINE

The entire `agent-os/` directory moves to the standalone repo:

| Path | Disposition | File Count |
|------|------------|------------|
| `agent-os/src/` | AGENT-OS-ENGINE | ~80 TypeScript source files (adapter, approval, cli, dispatcher, memory, planner, relay, runtime, step-report) |
| `agent-os/__tests__/` | AGENT-OS-ENGINE | ~10 test files |
| `agent-os/tests/` | AGENT-OS-ENGINE | ~10 test files (memory-retrieval, embedding, vector-search, etc.) |
| `agent-os/src/*/\__tests__/` | AGENT-OS-ENGINE | ~15 in-source test files |
| `agent-os/docs/` | AGENT-OS-ENGINE | Architecture and governance docs |
| `agent-os/schemas/` | AGENT-OS-ENGINE | SQL migration schemas |
| `agent-os/core/` | AGENT-OS-ENGINE | .gitkeep placeholder |
| `agent-os/governance/` | AGENT-OS-ENGINE | .gitkeep placeholder |
| `agent-os/memory/` | AGENT-OS-ENGINE | .gitkeep placeholder |
| `agent-os/planner/` | AGENT-OS-ENGINE | .gitkeep placeholder |
| `agent-os/runtime/` | AGENT-OS-ENGINE | .gitkeep placeholder |
| `agent-os/package.json` | AGENT-OS-ENGINE | Rename to `@agent-os/core` during X2 |
| `agent-os/package-lock.json` | AGENT-OS-ENGINE | Moves with package.json |
| `agent-os/tsconfig.json` | AGENT-OS-ENGINE | Standalone TypeScript config |
| `agent-os/.gitignore` | AGENT-OS-ENGINE | Agent OS gitignore |

### 2.5 Governance Tree — `.claude/`

| Path | Disposition | Notes |
|------|------------|-------|
| `.claude/commands/dispatch/atlas.md` | AGENT-OS-GOVERNANCE | Dispatch command — see §4 for sharing model |
| `.claude/commands/dispatch/forge.md` | AGENT-OS-GOVERNANCE | Dispatch command |
| `.claude/commands/dispatch/sentinel.md` | AGENT-OS-GOVERNANCE | Dispatch command |
| `.claude/commands/dispatch/compass.md` | AGENT-OS-GOVERNANCE | Dispatch command |
| `.claude/commands/govern/activate-slice.md` | AGENT-OS-GOVERNANCE | Governance command |
| `.claude/commands/govern/close-slice.md` | AGENT-OS-GOVERNANCE | Governance command |
| `.claude/commands/govern/plan.md` | AGENT-OS-GOVERNANCE | Planning command |
| `.claude/commands/review/submission.md` | AGENT-OS-GOVERNANCE | Review protocol |
| `.claude/docs/agents/COMMAND_ID.md` | AGENT-OS-GOVERNANCE | Agent identity — see §5 |
| `.claude/docs/agents/ATLAS_ID.md` | AGENT-OS-GOVERNANCE | Agent identity |
| `.claude/docs/agents/FORGE_ID.md` | AGENT-OS-GOVERNANCE | Agent identity |
| `.claude/docs/agents/SENTINEL_ID.md` | AGENT-OS-GOVERNANCE | Agent identity |
| `.claude/docs/agents/COMPASS_ID.md` | AGENT-OS-GOVERNANCE | Agent identity |
| `.claude/docs/architecture/*.md` | AGENT-OS-GOVERNANCE | Architecture specs |
| `.claude/docs/governance/CONTROL_PLANE_OPERATING_MODEL.md` | AGENT-OS-GOVERNANCE | Governance model |
| `.claude/docs/ops/SYSTEM_STATE.md` | AGENT-OS-GOVERNANCE | System state |
| `.claude/docs/ops/CURRENT_FOCUS.md` | AGENT-OS-GOVERNANCE | Current focus |
| `.claude/docs/ops/ACTIVE_SLICE.md` | AGENT-OS-GOVERNANCE | Active slice |
| `.claude/docs/ops/SLICE_STATUS.md` | AGENT-OS-GOVERNANCE | Slice status |
| `.claude/docs/ops/NEXT_ACTION.md` | AGENT-OS-GOVERNANCE | Next action |
| `.claude/docs/ops/OPEN_ISSUES.md` | AGENT-OS-GOVERNANCE | Open issues |
| `.claude/docs/ops/AGENT_QUEUE.md` | AGENT-OS-GOVERNANCE | Agent queue |
| `.claude/docs/ops/ATLAS_LATEST.md` | AGENT-OS-GOVERNANCE | Operative architecture |
| `.claude/docs/ops/COMMAND_DECISION.md` | AGENT-OS-GOVERNANCE | Command decision |
| `.claude/docs/ops/DECISION_LOG.md` | AGENT-OS-GOVERNANCE | Decision log |
| `.claude/docs/ops/SLICE_LEDGER.md` | AGENT-OS-GOVERNANCE | Slice ledger |
| `.claude/docs/ops/PENDING_ATLAS.md` | AGENT-OS-GOVERNANCE | Atlas pending |
| `.claude/docs/ops/PENDING_FORGE.md` | AGENT-OS-GOVERNANCE | Forge pending |
| `.claude/docs/ops/PENDING_SENTINEL.md` | AGENT-OS-GOVERNANCE | Sentinel pending |
| `.claude/docs/ops/PENDING_COMPASS.md` | AGENT-OS-GOVERNANCE | Compass pending |
| `.claude/docs/ops/extraction-manifest.md` | AGENT-OS-GOVERNANCE | This file |
| `.claude/docs/ops/MASTER_AGENT_CONFIG.md` | AGENT-OS-GOVERNANCE | Agent config |
| `.claude/docs/ops/COMMAND_PROFILE_ADDENDUM_CTRL_S2.md` | AGENT-OS-GOVERNANCE | Historical addendum |
| `.claude/docs/ops/SYSTEM_STATE_ARCHIVE_2026-03-11.md` | AGENT-OS-GOVERNANCE | Archived state |
| `.claude/docs/ops/archive/INDEX.md` | AGENT-OS-GOVERNANCE | Archive index |
| `.claude/docs/archive/COMMAND_CHAT_BOOT_MANIFEST.md` | AGENT-OS-GOVERNANCE | Archived CTRL-S5 file |
| `.claude/docs/archive/COMMAND_CHAT_ID.md` | AGENT-OS-GOVERNANCE | Archived CTRL-S5 file |
| `.claude/docs/archive/COMMAND_CODE_ID.md` | AGENT-OS-GOVERNANCE | Archived CTRL-S5 file |
| `.claude/docs/archive/INDEX.md` | AGENT-OS-GOVERNANCE | Archive index |
| `.claude/docs/chains/TEMPLATE.md` | AGENT-OS-GOVERNANCE | Chain context template |
| `.claude/docs/chains/AS-2.md` | AGENT-OS-GOVERNANCE | Chain context — A-Series |
| `.claude/docs/chains/B-1.md` | AGENT-OS-GOVERNANCE | Chain context — B-Series |
| `.claude/docs/chains/B-2.md` | AGENT-OS-GOVERNANCE | Chain context — B-Series |
| `.claude/docs/chains/X1.md` | AGENT-OS-GOVERNANCE | Chain context — X-Series (active) |
| `.claude/docs/chains/archive/B-1.md` | AGENT-OS-GOVERNANCE | Archived chain |
| `.claude/docs/orchestration/*.md` | AGENT-OS-GOVERNANCE | Pre-control-plane orchestration files (9 files) — historical, moves with Agent OS |
| `.claude/launch.json` | PFNZ-STAYS | Claude Code launch config — project-specific |
| `.claude/settings.local.json` | PFNZ-STAYS | Claude Code local settings — project-specific |

### 2.6 MCP Agent Router

| Path | Disposition | Notes |
|------|------------|-------|
| `mcp/agent-router/` | PFNZ-STAYS | This is a PestFree NZ-specific MCP subproject. It contains early Foreman prototype code that predates Agent OS. While historically related, it is a pfnz application concern. It has its own package.json, .gitignore, and is self-contained. No imports from agent-os/src/. Stays in pfnz. |

---

## 3. Boundary Analysis — Cross-Boundary Imports

### 3.1 agent-os/src/ → external

**Zero cross-boundary imports found.**

All imports in `agent-os/src/` are either:
- Relative imports within agent-os/src/ (e.g., `../../step-report/stepReport.schema.js`)
- Node built-in modules

No file in `agent-os/src/` imports from the root app (`app/`, `lib/`, `components/`, etc.), `mcp/`, or any other directory outside `agent-os/`.

### 3.2 Root app → agent-os/

**Zero cross-boundary imports found.**

No file in `app/`, `lib/`, `components/`, `tests/`, `scripts/`, or any other root-level directory imports from `agent-os/src/`.

### 3.3 Root tsconfig.json Boundary Issue

The root `tsconfig.json` uses `"include": ["**/*.ts", "**/*.tsx"]` without excluding `agent-os/`. This means `tsc --noEmit` from the root currently type-checks agent-os files. After extraction:
- **pfnz tsconfig.json** must add `"agent-os"` to its exclude array (or this becomes moot once agent-os/ is physically removed from the directory)
- **agent-os tsconfig.json** is already self-contained — no changes needed

**Impact:** After `agent-os/` directory is physically removed from the pest-free-nz repo, the tsconfig issue resolves naturally. No action required in X2 for pfnz tsconfig.

---

## 4. Dispatch Command Model — Recommendation

### Ruling: Shared Canonical Source — No Duplication

**Recommendation:** Dispatch commands, governance commands, review commands, and agent identity files are **project-agnostic**. They should live in one canonical location (the agent-os repo) and be shared, not duplicated.

**Analysis of current dispatch command content:**

Every dispatch command (`atlas.md`, `forge.md`, `sentinel.md`, `compass.md`) contains:
1. Boot sequence (read identity file → read governance files → stale-content checks)
2. Operating constraints (agent role boundaries)
3. Scope constraints (permitted/prohibited tools)
4. Chain context injection instruction
5. Continuation context protocol
6. Output contract (STATUS, SUMMARY, KEY DECISIONS, OUTPUT, RISKS, OUTPUT CONTRACT FULFILLED)
7. Task subagent return format
8. Review protocol reference

**None of these are project-specific.** The project-specific context (what the agent is working on, which files to modify, what architecture to implement) is conveyed entirely through `$ARGUMENTS` at dispatch time. The dispatch command files define *how the agent operates*; the task arguments define *what the agent works on*.

The Core Protocol / Project Scope inheritance model proposed in the X-Series plan would require maintaining identical copies of ~95% of each file across both repos, with Sentinel review discipline as the only enforcement mechanism. This creates permanent governance tax with no functional benefit.

**Mechanism:** After extraction, pest-free-nz launches Claude Code from its own directory. Claude Code loads `.claude/` from the working directory. For pfnz to use Agent OS dispatch commands, it needs them in its own `.claude/commands/` directory.

**Recommended approach — Minimal duplication:**
Each pfnz dispatch command is a **thin wrapper** containing only:
1. One line: the instruction to read the full dispatch command from the agent-os repo
2. The `$ARGUMENTS` passthrough

But this introduces a dependency on agent-os being co-located. A simpler approach:

**Final recommendation — Full copy with governance rule:**
- pfnz gets a **complete copy** of all dispatch commands and identity files at X3 bootstrap time
- A governance invariant (enforced by Sentinel) prohibits pfnz from modifying these files independently
- When Agent OS amends a dispatch command, the same amendment is applied to pfnz in the same governed slice (Cross-Repo Change Classification: REQUIRES-PFNZ-PORT)
- **No Core Protocol / Project Scope section split.** Files are identical. The split adds complexity with no benefit since no content is actually project-specific.

**Governance tax assessment:** This is lighter than the inheritance model because:
- No file needs to be maintained in two different formats
- Sentinel checks are simple: "are these files byte-identical?" vs. "is the Core Protocol section identical while Project Scope differs?"
- The amendment flow is straightforward: copy the exact same change

**Trade-off:** Silent drift remains possible if a pfnz amendment is applied without the corresponding agent-os amendment (or vice versa). Sentinel's comparison check catches this. The risk is operational, not structural.

---

## 5. Identity File Reference Model — Recommendation

### Ruling: Copy with Governance Rule (Same as Dispatch Commands)

The `node_modules` path approach is rejected per Command's finding B-4 (unreliable: npm excludes dotfiles, workspace symlinks vary across platforms, Claude Code reads from working directory).

**Recommended mechanism:** Agent identity files (`COMMAND_ID.md`, `ATLAS_ID.md`, `FORGE_ID.md`, `SENTINEL_ID.md`, `COMPASS_ID.md`) are copied to `pest-free-nz/.claude/docs/agents/` at X3 bootstrap time.

**Governance rule:** Same as dispatch commands — Sentinel verifies byte-identity with canonical agent-os versions. Agent OS is the canonical source. pfnz amendments to identity files are prohibited (Sentinel HIGH finding). When Agent OS amends an identity file, the same amendment is applied to pfnz.

**Rationale:**
- Claude Code dispatch commands reference identity files by path (e.g., `.claude/docs/agents/ATLAS_ID.md`). This path must resolve from the working directory.
- There is no reliable cross-repo file reference mechanism in Claude Code.
- Copying with a governance rule is the simplest mechanism that works.
- The alternative (symlinks, npm package file inclusion) introduces platform-specific fragility.

---

## 6. Workspace Root Governance — Recommendation

### Ruling: Prohibit with Documentation

**Recommendation:** Do not design governance for the workspace root. Prohibit launching Claude Code from the workspace root.

**Rationale:**
- The workspace root exists solely for npm workspace package resolution. It has a `package.json` with a `workspaces` field. It has no application code, no governance tree, and no project context.
- Claude Code launched from the workspace root would find no `.claude/` directory, no governance files, and no project context. This is not a useful operating position.
- Designing a governance tree for the workspace root adds complexity with no functional benefit.
- The workspace root `package.json` is a single-purpose file (workspace links). It does not need governance.

**Implementation:** Document in both repos' governance files that the workspace root is not a valid Claude Code launch point. Include this in the parallel operation protocol (X4 deliverable).

**Workspace root structure:**
```
/ (workspace root — NOT a Claude Code launch point)
  package.json          ← { "workspaces": ["agent-os", "pest-free-nz"] }
  agent-os/             ← Launch Claude Code here for Agent OS work
  pest-free-nz/         ← Launch Claude Code here for PestFree NZ work
```

---

## 7. Cross-Repository Change Classification — Recommendation

### Ruling: Required Only on Shared-Surface Slices

**Recommendation:** The Cross-Repo Impact field is required **only** on Agent OS slices that amend files which have pfnz copies (dispatch commands, identity files, governance commands, review commands). It is not required on slices that touch only agent-os-internal files (TypeScript source, agent-os-only governance state files, test files).

**Rationale:**
- The 80% case for Agent OS slices is TypeScript engine work (R-Series, future runtime slices). These have zero pfnz impact — requiring a classification field adds nothing.
- The 20% case is governance infrastructure work (B-Series, future protocol amendments). These touch shared-surface files and genuinely need impact classification.
- Atlas is well-positioned to identify shared-surface slices at architecture time. If Atlas determines a slice touches shared files, Atlas adds the field. If not, no field is needed.

**Enforcement:**
- Atlas adds Cross-Repo Impact field when the slice scope includes any file listed as AGENT-OS-GOVERNANCE with a pfnz copy.
- Sentinel flags the absence of the field **only** when the slice scope includes shared-surface files.
- For engine-only slices, the field is not required and its absence is not a finding.

---

## 8. X4 Scope — Recommendation

### Ruling: Command Operational Validation with Sentinel/Compass Confirmation

**Recommendation:** X4 is not a governed implementation slice. It is a **Command operational validation** — Command executes the validation, Sentinel confirms clean separation, Compass confirms ACs are met.

**Rationale:**
- X4 does not produce implementation artifacts. It produces validation evidence.
- The "dry-run dispatch" described in X4 is Command testing its own operational capability, not an agent producing a deliverable.
- A full Atlas → Forge → Sentinel → Compass chain is overhead for a validation activity that Command can execute directly.
- The parallel operation protocol document is a Command deliverable, not an Atlas architecture → Forge implementation deliverable.

**Dispatch sequence for X4:** Command executes validation → dispatches Sentinel for separation review → dispatches Compass for AC verification → Command accepts.

**X4 is still a governed slice.** It has acceptance criteria, Sentinel review, and Compass validation. It just doesn't need Atlas architecture or Forge implementation.

---

## 9. Git History — Recommendation

### Ruling: Fresh Repo for Agent-OS

**Recommendation:** The agent-os standalone repository is initialized as a **fresh git repo** with the extracted files committed as an initial commit.

**Rationale:**
- `git subtree split` or `git filter-branch` is complex, error-prone, and produces a history that mixes agent-os commits with pfnz commits (since both were developed in the same repo with interleaved commits).
- Agent OS's meaningful history is preserved in its governance files: SYSTEM_STATE.md, DECISION_LOG.md, SLICE_LEDGER.md, chain context documents, and archived architecture packs. These files move with the extraction and provide complete traceability.
- A clean initial commit with a message like "Initial extraction from PestFree NZ host repository — X2" is simpler, cleaner, and more useful than a filtered history.
- The original repo (pest-free-nz) retains the full git history including all agent-os development. Nothing is lost — it's just in the pest-free-nz repo history.

**Trade-off:** `git blame` on agent-os files will show only the extraction commit as the author. For governed files, this is acceptable — the governance audit trail (DECISION_LOG.md) is the authoritative history, not git blame.

---

## 10. npm Workspace Model — Exact Structure

### Workspace Root

```json
// workspace-root/package.json
{
  "private": true,
  "workspaces": ["agent-os", "pest-free-nz"]
}
```

### Agent OS Package

```json
// agent-os/package.json (amended from current)
{
  "name": "@agent-os/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Agent OS — governed multi-agent execution engine",
  "scripts": {
    "test": "node --import tsx --test [existing test file list]",
    "validate": "tsx src/cli.ts validate"
  },
  "bin": {
    "agent-os": "./src/cli.ts"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

Key changes from current:
- `name`: `@pfnz/agent-os` → `@agent-os/core`
- `version`: `1.0.0` → `0.1.0` (pre-extraction, reflect true maturity)
- `description`: Updated to project-agnostic

### PestFree NZ Package

```json
// pest-free-nz/package.json (current root package.json, minor update)
{
  "name": "pestfree-nz",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@agent-os/core": "*",
    // ... existing dependencies
  }
  // ... rest unchanged
}
```

Key change: Add `"@agent-os/core": "*"` to dependencies. The `*` resolves to the workspace version during local dev. For production (future), this becomes a specific version number.

**Note:** PestFree NZ does not currently import anything from agent-os in its application code (§3.2). The dependency declaration is structural preparation for when pfnz application code needs Agent OS engine capabilities.

### Physical Directory Layout

```
workspace-root/
├── package.json                 ← workspace root (NEW)
├── agent-os/
│   ├── .claude/                 ← Agent OS governance (MOVED from root .claude/)
│   │   ├── commands/
│   │   ├── docs/
│   │   └── settings.local.json  (NEW — agent-os specific)
│   ├── src/                     ← unchanged
│   ├── __tests__/               ← unchanged
│   ├── tests/                   ← unchanged
│   ├── docs/                    ← unchanged
│   ├── schemas/                 ← unchanged
│   ├── package.json             ← amended (name, version)
│   ├── tsconfig.json            ← unchanged
│   └── .gitignore               ← unchanged
└── pest-free-nz/
    ├── .claude/                 ← PestFree NZ governance (NEW — clean slate)
    │   ├── commands/            ← copies of Agent OS commands
    │   ├── docs/
    │   └── settings.local.json  (current root .claude/settings.local.json)
    ├── app/                     ← unchanged
    ├── components/              ← unchanged
    ├── lib/                     ← unchanged
    ├── prisma/                  ← unchanged
    ├── public/                  ← unchanged
    ├── types/                   ← unchanged
    ├── tests/                   ← unchanged
    ├── scripts/                 ← unchanged
    ├── docs/                    ← unchanged
    ├── mcp/                     ← unchanged
    ├── package.json             ← amended (add @agent-os/core dep)
    ├── tsconfig.json            ← unchanged (agent-os/ no longer present)
    └── .gitignore               ← updated (remove agent-os entries)
```

---

## 11. Test Suite Integrity Assessment

**Agent OS test suite:** 1398/1398 tests currently pass (per R3 closure, CURRENT_FOCUS.md).

**Structural obstacles to passing in new location:** None identified.

- All agent-os tests use relative imports within agent-os/src/ — no path breakage
- agent-os has its own `tsconfig.json` — no dependency on root config
- agent-os has its own `package.json` with its own `tsx` test runner — fully self-contained
- No agent-os test imports anything from outside agent-os/

**Verification required in X2:** Forge must run `npm test` in the extracted agent-os directory and confirm all tests pass. This is AC-X2-4 (in the X-Series plan, referenced as "Full Agent OS test suite passes").

---

## 12. Amended X-Series Slice Plan

Based on this audit, the X-Series slice plan is updated:

| Slice | Dispatch Sequence | Scope |
|-------|------------------|-------|
| X1 | Atlas → Sentinel → Compass | Extraction manifest (this document) |
| X2 | Atlas → Forge → Sentinel → Compass | Physical extraction: create workspace root, initialize agent-os repo, move files, move governance tree, confirm test suite, update package.json files |
| X3 | Atlas → Forge → Sentinel → Compass | PestFree NZ bootstrap: create pfnz .claude/ tree (clean slate), copy dispatch/identity files, create pfnz CONTROL_PLANE variant, remove agent-os/ from pfnz repo, update pfnz .gitignore and package.json |
| X4 | Command → Sentinel → Compass | Parallel operation validation: boot both repos, dry-run dispatch, confirm no crossover, document parallel operation protocol |

### X-Series scope change from original plan:
- **Dispatch command model:** Full copy with governance rule (no Core Protocol / Project Scope split)
- **Identity file model:** Copy with governance rule (no node_modules reference)
- **Cross-Repo Classification:** Required only on shared-surface slices (not every .claude/-touching slice)
- **X4 dispatch:** Command operational validation (no Atlas → Forge chain)

---

## 13. Resolved Ambiguities

All potentially ambiguous items have been resolved:

| Item | Resolution | Rationale |
|------|-----------|-----------|
| `AGENTS.md` (root) | AGENT-OS-GOVERNANCE | Pre-control-plane agent contracts. Historical Agent OS artifact. |
| `FORGE_BOOT.md`, `SENTINEL_BOOT.md`, `COMPASS_BOOT.md` (root) | AGENT-OS-GOVERNANCE | Pre-control-plane boot files. Historical Agent OS artifacts. |
| `cmd_msg.json` (root) | EXCLUDED | Transient, untracked artifact. Delete during extraction. |
| `.claude/launch.json` | PFNZ-STAYS | Claude Code project launch config — project-specific. Agent-os creates its own. |
| `.claude/settings.local.json` | PFNZ-STAYS | Claude Code local settings — project-specific. Agent-os creates its own. |
| `.claude/docs/orchestration/` (9 files) | AGENT-OS-GOVERNANCE | Pre-control-plane orchestration files. Historical Agent OS governance artifacts. |
| `mcp/agent-router/` | PFNZ-STAYS | Early Foreman prototype, pfnz-specific MCP subproject. No cross-boundary imports. |
| `review-artifacts/` | AGENT-OS-ENGINE | Agent OS review artifacts from governed runs. |
| `runs/` | EXCLUDED | Gitignored runtime output. |
| `.env.production` | PFNZ-STAYS | PestFree NZ production environment config. |
| Root `tsconfig.json` include/exclude | PFNZ-STAYS | Agent-os/ removal resolves naturally; no amendment needed. |

**AMBIGUOUS items remaining: ZERO.**

---
