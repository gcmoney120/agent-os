/**
 * Agent OS — Planner Subsystem P1-S2: Deterministic State Transitions
 *
 * Implements the P1 v1.1 §2 transition table for PlannerSessionState.
 * Pure function. No I/O. No mutation. No side effects.
 *
 * Allowed transitions are explicitly enumerated.
 * All other transitions are rejected with a structured reason.
 *
 * PlannerSessionState imported from types.ts (canonical shared type).
 */

import type { PlannerSessionState } from "./types.js";

// ── Transition Events ───────────────────────────────────────────────────────

export type PlannerEvent =
  | "GOAL_SUBMITTED"
  | "GOAL_VALIDATED"
  | "GOAL_INVALID"
  | "DECOMPOSITION_COMPLETE"
  | "DECOMPOSITION_FAILED"
  | "PLAN_FINALIZED_SENTINEL"
  | "PLAN_FINALIZED_REVIEW"
  | "SENTINEL_PREREVIEW_PASSED"
  | "SENTINEL_PREREVIEW_FAILED"
  | "COMMAND_APPROVED"
  | "COMMAND_REJECTED"
  | "REJECTION_CLEARED"
  | "EXECUTION_STARTED"
  | "EXECUTION_COMPLETE"
  | "EXECUTION_HALTED"
  | "HALT_CLEARED";

// ── Transition Result ───────────────────────────────────────────────────────

export interface TransitionOk {
  ok: true;
  from: PlannerSessionState;
  to: PlannerSessionState;
  event: PlannerEvent;
}

export interface TransitionFail {
  ok: false;
  from: PlannerSessionState;
  event: PlannerEvent;
  reason: string;
}

export type TransitionResult = TransitionOk | TransitionFail;

// ── Allowed Transition Map (P1 v1.1 §2) ────────────────────────────────────

const ALLOWED_TRANSITIONS: ReadonlyMap<
  PlannerSessionState,
  ReadonlyMap<PlannerEvent, PlannerSessionState>
> = new Map([
  [
    "IDLE",
    new Map<PlannerEvent, PlannerSessionState>([
      ["GOAL_SUBMITTED", "GOAL_RECEIVED"],
    ]),
  ],
  [
    "GOAL_RECEIVED",
    new Map<PlannerEvent, PlannerSessionState>([
      ["GOAL_VALIDATED", "DECOMPOSING"],
      ["GOAL_INVALID", "HALTED"],
    ]),
  ],
  [
    "DECOMPOSING",
    new Map<PlannerEvent, PlannerSessionState>([
      ["DECOMPOSITION_COMPLETE", "PLAN_DRAFT"],
      ["DECOMPOSITION_FAILED", "HALTED"],
    ]),
  ],
  [
    "PLAN_DRAFT",
    new Map<PlannerEvent, PlannerSessionState>([
      ["PLAN_FINALIZED_SENTINEL", "SENTINEL_PREREVIEW"],
      ["PLAN_FINALIZED_REVIEW", "REVIEW_PENDING"],
    ]),
  ],
  [
    "SENTINEL_PREREVIEW",
    new Map<PlannerEvent, PlannerSessionState>([
      ["SENTINEL_PREREVIEW_PASSED", "REVIEW_PENDING"],
      ["SENTINEL_PREREVIEW_FAILED", "HALTED"],
    ]),
  ],
  [
    "REVIEW_PENDING",
    new Map<PlannerEvent, PlannerSessionState>([
      ["COMMAND_APPROVED", "APPROVED"],
      ["COMMAND_REJECTED", "REJECTED"],
    ]),
  ],
  [
    "REJECTED",
    new Map<PlannerEvent, PlannerSessionState>([
      ["REJECTION_CLEARED", "IDLE"],
    ]),
  ],
  [
    "APPROVED",
    new Map<PlannerEvent, PlannerSessionState>([
      ["EXECUTION_STARTED", "EXECUTING"],
    ]),
  ],
  [
    "EXECUTING",
    new Map<PlannerEvent, PlannerSessionState>([
      ["EXECUTION_COMPLETE", "COMPLETE"],
      ["EXECUTION_HALTED", "HALTED"],
    ]),
  ],
  [
    "HALTED",
    new Map<PlannerEvent, PlannerSessionState>([
      ["HALT_CLEARED", "IDLE"],
    ]),
  ],
  [
    "COMPLETE",
    new Map<PlannerEvent, PlannerSessionState>([]),
  ],
]);

// ── Forbidden Transition Reasons (exact state + event pairs) ────────────────

function forbiddenKey(state: PlannerSessionState, event: PlannerEvent): string {
  return `${state}:${event}`;
}

const FORBIDDEN_REASONS: ReadonlyMap<string, string> = new Map([
  // HALTED cannot start execution — must clear halt first
  [forbiddenKey("HALTED", "EXECUTION_STARTED"), "Cannot start execution from HALTED; must clear halt first"],

  // APPROVED — no draft/decomposition/finalization mutations allowed
  [forbiddenKey("APPROVED", "GOAL_SUBMITTED"), "Cannot submit a new goal after approval"],
  [forbiddenKey("APPROVED", "GOAL_VALIDATED"), "Cannot re-validate goal after approval"],
  [forbiddenKey("APPROVED", "DECOMPOSITION_COMPLETE"), "Cannot mutate steps after approval"],
  [forbiddenKey("APPROVED", "PLAN_FINALIZED_SENTINEL"), "Cannot re-finalize plan after approval"],
  [forbiddenKey("APPROVED", "PLAN_FINALIZED_REVIEW"), "Cannot re-finalize plan after approval"],

  // EXECUTING — no rollback to draft/decomposition/finalization
  [forbiddenKey("EXECUTING", "DECOMPOSITION_COMPLETE"), "Cannot return to draft during execution"],
  [forbiddenKey("EXECUTING", "PLAN_FINALIZED_SENTINEL"), "Cannot re-finalize plan during execution"],
  [forbiddenKey("EXECUTING", "PLAN_FINALIZED_REVIEW"), "Cannot re-finalize plan during execution"],

  // SENTINEL_PREREVIEW — cannot bypass prereview via direct approval
  [forbiddenKey("SENTINEL_PREREVIEW", "COMMAND_APPROVED"), "Cannot approve without Sentinel prereview completion"],

  // COMPLETE — terminal state, no outbound transitions
  [forbiddenKey("COMPLETE", "GOAL_SUBMITTED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "GOAL_VALIDATED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "GOAL_INVALID"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "DECOMPOSITION_COMPLETE"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "DECOMPOSITION_FAILED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "PLAN_FINALIZED_SENTINEL"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "PLAN_FINALIZED_REVIEW"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "SENTINEL_PREREVIEW_PASSED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "SENTINEL_PREREVIEW_FAILED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "COMMAND_APPROVED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "COMMAND_REJECTED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "REJECTION_CLEARED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "EXECUTION_STARTED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "EXECUTION_COMPLETE"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "EXECUTION_HALTED"), "Session is in terminal state COMPLETE"],
  [forbiddenKey("COMPLETE", "HALT_CLEARED"), "Session is in terminal state COMPLETE"],
]);

// ── Transition Function ─────────────────────────────────────────────────────

/**
 * Deterministic state transition for the planner runtime session.
 *
 * Returns a structured result — never throws.
 * Only transitions explicitly listed in ALLOWED_TRANSITIONS are permitted.
 * All other (state, event) pairs are rejected with a reason.
 */
export function transitionPlannerState(
  currentState: PlannerSessionState,
  event: PlannerEvent,
): TransitionResult {
  const stateTransitions = ALLOWED_TRANSITIONS.get(currentState);

  if (!stateTransitions || !stateTransitions.has(event)) {
    const key = forbiddenKey(currentState, event);
    const reason =
      FORBIDDEN_REASONS.get(key) ??
      `Transition not allowed: ${currentState} + ${event}`;

    return {
      ok: false,
      from: currentState,
      event,
      reason,
    };
  }

  const targetState = stateTransitions.get(event)!;

  return {
    ok: true,
    from: currentState,
    to: targetState,
    event,
  };
}

// ── Helper ──────────────────────────────────────────────────────────────────

/**
 * Pure predicate: is this (state, event) pair an allowed transition?
 */
export function isTransitionAllowed(
  currentState: PlannerSessionState,
  event: PlannerEvent,
): boolean {
  const stateTransitions = ALLOWED_TRANSITIONS.get(currentState);
  return stateTransitions !== undefined && stateTransitions.has(event);
}
