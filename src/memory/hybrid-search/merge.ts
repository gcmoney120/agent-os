/**
 * Agent OS — K6 Hybrid Memory Retrieval
 * Deduplication logic — §8.
 *
 * Pure function: takes K3 and K5 intermediate result sets,
 * returns a merged deduplicated set with provenance tagging.
 *
 * Source: K6 Architecture Specification v1.1 §8
 * Slice: K6 — Hybrid Memory Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 */

import type { HybridSearchResult, SourceType } from "./types.js";
import type { K3ArmResult } from "./arm-k3.js";
import type { K5ArmResult } from "./arm-k5.js";

// ---------------------------------------------------------------------------
// mergeArmResults — §8 Deduplication Policy
//
// Deduplication key: fact_id (§8.1)
// Collision resolution (§8.2):
//   - Canonical fact fields taken from K3 arm (authoritative structured read)
//   - vector_score taken from K5 arm
//   - sources = ['STRUCTURED', 'VECTOR']
// Timing: after both arms complete, before ranking (§8.3)
// ---------------------------------------------------------------------------

export function mergeArmResults(
  k3Items: readonly K3ArmResult[],
  k5Items: readonly K5ArmResult[],
): HybridSearchResult[] {
  const merged = new Map<string, HybridSearchResult>();

  // Index K5 results first so K3 can override fact fields on collision
  for (const item of k5Items) {
    merged.set(item.fact_id, {
      fact_id: item.fact_id,
      fact_type: item.fact_type,
      fact_key: item.fact_key,
      fact_value: item.fact_value,
      source_run_id: item.source_run_id,
      fact_created_at: item.fact_created_at,
      fact_schema_version: item.fact_schema_version,
      sources: ["VECTOR"] as readonly SourceType[],
      vector_score: item.vector_score,
    });
  }

  // Overlay K3 results — K3 is authoritative for fact fields on collision
  for (const item of k3Items) {
    const existing = merged.get(item.fact_id);

    if (existing) {
      // Collision: fact returned by both arms
      // K3 fact fields are authoritative (§8.2)
      // K5 vector_score preserved
      merged.set(item.fact_id, {
        fact_id: item.fact_id,
        fact_type: item.fact_type,
        fact_key: item.fact_key,
        fact_value: item.fact_value,
        source_run_id: item.source_run_id,
        fact_created_at: item.fact_created_at,
        fact_schema_version: item.fact_schema_version,
        sources: ["STRUCTURED", "VECTOR"] as readonly SourceType[],
        vector_score: existing.vector_score,
      });
    } else {
      // K3-only fact
      merged.set(item.fact_id, {
        fact_id: item.fact_id,
        fact_type: item.fact_type,
        fact_key: item.fact_key,
        fact_value: item.fact_value,
        source_run_id: item.source_run_id,
        fact_created_at: item.fact_created_at,
        fact_schema_version: item.fact_schema_version,
        sources: ["STRUCTURED"] as readonly SourceType[],
        vector_score: null,
      });
    }
  }

  return Array.from(merged.values());
}
