/**
 * Agent OS v1.0 — Slice 8: Approval Artifacts + Resume Tokens.
 *
 * AC1–AC15 per Atlas spec.
 * Uses Node.js native test runner. No real filesystem — all deps stubbed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dispatchResume } from "../dispatchRun.js";
import type {
  DispatchRequestV1,
  DispatchDeps,
  FrozenStepContext,
  StepRunner,
  RunnerRegistry,
  RunnerOutput,
  ApprovalArtifact,
  ResumeRequest,
} from "../types.js";
import type { DispatchResult } from "../errors.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    state_impact: "trust_change",
    trust_notes: "promoting tier",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const STEP_REPORT_BYTES = JSON.stringify(validStepReport(), null, 2) + "\n";
const STEP_REPORT_SHA = createHash("sha256").update(STEP_REPORT_BYTES).digest("hex");

function validApproval(overrides: Partial<ApprovalArtifact> = {}): ApprovalArtifact {
  return {
    schema_version: "1",
    run_id: "run-1",
    step_index: 0,
    step_id: "step-a",
    actor: "forge",
    action: "forge.implement",
    state_impact: "trust_change",
    approved_by: "human-reviewer",
    approval_note: "Reviewed and approved",
    step_report_sha256: STEP_REPORT_SHA,
    ...overrides,
  };
}

function stubRunner(output: RunnerOutput): StepRunner {
  return { run: async () => output };
}

function fnRunner(fn: (ctx: FrozenStepContext) => Promise<RunnerOutput>): StepRunner {
  return { run: fn };
}

function fullRegistry(overrides: Partial<RunnerRegistry> = {}): RunnerRegistry {
  const defaultRunner = stubRunner({
    step_report: validStepReport({
      step_index: 1,
      step_id: "step-b",
      state_impact: "none",
    }),
  });
  return {
    command: defaultRunner,
    atlas: defaultRunner,
    forge: defaultRunner,
    sentinel: defaultRunner,
    compass: defaultRunner,
    ...overrides,
  };
}

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

/** Two-step plan: step 0 halted (trust_change), step 1 to be resumed. */
function twoPlan(): DispatchRequestV1 {
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
      {
        step_index: 1,
        step_id: "step-b",
        actor: "sentinel",
        action: "sentinel.review",
        capabilities: [],
      },
    ],
  };
}

/** Three-step plan: step 0 halted, step 1 auto, step 2 trust_change again. */
function threePlan(): DispatchRequestV1 {
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
      {
        step_index: 1,
        step_id: "step-b",
        actor: "sentinel",
        action: "sentinel.review",
        capabilities: [],
      },
      {
        step_index: 2,
        step_id: "step-c",
        actor: "forge",
        action: "forge.implement",
        capabilities: [],
      },
    ],
  };
}

function resumeReq(overrides: Partial<ResumeRequest> = {}): ResumeRequest {
  return {
    run_id: "run-1",
    step_index: 0,
    step_id: "step-a",
    ...overrides,
  };
}

/** In-memory FS for stubbed deps. */
function memFs(files: Record<string, string> = {}) {
  const store: Record<string, string> = { ...files };
  return {
    fileExists: async (path: string) => path in store,
    readFile: async (path: string) => {
      if (!(path in store)) throw new Error(`not found: ${path}`);
      return store[path];
    },
    sha256File: async (path: string) => {
      if (!(path in store)) throw new Error(`not found: ${path}`);
      return createHash("sha256").update(store[path]).digest("hex");
    },
    writeStepReport: async ({ artifacts_root, step_index, step_id }: { artifacts_root: string; step_index: number; step_id: string; step_report: unknown }) => {
      const p = `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`;
      store[p] = "{}";
      return { ok: true as const, path: p };
    },
    store,
  };
}

function stubDeps(
  fs: ReturnType<typeof memFs>,
  overrides: Partial<DispatchDeps> = {},
): DispatchDeps {
  return {
    loadProjectAdapter: async () => ({ ok: true as const, adapter: validAdapter() }),
    validateStepReport: () => ({ ok: true as const }),
    writeStepReport: fs.writeStepReport,
    fileExists: fs.fileExists,
    readFile: fs.readFile,
    sha256File: fs.sha256File,
    // K9: default resolveMemoryContext returns a minimal valid MemoryContext.
    resolveMemoryContext: async () => ({
      ok: true as const,
      context: {
        project_id: "test-project",
        run_id: "run-1",
        assembled_at: "2026-01-01T00:00:00.000Z",
        episodic: [] as [],
        decisions: [] as [],
        semantic: [] as [],
        semantic_mode: "structured_only" as const,
        item_counts: {
          episodic_included: 0, episodic_available: 0,
          decision_included: 0, decision_available: 0,
          semantic_included: 0, semantic_available: 0,
        },
        lane_states: {
          episodic: "empty" as const,
          decision: "empty" as const,
          semantic: "disabled" as const,
        },
      },
    }),
    runnerRegistry: fullRegistry(),
    ...overrides,
  };
}

// ── Approval artifact path helper ─────────────────────────────────────────────

function approvalPath(run_id: string, step_index: number, step_id: string): string {
  return `/artifacts/approvals/${step_index}-${step_id}.approval.json`;
}

function stepReportPath(step_index: number, step_id: string): string {
  return `/artifacts/steps/${step_index}-${step_id}/step-report.json`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("dispatchResume — Slice 8", () => {
  // ── AC1: No resume without approval ───────────────────────────────────────

  it("AC1 — resume without approval artifact => APPROVAL_ARTIFACT_MISSING", async () => {
    const fs = memFs({
      // Step report exists but no approval
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_ARTIFACT_MISSING");
    }
  });

  // ── AC2: Approval artifact invalid JSON ───────────────────────────────────

  it("AC2 — approval artifact is not valid JSON => APPROVAL_ARTIFACT_INVALID", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: "not valid json{{{",
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_ARTIFACT_INVALID");
    }
  });

  // ── AC3: Wrong schema_version ─────────────────────────────────────────────

  it("AC3 — approval schema_version !== '1' => APPROVAL_ARTIFACT_INVALID", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval({ schema_version: "2" as "1" })),
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_ARTIFACT_INVALID");
    }
  });

  // ── AC4: Identity mismatch — run_id ───────────────────────────────────────

  it("AC4 — approval run_id mismatch => APPROVAL_IDENTITY_MISMATCH", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval({ run_id: "wrong-run" })),
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_IDENTITY_MISMATCH");
    }
  });

  // ── AC5: Identity mismatch — actor ────────────────────────────────────────

  it("AC5 — approval actor mismatch => APPROVAL_IDENTITY_MISMATCH", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval({ actor: "atlas" })),
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_IDENTITY_MISMATCH");
    }
  });

  // ── AC6: Unknown state_impact ─────────────────────────────────────────────

  it("AC6 — unknown state_impact in approval => APPROVAL_ARTIFACT_INVALID", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval({ state_impact: "unknown_value" })),
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_ARTIFACT_INVALID");
    }
  });

  // ── AC7: Empty approved_by ────────────────────────────────────────────────

  it("AC7 — empty approved_by => APPROVAL_ARTIFACT_INVALID", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval({ approved_by: "" })),
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_ARTIFACT_INVALID");
    }
  });

  // ── AC8: Whitespace-only approval_note ────────────────────────────────────

  it("AC8 — whitespace-only approval_note => APPROVAL_ARTIFACT_INVALID", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval({ approval_note: "   " })),
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_ARTIFACT_INVALID");
    }
  });

  // ── AC9: SHA mismatch ─────────────────────────────────────────────────────

  it("AC9 — step_report_sha256 mismatch => APPROVAL_INTEGRITY_FAILED", async () => {
    const wrongSha = "a".repeat(64);
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval({ step_report_sha256: wrongSha })),
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_INTEGRITY_FAILED");
    }
  });

  // ── AC10: Step report not found ───────────────────────────────────────────

  it("AC10 — step-report.json missing => APPROVAL_REPORT_NOT_FOUND", async () => {
    // Approval exists but step report does not
    const fs = memFs({
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval()),
    });
    const deps = stubDeps(fs);

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APPROVAL_REPORT_NOT_FOUND");
    }
  });

  // ── AC11: Resume continues from correct index ─────────────────────────────

  it("AC11 — valid approval => resumes from step_index+1, returns ok", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval()),
    });

    let step1Called = false;
    const registry = fullRegistry({
      sentinel: fnRunner(async () => {
        step1Called = true;
        return {
          step_report: validStepReport({
            step_index: 1,
            step_id: "step-b",
            actor: "sentinel",
            action: "sentinel.review",
            state_impact: "none",
          }),
        };
      }),
      // Step 0 runner should NOT be called
      forge: fnRunner(async () => {
        throw new Error("step 0 runner should not be called during resume");
      }),
    });

    const deps = stubDeps(fs, { runnerRegistry: registry });

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, true, `Expected ok=true, got error: ${!result.ok ? result.error.code : "none"}`);
    assert.equal(step1Called, true, "step 1 runner must be called");
    if (result.ok) {
      assert.equal(result.written_step_reports.length, 1, "only resumed steps in written_step_reports");
      assert.equal(result.written_step_reports[0].step_index, 1);
      assert.equal(result.written_step_reports[0].step_id, "step-b");
    }
  });

  // ── AC12: Resume halts again on trust_change ──────────────────────────────

  it("AC12 — resumed step emits trust_change => DISPATCH_HALTED_GOVERNANCE again", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval()),
    });

    const registry = fullRegistry({
      sentinel: stubRunner({
        step_report: validStepReport({
          step_index: 1,
          step_id: "step-b",
          actor: "sentinel",
          action: "sentinel.review",
          state_impact: "trust_change",
          trust_notes: "another trust change",
        }),
      }),
    });

    const deps = stubDeps(fs, { runnerRegistry: registry });

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DISPATCH_HALTED_GOVERNANCE");
      assert.equal(result.error.step_index, 1);
    }
  });

  // ── AC13: No steps execute on validation failure ──────────────────────────

  it("AC13 — validation failure => no runners called, written_step_reports empty", async () => {
    // Approval with wrong SHA — step runners should never be invoked
    const wrongSha = "b".repeat(64);
    let anyRunnerCalled = false;

    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval({ step_report_sha256: wrongSha })),
    });

    const registry = fullRegistry({
      sentinel: fnRunner(async () => {
        anyRunnerCalled = true;
        return { step_report: validStepReport() };
      }),
      forge: fnRunner(async () => {
        anyRunnerCalled = true;
        return { step_report: validStepReport() };
      }),
    });

    const deps = stubDeps(fs, { runnerRegistry: registry });

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    assert.equal(anyRunnerCalled, false, "no runners must be called on validation failure");
    if (!result.ok) {
      assert.deepEqual(result.written_step_reports, []);
    }
  });

  // ── AC14: written_step_reports contains only resumed step reports ──────────

  it("AC14 — three-step plan, halt at 0, resume => written contains only steps 1+2", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval()),
    });

    const registry = fullRegistry({
      sentinel: stubRunner({
        step_report: validStepReport({
          step_index: 1,
          step_id: "step-b",
          actor: "sentinel",
          action: "sentinel.review",
          state_impact: "none",
        }),
      }),
      forge: stubRunner({
        step_report: validStepReport({
          step_index: 2,
          step_id: "step-c",
          actor: "forge",
          action: "forge.implement",
          state_impact: "none",
        }),
      }),
    });

    const deps = stubDeps(fs, { runnerRegistry: registry });

    const result = await dispatchResume(resumeReq(), threePlan(), deps);

    assert.equal(result.ok, true, `Expected ok=true, got: ${!result.ok ? result.error.code : "none"}`);
    if (result.ok) {
      assert.equal(result.written_step_reports.length, 2);
      assert.equal(result.written_step_reports[0].step_index, 1);
      assert.equal(result.written_step_reports[1].step_index, 2);
    }
  });

  // ── AC15: Adapter governance re-validated on resume ────────────────────────

  it("AC15 — governance misconfigured on resume => ADAPTER_GOVERNANCE_MISCONFIGURED", async () => {
    const fs = memFs({
      [stepReportPath(0, "step-a")]: STEP_REPORT_BYTES,
      [approvalPath("run-1", 0, "step-a")]: JSON.stringify(validApproval()),
    });

    const deps = stubDeps(fs, {
      // Return a misconfigured adapter on resume
      loadProjectAdapter: async () => ({
        ok: true as const,
        adapter: {
          name: "bad-adapter",
          governance: {
            system_state_updates: {
              mode: "manual", // wrong mode
              require_manual_approval_for: ["trust_change"],
              auto_apply_for: ["trivial"],
            },
          },
        },
      }),
    });

    const result = await dispatchResume(resumeReq(), twoPlan(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "ADAPTER_GOVERNANCE_MISCONFIGURED");
    }
  });
});
