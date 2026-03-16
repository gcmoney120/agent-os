/**
 * Agent OS — Memory Engine K1
 * Retrieval skeleton — deny-by-default, project-scoped, lifecycle-gated.
 *
 * Source: .claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md
 * Slice: K1 — Memory Engine Foundation
 *
 * Enforcement points in this module:
 *
 * AC-MEM-03  APPROVED gate for SemanticFact: a fact is returned only when its
 *             latest SemanticFactEvent.state = APPROVED. Facts with no events,
 *             or whose latest event is not APPROVED, are excluded.
 * AC-MEM-07  PROPOSED gate: facts in PROPOSED state are never returned.
 *
 * Deny-by-default routing (spec §6.1):
 *   - projectId is required on every retrieval function.
 *   - An empty or whitespace-only projectId returns an empty array.
 *   - No records cross project namespace boundaries.
 *
 * getSemanticFactEvents() — foreign-id probe prevention:
 *   When semanticFactId is supplied, the referenced fact must exist within the
 *   same project before any lifecycle events are surfaced. This prevents
 *   SEMANTIC_FACT_EVENT from becoming a side-channel lookup surface for
 *   foreign or cross-project fact IDs.
 *
 * Embedding retrieval stubs (§4.5, §4.6):
 *   getEmbeddingRecords() and getEmbeddingStatusEvents() are inert skeletons.
 *   Because EMBEDDING_RECORD and EMBEDDING_STATUS_EVENT write paths are deferred
 *   to K4, these functions correctly return [] in all K1 contexts. K1 tests
 *   assert empty results — populated results are a K4 deliverable.
 *
 * Design:
 * - All retrieval functions accept a MemoryStore parameter (dependency injection).
 *   No module-level singleton. Composition root provides the runtime store.
 *   Tests pass in isolated MemoryStore instances.
 * - This layer is a K1 skeleton. Richer query capabilities (vector search, time
 *   range filters, trust classification, token budget enforcement) are delivered
 *   in later slices as defined in spec §6.
 */

import { SEMANTIC_FACT_LIFECYCLE_STATE } from "./enums.js";
import type {
  EpisodicEvent,
  SemanticFact,
  SemanticFactEvent,
  DecisionEvent,
  ToolInvocation,
  EmbeddingRecord,
  EmbeddingStatusEvent,
} from "./schemas.js";
import type { MemoryStore } from "./store.js";

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Deny-by-default project filter.
 * Returns true only when projectId is a non-empty, non-whitespace string.
 * All retrieval functions gate on this before doing any work.
 */
function isValidProjectId(projectId: string): boolean {
  return typeof projectId === "string" && projectId.trim() !== "";
}

/**
 * Resolve the latest lifecycle state for a SemanticFact.
 * Scans the provided events in the order they were given (insertion order).
 * Last match wins. Returns undefined if no event exists for this fact.
 *
 * Used by getApprovedSemanticFacts to apply the APPROVED gate (AC-MEM-03).
 */
function resolveLatestFactState(
  events: ReadonlyArray<SemanticFactEvent>,
  factId: string
): string | undefined {
  let latestState: string | undefined;
  for (const ev of events) {
    if (ev.semantic_fact_id === factId) {
      latestState = ev.state;
    }
  }
  return latestState;
}

// ---------------------------------------------------------------------------
// §4.1 — EpisodicEvent retrieval
// Project-scoped. No additional lifecycle gate in K1.
// ---------------------------------------------------------------------------

export function getEpisodicEvents(
  store: MemoryStore,
  projectId: string
): ReadonlyArray<EpisodicEvent> {
  if (!isValidProjectId(projectId)) return [];
  return store
    .snapshotEpisodicEvents()
    .filter((r) => r.project_id === projectId);
}

// ---------------------------------------------------------------------------
// §4.2 — SemanticFact retrieval — APPROVED gate (AC-MEM-03, AC-MEM-07)
//
// A fact is returned only when:
//   1. It belongs to the requested project.
//   2. Its latest SemanticFactEvent.state === APPROVED.
//
// Facts with no lifecycle events are excluded (deny-by-default).
// Facts in PROPOSED, SUPERSEDED, or RETRACTED state are excluded.
// ---------------------------------------------------------------------------

export function getApprovedSemanticFacts(
  store: MemoryStore,
  projectId: string
): ReadonlyArray<SemanticFact> {
  if (!isValidProjectId(projectId)) return [];

  const facts = store
    .snapshotSemanticFacts()
    .filter((f) => f.project_id === projectId);

  // Take one snapshot of all events — avoids redundant snapshot calls per fact.
  const allEvents = store.snapshotSemanticFactEvents();

  return facts.filter((fact) => {
    const latestState = resolveLatestFactState(allEvents, fact.id);
    return latestState === SEMANTIC_FACT_LIFECYCLE_STATE.APPROVED;
  });
}

// ---------------------------------------------------------------------------
// §4.2a — SemanticFactEvent retrieval
// Project-scoped. Optional filter by semanticFactId.
//
// Foreign-id probe prevention:
//   When semanticFactId is supplied, the referenced fact must exist within
//   this project before any lifecycle events are surfaced. If the fact does
//   not exist in-project, returns [] regardless of how many events may exist
//   elsewhere in the store. This prevents SEMANTIC_FACT_EVENT from becoming
//   a side-channel lookup surface for foreign or cross-project fact IDs.
// ---------------------------------------------------------------------------

export function getSemanticFactEvents(
  store: MemoryStore,
  projectId: string,
  semanticFactId?: string
): ReadonlyArray<SemanticFactEvent> {
  if (!isValidProjectId(projectId)) return [];

  // When a specific fact is requested, require in-project existence first.
  if (semanticFactId !== undefined) {
    const factInProject = store
      .snapshotSemanticFacts()
      .some((f) => f.id === semanticFactId && f.project_id === projectId);
    if (!factInProject) return [];
  }

  return store.snapshotSemanticFactEvents().filter(
    (r) =>
      r.project_id === projectId &&
      (semanticFactId === undefined || r.semantic_fact_id === semanticFactId)
  );
}

// ---------------------------------------------------------------------------
// §4.3 — DecisionEvent retrieval
// Project-scoped. No additional lifecycle gate in K1.
// ---------------------------------------------------------------------------

export function getDecisionEvents(
  store: MemoryStore,
  projectId: string
): ReadonlyArray<DecisionEvent> {
  if (!isValidProjectId(projectId)) return [];
  return store
    .snapshotDecisionEvents()
    .filter((r) => r.project_id === projectId);
}

// ---------------------------------------------------------------------------
// §4.4 — ToolInvocation retrieval
// Project-scoped. No additional lifecycle gate in K1.
// ---------------------------------------------------------------------------

export function getToolInvocations(
  store: MemoryStore,
  projectId: string
): ReadonlyArray<ToolInvocation> {
  if (!isValidProjectId(projectId)) return [];
  return store
    .snapshotToolInvocations()
    .filter((r) => r.project_id === projectId);
}

// ---------------------------------------------------------------------------
// §4.5 — EmbeddingRecord retrieval (K1 stub — inert skeleton)
// Write path deferred to K4; returns [] in all K1 contexts by design.
// Project-scoped. No additional gate.
// ---------------------------------------------------------------------------

export function getEmbeddingRecords(
  store: MemoryStore,
  projectId: string
): ReadonlyArray<EmbeddingRecord> {
  if (!isValidProjectId(projectId)) return [];
  return store
    .snapshotEmbeddingRecords()
    .filter((r) => r.project_id === projectId);
}

// ---------------------------------------------------------------------------
// §4.6 — EmbeddingStatusEvent retrieval (K1 stub — inert skeleton)
// Write path deferred to K4; returns [] in all K1 contexts by design.
// Project-scoped. No additional gate.
// ---------------------------------------------------------------------------

export function getEmbeddingStatusEvents(
  store: MemoryStore,
  projectId: string
): ReadonlyArray<EmbeddingStatusEvent> {
  if (!isValidProjectId(projectId)) return [];
  return store
    .snapshotEmbeddingStatusEvents()
    .filter((r) => r.project_id === projectId);
}
