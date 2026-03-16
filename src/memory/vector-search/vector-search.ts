/**
 * Agent OS — K5 Memory Retrieval Layer
 * Vector search read surface — vectorSearch.
 *
 * Source: K5 Vector Search Retrieval specification v1.1 §5.1
 * Slice: K5 — Vector Search Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 * Project isolation enforced at interface boundary.
 * Model homogeneity enforced.
 * COMPLETE-only embedding records searched.
 * Deterministic ordering: (similarity DESC, created_at ASC, id ASC).
 */

import type {
  VectorSearchParams,
  VectorSearchResult,
  VectorSearchResultItem,
  K5ReadBackend,
} from "./types.js";

import { guardVectorSearch } from "./query-guards.js";
import {
  compareBySimilarity,
  applyVectorCursor,
  buildVectorPage,
} from "./pagination.js";

// ---------------------------------------------------------------------------
// Cosine similarity — §6.1
//
// cosine_similarity = dot(a, b) / (||a|| * ||b||)
// Returns 0.0–1.0 for normalized vectors. Handles zero-magnitude gracefully.
// ---------------------------------------------------------------------------

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ---------------------------------------------------------------------------
// vectorSearch — §5.1
//
// Single K5 read surface. Returns VectorSearchResult (ok/fail union).
// ---------------------------------------------------------------------------

export function vectorSearch(
  backend: K5ReadBackend,
  params: VectorSearchParams,
): VectorSearchResult {
  // 1. Guard validation
  const guard = guardVectorSearch(params);
  if (!guard.ok) {
    return { ok: false, code: guard.code, message: guard.message };
  }
  const v = guard.params;

  // 2. Load COMPLETE embedding records filtered by project_id + model_id
  const embeddingRecords = backend.allEmbeddingRecords().filter(
    (r) =>
      r.project_id === v.project_id &&
      r.model_id === v.model_id &&
      r.status === "COMPLETE" &&
      r.embedding !== null,
  );

  // 3. Build fact lookup map (project-scoped)
  const factMap = new Map(
    backend
      .allSemanticFacts()
      .filter((f) => f.project_id === v.project_id)
      .map((f) => [f.id, f]),
  );

  // 4. Join embedding records with semantic facts + compute similarity
  type ScoredRecord = {
    readonly _similarity: number;
    readonly _created_at: Date;
    readonly _id: string;
    readonly item: VectorSearchResultItem;
  };

  let scored: ScoredRecord[] = [];

  for (const er of embeddingRecords) {
    const fact = factMap.get(er.semantic_fact_id);
    if (!fact) continue; // FK integrity — skip orphans

    // Apply fact_type filter
    if (v.fact_type !== undefined && v.fact_type.length > 0) {
      const types = new Set(v.fact_type);
      if (!types.has(fact.fact_type)) continue;
    }

    // Apply source_run_id filter
    if (v.source_run_id !== undefined && fact.source_run_id !== v.source_run_id) continue;

    // Apply exclude_fact_ids filter
    if (v.exclude_fact_ids !== undefined && v.exclude_fact_ids.includes(fact.id)) continue;

    // Compute cosine similarity
    const similarity = cosineSimilarity(v.query_vector, er.embedding as number[]);

    // Apply min_score filter
    if (v.min_score !== undefined && similarity < v.min_score) continue;

    const item: VectorSearchResultItem = {
      fact_id: fact.id,
      fact_type: fact.fact_type,
      fact_key: fact.fact_key,
      fact_value: JSON.stringify(fact.fact_value),
      source_run_id: fact.source_run_id,
      fact_created_at: fact.created_at.toISOString(),
      fact_schema_version: fact.schema_version,
      embedding_record_id: er.id,
      model_id: er.model_id!,
      embedding_created_at: er.created_at.toISOString(),
      ...(v.include_score ? { score: similarity } : {}),
    };

    scored.push({
      _similarity: similarity,
      _created_at: er.created_at,
      _id: er.id,
      item,
    });
  }

  // 5. Sort: similarity DESC, created_at ASC, id ASC
  scored.sort(compareBySimilarity);

  // 6. Apply cursor
  if (v.decodedCursor) {
    scored = applyVectorCursor(scored, v.decodedCursor);
  }

  // 7. Take limit + 1 for has_more detection
  const sliced = scored.slice(0, v.resolvedLimit + 1);

  // 8. Build page
  const items = sliced.map((s) => s.item);
  const similarities = sliced.map((s) => s._similarity);
  const createdAts = sliced.map((s) => s._created_at.toISOString());
  const ids = sliced.map((s) => s._id);

  const page = buildVectorPage(items, v.resolvedLimit, similarities, createdAts, ids);

  return { ok: true, page };
}
