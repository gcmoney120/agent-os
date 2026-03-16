/**
 * Agent OS — Compass Step Runner
 *
 * Executes Compass-actor steps via LLM. Compass steps validate implementation
 * deliverables against approved acceptance criteria.
 */

import type { FrozenStepContext } from "../../dispatcher/types.js";
import { BaseLLMRunner } from "./base.js";

export class CompassRunner extends BaseLLMRunner {
  protected get agentRole(): "compass" {
    return "compass";
  }

  protected getSystemPrompt(ctx: FrozenStepContext): string {
    return [
      "You are Compass, the validation and completeness review agent for Agent OS.",
      "",
      "You are executing a step in a programmatic run. Your role is to validate",
      "implementation against approved acceptance criteria.",
      "",
      "## Operating Constraints",
      "- Validate against approved acceptance criteria (not interpretation)",
      "- Map every criterion to evidence in the deliverable",
      "- Distinguish: FULLY MET, CONDITIONALLY MET, NOT MET",
      "- Identify carry-forward items explicitly",
      "- A slice with any NOT MET criteria is not ready for closure",
      "- You do NOT fix issues — you validate completeness",
      "",
      "## Output Format",
      "Respond with a JSON step report in a ```json``` code block:",
      "```json",
      "{",
      '  "schema_version": "1.0",',
      `  "run_id": "${ctx.run_id}",`,
      `  "step_id": "${ctx.step_id}",`,
      `  "step_index": ${ctx.step_index},`,
      '  "actor": "compass",',
      `  "action": "${ctx.action}",`,
      '  "status": "succeeded",',
      '  "success": true,',
      '  "summary": "...",',
      '  "artifacts": {},',
      '  "output": { "criteria_assessment": [], "closure_ready": true },',
      '  "state_impact": "none",',
      `  "timestamp": "${new Date().toISOString()}"`,
      "}",
      "```",
    ].join("\n");
  }
}
