/**
 * Agent OS — Planner Subsystem P1-S4: Step Dispatch Types
 *
 * Types only — no runtime logic, no side effects.
 *
 * Scope: step lifecycle, dispatch signalling, execution events,
 *        dispatch mode, failure policy, plan outcome.
 *
 * NOTE: ExecutionEvent here is the P1-S4 step-level transition event.
 * It is distinct from the run-level ExecutionEvent in execution-types.ts (P1-S3).
 *
 * Architecture invariants:
 * - DispatchQueue is derived, never stored.
 * - Plan terminal outcome is derived, never stored.
 * - No plan.state field exists on DispatchPlan.
 * - Invalid actor/transition events are NOT encoded as ExecutionEvent records.
 *   They are rejected and logged via a separate surface (dispatch-engine.ts).
 */

// ── Step Lifecycle States ─────────────────────────────────────────────────────

export type StepState =
  | "PENDING"
  | "READY"
  | "DISPATCHED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export const STEP_STATES: ReadonlySet<string> = new Set<StepState>([
  "PENDING",
  "READY",
  "DISPATCHED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
]);

/** Terminal step states — no further transitions are permitted. */
export const TERMINAL_STEP_STATES: ReadonlySet<string> = new Set<StepState>([
  "COMPLETED",
  "FAILED",
  "SKIPPED",
]);

// ── Dispatch Mode ─────────────────────────────────────────────────────────────

export type DispatchMode = "SEQUENTIAL" | "PARALLEL";

// ── Failure Policy ────────────────────────────────────────────────────────────

export type FailurePolicy = "halt" | "skip_dependents" | "continue";

// ── Plan Outcome ──────────────────────────────────────────────────────────────

/**
 * Derived plan terminal outcome.
 * Never stored on DispatchPlan — always computed from step states.
 */
export type PlanOutcome = "SUCCEEDED" | "HALTED" | "PARTIAL" | "FAILED";

// ── Step Event Actor ──────────────────────────────────────────────────────────

export type StepEventActor = "SYSTEM" | "WORKER" | "TIMEOUT_WATCHDOG";

export const STEP_EVENT_ACTORS: ReadonlySet<string> = new Set<StepEventActor>([
  "SYSTEM",
  "WORKER",
  "TIMEOUT_WATCHDOG",
]);

// ── StepNode ──────────────────────────────────────────────────────────────────

/**
 * A single unit of work within a plan.
 *
 * step_id, priority, and depends_on are immutable after plan binding.
 * Only `state` and the runtime dispatch linkage field (`last_dispatch_signal_id`)
 * may change during progression.
 *
 * last_dispatch_signal_id is optional runtime linkage only.
 * It is not a source of truth for dispatch history.
 * The authoritative record of all transitions is the DispatchPlan event log.
 */
export interface StepNode {
  readonly step_id: string;
  readonly priority: number;
  readonly depends_on: readonly string[];
  state: StepState;
  last_dispatch_signal_id?: string;
}

// ── DispatchPlan ──────────────────────────────────────────────────────────────

/**
 * Runtime projection used by the dispatch engine.
 *
 * - plan_id, run_id, dispatch_mode, concurrency_limit, and on_failure
 *   are immutable after binding.
 * - steps holds the mutable per-step lifecycle state.
 * - events is append-only; no event is ever mutated or removed.
 * - DispatchQueue is derived (never stored on this structure).
 * - Plan terminal outcome is derived (never stored on this structure).
 * - No plan.state field exists.
 */
export interface DispatchPlan {
  readonly plan_id: string;
  readonly run_id: string;
  readonly dispatch_mode: DispatchMode;
  readonly concurrency_limit: number;
  readonly on_failure: FailurePolicy;
  readonly steps: StepNode[];
  readonly events: ExecutionEvent[];
}

// ── StepDispatchSignal ────────────────────────────────────────────────────────

/**
 * Emitted by the engine for every READY → DISPATCHED transition.
 * The READY → DISPATCHED transition occurs atomically with signal emission.
 */
export interface StepDispatchSignal {
  readonly signal_id: string;
  readonly run_id: string;
  readonly plan_id: string;
  readonly step_id: string;
  readonly dispatched_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

// ── ExecutionEvent (P1-S4 step-level) ────────────────────────────────────────

/**
 * Immutable record of a valid state transition on a step.
 * Events are append-only. No event is ever deleted or mutated.
 *
 * Only valid transitions with valid actors produce an ExecutionEvent.
 * Invalid actor or invalid transition events are NOT recorded here —
 * they are rejected and logged via a separate rejection surface.
 */
export interface ExecutionEvent {
  readonly event_id: string;
  readonly run_id: string;
  readonly plan_id: string;
  readonly step_id: string;
  readonly from_state: StepState;
  readonly to_state: StepState;
  readonly actor: StepEventActor;
  readonly occurred_at: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ── StepDefinition (input to bind_plan) ──────────────────────────────────────

/** Caller-supplied step definition for plan binding. */
export interface StepDefinition {
  readonly step_id: string;
  readonly priority: number;
  readonly depends_on: readonly string[];
}
