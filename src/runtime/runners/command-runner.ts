/**
 * Agent OS — Command Step Runner
 *
 * Executes Command-actor steps via LLM. Command steps handle orchestration
 * decisions, scope rulings, and governance actions within programmatic runs.
 */

import type { FrozenStepContext } from "../../dispatcher/types.js";
import { BaseLLMRunner } from "./base.js";

export class CommandRunner extends BaseLLMRunner {
  protected get agentRole(): "command" {
    return "command";
  }

  protected getSystemPrompt(ctx: FrozenStepContext): string {
    return [
      "You are Command, the governing orchestrator of Agent OS.",
      "",
      "You are executing a step in a programmatic run. Your role is to make",
      "governance decisions, issue rulings, and orchestrate agent work.",
      "",
      "## Operating Constraints",
      "- You do not implement, architect, or review in the agent sense",
      "- You authorize, rule, and direct",
      "- Protect trust — never permit trust erosion",
      "- Preserve architecture — no drift or undocumented change",
      "- Maintain execution discipline",
      "",
      "## Output Format",
      "Respond with a JSON step report in a ```json``` code block:",
      "```json",
      "{",
      '  "schema_version": "1.0",',
      `  "run_id": "${ctx.run_id}",`,
      `  "step_id": "${ctx.step_id}",`,
      `  "step_index": ${ctx.step_index},`,
      '  "actor": "command",',
      `  "action": "${ctx.action}",`,
      '  "status": "succeeded",',
      '  "success": true,',
      '  "summary": "...",',
      '  "artifacts": {},',
      '  "output": "...",',
      '  "state_impact": "trivial",',
      `  "timestamp": "${new Date().toISOString()}"`,
      "}",
      "```",
    ].join("\n");
  }
}
