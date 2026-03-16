/**
 * Agent OS — K6 Hybrid Memory Retrieval
 * K3 arm wrapper — calls querySemanticFacts with K6-computed parameters
 * and returns a normalized intermediate result set.
 *
 * Source: K6 Architecture Specification v1.1 §6, §16
 * Slice: K6 — Hybrid Memory Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 * Does not modify K3 contract. Consumes K3 as-is.
 *
 * Note: K3 SemanticFactQueryParams does not expose a source_run_id filter.
 * When structured_filters.source_run_id is supplied, the K3 arm applies it
 * as a post-filter on K3 results. This does not change the K3 contract.
 */

import { querySemanticFacts } from "../retrieval/semantic-read.js";
import type { K3ReadBackend, SemanticFactQueryParams } from "../retrieval/types.js";
import type { ValidatedHybridSearchParams } from "./types.js";

// ---------------------------------------------------------------------------
// Intermediate result — normalized shape for merge step
// ---------------------------------------------------------------------------

export interface K3ArmResult {
  readonly fact_id: string;
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: string;
  readonly source_run_id: string;
  readonly fact_created_at: string;
  readonly fact_schema_version: string;
}

export type K3ArmOutcome =
  | { readonly ok: true; readonly items: readonly K3ArmResult[] }
  | { readonly ok: false; readonly message: string };

// ---------------------------------------------------------------------------
// fetchK3Arm — call K3 querySemanticFacts with K6-derived parameters
// ---------------------------------------------------------------------------

export function fetchK3Arm(
  backend: K3ReadBackend,
  params: ValidatedHybridSearchParams,
  armFetchLimit: number,
): K3ArmOutcome {
  try {
    const k3Params: SemanticFactQueryParams = {
      project_id: params.project_id,
      fact_type: params.structured_filters.fact_type,
      created_at_from: params.structured_filters.created_at_from,
      created_at_to: params.structured_filters.created_at_to,
      limit: armFetchLimit,
      // No cursor — §6.2: K6 never passes a cursor to K3
    };

    const result = querySemanticFacts(backend, k3Params);

    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    let items: K3ArmResult[] = result.page.items.map((f) => ({
      fact_id: f.id,
      fact_type: f.fact_type,
      fact_key: f.fact_key,
      fact_value: f.fact_value,
      source_run_id: f.source_run_id,
      fact_created_at: f.created_at,
      fact_schema_version: f.schema_version,
    }));

    // Post-filter by source_run_id (not natively supported by K3)
    if (params.structured_filters.source_run_id) {
      const target = params.structured_filters.source_run_id;
      items = items.filter((i) => i.source_run_id === target);
    }

    return { ok: true, items };
  } catch (err) {
    const message = err instanceof Error ? err.message : "K3 arm failed";
    return { ok: false, message };
  }
}
