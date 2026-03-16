/**
 * Agent OS — Runtime Integration Layer R2
 * In-memory and stub provider implementations for testing.
 *
 * InMemoryPersistenceBackend — fully functional in-process backend
 * StubLLMProvider            — returns a configurable canned LLM response
 * StubEmbeddingBackend       — returns a configurable canned embedding
 */

import { MemoryStore } from "../memory/store.js";
import { InMemoryK2Backend } from "../memory/pipeline/backend.js";
import { createEmptyLedgerStore, type RunLedgerStore } from "../planner/run-ledger.js";
import type { LLMProvider, LLMRequest, LLMResponse, PersistenceBackend, EmbeddingBackend } from "./providers.js";

// ── InMemoryPersistenceBackend ────────────────────────────────────────────────

/**
 * In-memory implementation of PersistenceBackend.
 *
 * Holds a MemoryStore (K1 records), an InMemoryK2Backend (K2 pipeline records),
 * and a RunLedgerStore (execution ledger). State is process-local; there is no
 * flush — flush() is a no-op.
 *
 * k2Backend() is exposed so that constructMemoryBackends (memory-wiring.ts) can
 * build a K3ReadBackend adapter from the K2 records needed by K7 assembly.
 */
export class InMemoryPersistenceBackend implements PersistenceBackend {
  private readonly _memoryStore: MemoryStore;
  private readonly _k2Backend: InMemoryK2Backend;
  private _runLedgerStore: RunLedgerStore;

  constructor() {
    this._memoryStore = new MemoryStore();
    this._k2Backend = new InMemoryK2Backend();
    this._runLedgerStore = createEmptyLedgerStore();
  }

  /** K1 append-only memory store (raw records). */
  memoryStore(): MemoryStore {
    return this._memoryStore;
  }

  /**
   * K2 pipeline backend (processed pipeline records).
   * Used by constructMemoryBackends to build a K3ReadBackend for K7 assembly.
   */
  k2Backend(): InMemoryK2Backend {
    return this._k2Backend;
  }

  /** Current run ledger store snapshot. */
  runLedgerStore(): RunLedgerStore {
    return this._runLedgerStore;
  }

  /**
   * Update the ledger store reference.
   * Called by the orchestrator after each syncDispatchResult call
   * to keep the backend's view current.
   */
  updateRunLedgerStore(store: RunLedgerStore): void {
    this._runLedgerStore = store;
  }

  /** No-op — in-memory state is never flushed to disk. */
  async flush(): Promise<void> {
    // Intentional no-op for in-memory backend.
  }
}

// ── StubLLMProvider ───────────────────────────────────────────────────────────

/** Default canned LLM response used when no override is supplied. */
const DEFAULT_LLM_RESPONSE: LLMResponse = {
  content: "[stub] no llm response configured",
  model: "stub-llm",
  usage: { input_tokens: 0, output_tokens: 0 },
  stop_reason: "end_turn",
};

/**
 * Stub LLM provider for testing.
 *
 * Returns a configurable canned response on every call. The response does not
 * depend on the request contents. Pass a custom response to the constructor to
 * control what the stub returns.
 *
 * Usage:
 *   const llm = new StubLLMProvider();
 *   const llm = new StubLLMProvider({ content: "custom", ... });
 */
export class StubLLMProvider implements LLMProvider {
  private readonly _response: LLMResponse;
  readonly requests: LLMRequest[] = [];

  constructor(response: Partial<LLMResponse> = {}) {
    this._response = { ...DEFAULT_LLM_RESPONSE, ...response };
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request);
    return this._response;
  }
}

// ── StubEmbeddingBackend ──────────────────────────────────────────────────────

/** Default canned embedding (1536-dim zero vector). */
const DEFAULT_EMBEDDING_DIM = 8;

/**
 * Stub embedding backend for testing.
 *
 * Returns a zero-vector of configurable dimension on every call. The vector
 * does not depend on the input text. Override dimension or provide a fixed
 * vector to control what the stub returns.
 *
 * Usage:
 *   const emb = new StubEmbeddingBackend();
 *   const emb = new StubEmbeddingBackend({ dim: 1536 });
 *   const emb = new StubEmbeddingBackend({ vector: [0.1, 0.2, ...] });
 */
export class StubEmbeddingBackend implements EmbeddingBackend {
  private readonly _vector: readonly number[];
  private readonly _modelId: string;
  readonly calls: Array<{ text: string; factType: string }> = [];

  constructor(opts: { dim?: number; vector?: readonly number[]; modelId?: string } = {}) {
    this._modelId = opts.modelId ?? "stub-embedding";
    if (opts.vector !== undefined) {
      this._vector = opts.vector;
    } else {
      const dim = opts.dim ?? DEFAULT_EMBEDDING_DIM;
      this._vector = Array.from({ length: dim }, () => 0);
    }
  }

  async generate(
    text: string,
    factType: string,
  ): Promise<{ modelId: string; embedding: readonly number[] }> {
    this.calls.push({ text, factType });
    return { modelId: this._modelId, embedding: this._vector };
  }
}
