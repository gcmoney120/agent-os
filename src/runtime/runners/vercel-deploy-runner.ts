/**
 * Agent OS — Vercel Deployment Runner (Phase 3A)
 *
 * Specialized StepRunner for Vercel deployments.
 * Extends ForgeRunner with deployment-specific logic:
 *   1. Build the project
 *   2. Deploy via Vercel MCP
 *   3. Verify deployment status
 *   4. Record deployment URL in step report
 *
 * This runner is used in programmatic runs where a plan step
 * specifies action "forge.deploy.vercel" or similar.
 *
 * In the governance layer (Claude Code slash commands), Forge handles
 * deployments directly via MCP tools. This runner provides the same
 * capability for the runtime execution engine.
 */

import type { FrozenStepContext, RunnerOutput } from "../../dispatcher/types.js";
import type { StepReportV1 } from "../../step-report/stepReport.schema.js";
import { BaseLLMRunner } from "./base.js";

export class VercelDeployRunner extends BaseLLMRunner {
  protected get agentRole(): "forge" {
    return "forge";
  }

  protected getSystemPrompt(ctx: FrozenStepContext): string {
    return [
      "You are Forge, executing a Vercel deployment step.",
      "",
      "Your task is to deploy the application to Vercel. Follow this sequence:",
      "",
      "1. **Pre-deployment checks:**",
      "   - Verify the build command succeeds (if specified in input)",
      "   - Verify tests pass (if specified in input)",
      "   - Check that required environment variables are documented",
      "",
      "2. **Deployment:**",
      "   - Use the Vercel MCP `deploy_to_vercel` tool to deploy",
      "   - Record the deployment ID and URL",
      "",
      "3. **Verification:**",
      "   - Use `get_deployment` to verify READY status",
      "   - Use `get_deployment_build_logs` to check for errors",
      "   - Use `get_runtime_logs` to verify no startup errors",
      "",
      "4. **Report:**",
      "   - Include deployment URL, status, and any warnings in your report",
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
      '  "summary": "Deployed to Vercel successfully.",',
      '  "artifacts": {},',
      '  "output": {',
      '    "deployment_url": "...",',
      '    "deployment_id": "...",',
      '    "deployment_status": "READY",',
      '    "build_logs_clean": true',
      '  },',
      '  "state_impact": "trivial",',
      `  "timestamp": "${new Date().toISOString()}"`,
      "}",
      "```",
    ].join("\n");
  }

  /**
   * Override to add deployment-specific context to the user message.
   */
  protected override buildUserMessage(ctx: FrozenStepContext): string {
    const base = super.buildUserMessage(ctx);
    const parts = [base];

    parts.push("## Deployment Instructions");
    parts.push("Execute the Vercel deployment sequence described in the system prompt.");
    parts.push("If any pre-deployment check fails, report it as a failed step.");
    parts.push("Record the deployment URL in the output field.");

    return parts.join("\n");
  }
}
