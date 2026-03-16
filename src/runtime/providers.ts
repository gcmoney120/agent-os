/**
 * Agent OS — Runtime Integration Layer R1
 * Provider interfaces: LLMProvider, PersistenceBackend, EmbeddingBackend
 */

import type { MemoryStore } from "../memory/store.js";
import type { RunLedgerStore } from "../planner/run-ledger.js";

/** Abstract LLM completion provider. */
export interface LLMProvider {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly LLMMessage[];
  readonly max_tokens: number;
  readonly tools?: readonly LLMToolDefinition[];
  readonly temperature?: number;
}

export interface LLMMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface LLMToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export interface LLMResponse {
  readonly content: string;
  readonly model: string;
  readonly usage: { input_tokens: number; output_tokens: number };
  readonly stop_reason: string;
  readonly tool_calls?: readonly LLMToolCall[];
}

export interface LLMToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** Abstract persistence backend for runtime state. */
export interface PersistenceBackend {
  memoryStore(): MemoryStore;
  runLedgerStore(): RunLedgerStore;
  flush?(): Promise<void>;
}

/** Abstract embedding generation backend. */
export interface EmbeddingBackend {
  generate(
    text: string,
    factType: string,
  ): Promise<{
    modelId: string;
    embedding: readonly number[];
  }>;
}
