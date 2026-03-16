/**
 * Agent OS — Memory Engine K1
 * TypeScript interfaces for all seven K1 memory record types.
 *
 * Source: .claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md
 * Slice: K1 — Memory Engine Foundation
 *
 * Invariants encoded here:
 * - SemanticFact has NO status field. Lifecycle via SemanticFactEvent only.
 * - SemanticFact.embedding is present but optional in K1 (K4 populates it).
 * - DecisionEvent.run_id is optional/nullable (spec §4.3).
 * - DecisionEvent.rationale is required (governance audit field, not incidental).
 * - ToolInvocation.outcome is required (core captured field, not best-effort).
 * - EmbeddingRecord includes mandatory version governance fields (RES-MEM-02).
 * - All record fields are readonly — records are immutable after creation.
 * - No UPDATE or DELETE paths exist anywhere in this module.
 *
 * project_id and schema_version note:
 *   These fields are present on every record as DB columns implementing the
 *   K1 slice packet requirements: "project_id namespace required on every
 *   record" and "schema_version required on every write" (AC-K1-09).
 *   The canonical Atlas DDL blocks (spec §4.1–4.6) do not enumerate them
 *   explicitly — this gap has been flagged to Command/Atlas for the next
 *   spec revision. K1 proceeds with DB column approach per slice packet mandate.
 *
 * K1_SCHEMA_VERSION note:
 *   "1.0" is the write contract version for the K1 slice implementation,
 *   not the architecture spec version (which is v1.1). It stamps every record
 *   written by this slice, enabling future migration detection.
 */

import type {
  AgentRole,
  EpisodicOutcome,
  SemanticFactType,
  SemanticFactLifecycleState,
  SemanticFactWriterRole,
  DecisionContextType,
  AuthorityClass,
  BindingScope,
  ToolOutcome,
} from "./enums.js";

/**
 * Write contract version for K1 slice.
 * Distinct from architecture spec version (v1.1).
 * Stamped on every record written by this implementation.
 */
export const K1_SCHEMA_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Base — fields present on every memory record.
// project_id: project namespace enforcement (K1 slice packet requirement).
// schema_version: write contract versioning (K1 slice packet requirement).
// Both are DB columns in the K1 physical schema.
// ---------------------------------------------------------------------------

interface MemoryRecordBase {
  readonly id: string;
  readonly project_id: string;      // namespace enforcement — required on all writes
  readonly schema_version: string;  // write contract version — required on all writes
  readonly created_at: Date;
}

// ---------------------------------------------------------------------------
// §4.1 — EPISODIC_EVENT
// Immutable agent invocation record. run_id NOT NULL. Foreman-only write.
// ---------------------------------------------------------------------------

export interface EpisodicEvent extends MemoryRecordBase {
  readonly run_id: string;           // NOT NULL — Foreman-generated
  readonly slice_id?: string;
  readonly agent_role?: AgentRole;   // which LLM agent was invoked (not Foreman)
  readonly invocation_seq?: number;
  readonly input_hash?: string;      // SHA-256 of serialised input
  readonly output_hash?: string;     // SHA-256 of serialised output
  readonly input_ref?: string;       // blob storage key
  readonly output_ref?: string;      // blob storage key
  readonly stop_triggered: boolean;
  readonly stop_reason?: string;
  readonly outcome?: EpisodicOutcome;
}

// ---------------------------------------------------------------------------
// §4.2 — SEMANTIC_FACT
// Lifecycle-gated knowledge record. NO status field — lifecycle governed
// exclusively by SemanticFactEvent. A fact is retrievable only when its
// latest SemanticFactEvent.state === "APPROVED".
// ---------------------------------------------------------------------------

export interface SemanticFact extends MemoryRecordBase {
  readonly fact_type: SemanticFactType;
  readonly content: string;
  readonly embedding?: ReadonlyArray<number>;
  // VECTOR(1536) per spec §4.2 — populated by K4 embedding pipeline.
  // Optional in K1: field is part of the approved record shape but K4 is
  // responsible for populating it. Writing without embedding is valid in K1.
  readonly confidence: number;          // 0.00–1.00
  readonly source_run_id?: string;      // provenance
  readonly source_slice_id?: string;
  readonly valid_from: Date;
  readonly valid_until?: Date;          // null = no expiry set
  readonly superseded_by?: string;      // FK → SemanticFact.id
  readonly written_by_role: SemanticFactWriterRole;
}

// ---------------------------------------------------------------------------
// §4.2a — SEMANTIC_FACT_EVENT
// Append-only lifecycle transitions. Sole retrieval gate for SemanticFact.
// Permitted transitions:
//   PROPOSED  → APPROVED
//   APPROVED  → SUPERSEDED
//   APPROVED  → RETRACTED   (decision_event_id required)
// ---------------------------------------------------------------------------

export interface SemanticFactEvent extends MemoryRecordBase {
  readonly semantic_fact_id: string;
  readonly state: SemanticFactLifecycleState;
  readonly decision_event_id?: string;  // required when state = RETRACTED
}

// ---------------------------------------------------------------------------
// §4.3 — DECISION_EVENT
// Immutable governance audit record. Uses v1.1 taxonomy.
// run_id is NULLABLE — not required on scope-independent decisions.
// rationale is REQUIRED — governance records must carry their reasoning.
// ---------------------------------------------------------------------------

export interface DecisionEvent extends MemoryRecordBase {
  readonly decision_context_type: DecisionContextType;
  readonly authority_class: AuthorityClass;
  readonly binding_scope: BindingScope;
  readonly rationale: string;           // required — governance audit field
  readonly affected_slice_id?: string;
  readonly affected_artifact_id?: string;
  readonly run_id?: string;             // nullable — omit on scope-independent decisions
}

// ---------------------------------------------------------------------------
// §4.4 — TOOL_INVOCATION
// Immutable tool call record. run_id NOT NULL. Foreman-only write.
// Retained permanently — no purge (RES-MEM-03).
// outcome is REQUIRED — core captured field, not best-effort.
// ---------------------------------------------------------------------------

export interface ToolInvocation extends MemoryRecordBase {
  readonly run_id: string;              // NOT NULL
  readonly tool_name: string;
  readonly invoked_at: Date;
  readonly duration_ms?: number;
  readonly outcome: ToolOutcome;        // required — SUCCESS | TIMEOUT | ERROR
  readonly error_class?: string;
  readonly token_cost?: number;
}

// ---------------------------------------------------------------------------
// §4.5 — EMBEDDING_RECORD (structural stub — K4 populates)
// Version governance fields are mandatory even as stubs (RES-MEM-02):
// embedding_model and embedding_version must be present on every write.
// ---------------------------------------------------------------------------

export interface EmbeddingRecord extends MemoryRecordBase {
  readonly semantic_fact_id: string;
  readonly embedding_model: string;         // e.g. "text-embedding-3-small"
  readonly embedding_version: string;       // version pin for re-index governance
  readonly embedding_generated_at: Date;    // when embedding was produced
}

// ---------------------------------------------------------------------------
// §4.6 — EMBEDDING_STATUS_EVENT (structural stub — K4 defines state enum)
// ---------------------------------------------------------------------------

export interface EmbeddingStatusEvent extends MemoryRecordBase {
  readonly embedding_record_id: string;
  readonly state: string;                   // K4 replaces with typed enum
}
