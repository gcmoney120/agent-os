/**
 * Agent OS — Runner Registry Factory
 *
 * Builds a RunnerRegistry with real LLM-backed runners for all five agents.
 * Pass this to ProviderOverrides.runnerRegistry to replace the stub runners.
 */

import type { LLMProvider } from "../providers.js";
import type { RunnerRegistry } from "../../dispatcher/types.js";
import { CommandRunner } from "./command-runner.js";
import { AtlasRunner } from "./atlas-runner.js";
import { ForgeRunner } from "./forge-runner.js";
import { SentinelRunner } from "./sentinel-runner.js";
import { CompassRunner } from "./compass-runner.js";

export interface RunnerRegistryOptions {
  /** LLM provider for all runners. */
  llm: LLMProvider;
  /** Default model ID. Defaults to "claude-opus-4-6". */
  defaultModel?: string;
  /** Max tokens for LLM responses. Defaults vary by runner. */
  maxTokens?: number;
  /** Temperature for LLM calls. Defaults to 0. */
  temperature?: number;
}

/**
 * Build a RunnerRegistry with real LLM-backed runners.
 *
 * Usage:
 *   const llm = new AnthropicLLMProvider({ apiKey: "..." });
 *   const registry = buildLLMRunnerRegistry({ llm });
 *   const result = await executeRun(plan, projectRoot, {
 *     llm,
 *     runnerRegistry: registry,
 *   });
 */
export function buildLLMRunnerRegistry(options: RunnerRegistryOptions): RunnerRegistry {
  const baseOpts = {
    llm: options.llm,
    defaultModel: options.defaultModel,
    temperature: options.temperature,
  };

  return {
    command: new CommandRunner({ ...baseOpts, maxTokens: options.maxTokens ?? 4096 }),
    atlas: new AtlasRunner({ ...baseOpts, maxTokens: options.maxTokens ?? 4096 }),
    forge: new ForgeRunner({ ...baseOpts, maxTokens: options.maxTokens ?? 8192 }),
    sentinel: new SentinelRunner({ ...baseOpts, maxTokens: options.maxTokens ?? 4096 }),
    compass: new CompassRunner({ ...baseOpts, maxTokens: options.maxTokens ?? 4096 }),
  };
}

// Re-export individual runners for direct use
export { CommandRunner } from "./command-runner.js";
export { AtlasRunner } from "./atlas-runner.js";
export { ForgeRunner } from "./forge-runner.js";
export { SentinelRunner } from "./sentinel-runner.js";
export { CompassRunner } from "./compass-runner.js";
export { BaseLLMRunner } from "./base.js";
