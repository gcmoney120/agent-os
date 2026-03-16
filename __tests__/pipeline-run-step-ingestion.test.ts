/**
 * Agent OS — K2 Run Step Ingestion Tests (ingestStepReport)
 *
 * Black-box integration tests against real backend and real pipeline units.
 * No mocks or spies are used.
 *
 * Covers:
 *   - ingestRunStep failure propagated unchanged (ok:false, code, message)
 *   - success path returns ok:true with expected counts
 *   - exactly one episodic event written on success
 *   - no decision events written (episodic-only adapter invariant)
 *   - no semantic facts written (no promotion path)
 *   - context fields reach the backend unchanged
 *   - returned counts match actual backend state
 *   - sequential calls with distinct event ids produce separate events
 *   - module hygiene: no randomUUID, no new Date, no Date.now
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryK2Backend } from "../src/memory/pipeline/backend.js";
import { ingestStepReport } from "../src/memory/pipeline/run-step-ingestion.js";
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
    run_id:         "run-k2",
    step_id:        "step-uuid-k2",
    step_index:     0,
    actor:          "forge",
    action:         "forge.implement",
    status:         "succeeded",
    success:        true,
    summary:        "Wired the K2 ingestion entrypoint",
    artifacts:      {},
    state_impact:   "none",
    timestamp:      "2026-03-11T10:00:00Z",
    ...overrides,
  };
}

function makeContext(overrides?: Partial<StepReportAdapterContext>): StepReportAdapterContext {
  return {
    episodic_event_id:       "ev-k2-001",
    project_id:              "proj-k2",
    pipeline_schema_version: "1.1",
    session_id:              "sess-k2",
    occurred_at:             OCCURRED,
    created_at:              CREATED,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Failure propagation from the write pipeline
// ---------------------------------------------------------------------------

describe("ingestStepReport — pipeline failure propagation", () => {

  it("returns ok:false when the run already has a terminal event (INGEST_RUN_TERMINATED)", () => {
    const backend = new InMemoryK2Backend();

    // Write a terminal event so ingestRunStep rejects all further writes.
    backend.appendEpisodicEvent({
      id:             "terminal-ev",
      project_id:     "proj-k2",
      schema_version: "1.1",
      run_id:         "run-k2",
      session_id:     "sess-k2",
      agent_role:     "forge",
      event_type:     K2_EVENT_TYPE.RUN_FAILED,
      payload:        {},
      occurred_at:    OCCURRED,
      created_at:     CREATED,
    });

    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_RUN_TERMINATED");
  });

  it("returns ok:false with code INGEST_DUPLICATE when episodic event id already exists", () => {
    const backend = new InMemoryK2Backend();

    // Pre-write the same event id to force a duplicate.
    backend.appendEpisodicEvent({
      id:             "ev-k2-001",
      project_id:     "proj-k2",
      schema_version: "1.1",
      run_id:         "run-k2",
      session_id:     "sess-k2",
      agent_role:     "forge",
      event_type:     K2_EVENT_TYPE.STEP_SUCCEEDED,
      payload:        {},
      occurred_at:    OCCURRED,
      created_at:     CREATED,
    });

    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_DUPLICATE");
  });

  it("failure result carries a non-empty message string", () => {
    const backend = new InMemoryK2Backend();
    backend.appendEpisodicEvent({
      id:             "ev-k2-001",
      project_id:     "proj-k2",
      schema_version: "1.1",
      run_id:         "run-k2",
      session_id:     "sess-k2",
      agent_role:     "forge",
      event_type:     K2_EVENT_TYPE.STEP_SUCCEEDED,
      payload:        {},
      occurred_at:    OCCURRED,
      created_at:     CREATED,
    });

    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(typeof result.message, "string");
      assert.ok(result.message.length > 0);
    }
  });

});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe("ingestStepReport — success path", () => {

  it("returns ok:true for a valid report on a fresh backend", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, true);
  });

  it("episodicWritten is 1 for a single report", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.episodicWritten, 1);
  });

  it("decisionsWritten is 0", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.decisionsWritten, 0);
  });

  it("promotionsExecuted is 0", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.promotionsExecuted, 0);
  });

});

// ---------------------------------------------------------------------------
// Exactly one episodic event written
// ---------------------------------------------------------------------------

describe("ingestStepReport — episodic event written to backend", () => {

  it("exactly one episodic event is written on success", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(backend.snapshotEpisodicEvents().length, 1);
  });

  it("event_type is STEP_SUCCEEDED for a succeeded report", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport({ status: "succeeded", success: true }), makeContext());
    assert.equal(backend.snapshotEpisodicEvents()[0].event_type, K2_EVENT_TYPE.STEP_SUCCEEDED);
  });

  it("event_type is STEP_FAILED for a failed report", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(
      backend,
      makeReport({ status: "failed", success: false, error: { code: "ERR", message: "oops" } }),
      makeContext(),
    );
    assert.equal(backend.snapshotEpisodicEvents()[0].event_type, K2_EVENT_TYPE.STEP_FAILED);
  });

  it("run_id on written event matches report.run_id", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport({ run_id: "run-abc" }), makeContext());
    assert.equal(backend.snapshotEpisodicEvents()[0].run_id, "run-abc");
  });

});

// ---------------------------------------------------------------------------
// No decision or semantic records written
// ---------------------------------------------------------------------------

describe("ingestStepReport — no decision or semantic records written", () => {

  it("no decision events written for a standard step", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(backend.snapshotDecisionEvents().length, 0);
  });

  it("no decision events written even for a trust_change step", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(
      backend,
      makeReport({ state_impact: "trust_change", trust_notes: "Important shift" }),
      makeContext(),
    );
    assert.equal(backend.snapshotDecisionEvents().length, 0);
  });

  it("no semantic facts written", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(backend.snapshotSemanticFacts().length, 0);
  });

});

// ---------------------------------------------------------------------------
// Context fields reach the backend
// ---------------------------------------------------------------------------

describe("ingestStepReport — context fields reach the backend", () => {

  it("episodic_event_id becomes the written event id", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport(), makeContext({ episodic_event_id: "ev-check-001" }));
    assert.equal(backend.snapshotEpisodicEvents()[0].id, "ev-check-001");
  });

  it("project_id is stamped on the written event", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport(), makeContext({ project_id: "proj-z" }));
    assert.equal(backend.snapshotEpisodicEvents()[0].project_id, "proj-z");
  });

  it("pipeline_schema_version is stamped on the written event", () => {
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport(), makeContext({ pipeline_schema_version: "1.1" }));
    assert.equal(backend.snapshotEpisodicEvents()[0].schema_version, "1.1");
  });

  it("occurred_at is stamped on the written event", () => {
    const t = new Date("2026-03-11T12:30:00Z");
    const backend = new InMemoryK2Backend();
    ingestStepReport(backend, makeReport(), makeContext({ occurred_at: t }));
    assert.deepEqual(backend.snapshotEpisodicEvents()[0].occurred_at, t);
  });

});

// ---------------------------------------------------------------------------
// Returned counts match actual backend state
// ---------------------------------------------------------------------------

describe("ingestStepReport — returned counts match backend state", () => {

  it("episodicWritten matches snapshotEpisodicEvents().length", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.episodicWritten, backend.snapshotEpisodicEvents().length);
  });

  it("decisionsWritten matches snapshotDecisionEvents().length", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestStepReport(backend, makeReport(), makeContext());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.decisionsWritten, backend.snapshotDecisionEvents().length);
  });

});

// ---------------------------------------------------------------------------
// Sequential calls
// ---------------------------------------------------------------------------

describe("ingestStepReport — sequential calls", () => {

  it("two calls with distinct event ids each produce one event (two total)", () => {
    const backend = new InMemoryK2Backend();

    ingestStepReport(backend, makeReport({ run_id: "run-seq" }), makeContext({
      episodic_event_id: "ev-seq-001",
    }));
    ingestStepReport(backend, makeReport({ run_id: "run-seq" }), makeContext({
      episodic_event_id: "ev-seq-002",
    }));

    assert.equal(backend.snapshotEpisodicEvents().length, 2);
  });

  it("second call with duplicate event id returns ok:false", () => {
    const backend = new InMemoryK2Backend();

    ingestStepReport(backend, makeReport(), makeContext({ episodic_event_id: "ev-dup" }));
    const result = ingestStepReport(backend, makeReport(), makeContext({ episodic_event_id: "ev-dup" }));

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_DUPLICATE");
  });

});

// ---------------------------------------------------------------------------
// Module hygiene
// ---------------------------------------------------------------------------

describe("run-step-ingestion.ts module hygiene", () => {

  it("no ID generation in source", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src", "memory", "pipeline", "run-step-ingestion.ts"),
      "utf8",
    );
    assert.equal(src.includes("randomUUID"), false, "must not contain randomUUID");
  });

  it("no timestamp generation in source", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src", "memory", "pipeline", "run-step-ingestion.ts"),
      "utf8",
    );
    assert.equal(src.includes("Date.now"), false, "must not contain Date.now");
    assert.equal(src.includes("new Date"), false, "must not contain new Date");
  });

});
