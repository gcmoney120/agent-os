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

/** A minimal valid StepReportV1-shaped object that passes Slice 2 validation. */
function validStepReport(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: "1.0",
    run_id: "run-1",
    step_id: "step-a",
    step_index: 0,
    actor: "forge",
    action: "forge.implement",
    status: "succeeded",
    summary: "done",
    artifacts: {},
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
    (registry as Record<string, unknown>).sentinel = undefined;

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
        error: "bad report",
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
          (ctx as Record<string, unknown>).step_id = "x";
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
});
