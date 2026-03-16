/**
 * Agent OS — K6 Hybrid Memory Retrieval
 * K5 arm wrapper — calls vectorSearch with K6-computed parameters
 * and returns a normalized intermediate result set.
 *
 * Source: K6 Architecture Specification v1.1 §6, §16
 * Slice: K6 — Hybrid Memory Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 * Does not modify K5 contract. Consumes K5 as-is.
 */

import { vectorSearch } from "../vector-search/vector-search.js";
import type { K5ReadBackend } from "../vector-search/types.js";
import type { ValidatedHybridSearchParams } from "./types.js";

// ---------------------------------------------------------------------------
// Intermediate result — normalized shape for merge step
// ---------------------------------------------------------------------------

export interface K5ArmResult {
  readonly fact_id: string;
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: string;
  readonly source_run_id: string;
  readonly fact_created_at: string;
  readonly fact_schema_version: string;
  readonly vector_score: number;
}

export type K5ArmOutcome =
  | { readonly ok: true; readonly items: readonly K5ArmResult[] }
  | { readonly ok: false; readonly message: string };

// ---------------------------------------------------------------------------
// fetchK5Arm — call K5 vectorSearch with K6-derived parameters
// ---------------------------------------------------------------------------

export function fetchK5Arm(
  backend: K5ReadBackend,
  params: ValidatedHybridSearchParams,
  armFetchLimit: number,
): K5ArmOutcome {
  try {
    const result = vectorSearch(backend, {
      project_id: params.project_id,
      query_vector: params.query_vector,
      model_id: params.model_id,
      min_score: params.min_vector_score,
      limit: armFetchLimit,
      fact_type: params.vector_filters.fact_type,
      source_run_id: params.vector_filters.source_run_id,
      exclude_fact_ids: params.vector_filters.exclude_fact_ids,
      include_score: true, // Always fetch scores for merge; include_scores applied post-merge
      // No cursor — §6.2: K6 never passes a cursor to K5
    });

    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    const items: K5ArmResult[] = result.page.items.map((item) => ({
      fact_id: item.fact_id,
      fact_type: item.fact_type,
      fact_key: item.fact_key,
      fact_value: item.fact_value,
      source_run_id: item.source_run_id,
      fact_created_at: item.fact_created_at,
      fact_schema_version: item.fact_schema_version,
      vector_score: item.score!,
    }));

    return { ok: true, items };
  } catch (err) {
    const message = err instanceof Error ? err.message : "K5 arm failed";
    return { ok: false, message };
  }
}
