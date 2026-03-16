/**
 * Agent OS — Runtime Integration Layer R2
 * Memory wiring: constructMemoryBackends + buildMemoryRequest
 *
 * Bridges InMemoryK2Backend (K2 records) → MemoryContextBackends (K3 shape)
 * so the K7 assembleMemoryContext call in DispatchDeps.resolveMemoryContext
 * can assemble context from in-memory K2 pipeline records.
 */

import type { K3ReadBackend } from "../memory/retrieval/types.js";
import type { MemoryContextBackends } from "../memory/memory-context/assemble.js";
import type { MemoryContextRequest, LaneConfig } from "../memory/memory-context/types.js";
import type { InMemoryK2Backend } from "../memory/pipeline/backend.js";

// ── K3ReadBackend adapter ─────────────────────────────────────────────────────

/**
 * Wrap an InMemoryK2Backend in the K3ReadBackend interface.
 *
 * K3ReadBackend.allXxx() → InMemoryK2Backend.snapshotXxx()
 * The snapshot returns a copied array so the backend's internal state
 * is not exposed.
 */
function k3AdapterFrom(backend: InMemoryK2Backend): K3ReadBackend {
  return {
    allEpisodicEvents: () => backend.snapshotEpisodicEvents(),
    allDecisionEvents: () => backend.snapshotDecisionEvents(),
    allSemanticFacts: () => backend.snapshotSemanticFacts(),
    allSemanticFactEvents: () => backend.snapshotSemanticFactEvents(),
    allEmbeddingRecords: () => backend.snapshotEmbeddingRecords(),
    allEmbeddingStatusEvents: () => backend.snapshotEmbeddingStatusEvents(),
  };
}

// ── constructMemoryBackends ───────────────────────────────────────────────────

/**
 * Construct MemoryContextBackends from an InMemoryK2Backend.
 *
 * The K7 assembleMemoryContext function requires a MemoryContextBackends with:
 *   - k3: K3ReadBackend — wraps InMemoryK2Backend snapshot methods
 *   - k6?: K6ReadBackend — omitted; semantic lane degrades gracefully when absent
 *
 * The k6 (hybrid-search) backend is intentionally omitted per the R-series
 * infrastructure decision: embedding is deferred. The semantic lane will report
 * state "disabled" when k6 is absent.
 */
export function constructMemoryBackends(backend: InMemoryK2Backend): MemoryContextBackends {
  return {
    k3: k3AdapterFrom(backend),
    // k6 intentionally absent — embedding deferred per R-series decision
  };
}

// ── buildMemoryRequest ────────────────────────────────────────────────────────

/**
 * Build a MemoryContextRequest for use in DispatchDeps.resolveMemoryContext.
 *
 * project_id is derived from projectRoot (normalized as-is — the projectRoot
 * string serves as the project namespace).
 *
 * Default lane config: episodic enabled, decision enabled, semantic disabled
 * (no embedding backend in R-series).
 */
export function buildMemoryRequest(
  runId: string,
  projectRoot: string,
  laneConfig?: LaneConfig,
): MemoryContextRequest {
  const lanes: LaneConfig = laneConfig ?? {
    episodic: { enabled: true },
    decision: { enabled: true },
    // semantic lane omitted — degrades gracefully without K6
  };

  return {
    project_id: projectRoot,
    run_id: runId,
    lanes,
    allow_partial: true,
  };
}
