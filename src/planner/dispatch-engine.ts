/**
 * Agent OS — Planner Subsystem P1-S4: Dispatch Engine
 *
 * Core engine functions for step dispatch and execution progression.
 * No workers. No timeout watchdog runtime. No retry logic.
 * No stored dispatch queue. No stored plan terminal state.
 *
 * Transition authority model:
 *   All state transitions — whether engine-initiated (resolve_ready_steps,
 *   emit_dispatch_signal, propagate_skip_dependents) or externally reported
 *   (apply_state_transition) — pass through the same transition and actor
 *   validity guards before any event is constructed or state is mutated.
 *   Engine-internal transitions use makeValidatedEngineEvent, which enforces
 *   the same closed-set checks as the external surface. Callers outside this
 *   module use the public API only.
 *
 * READY → DISPATCHED atomicity (emit_dispatch_signal):
 *   READY → DISPATCHED is treated as atomic within this engine surface because
 *   signal creation, valid event creation, state mutation, and event append all
 *   occur inside one guarded commit path. If any precondition or signal-creation
 *   step fails before the commit block, no mutation occurs and no event is
 *   appended.
 *
 * Invalid-event rejection separation from plan.events (apply_state_transition):
 *   When an event carries an invalid actor, the function returns
 *   { ok: false, code: "INVALID_EVENT", rejection: InvalidEventRecord }.
 *   The rejection record is returned to the caller for logging.
 *   No ExecutionEvent is pushed to plan.events in any failure path.
 *   plan.events contains only valid, successfully applied step-transition events.
 *
 * dispatch_signal linkage:
 *   last_dispatch_signal_id on StepNode is last-known dispatch linkage only,
 *   not current dispatch status. It is not cleared on subsequent transitions.
 *   The authoritative record of all transitions is plan.events.
 */

import { randomUUID } from "node:crypto";
import type {
  DispatchPlan,
  StepNode,
  StepState,
  StepEventActor,
  ExecutionEvent,
  StepDispatchSignal,
  PlanOutcome,
  DispatchMode,
  FailurePolicy,
  StepDefinition,
} from "./dispatch-types.js";
import { TERMINAL_STEP_STATES } from "./dispatch-types.js";
import {
  detectDependencyCycle,
  isValidTransition,
  isValidActorForTransition,
  isMatchingBoundRunId,
} from "./dispatch-validate.js";

// ── Exported Types ────────────────────────────────────────────────────────────

/**
 * Incoming transition request submitted by a worker or the engine.
 * Input surface for apply_state_transition — not an ExecutionEvent and does
 * not enter plan.events directly.
 */
export interface IncomingTransition {
  readonly run_id: string;
  readonly step_id: string;
  readonly from_state: StepState;
  readonly to_state: StepState;
  readonly actor: StepEventActor;
  readonly occurred_at: string;
  readonly metadata: Record<string, unknown>;
}

/**
 * Rejection record produced when apply_state_transition rejects an event due
 * to invalid actor authority (AC-S4-08). This is a logging surface only.
 * It must never enter plan.events. It is not an ExecutionEvent.
 */
export interface InvalidEventRecord {
  readonly rejected_at: string;
  readonly run_id_candidate: string;
  readonly plan_id: string;
  readonly step_id: string;
  readonly from_state: StepState;
  readonly to_state: StepState;
  readonly actor: string;
  readonly reject_reason: string;
}

// ── Result Types ──────────────────────────────────────────────────────────────

export interface BindPlanOk {
  readonly ok: true;
  readonly plan: DispatchPlan;
}

export interface BindPlanFail {
  readonly ok: false;
  readonly code: "DEPENDENCY_CYCLE" | "DUPLICATE_STEP_ID" | "INVALID_CONCURRENCY_LIMIT";
  readonly message: string;
  readonly cycle_path?: readonly string[];
}

export type BindPlanResult = BindPlanOk | BindPlanFail;

export interface DispatchStepOk {
  readonly ok: true;
  readonly signal: StepDispatchSignal;
  readonly event: ExecutionEvent;
}

export interface DispatchStepFail {
  readonly ok: false;
  readonly code: "STEP_NOT_READY" | "STEP_NOT_FOUND";
  readonly message: string;
}

export type DispatchStepResult = DispatchStepOk | DispatchStepFail;

export interface TransitionOk {
  readonly ok: true;
  readonly event: ExecutionEvent;
}

export interface TransitionFailSimple {
  readonly ok: false;
  readonly code:
    | "RUN_ID_MISMATCH"
    | "STEP_NOT_FOUND"
    | "TERMINAL_STATE_LOCKED"
    | "STATE_MISMATCH"
    | "INVALID_TRANSITION";
  readonly message: string;
}

export interface TransitionFailInvalidEvent {
  readonly ok: false;
  readonly code: "INVALID_EVENT";
  readonly message: string;
  readonly rejection: InvalidEventRecord;
}

export type TransitionFail = TransitionFailSimple | TransitionFailInvalidEvent;
export type TransitionResult = TransitionOk | TransitionFail;

// ── bind_plan ─────────────────────────────────────────────────────────────────

/**
 * Initialises a DispatchPlan runtime projection from a set of step definitions.
 *
 * Validation order (fail-closed before any binding):
 *   1. Duplicate step_id values → DUPLICATE_STEP_ID
 *   2. concurrency_limit validity:
 *        SEQUENTIAL: limit must be absent or exactly 1
 *        PARALLEL:   limit must be a positive integer >= 1
 *        → INVALID_CONCURRENCY_LIMIT
 *   3. Dependency cycles → DEPENDENCY_CYCLE
 *
 * After validation:
 *   All steps initialised to PENDING.
 *   resolve_ready_steps run immediately to transition zero-dependency steps
 *   to READY (AC-S4-01).
 *
 * No plan mutation is permitted beyond runtime progression state changes
 * after this function returns.
 */
export function bind_plan(
  plan_id: string,
  run_id: string,
  step_defs: ReadonlyArray<StepDefinition>,
  options?: {
    readonly dispatch_mode?: DispatchMode;
    readonly concurrency_limit?: number;
    readonly on_failure?: FailurePolicy;
  },
): BindPlanResult {
  const mode: DispatchMode = options?.dispatch_mode ?? "SEQUENTIAL";
  const rawLimit = options?.concurrency_limit;

  // 1. Reject duplicate step_id values
  const seen = new Set<string>();
  for (const def of step_defs) {
    if (seen.has(def.step_id)) {
      return {
        ok: false,
        code: "DUPLICATE_STEP_ID",
        message: `Duplicate step_id "${def.step_id}" in plan step definitions`,
      };
    }
    seen.add(def.step_id);
  }

  // 2. Validate concurrency_limit
  const concurrencyError = validateConcurrencyLimit(mode, rawLimit);
  if (concurrencyError !== null) {
    return {
      ok: false,
      code: "INVALID_CONCURRENCY_LIMIT",
      message: concurrencyError,
    };
  }
  const concurrency_limit = rawLimit ?? 1;

  // 3. Detect dependency cycles
  const cycleResult = detectDependencyCycle(step_defs);
  if (cycleResult.has_cycle) {
    return {
      ok: false,
      code: "DEPENDENCY_CYCLE",
      message: "Dependency cycle detected in plan step definitions",
      cycle_path: cycleResult.cycle_path,
    };
  }

  const plan: DispatchPlan = {
    plan_id,
    run_id,
    dispatch_mode: mode,
    concurrency_limit,
    on_failure: options?.on_failure ?? "halt",
    steps: step_defs.map((def): StepNode => ({
      step_id: def.step_id,
      priority: def.priority,
      depends_on: Object.freeze([...def.depends_on]) as readonly string[],
      state: "PENDING",
    })),
    events: [],
  };

  resolve_ready_steps(plan);

  return { ok: true, plan };
}

// ── resolve_ready_steps ───────────────────────────────────────────────────────

/**
 * Scans PENDING steps and transitions to READY any whose every declared
 * dependency is COMPLETED. Emits exactly one PENDING → READY ExecutionEvent
 * per newly resolved step, actor SYSTEM, validated through the engine's
 * transition authority guard.
 *
 * Resolution is NOT triggered by FAILED or SKIPPED dependency states.
 *
 * Must be called:
 *   - once during bind_plan (zero-dependency steps)
 *   - after every step reaches COMPLETED
 */
export function resolve_ready_steps(plan: DispatchPlan): { resolved: number } {
  const stepMap = new Map(plan.steps.map(s => [s.step_id, s]));
  let resolved = 0;

  for (const step of plan.steps) {
    if (step.state !== "PENDING") continue;

    const allDepsDone = step.depends_on.every(
      depId => stepMap.get(depId)?.state === "COMPLETED",
    );

    if (allDepsDone) {
      const event = makeValidatedEngineEvent(
        plan, step.step_id, "PENDING", "READY", "SYSTEM", {},
      );
      step.state = "READY";
      plan.events.push(event);
      resolved++;
    }
  }

  return { resolved };
}

// ── recompute_dispatch_queue ──────────────────────────────────────────────────

/**
 * Returns a derived, ordered list of READY steps eligible for dispatch.
 *
 * Ordering (deterministic, §4.4):
 *   Primary:   priority ascending  (lower integer = higher priority)
 *   Secondary: step_id lexicographic ascending
 *
 * The returned array is a new snapshot — never stored on the plan.
 * Callers must recompute after every state transition.
 */
export function recompute_dispatch_queue(plan: DispatchPlan): StepNode[] {
  return plan.steps
    .filter(s => s.state === "READY")
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.step_id < b.step_id ? -1 : a.step_id > b.step_id ? 1 : 0;
    });
}

// ── select_next_step ──────────────────────────────────────────────────────────

/**
 * Returns the steps to dispatch from a pre-computed ordered queue, enforcing
 * sequential/parallel concurrency constraints.
 *
 *   SEQUENTIAL: dispatch at most one step; only when active_count = 0.
 *   PARALLEL:   dispatch up to (concurrency_limit − active_count) steps.
 *               Never exceeds concurrency_limit. Never reorders the queue.
 *
 * active_count must be the current count of steps in DISPATCHED or RUNNING
 * state, computed by the caller from plan.steps before this call.
 */
export function select_next_step(
  queue: readonly StepNode[],
  mode: DispatchMode,
  concurrency_limit: number,
  active_count: number,
): StepNode[] {
  if (mode === "SEQUENTIAL") {
    if (active_count > 0) return [];
    return queue.slice(0, 1);
  }
  // PARALLEL
  const available = Math.max(0, concurrency_limit - active_count);
  return queue.slice(0, available);
}

// ── emit_dispatch_signal ──────────────────────────────────────────────────────

/**
 * Emits a StepDispatchSignal and atomically advances the step from READY to
 * DISPATCHED.
 *
 * READY → DISPATCHED is treated as atomic within this engine surface because
 * signal creation, valid event creation, state mutation, and event append all
 * occur inside one guarded commit path. If any precondition or signal-creation
 * step fails before the commit block, no mutation occurs and no event is
 * appended.
 *
 * Preconditions checked (fail-closed before commit):
 *   1. step_id exists in plan.steps (STEP_NOT_FOUND)
 *   2. step.state is READY (STEP_NOT_READY)
 *   3. READY → DISPATCHED / SYSTEM is a valid transition — enforced by
 *      makeValidatedEngineEvent before event is constructed
 *
 * last_dispatch_signal_id is set as last-known dispatch linkage only.
 * It is not cleared on subsequent transitions. The authoritative record
 * of all transitions is plan.events.
 */
export function emit_dispatch_signal(
  plan: DispatchPlan,
  step: StepNode,
  payload: Record<string, unknown> = {},
): DispatchStepResult {
  // Precondition 1: step must exist in this plan
  const planStep = plan.steps.find(s => s.step_id === step.step_id);
  if (planStep === undefined) {
    return {
      ok: false,
      code: "STEP_NOT_FOUND",
      message: `Step "${step.step_id}" does not belong to this plan`,
    };
  }

  // Precondition 2: step must be READY
  if (planStep.state !== "READY") {
    return {
      ok: false,
      code: "STEP_NOT_READY",
      message: `Step "${planStep.step_id}" must be READY before dispatch (current: ${planStep.state})`,
    };
  }

  // Construct signal and event before touching any mutable state.
  // makeValidatedEngineEvent enforces transition validity before construction.
  const signal_id = randomUUID();
  const dispatched_at = new Date().toISOString();

  const signal: StepDispatchSignal = Object.freeze({
    signal_id,
    run_id: plan.run_id,
    plan_id: plan.plan_id,
    step_id: planStep.step_id,
    dispatched_at,
    payload: Object.freeze({ ...payload }),
  });

  const event = makeValidatedEngineEvent(
    plan, planStep.step_id, "READY", "DISPATCHED", "SYSTEM", { signal_id },
  );

  // Guarded commit: state mutation and event append together.
  planStep.state = "DISPATCHED";
  planStep.last_dispatch_signal_id = signal_id;
  plan.events.push(event);

  return { ok: true, signal, event };
}

// ── apply_state_transition ────────────────────────────────────────────────────

/**
 * Validates and applies an incoming state transition reported by a worker
 * or external actor.
 *
 * Validation order (fail-first):
 *   1. run_id equality — trust gate (AC-S4-09)
 *   2. step existence
 *   3. terminal state lock — no terminal state may transition
 *   4. from_state matches current step state
 *   5. transition is in the closed valid set
 *   6. actor is authorised for this transition → INVALID_EVENT (AC-S4-08)
 *
 * On success:
 *   Appends exactly one ExecutionEvent to plan.events; returns it.
 * On any failure:
 *   plan.events is not modified.
 * On INVALID_EVENT (step 6):
 *   Returns InvalidEventRecord to caller for logging.
 *   The record is NOT written to plan.events.
 */
export function apply_state_transition(
  plan: DispatchPlan,
  incoming: IncomingTransition,
): TransitionResult {
  // 1. run_id trust gate (AC-S4-09)
  if (!isMatchingBoundRunId(incoming.run_id, plan.run_id)) {
    return {
      ok: false,
      code: "RUN_ID_MISMATCH",
      message: `run_id mismatch: incoming "${incoming.run_id}" does not match bound run_id`,
    };
  }

  // 2. Step existence
  const step = plan.steps.find(s => s.step_id === incoming.step_id);
  if (step === undefined) {
    return {
      ok: false,
      code: "STEP_NOT_FOUND",
      message: `Step "${incoming.step_id}" not found in plan`,
    };
  }

  // 3. Terminal state lock
  if (TERMINAL_STEP_STATES.has(step.state)) {
    return {
      ok: false,
      code: "TERMINAL_STATE_LOCKED",
      message: `Step "${step.step_id}" is in terminal state "${step.state}" and may not transition`,
    };
  }

  // 4. from_state must describe current step state
  if (step.state !== incoming.from_state) {
    return {
      ok: false,
      code: "STATE_MISMATCH",
      message: `from_state "${incoming.from_state}" does not match current step state "${step.state}"`,
    };
  }

  // 5. Transition must be in the closed valid set
  if (!isValidTransition(incoming.from_state, incoming.to_state)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Transition "${incoming.from_state}" → "${incoming.to_state}" is not permitted`,
    };
  }

  // 6. Actor authority — invalid actor → INVALID_EVENT (AC-S4-08)
  if (!isValidActorForTransition(incoming.from_state, incoming.to_state, incoming.actor)) {
    const rejection: InvalidEventRecord = {
      rejected_at: new Date().toISOString(),
      run_id_candidate: incoming.run_id,
      plan_id: plan.plan_id,
      step_id: incoming.step_id,
      from_state: incoming.from_state,
      to_state: incoming.to_state,
      actor: incoming.actor,
      reject_reason:
        `Actor "${incoming.actor}" is not authorised for transition` +
        ` "${incoming.from_state}" → "${incoming.to_state}"`,
    };
    // Rejection returned to caller — NOT appended to plan.events
    return { ok: false, code: "INVALID_EVENT", message: rejection.reject_reason, rejection };
  }

  // All checks passed — construct and commit the event.
  const event: ExecutionEvent = {
    event_id: randomUUID(),
    run_id: incoming.run_id,
    plan_id: plan.plan_id,
    step_id: incoming.step_id,
    from_state: incoming.from_state,
    to_state: incoming.to_state,
    actor: incoming.actor,
    occurred_at: incoming.occurred_at,
    metadata: Object.freeze({ ...incoming.metadata }),
  };

  step.state = incoming.to_state;
  plan.events.push(event);

  return { ok: true, event };
}

// ── propagate_skip_dependents ─────────────────────────────────────────────────

/**
 * Transitively skips all dependents of a failed step.
 *
 * Traversal: BFS from failed_step_id over the reverse dependency graph.
 *
 * Only PENDING or READY steps may transition to SKIPPED (per Atlas transition
 * table — DISPATCHED and RUNNING have no SKIPPED path in P1-S4).
 *
 * Deterministic event emission order:
 *   Collected target step_ids are sorted before events are emitted:
 *     Primary:   priority ascending
 *     Secondary: step_id lexicographic ascending
 *   This preserves append-only log determinism across identical plans.
 *
 * Each skip emits exactly one ExecutionEvent (actor: SYSTEM), validated through
 * makeValidatedEngineEvent, with metadata:
 *   { reason: "upstream_failed", upstream_step_id: <failed_step_id> }
 *
 * upstream_step_id always references the original failed_step_id that
 * triggered propagation, not intermediate transitive ancestors.
 */
export function propagate_skip_dependents(
  plan: DispatchPlan,
  failed_step_id: string,
): { skipped: readonly string[] } {
  // Build reverse dependency map: dep_id → [step_ids that depend on dep_id]
  const dependents = new Map<string, string[]>();
  for (const step of plan.steps) {
    for (const dep of step.depends_on) {
      let list = dependents.get(dep);
      if (list === undefined) {
        list = [];
        dependents.set(dep, list);
      }
      list.push(step.step_id);
    }
  }

  // BFS to collect all transitive dependent step_ids
  const toSkip = new Set<string>();
  const bfsQueue: string[] = [failed_step_id];
  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!;
    for (const dep of dependents.get(current) ?? []) {
      if (!toSkip.has(dep)) {
        toSkip.add(dep);
        bfsQueue.push(dep);
      }
    }
  }

  // Deterministic ordering before event emission: priority ASC, step_id lex ASC
  const stepIndex = new Map(plan.steps.map(s => [s.step_id, s]));
  const ordered = [...toSkip].sort((a, b) => {
    const sa = stepIndex.get(a);
    const sb = stepIndex.get(b);
    const priA = sa?.priority ?? Number.MAX_SAFE_INTEGER;
    const priB = sb?.priority ?? Number.MAX_SAFE_INTEGER;
    if (priA !== priB) return priA - priB;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // Apply SKIPPED only to PENDING or READY steps, in deterministic order
  const skipped: string[] = [];
  for (const step_id of ordered) {
    const step = stepIndex.get(step_id);
    if (step === undefined) continue;
    if (step.state !== "PENDING" && step.state !== "READY") continue;

    const fromState = step.state;
    const event = makeValidatedEngineEvent(
      plan, step_id, fromState, "SKIPPED", "SYSTEM",
      { reason: "upstream_failed", upstream_step_id: failed_step_id },
    );
    step.state = "SKIPPED";
    plan.events.push(event);
    skipped.push(step_id);
  }

  return { skipped };
}

// ── derive_plan_terminal_state ────────────────────────────────────────────────

/**
 * Derives the plan's terminal outcome from current step states and failure
 * policy. Never stored — always recomputed on demand.
 *
 * Returns null when the plan is not yet in a terminal condition.
 *
 * Atlas terminal conditions (applied in order):
 *   1. Any step FAILED + on_failure = "halt"
 *        → HALTED  (immediate; does not require all steps to be terminal)
 *   2. Any non-terminal step present
 *        → null    (plan still in progress)
 *   3. All steps COMPLETED
 *        → SUCCEEDED
 *   4. All steps SKIPPED
 *        → FAILED
 *   5. All steps COMPLETED or SKIPPED, at least one SKIPPED, zero FAILED
 *        → PARTIAL
 *   6. Any remaining FAILED step (continue / skip_dependents policy,
 *      unrecovered failure)
 *        → FAILED
 *
 * Condition 6 resolves Atlas's unspecified mixed-terminal case
 * (FAILED coexisting with COMPLETED/SKIPPED under continue policy)
 * by trust-safe failure preservation: an unrecovered failure remains FAILED.
 */
export function derive_plan_terminal_state(plan: DispatchPlan): PlanOutcome | null {
  const { steps, on_failure } = plan;

  if (steps.length === 0) return "SUCCEEDED";

  // Condition 1: immediate HALTED — does not require all steps to be terminal
  const anyFailed = steps.some(s => s.state === "FAILED");
  if (anyFailed && on_failure === "halt") return "HALTED";

  // Condition 2: plan still running
  const anyNonTerminal = steps.some(s => !TERMINAL_STEP_STATES.has(s.state));
  if (anyNonTerminal) return null;

  // All steps are now terminal
  const total           = steps.length;
  const completedCount  = steps.filter(s => s.state === "COMPLETED").length;
  const skippedCount    = steps.filter(s => s.state === "SKIPPED").length;
  const failedCount     = steps.filter(s => s.state === "FAILED").length;

  // Condition 3
  if (completedCount === total) return "SUCCEEDED";

  // Condition 4
  if (skippedCount === total) return "FAILED";

  // Condition 5
  if (failedCount === 0 && skippedCount > 0) return "PARTIAL";

  // Condition 6: unrecovered failures remain
  return "FAILED";
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Internal event constructor for engine-initiated transitions.
 *
 * Enforces the same closed-set transition and actor validity guards as the
 * external surface. This is the single transition authority model for all
 * engine-generated events.
 *
 * Throws if the transition or actor is invalid — this indicates a programming
 * error in the engine, not a runtime rejection path.
 */
function makeValidatedEngineEvent(
  plan: DispatchPlan,
  step_id: string,
  from_state: StepState,
  to_state: StepState,
  actor: StepEventActor,
  metadata: Record<string, unknown>,
): ExecutionEvent {
  if (!isValidTransition(from_state, to_state)) {
    throw new Error(
      `[dispatch-engine] Invalid engine-initiated transition: ${from_state} → ${to_state}`,
    );
  }
  if (!isValidActorForTransition(from_state, to_state, actor)) {
    throw new Error(
      `[dispatch-engine] Invalid actor "${actor}" for engine transition: ${from_state} → ${to_state}`,
    );
  }
  return {
    event_id: randomUUID(),
    run_id: plan.run_id,
    plan_id: plan.plan_id,
    step_id,
    from_state,
    to_state,
    actor,
    occurred_at: new Date().toISOString(),
    metadata: Object.freeze({ ...metadata }),
  };
}

// ── Internal validation helpers ───────────────────────────────────────────────

/**
 * Validates concurrency_limit against the chosen dispatch mode.
 * Returns an error message string, or null if valid.
 *
 *   SEQUENTIAL: limit must be absent or exactly 1.
 *   PARALLEL:   limit must be a positive integer >= 1.
 */
function validateConcurrencyLimit(
  mode: DispatchMode,
  limit: number | undefined,
): string | null {
  if (mode === "SEQUENTIAL") {
    if (limit !== undefined && limit !== 1) {
      return (
        `Sequential mode requires concurrency_limit to be 1 or absent` +
        ` (got ${limit})`
      );
    }
    return null;
  }
  // PARALLEL
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) {
      return (
        `Parallel mode requires concurrency_limit to be a positive integer >= 1` +
        ` (got ${limit})`
      );
    }
  }
  return null;
}
