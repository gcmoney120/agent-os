/**
 * Agent OS — K6 Hybrid Memory Retrieval
 * Types and input validation for hybridSearch.
 *
 * Source: K6 Hybrid Memory Retrieval Architecture Specification v1.1
 * Slice: K6 — Hybrid Memory Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 */

// ---------------------------------------------------------------------------
// Source type — provenance tag per result item (§5.2)
// ---------------------------------------------------------------------------

export type SourceType = "STRUCTURED" | "VECTOR";

// ---------------------------------------------------------------------------
// K6 error codes — §4.6, §13.1
//
// INVALID_CURSOR is defined here for completeness but validated in
// hybrid-search-cursor.ts where the cursor contract is implemented.
// ---------------------------------------------------------------------------

export const K6_ERROR_CODE = {
  MISSING_PROJECT_ID: "K6_MISSING_PROJECT_ID",
  MISSING_QUERY_VECTOR: "K6_MISSING_QUERY_VECTOR",
  INVALID_VECTOR_DIMENSION: "K6_INVALID_VECTOR_DIMENSION",
  MISSING_MODEL_ID: "K6_MISSING_MODEL_ID",
  INVALID_SCORE_THRESHOLD: "K6_INVALID_SCORE_THRESHOLD",
  EXCLUSION_LIST_TOO_LARGE: "K6_EXCLUSION_LIST_TOO_LARGE",
  STRUCTURED_ARM_FAILURE: "K6_STRUCTURED_ARM_FAILURE",
  VECTOR_ARM_FAILURE: "K6_VECTOR_ARM_FAILURE",
  ALL_ARMS_FAILED: "K6_ALL_ARMS_FAILED",
  INVALID_CURSOR: "K6_INVALID_CURSOR",
} as const;

export type K6ErrorCode = (typeof K6_ERROR_CODE)[keyof typeof K6_ERROR_CODE];

// ---------------------------------------------------------------------------
// Structured filters — §4.3 (applied to K3 arm only)
// ---------------------------------------------------------------------------

export interface StructuredFilters {
  readonly fact_type?: readonly string[];
  readonly source_run_id?: string;
  readonly created_at_from?: string; // TIMESTAMPTZ / ISO 8601
  readonly created_at_to?: string;   // TIMESTAMPTZ / ISO 8601
}

// ---------------------------------------------------------------------------
// Vector filters — §4.4 (applied to K5 arm only)
// ---------------------------------------------------------------------------

export interface VectorFilters {
  readonly fact_type?: readonly string[];
  readonly source_run_id?: string;
  readonly exclude_fact_ids?: readonly string[];
}

// ---------------------------------------------------------------------------
// HybridSearchParams — §4.2
// ---------------------------------------------------------------------------

export interface HybridSearchParams {
  readonly project_id: string;
  readonly query_vector: readonly number[];
  readonly model_id: string;
  readonly structured_filters?: StructuredFilters;
  readonly vector_filters?: VectorFilters;
  readonly min_vector_score?: number;
  readonly limit?: number;
  readonly cursor?: string;
  readonly include_scores?: boolean;
  readonly allow_partial?: boolean;
}

// ---------------------------------------------------------------------------
// HybridSearchResult — §5.2
// ---------------------------------------------------------------------------

export interface HybridSearchResult {
  readonly fact_id: string;
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: string;
  readonly source_run_id: string;
  readonly fact_created_at: string;       // ISO 8601
  readonly fact_schema_version: string;
  readonly sources: readonly SourceType[];
  readonly vector_score: number | null;
}

// ---------------------------------------------------------------------------
// HybridSearchPage — §5.1
// ---------------------------------------------------------------------------

export interface HybridSearchPage {
  readonly items: readonly HybridSearchResult[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
  readonly degraded: boolean;
  readonly degraded_arms: readonly SourceType[];
}

// ---------------------------------------------------------------------------
// K6 error result
// ---------------------------------------------------------------------------

export interface K6Error {
  readonly ok: false;
  readonly code: K6ErrorCode;
  readonly message: string;
}

export type HybridSearchOutcome =
  | { readonly ok: true; readonly page: HybridSearchPage }
  | K6Error;

// ---------------------------------------------------------------------------
// Validated params — internal, post-validation shape
// ---------------------------------------------------------------------------

export interface ValidatedHybridSearchParams {
  readonly project_id: string;
  readonly query_vector: readonly number[];
  readonly model_id: string;
  readonly structured_filters: StructuredFilters;
  readonly vector_filters: VectorFilters;
  readonly min_vector_score: number | undefined;
  readonly resolvedLimit: number;
  readonly cursor: string | undefined;
  readonly include_scores: boolean;
  readonly allow_partial: boolean;
}

// ---------------------------------------------------------------------------
// Input validation — §4.6
//
// Validates structural params only. Cursor validation is deferred to
// hybrid-search-cursor.ts where the cursor encode/decode contract lives.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VECTOR_DIMENSION = 1536;
const MAX_EXCLUSION_LIST = 50;

export function validateHybridSearchParams(
  params: HybridSearchParams,
): { readonly ok: true; readonly validated: ValidatedHybridSearchParams } | K6Error {
  // project_id required
  if (!params.project_id || params.project_id.trim() === "") {
    return {
      ok: false,
      code: K6_ERROR_CODE.MISSING_PROJECT_ID,
      message: "project_id is required",
    };
  }

  // query_vector required
  if (!params.query_vector) {
    return {
      ok: false,
      code: K6_ERROR_CODE.MISSING_QUERY_VECTOR,
      message: "query_vector is required",
    };
  }

  // query_vector dimension
  if (params.query_vector.length !== VECTOR_DIMENSION) {
    return {
      ok: false,
      code: K6_ERROR_CODE.INVALID_VECTOR_DIMENSION,
      message: `query_vector must have exactly ${VECTOR_DIMENSION} dimensions`,
    };
  }

  // model_id required
  if (!params.model_id || params.model_id.trim() === "") {
    return {
      ok: false,
      code: K6_ERROR_CODE.MISSING_MODEL_ID,
      message: "model_id is required",
    };
  }

  // min_vector_score range
  if (
    params.min_vector_score !== undefined &&
    (params.min_vector_score < 0.0 || params.min_vector_score > 1.0)
  ) {
    return {
      ok: false,
      code: K6_ERROR_CODE.INVALID_SCORE_THRESHOLD,
      message: "min_vector_score must be between 0.0 and 1.0",
    };
  }

  // exclude_fact_ids length
  if (
    params.vector_filters?.exclude_fact_ids &&
    params.vector_filters.exclude_fact_ids.length > MAX_EXCLUSION_LIST
  ) {
    return {
      ok: false,
      code: K6_ERROR_CODE.EXCLUSION_LIST_TOO_LARGE,
      message: `vector_filters.exclude_fact_ids must not exceed ${MAX_EXCLUSION_LIST} entries`,
    };
  }

  // limit: clamp to MAX_LIMIT, no error (§4.6)
  let resolvedLimit = DEFAULT_LIMIT;
  if (params.limit !== undefined) {
    resolvedLimit = params.limit > MAX_LIMIT ? MAX_LIMIT : params.limit;
    if (resolvedLimit <= 0) resolvedLimit = DEFAULT_LIMIT;
    resolvedLimit = Math.floor(resolvedLimit);
  }

  return {
    ok: true,
    validated: {
      project_id: params.project_id,
      query_vector: params.query_vector,
      model_id: params.model_id,
      structured_filters: params.structured_filters ?? {},
      vector_filters: params.vector_filters ?? {},
      min_vector_score: params.min_vector_score,
      resolvedLimit,
      cursor: params.cursor,
      include_scores: params.include_scores ?? true,
      allow_partial: params.allow_partial ?? false,
    },
  };
}
