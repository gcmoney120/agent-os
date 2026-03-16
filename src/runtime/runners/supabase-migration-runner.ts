/**
 * Agent OS — Supabase Migration Runner (Phase 3B)
 *
 * Specialized StepRunner for Supabase database migrations.
 * Extends ForgeRunner with migration-specific logic:
 *   1. Apply migration via Supabase MCP
 *   2. Verify migration applied
 *   3. Regenerate TypeScript types
 *   4. Record migration result in step report
 *
 * This runner is used in programmatic runs where a plan step
 * specifies action "forge.migrate.supabase" or similar.
 *
 * In the governance layer (Claude Code slash commands), Forge handles
 * migrations directly via MCP tools. This runner provides the same
 * capability for the runtime execution engine.
 */

import type { FrozenStepContext } from "../../dispatcher/types.js";
import { BaseLLMRunner } from "./base.js";

export class SupabaseMigrationRunner extends BaseLLMRunner {
  protected get agentRole(): "forge" {
    return "forge";
  }

  protected getSystemPrompt(ctx: FrozenStepContext): string {
    return [
      "You are Forge, executing a Supabase database migration step.",
      "",
      "Your task is to apply a database migration to Supabase. Follow this sequence:",
      "",
      "1. **Pre-migration:**",
      "   - Review the migration SQL (provided in input)",
      "   - Verify RLS is enabled on any new tables",
      "   - Check that RLS policies are included",
      "",
      "2. **Apply migration:**",
      "   - Use Supabase MCP `apply_migration` to apply the SQL",
      "   - If apply_migration is unavailable, use `execute_sql` as fallback",
      "",
      "3. **Verify:**",
      "   - Use `list_migrations` to confirm migration was applied",
      "   - Use `list_tables` to verify new tables exist",
      "   - Use `execute_sql` with a test query to verify schema",
      "",
      "4. **Type generation:**",
      "   - Use `generate_typescript_types` to regenerate TypeScript types",
      "   - Record the output path for the types file",
      "",
      "5. **Report:**",
      "   - Include migration name, tables affected, RLS status, type generation result",
      "",
      "## Output Format",
      "Respond with a JSON step report in a ```json``` code block:",
      "```json",
      "{",
      '  "schema_version": "1.0",',
      `  "run_id": "${ctx.run_id}",`,
      `  "step_id": "${ctx.step_id}",`,
      `  "step_index": ${ctx.step_index},`,
      '  "actor": "forge",',
      `  "action": "${ctx.action}",`,
      '  "status": "succeeded",',
      '  "success": true,',
      '  "summary": "Migration applied and verified.",',
      '  "artifacts": {},',
      '  "output": {',
      '    "migration_name": "...",',
      '    "tables_created": [],',
      '    "tables_modified": [],',
      '    "rls_enabled": true,',
      '    "types_regenerated": true',
      '  },',
      '  "state_impact": "trust_change",',
      '  "trust_notes": "Database schema modified. RLS policies applied.",',
      `  "timestamp": "${new Date().toISOString()}"`,
      "}",
      "```",
    ].join("\n");
  }

  protected override buildUserMessage(ctx: FrozenStepContext): string {
    const base = super.buildUserMessage(ctx);
    const parts = [base];

    parts.push("## Migration Instructions");
    parts.push("Execute the Supabase migration sequence described in the system prompt.");
    parts.push("Migrations are trust-sensitive — always enable RLS and include policies.");
    parts.push("If migration fails, report the error. Do not attempt to fix schema issues.");

    return parts.join("\n");
  }
}
