/**
 * Agent OS — Planner Subsystem P1-S3: Execution Binding Types
 * Extended by P1-S7: Readiness Gate Integration
 *
 * All types for the Planner ↔ Foreman execution binding contract.
 * Types only — no runtime logic, no side effects.
 *
 * IMPORTANT: PlanArtifact.run_id is intentionally not used by P1-S3.
 * The P1-S1 validator (validate.ts:412) enforces UUID format on PlanArtifact.run_id,
 * but P1-S3 run_id format is run_{ulid}. The authoritative execution binding
 * lives in RunLedger. Plan ↔ Run binding is through plan_id + plan_version.
 */

import type { ReadinessVerdict } from "./readiness-types.js";

// ── Run Lifecycle States (§7) ────────────────────────────────────────────────

export type RunLifecycleState =
  | "PENDING_ACK"
  | "INITIATING"
  | "RUNNING"
  | "HALTING"
  | "COMPLETING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const RUN_LIFECYCLE_STATES: ReadonlySet<string> = new Set<RunLifecycleState>([
  "PENDING_ACK",
  "INITIATING",
  "RUNNING",
  "HALTING",
  "COMPLETING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

/** Terminal run states — single source of truth for terminal detection. */
export type TerminalRunState = "COMPLETED" | "FAILED" | "CANCELLED";

export const TERMINAL_RUN_STATES: ReadonlySet<TerminalRunState> = new Set<TerminalRunState>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

// ── Execution Event Types (§6.2) ─────────────────────────────────────────────

export type ExecutionEventType =
  | "EXECUTION_STARTED"
  | "STEP_DISPATCHED"
  | "STEP_COMPLETED"
  | "STEP_FAILED"
  | "STOP_CONDITION_TRIGGERED"
  | "HALT_INITIATED"
  | "RUN_COMPLETED"
  | "RUN_FAILED"
  | "RUN_CANCELLED";

export const EXECUTION_EVENT_TYPES: ReadonlySet<string> = new Set<ExecutionEventType>([
  "EXECUTION_STARTED",
  "STEP_DISPATCHED",
  "STEP_COMPLETED",
  "STEP_FAILED",
  "STOP_CONDITION_TRIGGERED",
  "HALT_INITIATED",
  "RUN_COMPLETED",
  "RUN_FAILED",
  "RUN_CANCELLED",
]);

// ── Halt Reason Codes (§9.1) ─────────────────────────────────────────────────

export type HaltReasonCode =
  | "STOP_CONDITION_TRIGGERED"
  | "UNRECOVERABLE_STEP_FAILURE"
  | "CONTRACT_VIOLATION"
  | "SEQUENCE_GAP_DETECTED"
  | "ACTOR_UNAUTHORISED"
  | "COMMAND_CANCELLATION"
  | "FOREMAN_INTERNAL_ERROR";

export const HALT_REASON_CODES: ReadonlySet<string> = new Set<HaltReasonCode>([
  "STOP_CONDITION_TRIGGERED",
  "UNRECOVERABLE_STEP_FAILURE",
  "CONTRACT_VIOLATION",
  "SEQUENCE_GAP_DETECTED",
  "ACTOR_UNAUTHORISED",
  "COMMAND_CANCELLATION",
  "FOREMAN_INTERNAL_ERROR",
]);

// ── Handoff Rejection Codes (closed set) ─────────────────────────────────────

export type HandoffRejectionCode =
  | "PLAN_NOT_FOUND"
  | "PLAN_VERSION_MISMATCH"
  | "CHECKSUM_MISMATCH"
  | "PLAN_NOT_READY"
  | "ACTIVE_RUN_EXISTS"
  | "REQUESTOR_NOT_COMMAND";

export const HANDOFF_REJECTION_CODES: ReadonlySet<string> = new Set<HandoffRejectionCode>([
  "PLAN_NOT_FOUND",
  "PLAN_VERSION_MISMATCH",
  "CHECKSUM_MISMATCH",
  "PLAN_NOT_READY",
  "ACTIVE_RUN_EXISTS",
  "REQUESTOR_NOT_COMMAND",
]);

// ── Payload Type Map (§6.3 — discriminated event→payload mapping) ────────────

export interface ExecutionStartedPayload {
  plan_snapshot_checksum: string;
  foreman_version: string;
  env_context_hash: string;
}

export interface StepDispatchedPayload {
  step_id: string;
  agent_id: string;
  step_type: string;
  input_contract_checksum: string;
}

export interface StepCompletedPayload {
  step_id: string;
  agent_id: string;
  output_checksum: string;
  duration_ms: number;
}

export interface StepFailedPayload {
  step_id: string;
  agent_id: string;
  failure_code: string;
  failure_detail: string;
  is_recoverable: boolean;
}

export interface StopConditionTriggeredPayload {
  condition_id: string;
  triggered_by_step: string;
  evidence_summary: string;
  halt_required: boolean;
}

export interface HaltInitiatedPayload {
  reason_code: HaltReasonCode;
  initiated_by: "foreman" | "stop_condition" | "command_actor";
  evidence: unknown;
}

export interface RunTerminalPayload {
  terminal_reason: string;
  step_count_completed: number;
  step_count_total: number;
  duration_ms: number;
}

/** Discriminated payload map: event type → exact payload type. */
export interface ExecutionEventPayloadMap {
  EXECUTION_STARTED: ExecutionStartedPayload;
  STEP_DISPATCHED: StepDispatchedPayload;
  STEP_COMPLETED: StepCompletedPayload;
  STEP_FAILED: StepFailedPayload;
  STOP_CONDITION_TRIGGERED: StopConditionTriggeredPayload;
  HALT_INITIATED: HaltInitiatedPayload;
  RUN_COMPLETED: RunTerminalPayload;
  RUN_FAILED: RunTerminalPayload;
  RUN_CANCELLED: RunTerminalPayload;
}

/** Union of all valid execution event payloads. */
export type ExecutionEventPayload =
  ExecutionEventPayloadMap[keyof ExecutionEventPayloadMap];

// ── Handoff Payloads (§5) ────────────────────────────────────────────────────

export interface HandoffRequest {
  plan_id: string;
  plan_version: number;
  plan_snapshot: unknown;
  requested_by: string;
  requested_at: string;
  checksum: string;
}

export interface HandoffAck {
  run_id: string;
  plan_id: string;
  plan_version: number;
  acked_at: string;
  foreman_version: string;
}

export interface HandoffRejected {
  plan_id: string;
  plan_version: number;
  reason_code: HandoffRejectionCode;
  reason_message: string;
  rejected_at: string;
}

export interface RunInitiated {
  run_id: string;
  plan_id: string;
  plan_version: number;
  initiated_at: string;
}

export interface RunTerminal {
  run_id: string;
  plan_id: string;
  terminal_state: TerminalRunState;
  terminal_reason: string;
  terminal_at: string;
}

/** Closed handoff protocol surface. */
export type HandoffMessage =
  | HandoffRequest
  | HandoffAck
  | HandoffRejected
  | RunInitiated
  | RunTerminal;

// ── Execution Event Envelope (§6.1) ──────────────────────────────────────────

export interface ExecutionEvent {
  event_id: string;
  run_id: string;
  plan_id: string;
  event_type: ExecutionEventType;
  emitted_at: string;
  emitted_by: "foreman" | string;
  payload: ExecutionEventPayload;
  sequence: number;
}

// ── Run Ledger (§8) ──────────────────────────────────────────────────────────

export interface RunLedger {
  run_id: string;
  plan_id: string;
  plan_version: number;
  plan_snapshot: unknown;
  plan_snapshot_chksum: string;
  state: RunLifecycleState;
  state_entered_at: string;
  requested_by: string;
  foreman_version: string;
  created_at: string;
  terminal_at: string | null;
  terminal_reason: string | null;
  /** P1-S7: frozen readiness verdict that authorized this run. Required on governed creation path. Null on ungoverned path (processHandoff). */
  readiness_verdict: Readonly<ReadinessVerdict> | null;
}

export interface RunLedgerEvent {
  event_id: string;
  run_id: string;
  plan_id: string;
  sequence: number;
  event_type: ExecutionEventType;
  emitted_at: string;
  emitted_by: "foreman" | string;
  payload: ExecutionEventPayload;
}

// ── Result Types ─────────────────────────────────────────────────────────────

export interface RunTransitionOk {
  ok: true;
  from: RunLifecycleState;
  to: RunLifecycleState;
}

export interface RunTransitionFail {
  ok: false;
  from: RunLifecycleState;
  to: RunLifecycleState;
  reason: string;
}

export type RunTransitionResult = RunTransitionOk | RunTransitionFail;

export interface HandoffValidationOk {
  ok: true;
}

export interface HandoffValidationFail {
  ok: false;
  reason_code: HandoffRejectionCode;
  reason_message: string;
}

export type HandoffValidationResult = HandoffValidationOk | HandoffValidationFail;

// ── Drain Window ─────────────────────────────────────────────────────────────

/** Fixed halt drain window in milliseconds. Command-ruled: 30 seconds. */
export const HALT_DRAIN_WINDOW_MS = 30_000;

// ── Readiness Rejection Types (P1-S7) ────────────────────────────────────────

/**
 * Closed set of reasons why governed run creation was rejected.
 * NOT_READY: verdict status is NOT_READY.
 * PLAN_HASH_STALE: verdict.assessed_plan_hash !== plan.plan_hash (plan modified after assessment).
 */
export type ReadinessRejectionReason = "NOT_READY" | "PLAN_HASH_STALE";

export const READINESS_REJECTION_REASONS: ReadonlySet<string> =
  new Set<ReadinessRejectionReason>(["NOT_READY", "PLAN_HASH_STALE"]);

export interface ReadinessRejection {
  rejected: true;
  reason: ReadinessRejectionReason;
  verdict: ReadinessVerdict;
}

/**
 * Discriminated union returned by governed run creation (P1-S7).
 * created: true  — run was created; ledger_entry carries the frozen readiness_verdict.
 * rejected: true — run creation rejected; reason identifies the cause.
 */
export type RunCreationResult =
  | { created: true; run_id: string; ledger_entry: RunLedger }
  | ReadinessRejection;
