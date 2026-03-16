/**
 * Agent OS — K5 Memory Retrieval Layer
 * Types for vector-search.ts — vectorSearch.
 *
 * Source: K5 Vector Search Retrieval specification v1.1
 * Slice: K5 — Vector Search Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 */

// ---------------------------------------------------------------------------
// Error codes — §5.3
// ---------------------------------------------------------------------------

export const K5_ERROR_CODE = {
  MISSING_PROJECT_ID: "MISSING_PROJECT_ID",
  MISSING_QUERY_VECTOR: "MISSING_QUERY_VECTOR",
  INVALID_VECTOR_DIMENSION: "INVALID_VECTOR_DIMENSION",
  MISSING_MODEL_ID: "MISSING_MODEL_ID",
  INVALID_SCORE_THRESHOLD: "INVALID_SCORE_THRESHOLD",
  INVALID_CURSOR: "INVALID_CURSOR",
  EXCLUSION_LIST_TOO_LARGE: "EXCLUSION_LIST_TOO_LARGE",
} as const;

export type K5ErrorCode = (typeof K5_ERROR_CODE)[keyof typeof K5_ERROR_CODE];

// ---------------------------------------------------------------------------
// Vector search result item — §9.1
// ---------------------------------------------------------------------------

export interface VectorSearchResultItem {
  readonly fact_id: string;
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: string;
  readonly source_run_id: string;
  readonly fact_created_at: string;        // ISO 8601
  readonly fact_schema_version: string;
  readonly embedding_record_id: string;
  readonly model_id: string;
  readonly embedding_created_at: string;   // ISO 8601
  readonly score?: number;
}

// ---------------------------------------------------------------------------
// Vector search page envelope — §8.3
// ---------------------------------------------------------------------------

export interface VectorSearchPage {
  readonly items: readonly VectorSearchResultItem[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
}

// ---------------------------------------------------------------------------
// Vector search params — §5.2
// ---------------------------------------------------------------------------

export interface VectorSearchParams {
  readonly project_id: string;
  readonly query_vector: readonly number[];
  readonly model_id: string;
  readonly min_score?: number;
  readonly limit?: number;
  readonly cursor?: string;
  readonly fact_type?: readonly string[];
  readonly source_run_id?: string;
  readonly exclude_fact_ids?: readonly string[];
  readonly include_score?: boolean;
}

// ---------------------------------------------------------------------------
// Vector search result — union type
// ---------------------------------------------------------------------------

export type VectorSearchResult =
  | { readonly ok: true; readonly page: VectorSearchPage }
  | { readonly ok: false; readonly code: K5ErrorCode; readonly message: string };

// ---------------------------------------------------------------------------
// K5ReadBackend — data access interface for vector search.
//
// Returns raw K2 records. K5 handles project isolation, model homogeneity,
// COMPLETE-only filtering, similarity computation, and pagination.
//
// For in-memory testing, backed by arrays of K2EmbeddingRecord + K2SemanticFact.
// For future DB usage, backed by pgvector queries.
// ---------------------------------------------------------------------------

import type { K2EmbeddingRecord, K2SemanticFact } from "../pipeline/types.js";

export interface K5ReadBackend {
  allEmbeddingRecords(): readonly K2EmbeddingRecord[];
  allSemanticFacts(): readonly K2SemanticFact[];
}
