/**
 * Agent OS — Memory Engine K1
 * Enum constants for all memory record types.
 *
 * Source: .claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md
 * Slice: K1 — Memory Engine Foundation
 *
 * Invariants:
 * - No SEMANTIC_FACT_STATUS. SemanticFact carries no mutable row status.
 *   Lifecycle is governed exclusively by SemanticFactEvent.
 * - DecisionEvent uses v1.1 taxonomy: decision_context_type / authority_class
 *   / binding_scope (not the v1.0 decision_type / deciding_role / outcome shape).
 * - FOREMAN is a runtime process identity, not an LLM agent role.
 *   It appears in WRITER_IDENTITY (enforced at write interface) but NOT in
 *   AGENT_ROLE (which records which LLM agent was invoked in a run).
 * - Write surface role sets are explicit constants — no inference from
 *   WRITER_IDENTITY required to determine who may write to which table.
 *
 * No PestFree-specific values. No K2/K3/K4/K5 additions.
 */

// ---------------------------------------------------------------------------
// LLM agent roles (spec §4.1 — agent_role field on EPISODIC_EVENT)
// FOREMAN is absent here: it is a process orchestrator, not an LLM agent.
// ---------------------------------------------------------------------------

export const AGENT_ROLE = {
  COMMAND: "command",
  ATLAS: "atlas",
  FORGE: "forge",
  SENTINEL: "sentinel",
  COMPASS: "compass",
} as const;

export type AgentRole = (typeof AGENT_ROLE)[keyof typeof AGENT_ROLE];

// ---------------------------------------------------------------------------
// Writer identities (enforced at write interface layer)
// All identities that may ever write to any memory table are listed here.
// FOREMAN is the only permitted writer for EPISODIC_EVENT and TOOL_INVOCATION.
// Specific per-table permitted sets are defined below as write surface role sets.
// ---------------------------------------------------------------------------

export const WRITER_IDENTITY = {
  FOREMAN: "foreman",
  COMMAND: "command",
  ATLAS: "atlas",
  SENTINEL: "sentinel",
  COMPASS: "compass",
} as const;

export type WriterIdentity =
  (typeof WRITER_IDENTITY)[keyof typeof WRITER_IDENTITY];

// ---------------------------------------------------------------------------
// Write surface role sets — explicit governance enforcement for K1.
// Keeps permitted writers visible in code; prevents accidental narrowing later.
// ---------------------------------------------------------------------------

// EPISODIC_EVENT and TOOL_INVOCATION: Foreman only (spec §7.1)
// Enforced via callerIdentity === WRITER_IDENTITY.FOREMAN check in write.ts.

// SEMANTIC_FACT writers (spec §4.2, §7.1): Command and Atlas
export const SEMANTIC_FACT_WRITER_ROLE = {
  COMMAND: "command",
  ATLAS: "atlas",
} as const;

export type SemanticFactWriterRole =
  (typeof SEMANTIC_FACT_WRITER_ROLE)[keyof typeof SEMANTIC_FACT_WRITER_ROLE];

// SEMANTIC_FACT_EVENT writers (spec §7.1): Atlas, Command, Sentinel, Compass
export const SEMANTIC_FACT_EVENT_WRITER_ROLE = {
  ATLAS: "atlas",
  COMMAND: "command",
  SENTINEL: "sentinel",
  COMPASS: "compass",
} as const;

export type SemanticFactEventWriterRole =
  (typeof SEMANTIC_FACT_EVENT_WRITER_ROLE)[keyof typeof SEMANTIC_FACT_EVENT_WRITER_ROLE];

// DECISION_EVENT writers (spec §4.3, §7.1): Command, Sentinel, Compass
export const DECISION_EVENT_WRITER_ROLE = {
  COMMAND: "command",
  SENTINEL: "sentinel",
  COMPASS: "compass",
} as const;

export type DecisionEventWriterRole =
  (typeof DECISION_EVENT_WRITER_ROLE)[keyof typeof DECISION_EVENT_WRITER_ROLE];

// ---------------------------------------------------------------------------
// EpisodicEvent outcome (spec §4.1)
// ---------------------------------------------------------------------------

export const EPISODIC_OUTCOME = {
  COMPLETE: "COMPLETE",
  STOPPED: "STOPPED",
  FAILED: "FAILED",
} as const;

export type EpisodicOutcome =
  (typeof EPISODIC_OUTCOME)[keyof typeof EPISODIC_OUTCOME];

// ---------------------------------------------------------------------------
// SemanticFact — fact type (spec §4.2)
// ---------------------------------------------------------------------------

export const SEMANTIC_FACT_TYPE = {
  ARCHITECTURE_DECISION: "ARCHITECTURE_DECISION",
  RESOLVED_AMBIGUITY: "RESOLVED_AMBIGUITY",
  KNOWN_CONSTRAINT: "KNOWN_CONSTRAINT",
  DOMAIN_FACT: "DOMAIN_FACT",
} as const;

export type SemanticFactType =
  (typeof SEMANTIC_FACT_TYPE)[keyof typeof SEMANTIC_FACT_TYPE];

// ---------------------------------------------------------------------------
// SemanticFactEvent — lifecycle states (spec §4.2a)
// These are the ONLY four permitted states. No PENDING. No REJECTED. No ACTIVE.
// Retrieval gate: fact returned only when latest event state = APPROVED.
// ---------------------------------------------------------------------------

export const SEMANTIC_FACT_LIFECYCLE_STATE = {
  PROPOSED: "PROPOSED",
  APPROVED: "APPROVED",
  SUPERSEDED: "SUPERSEDED",
  RETRACTED: "RETRACTED",
} as const;

export type SemanticFactLifecycleState =
  (typeof SEMANTIC_FACT_LIFECYCLE_STATE)[keyof typeof SEMANTIC_FACT_LIFECYCLE_STATE];

// ---------------------------------------------------------------------------
// DecisionEvent — v1.1 taxonomy (spec §4.3)
// Replaces v1.0 decision_type / deciding_role / outcome shape.
// ---------------------------------------------------------------------------

export const DECISION_CONTEXT_TYPE = {
  RUN: "RUN",
  SLICE: "SLICE",
  ARCHITECTURE: "ARCHITECTURE",
  GOVERNANCE: "GOVERNANCE",
  MEMORY: "MEMORY",
} as const;

export type DecisionContextType =
  (typeof DECISION_CONTEXT_TYPE)[keyof typeof DECISION_CONTEXT_TYPE];

export const AUTHORITY_CLASS = {
  BINDING: "BINDING",
  REVIEW: "REVIEW",
  ESCALATION: "ESCALATION",
  RECORD: "RECORD",
} as const;

export type AuthorityClass =
  (typeof AUTHORITY_CLASS)[keyof typeof AUTHORITY_CLASS];

export const BINDING_SCOPE = {
  RUN: "RUN",
  SLICE: "SLICE",
  ARCHITECTURE: "ARCHITECTURE",
  TRUST_ENGINE: "TRUST_ENGINE",
  MEMORY: "MEMORY",
  PROJECT: "PROJECT",
} as const;

export type BindingScope =
  (typeof BINDING_SCOPE)[keyof typeof BINDING_SCOPE];

// ---------------------------------------------------------------------------
// ToolInvocation — outcome (spec §4.4)
// ---------------------------------------------------------------------------

export const TOOL_OUTCOME = {
  SUCCESS: "SUCCESS",
  TIMEOUT: "TIMEOUT",
  ERROR: "ERROR",
} as const;

export type ToolOutcome = (typeof TOOL_OUTCOME)[keyof typeof TOOL_OUTCOME];
