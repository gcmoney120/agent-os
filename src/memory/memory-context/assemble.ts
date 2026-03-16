/**
 * Agent OS — K7 Memory Context Assembly
 * Top-level orchestrator: assembleMemoryContext.
 *
 * Source: memory-context-assembly-k7-v1.1.md §5.1, §6, §7, §8, §9
 * Slice: K7 — Memory Context Assembly
 *
 * Validates request, runs enabled lanes independently, handles allow_partial,
 * packs MemoryContext. No writes. No mutation. No side effects.
 */

import type { K3ReadBackend } from "../retrieval/types.js";
import type { K6ReadBackend } from "../hybrid-search/hybrid-search.js";
import { validateMemoryContextRequest } from "./params.js";
import { runEpisodicLane } from "./lane-episodic.js";
import { runDecisionLane } from "./lane-decision.js";
import { runSemanticLane } from "./lane-semantic.js";
import type {
  MemoryContextRequest,
  MemoryContextResult,
  MemoryContext,
  EpisodicMemoryItem,
  DecisionMemoryItem,
  SemanticMemoryItem,
  LaneState,
  SemanticMode,
} from "./types.js";
import { K7_ERROR_CODE } from "./types.js";

// ---------------------------------------------------------------------------
// Backend injection interface
// ---------------------------------------------------------------------------

export interface MemoryContextBackends {
  readonly k3: K3ReadBackend;
  readonly k6?: K6ReadBackend;
}

// ---------------------------------------------------------------------------
// assembleMemoryContext — §5.1 canonical interface
// ---------------------------------------------------------------------------

export function assembleMemoryContext(
  backends: MemoryContextBackends,
  request: MemoryContextRequest,
): MemoryContextResult {
  // Stage 0: Validate params before any retrieval — §5.7
  const validation = validateMemoryContextRequest(request);
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  const allowPartial = request.allow_partial === true;

  const episodicEnabled = request.lanes.episodic?.enabled === true;
  const decisionEnabled = request.lanes.decision?.enabled === true;
  const semanticEnabled = request.lanes.semantic?.enabled === true;

  // Stage 1: Retrieve (lanes are independent — §6.1)
  // Episodic lane
  let episodicItems: EpisodicMemoryItem[] = [];
  let episodicAvailable = 0;
  let episodicState: LaneState = "disabled";

  if (episodicEnabled) {
    const r = runEpisodicLane(backends.k3, request);
    if (!r.ok) {
      if (!allowPartial) {
        return {
          ok: false,
          code: K7_ERROR_CODE.EPISODIC_LANE_FAILURE,
          message: "Episodic lane retrieval failed",
        };
      }
      episodicState = "degraded";
    } else {
      episodicItems = r.items;
      episodicAvailable = r.available;
      episodicState = r.items.length === 0 ? "empty" : "ok";
    }
  }

  // Decision lane
  let decisionItems: DecisionMemoryItem[] = [];
  let decisionAvailable = 0;
  let decisionState: LaneState = "disabled";

  if (decisionEnabled) {
    const r = runDecisionLane(backends.k3, request);
    if (!r.ok) {
      if (!allowPartial) {
        return {
          ok: false,
          code: K7_ERROR_CODE.DECISION_LANE_FAILURE,
          message: "Decision lane retrieval failed",
        };
      }
      decisionState = "degraded";
    } else {
      decisionItems = r.items;
      decisionAvailable = r.available;
      decisionState = r.items.length === 0 ? "empty" : "ok";
    }
  }

  // Semantic lane
  let semanticItems: SemanticMemoryItem[] = [];
  let semanticAvailable = 0;
  let semanticState: LaneState = "disabled";
  let semanticMode: SemanticMode = "disabled";

  if (semanticEnabled) {
    const r = runSemanticLane(backends.k3, backends.k6, request);
    if (!r.ok) {
      if (!allowPartial) {
        return {
          ok: false,
          code: K7_ERROR_CODE.SEMANTIC_LANE_FAILURE,
          message: "Semantic lane retrieval failed",
        };
      }
      semanticState = "degraded";
      // semantic_mode reflects the intended mode even on degraded result
      semanticMode = request.query_vector !== undefined ? "hybrid" : "structured_only";
    } else {
      semanticItems = r.items;
      semanticAvailable = r.available;
      semanticState = r.items.length === 0 ? "empty" : "ok";
      semanticMode = r.mode;
    }
  }

  // Stage 3: Pack MemoryContext — §6.3
  const context: MemoryContext = {
    project_id: request.project_id,
    run_id: request.run_id,
    assembled_at: new Date().toISOString(),
    episodic: episodicItems,
    decisions: decisionItems,
    semantic: semanticItems,
    semantic_mode: semanticMode,
    item_counts: {
      episodic_included: episodicItems.length,
      episodic_available: episodicAvailable,
      decision_included: decisionItems.length,
      decision_available: decisionAvailable,
      semantic_included: semanticItems.length,
      semantic_available: semanticAvailable,
    },
    lane_states: {
      episodic: episodicState,
      decision: decisionState,
      semantic: semanticState,
    },
  };

  return { ok: true, context };
}
