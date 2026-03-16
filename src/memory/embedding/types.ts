/**
 * Agent OS — K4 Embedding Pipeline
 * Types, status constants, state machine, and store interface.
 *
 * Slice: K4 — Embedding Pipeline
 * Authority: Atlas Embedding Pipeline Architecture Specification v1.0
 *
 * K4 operates on embedding_record rows created by K2.
 * K4 never creates embedding_record rows.
 * K4 never mutates semantic_fact.
 * Single-worker only — no concurrency primitives.
 */

import type {
  K2EmbeddingRecord,
  K2EmbeddingStatusEvent,
  K2SemanticFact,
} from "../pipeline/types.js";

// ---------------------------------------------------------------------------
// Embedding status constants — §5.1
// ---------------------------------------------------------------------------

export const EMBEDDING_STATUS = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  ABANDONED: "ABANDONED",
} as const;

export type EmbeddingStatus =
  (typeof EMBEDDING_STATUS)[keyof typeof EMBEDDING_STATUS];

// ---------------------------------------------------------------------------
// Terminal statuses — §5.2. No transitions allowed from these.
// ---------------------------------------------------------------------------

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  EMBEDDING_STATUS.COMPLETE,
  EMBEDDING_STATUS.ABANDONED,
]);

// ---------------------------------------------------------------------------
// Valid transition map — §5.2, exhaustive.
// ---------------------------------------------------------------------------

export const VALID_TRANSITIONS: ReadonlyMap<string, ReadonlySet<string>> =
  new Map<string, ReadonlySet<string>>([
    [EMBEDDING_STATUS.PENDING, new Set([EMBEDDING_STATUS.IN_PROGRESS])],
    [
      EMBEDDING_STATUS.IN_PROGRESS,
      new Set([EMBEDDING_STATUS.COMPLETE, EMBEDDING_STATUS.FAILED]),
    ],
    [
      EMBEDDING_STATUS.FAILED,
      new Set([EMBEDDING_STATUS.PENDING, EMBEDDING_STATUS.ABANDONED]),
    ],
  ]);

// ---------------------------------------------------------------------------
// K4TransitionResult — outcome of a store transition operation.
// ---------------------------------------------------------------------------

export type K4TransitionResult =
  | {
      readonly ok: true;
      readonly record: K2EmbeddingRecord;
      readonly event: K2EmbeddingStatusEvent;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// K4EmbeddingStore — backend interface for K4 pipeline modules.
//
// Read operations:
//   queryPending    — project-scoped, deterministic order, batch-capped
//   getRecord       — single record lookup
//   getStatusEvents — event history, ordered transitioned_at ASC, id ASC
//   getSemanticFact — read-only fact lookup (K4 never mutates facts)
//
// Write operations (enforce VALID_TRANSITIONS + event/record coherence):
//   transition         — status update + event append (atomic)
//                        Rejects if event.previous_status !== record.status
//                        Rejects if transition is not in VALID_TRANSITIONS
//   transitionComplete — status + model_id + embedding + event (atomic)
//                        Rejects if record.status !== IN_PROGRESS
//                        Rejects if event.previous_status !== IN_PROGRESS
//                        Rejects if event.new_status !== COMPLETE
//                        Rejects if modelId is blank or embedding is empty
// ---------------------------------------------------------------------------

export interface K4EmbeddingStore {
  queryPending(
    projectId: string,
    batchSize: number,
  ): readonly K2EmbeddingRecord[];

  getRecord(id: string): K2EmbeddingRecord | null;

  getStatusEvents(
    embeddingRecordId: string,
  ): readonly K2EmbeddingStatusEvent[];

  getSemanticFact(id: string): K2SemanticFact | null;

  transition(
    recordId: string,
    event: K2EmbeddingStatusEvent,
  ): K4TransitionResult;

  transitionComplete(
    recordId: string,
    modelId: string,
    embedding: readonly number[],
    event: K2EmbeddingStatusEvent,
  ): K4TransitionResult;
}

// ---------------------------------------------------------------------------
// EmbeddingGenerator — injected dependency for vector generation.
// Input typed from canonical K2SemanticFact["fact_value"].
// ---------------------------------------------------------------------------

export type EmbeddingGenerator = (
  factValue: K2SemanticFact["fact_value"],
  factType: string,
) => Promise<{ modelId: string; embedding: readonly number[] }>;

// ---------------------------------------------------------------------------
// K4WorkerResult — outcome of a single worker cycle.
// ---------------------------------------------------------------------------

export type K4WorkerResult =
  | {
      readonly ok: true;
      readonly action: "completed";
      readonly recordId: string;
      readonly modelId: string;
    }
  | {
      readonly ok: true;
      readonly action: "failed_and_requeued";
      readonly recordId: string;
    }
  | {
      readonly ok: true;
      readonly action: "failed_and_abandoned";
      readonly recordId: string;
    }
  | { readonly ok: true; readonly action: "queue_empty" }
  | { readonly ok: false; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// Default attempt limit — §9.1. Derived from FAILED event count.
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Batch size bounds — §7.2.
// ---------------------------------------------------------------------------

export const DEFAULT_BATCH_SIZE = 10;
export const MAX_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// InMemoryK4Store — test-suitable in-memory implementation.
//
// Enforces VALID_TRANSITIONS + event/record coherence at the store boundary.
// Provides seed methods for test setup (simulating K2-created records).
// K4 never creates embedding_record rows — seed is the only creation path.
// ---------------------------------------------------------------------------

export class InMemoryK4Store implements K4EmbeddingStore {
  private readonly _records: K2EmbeddingRecord[] = [];
  private readonly _statusEvents: K2EmbeddingStatusEvent[] = [];
  private readonly _semanticFacts: K2SemanticFact[] = [];

  // -- Test helpers (seed) --------------------------------------------------

  seedRecord(record: K2EmbeddingRecord): void {
    this._records.push(record);
  }

  seedSemanticFact(fact: K2SemanticFact): void {
    this._semanticFacts.push(fact);
  }

  seedStatusEvent(event: K2EmbeddingStatusEvent): void {
    this._statusEvents.push(event);
  }

  // -- Read operations ------------------------------------------------------

  queryPending(
    projectId: string,
    batchSize: number,
  ): readonly K2EmbeddingRecord[] {
    const capped = Math.min(Math.max(1, batchSize), MAX_BATCH_SIZE);
    return this._records
      .filter(
        (r) =>
          r.project_id === projectId &&
          r.status === EMBEDDING_STATUS.PENDING,
      )
      .sort((a, b) => {
        const timeDiff =
          a.created_at.getTime() - b.created_at.getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      })
      .slice(0, capped);
  }

  getRecord(id: string): K2EmbeddingRecord | null {
    return this._records.find((r) => r.id === id) ?? null;
  }

  getStatusEvents(
    embeddingRecordId: string,
  ): readonly K2EmbeddingStatusEvent[] {
    return this._statusEvents
      .filter((e) => e.embedding_record_id === embeddingRecordId)
      .sort((a, b) => {
        const timeDiff =
          a.transitioned_at.getTime() - b.transitioned_at.getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });
  }

  getSemanticFact(id: string): K2SemanticFact | null {
    return this._semanticFacts.find((f) => f.id === id) ?? null;
  }

  // -- Write operations (transition-enforced) --------------------------------

  transition(
    recordId: string,
    event: K2EmbeddingStatusEvent,
  ): K4TransitionResult {
    const idx = this._records.findIndex((r) => r.id === recordId);
    if (idx === -1) {
      return {
        ok: false,
        code: "RECORD_NOT_FOUND",
        message: `Embedding record ${recordId} not found`,
      };
    }

    const current = this._records[idx];

    // Event/record coherence: previous_status must match actual status.
    if (event.previous_status !== current.status) {
      return {
        ok: false,
        code: "EVENT_RECORD_MISMATCH",
        message: `event.previous_status (${event.previous_status}) does not match record.status (${current.status})`,
      };
    }

    // State machine enforcement.
    const allowed = VALID_TRANSITIONS.get(current.status);
    if (!allowed || !allowed.has(event.new_status)) {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        message: `Invalid transition: ${current.status} → ${event.new_status}`,
      };
    }

    const updated: K2EmbeddingRecord = {
      ...current,
      status: event.new_status,
    };
    this._records[idx] = updated;
    this._statusEvents.push(event);
    return { ok: true, record: updated, event };
  }

  transitionComplete(
    recordId: string,
    modelId: string,
    embedding: readonly number[],
    event: K2EmbeddingStatusEvent,
  ): K4TransitionResult {
    const idx = this._records.findIndex((r) => r.id === recordId);
    if (idx === -1) {
      return {
        ok: false,
        code: "RECORD_NOT_FOUND",
        message: `Embedding record ${recordId} not found`,
      };
    }

    const current = this._records[idx];

    // Strict COMPLETE contract: record must be IN_PROGRESS.
    if (current.status !== EMBEDDING_STATUS.IN_PROGRESS) {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        message: `Cannot complete: record.status is ${current.status}, expected ${EMBEDDING_STATUS.IN_PROGRESS}`,
      };
    }

    // Event coherence: previous_status must be IN_PROGRESS.
    if (event.previous_status !== EMBEDDING_STATUS.IN_PROGRESS) {
      return {
        ok: false,
        code: "EVENT_RECORD_MISMATCH",
        message: `event.previous_status (${event.previous_status}) must be ${EMBEDDING_STATUS.IN_PROGRESS}`,
      };
    }

    // Event coherence: new_status must be COMPLETE.
    if (event.new_status !== EMBEDDING_STATUS.COMPLETE) {
      return {
        ok: false,
        code: "EVENT_RECORD_MISMATCH",
        message: `event.new_status (${event.new_status}) must be ${EMBEDDING_STATUS.COMPLETE}`,
      };
    }

    // Payload integrity: reject blank modelId.
    if (!modelId || modelId.trim().length === 0) {
      return {
        ok: false,
        code: "INCOMPLETE_PAYLOAD",
        message: "modelId must not be blank",
      };
    }

    // Payload integrity: reject empty embedding.
    if (!embedding || embedding.length === 0) {
      return {
        ok: false,
        code: "INCOMPLETE_PAYLOAD",
        message: "embedding must not be empty",
      };
    }

    const updated: K2EmbeddingRecord = {
      ...current,
      status: EMBEDDING_STATUS.COMPLETE,
      model_id: modelId,
      embedding,
    };
    this._records[idx] = updated;
    this._statusEvents.push(event);
    return { ok: true, record: updated, event };
  }

  // -- Snapshot methods (test assertions) -----------------------------------

  snapshotRecords(): readonly K2EmbeddingRecord[] {
    return this._records.slice();
  }

  snapshotStatusEvents(): readonly K2EmbeddingStatusEvent[] {
    return this._statusEvents.slice();
  }
}
