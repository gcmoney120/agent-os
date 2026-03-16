/**
 * Agent OS — Planner Subsystem P1-S5: Execution Loop
 *
 * Coordinates step sequencing from a bound DispatchPlan to terminal state.
 * Delegates all dispatch logic to the P1-S4 dispatch engine.
 *
 * Non-goals (enforced by absence):
 *   - No worker implementation
 *   - No retry logic or retry state
 *   - No timeout enforcement or timeout runtime
 *   - No mutation of bound plan structure beyond step state progression
 *     (step state progression is owned and enforced by the P1-S4 engine)
 *   - No persistence of LoopState (event log only)
 *   - No HTTP or external API surface
 *   - No multi-plan concurrency
 *   - No cancellation of dispatched steps (caller responsibility per AC-S4-10)
 *
 * Interaction with P1-S4:
 *   The loop calls bind_plan output (DispatchPlan) through the P1-S4 engine
 *   functions: resolve_ready_steps, recompute_dispatch_queue, select_next_step,
 *   emit_dispatch_signal, apply_state_transition, propagate_skip_dependents,
 *   derive_plan_terminal_state. It does not reimplement any of that logic.
 *
 * Intake result flow:
 *   intake_result(step_id, outcome) receives worker results. The loop advances
 *   the step from DISPATCHED → RUNNING → COMPLETED/FAILED via apply_state_transition.
 *   Any transition failure is treated as PLAN_INTEGRITY_VIOLATION → HALTED.
 *
 * Dispatch behavior:
 *   Selected steps are dispatched sequentially in priority order within a single
 *   tick. Dispatch is NOT atomic: if emit_dispatch_signal fails for step N, steps
 *   0..N-1 have already been dispatched and their step_ids are already in the
 *   pending set. On that failure the loop enters HALTED; those earlier-dispatched
 *   steps become orphaned (recorded as ORPHANED in the event log). Callers are
 *   responsible for any downstream cleanup per AC-S4-10.
 *
 * Worker SKIPPED outcomes:
 *   SKIPPED is a system-only transition in P1-S4; no worker may produce it.
 *   A SKIPPED outcome arriving via intake_result is treated as an integrity
 *   violation and causes the loop to HALT.
 */

import { randomUUID } from "node:crypto";
import type { DispatchPlan } from "./dispatch-types.js";
import {
  resolve_ready_steps,
  recompute_dispatch_queue,
  select_next_step,
  emit_dispatch_signal,
  apply_state_transition,
  propagate_skip_dependents,
  derive_plan_terminal_state,
} from "./dispatch-engine.js";
import {
  TERMINAL_LOOP_STATUSES,
  InvalidPlanError,
  InvalidStateError,
} from "./loop-types.js";
import type {
  LoopStatus,
  LoopEventType,
  LoopEvent,
  LoopState,
  StepOutcome,
} from "./loop-types.js";

// Re-export public types so callers import from one entry point.
export type {
  LoopStatus,
  LoopEventType,
  LoopEvent,
  LoopState,
  StepOutcome,
  StepOutcomeStatus,
} from "./loop-types.js";
export { InvalidPlanError, InvalidStateError } from "./loop-types.js";

// ── ExecutionLoop ──────────────────────────────────────────────────────────────

export class ExecutionLoop {
  private _plan: DispatchPlan | null = null;
  private _status: LoopStatus = "IDLE";
  /** Internal mutable pending set — exposed only as sorted readonly string[] snapshot. */
  private _pending: Set<string> = new Set();
  private _tick_count = 0;
  private _started_at: string | null = null;
  private _terminal_at: string | null = null;
  private _terminal_reason: string | null = null;
  /** Append-only event log — no entry is ever removed or mutated. */
  private _events: LoopEvent[] = [];

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Loads a bound DispatchPlan and transitions IDLE → READY.
   *
   * Preconditions (fail-closed before transition):
   *   1. Loop must be IDLE
   *   2. plan must have a non-empty run_id (bound)
   *   3. plan must contain at least one step
   *
   * Raises InvalidStateError if loop is not IDLE.
   * Raises InvalidPlanError if plan is unbound or empty.
   */
  load_plan(bound_plan: DispatchPlan): void {
    if (this._status !== "IDLE") {
      throw new InvalidStateError(
        `load_plan requires IDLE state; current: ${this._status}`,
        "INVALID_STATE_FOR_LOAD",
      );
    }
    if (!bound_plan.run_id) {
      throw new InvalidPlanError(
        "bound_plan must have a non-empty run_id",
        "PLAN_NOT_BOUND",
      );
    }
    if (bound_plan.steps.length === 0) {
      throw new InvalidPlanError(
        "bound_plan must have at least one step",
        "PLAN_EMPTY",
      );
    }
    this._plan = bound_plan;
    this._status = "READY";
  }

  /**
   * Starts the loop and transitions READY → RUNNING.
   * Emits LOOP_STARTED and immediately ticks the dispatch engine.
   *
   * Raises InvalidStateError if loop is not READY.
   */
  start(): void {
    if (this._status !== "READY") {
      throw new InvalidStateError(
        `start requires READY state; current: ${this._status}`,
        "INVALID_STATE_FOR_START",
      );
    }
    this._started_at = new Date().toISOString();
    this._status = "RUNNING";
    this._emit("LOOP_STARTED", {
      plan_id: this._plan!.plan_id,
      run_id: this._plan!.run_id,
      started_at: this._started_at,
    });
    this._tick();
  }

  /**
   * Externally halts the loop regardless of current state, unless already terminal.
   * Emits LOOP_HALTED. Records any pending steps as ORPHANED in the event log.
   * No-op if loop is already in a terminal state.
   */
  halt(reason: string): void {
    if (TERMINAL_LOOP_STATUSES.has(this._status)) return;
    this._enter_halt(`external:${reason}`);
  }

  /**
   * Ingests a step execution result.
   *
   * Rules (applied in order):
   *   1. Terminal loop state → no-op
   *   2. step_id not in pending set → LOOP_WARNING, discard, no halt (AC-S5-11)
   *   3. outcome.status === SKIPPED → PLAN_INTEGRITY_VIOLATION → HALTED
   *      (SKIPPED is system-only in P1-S4; no worker may produce it)
   *   4. Advance step via P1-S4 apply_state_transition; failure → HALTED (AC-S5-14)
   *   5. Remove step_id from pending set; emit STEP_RESULT_RECEIVED (AC-S5-05)
   *   6. FAILED + on_failure=halt → HALTED (AC-S5-08)
   *   7. FAILED + on_failure=skip_dependents → propagate_skip_dependents
   *   8. SUCCESS → resolve_ready_steps
   *   9. Pending set empty → evaluate terminal or continue (AC-S5-06/07)
   */
  intake_result(step_id: string, outcome: StepOutcome): void {
    if (TERMINAL_LOOP_STATUSES.has(this._status)) return;

    // Rule 2: Unknown step_id — warning, discard, no halt (AC-S5-11)
    if (!this._pending.has(step_id)) {
      this._emit("LOOP_WARNING", {
        reason: "unknown_step_id",
        step_id,
        outcome_status: outcome.status,
      });
      return;
    }

    // Rule 3: Worker SKIPPED is not a valid P1-S4 worker transition — integrity violation
    if (outcome.status === "SKIPPED") {
      this._enter_halt(
        `integrity_violation:${step_id}:worker_produced_skipped_outcome`,
      );
      return;
    }

    // Rule 4: Advance step state via P1-S4 apply_state_transition
    const applied = this._apply_outcome(step_id, outcome);
    if (!applied) return; // halt triggered inside _apply_outcome; step NOT yet removed

    // Rule 5: Remove from pending set; emit STEP_RESULT_RECEIVED
    this._pending.delete(step_id);
    this._emit("STEP_RESULT_RECEIVED", {
      step_id,
      status: outcome.status,
      completed_at: outcome.completed_at,
    });

    const plan = this._plan!;

    if (outcome.status === "FAILED") {
      // Rule 6: STEP_FAILED halt condition (AC-S5-08)
      if (plan.on_failure === "halt") {
        this._enter_halt(`step_failed:${step_id}`);
        return;
      }
      // Rule 7: skip transitive dependents when policy requires
      if (plan.on_failure === "skip_dependents") {
        propagate_skip_dependents(plan, step_id);
      }
      // "continue" policy: no skip propagation
    } else {
      // Rule 8: SUCCESS — resolve any dependents whose dependencies are now COMPLETED
      resolve_ready_steps(plan);
    }

    // Rule 9: evaluate progression
    this._advance_after_drain();
  }

  /**
   * Returns a snapshot copy of the current loop state.
   * Mutations to the returned value do not affect the loop (AC-S5-15).
   * pending_set is sorted lexicographically ascending.
   */
  get_state(): LoopState {
    return {
      plan_id: this._plan?.plan_id ?? "",
      loop_status: this._status,
      pending_set: [...this._pending].sort(),
      tick_count: this._tick_count,
      started_at: this._started_at,
      terminal_at: this._terminal_at,
      terminal_reason: this._terminal_reason,
    };
  }

  /**
   * Returns a shallow copy of the append-only event log.
   * Individual events are frozen; the returned array is a copy and cannot
   * affect the loop's internal state (AC-S5-13).
   */
  get_event_log(): readonly LoopEvent[] {
    return [...this._events];
  }

  // ── Private: step outcome application ────────────────────────────────────────

  /**
   * Advances a dispatched step to its terminal state using P1-S4
   * apply_state_transition. Handles the DISPATCHED → RUNNING → terminal sequence.
   *
   * All step lookups are guarded. A missing step is an integrity violation
   * that triggers HALTED (no uncontrolled throw).
   *
   * Returns true on success. Returns false after triggering HALTED on any
   * integrity violation (missing step, unexpected state, transition rejection).
   */
  private _apply_outcome(step_id: string, outcome: StepOutcome): boolean {
    const plan = this._plan!;
    const step = plan.steps.find(s => s.step_id === step_id);

    // Guard: step must exist in the plan
    if (step === undefined) {
      this._enter_halt(
        `integrity_violation:${step_id}:step_not_found_in_plan`,
      );
      return false;
    }

    const timestamp = outcome.completed_at;
    const to_terminal = outcome.status === "SUCCESS" ? "COMPLETED" : "FAILED";

    // Advance DISPATCHED → RUNNING if the step has not yet been advanced by a worker
    if (step.state === "DISPATCHED") {
      const t = apply_state_transition(plan, {
        run_id: plan.run_id,
        step_id,
        from_state: "DISPATCHED",
        to_state: "RUNNING",
        actor: "WORKER",
        occurred_at: timestamp,
        metadata: { via: "loop_intake_result" },
      });
      if (!t.ok) {
        this._enter_halt(
          `integrity_violation:${step_id}:dispatched_to_running:${t.code}`,
        );
        return false;
      }
    }

    // Step must now be RUNNING before applying the terminal transition
    if (step.state !== "RUNNING") {
      this._enter_halt(
        `integrity_violation:${step_id}:unexpected_pre_terminal_state:${step.state}`,
      );
      return false;
    }

    // Apply RUNNING → COMPLETED or RUNNING → FAILED
    const t2 = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id,
      from_state: "RUNNING",
      to_state: to_terminal,
      actor: "WORKER",
      occurred_at: timestamp,
      metadata: { output_present: outcome.output !== null },
    });
    if (!t2.ok) {
      this._enter_halt(
        `integrity_violation:${step_id}:running_to_${to_terminal}:${t2.code}`,
      );
      return false;
    }

    return true;
  }

  // ── Private: progression ──────────────────────────────────────────────────────

  /**
   * Called after every result intake once the pending-set has been updated.
   *
   * If the pending set is empty:
   *   - Derive plan terminal state via P1-S4 derive_plan_terminal_state
   *   - SUCCEEDED / PARTIAL → COMPLETED
   *   - FAILED / HALTED    → FAILED
   *   - null               → transition to RUNNING and tick
   *
   * If the pending set is non-empty: remain in AWAITING_RESULTS.
   */
  private _advance_after_drain(): void {
    if (TERMINAL_LOOP_STATUSES.has(this._status)) return;
    if (this._pending.size > 0) return;

    const terminal = derive_plan_terminal_state(this._plan!);
    if (terminal !== null) {
      if (terminal === "SUCCEEDED" || terminal === "PARTIAL") {
        this._enter_completed();
      } else {
        this._enter_failed(`plan_outcome:${terminal}`);
      }
    } else {
      this._status = "RUNNING";
      this._tick();
    }
  }

  /**
   * Resolves and dispatches the next eligible step(s) via the P1-S4 engine.
   *
   * Dispatch is sequential within the tick: steps are emitted one-by-one in
   * priority order. If emit_dispatch_signal fails for step N, steps 0..N-1 are
   * already in the pending set and the loop enters HALTED. Those earlier-
   * dispatched steps become orphaned (AC-S4-10 — caller responsibility).
   *
   * Guards:
   *   - Only runs in RUNNING state
   *   - Duplicate step_id in pending set → PLAN_INTEGRITY_VIOLATION → HALTED (AC-S5-14)
   *   - emit_dispatch_signal failure     → PLAN_INTEGRITY_VIOLATION → HALTED
   */
  private _tick(): void {
    if (this._status !== "RUNNING") return;

    const plan = this._plan!;

    // Resolve PENDING → READY for any steps whose dependencies are now COMPLETED
    resolve_ready_steps(plan);

    const queue = recompute_dispatch_queue(plan);
    const active_count = plan.steps.filter(
      s => s.state === "DISPATCHED" || s.state === "RUNNING",
    ).length;
    const selected = select_next_step(
      queue,
      plan.dispatch_mode,
      plan.concurrency_limit,
      active_count,
    );

    if (selected.length === 0) {
      // Nothing dispatchable — check whether plan has reached a terminal state
      const terminal = derive_plan_terminal_state(plan);
      if (terminal !== null) {
        if (terminal === "SUCCEEDED" || terminal === "PARTIAL") {
          this._enter_completed();
        } else {
          this._enter_failed(`plan_outcome:${terminal}`);
        }
      }
      // Else: active in-flight steps remain; progression resumes on result intake
      return;
    }

    // AC-S5-14 integrity guard: no step may be dispatched while already pending
    for (const step of selected) {
      if (this._pending.has(step.step_id)) {
        this._enter_halt(`integrity_violation:duplicate_pending:${step.step_id}`);
        return;
      }
    }

    // Dispatch steps sequentially in priority order.
    // Failure on step N halts the loop; steps 0..N-1 become orphaned.
    const dispatched_ids: string[] = [];
    for (const step of selected) {
      const result = emit_dispatch_signal(plan, step);
      if (!result.ok) {
        this._enter_halt(
          `integrity_violation:dispatch_signal_failed:${step.step_id}:${result.code}`,
        );
        return;
      }
      this._pending.add(step.step_id);
      dispatched_ids.push(step.step_id);
      this._emit("STEP_DISPATCHED", {
        step_id: step.step_id,
        signal_id: result.signal.signal_id,
        dispatched_at: result.signal.dispatched_at,
      });
    }

    // One LOOP_PROGRESSION_TICK per tick that results in at least one dispatch
    this._tick_count++;
    this._emit("LOOP_PROGRESSION_TICK", {
      tick_number: this._tick_count,
      dispatched_step_ids: dispatched_ids,
      dispatch_mode: plan.dispatch_mode,
    });

    this._status = "AWAITING_RESULTS";
  }

  // ── Private: terminal transitions ─────────────────────────────────────────────

  /**
   * Enters HALTED terminal state.
   * Emits LOOP_HALTED with reason and orphaned step IDs.
   * Emits one LOOP_WARNING per orphaned step (AC-S5-10).
   * Clears the pending set.
   */
  private _enter_halt(reason: string): void {
    if (TERMINAL_LOOP_STATUSES.has(this._status)) return;
    const orphaned = [...this._pending].sort();
    this._terminal_at = new Date().toISOString();
    this._terminal_reason = reason;
    this._emit("LOOP_HALTED", {
      reason,
      terminal_at: this._terminal_at,
      plan_id: this._plan?.plan_id ?? null,
      orphaned_step_ids: orphaned,
    });
    for (const step_id of orphaned) {
      this._emit("LOOP_WARNING", {
        reason: "step_orphaned_on_halt",
        step_id,
        halt_reason: reason,
      });
    }
    this._pending.clear();
    this._status = "HALTED";
  }

  /** Enters COMPLETED terminal state; emits LOOP_COMPLETED (AC-S5-06). */
  private _enter_completed(): void {
    if (TERMINAL_LOOP_STATUSES.has(this._status)) return;
    this._terminal_at = new Date().toISOString();
    this._terminal_reason = "plan_completed";
    this._status = "COMPLETED";
    this._emit("LOOP_COMPLETED", {
      plan_id: this._plan!.plan_id,
      terminal_at: this._terminal_at,
      tick_count: this._tick_count,
    });
  }

  /** Enters FAILED terminal state; emits LOOP_FAILED (AC-S5-07). */
  private _enter_failed(reason: string): void {
    if (TERMINAL_LOOP_STATUSES.has(this._status)) return;
    this._terminal_at = new Date().toISOString();
    this._terminal_reason = reason;
    this._status = "FAILED";
    this._emit("LOOP_FAILED", {
      plan_id: this._plan!.plan_id,
      reason,
      terminal_at: this._terminal_at,
      tick_count: this._tick_count,
    });
  }

  // ── Private: event emission ───────────────────────────────────────────────────

  /** Appends a frozen event to the append-only event log. */
  private _emit(event_type: LoopEventType, payload: Record<string, unknown>): void {
    const event: LoopEvent = Object.freeze({
      event_id: randomUUID(),
      event_type,
      emitted_at: new Date().toISOString(),
      payload: Object.freeze({ ...payload }),
    });
    this._events.push(event);
  }
}
