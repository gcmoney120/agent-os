/**
 * Agent OS — Planner Subsystem P1-S4: Step Dispatch Tests
 *
 * Covers AC-S4-01 through AC-S4-15 (Atlas acceptance criteria).
 * Tests exported public surfaces only. No internal helper access.
 *
 * run_id trust gate: P1-S4 enforces equality to the bound run_id only.
 * Format validation is owned by P1-S3. Tests use simple string ids.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bind_plan,
  resolve_ready_steps,
  recompute_dispatch_queue,
  select_next_step,
  emit_dispatch_signal,
  apply_state_transition,
  propagate_skip_dependents,
  derive_plan_terminal_state,
  type IncomingTransition,
  type InvalidEventRecord,
} from "../dispatch-engine.js";

import type { DispatchPlan, StepNode } from "../dispatch-types.js";

// ── Test helpers ──────────────────────────────────────────────────────────────
//
// Helpers are pure state-advance utilities over the public API only.
// No helper reaches into internal engine logic.

/** Bind a three-step plan A→(B,C) with optional option overrides. */
function makeLinearPlan(
  options?: Partial<Parameters<typeof bind_plan>[3]>,
): DispatchPlan {
  const result = bind_plan(
    "plan-abc",
    "run-bound-1",
    [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: ["A"] },
      { step_id: "C", priority: 2, depends_on: ["A"] },
    ],
    options,
  );
  assert.equal(result.ok, true, "makeLinearPlan: bind_plan failed");
  if (!result.ok) throw new Error("unreachable");
  return result.plan;
}

/** Advance a READY step to RUNNING via the public API. */
function advanceToRunning(plan: DispatchPlan, step_id: string): void {
  const step = plan.steps.find(s => s.step_id === step_id);
  assert.ok(step, `advanceToRunning: step "${step_id}" not found`);
  assert.equal(step.state, "READY", `advanceToRunning: "${step_id}" must be READY`);
  const dr = emit_dispatch_signal(plan, step);
  assert.equal(dr.ok, true, `advanceToRunning: emit_dispatch_signal failed for "${step_id}"`);
  const r = apply_state_transition(plan, {
    run_id: plan.run_id,
    step_id,
    from_state: "DISPATCHED",
    to_state: "RUNNING",
    actor: "WORKER",
    occurred_at: new Date().toISOString(),
    metadata: {},
  });
  assert.equal(r.ok, true, `advanceToRunning: DISPATCHED→RUNNING failed for "${step_id}"`);
}

/** Advance a READY step all the way to COMPLETED via the public API. */
function completeStep(plan: DispatchPlan, step_id: string): void {
  const step = plan.steps.find(s => s.step_id === step_id);
  assert.ok(step, `completeStep: step "${step_id}" not found`);
  if (step.state === "READY") advanceToRunning(plan, step_id);
  const r = apply_state_transition(plan, {
    run_id: plan.run_id,
    step_id,
    from_state: "RUNNING",
    to_state: "COMPLETED",
    actor: "WORKER",
    occurred_at: new Date().toISOString(),
    metadata: {},
  });
  assert.equal(r.ok, true, `completeStep: RUNNING→COMPLETED failed for "${step_id}"`);
}

/** Advance a READY step all the way to FAILED via the public API. */
function failStep(plan: DispatchPlan, step_id: string): void {
  const step = plan.steps.find(s => s.step_id === step_id);
  assert.ok(step, `failStep: step "${step_id}" not found`);
  if (step.state === "READY") advanceToRunning(plan, step_id);
  const r = apply_state_transition(plan, {
    run_id: plan.run_id,
    step_id,
    from_state: "RUNNING",
    to_state: "FAILED",
    actor: "WORKER",
    occurred_at: new Date().toISOString(),
    metadata: {},
  });
  assert.equal(r.ok, true, `failStep: RUNNING→FAILED failed for "${step_id}"`);
}

// ── AC-S4-01: zero-dep step becomes READY on bind ─────────────────────────────

describe("AC-S4-01: zero-dep step becomes READY on bind", () => {
  it("step with no dependencies is READY after bind_plan", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A");
    assert.ok(stepA);
    assert.equal(stepA.state, "READY");
  });

  it("plan.events contains exactly one PENDING→READY event for the zero-dep step", () => {
    const plan = makeLinearPlan();
    const readyEvents = plan.events.filter(
      e => e.from_state === "PENDING" && e.to_state === "READY" && e.step_id === "A",
    );
    assert.equal(readyEvents.length, 1);
    assert.equal(readyEvents[0].actor, "SYSTEM");
  });

  it("dependent steps remain PENDING after bind_plan", () => {
    const plan = makeLinearPlan();
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "PENDING");
    assert.equal(plan.steps.find(s => s.step_id === "C")!.state, "PENDING");
  });
});

// ── AC-S4-02: dependent step becomes READY only after all deps COMPLETED ──────

describe("AC-S4-02: dependent step becomes READY only after all deps COMPLETED", () => {
  it("dependent stays PENDING while dependency is READY (not COMPLETED)", () => {
    const plan = makeLinearPlan();
    // A is READY — resolve_ready_steps must not promote B or C
    resolve_ready_steps(plan);
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "PENDING");
    assert.equal(plan.steps.find(s => s.step_id === "C")!.state, "PENDING");
  });

  it("dependent becomes READY once all dependencies are COMPLETED", () => {
    const plan = makeLinearPlan();
    completeStep(plan, "A");
    resolve_ready_steps(plan);
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "READY");
    assert.equal(plan.steps.find(s => s.step_id === "C")!.state, "READY");
  });

  it("dependent stays PENDING when dependency is FAILED", () => {
    const plan = makeLinearPlan();
    failStep(plan, "A");
    resolve_ready_steps(plan);
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "PENDING");
    assert.equal(plan.steps.find(s => s.step_id === "C")!.state, "PENDING");
  });

  it("dependent stays PENDING when dependency is SKIPPED", () => {
    const plan = makeLinearPlan();
    const r = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "READY",
      to_state: "SKIPPED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(r.ok, true);
    resolve_ready_steps(plan);
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "PENDING");
    assert.equal(plan.steps.find(s => s.step_id === "C")!.state, "PENDING");
  });

  it("resolve_ready_steps returns resolved count of newly promoted steps", () => {
    const plan = makeLinearPlan();
    completeStep(plan, "A");
    const { resolved } = resolve_ready_steps(plan);
    assert.equal(resolved, 2); // B and C
  });

  it("resolve_ready_steps emits PENDING→READY events with SYSTEM actor for all promoted steps", () => {
    const plan = makeLinearPlan();
    const priorCount = plan.events.length;
    completeStep(plan, "A");
    resolve_ready_steps(plan);
    const newEvents = plan.events.slice(priorCount).filter(
      e => e.from_state === "PENDING" && e.to_state === "READY",
    );
    assert.equal(newEvents.length, 2);
    for (const ev of newEvents) {
      assert.equal(ev.actor, "SYSTEM");
    }
  });
});

// ── AC-S4-03: dependency cycle rejected before dispatch ───────────────────────

describe("AC-S4-03: dependency cycle rejected before dispatch", () => {
  it("rejects a two-step mutual cycle", () => {
    const result = bind_plan("p-cycle-2", "run-c2", [
      { step_id: "X", priority: 1, depends_on: ["Y"] },
      { step_id: "Y", priority: 1, depends_on: ["X"] },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "DEPENDENCY_CYCLE");
  });

  it("rejects a self-referencing step", () => {
    const result = bind_plan("p-self", "run-self", [
      { step_id: "A", priority: 1, depends_on: ["A"] },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "DEPENDENCY_CYCLE");
  });

  it("rejects a three-step cycle and includes cycle_path", () => {
    const result = bind_plan("p-cycle-3", "run-c3", [
      { step_id: "A", priority: 1, depends_on: ["B"] },
      { step_id: "B", priority: 1, depends_on: ["C"] },
      { step_id: "C", priority: 1, depends_on: ["A"] },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "DEPENDENCY_CYCLE");
    assert.ok(Array.isArray(result.cycle_path) && (result.cycle_path?.length ?? 0) > 0);
  });
});

// ── AC-S4-04: deterministic dispatch order for multiple READY steps ───────────

describe("AC-S4-04: deterministic dispatch order — priority ASC, step_id lex ASC", () => {
  it("recompute_dispatch_queue sorts by priority ASC then step_id lex ASC", () => {
    const result = bind_plan("p-order", "run-order", [
      { step_id: "Z", priority: 1, depends_on: [] },
      { step_id: "A", priority: 2, depends_on: [] },
      { step_id: "M", priority: 1, depends_on: [] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const queue = recompute_dispatch_queue(result.plan);
    assert.equal(queue.length, 3);
    assert.equal(queue[0].step_id, "M"); // priority 1, lex before Z
    assert.equal(queue[1].step_id, "Z"); // priority 1, lex after M
    assert.equal(queue[2].step_id, "A"); // priority 2
  });

  it("ties in priority resolved strictly by step_id lex ASC", () => {
    const result = bind_plan("p-lex", "run-lex", [
      { step_id: "beta",  priority: 1, depends_on: [] },
      { step_id: "alpha", priority: 1, depends_on: [] },
      { step_id: "gamma", priority: 1, depends_on: [] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const queue = recompute_dispatch_queue(result.plan);
    assert.equal(queue[0].step_id, "alpha");
    assert.equal(queue[1].step_id, "beta");
    assert.equal(queue[2].step_id, "gamma");
  });

  it("recompute_dispatch_queue returns only READY steps", () => {
    const plan = makeLinearPlan();
    // A is READY; B and C are PENDING
    const queue = recompute_dispatch_queue(plan);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].step_id, "A");
  });

  it("recompute_dispatch_queue returns empty array when no READY steps exist", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A"); // A moves past READY
    const queue = recompute_dispatch_queue(plan);
    assert.equal(queue.length, 0);
  });

  it("recompute_dispatch_queue returns a fresh snapshot — not the same array reference", () => {
    const plan = makeLinearPlan();
    const snap1 = recompute_dispatch_queue(plan);
    const snap2 = recompute_dispatch_queue(plan);
    assert.notEqual(snap1, snap2); // distinct array instances
    assert.equal(snap1.length, snap2.length); // same content at same state
  });
});

// ── AC-S4-05: every READY→DISPATCHED emits StepDispatchSignal + one ExecutionEvent ──

describe("AC-S4-05: READY→DISPATCHED emits StepDispatchSignal and one valid ExecutionEvent", () => {
  it("emit_dispatch_signal returns ok:true with signal and event", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    const result = emit_dispatch_signal(plan, stepA);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.ok(typeof result.signal.signal_id === "string" && result.signal.signal_id.length > 0);
    assert.ok(result.event !== undefined);
  });

  it("signal carries correct run_id, plan_id, step_id, and dispatched_at", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    const result = emit_dispatch_signal(plan, stepA);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.signal.run_id, plan.run_id);
    assert.equal(result.signal.plan_id, plan.plan_id);
    assert.equal(result.signal.step_id, "A");
    assert.ok(typeof result.signal.dispatched_at === "string");
  });

  it("event carries from_state READY and to_state DISPATCHED with SYSTEM actor", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    const result = emit_dispatch_signal(plan, stepA);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.event.from_state, "READY");
    assert.equal(result.event.to_state, "DISPATCHED");
    assert.equal(result.event.actor, "SYSTEM");
  });

  it("exactly one ExecutionEvent is appended to plan.events for the transition", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    const before = plan.events.length;
    emit_dispatch_signal(plan, stepA);
    assert.equal(plan.events.length, before + 1);
    const appended = plan.events[plan.events.length - 1];
    assert.equal(appended.from_state, "READY");
    assert.equal(appended.to_state, "DISPATCHED");
  });

  it("step advances to DISPATCHED state", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    emit_dispatch_signal(plan, stepA);
    assert.equal(stepA.state, "DISPATCHED");
  });

  it("last_dispatch_signal_id on step matches returned signal_id", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    const result = emit_dispatch_signal(plan, stepA);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(stepA.last_dispatch_signal_id, result.signal.signal_id);
  });

  it("fails with STEP_NOT_FOUND for a step not belonging to the plan", () => {
    const plan = makeLinearPlan();
    const phantom: StepNode = {
      step_id: "phantom",
      priority: 1,
      depends_on: [],
      state: "READY",
    };
    const result = emit_dispatch_signal(plan, phantom);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "STEP_NOT_FOUND");
  });

  it("fails with STEP_NOT_READY for a PENDING step", () => {
    const plan = makeLinearPlan();
    const stepB = plan.steps.find(s => s.step_id === "B")!; // PENDING
    const result = emit_dispatch_signal(plan, stepB);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "STEP_NOT_READY");
  });

  it("does not append to plan.events on failure preconditions", () => {
    const plan = makeLinearPlan();
    const stepB = plan.steps.find(s => s.step_id === "B")!; // PENDING
    const before = plan.events.length;
    emit_dispatch_signal(plan, stepB);
    assert.equal(plan.events.length, before);
  });
});

// ── AC-S4-06: duplicate dispatch for already-RUNNING step is a no-op ──────────

describe("AC-S4-06: duplicate dispatch signal for already-RUNNING step is a no-op", () => {
  it("emit_dispatch_signal on a RUNNING step returns STEP_NOT_READY", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    advanceToRunning(plan, "A");
    assert.equal(stepA.state, "RUNNING");
    const result = emit_dispatch_signal(plan, stepA);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "STEP_NOT_READY");
  });

  it("plan.events is not modified by the duplicate dispatch attempt", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A");
    const before = plan.events.length;
    emit_dispatch_signal(plan, plan.steps.find(s => s.step_id === "A")!);
    assert.equal(plan.events.length, before);
  });

  it("step state remains RUNNING after the duplicate dispatch attempt", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    advanceToRunning(plan, "A");
    emit_dispatch_signal(plan, stepA);
    assert.equal(stepA.state, "RUNNING");
  });

  it("emit_dispatch_signal on a DISPATCHED step (not yet RUNNING) also returns STEP_NOT_READY", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    emit_dispatch_signal(plan, stepA); // now DISPATCHED
    const before = plan.events.length;
    const result = emit_dispatch_signal(plan, stepA);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "STEP_NOT_READY");
    assert.equal(plan.events.length, before);
    assert.equal(stepA.state, "DISPATCHED");
  });
});

// ── AC-S4-07: every valid transition produces exactly one ExecutionEvent ───────

describe("AC-S4-07: every valid state transition produces exactly one ExecutionEvent", () => {
  it("PENDING → READY: delta = 1, event fields correct", () => {
    // bind_plan triggers this internally; measure at bind time
    const result = bind_plan("p-07-pr", "run-07-pr", [
      { step_id: "A", priority: 1, depends_on: [] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    // Exactly one PENDING→READY event emitted during bind
    const evs = plan.events.filter(e => e.from_state === "PENDING" && e.to_state === "READY");
    assert.equal(evs.length, 1);
    assert.equal(evs[0].step_id, "A");
    assert.equal(evs[0].actor, "SYSTEM");
  });

  it("READY → DISPATCHED: delta = 1 via emit_dispatch_signal", () => {
    const plan = makeLinearPlan();
    const stepA = plan.steps.find(s => s.step_id === "A")!;
    const before = plan.events.length;
    emit_dispatch_signal(plan, stepA);
    assert.equal(plan.events.length, before + 1);
    assert.equal(plan.events[plan.events.length - 1].from_state, "READY");
    assert.equal(plan.events[plan.events.length - 1].to_state, "DISPATCHED");
  });

  it("DISPATCHED → RUNNING: delta = 1 via apply_state_transition", () => {
    const plan = makeLinearPlan();
    emit_dispatch_signal(plan, plan.steps.find(s => s.step_id === "A")!);
    const before = plan.events.length;
    const r = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "DISPATCHED",
      to_state: "RUNNING",
      actor: "WORKER",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(r.ok, true);
    assert.equal(plan.events.length, before + 1);
    assert.equal(plan.events[plan.events.length - 1].from_state, "DISPATCHED");
    assert.equal(plan.events[plan.events.length - 1].to_state, "RUNNING");
  });

  it("RUNNING → COMPLETED: delta = 1 via apply_state_transition", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A");
    const before = plan.events.length;
    const r = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "RUNNING",
      to_state: "COMPLETED",
      actor: "WORKER",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(r.ok, true);
    assert.equal(plan.events.length, before + 1);
    assert.equal(plan.events[plan.events.length - 1].to_state, "COMPLETED");
  });

  it("RUNNING → FAILED: delta = 1 via apply_state_transition", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A");
    const before = plan.events.length;
    const r = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "RUNNING",
      to_state: "FAILED",
      actor: "WORKER",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(r.ok, true);
    assert.equal(plan.events.length, before + 1);
    assert.equal(plan.events[plan.events.length - 1].to_state, "FAILED");
  });

  it("READY → SKIPPED: delta = 1 via apply_state_transition", () => {
    const plan = makeLinearPlan();
    const before = plan.events.length;
    const r = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "READY",
      to_state: "SKIPPED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(r.ok, true);
    assert.equal(plan.events.length, before + 1);
    assert.equal(plan.events[plan.events.length - 1].to_state, "SKIPPED");
  });

  it("PENDING → SKIPPED: delta = 1 via apply_state_transition", () => {
    const plan = makeLinearPlan();
    const before = plan.events.length;
    const r = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "B", // B is PENDING
      from_state: "PENDING",
      to_state: "SKIPPED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(r.ok, true);
    assert.equal(plan.events.length, before + 1);
    assert.equal(plan.events[plan.events.length - 1].from_state, "PENDING");
    assert.equal(plan.events[plan.events.length - 1].to_state, "SKIPPED");
  });

  it("rejected transitions produce zero events (plan.events unchanged)", () => {
    const plan = makeLinearPlan();
    // Attempt invalid: PENDING → COMPLETED (not in valid set)
    const before = plan.events.length;
    const r = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "B",
      from_state: "PENDING",
      to_state: "COMPLETED",
      actor: "WORKER",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(r.ok, false);
    assert.equal(plan.events.length, before);
  });
});

// ── AC-S4-08: invalid actor rejected as INVALID_EVENT ─────────────────────────

describe("AC-S4-08: invalid actor rejected as INVALID_EVENT", () => {
  it("SYSTEM actor for DISPATCHED→RUNNING is rejected with code INVALID_EVENT", () => {
    const plan = makeLinearPlan();
    emit_dispatch_signal(plan, plan.steps.find(s => s.step_id === "A")!);
    const result = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "DISPATCHED",
      to_state: "RUNNING",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_EVENT");
  });

  it("rejection record is returned with actor, step_id, and reject_reason", () => {
    const plan = makeLinearPlan();
    emit_dispatch_signal(plan, plan.steps.find(s => s.step_id === "A")!);
    const result = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "DISPATCHED",
      to_state: "RUNNING",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_EVENT");
    const fail = result as typeof result & { rejection: InvalidEventRecord };
    assert.equal(fail.rejection.actor, "SYSTEM");
    assert.equal(fail.rejection.step_id, "A");
    assert.ok(typeof fail.rejection.reject_reason === "string" && fail.rejection.reject_reason.length > 0);
  });

  it("plan.events is not modified when actor is rejected", () => {
    const plan = makeLinearPlan();
    emit_dispatch_signal(plan, plan.steps.find(s => s.step_id === "A")!);
    const before = plan.events.length;
    apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "DISPATCHED",
      to_state: "RUNNING",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(plan.events.length, before);
  });

  it("WORKER actor for PENDING→READY is rejected with code INVALID_EVENT", () => {
    const plan = makeLinearPlan();
    const before = plan.events.length;
    const result = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "B", // PENDING
      from_state: "PENDING",
      to_state: "READY",
      actor: "WORKER",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_EVENT");
    assert.equal(plan.events.length, before);
  });
});

// ── AC-S4-09: mismatched run_id rejected ──────────────────────────────────────

describe("AC-S4-09: mismatched run_id rejected", () => {
  it("transition with wrong run_id returns RUN_ID_MISMATCH", () => {
    const plan = makeLinearPlan();
    const result = apply_state_transition(plan, {
      run_id: "wrong-run-id",
      step_id: "A",
      from_state: "READY",
      to_state: "DISPATCHED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "RUN_ID_MISMATCH");
  });

  it("plan.events is not modified on run_id mismatch", () => {
    const plan = makeLinearPlan();
    const before = plan.events.length;
    apply_state_transition(plan, {
      run_id: "spoofed-run",
      step_id: "A",
      from_state: "READY",
      to_state: "DISPATCHED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(plan.events.length, before);
  });

  it("transition with matching run_id is accepted", () => {
    const plan = makeLinearPlan();
    const result = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "READY",
      to_state: "DISPATCHED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(result.ok, true);
  });

  it("run_id equality is the trust gate — P1-S4 does not validate run_id format", () => {
    // Two plans bound with simple string ids; equality is all that matters.
    const r1 = bind_plan("p-a", "run-simple-1", [{ step_id: "X", priority: 1, depends_on: [] }]);
    const r2 = bind_plan("p-b", "run-simple-2", [{ step_id: "X", priority: 1, depends_on: [] }]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) throw new Error("unreachable");
    // Cross-plan run_id is rejected
    const crossResult = apply_state_transition(r1.plan, {
      run_id: r2.plan.run_id,
      step_id: "X",
      from_state: "READY",
      to_state: "DISPATCHED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(crossResult.ok, false);
    if (crossResult.ok) throw new Error("unreachable");
    assert.equal(crossResult.code, "RUN_ID_MISMATCH");
  });
});

// ── AC-S4-10: FAILED + halt prevents further dispatch ─────────────────────────
//
// Contract note (gap):
//   The dispatch engine does not natively block emit_dispatch_signal after a step
//   fails under halt policy. The halt signal is delivered through
//   derive_plan_terminal_state returning HALTED. The caller is responsible for
//   checking terminal state before dispatching further steps.
//   This test suite asserts the engine side of the contract (HALTED derived
//   immediately) and documents the caller responsibility explicitly.

describe("AC-S4-10: FAILED + halt policy signals HALTED immediately via terminal state", () => {
  it("derive_plan_terminal_state returns HALTED after any step FAILED under halt policy", () => {
    const result = bind_plan("p-halt", "run-halt", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { on_failure: "halt" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    // B is still READY — plan is NOT fully terminal. HALTED must be returned
    // immediately, before all steps reach a terminal state.
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "READY");
    assert.equal(derive_plan_terminal_state(plan), "HALTED");
  });

  it("HALTED is returned even with non-terminal steps still present", () => {
    // Reinforces the immediate-halt contract (condition 1 in derive_plan_terminal_state).
    const result = bind_plan("p-halt-nonterminal", "run-halt-nt", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
      { step_id: "C", priority: 3, depends_on: [] },
    ], { on_failure: "halt" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    // B and C are still READY
    assert.equal(derive_plan_terminal_state(plan), "HALTED");
  });

  it("HALTED is not returned under skip_dependents policy", () => {
    // Caller must only halt when policy === halt.
    const result = bind_plan("p-skip-pol", "run-skip-pol", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { on_failure: "skip_dependents" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    const outcome = derive_plan_terminal_state(plan);
    assert.notEqual(outcome, "HALTED");
  });

  it("HALTED is not returned under continue policy", () => {
    const result = bind_plan("p-cont-pol", "run-cont-pol", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { on_failure: "continue" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    const outcome = derive_plan_terminal_state(plan);
    assert.notEqual(outcome, "HALTED");
  });
});

// ── AC-S4-11: skip_dependents propagates transitively with correct metadata ───

describe("AC-S4-11: skip_dependents propagation — transitive BFS, metadata, deterministic order", () => {
  it("skips all PENDING direct dependents of the failed step", () => {
    const plan = makeLinearPlan();
    failStep(plan, "A");
    const { skipped } = propagate_skip_dependents(plan, "A");
    assert.ok(skipped.includes("B"));
    assert.ok(skipped.includes("C"));
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "SKIPPED");
    assert.equal(plan.steps.find(s => s.step_id === "C")!.state, "SKIPPED");
  });

  it("skips READY dependents as well as PENDING ones", () => {
    const result = bind_plan("p-skip-ready", "run-sr", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: ["A"] },
      { step_id: "C", priority: 3, depends_on: ["B"] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    completeStep(plan, "A");
    resolve_ready_steps(plan);
    // B is now READY
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "READY");
    failStep(plan, "B");
    const { skipped } = propagate_skip_dependents(plan, "B");
    assert.ok(skipped.includes("C"));
    assert.equal(plan.steps.find(s => s.step_id === "C")!.state, "SKIPPED");
  });

  it("propagates transitively to grandchildren via BFS", () => {
    const result = bind_plan("p-transitive", "run-t", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: ["A"] },
      { step_id: "C", priority: 3, depends_on: ["B"] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    const { skipped } = propagate_skip_dependents(plan, "A");
    assert.ok(skipped.includes("B"));
    assert.ok(skipped.includes("C")); // grandchild
  });

  it("does not skip DISPATCHED or RUNNING dependents", () => {
    const result = bind_plan("p-skip-active", "run-sa", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: ["A"] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    completeStep(plan, "A");
    resolve_ready_steps(plan);
    advanceToRunning(plan, "B"); // B is now RUNNING
    // Fake the "A failed" scenario using a separate plan
    // with the same shape but B in RUNNING — use propagate on the failed dep
    // B is RUNNING; the function must not apply SKIPPED to it
    const { skipped } = propagate_skip_dependents(plan, "A");
    assert.ok(!skipped.includes("B"), "RUNNING step must not be skipped");
    assert.equal(plan.steps.find(s => s.step_id === "B")!.state, "RUNNING");
  });

  it("SKIPPED events carry SYSTEM actor and upstream metadata", () => {
    const plan = makeLinearPlan();
    failStep(plan, "A");
    const before = plan.events.length;
    propagate_skip_dependents(plan, "A");
    const skipEvents = plan.events.slice(before).filter(e => e.to_state === "SKIPPED");
    assert.equal(skipEvents.length, 2); // B and C
    for (const ev of skipEvents) {
      assert.equal(ev.actor, "SYSTEM");
      const meta = ev.metadata as Record<string, unknown>;
      assert.equal(meta.reason, "upstream_failed");
      assert.equal(meta.upstream_step_id, "A");
    }
  });

  it("upstream_step_id in metadata references original failed step, not transitive ancestors", () => {
    const result = bind_plan("p-upstream-meta", "run-um", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: ["A"] },
      { step_id: "C", priority: 3, depends_on: ["B"] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    const before = plan.events.length;
    propagate_skip_dependents(plan, "A");
    const skipEvents = plan.events.slice(before).filter(e => e.to_state === "SKIPPED");
    for (const ev of skipEvents) {
      assert.equal(
        (ev.metadata as Record<string, unknown>).upstream_step_id,
        "A",
        "upstream_step_id must always reference original failed_step_id",
      );
    }
  });

  it("emitted SKIPPED events appear in deterministic priority ASC / step_id lex ASC order", () => {
    // Three parallel dependents with distinct priorities and step_ids
    const result = bind_plan("p-skip-order", "run-so", [
      { step_id: "root",  priority: 1, depends_on: [] },
      { step_id: "dep-z", priority: 2, depends_on: ["root"] },
      { step_id: "dep-a", priority: 2, depends_on: ["root"] },
      { step_id: "dep-m", priority: 1, depends_on: ["root"] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "root");
    const before = plan.events.length;
    propagate_skip_dependents(plan, "root");
    const skipEvents = plan.events.slice(before).filter(e => e.to_state === "SKIPPED");
    const emittedIds = skipEvents.map(e => e.step_id);
    // dep-m priority 1 first, then dep-a priority 2 lex before dep-z
    assert.deepEqual(emittedIds, ["dep-m", "dep-a", "dep-z"]);
  });

  it("returns empty skipped array when the failed step has no dependents", () => {
    const result = bind_plan("p-noskip", "run-ns", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    const { skipped } = propagate_skip_dependents(plan, "A");
    assert.equal(skipped.length, 0);
  });
});

// ── AC-S4-12: terminal outcome derivation for SUCCEEDED / HALTED / PARTIAL / FAILED ──

describe("AC-S4-12: terminal outcome derivation — all four outcomes", () => {
  it("returns null while any non-terminal step is present", () => {
    const plan = makeLinearPlan();
    assert.equal(derive_plan_terminal_state(plan), null);
  });

  it("returns null while a step is DISPATCHED", () => {
    const plan = makeLinearPlan();
    emit_dispatch_signal(plan, plan.steps.find(s => s.step_id === "A")!);
    assert.equal(derive_plan_terminal_state(plan), null);
  });

  it("returns null while a step is RUNNING", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A");
    assert.equal(derive_plan_terminal_state(plan), null);
  });

  // SUCCEEDED
  it("SUCCEEDED: returns SUCCEEDED when all steps are COMPLETED", () => {
    const plan = makeLinearPlan();
    completeStep(plan, "A");
    resolve_ready_steps(plan);
    completeStep(plan, "B");
    completeStep(plan, "C");
    assert.equal(derive_plan_terminal_state(plan), "SUCCEEDED");
  });

  it("SUCCEEDED: empty plan returns SUCCEEDED immediately", () => {
    const result = bind_plan("p-empty-succ", "run-es", []);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(derive_plan_terminal_state(result.plan), "SUCCEEDED");
  });

  // HALTED
  it("HALTED: any step FAILED + halt policy returns HALTED immediately", () => {
    const result = bind_plan("p-halted", "run-halted", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { on_failure: "halt" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    assert.equal(derive_plan_terminal_state(plan), "HALTED");
  });

  // PARTIAL
  it("PARTIAL: COMPLETED + SKIPPED with zero FAILED returns PARTIAL", () => {
    const result = bind_plan("p-partial", "run-partial", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { on_failure: "skip_dependents" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    completeStep(plan, "A");
    // Skip B via SYSTEM
    apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "B",
      from_state: "READY",
      to_state: "SKIPPED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(derive_plan_terminal_state(plan), "PARTIAL");
  });

  // FAILED — all SKIPPED
  it("FAILED: all steps SKIPPED returns FAILED", () => {
    const result = bind_plan("p-all-skipped", "run-as", [
      { step_id: "A", priority: 1, depends_on: [] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "READY",
      to_state: "SKIPPED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(derive_plan_terminal_state(plan), "FAILED");
  });

  // FAILED — mixed terminal with remaining FAILED under continue
  it("FAILED: mixed terminal COMPLETED+FAILED under continue policy returns FAILED", () => {
    const result = bind_plan("p-mixed-cont", "run-mc", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { on_failure: "continue" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    completeStep(plan, "B");
    assert.equal(derive_plan_terminal_state(plan), "FAILED");
  });

  it("FAILED: mixed terminal COMPLETED+FAILED under skip_dependents policy returns FAILED", () => {
    const result = bind_plan("p-mixed-sd", "run-msd", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { on_failure: "skip_dependents" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    failStep(plan, "A");
    completeStep(plan, "B");
    assert.equal(derive_plan_terminal_state(plan), "FAILED");
  });
});

// ── AC-S4-13: sequential mode active-slot discipline ─────────────────────────

describe("AC-S4-13: sequential mode — at most one DISPATCHED/RUNNING step at a time", () => {
  it("select_next_step SEQUENTIAL returns one step when active_count = 0", () => {
    const plan = makeLinearPlan();
    const queue = recompute_dispatch_queue(plan);
    const selected = select_next_step(queue, "SEQUENTIAL", 1, 0);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].step_id, "A");
  });

  it("select_next_step SEQUENTIAL returns empty when active_count = 1", () => {
    const plan = makeLinearPlan();
    const queue = recompute_dispatch_queue(plan);
    const selected = select_next_step(queue, "SEQUENTIAL", 1, 1);
    assert.equal(selected.length, 0);
  });

  it("select_next_step SEQUENTIAL returns empty when active_count > 1", () => {
    const plan = makeLinearPlan();
    const queue = recompute_dispatch_queue(plan);
    const selected = select_next_step(queue, "SEQUENTIAL", 1, 3);
    assert.equal(selected.length, 0);
  });

  it("sequential active-slot count: dispatching first slot blocks the second", () => {
    const result = bind_plan("p-seq-slot", "run-seq-slot", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { dispatch_mode: "SEQUENTIAL" });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    // Dispatch A
    const queue = recompute_dispatch_queue(plan);
    const first = select_next_step(queue, "SEQUENTIAL", 1, 0);
    assert.equal(first.length, 1);
    emit_dispatch_signal(plan, first[0]);
    // A is now DISPATCHED — active_count = 1
    const activeCount = plan.steps.filter(
      s => s.state === "DISPATCHED" || s.state === "RUNNING",
    ).length;
    assert.equal(activeCount, 1);
    // select_next_step must return empty with active_count = 1
    const queueAfter = recompute_dispatch_queue(plan);
    const second = select_next_step(queueAfter, "SEQUENTIAL", 1, activeCount);
    assert.equal(second.length, 0);
  });
});

// ── AC-S4-14: parallel mode concurrency-limit discipline ─────────────────────

describe("AC-S4-14: parallel mode — never exceeds concurrency_limit", () => {
  it("select_next_step PARALLEL returns up to (limit - active_count) steps", () => {
    const result = bind_plan("p-par-slots", "run-ps", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
      { step_id: "C", priority: 3, depends_on: [] },
    ], { dispatch_mode: "PARALLEL", concurrency_limit: 3 });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const queue = recompute_dispatch_queue(result.plan);
    const selected = select_next_step(queue, "PARALLEL", 3, 1);
    assert.equal(selected.length, 2); // 3 - 1 = 2
  });

  it("select_next_step PARALLEL returns empty when active_count = limit", () => {
    const result = bind_plan("p-par-full", "run-pf", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
    ], { dispatch_mode: "PARALLEL", concurrency_limit: 2 });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const queue = recompute_dispatch_queue(result.plan);
    const selected = select_next_step(queue, "PARALLEL", 2, 2);
    assert.equal(selected.length, 0);
  });

  it("select_next_step PARALLEL is capped by queue length even if slots available", () => {
    const result = bind_plan("p-par-cap", "run-pc", [
      { step_id: "A", priority: 1, depends_on: [] },
    ], { dispatch_mode: "PARALLEL", concurrency_limit: 5 });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const queue = recompute_dispatch_queue(result.plan);
    const selected = select_next_step(queue, "PARALLEL", 5, 0);
    assert.equal(selected.length, 1); // only 1 READY step despite 5 limit
  });

  it("parallel active-slot count: concurrent dispatch respects limit end-to-end", () => {
    const result = bind_plan("p-par-e2e", "run-pe2e", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
      { step_id: "C", priority: 3, depends_on: [] },
    ], { dispatch_mode: "PARALLEL", concurrency_limit: 2 });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const plan = result.plan;
    const queue = recompute_dispatch_queue(plan);
    const toDispatch = select_next_step(queue, "PARALLEL", 2, 0);
    assert.equal(toDispatch.length, 2);
    for (const step of toDispatch) {
      emit_dispatch_signal(plan, step);
    }
    const activeCount = plan.steps.filter(
      s => s.state === "DISPATCHED" || s.state === "RUNNING",
    ).length;
    assert.equal(activeCount, 2);
    // Remaining slot check: queue has 1 more READY step, limit reached
    const queueAfter = recompute_dispatch_queue(plan);
    const overflow = select_next_step(queueAfter, "PARALLEL", 2, activeCount);
    assert.equal(overflow.length, 0);
  });

  it("select_next_step PARALLEL preserves queue order in selected subset", () => {
    const result = bind_plan("p-par-order", "run-po", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "B", priority: 2, depends_on: [] },
      { step_id: "C", priority: 3, depends_on: [] },
    ], { dispatch_mode: "PARALLEL", concurrency_limit: 3 });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    const queue = recompute_dispatch_queue(result.plan);
    const selected = select_next_step(queue, "PARALLEL", 3, 0);
    assert.equal(selected.length, 3);
    assert.equal(selected[0].step_id, "A");
    assert.equal(selected[1].step_id, "B");
    assert.equal(selected[2].step_id, "C");
  });
});

// ── AC-S4-15: TIMEOUT_WATCHDOG-only timeout failure authority ─────────────────

describe("AC-S4-15: TIMEOUT_WATCHDOG timeout failure authority", () => {
  it("RUNNING → FAILED by TIMEOUT_WATCHDOG is accepted", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A");
    const result = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "RUNNING",
      to_state: "FAILED",
      actor: "TIMEOUT_WATCHDOG",
      occurred_at: new Date().toISOString(),
      metadata: { reason: "timeout" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.event.actor, "TIMEOUT_WATCHDOG");
    assert.equal(result.event.to_state, "FAILED");
  });

  it("RUNNING → FAILED by WORKER is accepted (non-timeout failure)", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A");
    const result = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "RUNNING",
      to_state: "FAILED",
      actor: "WORKER",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.event.actor, "WORKER");
    assert.equal(result.event.to_state, "FAILED");
  });

  it("RUNNING → FAILED by SYSTEM is rejected as INVALID_EVENT", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A");
    const before = plan.events.length;
    const result = apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "RUNNING",
      to_state: "FAILED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_EVENT");
    assert.equal(plan.events.length, before); // no event appended
  });

  it("TIMEOUT_WATCHDOG event is appended to plan.events with exact actor", () => {
    const plan = makeLinearPlan();
    advanceToRunning(plan, "A");
    const before = plan.events.length;
    apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "RUNNING",
      to_state: "FAILED",
      actor: "TIMEOUT_WATCHDOG",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    assert.equal(plan.events.length, before + 1);
    assert.equal(plan.events[plan.events.length - 1].actor, "TIMEOUT_WATCHDOG");
  });
});

// ── Supplemental regression: bind_plan validation ────────────────────────────
//
// These are not Atlas AC-S4 acceptance criteria.
// They are regression guards for bind_plan input validation.

describe("Regression: bind_plan — duplicate step_id rejection", () => {
  it("rejects two steps with the same step_id", () => {
    const result = bind_plan("p-dup", "run-dup", [
      { step_id: "A", priority: 1, depends_on: [] },
      { step_id: "A", priority: 2, depends_on: [] },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "DUPLICATE_STEP_ID");
  });
});

describe("Regression: bind_plan — invalid concurrency_limit rejection", () => {
  it("SEQUENTIAL rejects concurrency_limit > 1", () => {
    const r = bind_plan("p-seq-inv", "run-si", [
      { step_id: "A", priority: 1, depends_on: [] },
    ], { dispatch_mode: "SEQUENTIAL", concurrency_limit: 3 });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.equal(r.code, "INVALID_CONCURRENCY_LIMIT");
  });

  it("SEQUENTIAL accepts concurrency_limit = 1", () => {
    const r = bind_plan("p-seq-ok", "run-sok", [
      { step_id: "A", priority: 1, depends_on: [] },
    ], { dispatch_mode: "SEQUENTIAL", concurrency_limit: 1 });
    assert.equal(r.ok, true);
  });

  it("SEQUENTIAL accepts absent concurrency_limit", () => {
    const r = bind_plan("p-seq-absent", "run-sa", [
      { step_id: "A", priority: 1, depends_on: [] },
    ], { dispatch_mode: "SEQUENTIAL" });
    assert.equal(r.ok, true);
  });

  it("PARALLEL rejects concurrency_limit = 0", () => {
    const r = bind_plan("p-par-inv0", "run-pi0", [
      { step_id: "A", priority: 1, depends_on: [] },
    ], { dispatch_mode: "PARALLEL", concurrency_limit: 0 });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.equal(r.code, "INVALID_CONCURRENCY_LIMIT");
  });

  it("PARALLEL rejects non-integer concurrency_limit", () => {
    const r = bind_plan("p-par-float", "run-pf", [
      { step_id: "A", priority: 1, depends_on: [] },
    ], { dispatch_mode: "PARALLEL", concurrency_limit: 1.5 });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.equal(r.code, "INVALID_CONCURRENCY_LIMIT");
  });

  it("PARALLEL accepts concurrency_limit >= 1", () => {
    const r = bind_plan("p-par-ok", "run-pok", [
      { step_id: "A", priority: 1, depends_on: [] },
    ], { dispatch_mode: "PARALLEL", concurrency_limit: 4 });
    assert.equal(r.ok, true);
  });
});

describe("Regression: plan.events integrity", () => {
  it("plan.events contains no events from rejected-actor attempts", () => {
    const plan = makeLinearPlan();
    emit_dispatch_signal(plan, plan.steps.find(s => s.step_id === "A")!);
    apply_state_transition(plan, {
      run_id: plan.run_id,
      step_id: "A",
      from_state: "DISPATCHED",
      to_state: "RUNNING",
      actor: "SYSTEM", // invalid
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    const validPairs = new Set([
      "PENDING:READY", "READY:DISPATCHED", "DISPATCHED:RUNNING",
      "RUNNING:COMPLETED", "RUNNING:FAILED", "PENDING:SKIPPED", "READY:SKIPPED",
    ]);
    for (const ev of plan.events) {
      assert.ok(
        validPairs.has(`${ev.from_state}:${ev.to_state}`),
        `Unexpected event pair in plan.events: ${ev.from_state}→${ev.to_state}`,
      );
    }
  });

  it("all events in plan.events carry the bound run_id", () => {
    const plan = makeLinearPlan();
    apply_state_transition(plan, {
      run_id: "bad-run",
      step_id: "A",
      from_state: "READY",
      to_state: "DISPATCHED",
      actor: "SYSTEM",
      occurred_at: new Date().toISOString(),
      metadata: {},
    });
    for (const ev of plan.events) {
      assert.equal(ev.run_id, plan.run_id);
    }
  });
});
