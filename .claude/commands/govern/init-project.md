You are Command, executing the Project Initialization protocol.

Task: $ARGUMENTS

---

## Project Initialization Protocol

This protocol initializes a new project under Agent OS governance. It creates the `agent-os.project.json` adapter file, scaffolds initial project structure, optionally links infrastructure (Supabase, Vercel), and records the initialization as a governed Express Lane slice.

Project initialization is Administrative-class work with no trust surfaces at the scaffolding stage. It uses the Express Lane pipeline (Command → Forge → Command review → Close).

---

## Step 1 — Parse Initialization Request

Extract from $ARGUMENTS:

- **Project name** (required) — human-readable name (e.g., "PestFree Dashboard")
- **Project slug** (required) — kebab-case identifier (e.g., "pestfree-dashboard")
- **Project type** (required) — one of the supported types below
- **Supabase project** (optional) — "create", "link:[project-ref]", or "none"
- **Vercel project** (optional) — "create", "link:[project-name]", or "none"
- **Target directory** (optional) — defaults to current working directory

### Supported Project Types

| Type | Description | Template basis |
|------|------------|----------------|
| `nextjs-supabase` | Next.js App Router + Supabase (auth, database, types) | `nextjs-supabase-page.md`, `supabase-migration.md` |
| `api-service` | Standalone API service with Supabase backend | `api-route.md`, `supabase-migration.md` |
| `edge-functions` | Supabase Edge Functions project | `edge-function.md` |
| `static-site` | Static site deployed to Vercel | `vercel-deployment.md` |
| `custom` | Minimal scaffolding — adapter file only | None |

If $ARGUMENTS does not specify a project type, ask the principal to clarify before proceeding.

---

## Step 2 — Validate Prerequisites

Before proceeding, verify:

1. **Target directory exists** and is writable
2. **No existing `agent-os.project.json`** in the target directory — if one exists, STOP and inform the principal (use `validate` CLI command to check the existing adapter instead)
3. **Git repository** — target directory should be inside a git repo (warn if not, but do not block)
4. **MCP availability** — if Supabase or Vercel integration is requested, verify MCP tools are accessible by making a read-only call (e.g., `list_projects`)

If any required prerequisite fails, inform the principal and do not proceed.

---

## Step 3 — Activate Initialization Slice

Record this initialization as a governed slice using Express Lane:

1. **Assign slice ID:** `INIT-[slug]` (e.g., `INIT-pestfree-dashboard`)

2. **Create chain context** at `.claude/docs/chains/INIT-[slug].md` using the Express variant template:
   - Task: "Initialize [project name] ([project type]) with Agent OS governance"
   - Governance class: Administrative (Express)
   - Required closure gates: Command review only

3. **Write governance state files:**
   - ACTIVE_SLICE.md → `INIT-[slug]`
   - SLICE_STATUS.md → APPROVED
   - CURRENT_FOCUS.md → project initialization context
   - NEXT_ACTION.md → "Forge: scaffold [project name] and create agent-os.project.json"
   - AGENT_QUEUE.md → Forge assigned

4. **Append to DECISION_LOG.md:**
   ```
   [ISO-8601] | Command | INIT-[slug] | express-activate | ACCEPTED | Project initialization: [project name] ([project type])
   ```

---

## Step 4 — Generate Adapter Configuration

Based on the project type, generate the `agent-os.project.json` content. This is the core deliverable.

### Base Adapter (all project types)

```json
{
  "schema_version": "1.0",
  "project": {
    "name": "[project name]",
    "slug": "[project slug]",
    "repo_root": "."
  },
  "paths": {
    "system_state": ".claude/docs/ops/SYSTEM_STATE.md",
    "run_root": ".claude/runs",
    "policy_allowlist": "src/policy/allowlist.ts"
  },
  "policy": {
    "allowlist_type": "ts_export_record",
    "export_name": "POLICY_ALLOWLIST",
    "actor_keys": ["command", "atlas", "forge", "sentinel", "compass"],
    "enforced_output_required_actions": ["step_report"]
  },
  "prompts": {
    "command": "v4.0",
    "atlas": "v3.1",
    "forge": "v3.1",
    "sentinel": "v3.1",
    "compass": "v3.1"
  },
  "models": {
    "command": "claude-opus-4-6",
    "atlas": "claude-opus-4-6",
    "forge": "claude-opus-4-6",
    "sentinel": "claude-opus-4-6",
    "compass": "claude-opus-4-6"
  },
  "governance": {
    "system_state_updates": {
      "mode": "hybrid",
      "require_manual_approval_for": ["trust_change"],
      "auto_apply_for": ["trivial"],
      "trust_change_triggers": {
        "paths_globs": ["src/auth/**", "src/policy/**", "supabase/migrations/**"],
        "keywords": ["rls", "policy", "auth", "token", "secret", "permission"],
        "action_names": ["apply_migration", "deploy_edge_function"],
        "always_require_sentinel_review_if_trust_change": true
      }
    }
  },
  "execution": {
    "test_command": "npm test"
  },
  "limits": {
    "max_steps_per_run": 25
  }
}
```

### Type-Specific Overrides

**`nextjs-supabase`:**
- `execution.build_command`: `"npm run build"`
- `execution.lint_command`: `"npm run lint"`
- `execution.deploy_command`: `"vercel --prod"`
- Add `"src/lib/supabase/**"` to trust_change_triggers.paths_globs

**`api-service`:**
- `execution.build_command`: `"npm run build"`
- `execution.test_command`: `"npm test"`

**`edge-functions`:**
- `execution.test_command`: `"deno test"`
- `paths.run_root`: `"supabase/functions/.runs"`

**`static-site`:**
- `execution.build_command`: `"npm run build"`
- `execution.deploy_command`: `"vercel --prod"`
- Remove Supabase-specific trust_change_triggers

**`custom`:**
- Use base adapter as-is; principal customizes afterward

---

## Step 5 — Dispatch Forge for Scaffolding

Dispatch Forge via `/dispatch/forge` with these directives:

### Forge Directive

```
Implement project initialization for [project name] ([project type]).

1. Create `agent-os.project.json` at the project root with the configuration specified below.

2. Scaffold initial project structure based on project type:
   [Type-specific scaffolding instructions — see below]

3. If Supabase integration is requested:
   - "create": Use `list_organizations` to find the org, then note that the principal should create the project via Supabase dashboard (MCP create_project requires cost confirmation)
   - "link:[ref]": Use `get_project` with the provided ref to verify it exists and is accessible

4. If Vercel integration is requested:
   - "create": Use `list_teams` to find the team, note project creation for principal
   - "link:[name]": Use `get_project` to verify it exists and is accessible

5. Create the policy allowlist file at the configured path with the 5 actor keys.

6. Create `.claude/runs/` directory (empty, for future run artifacts).
```

### Type-Specific Scaffolding

**`nextjs-supabase`:**
```
- Verify package.json exists (or create minimal one with next, react, @supabase/supabase-js)
- Create src/lib/supabase/server.ts (server client helper)
- Create src/lib/supabase/client.ts (browser client helper)
- Create src/lib/database.types.ts (placeholder — regenerate after first migration)
- Create src/policy/allowlist.ts with POLICY_ALLOWLIST export
```

**`api-service`:**
```
- Verify package.json exists (or create minimal one)
- Create src/policy/allowlist.ts with POLICY_ALLOWLIST export
```

**`edge-functions`:**
```
- Create supabase/functions/_shared/cors.ts (shared CORS helper)
- Create src/policy/allowlist.ts with POLICY_ALLOWLIST export
```

**`static-site`:**
```
- Verify package.json exists
- Create src/policy/allowlist.ts with POLICY_ALLOWLIST export
```

**`custom`:**
```
- Create src/policy/allowlist.ts with POLICY_ALLOWLIST export
- Create agent-os.project.json only — no other scaffolding
```

---

## Step 6 — Review Forge Submission

Execute the review protocol from `.claude/commands/review/submission.md`.

Verify:
1. `agent-os.project.json` was created and is valid against the schema
2. Policy allowlist file exists with correct export
3. Type-specific scaffolding is present
4. MCP verification calls succeeded (if applicable)
5. No trust surfaces were created or modified

If approved, proceed to Step 7. If rejected, issue correction and re-dispatch.

---

## Step 7 — Close Initialization Slice

Execute Express Lane closure:

1. Write closure ruling to **COMMAND_DECISION.md**
2. Append to **SLICE_LEDGER.md**:
   ```
   [ISO-8601] | INIT-[slug] | Administrative (Express) | ACCEPTED | Initialized [project name] ([project type]) | Sentinel: N/A (Express) | Compass: N/A (Express)
   ```
3. Append milestone to **SYSTEM_STATE.md**
4. Update governance state files (ACTIVE_SLICE → NONE, etc.)
5. Archive chain context
6. Append to **DECISION_LOG.md**:
   ```
   [ISO-8601] | Command | INIT-[slug] | express-close | ACCEPTED | Project initialization complete: [project name]
   ```
7. Append to **audit-log.jsonl**

---

## Step 8 — Initialization Report

Output a structured report:

```
PROJECT INITIALIZATION COMPLETE
================================
Project: [name] ([slug])
Type: [project type]
Adapter: agent-os.project.json (valid)
Slice: INIT-[slug] (ACCEPTED)

Files Created:
- agent-os.project.json
- [list all scaffolded files]

Infrastructure:
- Supabase: [linked / created / none]
- Vercel: [linked / created / none]

Next Steps:
- [Type-specific next steps, e.g., "Run first Supabase migration", "Configure environment variables"]
- Use /govern/plan to plan your first feature slice
- Use /govern/express for Administrative changes
- Use /govern/activate-slice for Implementation or Trust-critical work
```

---

## Reference

- Express Lane protocol: COMMAND_ID.md §41
- Project adapter schema: src/adapter/schema.ts
- Architecture templates: .claude/docs/architecture/templates/
- Adapter loader/validator: src/adapter/loadProjectAdapter.ts
