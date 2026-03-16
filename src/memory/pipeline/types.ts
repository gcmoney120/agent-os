/**
 * Agent OS — Memory Write Pipeline K2
 * Internal TypeScript types mirroring the K1.1 physical schema.
 *
 * Source: agent-os/docs/architecture/memory-write-pipeline-v1.2.md
 * Source: agent-os/schemas/migration_k1_1.sql
 * Slice: K2 — Memory Write Pipeline
 *
 * These are schema-mirror types only.
 * No new public contract is introduced here.
 * schema_version is a field on every record — it is caller-supplied at the
 * write layer. No version constant is defined in this module.
 */

// ---------------------------------------------------------------------------
// Episodic event types — spec §4 supported event types.
// Derived directly from the approved architecture spec.
// ---------------------------------------------------------------------------

export const K2_EVENT_TYPE = {
  RUN_STARTED:           "RUN_STARTED",
  STEP_STARTED:          "STEP_STARTED",
  STEP_SUCCEEDED:        "STEP_SUCCEEDED",
  STEP_FAILED:           "STEP_FAILED",
  TRUST_CHANGE_DECLARED: "TRUST_CHANGE_DECLARED",
  GOVERNANCE_DECISION:   "GOVERNANCE_DECISION",
  GOVERNANCE_HALT:       "GOVERNANCE_HALT",
  CAPABILITY_USED:       "CAPABILITY_USED",
  RUN_SUCCEEDED:         "RUN_SUCCEEDED",
  RUN_FAILED:            "RUN_FAILED",
} as const;

export type K2EventType = (typeof K2_EVENT_TYPE)[keyof typeof K2_EVENT_TYPE];

// Terminal event types — spec §10.
// No writes may occur after a terminal event for a given run.
export const K2_TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  K2_EVENT_TYPE.RUN_SUCCEEDED,
  K2_EVENT_TYPE.RUN_FAILED,
]);

// ---------------------------------------------------------------------------
// K2EpisodicEvent
// Mirrors: episodic_event table (K1 migration — field set unchanged in K1.1)
// ---------------------------------------------------------------------------

export interface K2EpisodicEvent {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;    // caller-supplied
  readonly run_id: string;
  readonly session_id: string;
  readonly agent_role: string;
  readonly event_type: K2EventType;
  readonly payload: Record<string, unknown>;
  readonly occurred_at: Date;
  readonly created_at: Date;
}

// ---------------------------------------------------------------------------
// K2DecisionEvent
// Mirrors: decision_event table (K1.1 migration)
// UNIQUE (run_id, decision_type, episodic_event_id)
// ---------------------------------------------------------------------------

export interface K2DecisionEvent {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;    // caller-supplied
  readonly run_id: string;
  readonly decision_type: string;
  readonly actor_role: string;
  readonly episodic_event_id: string;
  readonly decision_payload: Record<string, unknown>;
  readonly decided_at: Date;
  readonly created_at: Date;
}

// ---------------------------------------------------------------------------
// K2SemanticFact
// Mirrors: semantic_fact table (K1.1 migration)
// UNIQUE (project_id, fact_type, fact_key)
// ---------------------------------------------------------------------------

export interface K2SemanticFact {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;    // caller-supplied
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: Record<string, unknown>;
  readonly source_run_id: string;
  readonly created_at: Date;
}

// ---------------------------------------------------------------------------
// K2SemanticFactEvent
// Mirrors: semantic_fact_event table (K1.1 migration)
// UNIQUE (semantic_fact_id, episodic_event_id)
// ---------------------------------------------------------------------------

export interface K2SemanticFactEvent {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;    // caller-supplied
  readonly semantic_fact_id: string;
  readonly episodic_event_id: string;
  readonly observed_at: Date;
  readonly created_at: Date;
}

// ---------------------------------------------------------------------------
// K2EmbeddingRecord
// Mirrors: embedding_record table (K1.1 migration)
// UNIQUE (semantic_fact_id)
// status: TEXT NOT NULL DEFAULT 'PENDING' — nullable fields: model_id, embedding
// ---------------------------------------------------------------------------

export interface K2EmbeddingRecord {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;    // caller-supplied
  readonly semantic_fact_id: string;
  readonly status: string;
  readonly model_id: string | null;
  readonly embedding: ReadonlyArray<number> | null;
  readonly created_at: Date;
}

// ---------------------------------------------------------------------------
// K2EmbeddingStatusEvent
// Mirrors: embedding_status_event table (K1.1 migration)
// UNIQUE (embedding_record_id, new_status, transitioned_at)
// previous_status: TEXT (nullable — no NOT NULL in DDL)
// ---------------------------------------------------------------------------

export interface K2EmbeddingStatusEvent {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;    // caller-supplied
  readonly embedding_record_id: string;
  readonly previous_status: string | null;
  readonly new_status: string;
  readonly transition_reason: string;
  readonly transitioned_at: Date;
  readonly created_at: Date;
}
