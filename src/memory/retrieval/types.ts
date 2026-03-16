/**
 * Agent OS — Memory Retrieval Layer K3
 * Read-path types defined by K3 Architecture Specification v1.0.
 *
 * Source: agent-os/docs/architecture/memory-retrieval-k3.md
 * Slice: K3 — Memory Retrieval Layer
 *
 * K3 is read-only. No write types. No mutation types.
 * All date fields in return shapes are ISO 8601 strings.
 * schema_version is always present on every returned record.
 */

import type {
  K2EpisodicEvent,
  K2DecisionEvent,
  K2SemanticFact,
  K2SemanticFactEvent,
  K2EmbeddingRecord,
  K2EmbeddingStatusEvent,
} from "../pipeline/types.js";

// ---------------------------------------------------------------------------
// Page Envelope (spec §7.7)
// ---------------------------------------------------------------------------

export interface Page<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
}

// ---------------------------------------------------------------------------
// EpisodicEvent — Return Shape (spec §7.1)
// ---------------------------------------------------------------------------

export interface EpisodicEvent {
  readonly id: string;
  readonly project_id: string;
  readonly run_id: string;
  readonly event_type: string;
  readonly actor_role: string;
  readonly payload: Record<string, unknown> | null;
  readonly created_at: string; // ISO 8601
  readonly schema_version: string;
}

// ---------------------------------------------------------------------------
// DecisionEvent — Return Shape (spec §7.2)
// ---------------------------------------------------------------------------

export interface DecisionEvent {
  readonly id: string;
  readonly project_id: string;
  readonly run_id: string;
  readonly episodic_event_id: string;
  readonly decision_type: string;
  readonly actor_role: string;
  readonly decision_payload: Record<string, unknown> | null;
  readonly created_at: string;
  readonly schema_version: string;
}

// ---------------------------------------------------------------------------
// SemanticFact — Return Shape (spec §7.3)
// ---------------------------------------------------------------------------

export interface SemanticFact {
  readonly id: string;
  readonly project_id: string;
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: string;
  readonly status: string;
  readonly source_run_id: string;
  readonly created_at: string;
  readonly schema_version: string;
  readonly embedding_meta?: EmbeddingRecordMeta;
  readonly promotion_lineage?: readonly SemanticFactEvent[];
}

// ---------------------------------------------------------------------------
// EmbeddingRecordMeta — Return Shape (spec §7.4)
// The raw embedding vector is NEVER returned by K3.
// ---------------------------------------------------------------------------

export interface EmbeddingRecordMeta {
  readonly id: string;
  readonly semantic_fact_id: string;
  readonly status: string;
  readonly model_id: string | null;
  readonly created_at: string;
  readonly schema_version: string;
}

// ---------------------------------------------------------------------------
// EmbeddingStatusEvent — Return Shape (spec §7.5)
// ---------------------------------------------------------------------------

export interface EmbeddingStatusEvent {
  readonly id: string;
  readonly embedding_record_id: string;
  readonly previous_status: string | null;
  readonly new_status: string;
  readonly transition_reason: string;
  readonly transitioned_at: string;
  readonly schema_version: string;
}

// ---------------------------------------------------------------------------
// SemanticFactEvent — Return Shape (spec §7.6) — Lineage Only
// ---------------------------------------------------------------------------

export interface SemanticFactEvent {
  readonly id: string;
  readonly semantic_fact_id: string;
  readonly episodic_event_id: string;
  readonly observed_at: string;
  readonly schema_version: string;
}

// ---------------------------------------------------------------------------
// Query Parameter Types (spec §6)
// ---------------------------------------------------------------------------

export interface EpisodicEventQueryParams {
  readonly project_id: string;
  readonly run_id?: string;
  readonly event_type?: readonly string[];
  readonly actor_role?: readonly string[];
  readonly created_at_from?: string; // ISO 8601
  readonly created_at_to?: string;   // ISO 8601
  readonly cursor?: string;
  readonly limit?: number;
}

export interface DecisionEventQueryParams {
  readonly project_id: string;
  readonly run_id?: string;
  readonly decision_type?: readonly string[];
  readonly actor_role?: readonly string[];
  readonly episodic_event_id?: string;
  readonly created_at_from?: string;
  readonly created_at_to?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SemanticFactQueryParams {
  readonly project_id: string;
  readonly fact_type?: readonly string[];
  readonly fact_key?: string;
  readonly created_at_from?: string;
  readonly created_at_to?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// K3ReadBackend — data access interface for read operations.
//
// Returns raw K2 records. K3 read functions handle project isolation,
// filtering, sorting, pagination, and projection.
//
// For in-memory testing, backed by InMemoryK2Backend snapshot methods.
// For future DB usage, backed by SQL queries.
// ---------------------------------------------------------------------------

export interface K3ReadBackend {
  allEpisodicEvents(): readonly K2EpisodicEvent[];
  allDecisionEvents(): readonly K2DecisionEvent[];
  allSemanticFacts(): readonly K2SemanticFact[];
  allSemanticFactEvents(): readonly K2SemanticFactEvent[];
  allEmbeddingRecords(): readonly K2EmbeddingRecord[];
  allEmbeddingStatusEvents(): readonly K2EmbeddingStatusEvent[];
}

// ---------------------------------------------------------------------------
// Query Guard Error
// ---------------------------------------------------------------------------

export interface QueryGuardError {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type QueryGuardResult = { readonly ok: true } | QueryGuardError;
