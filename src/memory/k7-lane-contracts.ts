/**
 * Agent OS — K8-C Knowledge Layer Contract Declaration
 *
 * Slice: K8-C — Knowledge Layer Contract Extraction + Confirmation
 * Source: K8-C v3 specification
 * Status: AWAITING GOVERNANCE REVIEW
 *
 * This file declares confirmed contract-reference types (K7Confirmed* names)
 * for the K7 MemoryContext lane items, exactly as extracted from the K7
 * retrieval implementation. It is a read-only reference artifact.
 * All types mirror the shapes currently output by K7 — no invented fields,
 * no absent fields.
 *
 * Authoritative K7 type definitions live in:
 *   agent-os/src/memory/memory-context/types.ts
 *
 * If those types change, this file must be updated in a subsequent
 * contract extraction slice.
 *
 * Provenance key:
 *   [SPEC §N]     — Memory Engine Architecture Spec v1.1 §N
 *   [K7 SRC]      — K7 implementation source only (not in Spec v1.1)
 *   [DISCREPANCY] — present in both but with name or type difference
 *
 * Extraction report: agent-os/docs/K8-C-extraction-report.md
 */

import type { SourceType } from "./hybrid-search/types.js";

// Re-export SourceType so consumers of this contract file have a single import point.
export type { SourceType };

// ---------------------------------------------------------------------------
// K7ConfirmedEpisodicItem
//
// The exact shape of items in MemoryContext.episodic[].
// Projected at: lane-episodic.ts:142–150
// Type defined at: memory-context/types.ts:84–92
// Upstream raw type: retrieval/types.ts:36–45 (EpisodicEvent)
// ---------------------------------------------------------------------------

export interface K7ConfirmedEpisodicItem {
  /** [SPEC §4.1] EPISODIC_EVENT.id — UUID primary key */
  readonly id: string;

  /** [SPEC §4.1] EPISODIC_EVENT.run_id */
  readonly run_id: string;

  /**
   * [K7 SRC] retrieval/types.ts:40
   * Not present in Spec §4.1 EPISODIC_EVENT schema.
   */
  readonly event_type: string;

  /**
   * [DISCREPANCY] retrieval/types.ts:41
   * Spec §4.1 uses field name `agent_role`; K7 renames to `actor_role`.
   */
  readonly actor_role: string;

  /**
   * [K7 SRC] retrieval/types.ts:42
   * Not present in Spec §4.1 EPISODIC_EVENT schema.
   * Null when no payload was recorded.
   */
  readonly payload: Record<string, unknown> | null;

  /** [SPEC §4.1] EPISODIC_EVENT.created_at — ISO 8601 */
  readonly created_at: string;

  /**
   * [K7 SRC] retrieval/types.ts:44
   * Not present in Spec §4.1 EPISODIC_EVENT schema.
   */
  readonly schema_version: string;
}

// ---------------------------------------------------------------------------
// K7ConfirmedDecisionItem
//
// The exact shape of items in MemoryContext.decisions[].
// Projected at: lane-decision.ts:86–95
// Type defined at: memory-context/types.ts:94–103
// Upstream raw type: retrieval/types.ts:51–61 (DecisionEvent)
// ---------------------------------------------------------------------------

export interface K7ConfirmedDecisionItem {
  /** [SPEC §4.3] DECISION_EVENT.id — UUID primary key */
  readonly id: string;

  /** [SPEC §4.3] DECISION_EVENT.run_id — nullable in Spec; always present in K7 output */
  readonly run_id: string;

  /**
   * [K7 SRC] retrieval/types.ts:55
   * Not present in Spec §4.3 DECISION_EVENT schema.
   */
  readonly episodic_event_id: string;

  /**
   * [DISCREPANCY] retrieval/types.ts:56
   * Spec §4.3 uses `decision_context_type` with typed enum
   * (RUN | SLICE | ARCHITECTURE | GOVERNANCE | MEMORY).
   * K7 uses `decision_type: string`.
   */
  readonly decision_type: string;

  /**
   * [K7 SRC] retrieval/types.ts:57
   * Not present in Spec §4.3 DECISION_EVENT schema.
   */
  readonly actor_role: string;

  /**
   * [K7 SRC] retrieval/types.ts:58
   * Not present in Spec §4.3 DECISION_EVENT schema.
   * Null when no payload was recorded.
   */
  readonly decision_payload: Record<string, unknown> | null;

  /** [SPEC §4.3] DECISION_EVENT.created_at — ISO 8601 */
  readonly created_at: string;

  /**
   * [K7 SRC] retrieval/types.ts:60
   * Not present in Spec §4.3 DECISION_EVENT schema.
   */
  readonly schema_version: string;
}

// ---------------------------------------------------------------------------
// K7ConfirmedSemanticItem
//
// The exact shape of items in MemoryContext.semantic[].
// Two projection paths produce identical output shapes:
//   Hybrid mode:           lane-semantic.ts:115–125 (from HybridSearchResult)
//   Structured-only mode:  lane-semantic.ts:172–183 (from SemanticFact)
// Type defined at: memory-context/types.ts:105–115
// ---------------------------------------------------------------------------

export interface K7ConfirmedSemanticItem {
  /**
   * [DISCREPANCY] Spec §4.2 uses field name `id` on SEMANTIC_FACT.
   * K7 renames to `fact_id` in both projection paths.
   * Hybrid source: hybrid-search/types.ts:82
   * Structured source: lane-semantic.ts:173
   */
  readonly fact_id: string;

  /** [SPEC §4.2] SEMANTIC_FACT.fact_type */
  readonly fact_type: string;

  /**
   * [K7 SRC] retrieval/types.ts:71
   * Not present in Spec §4.2. Spec §4.2 uses a single `content: TEXT` field.
   * K7 splits content into `fact_key` + `fact_value`.
   */
  readonly fact_key: string;

  /**
   * [DISCREPANCY] retrieval/types.ts:72
   * Spec §4.2 uses `content: TEXT` (single field).
   * K7 splits into `fact_key` + `fact_value`.
   */
  readonly fact_value: string;

  /** [SPEC §4.2] SEMANTIC_FACT.source_run_id */
  readonly source_run_id: string;

  /**
   * [DISCREPANCY] Spec §4.2 uses field name `created_at` on SEMANTIC_FACT.
   * K7 renames to `fact_created_at`. ISO 8601.
   */
  readonly fact_created_at: string;

  /**
   * [K7 SRC] retrieval/types.ts:76
   * Not present in Spec §4.2.
   */
  readonly fact_schema_version: string;

  /**
   * [K7 SRC] memory-context/types.ts:113
   * Not present in Spec §4.2.
   * null when vector retrieval was not used for this item.
   */
  readonly vector_score: number | null;

  /**
   * [K7 SRC] memory-context/types.ts:114
   * Not present in Spec §4.2.
   * SourceType = "STRUCTURED" | "VECTOR" (hybrid-search/types.ts:15)
   */
  readonly sources: readonly SourceType[];
}

// ---------------------------------------------------------------------------
// K7ConfirmedMemoryContext
//
// The confirmed container type assembled by assembleMemoryContext.
// Assembly source: assemble.ts:134–155
// Type defined at: memory-context/types.ts:148–158
// ---------------------------------------------------------------------------

export interface K7ConfirmedMemoryContext {
  /**
   * [K7 SRC] Derived from MemoryContextRequest.project_id.
   * Not defined as a container-level field in Spec §4.
   */
  readonly project_id: string;

  /**
   * [K7 SRC] Derived from MemoryContextRequest.run_id.
   * Not defined as a container-level field in Spec §4.
   */
  readonly run_id: string;

  /**
   * [K7 SRC] ISO 8601 timestamp of context assembly. assemble.ts:137
   * Not defined in Spec §4.
   * Explicitly excluded from the K7 determinism contract (memory-context/types.ts:151).
   */
  readonly assembled_at: string;

  /**
   * [SPEC §3.1] Episodic Memory lane items.
   * Derived from EPISODIC_EVENT records. assemble.ts:138
   */
  readonly episodic: readonly K7ConfirmedEpisodicItem[];

  /**
   * [SPEC §3.3] Decision Memory lane items.
   * Derived from DECISION_EVENT records. assemble.ts:139
   */
  readonly decisions: readonly K7ConfirmedDecisionItem[];

  /**
   * [SPEC §3.2] Semantic Memory lane items.
   * Derived from APPROVED SEMANTIC_FACT records. assemble.ts:140
   */
  readonly semantic: readonly K7ConfirmedSemanticItem[];

  /**
   * [K7 SRC] Retrieval path used for the semantic lane. assemble.ts:141
   * "hybrid" | "structured_only" | "disabled"
   * Not defined in Spec §4.
   */
  readonly semantic_mode: "hybrid" | "structured_only" | "disabled";

  /**
   * [K7 SRC] Item counts per lane. assemble.ts:142–149
   * Not defined in Spec §4.
   */
  readonly item_counts: {
    readonly episodic_included: number;
    readonly episodic_available: number;
    readonly decision_included: number;
    readonly decision_available: number;
    readonly semantic_included: number;
    readonly semantic_available: number;
  };

  /**
   * [K7 SRC] Health state per lane after assembly. assemble.ts:150–154
   * Not defined in Spec §4.
   */
  readonly lane_states: {
    readonly episodic: "ok" | "disabled" | "degraded" | "empty";
    readonly decision: "ok" | "disabled" | "degraded" | "empty";
    readonly semantic: "ok" | "disabled" | "degraded" | "empty";
  };
}
