/**
 * Agent OS — Memory Retrieval Layer K3
 * Episodic event read surface.
 *
 * Source: agent-os/docs/architecture/memory-retrieval-k3.md §5.1, §7.1
 * Slice: K3 — Memory Retrieval Layer
 *
 * Read-only. No writes. No mutation. No side effects.
 * Project isolation enforced at interface boundary.
 * Deterministic ordering: (created_at ASC, id ASC).
 */

import type {
  K3ReadBackend,
  EpisodicEventQueryParams,
  EpisodicEvent,
  Page,
} from "./types.js";

import { guardEpisodicQuery } from "./query-guards.js";
import {
  compareByCreatedAtId,
  applyCreatedAtCursor,
  buildPage,
} from "./pagination.js";

import type { K2EpisodicEvent } from "../pipeline/types.js";

// ---------------------------------------------------------------------------
// Projection — K2EpisodicEvent → K3 EpisodicEvent return shape
// ---------------------------------------------------------------------------

function projectEpisodicEvent(record: K2EpisodicEvent): EpisodicEvent {
  return {
    id: record.id,
    project_id: record.project_id,
    run_id: record.run_id,
    event_type: record.event_type,
    actor_role: record.agent_role,
    payload: record.payload ?? null,
    created_at: record.created_at.toISOString(),
    schema_version: record.schema_version,
  };
}

// ---------------------------------------------------------------------------
// Query result type
// ---------------------------------------------------------------------------

export type QueryEpisodicResult =
  | { readonly ok: true; readonly page: Page<EpisodicEvent> }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type GetEpisodicResult = EpisodicEvent | null;

// ---------------------------------------------------------------------------
// queryEpisodicEvents (spec §5.1)
// ---------------------------------------------------------------------------

export function queryEpisodicEvents(
  backend: K3ReadBackend,
  params: EpisodicEventQueryParams,
): QueryEpisodicResult {
  // 1. Guard validation
  const guard = guardEpisodicQuery(params);
  if (!guard.ok) {
    return { ok: false, code: guard.code, message: guard.message };
  }
  const v = guard.params;

  // 2. Load all records and filter by project_id
  let records = backend.allEpisodicEvents().filter(
    (r) => r.project_id === v.project_id,
  );

  // 3. Apply filters
  if (v.run_id !== undefined && v.run_id !== "") {
    records = records.filter((r) => r.run_id === v.run_id);
  }

  if (v.event_type !== undefined && v.event_type.length > 0) {
    const types = new Set(v.event_type);
    records = records.filter((r) => types.has(r.event_type));
  }

  if (v.actor_role !== undefined && v.actor_role.length > 0) {
    const roles = new Set(v.actor_role);
    records = records.filter((r) => roles.has(r.agent_role));
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
  const projected = sliced.map(projectEpisodicEvent);
  const page = buildPage(
    projected,
    v.resolvedLimit,
    (item) => item.created_at,
    (item) => item.id,
  );

  return { ok: true, page };
}

// ---------------------------------------------------------------------------
// getEpisodicEventById (spec §5.1)
// ---------------------------------------------------------------------------

export function getEpisodicEventById(
  backend: K3ReadBackend,
  project_id: string,
  id: string,
): GetEpisodicResult {
  if (!project_id) return null;
  const record = backend.allEpisodicEvents().find(
    (r) => r.project_id === project_id && r.id === id,
  );
  return record ? projectEpisodicEvent(record) : null;
}
