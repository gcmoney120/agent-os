/**
 * Agent OS — K6 Hybrid Memory Retrieval
 * Ranking logic — §7.
 *
 * Pure function: sorts the merged deduplicated set by the three-key
 * ordering rule defined in §7.1.
 *
 * Source: K6 Architecture Specification v1.1 §7
 * Slice: K6 — Hybrid Memory Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 */

import type { HybridSearchResult } from "./types.js";

// ---------------------------------------------------------------------------
// rankMergedResults — §7.1 Primary Ordering Rule
//
// 1. vector_score DESC — scored facts above unscored (null ranks below all)
// 2. fact_created_at ASC — tie-breaker
// 3. fact_id ASC — final deterministic tie-breaker
//
// No boosting, no capping, no interleaving heuristics (§7.4).
// ---------------------------------------------------------------------------

export function rankMergedResults(
  items: readonly HybridSearchResult[],
): HybridSearchResult[] {
  return [...items].sort(compareHybridResults);
}

export function compareHybridResults(
  a: HybridSearchResult,
  b: HybridSearchResult,
): number {
  // Priority 1: vector_score DESC, nulls last
  const aScored = a.vector_score !== null;
  const bScored = b.vector_score !== null;

  if (aScored && !bScored) return -1;
  if (!aScored && bScored) return 1;
  if (aScored && bScored) {
    const scoreDiff = b.vector_score! - a.vector_score!;
    if (scoreDiff !== 0) return scoreDiff;
  }

  // Priority 2: fact_created_at ASC
  if (a.fact_created_at < b.fact_created_at) return -1;
  if (a.fact_created_at > b.fact_created_at) return 1;

  // Priority 3: fact_id ASC
  if (a.fact_id < b.fact_id) return -1;
  if (a.fact_id > b.fact_id) return 1;

  return 0;
}
