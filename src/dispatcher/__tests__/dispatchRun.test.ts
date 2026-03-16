/**
 * Agent OS v1.0 — Dispatcher Tests (Slices 3 + 4).
 *
 * Slice 3 acceptance checks: AC1–AC11.
 * Slice 4 acceptance checks: S4-AC1–S4-AC15 (Governance Enforcement).
 * Uses Node.js native test runner. No real filesystem.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatchRun, governanceDecision } from "../dispatchRun.js";
import { validateStepReportV1 } from "../../step-report/validateStepReport.js";
import type {
  DispatchRequestV1,
  DispatchDeps,
  FrozenStepContext,
  StepRunner,
  RunnerRegistry,
  RunnerOutput,
} from "../types.js";
import type { DispatchResult } from "../errors.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A minimal valid StepReportV1-shaped object that passes Slice 2+6 validation.
 * Includes success=true and output so forge.implement output checks pass
 * when the real validator or post-write OUTPUT_REQUIRED check is exercised.
 */
function validStepReport(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: "1.0",
    run_id: "run-1",
    step_id: "step-a",
    step_index: 0,
    actor: "forge",
    action: "forge.implement",
    success: true,
    status: "succeeded",
    summary: "done",
    artifacts: {},
    output: { result: "ok" },
    state_impact: "none",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Build a simple runner that returns a fixed output. */
function stubRunner(output: RunnerOutput): StepRunner {
  return { run: async () => output };
}

/** Build a runner from a custom function. */
function fnRunner(fn: (ctx: FrozenStepContext) => Promise<RunnerOutput>): StepRunner {
  return { run: fn };
}

/** A complete runner registry where every runner returns a valid step report. */
function fullRegistry(overrides: Partial<RunnerRegistry> = {}): RunnerRegistry {
  const defaultRunner = stubRunner({ step_report: validStepReport() });
  return {
    command: defaultRunner,
    atlas: defaultRunner,
    forge: defaultRunner,
    sentinel: defaultRunner,
    compass: defaultRunner,
    ...overrides,
  };
}

/** Minimal valid DispatchRequestV1 with one step. */
function validRequest(overrides: Partial<DispatchRequestV1> = {}): DispatchRequestV1 {
  return {
    schema_version: "1.0",
    run_id: "run-1",
    project_root: "/project",
    artifacts_root: "/artifacts",
    steps: [
      {
        step_index: 0,
        step_id: "step-a",
        actor: "forge",
        action: "forge.implement",
        capabilities: [],
      },
    ],
    ...overrides,
  };
}

/**
 * A governance-valid adapter object (passes the Slice 4 pre-run gate).
 * Tests that need to exercise gate failures override loadProjectAdapter directly.
 */
function validAdapter(govOverrides: Record<string, unknown> = {}): unknown {
  return {
    name: "test-adapter",
    governance: {
      system_state_updates: {
        mode: "hybrid",
        require_manual_approval_for: ["trust_change"],
        auto_apply_for: ["trivial"],
        ...govOverrides,
      },
    },
  };
}

/** Minimal valid MemoryContext for stubs (K9). */
function stubMemoryContext() {
  return {
    project_id: "test-project",
    run_id: "run-1",
    assembled_at: "2026-01-01T00:00:00.000Z",
    episodic: [] as [],
    decisions: [] as [],
    semantic: [] as [],
    semantic_mode: "structured_only" as const,
    item_counts: {
      episodic_included: 0,
      episodic_available: 0,
      decision_included: 0,
      decision_available: 0,
      semantic_included: 0,
      semantic_available: 0,
    },
    lane_states: {
      episodic: "empty" as const,
      decision: "empty" as const,
      semantic: "disabled" as const,
    },
  };
}

/** Build deps with sensible defaults and overrides. */
function stubDeps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    loadProjectAdapter: async () => ({
      ok: true as const,
      adapter: validAdapter(),
    }),
    validateStepReport: () => ({ ok: true as const }),
    writeStepReport: async ({ artifacts_root, step_index, step_id }) => ({
      ok: true as const,
      path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
    }),
    // K9: default resolveMemoryContext returns a minimal valid MemoryContext.
    resolveMemoryContext: async () => ({
      ok: true as const,
      context: stubMemoryContext(),
    }),
    runnerRegistry: fullRegistry(),
    ...overrides,
  };
}

// ── AC1: Adapter required ────────────────────────────────────────────────────

describe("dispatchRun", () => {
  it("AC1 — adapter load fails => DISPATCH_ADAPTER_LOAD_FAILED", async () => {
    const deps = stubDeps({
      loadProjectAdapter: async () => ({
        ok: false as const,
        error: "adapter file missing",
      }),
    });

    const result = await dispatchRun(validRequest(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_ADAPTER_LOAD_FAILED");
    }
  });

  // ── AC2: Closed runner binding ───────────────────────────────────────────

  it("AC2 — missing sentinel runner => DISPATCH_RUNNER_MISSING", async () => {
    const registry = fullRegistry();
    // Remove sentinel runner
    (registry as unknown as Record<string, unknown>).sentinel = undefined;

    const deps = stubDeps({ runnerRegistry: registry as RunnerRegistry });
    const result = await dispatchRun(validRequest(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_RUNNER_MISSING");
      assert.equal(result.error.actor, "sentinel");
    }
  });

  // ── AC3: StepReport required ─────────────────────────────────────────────

  it("AC3 — runner returns {} => DISPATCH_STEP_REPORT_MISSING", async () => {
    const deps = stubDeps({
      runnerRegistry: fullRegistry({
        forge: stubRunner({}),
      }),
    });

    const result = await dispatchRun(validRequest(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_STEP_REPORT_MISSING");
      assert.equal(result.error.step_index, 0);
    }
  });

  // ── AC4: StepReport validated ────────────────────────────────────────────

  it("AC4 — validator rejects => DISPATCH_STEP_REPORT_INVALID; writeStepReport not called", async () => {
    let writeCalled = false;
    const deps = stubDeps({
      validateStepReport: () => ({
        ok: false as const,
        code: "STEP_REPORT_MISSING_FIELD",
        message: "bad report",
      }),
      writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
        writeCalled = true;
        return {
          ok: true as const,
          path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
        };
      },
    });

    const result = await dispatchRun(validRequest(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_STEP_REPORT_INVALID");
    }
    assert.equal(writeCalled, false, "writeStepReport must not be called when validation fails");
  });

  // ── AC5: Deterministic artifact write path ───────────────────────────────

  it("AC5 — writer called with correct step_index/step_id; path is deterministic", async () => {
    const writeCalls: Array<{
      artifacts_root: string;
      step_index: number;
      step_id: string;
    }> = [];

    const deps = stubDeps({
      writeStepReport: async ({ artifacts_root, step_index, step_id, step_report }) => {
        writeCalls.push({ artifacts_root, step_index, step_id });
        return {
          ok: true as const,
          path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
        };
      },
    });

    const result = await dispatchRun(validRequest(), deps);

    assert.equal(result.ok, true);
    assert.equal(writeCalls.length, 1);
    assert.equal(writeCalls[0].artifacts_root, "/artifacts");
    assert.equal(writeCalls[0].step_index, 0);
    assert.equal(writeCalls[0].step_id, "step-a");

    if (result.ok) {
      assert.equal(
        result.written_step_reports[0].path,
        "/artifacts/steps/0-step-a/step-report.json",
      );
    }
  });

  // ── AC6: Capabilities empty enforced ─────────────────────────────────────

  it("AC6 — non-empty capabilities => DISPATCH_CAPABILITIES_NOT_PERMITTED", async () => {
    const req = validRequest({
      steps: [
        {
          step_index: 0,
          step_id: "step-a",
          actor: "forge",
          action: "forge.implement",
          capabilities: ["fs.write"],
        },
      ],
    });

    const deps = stubDeps();
    const result = await dispatchRun(req, deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_CAPABILITIES_NOT_PERMITTED");
    }
  });

  // ── AC7: Fail-fast ───────────────────────────────────────────────────────

  it("AC7 — step 0 fails => runner for step 1 never called", async () => {
    let step1Called = false;

    const req = validRequest({
      steps: [
        {
          step_index: 0,
          step_id: "step-a",
          actor: "forge",
          action: "forge.implement",
          capabilities: [],
        },
        {
          step_index: 1,
          step_id: "step-b",
          actor: "atlas",
          action: "atlas.research",
          capabilities: [],
        },
      ],
    });

    const deps = stubDeps({
      runnerRegistry: fullRegistry({
        forge: fnRunner(async () => {
          throw new Error("step 0 exploded");
        }),
        atlas: fnRunner(async () => {
          step1Called = true;
          return { step_report: validStepReport() };
        }),
      }),
    });

    const result = await dispatchRun(req, deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_RUNNER_FAILED");
      assert.equal(result.error.step_index, 0);
    }
    assert.equal(step1Called, false, "step 1 runner must not be called after step 0 failure");
  });

  // ── AC8: Context immutability ────────────────────────────────────────────

  it("AC8 — runner attempting to mutate frozen context throws", async () => {
    const deps = stubDeps({
      runnerRegistry: fullRegistry({
        forge: fnRunner(async (ctx) => {
          // Attempt to mutate a top-level property — should throw TypeError
          (ctx as unknown as Record<string, unknown>).step_id = "x";
          return { step_report: validStepReport() };
        }),
      }),
    });

    const result = await dispatchRun(validRequest(), deps);

    // Mutation throws TypeError in strict mode, caught as DISPATCH_RUNNER_FAILED
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_RUNNER_FAILED");
      assert.ok(result.error.cause instanceof TypeError);
    }
  });

  // ── AC9: Relay-friendly result ───────────────────────────────────────────

  it("AC9 — success result includes written_step_reports in order", async () => {
    const req = validRequest({
      steps: [
        {
          step_index: 0,
          step_id: "step-a",
          actor: "forge",
          action: "forge.implement",
          capabilities: [],
        },
        {
          step_index: 1,
          step_id: "step-b",
          actor: "atlas",
          action: "atlas.research",
          capabilities: [],
        },
      ],
    });

    const deps = stubDeps({
      runnerRegistry: fullRegistry({
        forge: stubRunner({
          step_report: validStepReport({ step_id: "step-a", step_index: 0 }),
        }),
        atlas: stubRunner({
          step_report: validStepReport({
            step_id: "step-b",
            step_index: 1,
            actor: "atlas",
            action: "atlas.research",
          }),
        }),
      }),
    });

    const result = await dispatchRun(req, deps);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.run_id, "run-1");
      assert.equal(result.written_step_reports.length, 2);

      assert.equal(result.written_step_reports[0].step_index, 0);
      assert.equal(result.written_step_reports[0].step_id, "step-a");
      assert.equal(
        result.written_step_reports[0].path,
        "/artifacts/steps/0-step-a/step-report.json",
      );

      assert.equal(result.written_step_reports[1].step_index, 1);
      assert.equal(result.written_step_reports[1].step_id, "step-b");
      assert.equal(
        result.written_step_reports[1].path,
        "/artifacts/steps/1-step-b/step-report.json",
      );
    }
  });

  // ── AC10: Path traversal blocked ─────────────────────────────────────────

  it("AC10 — step_id '../escape' => DISPATCH_INVALID_REQUEST; no writes, no runner", async () => {
    let ensureDirCalled = false;
    let writeJsonCalled = false;
    let writeStepCalled = false;
    let runnerCalled = false;

    const req = validRequest({
      steps: [
        {
          step_index: 0,
          step_id: "../escape",
          actor: "forge",
          action: "forge.implement",
          capabilities: [],
        },
      ],
    });

    const deps = stubDeps({
      ensureDir: async () => { ensureDirCalled = true; },
      writeJsonFile: async () => { writeJsonCalled = true; },
      writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
        writeStepCalled = true;
        return {
          ok: true as const,
          path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
        };
      },
      runnerRegistry: fullRegistry({
        forge: fnRunner(async () => {
          runnerCalled = true;
          return { step_report: validStepReport() };
        }),
      }),
    });

    const result = await dispatchRun(req, deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_INVALID_REQUEST");
      assert.match(result.error.message, /unsafe for filesystem path/);
      assert.equal(result.error.step_index, 0);
      assert.equal(result.error.step_id, "../escape");
    }
    assert.equal(ensureDirCalled, false, "ensureDir must not be called");
    assert.equal(writeJsonCalled, false, "writeJsonFile must not be called");
    assert.equal(writeStepCalled, false, "writeStepReport must not be called");
    assert.equal(runnerCalled, false, "runner must not be called");
  });

  // ── AC11: Windows-style backslash blocked ────────────────────────────────

  it("AC11 — step_id 'a\\\\b' (Windows path sep) => DISPATCH_INVALID_REQUEST", async () => {
    const req = validRequest({
      steps: [
        {
          step_index: 0,
          step_id: "a\\b",
          actor: "forge",
          action: "forge.implement",
          capabilities: [],
        },
      ],
    });

    const result = await dispatchRun(req, stubDeps());

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_INVALID_REQUEST");
      assert.match(result.error.message, /unsafe for filesystem path/);
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Slice 4 — Governance Enforcement (S4-AC1 through S4-AC15)
  // ════════════════════════════════════════════════════════════════════════════

  describe("Slice 4 — Governance Enforcement", () => {

    // ── S4-AC1: Pre-run gate: mode violation ────────────────────────────────

    it("S4-AC1 — mode !== 'hybrid' => ADAPTER_GOVERNANCE_MISCONFIGURED, no steps", async () => {
      let runnerCalled = false;
      const deps = stubDeps({
        loadProjectAdapter: async () => ({
          ok: true as const,
          adapter: validAdapter({ mode: "not-hybrid" }),
        }),
        runnerRegistry: fullRegistry({
          forge: fnRunner(async () => {
            runnerCalled = true;
            return { step_report: validStepReport() };
          }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "ADAPTER_GOVERNANCE_MISCONFIGURED");
        assert.match(result.error.message, /mode/);
        assert.deepEqual(result.written_step_reports, []);
      }
      assert.equal(runnerCalled, false, "runner must not be called on gate failure");
    });

    // ── S4-AC2: Pre-run gate: missing trust_change ──────────────────────────

    it("S4-AC2 — require_manual_approval_for omits 'trust_change' => ADAPTER_GOVERNANCE_MISCONFIGURED", async () => {
      const deps = stubDeps({
        loadProjectAdapter: async () => ({
          ok: true as const,
          adapter: validAdapter({ require_manual_approval_for: ["other"] }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "ADAPTER_GOVERNANCE_MISCONFIGURED");
        assert.match(result.error.message, /trust_change/);
        assert.deepEqual(result.written_step_reports, []);
      }
    });

    // ── S4-AC3: Pre-run gate: missing trivial ───────────────────────────────

    it("S4-AC3 — auto_apply_for omits 'trivial' => ADAPTER_GOVERNANCE_MISCONFIGURED", async () => {
      const deps = stubDeps({
        loadProjectAdapter: async () => ({
          ok: true as const,
          adapter: validAdapter({ auto_apply_for: ["other"] }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "ADAPTER_GOVERNANCE_MISCONFIGURED");
        assert.match(result.error.message, /trivial/);
        assert.deepEqual(result.written_step_reports, []);
      }
    });

    // ── S4-AC4: auto_apply for none ─────────────────────────────────────────

    it("S4-AC4 — state_impact 'none' => auto_apply, result ok: true", async () => {
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({ step_report: validStepReport({ state_impact: "none" }) }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, true);
    });

    // ── S4-AC5: auto_apply for trivial in auto_apply_for ────────────────────

    it("S4-AC5 — state_impact 'trivial' + trivial in auto_apply_for => auto_apply, result ok: true", async () => {
      // Default validAdapter has auto_apply_for: ["trivial"]
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({ step_report: validStepReport({ state_impact: "trivial" }) }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, true);
    });

    // ── S4-AC6: governanceDecision — trivial not in auto_apply_for ──────────
    //
    // NOTE: The pre-run gate mandates auto_apply_for includes "trivial", so
    // "trivial ∉ auto_apply_for" is unreachable via dispatchRun() in production.
    // The rule is tested directly against the exported pure function, which is
    // the correct coverage point for this branch.

    it("S4-AC6 — governanceDecision: 'trivial' ∉ auto_apply_for => require_manual_approval", () => {
      const decision = governanceDecision("trivial", undefined, ["other_thing"], ["trust_change"]);
      assert.equal(decision, "require_manual_approval");
    });

    // ── S4-AC7: trust_change always halts even if in auto_apply_for ─────────

    it("S4-AC7 — state_impact 'trust_change' with adversarial auto_apply_for => DISPATCH_HALTED_GOVERNANCE", async () => {
      // Adversarial adapter: auto_apply_for includes "trust_change" — must be ignored.
      // Still requires trivial to pass gate.
      const deps = stubDeps({
        loadProjectAdapter: async () => ({
          ok: true as const,
          adapter: validAdapter({ auto_apply_for: ["trivial", "trust_change"] }),
        }),
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({
              state_impact: "trust_change",
              trust_notes: "reason for trust change",
            }),
          }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "DISPATCH_HALTED_GOVERNANCE");
        const cause = result.error.cause as Record<string, unknown>;
        assert.equal(cause.state_impact, "trust_change");
        assert.equal(cause.decision, "require_manual_approval");
      }
    });

    // ── S4-AC8: phase_boundary not in auto_apply_for ────────────────────────

    it("S4-AC8 — state_impact 'phase_boundary', not in auto_apply_for => DISPATCH_HALTED_GOVERNANCE", async () => {
      // Default validAdapter has auto_apply_for: ["trivial"] — no phase_boundary.
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({ state_impact: "phase_boundary" }),
          }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "DISPATCH_HALTED_GOVERNANCE");
        const cause = result.error.cause as Record<string, unknown>;
        assert.equal(cause.state_impact, "phase_boundary");
      }
    });

    // ── S4-AC9: phase_boundary explicitly in auto_apply_for ─────────────────

    it("S4-AC9 — state_impact 'phase_boundary', explicitly in auto_apply_for => auto_apply, result ok: true", async () => {
      const deps = stubDeps({
        loadProjectAdapter: async () => ({
          ok: true as const,
          adapter: validAdapter({ auto_apply_for: ["trivial", "phase_boundary"] }),
        }),
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({ state_impact: "phase_boundary" }),
          }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, true);
    });

    // ── S4-AC10: TRUST_CHANGE_MISSING_NOTES when trust_notes absent ─────────

    it("S4-AC10 — trust_change + trust_notes undefined => TRUST_CHANGE_MISSING_NOTES; writeStepReport not called", async () => {
      let writeStepCalled = false;
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            // trust_notes intentionally absent
            step_report: validStepReport({ state_impact: "trust_change" }),
          }),
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeStepCalled = true;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "TRUST_CHANGE_MISSING_NOTES");
        assert.equal(result.error.step_index, 0);
      }
      assert.equal(writeStepCalled, false, "writeStepReport must not be called when trust_notes check fails");
    });

    // ── S4-AC11: TRUST_CHANGE_MISSING_NOTES when trust_notes is whitespace ──

    it("S4-AC11 — trust_change + trust_notes whitespace-only => TRUST_CHANGE_MISSING_NOTES; writeStepReport not called", async () => {
      let writeStepCalled = false;
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({
              state_impact: "trust_change",
              trust_notes: "   ",
            }),
          }),
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeStepCalled = true;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "TRUST_CHANGE_MISSING_NOTES");
      }
      assert.equal(writeStepCalled, false, "writeStepReport must not be called when trust_notes check fails");
    });

    // ── S4-AC12: Fail-fast after governance halt ────────────────────────────

    it("S4-AC12 — step 0 halts (trust_change) => step 1 runner never called; written_step_reports has step 0 only", async () => {
      let step1Called = false;

      const req = validRequest({
        steps: [
          {
            step_index: 0,
            step_id: "step-a",
            actor: "forge",
            action: "forge.implement",
            capabilities: [],
          },
          {
            step_index: 1,
            step_id: "step-b",
            actor: "atlas",
            action: "atlas.research",
            capabilities: [],
          },
        ],
      });

      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({
              state_impact: "trust_change",
              trust_notes: "this changes trust",
            }),
          }),
          atlas: fnRunner(async () => {
            step1Called = true;
            return { step_report: validStepReport() };
          }),
        }),
      });

      const result = await dispatchRun(req, deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "DISPATCH_HALTED_GOVERNANCE");
        assert.equal(result.error.step_index, 0);
        assert.equal(result.written_step_reports?.length, 1);
        assert.equal(result.written_step_reports?.[0].step_id, "step-a");
      }
      assert.equal(step1Called, false, "step 1 runner must not be called after governance halt");
    });

    // ── S4-AC13: DISPATCH_HALTED_GOVERNANCE result shape ───────────────────

    it("S4-AC13 — DISPATCH_HALTED_GOVERNANCE result includes required fields", async () => {
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({
              state_impact: "trust_change",
              trust_notes: "reason",
            }),
          }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "DISPATCH_HALTED_GOVERNANCE");
        assert.equal(result.error.step_index, 0);
        assert.equal(result.error.step_id, "step-a");
        assert.equal(result.error.actor, "forge");
        const cause = result.error.cause as Record<string, unknown>;
        assert.equal(cause.state_impact, "trust_change");
        assert.equal(cause.decision, "require_manual_approval");
        // Halting step included in written_step_reports
        assert.equal(result.written_step_reports?.length, 1);
        assert.equal(result.written_step_reports?.[0].step_id, "step-a");
      }
    });

    // ── S4-AC14: writeStepReport called before governance decision ──────────

    it("S4-AC14 — writeStepReport spy called once for halting step before halt returned", async () => {
      let writeCallCount = 0;

      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({
              state_impact: "trust_change",
              trust_notes: "reason",
            }),
          }),
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeCallCount += 1;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "DISPATCH_HALTED_GOVERNANCE");
      }
      assert.equal(writeCallCount, 1, "writeStepReport must be called exactly once for the halting step");
    });

    // ── S4-AC15: Pre-run gate fires before any runner ───────────────────────

    it("S4-AC15 — misconfigured adapter => ADAPTER_GOVERNANCE_MISCONFIGURED; step 0 runner never called", async () => {
      let runnerCalled = false;

      const deps = stubDeps({
        loadProjectAdapter: async () => ({
          ok: true as const,
          // Missing governance entirely
          adapter: { name: "bare-adapter" },
        }),
        runnerRegistry: fullRegistry({
          forge: fnRunner(async () => {
            runnerCalled = true;
            return { step_report: validStepReport() };
          }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "ADAPTER_GOVERNANCE_MISCONFIGURED");
        assert.deepEqual(result.written_step_reports, []);
      }
      assert.equal(runnerCalled, false, "step 0 runner must not be called on gate failure");
    });

  }); // end Slice 4 — Governance Enforcement

  // ════════════════════════════════════════════════════════════════════════════
  // Slice 6 — Atlas §2–§8 Conformance (AC-F1 through AC-F11)
  // ════════════════════════════════════════════════════════════════════════════

  describe("Slice 6 — Atlas §2–§8 Conformance", () => {

    // ── AC-F1: Basic pass — success=true, output present, write_output_calls=1 ─

    it("AC-F1 — success=true + output + write_output_calls=1 + forge.implement => ok: true", async () => {
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: {
            run: async () => ({
              step_report: validStepReport({
                success: true,
                output: { lines_added: 42 },
              }),
              write_output_calls: 1,
            }),
          },
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, true);
    });

    // ── AC-F2: success=true + output=null => EXECUTOR_INVALID_RESULT ────────────

    it("AC-F2 — success=true + output=null => EXECUTOR_INVALID_RESULT; writeStepReport not called", async () => {
      let writeCalled = false;
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({ success: true, output: null }),
          }),
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeCalled = true;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "EXECUTOR_INVALID_RESULT");
        assert.match(result.error.message, /success=true.*output.*null/i);
        assert.equal(result.error.step_index, 0);
      }
      assert.equal(writeCalled, false, "writeStepReport must not be called when EXECUTOR_INVALID_RESULT fires");
    });

    // ── AC-F3: Pre-write ordering — trust_notes check fires before EXECUTOR check

    it("AC-F3 — trust_change + missing trust_notes + success=true + output=null => TRUST_CHANGE_MISSING_NOTES (not EXECUTOR_INVALID_RESULT)", async () => {
      let writeCalled = false;
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            // Both conditions true — trust_notes check must fire first.
            step_report: validStepReport({
              state_impact: "trust_change",
              success: true,
              output: null,
              // trust_notes intentionally absent
            }),
          }),
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeCalled = true;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        // TRUST_CHANGE_MISSING_NOTES must fire before EXECUTOR_INVALID_RESULT.
        assert.equal(result.error.code, "TRUST_CHANGE_MISSING_NOTES");
      }
      assert.equal(writeCalled, false, "writeStepReport must not be called");
    });

    // ── AC-F4: success=false + output absent — no EXECUTOR check ─────────────

    it("AC-F4 — success=false + error present + output absent => no EXECUTOR_INVALID_RESULT", async () => {
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          // action is atlas.research — not in OUTPUT_REQUIRED_ACTIONS
          atlas: {
            run: async () => ({
              step_report: {
                schema_version: "1.0",
                run_id: "run-1",
                step_id: "step-a",
                step_index: 0,
                actor: "atlas",
                action: "atlas.research",
                success: false,
                error: { code: "RESEARCH_FAILED", message: "research target not found" },
                status: "failed",
                summary: "failed to research",
                artifacts: {},
                state_impact: "none",
                timestamp: "2026-01-01T00:00:00Z",
              },
              write_output_calls: 0,
            }),
          },
        }),
      });

      // Dispatch a request with atlas actor.
      const req = validRequest({
        steps: [
          {
            step_index: 0,
            step_id: "step-a",
            actor: "atlas",
            action: "atlas.research",
            capabilities: [],
          },
        ],
      });

      const result = await dispatchRun(req, deps);

      // success=false does NOT trigger EXECUTOR_INVALID_RESULT.
      // atlas.research is not in OUTPUT_REQUIRED_ACTIONS.
      // write_output_calls=0 with no output — CAPABILITY check skipped.
      assert.equal(result.ok, true);
    });

    // ── AC-F5: forge.implement + output absent => OUTPUT_REQUIRED_MISSING ─────

    it("AC-F5 — forge.implement + output absent => OUTPUT_REQUIRED_MISSING", async () => {
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({ output: undefined }),
          }),
        }),
      });

      // Remove output entirely from the step report.
      const report = validStepReport() as Record<string, unknown>;
      delete report["output"];

      const deps2 = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({ step_report: report }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps2);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "OUTPUT_REQUIRED_MISSING");
        assert.match(result.error.message, /forge\.implement/);
        assert.equal(result.error.step_index, 0);
      }
    });

    // ── AC-F6: forge.implement + output present + write_output_calls=0 ───────

    it("AC-F6 — forge.implement + output present + write_output_calls=0 => CAPABILITY_REQUIRED_NOT_USED", async () => {
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: {
            run: async () => ({
              step_report: validStepReport({
                success: true,
                output: { result: "ok" },
              }),
              write_output_calls: 0,
            }),
          },
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "CAPABILITY_REQUIRED_NOT_USED");
        assert.match(result.error.message, /writeOutput/i);
        assert.equal(result.error.step_index, 0);
      }
    });

    // ── AC-F7: OUTPUT_REQUIRED_MISSING fires post-write (writeStepReport called)

    it("AC-F7 — OUTPUT_REQUIRED_MISSING fires post-write: writeStepReport IS called", async () => {
      let writeCalled = false;
      const report = validStepReport() as Record<string, unknown>;
      delete report["output"];

      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: stubRunner({ step_report: report }),
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeCalled = true;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "OUTPUT_REQUIRED_MISSING");
      }
      assert.equal(writeCalled, true, "writeStepReport must be called before OUTPUT_REQUIRED_MISSING is returned");
    });

    // ── AC-F8: CAPABILITY_REQUIRED_NOT_USED fires post-write ─────────────────

    it("AC-F8 — CAPABILITY_REQUIRED_NOT_USED fires post-write: writeStepReport IS called", async () => {
      let writeCalled = false;
      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          forge: {
            run: async () => ({
              step_report: validStepReport({ output: { result: "ok" } }),
              write_output_calls: 0,
            }),
          },
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeCalled = true;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "CAPABILITY_REQUIRED_NOT_USED");
      }
      assert.equal(writeCalled, true, "writeStepReport must be called before CAPABILITY_REQUIRED_NOT_USED is returned");
    });

    // ── AC-F9: non-required action + output absent => ok (no output requirement)

    it("AC-F9 — atlas.research (non-required action) + output absent => ok: true", async () => {
      const atlasReport: Record<string, unknown> = {
        schema_version: "1.0",
        run_id: "run-1",
        step_id: "step-a",
        step_index: 0,
        actor: "atlas",
        action: "atlas.research",
        success: true,
        status: "succeeded",
        summary: "research complete",
        artifacts: {},
        state_impact: "none",
        timestamp: "2026-01-01T00:00:00Z",
        // output intentionally absent — atlas.research is not in OUTPUT_REQUIRED_ACTIONS
      };

      const deps = stubDeps({
        runnerRegistry: fullRegistry({
          atlas: {
            run: async () => ({ step_report: atlasReport, write_output_calls: 0 }),
          },
        }),
      });

      const req = validRequest({
        steps: [
          {
            step_index: 0,
            step_id: "step-a",
            actor: "atlas",
            action: "atlas.research",
            capabilities: [],
          },
        ],
      });

      const result = await dispatchRun(req, deps);

      // atlas.research not in OUTPUT_REQUIRED_ACTIONS, no output → no error.
      // CAPABILITY check: hasOutput=false → skipped.
      assert.equal(result.ok, true);
    });

    // ── AC-F10: success=false without error => DISPATCH_STEP_REPORT_INVALID ───

    it("AC-F10 — success=false without error field => DISPATCH_STEP_REPORT_INVALID (real validator)", async () => {
      let writeCalled = false;

      // Use the real validator to confirm it catches the missing error field.
      const deps = stubDeps({
        validateStepReport: validateStepReportV1,
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: {
              schema_version: "1.0",
              run_id: "run-1",
              step_id: "step-a",
              step_index: 0,
              actor: "forge",
              action: "forge.implement",
              success: false,
              // error field intentionally absent — must be rejected
              status: "failed",
              summary: "step failed",
              artifacts: {},
              output: { result: "ok" },
              state_impact: "none",
              timestamp: "2026-01-01T00:00:00Z",
            },
          }),
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeCalled = true;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "DISPATCH_STEP_REPORT_INVALID");
      }
      assert.equal(writeCalled, false, "writeStepReport must not be called when schema validation fails");
    });

    // ── AC-F11: success=false + error present + atlas.research => ok: true ───

    it("AC-F11 — success=false + error present + atlas.research => ok: true", async () => {
      const deps = stubDeps({
        // Use real validator to confirm the object-shape error passes validation.
        validateStepReport: validateStepReportV1,
        runnerRegistry: fullRegistry({
          atlas: {
            run: async () => ({
              step_report: {
                schema_version: "1.0",
                run_id: "run-1",
                step_id: "step-a",
                step_index: 0,
                actor: "atlas",
                action: "atlas.research",
                success: false,
                error: { code: "UPSTREAM_ERROR", message: "upstream service unavailable" },
                status: "failed",
                summary: "research step failed gracefully",
                artifacts: {},
                state_impact: "none",
                timestamp: "2026-01-01T00:00:00Z",
              },
              write_output_calls: 0,
            }),
          },
        }),
      });

      const req = validRequest({
        steps: [
          {
            step_index: 0,
            step_id: "step-a",
            actor: "atlas",
            action: "atlas.research",
            capabilities: [],
          },
        ],
      });

      const result = await dispatchRun(req, deps);

      // success=false + error present is valid; atlas.research has no output requirement.
      // CAPABILITY: hasOutput=false → skipped. Governance: none → auto_apply.
      assert.equal(result.ok, true);
    });

    // ── Slice 6.1 — error mutual exclusion + object shape ─────────────────────

    // AC-F12: success=true + error present → DISPATCH_STEP_REPORT_INVALID

    it("AC-F12 — success=true + error present => DISPATCH_STEP_REPORT_INVALID (real validator)", async () => {
      const deps = stubDeps({
        validateStepReport: validateStepReportV1,
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: validStepReport({
              success: true,
              // error must be absent when success=true — should be rejected
              error: { code: "OOPS", message: "should not be here" },
            }),
          }),
        }),
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "DISPATCH_STEP_REPORT_INVALID");
        // Dispatcher wraps all validator failures with a generic message;
        // the specific "absent" text lives in the validator result, not surfaced here.
        assert.match(result.error.message, /validation/i);
      }
    });

    // AC-F13: success=false + error is a plain string → DISPATCH_STEP_REPORT_INVALID

    it("AC-F13 — success=false + error is a plain string => DISPATCH_STEP_REPORT_INVALID (real validator)", async () => {
      let writeCalled = false;
      const deps = stubDeps({
        validateStepReport: validateStepReportV1,
        runnerRegistry: fullRegistry({
          forge: stubRunner({
            step_report: {
              schema_version: "1.0",
              run_id: "run-1",
              step_id: "step-a",
              step_index: 0,
              actor: "forge",
              action: "forge.implement",
              success: false,
              error: "plain string — not an object", // wrong shape
              status: "failed",
              summary: "step failed",
              artifacts: {},
              state_impact: "none",
              timestamp: "2026-01-01T00:00:00Z",
            },
          }),
        }),
        writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
          writeCalled = true;
          return {
            ok: true as const,
            path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
          };
        },
      });

      const result = await dispatchRun(validRequest(), deps);

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "DISPATCH_STEP_REPORT_INVALID");
      }
      assert.equal(writeCalled, false, "writeStepReport must not be called when schema validation fails");
    });

    // AC-F14: success=false + error valid object { code, message } → passes

    it("AC-F14 — success=false + valid error object { code, message } => passes (real validator)", async () => {
      const deps = stubDeps({
        validateStepReport: validateStepReportV1,
        runnerRegistry: fullRegistry({
          atlas: {
            run: async () => ({
              step_report: {
                schema_version: "1.0",
                run_id: "run-1",
                step_id: "step-a",
                step_index: 0,
                actor: "atlas",
                action: "atlas.research",
                success: false,
                error: {
                  code: "TOOL_UNAVAILABLE",
                  message: "external tool timed out",
                  detail: { timeout_ms: 5000 },
                },
                status: "failed",
                summary: "research could not complete",
                artifacts: {},
                state_impact: "none",
                timestamp: "2026-01-01T00:00:00Z",
              },
              write_output_calls: 0,
            }),
          },
        }),
      });

      const req = validRequest({
        steps: [
          {
            step_index: 0,
            step_id: "step-a",
            actor: "atlas",
            action: "atlas.research",
            capabilities: [],
          },
        ],
      });

      const result = await dispatchRun(req, deps);

      // Valid error object must pass schema validation.
      // atlas.research: not in OUTPUT_REQUIRED_ACTIONS. CAPABILITY: no output → skipped.
      assert.equal(result.ok, true);
    });

  }); // end Slice 6 — Atlas §2–§8 Conformance
});
