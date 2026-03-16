/**
 * Agent OS — Planner Subsystem P1-S5: Execution Loop Tests
 *
 * AC coverage:
 *   AC-S5-01  IDLE → READY on valid bound plan load
 *   AC-S5-02  READY → RUNNING on start(); emits LOOP_STARTED
 *   AC-S5-03  Sequential: one step at a time; second only after first result
 *   AC-S5-04  Parallel: full group dispatched in one tick; awaits full drain
 *   AC-S5-05  intake_result() removes step from pending and emits STEP_RESULT_RECEIVED
 *   AC-S5-06  All steps SUCCESS → COMPLETED; emits LOOP_COMPLETED
 *   AC-S5-07  All steps terminal with any FAILED → FAILED; emits LOOP_FAILED
 *   AC-S5-08  STEP_FAILED halt condition → HALTED; emits LOOP_HALTED with reason
 *   AC-S5-09  External halt() → HALTED regardless of current state
 *   AC-S5-10  Orphaned pending steps recorded in event log on halt
 *   AC-S5-11  Unknown step_id in intake_result() → LOOP_WARNING; no halt
 *   AC-S5-12  No method mutates bound plan structure
 *   AC-S5-13  Event log is append-only; no prior entry is modified
 *   AC-S5-14  PLAN_INTEGRITY_VIOLATION (corrupted step state) → HALTED
 *   AC-S5-15  get_state() returns snapshot copy; mutations do not affect loop
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bind_plan } from "../dispatch-engine.js";
import {
  ExecutionLoop,
  InvalidPlanError,
  InvalidStateError,
} from "../execution-loop.js";
import type { StepOutcome } from "../execution-loop.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

const RUN_ID = "run_01ARYZ6S41TPTWGI9C2S4JQ3";

function makePlan(opts?: {
  steps?: Array<{ step_id: string; priority: number; depends_on: string[] }>;
  mode?: "SEQUENTIAL" | "PARALLEL";
  limit?: number;
  on_failure?: "halt" | "skip_dependents" | "continue";
}) {
  const steps = opts?.steps ?? [
    { step_id: "step-a", priority: 1, depends_on: [] },
    { step_id: "step-b", priority: 2, depends_on: ["step-a"] },
  ];
  const result = bind_plan(
    "plan-001",
    RUN_ID,
    steps,
    {
      dispatch_mode: opts?.mode,
      concurrency_limit: opts?.limit,
      on_failure: opts?.on_failure,
    },
  );
  assert(result.ok, `bind_plan failed: ${!result.ok ? result.message : ""}`);
  return result.plan;
}

function outcome(status: "SUCCESS" | "FAILED" = "SUCCESS"): StepOutcome {
  return {
    status,
    output: null,
    completed_at: new Date().toISOString(),
  };
}

function eventTypes(loop: ExecutionLoop): string[] {
  return loop.get_event_log().map(e => e.event_type);
}

// ── AC-S5-01 ──────────────────────────────────────────────────────────────────

describe("AC-S5-01 — load_plan transitions IDLE → READY", () => {
  test("valid bound plan: status becomes READY", () => {
    const loop = new ExecutionLoop();
    assert.equal(loop.get_state().loop_status, "IDLE");
    loop.load_plan(makePlan());
    assert.equal(loop.get_state().loop_status, "READY");
  });

  test("load from non-IDLE state throws InvalidStateError", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    assert.throws(
      () => loop.load_plan(makePlan()),
      (err: unknown) => err instanceof InvalidStateError && err.code === "INVALID_STATE_FOR_LOAD",
    );
  });

  test("plan with empty run_id throws InvalidPlanError PLAN_NOT_BOUND", () => {
    const loop = new ExecutionLoop();
    const plan = makePlan();
    // Directly construct an unbound-looking plan object
    const unbound = { ...plan, run_id: "" };
    assert.throws(
      () => loop.load_plan(unbound),
      (err: unknown) => err instanceof InvalidPlanError && err.code === "PLAN_NOT_BOUND",
    );
  });

  test("plan with no steps throws InvalidPlanError PLAN_EMPTY", () => {
    const loop = new ExecutionLoop();
    const plan = makePlan();
    const empty = { ...plan, steps: [] };
    assert.throws(
      () => loop.load_plan(empty),
      (err: unknown) => err instanceof InvalidPlanError && err.code === "PLAN_EMPTY",
    );
  });
});

// ── AC-S5-02 ──────────────────────────────────────────────────────────────────

describe("AC-S5-02 — start() transitions READY → RUNNING; emits LOOP_STARTED", () => {
  test("LOOP_STARTED is the first event in the log", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();
    const log = loop.get_event_log();
    assert(log.length >= 1);
    assert.equal(log[0].event_type, "LOOP_STARTED");
    assert.equal(log[0].payload["plan_id"], "plan-001");
  });

  test("start() from non-READY state throws InvalidStateError", () => {
    const loop = new ExecutionLoop();
    assert.throws(
      () => loop.start(),
      (err: unknown) => err instanceof InvalidStateError && err.code === "INVALID_STATE_FOR_START",
    );
  });

  test("loop transitions through RUNNING into AWAITING_RESULTS after tick", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();
    // tick() runs synchronously inside start(); first step is dispatched
    assert.equal(loop.get_state().loop_status, "AWAITING_RESULTS");
    assert(loop.get_state().pending_set.length > 0);
  });
});

// ── AC-S5-03 ──────────────────────────────────────────────────────────────────

describe("AC-S5-03 — sequential: one step at a time; second only after first result", () => {
  test("only step-a dispatched initially; step-b dispatched after step-a result", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan({ mode: "SEQUENTIAL" }));
    loop.start();

    // Only step-a should be pending after first tick
    const s1 = loop.get_state();
    assert.deepEqual(s1.pending_set, ["step-a"]);
    assert.equal(s1.loop_status, "AWAITING_RESULTS");

    // Deliver step-a result
    loop.intake_result("step-a", outcome("SUCCESS"));

    // step-b should now be pending; step-a is done
    const s2 = loop.get_state();
    assert.deepEqual(s2.pending_set, ["step-b"]);
    assert.equal(s2.loop_status, "AWAITING_RESULTS");

    // Deliver step-b result
    loop.intake_result("step-b", outcome("SUCCESS"));

    assert.equal(loop.get_state().loop_status, "COMPLETED");
  });
});

// ── AC-S5-04 ──────────────────────────────────────────────────────────────────

describe("AC-S5-04 — parallel: full group dispatched in one tick; awaits full drain", () => {
  test("all three independent steps dispatched in single tick", () => {
    const plan = makePlan({
      steps: [
        { step_id: "step-a", priority: 1, depends_on: [] },
        { step_id: "step-b", priority: 2, depends_on: [] },
        { step_id: "step-c", priority: 3, depends_on: [] },
      ],
      mode: "PARALLEL",
      limit: 3,
    });
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    const s1 = loop.get_state();
    assert.equal(s1.loop_status, "AWAITING_RESULTS");
    // All three dispatched at once
    assert.deepEqual(s1.pending_set, ["step-a", "step-b", "step-c"]);
    assert.equal(s1.tick_count, 1);

    // Deliver results one by one; loop stays AWAITING_RESULTS until all drain
    loop.intake_result("step-a", outcome("SUCCESS"));
    assert.equal(loop.get_state().loop_status, "AWAITING_RESULTS");

    loop.intake_result("step-b", outcome("SUCCESS"));
    assert.equal(loop.get_state().loop_status, "AWAITING_RESULTS");

    loop.intake_result("step-c", outcome("SUCCESS"));
    assert.equal(loop.get_state().loop_status, "COMPLETED");
  });

  test("second parallel group not dispatched until first group fully drained", () => {
    // Wave 1: A, B (no deps). Wave 2: C (depends on A and B)
    const plan = makePlan({
      steps: [
        { step_id: "step-a", priority: 1, depends_on: [] },
        { step_id: "step-b", priority: 2, depends_on: [] },
        { step_id: "step-c", priority: 3, depends_on: ["step-a", "step-b"] },
      ],
      mode: "PARALLEL",
      limit: 2,
    });
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    // Wave 1: A and B dispatched
    assert.deepEqual(loop.get_state().pending_set, ["step-a", "step-b"]);

    loop.intake_result("step-a", outcome("SUCCESS"));
    // B still pending; C not yet ready
    assert.deepEqual(loop.get_state().pending_set, ["step-b"]);

    loop.intake_result("step-b", outcome("SUCCESS"));
    // Now C becomes ready and is dispatched
    assert.deepEqual(loop.get_state().pending_set, ["step-c"]);

    loop.intake_result("step-c", outcome("SUCCESS"));
    assert.equal(loop.get_state().loop_status, "COMPLETED");
  });
});

// ── AC-S5-05 ──────────────────────────────────────────────────────────────────

describe("AC-S5-05 — intake_result() removes step from pending; emits STEP_RESULT_RECEIVED", () => {
  test("pending set shrinks and event emitted after intake", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    assert.deepEqual(loop.get_state().pending_set, ["step-a"]);

    loop.intake_result("step-a", outcome("SUCCESS"));

    const log = loop.get_event_log();
    const received = log.filter(e => e.event_type === "STEP_RESULT_RECEIVED");
    assert.equal(received.length, 1);
    assert.equal(received[0].payload["step_id"], "step-a");
    assert.equal(received[0].payload["status"], "SUCCESS");
  });
});

// ── AC-S5-06 ──────────────────────────────────────────────────────────────────

describe("AC-S5-06 — all steps SUCCESS → COMPLETED; emits LOOP_COMPLETED", () => {
  test("two-step sequential plan reaches COMPLETED", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    loop.intake_result("step-a", outcome("SUCCESS"));
    loop.intake_result("step-b", outcome("SUCCESS"));

    const s = loop.get_state();
    assert.equal(s.loop_status, "COMPLETED");
    assert.notEqual(s.terminal_at, null);
    assert.equal(s.terminal_reason, "plan_completed");

    const log = loop.get_event_log();
    const completed = log.filter(e => e.event_type === "LOOP_COMPLETED");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].payload["plan_id"], "plan-001");
  });

  test("single-step plan reaches COMPLETED", () => {
    const plan = makePlan({
      steps: [{ step_id: "only-step", priority: 1, depends_on: [] }],
    });
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    loop.intake_result("only-step", outcome("SUCCESS"));

    assert.equal(loop.get_state().loop_status, "COMPLETED");
  });
});

// ── AC-S5-07 ──────────────────────────────────────────────────────────────────

describe("AC-S5-07 — any FAILED terminal step → FAILED loop; emits LOOP_FAILED", () => {
  test("step-a fails with skip_dependents: loop reaches FAILED", () => {
    const plan = makePlan({ on_failure: "skip_dependents" });
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    loop.intake_result("step-a", outcome("FAILED"));

    const s = loop.get_state();
    assert.equal(s.loop_status, "FAILED");
    assert.notEqual(s.terminal_at, null);

    const log = loop.get_event_log();
    const failed = log.filter(e => e.event_type === "LOOP_FAILED");
    assert.equal(failed.length, 1);
    assert(typeof failed[0].payload["reason"] === "string");
  });

  test("LOOP_FAILED is emitted exactly once", () => {
    const plan = makePlan({ on_failure: "skip_dependents" });
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    loop.intake_result("step-a", outcome("FAILED"));

    const log = loop.get_event_log();
    assert.equal(log.filter(e => e.event_type === "LOOP_FAILED").length, 1);
  });
});

// ── AC-S5-08 ──────────────────────────────────────────────────────────────────

describe("AC-S5-08 — STEP_FAILED halt condition (on_failure=halt) → HALTED", () => {
  test("default halt policy: step failure triggers HALTED with step reason", () => {
    // on_failure defaults to "halt"
    const plan = makePlan();
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    loop.intake_result("step-a", outcome("FAILED"));

    const s = loop.get_state();
    assert.equal(s.loop_status, "HALTED");
    assert(s.terminal_reason?.startsWith("step_failed:step-a"));

    const log = loop.get_event_log();
    const halted = log.filter(e => e.event_type === "LOOP_HALTED");
    assert.equal(halted.length, 1);
    assert(String(halted[0].payload["reason"]).startsWith("step_failed:step-a"));
  });

  test("LOOP_HALTED payload includes the failing step_id in reason", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();
    loop.intake_result("step-a", outcome("FAILED"));

    const halted = loop.get_event_log().find(e => e.event_type === "LOOP_HALTED");
    assert(halted !== undefined);
    assert(String(halted.payload["reason"]).includes("step-a"));
  });
});

// ── AC-S5-09 ──────────────────────────────────────────────────────────────────

describe("AC-S5-09 — external halt() transitions loop to HALTED regardless of state", () => {
  test("halt() from AWAITING_RESULTS → HALTED", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();
    assert.equal(loop.get_state().loop_status, "AWAITING_RESULTS");

    loop.halt("operator_cancel");

    const s = loop.get_state();
    assert.equal(s.loop_status, "HALTED");
    assert(s.terminal_reason?.startsWith("external:operator_cancel"));
  });

  test("halt() from READY (before start) → HALTED", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    assert.equal(loop.get_state().loop_status, "READY");

    loop.halt("pre_start_cancel");

    assert.equal(loop.get_state().loop_status, "HALTED");
  });

  test("halt() from HALTED is a no-op; event count does not grow", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();
    loop.halt("first");
    const countAfterFirst = loop.get_event_log().length;

    loop.halt("second");

    assert.equal(loop.get_event_log().length, countAfterFirst);
    assert.equal(loop.get_state().loop_status, "HALTED");
  });

  test("halt() from COMPLETED is a no-op", () => {
    const plan = makePlan({
      steps: [{ step_id: "only", priority: 1, depends_on: [] }],
    });
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();
    loop.intake_result("only", outcome("SUCCESS"));
    assert.equal(loop.get_state().loop_status, "COMPLETED");
    const countBefore = loop.get_event_log().length;

    loop.halt("too_late");

    assert.equal(loop.get_state().loop_status, "COMPLETED");
    assert.equal(loop.get_event_log().length, countBefore);
  });

  test("halt() from FAILED is a no-op", () => {
    const plan = makePlan({ on_failure: "skip_dependents" });
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();
    loop.intake_result("step-a", outcome("FAILED"));
    assert.equal(loop.get_state().loop_status, "FAILED");
    const countBefore = loop.get_event_log().length;

    loop.halt("too_late");

    assert.equal(loop.get_state().loop_status, "FAILED");
    assert.equal(loop.get_event_log().length, countBefore);
  });
});

// ── AC-S5-10 ──────────────────────────────────────────────────────────────────

describe("AC-S5-10 — orphaned pending steps recorded in event log on halt", () => {
  test("orphaned step_ids appear in LOOP_HALTED payload and LOOP_WARNING events", () => {
    const plan = makePlan({
      steps: [
        { step_id: "step-a", priority: 1, depends_on: [] },
        { step_id: "step-b", priority: 2, depends_on: [] },
      ],
      mode: "PARALLEL",
      limit: 2,
    });
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    // Both dispatched and pending; halt before any result
    loop.halt("abort");

    const log = loop.get_event_log();
    const halted = log.find(e => e.event_type === "LOOP_HALTED");
    assert(halted !== undefined);
    const orphaned = halted.payload["orphaned_step_ids"] as string[];
    assert(orphaned.includes("step-a"));
    assert(orphaned.includes("step-b"));

    // One LOOP_WARNING per orphaned step
    const warnings = log.filter(
      e => e.event_type === "LOOP_WARNING" && e.payload["reason"] === "step_orphaned_on_halt",
    );
    assert.equal(warnings.length, 2);
    const warnedIds = warnings.map(w => w.payload["step_id"] as string);
    assert(warnedIds.includes("step-a"));
    assert(warnedIds.includes("step-b"));
  });

  test("pending set is empty after halt", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();
    loop.halt("abort");
    assert.equal(loop.get_state().pending_set.length, 0);
  });

  test("no orphan warnings when halting with empty pending set", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.halt("pre_start");
    const orphanWarnings = loop
      .get_event_log()
      .filter(e => e.event_type === "LOOP_WARNING" && e.payload["reason"] === "step_orphaned_on_halt");
    assert.equal(orphanWarnings.length, 0);
  });
});

// ── AC-S5-11 ──────────────────────────────────────────────────────────────────

describe("AC-S5-11 — unknown step_id in intake_result() → LOOP_WARNING; no halt", () => {
  test("LOOP_WARNING emitted for unknown step_id", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    loop.intake_result("does-not-exist", outcome("SUCCESS"));

    const log = loop.get_event_log();
    const warnings = log.filter(
      e => e.event_type === "LOOP_WARNING" && e.payload["reason"] === "unknown_step_id",
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].payload["step_id"], "does-not-exist");
  });

  test("loop does not halt on unknown step_id", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    loop.intake_result("ghost-step", outcome("FAILED"));

    assert.equal(loop.get_state().loop_status, "AWAITING_RESULTS");
  });

  test("loop remains usable after unknown step_id warning", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    loop.intake_result("ghost-step", outcome("SUCCESS")); // discarded
    loop.intake_result("step-a", outcome("SUCCESS"));     // real
    loop.intake_result("step-b", outcome("SUCCESS"));

    assert.equal(loop.get_state().loop_status, "COMPLETED");
  });
});

// ── AC-S5-12 ──────────────────────────────────────────────────────────────────

describe("AC-S5-12 — no method mutates the bound plan_id, run_id, or step definitions", () => {
  test("plan_id and run_id are unchanged after full execution", () => {
    const plan = makePlan();
    const originalPlanId = plan.plan_id;
    const originalRunId  = plan.run_id;

    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();
    loop.intake_result("step-a", outcome("SUCCESS"));
    loop.intake_result("step-b", outcome("SUCCESS"));

    assert.equal(plan.plan_id, originalPlanId);
    assert.equal(plan.run_id, originalRunId);
  });

  test("step definitions (step_id, priority, depends_on) are unchanged after execution", () => {
    const plan = makePlan();
    const snapshots = plan.steps.map(s => ({
      step_id:    s.step_id,
      priority:   s.priority,
      depends_on: [...s.depends_on],
    }));

    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();
    loop.intake_result("step-a", outcome("SUCCESS"));
    loop.intake_result("step-b", outcome("SUCCESS"));

    plan.steps.forEach((s, i) => {
      assert.equal(s.step_id, snapshots[i].step_id);
      assert.equal(s.priority, snapshots[i].priority);
      assert.deepEqual([...s.depends_on], snapshots[i].depends_on);
    });
  });

  test("get_state() does not alter loop internals when called mid-execution", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    const before = loop.get_state();
    // Repeated calls return the same logical snapshot
    const after  = loop.get_state();
    assert.equal(before.loop_status, after.loop_status);
    assert.equal(before.tick_count,  after.tick_count);
  });
});

// ── AC-S5-13 ──────────────────────────────────────────────────────────────────

describe("AC-S5-13 — event log is append-only; prior entries are never modified", () => {
  test("event log grows monotonically; no prior entry changes after append", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    const snap1 = loop.get_event_log();
    const ids1  = snap1.map(e => e.event_id);

    loop.intake_result("step-a", outcome("SUCCESS"));
    const snap2 = loop.get_event_log();

    // All events from snap1 are still present in snap2 at the same indices
    ids1.forEach((id, i) => {
      assert.equal(snap2[i].event_id, id);
    });
    assert(snap2.length > snap1.length);
  });

  test("get_event_log() returns a copy; pushing to it does not affect the internal log", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    const copy = loop.get_event_log() as LoopEvent[];
    const lenBefore = copy.length;
    // Mutate the returned copy
    (copy as LoopEvent[]).push({ event_id: "x", event_type: "LOOP_WARNING", emitted_at: "", payload: {} });

    // Internal log must be unaffected
    assert.equal(loop.get_event_log().length, lenBefore);
  });
});

// Need to import LoopEvent for the above test
import type { LoopEvent } from "../execution-loop.js";

// ── AC-S5-14 ──────────────────────────────────────────────────────────────────

describe("AC-S5-14 — PLAN_INTEGRITY_VIOLATION → HALTED", () => {
  test("worker SKIPPED outcome is an integrity violation → HALTED", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    loop.intake_result("step-a", { status: "SKIPPED", output: null, completed_at: new Date().toISOString() });

    assert.equal(loop.get_state().loop_status, "HALTED");
    const halted = loop.get_event_log().find(e => e.event_type === "LOOP_HALTED");
    assert(halted !== undefined);
    assert(String(halted.payload["reason"]).includes("integrity_violation"));
    assert(String(halted.payload["reason"]).includes("skipped"));
  });

  test("corrupted step state during result intake → HALTED with integrity_violation reason", () => {
    const plan = makePlan();
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    // step-a is in DISPATCHED state in the pending set.
    // Force it to an unexpected state to simulate plan state corruption.
    const stepA = plan.steps.find(s => s.step_id === "step-a")!;
    stepA.state = "PENDING"; // corrupt: PENDING while step is in pending set

    loop.intake_result("step-a", outcome("SUCCESS"));

    const s = loop.get_state();
    assert.equal(s.loop_status, "HALTED");
    assert(s.terminal_reason?.includes("integrity_violation"));

    const halted = loop.get_event_log().find(e => e.event_type === "LOOP_HALTED");
    assert(halted !== undefined);
    assert(String(halted.payload["reason"]).includes("integrity_violation"));
  });

  test("LOOP_HALTED contains the affected step_id in the reason on integrity violation", () => {
    const plan = makePlan();
    const loop = new ExecutionLoop();
    loop.load_plan(plan);
    loop.start();

    const stepA = plan.steps.find(s => s.step_id === "step-a")!;
    stepA.state = "COMPLETED"; // corrupt: already terminal while still pending

    loop.intake_result("step-a", outcome("SUCCESS"));

    const halted = loop.get_event_log().find(e => e.event_type === "LOOP_HALTED");
    assert(halted !== undefined);
    assert(String(halted.payload["reason"]).includes("step-a"));
  });
});

// ── AC-S5-15 ──────────────────────────────────────────────────────────────────

describe("AC-S5-15 — get_state() returns snapshot copy; mutations do not affect loop", () => {
  test("mutating pending_set from snapshot does not change loop state", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    const snap = loop.get_state();
    assert.equal(snap.pending_set.length, 1);

    // pending_set is readonly string[] — cast to mutable to attempt mutation
    const mutable = snap.pending_set as string[];
    mutable.push("injected-step");

    // Loop internal state must be unaffected
    assert.equal(loop.get_state().pending_set.length, 1);
  });

  test("snapshot reflects state at the moment of the call, not a later state", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    const beforeIntake = loop.get_state();
    assert.equal(beforeIntake.loop_status, "AWAITING_RESULTS");

    loop.intake_result("step-a", outcome("SUCCESS"));

    // Old snapshot is unchanged
    assert.equal(beforeIntake.loop_status, "AWAITING_RESULTS");
    // New snapshot reflects new state
    assert.equal(loop.get_state().loop_status, "AWAITING_RESULTS"); // step-b pending now
  });

  test("tick_count in snapshot does not increase retroactively", () => {
    const loop = new ExecutionLoop();
    loop.load_plan(makePlan());
    loop.start();

    const snap1 = loop.get_state();
    loop.intake_result("step-a", outcome("SUCCESS")); // triggers second tick
    const snap2 = loop.get_state();

    // snap1 was captured at tick_count=1; it should not have changed
    assert.equal(snap1.tick_count, 1);
    assert.equal(snap2.tick_count, 2);
  });
});
