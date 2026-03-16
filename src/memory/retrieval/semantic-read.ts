/**
 * Agent OS — Memory Retrieval Layer K3
 * Semantic fact read surface.
 *
 * Source: agent-os/docs/architecture/memory-retrieval-k3.md §5.3, §7.3, §7.6
 * Slice: K3 — Memory Retrieval Layer
 *
 * Read-only. No writes. No mutation. No side effects.
 * Project isolation enforced at interface boundary.
 * Deterministic ordering: (created_at ASC, id ASC).
 */

import type {
  K3ReadBackend,
  SemanticFactQueryParams,
  SemanticFact,
  SemanticFactEvent,
  Page,
} from "./types.js";

import { guardSemanticQuery } from "./query-guards.js";
import {
  compareByCreatedAtId,
  applyCreatedAtCursor,
  buildPage,
} from "./pagination.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * K2SemanticFact has no status field. All persisted facts are implicitly
 * ACTIVE. Required by the K3 SemanticFact return shape (§7.3).
 */
const IMPLICIT_STATUS = "ACTIVE";

// ---------------------------------------------------------------------------
// Projection — backend semantic fact → K3 SemanticFact return shape
//
// Backend record type is inferred from K3ReadBackend.allSemanticFacts().
// fact_value: K2 stores as Record<string, unknown>; K3 type declares string.
// status: K2 has no status field; all facts are implicitly ACTIVE.
// ---------------------------------------------------------------------------

function projectSemanticFact(
  record: ReturnType<K3ReadBackend["allSemanticFacts"]>[number],
): SemanticFact {
  return {
    id: record.id,
    project_id: record.project_id,
    fact_type: record.fact_type,
    fact_key: record.fact_key,
    fact_value: JSON.stringify(record.fact_value),
    status: IMPLICIT_STATUS,
    source_run_id: record.source_run_id,
    created_at: record.created_at.toISOString(),
    schema_version: record.schema_version,
  };
}

// ---------------------------------------------------------------------------
// Projection — backend semantic fact event → K3 SemanticFactEvent return shape
//
// Sort key is created_at (internal ordering). Projected shape exposes
// observed_at (domain timestamp).
// ---------------------------------------------------------------------------

function projectSemanticFactEvent(
  record: ReturnType<K3ReadBackend["allSemanticFactEvents"]>[number],
): SemanticFactEvent {
  return {
    id: record.id,
    semantic_fact_id: record.semantic_fact_id,
    episodic_event_id: record.episodic_event_id,
    observed_at: record.observed_at.toISOString(),
    schema_version: record.schema_version,
  };
}

// ---------------------------------------------------------------------------
// querySemanticFacts (spec §5.3)
//
// Filters: project_id, fact_type, fact_key, created_at_from, created_at_to,
// cursor, limit.
// ---------------------------------------------------------------------------

export function querySemanticFacts(
  backend: K3ReadBackend,
  params: SemanticFactQueryParams,
):
  | { readonly ok: true; readonly page: Page<SemanticFact> }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  // 1. Guard validation
  const guard = guardSemanticQuery(params);
  if (!guard.ok) {
    return { ok: false, code: guard.code, message: guard.message };
  }
  const v = guard.params;

  // 2. Load all records and filter by project_id
  let records = backend.allSemanticFacts().filter(
    (r) => r.project_id === v.project_id,
  );

  // 3. Apply filters
  if (v.fact_type !== undefined && v.fact_type.length > 0) {
    const types = new Set(v.fact_type);
    records = records.filter((r) => types.has(r.fact_type));
  }

  if (v.fact_key !== undefined && v.fact_key !== "") {
    records = records.filter((r) => r.fact_key === v.fact_key);
  }

  if (v.created_at_from !== undefined && v.created_at_from !== "") {
    records = records.filter((r) => r.created_at.toISOString() >= v.created_at_from!);
  }

  if (v.created_at_to !== undefined && v.created_at_to !== "") {
    records = records.filter((r) => r.created_at.toISOString() < v.created_at_to!);
  }

  // 4. Sort deterministically (created_at ASC, id ASC)
  const sorted = [...records].sort(compareByCreatedAtId);

  // 5. Apply cursor
  const afterCursor = v.decodedCursor
    ? applyCreatedAtCursor(sorted, v.decodedCursor)
    : sorted;

  // 6. Take limit + 1 for has_more detection
  const sliced = afterCursor.slice(0, v.resolvedLimit + 1);

  // 7. Project and build page
  const projected = sliced.map(projectSemanticFact);
  const page = buildPage(
    projected,
    v.resolvedLimit,
    (item) => item.created_at,
    (item) => item.id,
  );

  return { ok: true, page };
}

// ---------------------------------------------------------------------------
// getSemanticFactById (spec §5.3)
// ---------------------------------------------------------------------------

export function getSemanticFactById(
  backend: K3ReadBackend,
  project_id: string,
  semantic_fact_id: string,
): SemanticFact | null {
  if (!project_id) return null;
  const record = backend.allSemanticFacts().find(
    (r) => r.project_id === project_id && r.id === semantic_fact_id,
  );
  return record ? projectSemanticFact(record) : null;
}

// ---------------------------------------------------------------------------
// getSemanticFactHistory (spec §5.3)
//
// Returns all semantic_fact_event records linked to a given semantic_fact_id,
// scoped to project_id. Sorted by (created_at ASC, id ASC). Projected shape
// exposes observed_at.
// ---------------------------------------------------------------------------

export function getSemanticFactHistory(
  backend: K3ReadBackend,
  project_id: string,
  semantic_fact_id: string,
): readonly SemanticFactEvent[] {
  if (!project_id) return [];
  const records = backend.allSemanticFactEvents().filter(
    (r) => r.project_id === project_id && r.semantic_fact_id === semantic_fact_id,
  );
  const sorted = [...records].sort(compareByCreatedAtId);
  return sorted.map(projectSemanticFactEvent);
}
