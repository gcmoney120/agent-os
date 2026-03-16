/**
 * Agent OS — Runtime Runners
 * Base LLM-backed step runner.
 *
 * Each agent runner (Command, Atlas, Forge, Sentinel, Compass) extends this
 * base to provide agent-specific system prompts and action handling.
 *
 * The base runner:
 *   1. Loads the agent's system prompt from the project's prompt file
 *   2. Constructs an LLM request with step context as user message
 *   3. Calls LLMProvider.complete()
 *   4. Parses the response into a StepReportV1
 *   5. Returns RunnerOutput with the step report
 */

import type { LLMProvider, LLMRequest, LLMResponse } from "../providers.js";
import type { FrozenStepContext, StepRunner, RunnerOutput } from "../../dispatcher/types.js";
import type { StepReportV1, StateImpact } from "../../step-report/stepReport.schema.js";

// ── Runner Options ──────────────────────────────────────────────────────────

export interface LLMRunnerOptions {
  /** LLM provider to use for completions. */
  llm: LLMProvider;
  /** Default model ID if not specified in adapter. */
  defaultModel?: string;
  /** Max tokens for LLM response. Defaults to 4096. */
  maxTokens?: number;
  /** Temperature for LLM calls. Defaults to 0. */
  temperature?: number;
}

// ── Base LLM Runner ─────────────────────────────────────────────────────────

export abstract class BaseLLMRunner implements StepRunner {
  protected readonly llm: LLMProvider;
  protected readonly defaultModel: string;
  protected readonly maxTokens: number;
  protected readonly temperature: number;

  constructor(options: LLMRunnerOptions) {
    this.llm = options.llm;
    this.defaultModel = options.defaultModel ?? "claude-opus-4-6";
    this.maxTokens = options.maxTokens ?? 4096;
    this.temperature = options.temperature ?? 0;
  }

  /**
   * Agent-specific system prompt. Subclasses provide the agent identity,
   * operating constraints, and output format instructions.
   */
  protected abstract getSystemPrompt(ctx: FrozenStepContext): string;

  /**
   * Agent role key for model selection from adapter.
   */
  protected abstract get agentRole(): "command" | "atlas" | "forge" | "sentinel" | "compass";

  /**
   * Build the user message from step context.
   * Subclasses may override for agent-specific formatting.
   */
  protected buildUserMessage(ctx: FrozenStepContext): string {
    const parts: string[] = [];

    parts.push(`## Step Execution Context`);
    parts.push(`- **Run ID:** ${ctx.run_id}`);
    parts.push(`- **Step:** ${ctx.step_index} (${ctx.step_id})`);
    parts.push(`- **Action:** ${ctx.action}`);
    parts.push(`- **Capabilities:** ${ctx.capabilities.join(", ") || "none"}`);
    parts.push("");

    if (ctx.input !== undefined) {
      parts.push(`## Input`);
      parts.push("```json");
      parts.push(JSON.stringify(ctx.input, null, 2));
      parts.push("```");
      parts.push("");
    }

    if (ctx.memory) {
      parts.push(`## Memory Context`);
      parts.push("```json");
      parts.push(JSON.stringify(ctx.memory, null, 2));
      parts.push("```");
      parts.push("");
    }

    return parts.join("\n");
  }

  /**
   * Resolve the model ID from the adapter or fall back to default.
   */
  protected resolveModel(ctx: FrozenStepContext): string {
    const adapter = ctx.adapter as Record<string, unknown> | undefined;
    if (adapter) {
      const models = adapter.models as Record<string, string> | undefined;
      if (models && models[this.agentRole]) {
        return models[this.agentRole];
      }
    }
    return this.defaultModel;
  }

  /**
   * Parse LLM response into a StepReportV1.
   * Attempts to extract JSON from the response content.
   * Falls back to wrapping the text response in a report.
   */
  protected parseStepReport(
    response: LLMResponse,
    ctx: FrozenStepContext,
  ): StepReportV1 {
    // Try to extract JSON step report from response
    const jsonMatch = response.content.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]) as Partial<StepReportV1>;
        if (parsed.schema_version === "1.0" && parsed.step_id) {
          return parsed as StepReportV1;
        }
      } catch {
        // Fall through to text-based report
      }
    }

    // Build a report from the text response
    const hasTrustChange = ctx.capabilities.includes("trust_change");
    const stateImpact: StateImpact = hasTrustChange ? "trust_change" : "trivial";

    return {
      schema_version: "1.0",
      run_id: ctx.run_id,
      step_id: ctx.step_id,
      step_index: ctx.step_index,
      actor: ctx.actor,
      action: ctx.action,
      status: "succeeded",
      success: true,
      summary: response.content.slice(0, 500),
      artifacts: {},
      output: response.content,
      metadata: {
        model: response.model,
        usage: response.usage,
        stop_reason: response.stop_reason,
      },
      state_impact: stateImpact,
      trust_notes: hasTrustChange ? "Step involves trust-sensitive capabilities." : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute the step: build prompt, call LLM, parse response.
   */
  async run(ctx: FrozenStepContext): Promise<RunnerOutput> {
    const systemPrompt = this.getSystemPrompt(ctx);
    const userMessage = this.buildUserMessage(ctx);
    const model = this.resolveModel(ctx);

    const request: LLMRequest = {
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    };

    let response: LLMResponse;
    try {
      response = await this.llm.complete(request);
    } catch (err) {
      // LLM call failed — return a failed step report
      const report: StepReportV1 = {
        schema_version: "1.0",
        run_id: ctx.run_id,
        step_id: ctx.step_id,
        step_index: ctx.step_index,
        actor: ctx.actor,
        action: ctx.action,
        status: "failed",
        success: false,
        error: {
          code: "LLM_CALL_FAILED",
          message: String(err),
        },
        summary: `LLM call failed: ${String(err)}`,
        artifacts: {},
        state_impact: "none",
        timestamp: new Date().toISOString(),
      };
      return { step_report: report, raw_log: String(err) };
    }

    const report = this.parseStepReport(response, ctx);
    return {
      step_report: report,
      raw_log: response.content,
    };
  }
}
