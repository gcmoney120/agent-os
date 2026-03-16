/**
 * Agent OS — K5 Memory Retrieval Layer
 * Query parameter validation guards for vectorSearch.
 *
 * Source: K5 Vector Search Retrieval specification v1.1 §5.3
 * Slice: K5 — Vector Search Retrieval
 *
 * Guards perform no query execution, no DB access, no mutation.
 */

import type { VectorSearchParams, K5ErrorCode } from "./types.js";
import { K5_ERROR_CODE } from "./types.js";
import { decodeVectorCursor } from "./pagination.js";

// ---------------------------------------------------------------------------
// Constants — §5.2
// ---------------------------------------------------------------------------

const VECTOR_DIMENSION = 1536;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_EXCLUSION_LIST = 50;

// ---------------------------------------------------------------------------
// Validated params container
// ---------------------------------------------------------------------------

export interface ValidatedVectorSearchParams {
  readonly project_id: string;
  readonly query_vector: readonly number[];
  readonly model_id: string;
  readonly min_score: number | undefined;
  readonly resolvedLimit: number;
  readonly decodedCursor: {
    readonly last_similarity: number;
    readonly last_created_at: string;
    readonly last_id: string;
  } | null;
  readonly fact_type: readonly string[] | undefined;
  readonly source_run_id: string | undefined;
  readonly exclude_fact_ids: readonly string[] | undefined;
  readonly include_score: boolean;
}

// ---------------------------------------------------------------------------
// Guard result type
// ---------------------------------------------------------------------------

export type VectorSearchGuardResult =
  | { readonly ok: true; readonly params: ValidatedVectorSearchParams }
  | { readonly ok: false; readonly code: K5ErrorCode; readonly message: string };

// ---------------------------------------------------------------------------
// guardVectorSearch — §5.3
// ---------------------------------------------------------------------------

export function guardVectorSearch(
  params: VectorSearchParams,
): VectorSearchGuardResult {
  if (!params.project_id) {
    return {
      ok: false,
      code: K5_ERROR_CODE.MISSING_PROJECT_ID,
      message: "project_id is required for all K5 queries",
    };
  }

  if (!params.query_vector || !Array.isArray(params.query_vector)) {
    return {
      ok: false,
      code: K5_ERROR_CODE.MISSING_QUERY_VECTOR,
      message: "query_vector is required",
    };
  }

  if (params.query_vector.length !== VECTOR_DIMENSION) {
    return {
      ok: false,
      code: K5_ERROR_CODE.INVALID_VECTOR_DIMENSION,
      message: `query_vector must have exactly ${VECTOR_DIMENSION} dimensions, got ${params.query_vector.length}`,
    };
  }

  if (!params.model_id) {
    return {
      ok: false,
      code: K5_ERROR_CODE.MISSING_MODEL_ID,
      message: "model_id is required for model homogeneity enforcement",
    };
  }

  if (params.min_score !== undefined) {
    if (typeof params.min_score !== "number" || params.min_score < 0 || params.min_score > 1) {
      return {
        ok: false,
        code: K5_ERROR_CODE.INVALID_SCORE_THRESHOLD,
        message: "min_score must be between 0.0 and 1.0",
      };
    }
  }

  if (params.exclude_fact_ids !== undefined && params.exclude_fact_ids.length > MAX_EXCLUSION_LIST) {
    return {
      ok: false,
      code: K5_ERROR_CODE.EXCLUSION_LIST_TOO_LARGE,
      message: `exclude_fact_ids must not exceed ${MAX_EXCLUSION_LIST} entries, got ${params.exclude_fact_ids.length}`,
    };
  }

  let resolvedLimit = DEFAULT_LIMIT;
  if (params.limit !== undefined && params.limit > 0) {
    resolvedLimit = Math.min(Math.floor(params.limit), MAX_LIMIT);
  }

  let decodedCursor: ValidatedVectorSearchParams["decodedCursor"] = null;
  if (params.cursor !== undefined && params.cursor !== "") {
    decodedCursor = decodeVectorCursor(params.cursor);
    if (decodedCursor === null) {
      return {
        ok: false,
        code: K5_ERROR_CODE.INVALID_CURSOR,
        message: "cursor is malformed or invalid",
      };
    }
  }

  return {
    ok: true,
    params: {
      project_id: params.project_id,
      query_vector: params.query_vector,
      model_id: params.model_id,
      min_score: params.min_score,
      resolvedLimit,
      decodedCursor,
      fact_type: params.fact_type,
      source_run_id: params.source_run_id,
      exclude_fact_ids: params.exclude_fact_ids,
      include_score: params.include_score !== false,
    },
  };
}
