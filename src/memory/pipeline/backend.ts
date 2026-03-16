/**
 * Agent OS — Memory Write Pipeline K2
 * Write-backend interface and in-memory implementation.
 *
 * Source: agent-os/docs/architecture/memory-write-pipeline-v1.2.md
 * Source: agent-os/schemas/migration_k1_1.sql
 * Slice: K2 — Memory Write Pipeline
 *
 * K2WriteBackend defines append-only write operations for the 6
 * memory tables. K2PromotionBackend defines the atomic promotion chain
 * capability. InMemoryK2Backend provides a testing implementation of both
 * with PK and UNIQUE constraint enforcement matching the K1.1 physical schema.
 */

import type {
  K2EpisodicEvent,
  K2DecisionEvent,
  K2SemanticFact,
  K2SemanticFactEvent,
  K2EmbeddingRecord,
  K2EmbeddingStatusEvent,
} from "./types.js";

import { K2_TERMINAL_EVENT_TYPES } from "./types.js";

// ---------------------------------------------------------------------------
// AppendResult — discriminated union for append outcomes.
// ---------------------------------------------------------------------------

export interface AppendOk<T> {
  readonly ok: true;
  readonly record: T;
}

export interface AppendDuplicate<T> {
  readonly ok: false;
  readonly code: "DUPLICATE";
  readonly existing: T;
}

export type AppendResult<T> = AppendOk<T> | AppendDuplicate<T>;

// ---------------------------------------------------------------------------
// K2WriteBackend — append-only write interface for 6 memory tables.
// ---------------------------------------------------------------------------

export interface K2WriteBackend {
  appendEpisodicEvent(event: K2EpisodicEvent): AppendResult<K2EpisodicEvent>;
  appendDecisionEvent(event: K2DecisionEvent): AppendResult<K2DecisionEvent>;
  appendSemanticFact(fact: K2SemanticFact): AppendResult<K2SemanticFact>;
  appendSemanticFactEvent(link: K2SemanticFactEvent): AppendResult<K2SemanticFactEvent>;
  appendEmbeddingRecord(record: K2EmbeddingRecord): AppendResult<K2EmbeddingRecord>;
  appendEmbeddingStatusEvent(event: K2EmbeddingStatusEvent): AppendResult<K2EmbeddingStatusEvent>;

  /** Returns true if a terminal event (RUN_SUCCEEDED | RUN_FAILED) exists for the given run_id. */
  hasTerminalEvent(run_id: string): boolean;
}

// ---------------------------------------------------------------------------
// K2PromotionBackend — atomic promotion chain capability.
// Separate from K2WriteBackend to avoid widening the base append interface.
// ---------------------------------------------------------------------------

export interface PromotionChainInput {
  readonly fact: K2SemanticFact;
  readonly factEvent: K2SemanticFactEvent;
  readonly embedding: K2EmbeddingRecord;
  readonly embeddingStatus: K2EmbeddingStatusEvent;
}

export type AppendPromotionResult =
  | { readonly ok: true; readonly chain: PromotionChainInput }
  | { readonly ok: false; readonly code: "DUPLICATE"; readonly table: string; readonly existing: unknown };

export interface K2PromotionBackend {
  appendPromotionChain(chain: PromotionChainInput): AppendPromotionResult;
}

// ---------------------------------------------------------------------------
// InMemoryK2Backend — test-suitable in-memory implementation.
//
// PK uniqueness enforced on every table by id.
//
// Composite UNIQUE constraints enforced (matching K1.1 DDL):
//   decision_event:         (run_id, decision_type, episodic_event_id)
//   semantic_fact:          (project_id, fact_type, fact_key)
//   semantic_fact_event:    (semantic_fact_id, episodic_event_id)
//   embedding_record:       (semantic_fact_id)
//   embedding_status_event: (embedding_record_id, new_status, transitioned_at)
//
// episodic_event has no composite UNIQUE constraint beyond PK.
// ---------------------------------------------------------------------------

export class InMemoryK2Backend implements K2WriteBackend, K2PromotionBackend {
  private readonly _episodicEvents: K2EpisodicEvent[] = [];
  private readonly _decisionEvents: K2DecisionEvent[] = [];
  private readonly _semanticFacts: K2SemanticFact[] = [];
  private readonly _semanticFactEvents: K2SemanticFactEvent[] = [];
  private readonly _embeddingRecords: K2EmbeddingRecord[] = [];
  private readonly _embeddingStatusEvents: K2EmbeddingStatusEvent[] = [];

  // -- Append methods -------------------------------------------------------

  appendEpisodicEvent(event: K2EpisodicEvent): AppendResult<K2EpisodicEvent> {
    // PK: id
    const pkHit = this._episodicEvents.find((r) => r.id === event.id);
    if (pkHit) {
      return { ok: false, code: "DUPLICATE", existing: pkHit };
    }
    this._episodicEvents.push(event);
    return { ok: true, record: event };
  }

  appendDecisionEvent(event: K2DecisionEvent): AppendResult<K2DecisionEvent> {
    // PK: id
    const pkHit = this._decisionEvents.find((r) => r.id === event.id);
    if (pkHit) {
      return { ok: false, code: "DUPLICATE", existing: pkHit };
    }
    // UNIQUE (run_id, decision_type, episodic_event_id)
    const compositeHit = this._decisionEvents.find(
      (e) =>
        e.run_id === event.run_id &&
        e.decision_type === event.decision_type &&
        e.episodic_event_id === event.episodic_event_id,
    );
    if (compositeHit) {
      return { ok: false, code: "DUPLICATE", existing: compositeHit };
    }
    this._decisionEvents.push(event);
    return { ok: true, record: event };
  }

  appendSemanticFact(fact: K2SemanticFact): AppendResult<K2SemanticFact> {
    // PK: id
    const pkHit = this._semanticFacts.find((r) => r.id === fact.id);
    if (pkHit) {
      return { ok: false, code: "DUPLICATE", existing: pkHit };
    }
    // UNIQUE (project_id, fact_type, fact_key)
    const compositeHit = this._semanticFacts.find(
      (f) =>
        f.project_id === fact.project_id &&
        f.fact_type === fact.fact_type &&
        f.fact_key === fact.fact_key,
    );
    if (compositeHit) {
      return { ok: false, code: "DUPLICATE", existing: compositeHit };
    }
    this._semanticFacts.push(fact);
    return { ok: true, record: fact };
  }

  appendSemanticFactEvent(link: K2SemanticFactEvent): AppendResult<K2SemanticFactEvent> {
    // PK: id
    const pkHit = this._semanticFactEvents.find((r) => r.id === link.id);
    if (pkHit) {
      return { ok: false, code: "DUPLICATE", existing: pkHit };
    }
    // UNIQUE (semantic_fact_id, episodic_event_id)
    const compositeHit = this._semanticFactEvents.find(
      (l) =>
        l.semantic_fact_id === link.semantic_fact_id &&
        l.episodic_event_id === link.episodic_event_id,
    );
    if (compositeHit) {
      return { ok: false, code: "DUPLICATE", existing: compositeHit };
    }
    this._semanticFactEvents.push(link);
    return { ok: true, record: link };
  }

  appendEmbeddingRecord(record: K2EmbeddingRecord): AppendResult<K2EmbeddingRecord> {
    // PK: id
    const pkHit = this._embeddingRecords.find((r) => r.id === record.id);
    if (pkHit) {
      return { ok: false, code: "DUPLICATE", existing: pkHit };
    }
    // UNIQUE (semantic_fact_id)
    const compositeHit = this._embeddingRecords.find(
      (r) => r.semantic_fact_id === record.semantic_fact_id,
    );
    if (compositeHit) {
      return { ok: false, code: "DUPLICATE", existing: compositeHit };
    }
    this._embeddingRecords.push(record);
    return { ok: true, record };
  }

  appendEmbeddingStatusEvent(event: K2EmbeddingStatusEvent): AppendResult<K2EmbeddingStatusEvent> {
    // PK: id
    const pkHit = this._embeddingStatusEvents.find((r) => r.id === event.id);
    if (pkHit) {
      return { ok: false, code: "DUPLICATE", existing: pkHit };
    }
    // UNIQUE (embedding_record_id, new_status, transitioned_at)
    const compositeHit = this._embeddingStatusEvents.find(
      (e) =>
        e.embedding_record_id === event.embedding_record_id &&
        e.new_status === event.new_status &&
        e.transitioned_at.getTime() === event.transitioned_at.getTime(),
    );
    if (compositeHit) {
      return { ok: false, code: "DUPLICATE", existing: compositeHit };
    }
    this._embeddingStatusEvents.push(event);
    return { ok: true, record: event };
  }

  // -- Terminal event guard -------------------------------------------------

  hasTerminalEvent(run_id: string): boolean {
    return this._episodicEvents.some(
      (e) => e.run_id === run_id && K2_TERMINAL_EVENT_TYPES.has(e.event_type),
    );
  }

  // -- Atomic promotion chain ------------------------------------------------

  appendPromotionChain(chain: PromotionChainInput): AppendPromotionResult {
    const { fact, factEvent, embedding, embeddingStatus } = chain;

    // Preflight: validate all PK + UNIQUE checks before any mutation.

    // 1. semantic_fact: PK (id)
    const factPk = this._semanticFacts.find((r) => r.id === fact.id);
    if (factPk) {
      return { ok: false, code: "DUPLICATE", table: "semantic_fact", existing: factPk };
    }
    // semantic_fact: UNIQUE (project_id, fact_type, fact_key)
    const factComposite = this._semanticFacts.find(
      (f) =>
        f.project_id === fact.project_id &&
        f.fact_type === fact.fact_type &&
        f.fact_key === fact.fact_key,
    );
    if (factComposite) {
      return { ok: false, code: "DUPLICATE", table: "semantic_fact", existing: factComposite };
    }

    // 2. semantic_fact_event: PK (id)
    const fePk = this._semanticFactEvents.find((r) => r.id === factEvent.id);
    if (fePk) {
      return { ok: false, code: "DUPLICATE", table: "semantic_fact_event", existing: fePk };
    }
    // semantic_fact_event: UNIQUE (semantic_fact_id, episodic_event_id)
    const feComposite = this._semanticFactEvents.find(
      (l) =>
        l.semantic_fact_id === factEvent.semantic_fact_id &&
        l.episodic_event_id === factEvent.episodic_event_id,
    );
    if (feComposite) {
      return { ok: false, code: "DUPLICATE", table: "semantic_fact_event", existing: feComposite };
    }

    // 3. embedding_record: PK (id)
    const embPk = this._embeddingRecords.find((r) => r.id === embedding.id);
    if (embPk) {
      return { ok: false, code: "DUPLICATE", table: "embedding_record", existing: embPk };
    }
    // embedding_record: UNIQUE (semantic_fact_id)
    const embComposite = this._embeddingRecords.find(
      (r) => r.semantic_fact_id === embedding.semantic_fact_id,
    );
    if (embComposite) {
      return { ok: false, code: "DUPLICATE", table: "embedding_record", existing: embComposite };
    }

    // 4. embedding_status_event: PK (id)
    const esPk = this._embeddingStatusEvents.find((r) => r.id === embeddingStatus.id);
    if (esPk) {
      return { ok: false, code: "DUPLICATE", table: "embedding_status_event", existing: esPk };
    }
    // embedding_status_event: UNIQUE (embedding_record_id, new_status, transitioned_at)
    const esComposite = this._embeddingStatusEvents.find(
      (e) =>
        e.embedding_record_id === embeddingStatus.embedding_record_id &&
        e.new_status === embeddingStatus.new_status &&
        e.transitioned_at.getTime() === embeddingStatus.transitioned_at.getTime(),
    );
    if (esComposite) {
      return { ok: false, code: "DUPLICATE", table: "embedding_status_event", existing: esComposite };
    }

    // All checks passed — commit all 4 records.
    this._semanticFacts.push(fact);
    this._semanticFactEvents.push(factEvent);
    this._embeddingRecords.push(embedding);
    this._embeddingStatusEvents.push(embeddingStatus);

    return { ok: true, chain };
  }

  // -- Snapshot methods (concrete class only, not on interface) -------------

  snapshotEpisodicEvents(): readonly K2EpisodicEvent[] {
    return this._episodicEvents.slice();
  }

  snapshotDecisionEvents(): readonly K2DecisionEvent[] {
    return this._decisionEvents.slice();
  }

  snapshotSemanticFacts(): readonly K2SemanticFact[] {
    return this._semanticFacts.slice();
  }

  snapshotSemanticFactEvents(): readonly K2SemanticFactEvent[] {
    return this._semanticFactEvents.slice();
  }

  snapshotEmbeddingRecords(): readonly K2EmbeddingRecord[] {
    return this._embeddingRecords.slice();
  }

  snapshotEmbeddingStatusEvents(): readonly K2EmbeddingStatusEvent[] {
    return this._embeddingStatusEvents.slice();
  }
}
