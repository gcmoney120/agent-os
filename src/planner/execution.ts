/**
 * Agent OS — Planner Subsystem P1-S3: Plan Execution Binding
 *
 * Implements the Planner ↔ Foreman execution binding contract:
 * - Handoff validation (§5.2)
 * - Run lifecycle state machine (§7)
 * - Execution event creation with exact payload validation (§6)
 * - Halt procedure (§9)
 * - Cancellation (Command-role only, AC-10)
 * - Stop condition routing (§9.3 + Command ruling on informational-only)
 *
 * All functions are pure. Caller supplies IDs and timestamps externally.
 * No Foreman process internals. No agent execution logic.
 *
 * IMPORTANT: PlanArtifact.run_id is intentionally not used by P1-S3.
 * Authoritative execution binding lives in RunLedger.
 * Plan ↔ Run binding is through plan_id + plan_version.
 *
 * P1-S1 and P1-S2 contracts are not modified by this module.
 * Read-only imports from hash.ts (sha256, canonicalize) only.
 */

import type { PlannerSession } from "./session.js";
import { sha256, canonicalize } from "./hash.js";

import type { PlanArtifact } from "./types.js";
import type { ReadinessVerdict } from "./readiness-types.js";
import { assessReadiness } from "./readiness-gate.js";

import type {
  HandoffRequest,
  HandoffAck,
  HandoffRejected,
  RunInitiated,
  RunTerminal,
  ExecutionEvent,
  ExecutionEventType,
  ExecutionEventPayloadMap,
  RunLedger,
  RunLedgerEvent,
  RunLifecycleState,
  RunTransitionResult,
  HandoffValidationResult,
  TerminalRunState,
  HaltReasonCode,
  HaltInitiatedPayload,
  RunTerminalPayload,
  StopConditionTriggeredPayload,
  ExecutionStartedPayload,
  StepFailedPayload,
  ReadinessRejection,
  RunCreationResult,
} from "./execution-types.js";

import { HALT_REASON_CODES } from "./execution-types.js";

import type { RunLedgerStore } from "./run-ledger.js";
import {
  createRunLedger,
  appendLedgerEvent,
  updateLedgerState,
  hasActiveRun,
  isValidRunId,
  isTerminalRunState,
  isValidRunLifecycleTransition,
  getLedger,
  getLedgerEvents,
  getLastSequence,
} from "./run-ledger.js";

// ── Event Creation Error Codes (closed set) ──────────────────────────────────

export type EventCreationErrorCode =
  | "EVENT_MISSING_ID"
  | "EVENT_MISSING_RUN_ID"
  | "EVENT_MISSING_PLAN_ID"
  | "EVENT_MISSING_EMITTED_AT"
  | "EVENT_MISSING_EMITTED_BY"
  | "EVENT_INVALID_SEQUENCE"
  | "EVENT_PAYLOAD_INVALID";

// ── Event Creation Result Types ──────────────────────────────────────────────

export interface EventCreationOk<T extends ExecutionEventType> {
  ok: true;
  event: ExecutionEvent & { event_type: T; payload: ExecutionEventPayloadMap[T] };
}

export interface EventCreationFail {
  ok: false;
  code: EventCreationErrorCode;
  message: string;
}

export type EventCreationResult<T extends ExecutionEventType> =
  | EventCreationOk<T>
  | EventCreationFail;

// ── Run State Machine (§7) ──────────────────────────────────────────────────

/**
 * Deterministic run lifecycle state transition.
 * Delegates to isValidRunLifecycleTransition from run-ledger.
 * Returns structured result — never throws.
 */
export function transitionRunState(
  from: RunLifecycleState,
  to: RunLifecycleState,
): RunTransitionResult {
  if (isTerminalRunState(from)) {
    return {
      ok: false,
      from,
      to,
      reason: `Terminal state ${from} cannot transition to ${to}; runs never restart`,
    };
  }

  if (to === "PENDING_ACK") {
    return {
      ok: false,
      from,
      to,
      reason: "Cannot transition to PENDING_ACK; handoff is one-way",
    };
  }

  if (from === "PENDING_ACK" && to === "RUNNING") {
    return {
      ok: false,
      from,
      to,
      reason: "Cannot transition PENDING_ACK → RUNNING; must pass through INITIATING",
    };
  }

  if (!isValidRunLifecycleTransition(from, to)) {
    return {
      ok: false,
      from,
      to,
      reason: `Transition ${from} → ${to} is not allowed`,
    };
  }

  return { ok: true, from, to };
}

// ── Handoff Validation (§5.2) ────────────────────────────────────────────────

/**
 * Validate a handoff request per §5.2 in-order checks.
 *
 * "READY" in the Atlas spec maps to "APPROVED" in the P1-S2 state machine.
 * A plan is ready for handoff only when it has been approved by Command.
 *
 * Includes:
 * - AC-11 checksum self-consistency verification
 * - Stored artifact snapshot comparison (prevents forged snapshot + matching checksum)
 */
export function validateHandoff(
  request: HandoffRequest,
  session: PlannerSession,
  store: RunLedgerStore,
): HandoffValidationResult {
  // Check 1: plan_id exists and is known
  if (!session.plan_artifact || session.plan_artifact.plan_id !== request.plan_id) {
    return {
      ok: false,
      reason_code: "PLAN_NOT_FOUND",
      reason_message: `plan_id ${request.plan_id} is not known or does not match session`,
    };
  }

  // Check 2: plan_version matches current stored version
  if (session.plan_artifact.version !== request.plan_version) {
    return {
      ok: false,
      reason_code: "PLAN_VERSION_MISMATCH",
      reason_message: `plan_version ${request.plan_version} does not match stored version ${session.plan_artifact.version}`,
    };
  }

  // Check 3a: checksum self-consistency — sha256(canonicalize(snapshot)) === request.checksum
  const computedChecksum = sha256(canonicalize(request.plan_snapshot));
  if (computedChecksum !== request.checksum) {
    return {
      ok: false,
      reason_code: "CHECKSUM_MISMATCH",
      reason_message: "plan_snapshot checksum does not match request.checksum (self-consistency failure)",
    };
  }

  // Check 3b: stored artifact match — snapshot must match stored approved plan
  const storedCanonical = canonicalize(session.plan_artifact);
  const requestCanonical = canonicalize(request.plan_snapshot);
  if (requestCanonical !== storedCanonical) {
    return {
      ok: false,
      reason_code: "CHECKSUM_MISMATCH",
      reason_message: "plan_snapshot does not match stored approved plan artifact",
    };
  }

  // Check 4: Plan state is exactly APPROVED (READY in Atlas spec)
  if (session.current_state !== "APPROVED") {
    return {
      ok: false,
      reason_code: "PLAN_NOT_READY",
      reason_message: `Plan state must be APPROVED (READY), got: ${session.current_state}`,
    };
  }

  // Check 5: No existing active run for this plan_id
  if (hasActiveRun(store, request.plan_id)) {
    return {
      ok: false,
      reason_code: "ACTIVE_RUN_EXISTS",
      reason_message: `An active run already exists for plan_id ${request.plan_id}`,
    };
  }

  // Check 6: requested_by holds Command role
  if (request.requested_by !== "Command") {
    return {
      ok: false,
      reason_code: "REQUESTOR_NOT_COMMAND",
      reason_message: `requested_by must be Command, got: ${request.requested_by}`,
    };
  }

  return { ok: true };
}

// ── Handoff Processing ───────────────────────────────────────────────────────

export interface HandoffOkResult {
  ok: true;
  ack: HandoffAck;
  store: RunLedgerStore;
}

export interface HandoffRejectedResult {
  ok: false;
  rejected: HandoffRejected;
  store: RunLedgerStore;
}

/**
 * Internal Foreman contract failure during handoff processing.
 * Distinct from handoff rejection: these indicate Foreman-assigned
 * infrastructure errors (e.g. invalid/duplicate run_id).
 */
export interface HandoffInternalError {
  ok: false;
  internal: true;
  code: string;
  message: string;
}

export type ProcessHandoffResult =
  | HandoffOkResult
  | HandoffRejectedResult
  | HandoffInternalError;

/**
 * Process a handoff request.
 *
 * Flow:
 * 1. Validate request (§5.2 in-order checks)
 * 2. Validate Foreman-assigned run_id format
 * 3. Create ledger in PENDING_ACK
 * 4. Return HandoffAck
 *
 * Does NOT emit RUN_INITIATED. That is a separate protocol step
 * after Foreman takes ownership (see createRunInitiated).
 *
 * Failure shapes:
 * - HandoffRejectedResult: plan-level rejection (§5.2 checks failed)
 * - HandoffInternalError: Foreman infrastructure failure (invalid/duplicate run_id)
 *
 * Caller supplies run_id (Foreman-assigned), foreman_version, and timestamp.
 */
export function processHandoff(
  request: HandoffRequest,
  session: PlannerSession,
  store: RunLedgerStore,
  runId: string,
  foremanVersion: string,
  timestamp: string,
): ProcessHandoffResult {
  const validation = validateHandoff(request, session, store);
  if (!validation.ok) {
    return {
      ok: false,
      rejected: {
        plan_id: request.plan_id,
        plan_version: request.plan_version,
        reason_code: validation.reason_code,
        reason_message: validation.reason_message,
        rejected_at: timestamp,
      },
      store,
    };
  }

  // Validate Foreman-assigned run_id format
  if (!isValidRunId(runId)) {
    return {
      ok: false,
      internal: true,
      code: "INVALID_RUN_ID",
      message: `Foreman-assigned run_id must match format run_{ulid}, got: ${runId}`,
    };
  }

  const ledger: RunLedger = {
    run_id: runId,
    plan_id: request.plan_id,
    plan_version: request.plan_version,
    plan_snapshot: request.plan_snapshot,
    plan_snapshot_chksum: request.checksum,
    state: "PENDING_ACK",
    state_entered_at: timestamp,
    requested_by: request.requested_by,
    foreman_version: foremanVersion,
    created_at: timestamp,
    terminal_at: null,
    terminal_reason: null,
    readiness_verdict: null,
  };

  const ledgerResult = createRunLedger(store, ledger);
  if (!ledgerResult.ok) {
    // Map deterministically: ACTIVE_RUN_EXISTS → handoff rejection; all others → internal error
    if (ledgerResult.code === "ACTIVE_RUN_EXISTS") {
      return {
        ok: false,
        rejected: {
          plan_id: request.plan_id,
          plan_version: request.plan_version,
          reason_code: "ACTIVE_RUN_EXISTS",
          reason_message: ledgerResult.message,
          rejected_at: timestamp,
        },
        store,
      };
    }
    // Duplicate/invalid run_id at ledger level = internal Foreman contract failure
    return {
      ok: false,
      internal: true,
      code: ledgerResult.code,
      message: ledgerResult.message,
    };
  }

  const ack: HandoffAck = {
    run_id: runId,
    plan_id: request.plan_id,
    plan_version: request.plan_version,
    acked_at: timestamp,
    foreman_version: foremanVersion,
  };

  return { ok: true, ack, store: ledgerResult.data };
}

// ── Protocol Message Builders ────────────────────────────────────────────────

/**
 * Build a RUN_INITIATED protocol message.
 * This is sent from Foreman to Planner after Foreman takes ownership.
 */
export function createRunInitiated(
  runId: string,
  planId: string,
  planVersion: number,
  initiatedAt: string,
): RunInitiated {
  return {
    run_id: runId,
    plan_id: planId,
    plan_version: planVersion,
    initiated_at: initiatedAt,
  };
}

// ── Build RunTerminal (structured result) ────────────────────────────────────

export interface BuildRunTerminalOk {
  ok: true;
  terminal: RunTerminal;
}

export interface BuildRunTerminalFail {
  ok: false;
  code: "RUN_NOT_TERMINAL";
  message: string;
}

export type BuildRunTerminalResult = BuildRunTerminalOk | BuildRunTerminalFail;

/**
 * Build a RUN_TERMINAL notification for the Planner.
 * Only valid for terminal states (COMPLETED | FAILED | CANCELLED).
 * Returns structured failure for non-terminal states.
 */
export function buildRunTerminal(ledger: RunLedger): BuildRunTerminalResult {
  if (!isTerminalRunState(ledger.state)) {
    return {
      ok: false,
      code: "RUN_NOT_TERMINAL",
      message: `Run ${ledger.run_id} is in state ${ledger.state}, not a terminal state`,
    };
  }

  return {
    ok: true,
    terminal: {
      run_id: ledger.run_id,
      plan_id: ledger.plan_id,
      terminal_state: ledger.state as TerminalRunState,
      terminal_reason: ledger.terminal_reason ?? "unknown",
      terminal_at: ledger.terminal_at ?? ledger.state_entered_at,
    },
  };
}

// ── Plan Snapshot Verification (AC-11) ───────────────────────────────────────

/**
 * Verify that the plan snapshot stored in the run ledger matches its checksum.
 * AC-11: snapshot checksum must match at all times after INITIATING.
 *
 * Required invariant step in:
 * - validateHandoff() for incoming checksum match
 * - initiateRun() before transition to RUNNING
 */
export function verifyPlanSnapshot(ledger: RunLedger): boolean {
  const computedChecksum = sha256(canonicalize(ledger.plan_snapshot));
  return computedChecksum === ledger.plan_snapshot_chksum;
}

// ── Payload Validation (§6.3) ────────────────────────────────────────────────

/** Valid values for HaltInitiatedPayload.initiated_by. */
const VALID_HALT_INITIATED_BY: ReadonlySet<string> = new Set([
  "foreman",
  "stop_condition",
  "command_actor",
]);

interface PayloadValidationOk {
  ok: true;
}

type PayloadValidationResult = PayloadValidationOk | EventCreationFail;

function requireString(obj: Record<string, unknown>, field: string, label: string): string | null {
  if (typeof obj[field] !== "string" || (obj[field] as string).length === 0) {
    return `${label}.${field} must be a non-empty string`;
  }
  return null;
}

function requireFiniteNonNegativeNumber(
  obj: Record<string, unknown>,
  field: string,
  label: string,
): string | null {
  const val = obj[field];
  if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
    return `${label}.${field} must be a finite number >= 0`;
  }
  return null;
}

function requireBoolean(obj: Record<string, unknown>, field: string, label: string): string | null {
  if (typeof obj[field] !== "boolean") {
    return `${label}.${field} must be a boolean`;
  }
  return null;
}

function payloadFail(message: string): EventCreationFail {
  return { ok: false, code: "EVENT_PAYLOAD_INVALID", message };
}

/**
 * Validate payload shape exactly per §6.3.
 * Event-type specific, closed-set, rejects missing required fields.
 *
 * Enforces:
 * - Exact required fields per event type
 * - HaltReasonCode enum membership for HALT_INITIATED.reason_code
 * - initiated_by enum membership for HALT_INITIATED
 * - Numeric fields must be finite and >= 0
 */
export function validateEventPayload(
  eventType: ExecutionEventType,
  payload: ExecutionEventPayloadMap[keyof ExecutionEventPayloadMap],
): PayloadValidationResult {
  const p = payload as unknown as Record<string, unknown>;
  const label = eventType;
  let err: string | null;

  switch (eventType) {
    case "EXECUTION_STARTED":
      err = requireString(p, "plan_snapshot_checksum", label);
      if (err) return payloadFail(err);
      err = requireString(p, "foreman_version", label);
      if (err) return payloadFail(err);
      err = requireString(p, "env_context_hash", label);
      if (err) return payloadFail(err);
      break;

    case "STEP_DISPATCHED":
      err = requireString(p, "step_id", label);
      if (err) return payloadFail(err);
      err = requireString(p, "agent_id", label);
      if (err) return payloadFail(err);
      err = requireString(p, "step_type", label);
      if (err) return payloadFail(err);
      err = requireString(p, "input_contract_checksum", label);
      if (err) return payloadFail(err);
      break;

    case "STEP_COMPLETED":
      err = requireString(p, "step_id", label);
      if (err) return payloadFail(err);
      err = requireString(p, "agent_id", label);
      if (err) return payloadFail(err);
      err = requireString(p, "output_checksum", label);
      if (err) return payloadFail(err);
      err = requireFiniteNonNegativeNumber(p, "duration_ms", label);
      if (err) return payloadFail(err);
      break;

    case "STEP_FAILED":
      err = requireString(p, "step_id", label);
      if (err) return payloadFail(err);
      err = requireString(p, "agent_id", label);
      if (err) return payloadFail(err);
      err = requireString(p, "failure_code", label);
      if (err) return payloadFail(err);
      err = requireString(p, "failure_detail", label);
      if (err) return payloadFail(err);
      err = requireBoolean(p, "is_recoverable", label);
      if (err) return payloadFail(err);
      break;

    case "STOP_CONDITION_TRIGGERED":
      err = requireString(p, "condition_id", label);
      if (err) return payloadFail(err);
      err = requireString(p, "triggered_by_step", label);
      if (err) return payloadFail(err);
      err = requireString(p, "evidence_summary", label);
      if (err) return payloadFail(err);
      err = requireBoolean(p, "halt_required", label);
      if (err) return payloadFail(err);
      break;

    case "HALT_INITIATED": {
      err = requireString(p, "reason_code", label);
      if (err) return payloadFail(err);
      // Validate reason_code is a valid HaltReasonCode
      if (!HALT_REASON_CODES.has(p["reason_code"] as string)) {
        return payloadFail(
          `${label}.reason_code must be a valid HaltReasonCode, got: ${p["reason_code"]}`,
        );
      }
      err = requireString(p, "initiated_by", label);
      if (err) return payloadFail(err);
      // Validate initiated_by enum
      if (!VALID_HALT_INITIATED_BY.has(p["initiated_by"] as string)) {
        return payloadFail(
          `${label}.initiated_by must be one of [foreman, stop_condition, command_actor], got: ${p["initiated_by"]}`,
        );
      }
      // evidence is unknown — presence check only
      if (!("evidence" in p)) {
        return payloadFail(`${label}.evidence must be present`);
      }
      break;
    }

    case "RUN_COMPLETED":
    case "RUN_FAILED":
    case "RUN_CANCELLED":
      err = requireString(p, "terminal_reason", label);
      if (err) return payloadFail(err);
      err = requireFiniteNonNegativeNumber(p, "step_count_completed", label);
      if (err) return payloadFail(err);
      err = requireFiniteNonNegativeNumber(p, "step_count_total", label);
      if (err) return payloadFail(err);
      err = requireFiniteNonNegativeNumber(p, "duration_ms", label);
      if (err) return payloadFail(err);
      break;

    default: {
      const _exhaustive: never = eventType;
      return payloadFail(`Unknown event type: ${_exhaustive}`);
    }
  }

  return { ok: true };
}

// ── Execution Event Creation (§6) ────────────────────────────────────────────

/**
 * Create and validate an execution event with compile-time payload coupling.
 * T extends ExecutionEventType; payload must match ExecutionEventPayloadMap[T].
 *
 * Validates:
 * - All envelope fields non-null (AC-5)
 * - Sequence is a positive integer (≥1)
 * - Payload matches exact shape for event type (§6.3)
 *
 * Error codes are drawn from the closed EventCreationErrorCode set.
 */
export function createExecutionEvent<T extends ExecutionEventType>(
  eventId: string,
  runId: string,
  planId: string,
  eventType: T,
  emittedAt: string,
  emittedBy: "foreman" | string,
  payload: ExecutionEventPayloadMap[T],
  sequence: number,
): EventCreationResult<T> {
  if (!eventId) {
    return { ok: false, code: "EVENT_MISSING_ID", message: "event_id must be non-empty" };
  }
  if (!runId) {
    return { ok: false, code: "EVENT_MISSING_RUN_ID", message: "run_id must be non-empty" };
  }
  if (!planId) {
    return { ok: false, code: "EVENT_MISSING_PLAN_ID", message: "plan_id must be non-empty" };
  }
  if (!emittedAt) {
    return { ok: false, code: "EVENT_MISSING_EMITTED_AT", message: "emitted_at must be non-empty" };
  }
  if (!emittedBy) {
    return { ok: false, code: "EVENT_MISSING_EMITTED_BY", message: "emitted_by must be non-empty" };
  }
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
    return { ok: false, code: "EVENT_INVALID_SEQUENCE", message: "sequence must be a positive integer (≥1)" };
  }

  const payloadCheck = validateEventPayload(eventType, payload);
  if (!payloadCheck.ok) {
    return payloadCheck;
  }

  const event = {
    event_id: eventId,
    run_id: runId,
    plan_id: planId,
    event_type: eventType,
    emitted_at: emittedAt,
    emitted_by: emittedBy,
    payload,
    sequence,
  };

  return { ok: true, event: event as ExecutionEvent & { event_type: T; payload: ExecutionEventPayloadMap[T] } };
}

// ── Ledger Event Helper ──────────────────────────────────────────────────────

/**
 * Build a RunLedgerEvent from creation parameters.
 * Does not append — caller must use appendLedgerEvent.
 */
function buildLedgerEvent<T extends ExecutionEventType>(
  eventId: string,
  runId: string,
  planId: string,
  eventType: T,
  emittedAt: string,
  emittedBy: "foreman" | string,
  payload: ExecutionEventPayloadMap[T],
  sequence: number,
): RunLedgerEvent {
  return {
    event_id: eventId,
    run_id: runId,
    plan_id: planId,
    sequence,
    event_type: eventType,
    emitted_at: emittedAt,
    emitted_by: emittedBy,
    payload: payload as ExecutionEventPayloadMap[keyof ExecutionEventPayloadMap],
  };
}

// ── Next Sequence Helper ─────────────────────────────────────────────────────

function nextSequence(store: RunLedgerStore, runId: string): number {
  const last = getLastSequence(store, runId);
  return last === undefined ? 1 : last + 1;
}

// ── Initiation Failure Helper ────────────────────────────────────────────────

/**
 * Internal: emit HALT_INITIATED + RUN_FAILED events, then transition to FAILED.
 * Used by both initiateRun (snapshot mismatch) and failRunFromInitiation.
 *
 * Required event order (Command ruling on Atlas FOREMAN_INTERNAL_ERROR):
 * 1. HALT_INITIATED event (while in current state)
 * 2. RUN_FAILED event (while in current state)
 * 3. State → FAILED (terminal state transition last)
 */
function emitInitiationFailure(
  store: RunLedgerStore,
  ledger: RunLedger,
  reason: string,
  haltReasonCode: HaltReasonCode,
  haltEventId: string,
  terminalEventId: string,
  timestamp: string,
  durationMs: number,
): { ok: true; store: RunLedgerStore } | { ok: false; code: string; message: string } {
  let currentStore = store;

  // Step 1: Emit HALT_INITIATED
  const haltSeq = nextSequence(currentStore, ledger.run_id);
  const haltPayload: HaltInitiatedPayload = {
    reason_code: haltReasonCode,
    initiated_by: "foreman",
    evidence: { reason },
  };
  const haltEvent = buildLedgerEvent(
    haltEventId, ledger.run_id, ledger.plan_id,
    "HALT_INITIATED", timestamp, "foreman",
    haltPayload, haltSeq,
  );
  const appendHalt = appendLedgerEvent(currentStore, haltEvent);
  if (!appendHalt.ok) {
    return { ok: false, code: appendHalt.code, message: appendHalt.message };
  }
  currentStore = appendHalt.data;

  // Step 2: Emit RUN_FAILED
  const terminalSeq = nextSequence(currentStore, ledger.run_id);
  const terminalPayload: RunTerminalPayload = {
    terminal_reason: reason,
    step_count_completed: 0,
    step_count_total: 0,
    duration_ms: durationMs,
  };
  const terminalEvent = buildLedgerEvent(
    terminalEventId, ledger.run_id, ledger.plan_id,
    "RUN_FAILED", timestamp, "foreman",
    terminalPayload, terminalSeq,
  );
  const appendTerminal = appendLedgerEvent(currentStore, terminalEvent);
  if (!appendTerminal.ok) {
    return { ok: false, code: appendTerminal.code, message: appendTerminal.message };
  }
  currentStore = appendTerminal.data;

  // Step 3: State → FAILED (terminal transition last)
  const toFailed = updateLedgerState(currentStore, ledger.run_id, "FAILED", timestamp, reason);
  if (!toFailed.ok) {
    return { ok: false, code: toFailed.code, message: toFailed.message };
  }
  currentStore = toFailed.data;

  return { ok: true, store: currentStore };
}

// ── Run Initiation (PENDING_ACK → INITIATING → RUNNING) ─────────────────────

export interface InitiateRunOk {
  ok: true;
  store: RunLedgerStore;
  initiated: RunInitiated;
  executionStartedEvent: ExecutionEvent;
}

export interface InitiateRunFail {
  ok: false;
  code: string;
  message: string;
  /** Updated store if partial transitions occurred (e.g. snapshot mismatch → FAILED). */
  store?: RunLedgerStore;
}

export type InitiateRunResult = InitiateRunOk | InitiateRunFail;

/**
 * Transition a run from PENDING_ACK through INITIATING to RUNNING.
 *
 * Sequence:
 * 1. Ledger transition PENDING_ACK → INITIATING
 * 2. Build RunInitiated protocol message
 * 3. AC-11: Verify plan snapshot checksum integrity
 * 4. Create and append EXECUTION_STARTED event
 * 5. Ledger transition INITIATING → RUNNING
 *
 * AC-11 failure at step 3:
 * Command ruling — FOREMAN_INTERNAL_ERROR requires HALT_INITIATED then
 * RUN_FAILED then INITIATING → FAILED.
 *
 * failureHaltEventId / failureTerminalEventId are used only on snapshot mismatch.
 */
export function initiateRun(
  store: RunLedgerStore,
  runId: string,
  executionStartedEventId: string,
  envContextHash: string,
  timestamp: string,
  failureHaltEventId: string,
  failureTerminalEventId: string,
): InitiateRunResult {
  const ledger = getLedger(store, runId);
  if (!ledger) {
    return { ok: false, code: "INITIATE_RUN_NOT_FOUND", message: `No run found: ${runId}` };
  }

  if (ledger.state !== "PENDING_ACK") {
    return {
      ok: false,
      code: "INITIATE_RUN_INVALID_STATE",
      message: `Run must be in PENDING_ACK to initiate, got: ${ledger.state}`,
    };
  }

  // Step 1: PENDING_ACK → INITIATING
  const toInitiating = updateLedgerState(store, runId, "INITIATING", timestamp);
  if (!toInitiating.ok) {
    return { ok: false, code: "INITIATE_RUN_TRANSITION_FAILED", message: toInitiating.message };
  }
  let currentStore = toInitiating.data;

  // Step 2: Build RunInitiated
  const initiated = createRunInitiated(
    runId, ledger.plan_id, ledger.plan_version, timestamp,
  );

  // Step 3: AC-11 — verify plan snapshot integrity
  const currentLedger = getLedger(currentStore, runId)!;
  if (!verifyPlanSnapshot(currentLedger)) {
    // Command ruling: FOREMAN_INTERNAL_ERROR → HALT_INITIATED + RUN_FAILED + INITIATING→FAILED
    const failResult = emitInitiationFailure(
      currentStore, currentLedger,
      "Plan snapshot checksum mismatch at initiation",
      "FOREMAN_INTERNAL_ERROR",
      failureHaltEventId, failureTerminalEventId,
      timestamp, 0,
    );
    return {
      ok: false,
      code: "INITIATE_RUN_SNAPSHOT_MISMATCH",
      message: "Plan snapshot checksum does not match stored checksum",
      store: failResult.ok ? failResult.store : currentStore,
    };
  }

  // Step 4: Create and append EXECUTION_STARTED
  const seq = nextSequence(currentStore, runId);
  const startedPayload: ExecutionStartedPayload = {
    plan_snapshot_checksum: currentLedger.plan_snapshot_chksum,
    foreman_version: currentLedger.foreman_version,
    env_context_hash: envContextHash,
  };

  const eventResult = createExecutionEvent(
    executionStartedEventId, runId, ledger.plan_id,
    "EXECUTION_STARTED", timestamp, "foreman",
    startedPayload, seq,
  );
  if (!eventResult.ok) {
    return { ok: false, code: eventResult.code, message: eventResult.message };
  }

  const ledgerEvent = buildLedgerEvent(
    executionStartedEventId, runId, ledger.plan_id,
    "EXECUTION_STARTED", timestamp, "foreman",
    startedPayload, seq,
  );
  const appendResult = appendLedgerEvent(currentStore, ledgerEvent);
  if (!appendResult.ok) {
    return { ok: false, code: appendResult.code, message: appendResult.message };
  }
  currentStore = appendResult.data;

  // Step 5: INITIATING → RUNNING
  const toRunning = updateLedgerState(currentStore, runId, "RUNNING", timestamp);
  if (!toRunning.ok) {
    return { ok: false, code: "INITIATE_RUN_TRANSITION_FAILED", message: toRunning.message };
  }
  currentStore = toRunning.data;

  return {
    ok: true,
    store: currentStore,
    initiated,
    executionStartedEvent: eventResult.event,
  };
}

// ── Initiation Failure (INITIATING → FAILED) ────────────────────────────────

export interface InitiationFailureOk {
  ok: true;
  store: RunLedgerStore;
  terminal: RunTerminal;
}

export interface InitiationFailureFail {
  ok: false;
  code: string;
  message: string;
}

export type InitiationFailureResult = InitiationFailureOk | InitiationFailureFail;

/**
 * Fail a run during initiation. INITIATING → FAILED.
 *
 * This is NOT the general halt procedure (§9.2). It exists solely for
 * Foreman internal errors that occur during the INITIATING phase, before
 * the run reaches RUNNING.
 *
 * Command ruling: FOREMAN_INTERNAL_ERROR is a halt reason (Atlas §9.1)
 * and requires deterministic auditability. Therefore this path emits:
 * 1. HALT_INITIATED (reason_code: FOREMAN_INTERNAL_ERROR)
 * 2. RUN_FAILED
 * 3. INITIATING → FAILED (terminal transition last)
 *
 * AC-13 applies: HALT_INITIATED always precedes terminal event.
 */
export function failRunFromInitiation(
  store: RunLedgerStore,
  runId: string,
  reason: string,
  haltEventId: string,
  failEventId: string,
  timestamp: string,
  durationMs: number,
): InitiationFailureResult {
  const ledger = getLedger(store, runId);
  if (!ledger) {
    return { ok: false, code: "FAIL_INIT_RUN_NOT_FOUND", message: `No run found: ${runId}` };
  }

  if (ledger.state !== "INITIATING") {
    return {
      ok: false,
      code: "FAIL_INIT_INVALID_STATE",
      message: `Run must be in INITIATING to fail from initiation, got: ${ledger.state}`,
    };
  }

  const failResult = emitInitiationFailure(
    store, ledger, reason,
    "FOREMAN_INTERNAL_ERROR",
    haltEventId, failEventId,
    timestamp, durationMs,
  );

  if (!failResult.ok) {
    return { ok: false, code: failResult.code, message: failResult.message };
  }

  const finalLedger = getLedger(failResult.store, runId)!;
  const terminalResult = buildRunTerminal(finalLedger);
  if (!terminalResult.ok) {
    return { ok: false, code: terminalResult.code, message: terminalResult.message };
  }

  return { ok: true, store: failResult.store, terminal: terminalResult.terminal };
}

// ── Run Completion (RUNNING → COMPLETING → COMPLETED) ────────────────────────

export interface CompleteRunOk {
  ok: true;
  store: RunLedgerStore;
  terminalEvent: ExecutionEvent;
  terminal: RunTerminal;
}

export interface CompleteRunFail {
  ok: false;
  code: string;
  message: string;
}

export type CompleteRunResult = CompleteRunOk | CompleteRunFail;

/**
 * Complete a run: RUNNING → COMPLETING → COMPLETED.
 *
 * §7.2 unresolved failure rule (Command ruling):
 * A run may complete only if there exists no STEP_FAILED event with
 * is_recoverable=false. Recoverable failures do not block completion
 * unless they later lead to halt.
 *
 * Event ordering:
 * 1. RUNNING → COMPLETING (non-terminal pre-state transition)
 * 2. Append RUN_COMPLETED event
 * 3. COMPLETING → COMPLETED (terminal state transition last)
 */
export function completeRun(
  store: RunLedgerStore,
  runId: string,
  terminalEventId: string,
  timestamp: string,
  stepCountCompleted: number,
  stepCountTotal: number,
  durationMs: number,
): CompleteRunResult {
  const ledger = getLedger(store, runId);
  if (!ledger) {
    return { ok: false, code: "COMPLETE_RUN_NOT_FOUND", message: `No run found: ${runId}` };
  }

  if (ledger.state !== "RUNNING") {
    return {
      ok: false,
      code: "COMPLETE_RUN_INVALID_STATE",
      message: `Run must be RUNNING to complete, got: ${ledger.state}`,
    };
  }

  // §7.2: Reject if any unrecoverable STEP_FAILED exists
  const events = getLedgerEvents(store, runId) ?? [];
  for (const evt of events) {
    if (evt.event_type === "STEP_FAILED") {
      const p = evt.payload as unknown as StepFailedPayload;
      if (p.is_recoverable === false) {
        return {
          ok: false,
          code: "COMPLETE_RUN_UNRESOLVED_FAILURE",
          message: `Cannot complete run with unrecoverable STEP_FAILED for step: ${p.step_id}`,
        };
      }
    }
  }

  let currentStore = store;

  // Step 1: RUNNING → COMPLETING (non-terminal pre-state transition)
  const toCompleting = updateLedgerState(currentStore, runId, "COMPLETING", timestamp);
  if (!toCompleting.ok) {
    return { ok: false, code: "COMPLETE_RUN_TRANSITION_FAILED", message: toCompleting.message };
  }
  currentStore = toCompleting.data;

  // Step 2: Append RUN_COMPLETED event (before terminal state)
  const seq = nextSequence(currentStore, runId);
  const terminalPayload: RunTerminalPayload = {
    terminal_reason: "All steps completed successfully",
    step_count_completed: stepCountCompleted,
    step_count_total: stepCountTotal,
    duration_ms: durationMs,
  };

  const terminalEventResult = createExecutionEvent(
    terminalEventId, runId, ledger.plan_id,
    "RUN_COMPLETED", timestamp, "foreman",
    terminalPayload, seq,
  );
  if (!terminalEventResult.ok) {
    return { ok: false, code: terminalEventResult.code, message: terminalEventResult.message };
  }

  const ledgerEvent = buildLedgerEvent(
    terminalEventId, runId, ledger.plan_id,
    "RUN_COMPLETED", timestamp, "foreman",
    terminalPayload, seq,
  );
  const appendResult = appendLedgerEvent(currentStore, ledgerEvent);
  if (!appendResult.ok) {
    return { ok: false, code: appendResult.code, message: appendResult.message };
  }
  currentStore = appendResult.data;

  // Step 3: COMPLETING → COMPLETED (terminal state transition last)
  const toCompleted = updateLedgerState(
    currentStore, runId, "COMPLETED", timestamp, "All steps completed successfully",
  );
  if (!toCompleted.ok) {
    return { ok: false, code: "COMPLETE_RUN_TRANSITION_FAILED", message: toCompleted.message };
  }
  currentStore = toCompleted.data;

  const finalLedger = getLedger(currentStore, runId)!;
  const terminalResult = buildRunTerminal(finalLedger);
  if (!terminalResult.ok) {
    return { ok: false, code: terminalResult.code, message: terminalResult.message };
  }

  return {
    ok: true,
    store: currentStore,
    terminalEvent: terminalEventResult.event,
    terminal: terminalResult.terminal,
  };
}

// ── Halt Procedure (§9.2) ────────────────────────────────────────────────────

export interface HaltProcedureOk {
  ok: true;
  store: RunLedgerStore;
  haltEvent: ExecutionEvent;
  terminalEvent: ExecutionEvent;
  terminalState: TerminalRunState;
}

export interface HaltProcedureFail {
  ok: false;
  code: string;
  message: string;
}

export type HaltProcedureResult = HaltProcedureOk | HaltProcedureFail;

/**
 * Execute deterministic halt procedure per §9.2.
 *
 * For non-cancellation halts: RUNNING → HALTING → FAILED.
 *
 * Event ordering:
 * 1. RUNNING → HALTING (non-terminal pre-state transition)
 * 2. Append HALT_INITIATED event (AC-13: always before terminal)
 * 3. Append RUN_FAILED event
 * 4. HALTING → FAILED (terminal state transition last)
 *
 * Drain window (30s) is architectural; timing enforcement is Foreman's
 * responsibility. This function produces the correct event sequence.
 */
export function executeHaltProcedure(
  store: RunLedgerStore,
  runId: string,
  reasonCode: HaltReasonCode,
  initiatedBy: "foreman" | "stop_condition" | "command_actor",
  evidence: unknown,
  haltEventId: string,
  terminalEventId: string,
  timestamp: string,
  stepCountCompleted: number,
  stepCountTotal: number,
  durationMs: number,
): HaltProcedureResult {
  const ledger = getLedger(store, runId);
  if (!ledger) {
    return { ok: false, code: "HALT_RUN_NOT_FOUND", message: `No run found: ${runId}` };
  }

  if (ledger.state !== "RUNNING") {
    return {
      ok: false,
      code: "HALT_INVALID_STATE",
      message: `Run must be in RUNNING state to halt, got: ${ledger.state}`,
    };
  }

  let currentStore = store;

  // Step 1: RUNNING → HALTING (non-terminal pre-state transition)
  const toHalting = updateLedgerState(currentStore, runId, "HALTING", timestamp);
  if (!toHalting.ok) {
    return { ok: false, code: "HALT_TRANSITION_FAILED", message: toHalting.message };
  }
  currentStore = toHalting.data;

  // Step 2: Append HALT_INITIATED (AC-13: always before terminal event)
  const haltSeq = nextSequence(currentStore, runId);
  const haltPayload: HaltInitiatedPayload = {
    reason_code: reasonCode,
    initiated_by: initiatedBy,
    evidence,
  };

  const haltEventResult = createExecutionEvent(
    haltEventId, runId, ledger.plan_id,
    "HALT_INITIATED", timestamp, "foreman",
    haltPayload, haltSeq,
  );
  if (!haltEventResult.ok) {
    return { ok: false, code: haltEventResult.code, message: haltEventResult.message };
  }

  const haltLedgerEvent = buildLedgerEvent(
    haltEventId, runId, ledger.plan_id,
    "HALT_INITIATED", timestamp, "foreman",
    haltPayload, haltSeq,
  );
  const appendHalt = appendLedgerEvent(currentStore, haltLedgerEvent);
  if (!appendHalt.ok) {
    return { ok: false, code: appendHalt.code, message: appendHalt.message };
  }
  currentStore = appendHalt.data;

  // Step 3: Append RUN_FAILED event (before terminal state transition)
  const terminalSeq = nextSequence(currentStore, runId);
  const terminalReason = `Halted: ${reasonCode}`;
  const terminalPayload: RunTerminalPayload = {
    terminal_reason: terminalReason,
    step_count_completed: stepCountCompleted,
    step_count_total: stepCountTotal,
    duration_ms: durationMs,
  };

  const terminalEventResult = createExecutionEvent(
    terminalEventId, runId, ledger.plan_id,
    "RUN_FAILED", timestamp, "foreman",
    terminalPayload, terminalSeq,
  );
  if (!terminalEventResult.ok) {
    return { ok: false, code: terminalEventResult.code, message: terminalEventResult.message };
  }

  const terminalLedgerEvent = buildLedgerEvent(
    terminalEventId, runId, ledger.plan_id,
    "RUN_FAILED", timestamp, "foreman",
    terminalPayload, terminalSeq,
  );
  const appendTerminal = appendLedgerEvent(currentStore, terminalLedgerEvent);
  if (!appendTerminal.ok) {
    return { ok: false, code: appendTerminal.code, message: appendTerminal.message };
  }
  currentStore = appendTerminal.data;

  // Step 4: HALTING → FAILED (terminal state transition last)
  const toFailed = updateLedgerState(currentStore, runId, "FAILED", timestamp, terminalReason);
  if (!toFailed.ok) {
    return { ok: false, code: "HALT_TERMINAL_TRANSITION_FAILED", message: toFailed.message };
  }
  currentStore = toFailed.data;

  return {
    ok: true,
    store: currentStore,
    haltEvent: haltEventResult.event,
    terminalEvent: terminalEventResult.event,
    terminalState: "FAILED",
  };
}

// ── Cancellation (Command-role only, AC-10) ──────────────────────────────────

export interface CancellationOk {
  ok: true;
  store: RunLedgerStore;
  haltEvent: ExecutionEvent;
  terminalEvent: ExecutionEvent;
  terminal: RunTerminal;
}

export interface CancellationUnauthorised {
  ok: false;
  code: "ACTOR_UNAUTHORISED";
  message: string;
  /** Structured rejection artifact for audit persistence by caller. */
  audit_artifact: {
    run_id: string;
    requested_by: string;
    rejected_at: string;
    reason: "ACTOR_UNAUTHORISED";
  };
}

export interface CancellationFail {
  ok: false;
  code: string;
  message: string;
}

export type CancellationResult = CancellationOk | CancellationUnauthorised | CancellationFail;

/**
 * Request cancellation of a run.
 *
 * AC-10: Only Command-role actors may cancel. Non-Command actors are
 * rejected with code ACTOR_UNAUTHORISED and a structured audit artifact
 * that the caller must persist.
 *
 * Command ruling: RUNNING → CANCELLED (direct, no HALTING intermediate).
 *
 * Event ordering:
 * 1. Append HALT_INITIATED (AC-13: always before terminal event)
 * 2. Append RUN_CANCELLED
 * 3. RUNNING → CANCELLED (terminal state transition last)
 *
 * Returns RunTerminal protocol message for planner-facing artifact.
 */
export function requestCancellation(
  store: RunLedgerStore,
  runId: string,
  requestedBy: string,
  haltEventId: string,
  terminalEventId: string,
  timestamp: string,
  stepCountCompleted: number,
  stepCountTotal: number,
  durationMs: number,
): CancellationResult {
  // AC-10: Reject non-Command with audit artifact
  if (requestedBy !== "Command") {
    return {
      ok: false,
      code: "ACTOR_UNAUTHORISED",
      message: `Only Command-role actors may cancel a run; got: ${requestedBy}`,
      audit_artifact: {
        run_id: runId,
        requested_by: requestedBy,
        rejected_at: timestamp,
        reason: "ACTOR_UNAUTHORISED",
      },
    };
  }

  const ledger = getLedger(store, runId);
  if (!ledger) {
    return { ok: false, code: "CANCEL_RUN_NOT_FOUND", message: `No run found: ${runId}` };
  }

  if (ledger.state !== "RUNNING") {
    return {
      ok: false,
      code: "CANCEL_INVALID_STATE",
      message: `Run must be RUNNING to cancel, got: ${ledger.state}`,
    };
  }

  let currentStore = store;

  // Step 1: Append HALT_INITIATED (AC-13: before terminal event; run still RUNNING)
  const haltSeq = nextSequence(currentStore, runId);
  const haltPayload: HaltInitiatedPayload = {
    reason_code: "COMMAND_CANCELLATION",
    initiated_by: "command_actor",
    evidence: { cancelled_by: requestedBy },
  };

  const haltEventResult = createExecutionEvent(
    haltEventId, runId, ledger.plan_id,
    "HALT_INITIATED", timestamp, "foreman",
    haltPayload, haltSeq,
  );
  if (!haltEventResult.ok) {
    return { ok: false, code: haltEventResult.code, message: haltEventResult.message };
  }

  const haltLedgerEvent = buildLedgerEvent(
    haltEventId, runId, ledger.plan_id,
    "HALT_INITIATED", timestamp, "foreman",
    haltPayload, haltSeq,
  );
  const appendHalt = appendLedgerEvent(currentStore, haltLedgerEvent);
  if (!appendHalt.ok) {
    return { ok: false, code: appendHalt.code, message: appendHalt.message };
  }
  currentStore = appendHalt.data;

  // Step 2: Append RUN_CANCELLED (before terminal state transition)
  const terminalSeq = nextSequence(currentStore, runId);
  const terminalPayload: RunTerminalPayload = {
    terminal_reason: "Cancelled by Command",
    step_count_completed: stepCountCompleted,
    step_count_total: stepCountTotal,
    duration_ms: durationMs,
  };

  const terminalEventResult = createExecutionEvent(
    terminalEventId, runId, ledger.plan_id,
    "RUN_CANCELLED", timestamp, "foreman",
    terminalPayload, terminalSeq,
  );
  if (!terminalEventResult.ok) {
    return { ok: false, code: terminalEventResult.code, message: terminalEventResult.message };
  }

  const terminalLedgerEvent = buildLedgerEvent(
    terminalEventId, runId, ledger.plan_id,
    "RUN_CANCELLED", timestamp, "foreman",
    terminalPayload, terminalSeq,
  );
  const appendTerminal = appendLedgerEvent(currentStore, terminalLedgerEvent);
  if (!appendTerminal.ok) {
    return { ok: false, code: appendTerminal.code, message: appendTerminal.message };
  }
  currentStore = appendTerminal.data;

  // Step 3: RUNNING → CANCELLED (terminal state transition last)
  const toCancelled = updateLedgerState(
    currentStore, runId, "CANCELLED", timestamp, "Cancelled by Command",
  );
  if (!toCancelled.ok) {
    return { ok: false, code: "CANCEL_TRANSITION_FAILED", message: toCancelled.message };
  }
  currentStore = toCancelled.data;

  const finalLedger = getLedger(currentStore, runId)!;
  const terminalResult = buildRunTerminal(finalLedger);
  if (!terminalResult.ok) {
    return { ok: false, code: terminalResult.code, message: terminalResult.message };
  }

  return {
    ok: true,
    store: currentStore,
    haltEvent: haltEventResult.event,
    terminalEvent: terminalEventResult.event,
    terminal: terminalResult.terminal,
  };
}

// ── Stop Condition Handling (§9.3 + Command ruling) ──────────────────────────

/**
 * P1-S3 policy classification constants for halt-required stop conditions.
 *
 * Command ruling: these condition IDs MUST trigger halt regardless of the
 * halt_required flag value. They represent trust, auth, contract, sequence,
 * and ledger integrity risks that cannot be treated as informational-only.
 *
 * This is a closed P1-S3 policy set. Any modification requires Command approval.
 */
const FORCED_HALT_CONDITION_IDS: ReadonlySet<string> = new Set([
  "TRUST_VIOLATION",
  "AUTH_FAILURE",
  "CONTRACT_VIOLATION",
  "SEQUENCE_INTEGRITY",
  "LEDGER_INTEGRITY",
]);

export interface StopConditionHaltResult {
  ok: true;
  halted: true;
  store: RunLedgerStore;
  conditionEvent: ExecutionEvent;
  haltEvent: ExecutionEvent;
  terminalEvent: ExecutionEvent;
}

export interface StopConditionLogResult {
  ok: true;
  halted: false;
  store: RunLedgerStore;
  conditionEvent: ExecutionEvent;
}

export interface StopConditionFail {
  ok: false;
  code: string;
  message: string;
}

export type StopConditionResult =
  | StopConditionHaltResult
  | StopConditionLogResult
  | StopConditionFail;

/**
 * Handle a stop condition.
 *
 * halt_required=true: triggers halt procedure (§9.2).
 * halt_required=false: logged as STOP_CONDITION_TRIGGERED, execution continues (§9.3).
 *
 * Command ruling: halt_required=false is REJECTED when the condition_id
 * is in FORCED_HALT_CONDITION_IDS (P1-S3 policy constants).
 * Those conditions are forced to halt regardless of the flag.
 */
export function handleStopCondition(
  store: RunLedgerStore,
  runId: string,
  payload: StopConditionTriggeredPayload,
  conditionEventId: string,
  haltEventId: string,
  terminalEventId: string,
  timestamp: string,
  stepCountCompleted: number,
  stepCountTotal: number,
  durationMs: number,
): StopConditionResult {
  const ledger = getLedger(store, runId);
  if (!ledger) {
    return { ok: false, code: "STOP_CONDITION_RUN_NOT_FOUND", message: `No run found: ${runId}` };
  }

  if (ledger.state !== "RUNNING") {
    return {
      ok: false,
      code: "STOP_CONDITION_INVALID_STATE",
      message: `Run must be RUNNING to handle stop condition, got: ${ledger.state}`,
    };
  }

  // Command ruling: forced halt for integrity-critical conditions (P1-S3 policy)
  const mustHalt = payload.halt_required || FORCED_HALT_CONDITION_IDS.has(payload.condition_id);

  // Log the stop condition event
  let currentStore = store;
  const conditionSeq = nextSequence(currentStore, runId);

  const conditionEventResult = createExecutionEvent(
    conditionEventId, runId, ledger.plan_id,
    "STOP_CONDITION_TRIGGERED", timestamp, "foreman",
    payload, conditionSeq,
  );
  if (!conditionEventResult.ok) {
    return { ok: false, code: conditionEventResult.code, message: conditionEventResult.message };
  }

  const conditionLedgerEvent = buildLedgerEvent(
    conditionEventId, runId, ledger.plan_id,
    "STOP_CONDITION_TRIGGERED", timestamp, "foreman",
    payload, conditionSeq,
  );
  const appendCondition = appendLedgerEvent(currentStore, conditionLedgerEvent);
  if (!appendCondition.ok) {
    return { ok: false, code: appendCondition.code, message: appendCondition.message };
  }
  currentStore = appendCondition.data;

  if (!mustHalt) {
    // §9.3: Non-halt — logged only, execution continues
    return {
      ok: true,
      halted: false,
      store: currentStore,
      conditionEvent: conditionEventResult.event,
    };
  }

  // Halt required: trigger halt procedure on updated store
  const haltResult = executeHaltProcedure(
    currentStore, runId, "STOP_CONDITION_TRIGGERED", "stop_condition",
    { condition_id: payload.condition_id, evidence: payload.evidence_summary },
    haltEventId, terminalEventId, timestamp,
    stepCountCompleted, stepCountTotal, durationMs,
  );

  if (!haltResult.ok) {
    return { ok: false, code: haltResult.code, message: haltResult.message };
  }

  return {
    ok: true,
    halted: true,
    store: haltResult.store,
    conditionEvent: conditionEventResult.event,
    haltEvent: haltResult.haltEvent,
    terminalEvent: haltResult.terminalEvent,
  };
}

// ── P1-S7: Pre-Run Assessment Orchestrator ────────────────────────────────────

/**
 * Assess a plan for execution readiness.
 *
 * Thin pass-through to P1-S6's assessReadiness. Named entry point for
 * readiness assessment in the execution path context so future pre-execution
 * checks compose here rather than modifying the P1-S6 gate.
 *
 * Pure function — no side effects, no mutation of inputs.
 */
export function assessForExecution(plan: PlanArtifact): ReadinessVerdict {
  return assessReadiness(plan);
}

// ── P1-S7: Verdict Deep-Freeze ────────────────────────────────────────────────

/**
 * Produce a deep-frozen snapshot of a ReadinessVerdict.
 *
 * Freezes the verdict container, the findings array, and each finding object.
 * Called before recording the verdict on the run ledger entry so that the
 * stored copy is immutable regardless of what the caller does with the original.
 */
function deepFreezeVerdict(verdict: ReadinessVerdict): Readonly<ReadinessVerdict> {
  return Object.freeze({
    status: verdict.status,
    findings: Object.freeze(verdict.findings.map((f) => Object.freeze({ ...f }))),
    assessed_plan_hash: verdict.assessed_plan_hash,
    computed_plan_hash: verdict.computed_plan_hash,
  }) as Readonly<ReadinessVerdict>;
}

// ── P1-S7: Governed Run Creation ─────────────────────────────────────────────

/**
 * Governed run creation path (P1-S7).
 *
 * Requires a ReadinessVerdict from assessForExecution (or assessReadiness directly).
 * Enforces in order:
 *   1. NOT_READY verdict  → structured ReadinessRejection; no ledger write.
 *   2. PLAN_HASH_STALE    → structured ReadinessRejection; no ledger write.
 *   3. READY + hash match → create run ledger entry with frozen readiness_verdict.
 *
 * No run may be created through this path without a READY verdict.
 * The verdict is deep-frozen and recorded as an immutable field on the ledger entry.
 *
 * Precondition violations (invalid run_id format, active run collision) throw
 * rather than return ReadinessRejection — they indicate caller programming errors,
 * not expected readiness rejection conditions.
 *
 * Does not call processHandoff — operates at the ledger layer directly so
 * the readiness guard is inseparable from ledger construction.
 */
export function initiateRunWithReadiness(
  plan: PlanArtifact,
  verdict: ReadinessVerdict,
  store: RunLedgerStore,
  runId: string,
  foremanVersion: string,
  timestamp: string,
  requestedBy: string,
): RunCreationResult {
  // Guard 1: verdict must be READY
  if (verdict.status !== "READY") {
    return { rejected: true, reason: "NOT_READY", verdict };
  }

  // Guard 2: assessed plan hash must match current plan hash (no stale verdict)
  const currentPlanHash = plan.plan_hash ?? "";
  if (verdict.assessed_plan_hash !== currentPlanHash) {
    return { rejected: true, reason: "PLAN_HASH_STALE", verdict };
  }

  // Precondition: run_id must be valid format
  if (!isValidRunId(runId)) {
    throw new Error(`initiateRunWithReadiness: invalid run_id format: ${runId}`);
  }

  // Precondition: no active run may exist for this plan
  if (hasActiveRun(store, plan.plan_id)) {
    throw new Error(
      `initiateRunWithReadiness: active run already exists for plan_id: ${plan.plan_id}`,
    );
  }

  // Deep-freeze the verdict before recording — stored copy must be immutable
  const frozenVerdict = deepFreezeVerdict(verdict);

  // Build run ledger entry with frozen verdict as an inseparable birth record
  const ledger: RunLedger = {
    run_id: runId,
    plan_id: plan.plan_id,
    plan_version: plan.version,
    plan_snapshot: JSON.parse(JSON.stringify(plan)),
    plan_snapshot_chksum: plan.plan_hash ?? "",
    state: "PENDING_ACK",
    state_entered_at: timestamp,
    requested_by: requestedBy,
    foreman_version: foremanVersion,
    created_at: timestamp,
    terminal_at: null,
    terminal_reason: null,
    readiness_verdict: frozenVerdict,
  };

  const ledgerResult = createRunLedger(store, ledger);
  if (!ledgerResult.ok) {
    throw new Error(
      `initiateRunWithReadiness: ledger creation failed: ${ledgerResult.code} — ${ledgerResult.message}`,
    );
  }

  const ledgerEntry = ledgerResult.data.ledgers.get(runId)!;
  return { created: true, run_id: runId, ledger_entry: ledgerEntry };
}
