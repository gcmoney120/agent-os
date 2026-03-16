/**
 * Agent OS — K7 Memory Context Assembly
 * All type definitions.
 *
 * Source: memory-context-assembly-k7-v1.1.md
 * Slice: K7 — Memory Context Assembly
 *
 * Read-only. No writes. No mutation. No side effects.
 */

import type { SourceType } from "../hybrid-search/types.js";

// ---------------------------------------------------------------------------
// K7 error codes — §9.1
// ---------------------------------------------------------------------------

export const K7_ERROR_CODE = {
  MISSING_PROJECT_ID:      "K7_MISSING_PROJECT_ID",
  MISSING_RUN_ID:          "K7_MISSING_RUN_ID",
  NO_LANES_ENABLED:        "K7_NO_LANES_ENABLED",
  INVALID_VECTOR_DIMENSION:"K7_INVALID_VECTOR_DIMENSION",
  MISSING_MODEL_ID:        "K7_MISSING_MODEL_ID",
  MISSING_RUN_ID_LIST:     "K7_MISSING_RUN_ID_LIST",
  INVALID_SCORE_THRESHOLD: "K7_INVALID_SCORE_THRESHOLD",
  EPISODIC_LANE_FAILURE:   "K7_EPISODIC_LANE_FAILURE",
  DECISION_LANE_FAILURE:   "K7_DECISION_LANE_FAILURE",
  SEMANTIC_LANE_FAILURE:   "K7_SEMANTIC_LANE_FAILURE",
  MEMORY_ALREADY_ATTACHED: "K7_MEMORY_ALREADY_ATTACHED",
} as const;

export type K7ErrorCode = (typeof K7_ERROR_CODE)[keyof typeof K7_ERROR_CODE];

// ---------------------------------------------------------------------------
// Lane configs — §5.4, §5.5, §5.6
// ---------------------------------------------------------------------------

export interface EpisodicLaneConfig {
  readonly enabled: boolean;
  readonly event_types?: readonly string[];
  readonly max_items?: number;
  readonly include_current_run_only?: boolean;
  readonly run_id_list?: readonly string[];
}

export interface DecisionLaneConfig {
  readonly enabled: boolean;
  readonly decision_types?: readonly string[];
  readonly max_items?: number;
  readonly include_current_run_only?: boolean;
  readonly run_id_list?: readonly string[];
}

export interface SemanticLaneConfig {
  readonly enabled: boolean;
  readonly fact_type?: readonly string[];
  readonly source_run_id?: string;
  readonly min_vector_score?: number;
  readonly max_items?: number;
}

export interface LaneConfig {
  readonly episodic?: EpisodicLaneConfig;
  readonly decision?: DecisionLaneConfig;
  readonly semantic?: SemanticLaneConfig;
}

// ---------------------------------------------------------------------------
// MemoryContextRequest — §5.2
// ---------------------------------------------------------------------------

export interface MemoryContextRequest {
  readonly project_id: string;
  readonly run_id: string;
  readonly lanes: LaneConfig;
  readonly query_vector?: readonly number[];
  readonly model_id?: string;
  readonly allow_partial?: boolean;
}

// ---------------------------------------------------------------------------
// Memory item types — §7.5, §7.6, §7.7
// ---------------------------------------------------------------------------

export interface EpisodicMemoryItem {
  readonly id: string;
  readonly run_id: string;
  readonly event_type: string;
  readonly actor_role: string;
  readonly payload: Record<string, unknown> | null;
  readonly created_at: string; // ISO 8601
  readonly schema_version: string;
}

export interface DecisionMemoryItem {
  readonly id: string;
  readonly run_id: string;
  readonly episodic_event_id: string;
  readonly decision_type: string;
  readonly actor_role: string;
  readonly decision_payload: Record<string, unknown> | null;
  readonly created_at: string; // ISO 8601
  readonly schema_version: string;
}

export interface SemanticMemoryItem {
  readonly fact_id: string;
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: string;
  readonly source_run_id: string;
  readonly fact_created_at: string; // ISO 8601
  readonly fact_schema_version: string;
  readonly vector_score: number | null; // null in structured_only mode
  readonly sources: readonly SourceType[];
}

// ---------------------------------------------------------------------------
// Lane states — §7.4
// ---------------------------------------------------------------------------

export type LaneState = "ok" | "disabled" | "degraded" | "empty";

export interface LaneStates {
  readonly episodic: LaneState;
  readonly decision: LaneState;
  readonly semantic: LaneState;
}

// ---------------------------------------------------------------------------
// Lane item counts — §7.3
// ---------------------------------------------------------------------------

export interface LaneItemCounts {
  readonly episodic_included: number;
  readonly episodic_available: number;
  readonly decision_included: number;
  readonly decision_available: number;
  readonly semantic_included: number;
  readonly semantic_available: number;
}

// ---------------------------------------------------------------------------
// MemoryContext — §7.2
// ---------------------------------------------------------------------------

export type SemanticMode = "hybrid" | "structured_only" | "disabled";

export interface MemoryContext {
  readonly project_id: string;
  readonly run_id: string;
  readonly assembled_at: string; // ISO 8601; not part of determinism contract (§11)
  readonly episodic: readonly EpisodicMemoryItem[];
  readonly decisions: readonly DecisionMemoryItem[];
  readonly semantic: readonly SemanticMemoryItem[];
  readonly semantic_mode: SemanticMode;
  readonly item_counts: LaneItemCounts;
  readonly lane_states: LaneStates;
}

// ---------------------------------------------------------------------------
// MemoryContextResult — §7.1
// ---------------------------------------------------------------------------

export type MemoryContextResult =
  | { readonly ok: true; readonly context: MemoryContext }
  | { readonly ok: false; readonly code: K7ErrorCode; readonly message: string };
