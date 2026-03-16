/**
 * Agent OS — K2 Step Report Adapter Tests (adaptStepReport)
 *
 * Covers:
 *   - succeeded step maps to STEP_SUCCEEDED event_type
 *   - failed step maps to STEP_FAILED event_type
 *   - context fields map to correct episodic fields
 *   - report identity fields (run_id, actor, action, step_id, step_index) map correctly
 *   - payload always contains the required core fields
 *   - optional payload fields (output, metadata, tests, error, trust_notes) included only when present
 *   - result always contains exactly one episodic event
 *   - result never contains decisions
 *   - result never contains promotionContext
 *   - pipeline_schema_version is used (not report.schema_version)
 *   - all actor keys map correctly (command, atlas, forge, sentinel, compass)
 *   - all state_impact values map correctly (none, trivial, trust_change, phase_boundary)
 *   - trust_change step: no decision_event created (episodic-only invariant)
 *   - module hygiene: no ID generation, no timestamp generation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptStepReport } from "../src/memory/pipeline/step-report-adapter.js";
import { K2_EVENT_TYPE } from "../src/memory/pipeline/types.js";
import type { StepReportV1 } from "../src/step-report/stepReport.schema.js";
import type { StepReportAdapterContext } from "../src/memory/pipeline/step-report-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OCCURRED = new Date("2026-03-11T10:00:00Z");
const CREATED  = new Date("2026-03-11T10:00:01Z");

function makeReport(overrides?: Partial<StepReportV1>): StepReportV1 {
  return {
    schema_version: "1.0",
    run_id:         "run-abc",
    step_id:        "step-uuid-001",
    step_index:     0,
    actor:          "forge",
    action:         "forge.implement",
    status:         "succeeded",
    success:        true,
    summary:        "Implemented the feature",
    artifacts:      {},
    state_impact:   "none",
    timestamp:      "2026-03-11T10:00:00Z",
    ...overrides,
  };
}

function makeContext(overrides?: Partial<StepReportAdapterContext>): StepReportAdapterContext {
  return {
    episodic_event_id:       "ev-001",
    project_id:              "proj-x",
    pipeline_schema_version: "1.1",
    session_id:              "sess-001",
    occurred_at:             OCCURRED,
    created_at:              CREATED,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// event_type mapping
// ---------------------------------------------------------------------------

describe("adaptStepReport — event_type mapping", () => {

  it("succeeded status maps to STEP_SUCCEEDED", () => {
    const result = adaptStepReport(makeReport({ status: "succeeded", success: true }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].event_type, K2_EVENT_TYPE.STEP_SUCCEEDED);
  });

  it("failed status maps to STEP_FAILED", () => {
    const result = adaptStepReport(
      makeReport({ status: "failed", success: false, error: { code: "ERR", message: "bad" } }),
      makeContext(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].event_type, K2_EVENT_TYPE.STEP_FAILED);
  });

});

// ---------------------------------------------------------------------------
// context → episodic field mapping
// ---------------------------------------------------------------------------

describe("adaptStepReport — context field mapping", () => {

  it("episodic_event_id maps to episodic[0].id", () => {
    const result = adaptStepReport(makeReport(), makeContext({ episodic_event_id: "ev-xyz" }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].id, "ev-xyz");
  });

  it("project_id maps to episodic[0].project_id", () => {
    const result = adaptStepReport(makeReport(), makeContext({ project_id: "proj-zz" }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].project_id, "proj-zz");
  });

  it("pipeline_schema_version maps to episodic[0].schema_version (not report.schema_version)", () => {
    const result = adaptStepReport(makeReport(), makeContext({ pipeline_schema_version: "1.1" }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].schema_version, "1.1");
    assert.notEqual(result.input.episodic[0].schema_version, "1.0");
  });

  it("session_id maps to episodic[0].session_id", () => {
    const result = adaptStepReport(makeReport(), makeContext({ session_id: "sess-abc" }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].session_id, "sess-abc");
  });

  it("occurred_at maps to episodic[0].occurred_at", () => {
    const t = new Date("2026-03-11T12:00:00Z");
    const result = adaptStepReport(makeReport(), makeContext({ occurred_at: t }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.input.episodic[0].occurred_at, t);
  });

  it("created_at maps to episodic[0].created_at", () => {
    const t = new Date("2026-03-11T12:00:05Z");
    const result = adaptStepReport(makeReport(), makeContext({ created_at: t }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.input.episodic[0].created_at, t);
  });

});

// ---------------------------------------------------------------------------
// report identity fields → episodic field mapping
// ---------------------------------------------------------------------------

describe("adaptStepReport — report identity field mapping", () => {

  it("report.run_id maps to episodic[0].run_id", () => {
    const result = adaptStepReport(makeReport({ run_id: "run-999" }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].run_id, "run-999");
  });

  it("report.actor maps to episodic[0].agent_role", () => {
    const result = adaptStepReport(makeReport({ actor: "sentinel" }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].agent_role, "sentinel");
  });

});

// ---------------------------------------------------------------------------
// payload — required core fields
// ---------------------------------------------------------------------------

describe("adaptStepReport — payload core fields", () => {

  it("payload always contains step_id", () => {
    const result = adaptStepReport(makeReport({ step_id: "step-uuid-007" }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].payload.step_id, "step-uuid-007");
  });

  it("payload always contains step_index", () => {
    const result = adaptStepReport(makeReport({ step_index: 3 }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].payload.step_index, 3);
  });

  it("payload always contains action", () => {
    const result = adaptStepReport(makeReport({ action: "sentinel.review" }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].payload.action, "sentinel.review");
  });

  it("payload always contains state_impact", () => {
    const result = adaptStepReport(makeReport({ state_impact: "trivial" }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].payload.state_impact, "trivial");
  });

  it("payload always contains summary", () => {
    const result = adaptStepReport(makeReport({ summary: "Step done" }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].payload.summary, "Step done");
  });

  it("payload always contains artifacts", () => {
    const arts = { result_path: "out/result.json" };
    const result = adaptStepReport(makeReport({ artifacts: arts }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.input.episodic[0].payload.artifacts, arts);
  });

});

// ---------------------------------------------------------------------------
// payload — optional fields included only when present
// ---------------------------------------------------------------------------

describe("adaptStepReport — payload optional fields", () => {

  it("output included in payload when present", () => {
    const result = adaptStepReport(makeReport({ output: { files: 3 } }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.input.episodic[0].payload.output, { files: 3 });
  });

  it("output absent from payload when not present on report", () => {
    const report = makeReport();
    delete (report as unknown as Record<string, unknown>).output;
    const result = adaptStepReport(report, makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal("output" in result.input.episodic[0].payload, false);
  });

  it("metadata included in payload when present", () => {
    const result = adaptStepReport(makeReport({ metadata: { env: "ci" } }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.input.episodic[0].payload.metadata, { env: "ci" });
  });

  it("metadata absent from payload when not present on report", () => {
    const result = adaptStepReport(makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal("metadata" in result.input.episodic[0].payload, false);
  });

  it("tests included in payload when present", () => {
    const result = adaptStepReport(makeReport({ tests: { passed: 10, total: 10 } }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.input.episodic[0].payload.tests, { passed: 10, total: 10 });
  });

  it("tests absent from payload when not present on report", () => {
    const result = adaptStepReport(makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal("tests" in result.input.episodic[0].payload, false);
  });

  it("error included in payload for failed step", () => {
    const err = { code: "BUILD_FAILED", message: "compile error" };
    const result = adaptStepReport(
      makeReport({ status: "failed", success: false, error: err }),
      makeContext(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.input.episodic[0].payload.error, err);
  });

  it("error absent from payload for succeeded step (no error field)", () => {
    const result = adaptStepReport(makeReport({ status: "succeeded", success: true }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal("error" in result.input.episodic[0].payload, false);
  });

  it("trust_notes included in payload when present", () => {
    const result = adaptStepReport(
      makeReport({ state_impact: "trust_change", trust_notes: "Elevated sentinel trust" }),
      makeContext(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic[0].payload.trust_notes, "Elevated sentinel trust");
  });

  it("trust_notes absent from payload when not present on report", () => {
    const result = adaptStepReport(makeReport({ state_impact: "none" }), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal("trust_notes" in result.input.episodic[0].payload, false);
  });

});

// ---------------------------------------------------------------------------
// output shape invariants
// ---------------------------------------------------------------------------

describe("adaptStepReport — output shape invariants", () => {

  it("result always contains exactly one episodic event", () => {
    const result = adaptStepReport(makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.episodic.length, 1);
  });

  it("result never contains decisions", () => {
    const result = adaptStepReport(makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.decisions, undefined);
  });

  it("result never contains promotionContext", () => {
    const result = adaptStepReport(makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.promotionContext, undefined);
  });

  it("trust_change step: still no decisions (episodic-only invariant)", () => {
    const result = adaptStepReport(
      makeReport({ state_impact: "trust_change", trust_notes: "Major shift" }),
      makeContext(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.decisions, undefined);
    assert.equal(result.input.episodic.length, 1);
  });

});

// ---------------------------------------------------------------------------
// all actor keys
// ---------------------------------------------------------------------------

describe("adaptStepReport — all actor keys map correctly", () => {

  for (const actor of ["command", "atlas", "forge", "sentinel", "compass"] as const) {
    it(`actor "${actor}" maps to agent_role "${actor}"`, () => {
      const result = adaptStepReport(makeReport({ actor }), makeContext());
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.input.episodic[0].agent_role, actor);
    });
  }

});

// ---------------------------------------------------------------------------
// all state_impact values
// ---------------------------------------------------------------------------

describe("adaptStepReport — all state_impact values map correctly", () => {

  for (const state_impact of ["none", "trivial", "trust_change", "phase_boundary"] as const) {
    it(`state_impact "${state_impact}" carried into payload`, () => {
      const report = state_impact === "trust_change"
        ? makeReport({ state_impact, trust_notes: "required" })
        : makeReport({ state_impact });
      const result = adaptStepReport(report, makeContext());
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.input.episodic[0].payload.state_impact, state_impact);
    });
  }

});

// ---------------------------------------------------------------------------
// module hygiene
// ---------------------------------------------------------------------------

describe("step-report-adapter.ts module hygiene", () => {

  it("no ID generation in source", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src", "memory", "pipeline", "step-report-adapter.ts"),
      "utf8",
    );
    assert.equal(src.includes("crypto.randomUUID"), false, "must not contain crypto.randomUUID");
    assert.equal(src.includes("randomUUID"),        false, "must not contain randomUUID");
  });

  it("no timestamp generation in source", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src", "memory", "pipeline", "step-report-adapter.ts"),
      "utf8",
    );
    assert.equal(src.includes("Date.now"),  false, "must not contain Date.now");
    assert.equal(src.includes("new Date"),  false, "must not contain new Date");
  });

});
