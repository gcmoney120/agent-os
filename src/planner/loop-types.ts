/**
 * Agent OS — Planner Subsystem P1-S5: Execution Loop Types
 *
 * Types only — no runtime logic, no side effects.
 *
 * Scope: loop lifecycle states, event envelope, step outcome intake,
 *        public LoopState shape, error classes.
 */

// ── Loop Lifecycle States ──────────────────────────────────────────────────────

export type LoopStatus =
  | "IDLE"
  | "READY"
  | "RUNNING"
  | "AWAITING_RESULTS"
  | "HALTED"
  | "COMPLETED"
  | "FAILED";

/** Terminal states: no exit transitions permitted. */
export const TERMINAL_LOOP_STATUSES: ReadonlySet<LoopStatus> = new Set<LoopStatus>([
  "HALTED",
  "COMPLETED",
  "FAILED",
]);

// ── Loop Event Types ───────────────────────────────────────────────────────────

export type LoopEventType =
  | "LOOP_STARTED"
  | "STEP_DISPATCHED"
  | "STEP_RESULT_RECEIVED"
  | "LOOP_PROGRESSION_TICK"
  | "LOOP_HALTED"
  | "LOOP_COMPLETED"
  | "LOOP_FAILED"
  | "LOOP_WARNING";

// ── Step Outcome ──────────────────────────────────────────────────────────────

export type StepOutcomeStatus = "SUCCESS" | "FAILED" | "SKIPPED";

/**
 * Result of a step execution, supplied by the caller via intake_result(step_id, outcome).
 *
 * step_id is carried at the intake_result() call boundary — it is intentionally
 * absent here to avoid ambiguity and mismatch risk between call-site identity
 * and payload identity.
 */
export interface StepOutcome {
  readonly status: StepOutcomeStatus;
  readonly output: unknown | null;
  readonly completed_at: string;
}

// ── Loop Event ────────────────────────────────────────────────────────────────

/**
 * Immutable append-only event record.
 * Events are never mutated or removed from the loop event log.
 */
export interface LoopEvent {
  readonly event_id: string;
  readonly event_type: LoopEventType;
  readonly emitted_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

// ── Loop State (public snapshot) ──────────────────────────────────────────────

/**
 * Snapshot of the loop's runtime state returned by get_state().
 *
 * pending_set is a sorted string array to ensure artifact-safe, serialisable,
 * deterministically ordered output. Mutations to the returned value do not
 * affect loop state.
 */
export interface LoopState {
  readonly plan_id: string;
  readonly loop_status: LoopStatus;
  /** Step IDs currently awaiting results. Sorted lexicographically ascending. */
  readonly pending_set: readonly string[];
  readonly tick_count: number;
  readonly started_at: string | null;
  readonly terminal_at: string | null;
  readonly terminal_reason: string | null;
}

// ── Error Classes ─────────────────────────────────────────────────────────────

/** Raised by load_plan() when the supplied plan is structurally invalid. */
export class InvalidPlanError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "InvalidPlanError";
    this.code = code;
  }
}

/** Raised by start() or load_plan() when the loop is not in the required state. */
export class InvalidStateError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "InvalidStateError";
    this.code = code;
  }
}
