/**
 * Agent OS — K7 Memory Context Assembly
 * Semantic lane retrieval and truncation.
 *
 * Source: memory-context-assembly-k7-v1.1.md §6.1, §6.2
 * Slice: K7 — Memory Context Assembly
 *
 * When query_vector is supplied and k6 backend is present: calls K6 hybridSearch.
 * When query_vector is absent: calls K3 querySemanticFacts (structured-only fallback).
 * When query_vector is supplied but k6 is absent: returns ok:false.
 *
 * Read-only. No writes. No mutation.
 */

import type { K3ReadBackend } from "../retrieval/types.js";
import type { K6ReadBackend } from "../hybrid-search/hybrid-search.js";
import { hybridSearch } from "../hybrid-search/hybrid-search.js";
import { querySemanticFacts } from "../retrieval/semantic-read.js";
import type {
  SemanticMemoryItem,
  SemanticLaneConfig,
  MemoryContextRequest,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants — §10
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITEMS = 10;
const CEILING_MAX_ITEMS = 50;

// Over-fetch multiplier for structured fallback (K3 has no source_run_id filter;
// K7 post-filters, so we fetch more to ensure adequate results after filtering)
const STRUCTURED_OVERFETCH_FACTOR = 3;
const STRUCTURED_OVERFETCH_CAP = 150;

// ---------------------------------------------------------------------------
// Lane result type
// ---------------------------------------------------------------------------

export type SemanticLaneResult =
  | {
      readonly ok: true;
      readonly items: SemanticMemoryItem[];
      readonly available: number;
      readonly mode: "hybrid" | "structured_only";
    }
  | { readonly ok: false };

// ---------------------------------------------------------------------------
// runSemanticLane
// ---------------------------------------------------------------------------

export function runSemanticLane(
  k3: K3ReadBackend,
  k6: K6ReadBackend | undefined,
  request: MemoryContextRequest,
): SemanticLaneResult {
  const config: SemanticLaneConfig = request.lanes.semantic!;

  // Clamp max_items silently to ceiling
  const maxItems = Math.min(config.max_items ?? DEFAULT_MAX_ITEMS, CEILING_MAX_ITEMS);

  const hasQueryVector = request.query_vector !== undefined && request.query_vector.length > 0;

  if (hasQueryVector) {
    return runHybridMode(k6, request, config, maxItems);
  }
  return runStructuredMode(k3, request, config, maxItems);
}

// ---------------------------------------------------------------------------
// Hybrid mode — K6 hybridSearch
// ---------------------------------------------------------------------------

function runHybridMode(
  k6: K6ReadBackend | undefined,
  request: MemoryContextRequest,
  config: SemanticLaneConfig,
  maxItems: number,
): SemanticLaneResult {
  if (!k6) {
    // query_vector supplied but no K6 backend — lane fails
    return { ok: false };
  }

  try {
    const result = hybridSearch(k6, {
      project_id: request.project_id,
      query_vector: request.query_vector!,
      model_id: request.model_id!,
      structured_filters: {
        fact_type: config.fact_type,
        source_run_id: config.source_run_id,
      },
      vector_filters: {
        fact_type: config.fact_type,
        source_run_id: config.source_run_id,
      },
      min_vector_score: config.min_vector_score,
      limit: maxItems,
      include_scores: true,
    });

    if (!result.ok) {
      return { ok: false };
    }

    const items = result.page.items;
    const available = items.length;

    // Truncate to max_items (K6 may return up to limit; result already ranked DESC)
    const truncated = items.slice(0, maxItems);

    const memoryItems: SemanticMemoryItem[] = truncated.map((r) => ({
      fact_id: r.fact_id,
      fact_type: r.fact_type,
      fact_key: r.fact_key,
      fact_value: r.fact_value,
      source_run_id: r.source_run_id,
      fact_created_at: r.fact_created_at,
      fact_schema_version: r.fact_schema_version,
      vector_score: r.vector_score,
      sources: r.sources,
    }));

    return { ok: true, items: memoryItems, available, mode: "hybrid" };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Structured-only mode — K3 querySemanticFacts
// ---------------------------------------------------------------------------

function runStructuredMode(
  k3: K3ReadBackend,
  request: MemoryContextRequest,
  config: SemanticLaneConfig,
  maxItems: number,
): SemanticLaneResult {
  // Over-fetch to account for post-filter by source_run_id (K3 has no such param)
  const fetchLimit = Math.min(maxItems * STRUCTURED_OVERFETCH_FACTOR, STRUCTURED_OVERFETCH_CAP);

  try {
    const result = querySemanticFacts(k3, {
      project_id: request.project_id,
      fact_type: config.fact_type as string[] | undefined,
      limit: fetchLimit,
    });

    if (!result.ok) {
      return { ok: false };
    }

    let items = [...result.page.items];

    // Post-filter by source_run_id (K3 does not expose this filter)
    if (config.source_run_id) {
      items = items.filter((f) => f.source_run_id === config.source_run_id);
    }

    // K3 returns created_at ASC. Reverse to get DESC (most recent first) — §6.2
    items.reverse();

    const available = items.length;

    // Truncate to max_items
    const truncated = items.slice(0, maxItems);

    const memoryItems: SemanticMemoryItem[] = truncated.map((f) => ({
      fact_id: f.id,
      fact_type: f.fact_type,
      fact_key: f.fact_key,
      fact_value: f.fact_value,
      source_run_id: f.source_run_id,
      fact_created_at: f.created_at,
      fact_schema_version: f.schema_version,
      vector_score: null, // structured_only mode — §7.7, AC-K7-23
      sources: ["STRUCTURED"],
    }));

    return { ok: true, items: memoryItems, available, mode: "structured_only" };
  } catch {
    return { ok: false };
  }
}
