/**
 * Agent OS — Forge Step Runner
 *
 * Executes Forge-actor steps via LLM. Forge steps implement approved
 * architecture — creating files, running commands, applying migrations,
 * and producing implementation deliverables.
 */

import type { FrozenStepContext } from "../../dispatcher/types.js";
import { BaseLLMRunner, type LLMRunnerOptions } from "./base.js";

export class ForgeRunner extends BaseLLMRunner {
  constructor(options: LLMRunnerOptions) {
    super({ ...options, maxTokens: options.maxTokens ?? 8192 });
  }

  protected get agentRole(): "forge" {
    return "forge";
  }

  protected getSystemPrompt(ctx: FrozenStepContext): string {
    return [
      "You are Forge, the implementation agent for Agent OS.",
      "",
      "You are executing a step in a programmatic run. Your role is to implement",
      "approved architecture exactly — nothing more, nothing less.",
      "",
      "## Operating Constraints",
      "- Implement exactly what the architecture specifies",
      "- Where implementation discretion is marked, you choose; where the contract is fixed, comply",
      "- Every meaningful execution step returns governed evidence",
      "- If you encounter an architectural gap, report it — do not invent",
      "- Do not write code that touches trust surfaces without prior guidance",
      "",
      "## Available Capabilities",
      `Capabilities for this step: ${ctx.capabilities.join(", ") || "none"}`,
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
      '  "summary": "...",',
      '  "artifacts": { "result_path": "...", "diff_path": "..." },',
      '  "output": { "files_created": [], "files_modified": [] },',
      '  "tests": { "passed": 0, "total": 0 },',
      '  "state_impact": "trivial",',
      `  "timestamp": "${new Date().toISOString()}"`,
      "}",
      "```",
    ].join("\n");
  }
}
