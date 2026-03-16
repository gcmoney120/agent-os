/**
 * Agent OS — Runtime Integration Layer R2
 * Bridge tests: translatePlanToDispatch + syncDispatchResult
 *
 * Acceptance criteria under test:
 *   AC-R2-01  translatePlanToDispatch maps all PlanStep fields correctly
 *   AC-R2-02  syncDispatchResult updates RunLedger state per Binding Contract 2
 *   AC-R2-08  Edge cases: empty steps, trust_touch, all 5 agent roles, seq→index
 *   AC-R2-09  Governance halt leaves RunLedger in HALTING (not FAILED)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { translatePlanToDispatch, syncDispatchResult } from "../bridge.js";
import { createEmptyLedgerStore, createRunLedger, updateLedgerState } from "../../planner/run-ledger.js";
import type { PlanArtifact, PlanStep, AgentRole } from "../../planner/types.js";
import type { RunLedger } from "../../planner/execution-types.js";
import type { ProjectAdapter } from "../../adapter/schema.js";
import type { DispatchResult } from "../../dispatcher/errors.js";
import type { RunLedgerStore } from "../../planner/run-ledger.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const PLAN_ID = "plan_bridge_test_001";
const RUN_ID = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TS = "2026-03-15T00:00:00.000Z";

function makeAdapter(overrides?: Partial<ProjectAdapter["policy"]>): ProjectAdapter {
  return {
    schema_version: "1.0",
    project: {
      name: "Test Project",
      slug: "test-project",
      repo_root: "/test/project",
    },
    paths: {
      system_state: ".agent-os/SYSTEM_STATE.md",
      run_root: ".agent-os/runs",
      policy_allowlist: ".agent-os/policy.ts",
    },
    policy: {
      allowlist_type: "ts_export_record",
      export_name: "POLICY_ALLOWLIST",
      actor_keys: ["command", "atlas", "forge", "sentinel", "compass"],
      enforced_output_required_actions: [],
      ...overrides,
    },
    prompts: { command: "v1", atlas: "v1", forge: "v1", sentinel: "v1", compass: "v1" },
    models: {
      command: "claude-opus-4-6",
      atlas: "claude-sonnet-4-6",
      forge: "claude-sonnet-4-6",
      sentinel: "claude-opus-4-6",
      compass: "claude-sonnet-4-6",
    },
    governance: {
      system_state_updates: {
        mode: "hybrid",
        require_manual_approval_for: ["trust_change"],
        auto_apply_for: ["trivial"],
        trust_change_triggers: {
          paths_globs: [],
          keywords: [],
          action_names: [],
          always_require_sentinel_review_if_trust_change: true,
        },
      },
    },
    execution: { test_command: "npm test" },
    limits: { max_steps_per_run: 50 },
  };
}

function makeStep(
  overrides: Partial<PlanStep> & { step_id: string; sequence: number; agent: AgentRole },
): PlanStep {
  return {
    label: "Test step",
    input_contract: "write_implementation",
    output_contract: "implementation_complete",
    acceptance_criteria: [],
    depends_on: [],
    trust_touch: false,
    trust_touch_domains: [],
    status: "PENDING",
    result_ref: null,
    ...overrides,
  };
}

function makeRunLedger(overrides?: Partial<RunLedger>): RunLedger {
  return {
    run_id: RUN_ID,
    plan_id: PLAN_ID,
    plan_version: 1,
    plan_snapshot: {},
    plan_snapshot_chksum: "abc123",
    state: "RUNNING",
    state_entered_at: TS,
    requested_by: "Command",
    foreman_version: "1.0",
    created_at: TS,
    terminal_at: null,
    terminal_reason: null,
    readiness_verdict: null,
    ...overrides,
  };
}

function makePlan(steps: PlanStep[]): PlanArtifact {
  return {
    plan_id: PLAN_ID,
    goal_id: "goal_001",
    version: 1,
    version_history: [],
    status: "APPROVED",
    scope_tag: "INFRA",
    trust_sensitive: false,
    steps,
    non_goals: [],
    sentinel_prereview: null,
    submitted_at: TS,
    approved_at: TS,
    approved_by: "Command",
    approval_acknowledgements: [],
    plan_hash: "abc123",
    run_id: null,
    executed_at: null,
    archived_at: null,
  };
}

/** Create a ledger store with a RUNNING run already in it. */
function makeRunningStore(): RunLedgerStore {
  const emptyStore = createEmptyLedgerStore();
  const ledger: RunLedger = makeRunLedger({ state: "PENDING_ACK" });

  const createResult = createRunLedger(emptyStore, ledger);
  if (!createResult.ok) throw new Error(`Setup failed: ${createResult.message}`);

  let store: RunLedgerStore = createResult.data;

  const r1 = updateLedgerState(store, RUN_ID, "INITIATING", TS);
  if (!r1.ok) throw new Error(`Setup failed: ${r1.message}`);
  store = r1.data;

  const r2 = updateLedgerState(store, RUN_ID, "RUNNING", TS);
  if (!r2.ok) throw new Error(`Setup failed: ${r2.message}`);
  return r2.data;
}

// ── AC-R2-08: Empty plan ──────────────────────────────────────────────────────

describe("translatePlanToDispatch", () => {
  it("AC-R2-08: empty steps → zero-step DispatchRequestV1", () => {
    const plan = makePlan([]);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result)}`);
    assert.equal(result.request.schema_version, "1.0");
    assert.equal(result.request.run_id, RUN_ID);
    assert.equal(result.request.steps.length, 0);
  });

  // AC-R2-01: All 5 agent roles map to correct ActorKey
  it("AC-R2-01: all 5 AgentRole → ActorKey mappings are correct", () => {
    const roles: AgentRole[] = ["Command", "Atlas", "Forge", "Sentinel", "Compass"];
    const expectedActors = ["command", "atlas", "forge", "sentinel", "compass"];

    const steps = roles.map((agent, i) =>
      makeStep({ step_id: `step_${i + 1}`, sequence: i + 1, agent }),
    );

    const plan = makePlan(steps);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(result.ok);
    assert.equal(result.request.steps.length, 5);

    for (let i = 0; i < 5; i++) {
      assert.equal(result.request.steps[i].actor, expectedActors[i],
        `Role ${roles[i]} should map to ${expectedActors[i]}`);
    }
  });

  // AC-R2-08: sequence (1-based) → step_index (0-based)
  it("AC-R2-08: sequence - 1 = step_index (1-based to 0-based)", () => {
    const steps = [
      makeStep({ step_id: "step_1", sequence: 1, agent: "Forge" }),
      makeStep({ step_id: "step_2", sequence: 2, agent: "Forge" }),
      makeStep({ step_id: "step_3", sequence: 3, agent: "Sentinel" }),
    ];
    const plan = makePlan(steps);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(result.ok);
    assert.equal(result.request.steps[0].step_index, 0);
    assert.equal(result.request.steps[1].step_index, 1);
    assert.equal(result.request.steps[2].step_index, 2);
  });

  // AC-R2-01: input_contract → action
  it("AC-R2-01: input_contract maps to action", () => {
    const steps = [
      makeStep({ step_id: "step_1", sequence: 1, agent: "Forge", input_contract: "write_code" }),
    ];
    const plan = makePlan(steps);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(result.ok);
    assert.equal(result.request.steps[0].action, "write_code");
  });

  // AC-R2-08: trust_touch → capabilities includes "trust_change"
  it("AC-R2-08: trust_touch=true → capabilities includes trust_change", () => {
    const steps = [
      makeStep({
        step_id: "step_1",
        sequence: 1,
        agent: "Sentinel",
        trust_touch: true,
        trust_touch_domains: ["IDENTITY"],
      }),
    ];
    const plan = makePlan(steps);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(result.ok);
    assert.ok(result.request.steps[0].capabilities.includes("trust_change"),
      "trust_touch steps must include trust_change capability");
  });

  // Non-trust step should not get trust_change capability
  it("trust_touch=false → capabilities does not include trust_change", () => {
    const steps = [
      makeStep({ step_id: "step_1", sequence: 1, agent: "Forge", trust_touch: false }),
    ];
    const plan = makePlan(steps);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(result.ok);
    assert.ok(!result.request.steps[0].capabilities.includes("trust_change"));
  });

  // AC-R2-01: artifacts_root includes run_id
  it("AC-R2-01: artifacts_root = projectRoot + run_root + run_id", () => {
    const plan = makePlan([makeStep({ step_id: "step_1", sequence: 1, agent: "Forge" })]);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(result.ok);
    // adapter.project.repo_root = "/test/project"
    // adapter.paths.run_root = ".agent-os/runs"
    // runId = RUN_ID
    assert.ok(
      result.request.artifacts_root.includes(".agent-os") &&
      result.request.artifacts_root.includes(RUN_ID),
      `artifacts_root ${result.request.artifacts_root} should include run_root and run_id`,
    );
  });
});

// ── AC-R2-02 / AC-R2-09: syncDispatchResult ──────────────────────────────────

describe("syncDispatchResult", () => {
  it("AC-R2-02: success → RUNNING → COMPLETING → COMPLETED", () => {
    // Setup a RUNNING ledger store
    let store = createEmptyLedgerStore();
    const createResult = createRunLedger(store, makeRunLedger({ state: "PENDING_ACK" }));
    assert.ok(createResult.ok);
    store = createResult.data;

    const r1 = updateLedgerState(store, RUN_ID, "INITIATING", TS);
    assert.ok(r1.ok);
    const r2 = updateLedgerState(r1.data, RUN_ID, "RUNNING", TS);
    assert.ok(r2.ok);
    store = r2.data;

    const dispatchResult: DispatchResult = {
      ok: true,
      run_id: RUN_ID,
      written_step_reports: [
        { step_index: 0, step_id: "step_1", path: "/artifacts/step-report.json" },
      ],
    };

    const syncResult = syncDispatchResult(dispatchResult, store, RUN_ID);
    assert.ok(syncResult.ok, `Expected ok, got: ${JSON.stringify(syncResult)}`);
    assert.equal(syncResult.terminal_state, "COMPLETED");

    const finalLedger = syncResult.store.ledgers.get(RUN_ID);
    assert.ok(finalLedger, "Ledger should exist after sync");
    assert.equal(finalLedger.state, "COMPLETED");

    const events = syncResult.store.events.get(RUN_ID);
    assert.ok(events && events.length > 0, "Should have appended STEP_COMPLETED events");
    assert.ok(
      events?.some((e) => e.event_type === "STEP_COMPLETED"),
      "Should have a STEP_COMPLETED event",
    );
  });

  it("AC-R2-09: governance halt → RUNNING → HALTING (stays, not FAILED)", () => {

    let store = createEmptyLedgerStore();
    const createResult = createRunLedger(store, makeRunLedger({ state: "PENDING_ACK" }));
    assert.ok(createResult.ok);
    store = createResult.data;

    const r1 = updateLedgerState(store, RUN_ID, "INITIATING", TS);
    assert.ok(r1.ok);
    const r2 = updateLedgerState(r1.data, RUN_ID, "RUNNING", TS);
    assert.ok(r2.ok);
    store = r2.data;

    const dispatchResult: DispatchResult = {
      ok: false,
      run_id: RUN_ID,
      error: {
        code: "DISPATCH_HALTED_GOVERNANCE",
        message: "Step requires manual approval before execution",
        step_index: 1,
        step_id: "step_2",
      },
    };

    const syncResult = syncDispatchResult(dispatchResult, store, RUN_ID);
    assert.ok(syncResult.ok, `Expected ok, got: ${JSON.stringify(syncResult)}`);
    assert.equal(syncResult.terminal_state, "HALTING",
      "Governance halt should leave run in HALTING, not FAILED");

    const finalLedger = syncResult.store.ledgers.get(RUN_ID);
    assert.ok(finalLedger);
    assert.equal(finalLedger.state, "HALTING",
      "Ledger state must be HALTING, not FAILED, for governance halt");
  });

  it("AC-R2-02: non-governance failure → RUNNING → HALTING → FAILED + RUN_FAILED event", () => {

    let store = createEmptyLedgerStore();
    const createResult = createRunLedger(store, makeRunLedger({ state: "PENDING_ACK" }));
    assert.ok(createResult.ok);
    store = createResult.data;

    const r1 = updateLedgerState(store, RUN_ID, "INITIATING", TS);
    assert.ok(r1.ok);
    const r2 = updateLedgerState(r1.data, RUN_ID, "RUNNING", TS);
    assert.ok(r2.ok);
    store = r2.data;

    const dispatchResult: DispatchResult = {
      ok: false,
      run_id: RUN_ID,
      error: {
        code: "DISPATCH_RUNNER_FAILED",
        message: "Runner threw an unexpected error",
        step_index: 0,
        step_id: "step_1",
      },
    };

    const syncResult = syncDispatchResult(dispatchResult, store, RUN_ID);
    assert.ok(syncResult.ok, `Expected ok, got: ${JSON.stringify(syncResult)}`);
    assert.equal(syncResult.terminal_state, "FAILED");

    const finalLedger = syncResult.store.ledgers.get(RUN_ID);
    assert.ok(finalLedger);
    assert.equal(finalLedger.state, "FAILED");

    const events = syncResult.store.events.get(RUN_ID);
    assert.ok(
      events?.some((e) => e.event_type === "RUN_FAILED"),
      "Should have a RUN_FAILED event",
    );
  });

  it("AC-R2-02: success with zero step reports → COMPLETED with no events", () => {

    let store = createEmptyLedgerStore();
    const createResult = createRunLedger(store, makeRunLedger({ state: "PENDING_ACK" }));
    assert.ok(createResult.ok);
    store = createResult.data;

    const r1 = updateLedgerState(store, RUN_ID, "INITIATING", TS);
    assert.ok(r1.ok);
    const r2 = updateLedgerState(r1.data, RUN_ID, "RUNNING", TS);
    assert.ok(r2.ok);
    store = r2.data;

    const dispatchResult: DispatchResult = {
      ok: true,
      run_id: RUN_ID,
      written_step_reports: [],
    };

    const syncResult = syncDispatchResult(dispatchResult, store, RUN_ID);
    assert.ok(syncResult.ok);
    assert.equal(syncResult.terminal_state, "COMPLETED");

    const finalLedger = syncResult.store.ledgers.get(RUN_ID);
    assert.equal(finalLedger?.state, "COMPLETED");
  });
});

// ── R3-C4: translatePlanToDispatch error path ─────────────────────────────────

describe("translatePlanToDispatch — error path (R3-C4)", () => {
  it("R3-C4: unknown agent role → ok:false with BRIDGE_UNKNOWN_AGENT_ROLE", () => {
    // Cast through unknown to inject an invalid AgentRole value
    const invalidStep = makeStep({
      step_id: "step_bad",
      sequence: 1,
      agent: "Unknown" as AgentRole,
    });
    const plan = makePlan([invalidStep]);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(!result.ok, "Expected ok:false for unknown agent role");
    assert.equal(result.code, "BRIDGE_UNKNOWN_AGENT_ROLE",
      `Expected BRIDGE_UNKNOWN_AGENT_ROLE, got: ${result.code}`);
    assert.ok(
      result.message.includes("Unknown"),
      `Expected message to include the bad role name, got: ${result.message}`,
    );
  });

  it("R3-C4: first step valid, second step unknown role → ok:false", () => {
    const steps = [
      makeStep({ step_id: "step_1", sequence: 1, agent: "Forge" }),
      makeStep({ step_id: "step_2", sequence: 2, agent: "BadRole" as AgentRole }),
    ];
    const plan = makePlan(steps);
    const ledger = makeRunLedger();
    const adapter = makeAdapter();

    const result = translatePlanToDispatch(plan, ledger, adapter);
    assert.ok(!result.ok, "Expected ok:false when second step has unknown agent role");
    assert.equal(result.code, "BRIDGE_UNKNOWN_AGENT_ROLE");
  });
});
