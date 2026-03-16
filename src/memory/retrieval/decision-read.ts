/**
 * Agent OS — Memory Retrieval Layer K3
 * Decision event read surface.
 *
 * Source: agent-os/docs/architecture/memory-retrieval-k3.md §5.2, §7.2
 * Slice: K3 — Memory Retrieval Layer
 *
 * Read-only. No writes. No mutation. No side effects.
 * Project isolation enforced at interface boundary.
 * Deterministic ordering: (created_at ASC, id ASC).
 */

import type {
  K3ReadBackend,
  DecisionEventQueryParams,
  DecisionEvent,
  Page,
} from "./types.js";

import { guardDecisionQuery } from "./query-guards.js";
import {
  compareByCreatedAtId,
  applyCreatedAtCursor,
  buildPage,
} from "./pagination.js";

import type { K2DecisionEvent } from "../pipeline/types.js";

// ---------------------------------------------------------------------------
// Projection — K2DecisionEvent → K3 DecisionEvent return shape
// ---------------------------------------------------------------------------

function projectDecisionEvent(record: K2DecisionEvent): DecisionEvent {
  return {
    id: record.id,
    project_id: record.project_id,
    run_id: record.run_id,
    episodic_event_id: record.episodic_event_id,
    decision_type: record.decision_type,
    actor_role: record.actor_role,
    decision_payload: record.decision_payload ?? null,
    created_at: record.created_at.toISOString(),
    schema_version: record.schema_version,
  };
}

// ---------------------------------------------------------------------------
// Query result type
// ---------------------------------------------------------------------------

export type QueryDecisionResult =
  | { readonly ok: true; readonly page: Page<DecisionEvent> }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type GetDecisionResult = DecisionEvent | null;

// ---------------------------------------------------------------------------
// queryDecisionEvents (spec §5.2)
// ---------------------------------------------------------------------------

export function queryDecisionEvents(
  backend: K3ReadBackend,
  params: DecisionEventQueryParams,
): QueryDecisionResult {
  // 1. Guard validation
  const guard = guardDecisionQuery(params);
  if (!guard.ok) {
    return { ok: false, code: guard.code, message: guard.message };
  }
  const v = guard.params;

  // 2. Load all records and filter by project_id
  let records = backend.allDecisionEvents().filter(
    (r) => r.project_id === v.project_id,
  );

  // 3. Apply filters
  if (v.run_id !== undefined && v.run_id !== "") {
    records = records.filter((r) => r.run_id === v.run_id);
  }

  if (v.decision_type !== undefined && v.decision_type.length > 0) {
    const types = new Set(v.decision_type);
    records = records.filter((r) => types.has(r.decision_type));
  }

  if (v.actor_role !== undefined && v.actor_role.length > 0) {
    const roles = new Set(v.actor_role);
    records = records.filter((r) => roles.has(r.actor_role));
  }

  if (v.episodic_event_id !== undefined && v.episodic_event_id !== "") {
    records = records.filter((r) => r.episodic_event_id === v.episodic_event_id);
  }

  if (v.created_at_from !== undefined && v.created_at_from !== "") {
    const from = new Date(v.created_at_from).getTime();
    records = records.filter((r) => r.created_at.getTime() >= from);
  }

  if (v.created_at_to !== undefined && v.created_at_to !== "") {
    const to = new Date(v.created_at_to).getTime();
    records = records.filter((r) => r.created_at.getTime() < to);
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
  const projected = sliced.map(projectDecisionEvent);
  const page = buildPage(
    projected,
    v.resolvedLimit,
    (item) => item.created_at,
    (item) => item.id,
  );

  return { ok: true, page };
}

// ---------------------------------------------------------------------------
// getDecisionEventById (spec §5.2)
// ---------------------------------------------------------------------------

export function getDecisionEventById(
  backend: K3ReadBackend,
  project_id: string,
  id: string,
): GetDecisionResult {
  if (!project_id) return null;
  const record = backend.allDecisionEvents().find(
    (r) => r.project_id === project_id && r.id === id,
  );
  return record ? projectDecisionEvent(record) : null;
}

// ---------------------------------------------------------------------------
// getDecisionsByEpisodicEvent (spec §5.2)
//
// Returns all decision events linked to a given episodic_event_id,
// scoped to project_id, sorted by (created_at ASC, id ASC).
// ---------------------------------------------------------------------------

export function getDecisionsByEpisodicEvent(
  backend: K3ReadBackend,
  project_id: string,
  episodic_event_id: string,
): readonly DecisionEvent[] {
  if (!project_id) return [];
  const records = backend.allDecisionEvents().filter(
    (r) => r.project_id === project_id && r.episodic_event_id === episodic_event_id,
  );
  const sorted = [...records].sort(compareByCreatedAtId);
  return sorted.map(projectDecisionEvent);
}
