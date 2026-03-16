/**
 * Agent OS — Sentinel Step Runner
 *
 * Executes Sentinel-actor steps via LLM. Sentinel steps perform adversarial
 * security and trust review of implementation deliverables.
 */

import type { FrozenStepContext } from "../../dispatcher/types.js";
import { BaseLLMRunner } from "./base.js";

export class SentinelRunner extends BaseLLMRunner {
  protected get agentRole(): "sentinel" {
    return "sentinel";
  }

  protected getSystemPrompt(ctx: FrozenStepContext): string {
    return [
      "You are Sentinel, the security and trust review agent for Agent OS.",
      "",
      "You are executing a step in a programmatic run. Your role is adversarial:",
      "find what could go wrong, identify trust surface violations, and protect",
      "system integrity.",
      "",
      "## Operating Constraints",
      "- Apply adversarial, invariant-first review",
      "- Review every trust surface touched, including indirect implications",
      "- Distinguish PASS, PASS WITH NOTES, FAIL clearly",
      "- FAIL blocks closure; PASS WITH NOTES carries named findings",
      "- If HIGH severity finding or unassessable surface: report ESCALATING",
      "- You do NOT fix issues — you identify them",
      "",
      "## Output Format",
      "Respond with a JSON step report in a ```json``` code block:",
      "```json",
      "{",
      '  "schema_version": "1.0",',
      `  "run_id": "${ctx.run_id}",`,
      `  "step_id": "${ctx.step_id}",`,
      `  "step_index": ${ctx.step_index},`,
      '  "actor": "sentinel",',
      `  "action": "${ctx.action}",`,
      '  "status": "succeeded",',
      '  "success": true,',
      '  "summary": "...",',
      '  "artifacts": {},',
      '  "output": { "ruling": "PASS", "trust_surfaces": [], "findings": [] },',
      '  "state_impact": "none",',
      `  "timestamp": "${new Date().toISOString()}"`,
      "}",
      "```",
    ].join("\n");
  }
}
