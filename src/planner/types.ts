/**
 * Agent OS — Planner Subsystem P1-S1: Domain Types
 *
 * All enums and interfaces for the P1 Planner per Atlas P1 v1.1.
 * Types only — no runtime logic, no side effects.
 */

// ── Enums (closed sets, v1) ─────────────────────────────────────────────────

export type ScopeTag = "KNOWLEDGE" | "TRUST" | "INFRA" | "PRODUCT" | "MULTI";

export type AgentRole = "Command" | "Atlas" | "Forge" | "Sentinel" | "Compass";

export type StepStatus = "PENDING" | "RUNNING" | "PASS" | "FAIL" | "SKIPPED";

export type TrustDomain =
  | "AUDIT_LOGS"
  | "IDENTITY"
  | "AGREEMENTS"
  | "ACCESS_STATE";

export type PlanStatus =
  | "IDLE"
  | "GOAL_RECEIVED"
  | "DECOMPOSING"
  | "PLAN_DRAFT"
  | "SENTINEL_PREREVIEW"
  | "REVIEW_PENDING"
  | "APPROVED"
  | "EXECUTING"
  | "COMPLETE"
  | "REJECTED"
  | "HALTED";

// ── Planner Inputs (§3) ─────────────────────────────────────────────────────

export interface GoalPayload {
  goal_id: string;
  goal_text: string;
  scope_tag: ScopeTag;
  trust_touch: boolean;
  constraints?: string[];
  non_goals?: string[];
  submitted_by: string;
  submitted_at: string;
}

// ── Plan Step (§4.2) ────────────────────────────────────────────────────────

export interface PlanStep {
  step_id: string;
  sequence: number;
  label: string;
  agent: AgentRole;
  input_contract: string;
  output_contract: string;
  acceptance_criteria: string[];
  depends_on: string[];
  trust_touch: boolean;
  trust_touch_domains: TrustDomain[];
  status: StepStatus;
  result_ref: string | null;
}

// ── Version Record (§4.3) ───────────────────────────────────────────────────

export interface VersionRecord {
  version: number;
  status: "REJECTED" | "SUPERSEDED";
  rejected_at: string;
  rejection_reason: string;
  plan_hash: string | null;
  snapshot: PlanStep[];
}

// ── Sentinel Record (§4.4) ──────────────────────────────────────────────────

export interface SentinelRecord {
  result: "PASS" | "FAIL";
  reviewed_at: string;
  findings: string[];
  reviewed_by: "Sentinel";
}

// ── Plan Artifact (§4.1) ────────────────────────────────────────────────────

export interface PlanArtifact {
  plan_id: string;
  goal_id: string;
  version: number;
  version_history: VersionRecord[];
  status: PlanStatus;
  scope_tag: ScopeTag;
  trust_sensitive: boolean;
  steps: PlanStep[];
  non_goals: string[];
  sentinel_prereview: SentinelRecord | null;
  submitted_at: string;
  approved_at: string | null;
  approved_by: "Command" | null;
  approval_acknowledgements: string[];
  plan_hash: string | null;
  run_id: string | null;
  executed_at: string | null;
  archived_at: string | null;
}

// ── Validation Result Types ─────────────────────────────────────────────────

export interface ValidationOk {
  ok: true;
}

export interface ValidationFail {
  ok: false;
  code: string;
  message: string;
  detail?: unknown;
}

export type ValidationResult = ValidationOk | ValidationFail;

// ── Closed enum value sets (for runtime validation) ─────────────────────────

export const SCOPE_TAGS: ReadonlySet<string> = new Set<ScopeTag>([
  "KNOWLEDGE",
  "TRUST",
  "INFRA",
  "PRODUCT",
  "MULTI",
]);

export const AGENT_ROLES: ReadonlySet<string> = new Set<AgentRole>([
  "Command",
  "Atlas",
  "Forge",
  "Sentinel",
  "Compass",
]);

export const STEP_STATUSES: ReadonlySet<string> = new Set<StepStatus>([
  "PENDING",
  "RUNNING",
  "PASS",
  "FAIL",
  "SKIPPED",
]);

export const TRUST_DOMAINS: ReadonlySet<string> = new Set<TrustDomain>([
  "AUDIT_LOGS",
  "IDENTITY",
  "AGREEMENTS",
  "ACCESS_STATE",
]);

export const PLAN_STATUSES: ReadonlySet<string> = new Set<PlanStatus>([
  "IDLE",
  "GOAL_RECEIVED",
  "DECOMPOSING",
  "PLAN_DRAFT",
  "SENTINEL_PREREVIEW",
  "REVIEW_PENDING",
  "APPROVED",
  "EXECUTING",
  "COMPLETE",
  "REJECTED",
  "HALTED",
]);

// ── Planner Runtime Session State (P1-S2) ──────────────────────────────────
// Distinct from PlanStatus (artifact lifecycle). Same values, separate contract.

export type PlannerSessionState =
  | "IDLE"
  | "GOAL_RECEIVED"
  | "DECOMPOSING"
  | "PLAN_DRAFT"
  | "SENTINEL_PREREVIEW"
  | "REVIEW_PENDING"
  | "APPROVED"
  | "EXECUTING"
  | "COMPLETE"
  | "REJECTED"
  | "HALTED";

export const PLANNER_SESSION_STATES: ReadonlySet<string> = new Set<PlannerSessionState>([
  "IDLE",
  "GOAL_RECEIVED",
  "DECOMPOSING",
  "PLAN_DRAFT",
  "SENTINEL_PREREVIEW",
  "REVIEW_PENDING",
  "APPROVED",
  "EXECUTING",
  "COMPLETE",
  "REJECTED",
  "HALTED",
]);
