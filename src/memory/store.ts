/**
 * Agent OS — Memory Engine K1
 * In-memory append-only store.
 *
 * Source: .claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md
 * Slice: K1 — Memory Engine Foundation
 *
 * Invariants encoded here:
 * - Records are appended — never mutated or removed after insertion.
 * - All seven K1 record types stored in independent private arrays.
 * - Snapshot methods return a copied array (slice) — callers hold a
 *   point-in-time view and cannot affect store state through casting
 *   or accidental widening of the returned reference.
 * - No UPDATE, DELETE, or clear paths exist anywhere in this module.
 * - No module-level singleton — the composition root creates the shared
 *   runtime instance; tests create isolated instances directly.
 */

import type {
  EpisodicEvent,
  SemanticFact,
  SemanticFactEvent,
  DecisionEvent,
  ToolInvocation,
  EmbeddingRecord,
  EmbeddingStatusEvent,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// MemoryStore — append-only container for all seven K1 record types.
// ---------------------------------------------------------------------------

export class MemoryStore {
  // Private mutable arrays — the reference is readonly (never reassigned);
  // contents grow via append only. No splice, no pop, no shift.
  private readonly _episodicEvents: EpisodicEvent[] = [];
  private readonly _semanticFacts: SemanticFact[] = [];
  private readonly _semanticFactEvents: SemanticFactEvent[] = [];
  private readonly _decisionEvents: DecisionEvent[] = [];
  private readonly _toolInvocations: ToolInvocation[] = [];
  private readonly _embeddingRecords: EmbeddingRecord[] = [];
  private readonly _embeddingStatusEvents: EmbeddingStatusEvent[] = [];

  // -------------------------------------------------------------------------
  // Append — the ONLY write path into each array.
  // No remove, no modify. One direction: forward.
  // -------------------------------------------------------------------------

  appendEpisodicEvent(record: EpisodicEvent): void {
    this._episodicEvents.push(record);
  }

  appendSemanticFact(record: SemanticFact): void {
    this._semanticFacts.push(record);
  }

  appendSemanticFactEvent(record: SemanticFactEvent): void {
    this._semanticFactEvents.push(record);
  }

  appendDecisionEvent(record: DecisionEvent): void {
    this._decisionEvents.push(record);
  }

  appendToolInvocation(record: ToolInvocation): void {
    this._toolInvocations.push(record);
  }

  appendEmbeddingRecord(record: EmbeddingRecord): void {
    this._embeddingRecords.push(record);
  }

  appendEmbeddingStatusEvent(record: EmbeddingStatusEvent): void {
    this._embeddingStatusEvents.push(record);
  }

  // -------------------------------------------------------------------------
  // Snapshots — copied point-in-time views of internal state.
  //
  // slice() is used deliberately: callers receive an independent copy, not a
  // reference to the live backing array. This means no cast (e.g. `as T[]`)
  // or accidental widening of the returned value can mutate store contents.
  //
  // The store remains append-only even under adversarial caller behaviour.
  //
  // All project_id filtering and lifecycle gates are applied in retrieval.ts.
  // -------------------------------------------------------------------------

  snapshotEpisodicEvents(): ReadonlyArray<EpisodicEvent> {
    return this._episodicEvents.slice();
  }

  snapshotSemanticFacts(): ReadonlyArray<SemanticFact> {
    return this._semanticFacts.slice();
  }

  snapshotSemanticFactEvents(): ReadonlyArray<SemanticFactEvent> {
    return this._semanticFactEvents.slice();
  }

  snapshotDecisionEvents(): ReadonlyArray<DecisionEvent> {
    return this._decisionEvents.slice();
  }

  snapshotToolInvocations(): ReadonlyArray<ToolInvocation> {
    return this._toolInvocations.slice();
  }

  snapshotEmbeddingRecords(): ReadonlyArray<EmbeddingRecord> {
    return this._embeddingRecords.slice();
  }

  snapshotEmbeddingStatusEvents(): ReadonlyArray<EmbeddingStatusEvent> {
    return this._embeddingStatusEvents.slice();
  }
}
