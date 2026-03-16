/**
 * Agent OS — K11 Foreman Artifact Adapter — Acceptance Tests
 *
 * Slice: K11 — Run Ingest Adapter (Foreman → K2)
 *
 * Locked Atlas acceptance criteria under test:
 *
 *   AC-K11-01 — Given a valid K10+ artifact sequence (run.started, one or more
 *               step.started/step.succeeded/step.failed, terminal event),
 *               adaptForeman returns ok: true with a well-formed RunIngestInput.
 *
 *   AC-K11-02 — Given a step.started artifact with no step_schema_version,
 *               adaptForeman returns ok: false with ADAPTER_STEP_SCHEMA_VERSION_MISSING.
 *
 *   AC-K11-03 — Given a step.started artifact with step_schema_version set to any
 *               value other than "k10", adaptForeman returns ok: false with
 *               ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN.
 *
 *   AC-K11-04 — Given an artifact with an unrecognized event type, adaptForeman
 *               returns ok: false with ADAPTER_UNKNOWN_EVENT_TYPE.
 *
 *   AC-K11-05 — Given a malformed artifact missing a required field (e.g. run_id),
 *               adaptForeman returns ok: false with ADAPTER_MISSING_REQUIRED_FIELD.
 *
 *   AC-K11-06 — adaptForeman does not call runIngest when it returns ok: false.
 *               (Structural: adaptForeman never calls runIngest internally —
 *               verified by design + ok: false result shape inspection.)
 *
 *   AC-K11-07 — memory_context_hash from a K10+ step.started artifact is present
 *               in the corresponding episodic payload field; it is absent if not
 *               present on the artifact.
 *
 *   AC-K11-08 — Artifact order in input maps to the same order in
 *               RunIngestInput.episodic.
 *
 *   AC-K11-09 — No K1–K10 contract is modified. Verified by import-boundary
 *               check: artifact-adapter.ts imports only from types.ts and
 *               run-ingest.ts (types only) — no dispatcher files modified.
 *
 *   AC-K11-10 — All existing K2 and K10 tests continue to pass without
 *               modification. (Verified by running the full suite.)
 *
 * INV-K11-01 — Stateless: verified by calling adaptForeman twice with
 *              different inputs and confirming independent results.
 *
 * INV-K11-03 — Fail-closed on schema version: null, undefined, numeric,
 *              pre-K10 string, future string — all rejected.
 *
 * Uses Node.js native test runner. No real filesystem. No live K2 dependency.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptForeman } from "../../memory/pipeline/artifact-adapter.js";
import type { ForemanArtifact } from "../../memory/pipeline/artifact-adapter.js";
import { K2_EVENT_TYPE } from "../../memory/pipeline/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_HASH = "a1b2c3d4e5f6".repeat(5) + "a1b2";

const BASE_CONTEXT = {
  project_id:              "proj-k11",
  pipeline_schema_version: "1.1",
  session_id:              "sess-k11",
} as const;

function runStarted(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:    "run.started",
    id:      "evt-run-started",
    run_id:  "run-k11",
    ts:      "2026-01-01T00:00:00.000Z",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function stepStarted(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:                 "step.started",
    id:                   "evt-step-started",
    run_id:               "run-k11",
    ts:                   "2026-01-01T00:00:01.000Z",
    actor:                "forge",
    step_id:              "step-k11",
    step_index:           0,
    action:               "forge.implement",
    step_schema_version:  "k10",
    memory_context_hash:  VALID_HASH,
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function stepSucceeded(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:       "step.succeeded",
    id:         "evt-step-succeeded",
    run_id:     "run-k11",
    ts:         "2026-01-01T00:00:02.000Z",
    actor:      "forge",
    step_id:    "step-k11",
    step_index: 0,
    action:     "forge.implement",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function stepFailed(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:       "step.failed",
    id:         "evt-step-failed",
    run_id:     "run-k11",
    ts:         "2026-01-01T00:00:02.000Z",
    actor:      "forge",
    step_id:    "step-k11",
    step_index: 0,
    action:     "forge.implement",
    reason:     "EXECUTOR_EXCEPTION",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function runSucceeded(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:   "run.succeeded",
    id:     "evt-run-succeeded",
    run_id: "run-k11",
    ts:     "2026-01-01T00:00:03.000Z",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function runFailed(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:   "run.failed",
    id:     "evt-run-failed",
    run_id: "run-k11",
    ts:     "2026-01-01T00:00:03.000Z",
    reason: "STEP_FAILED",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

// ── AC-K11-01: Valid K10+ sequences → ok: true ────────────────────────────────

describe("K11 — AC-K11-01: valid K10+ artifact sequence", () => {

  it("minimal complete sequence: run.started → step.started → step.succeeded → run.succeeded", () => {
    const result = adaptForeman([
      runStarted(),
      stepStarted(),
      stepSucceeded(),
      runSucceeded(),
    ]);

    assert.equal(result.ok, true, "valid sequence must return ok: true");
    if (!result.ok) return;

    assert.ok(result.ingestInput, "ingestInput must be present");
    assert.ok(Array.isArray(result.ingestInput.episodic), "episodic must be an array");
    assert.equal(result.ingestInput.episodic.length, 4, "must produce 4 episodic inputs");
  });

  it("sequence with step.failed terminal: run.started → step.started → step.failed → run.failed", () => {
    const result = adaptForeman([
      runStarted(),
      stepStarted(),
      stepFailed(),
      runFailed(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic.length, 4);
  });

  it("multi-step sequence: run.started → [step.started + step.succeeded] × 2 → run.succeeded", () => {
    const result = adaptForeman([
      runStarted(),
      stepStarted({ id: "evt-s0-started", step_id: "step-0", step_index: 0 }),
      stepSucceeded({ id: "evt-s0-succeeded", step_id: "step-0", step_index: 0 }),
      stepStarted({ id: "evt-s1-started", step_id: "step-1", step_index: 1 }),
      stepSucceeded({ id: "evt-s1-succeeded", step_id: "step-1", step_index: 1 }),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic.length, 6);
  });

  it("run-only sequence (no steps): run.started → run.failed", () => {
    const result = adaptForeman([runStarted(), runFailed()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic.length, 2);
  });

  it("event_type values are correctly mapped from Foreman artifact types", () => {
    const result = adaptForeman([
      runStarted(),
      stepStarted(),
      stepSucceeded(),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const types = result.ingestInput.episodic.map((e) => e.event_type);
    assert.equal(types[0], K2_EVENT_TYPE.RUN_STARTED);
    assert.equal(types[1], K2_EVENT_TYPE.STEP_STARTED);
    assert.equal(types[2], K2_EVENT_TYPE.STEP_SUCCEEDED);
    assert.equal(types[3], K2_EVENT_TYPE.RUN_SUCCEEDED);
  });

  it("identity fields are correctly extracted into episodic records", () => {
    const result = adaptForeman([runStarted(), stepStarted(), runSucceeded()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const first = result.ingestInput.episodic[0];
    assert.equal(first.id,             "evt-run-started");
    assert.equal(first.run_id,         "run-k11");
    assert.equal(first.project_id,     "proj-k11");
    assert.equal(first.schema_version, "1.1");
    assert.equal(first.session_id,     "sess-k11");
  });

  it("occurred_at and created_at are parsed from artifact.ts", () => {
    const result = adaptForeman([runStarted(), runSucceeded()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const ev = result.ingestInput.episodic[0];
    assert.ok(ev.occurred_at instanceof Date, "occurred_at must be a Date");
    assert.ok(ev.created_at  instanceof Date, "created_at must be a Date");
    assert.equal(ev.occurred_at.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(ev.created_at.toISOString(),  "2026-01-01T00:00:00.000Z");
  });

  it("agent_role is 'system' for run-level artifacts without actor", () => {
    const result = adaptForeman([runStarted(), runSucceeded()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic[0].agent_role, "system");
    assert.equal(result.ingestInput.episodic[1].agent_role, "system");
  });

  it("agent_role is the actor value for step artifacts", () => {
    const result = adaptForeman([runStarted(), stepStarted({ actor: "sentinel" }), runSucceeded()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic[1].agent_role, "sentinel");
  });

});

// ── AC-K11-02: step.started missing step_schema_version ──────────────────────

describe("K11 — AC-K11-02: step.started without step_schema_version", () => {

  it("step.started with step_schema_version omitted → ADAPTER_STEP_SCHEMA_VERSION_MISSING", () => {
    const artifact = stepStarted();
    // Remove step_schema_version to simulate missing field.
    const { step_schema_version: _omit, ...rest } = artifact;
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_MISSING");
    assert.ok(result.detail.includes("step.started"), "detail must reference step.started");
  });

  it("step.started with step_schema_version: undefined → ADAPTER_STEP_SCHEMA_VERSION_MISSING", () => {
    const result = adaptForeman([
      runStarted(),
      stepStarted({ step_schema_version: undefined }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_MISSING");
  });

  it("step.started with step_schema_version: null → ADAPTER_STEP_SCHEMA_VERSION_MISSING", () => {
    const result = adaptForeman([
      runStarted(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stepStarted({ step_schema_version: null as any }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_MISSING");
  });

});

// ── AC-K11-03: step.started with unrecognized step_schema_version ─────────────

describe("K11 — AC-K11-03: step.started with step_schema_version !== 'k10'", () => {

  it("step_schema_version: 'k9' (pre-K10) → ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN", () => {
    const result = adaptForeman([runStarted(), stepStarted({ step_schema_version: "k9" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN");
    assert.ok(result.detail.includes("k9"), "detail must include the rejected version");
  });

  it("step_schema_version: 'k11' (future, not yet accepted) → ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN", () => {
    const result = adaptForeman([runStarted(), stepStarted({ step_schema_version: "k11" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN");
  });

  it("step_schema_version: '' (empty string) → ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN", () => {
    const result = adaptForeman([runStarted(), stepStarted({ step_schema_version: "" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN");
  });

  it("step_schema_version: 'K10' (wrong case) → ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN", () => {
    const result = adaptForeman([runStarted(), stepStarted({ step_schema_version: "K10" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN");
  });

  it("step_schema_version: numeric 10 → ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN", () => {
    const result = adaptForeman([runStarted(), stepStarted({ step_schema_version: 10 })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN");
  });

  it("step_schema_version: 'unknown-future-version' → ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN", () => {
    const result = adaptForeman([runStarted(), stepStarted({ step_schema_version: "unknown-future-version" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN");
  });

});

// ── AC-K11-04: Unrecognized event type → ADAPTER_UNKNOWN_EVENT_TYPE ───────────

describe("K11 — AC-K11-04: unrecognized event type", () => {

  it("completely unknown event type 'step.pending' → ADAPTER_UNKNOWN_EVENT_TYPE", () => {
    const result = adaptForeman([
      runStarted(),
      { ...stepStarted(), type: "step.pending" },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_UNKNOWN_EVENT_TYPE");
    assert.ok(result.detail.includes("step.pending"), "detail must include the unknown type");
  });

  it("'GOVERNANCE_DECISION' (deferred type, not K11 recognized) → ADAPTER_UNKNOWN_EVENT_TYPE", () => {
    const result = adaptForeman([
      runStarted(),
      { ...runFailed(), type: "GOVERNANCE_DECISION" },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_UNKNOWN_EVENT_TYPE");
  });

  it("empty string event type → ADAPTER_UNKNOWN_EVENT_TYPE", () => {
    const result = adaptForeman([{ ...runStarted(), type: "" }]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_UNKNOWN_EVENT_TYPE");
  });

  it("unknown type at position 0 fails immediately — no processing of later artifacts", () => {
    // Confirms fail-closed behavior and full-validation-first (INV-K11-04)
    const result = adaptForeman([
      { ...runStarted(), type: "bad.type" },
      stepStarted(),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_UNKNOWN_EVENT_TYPE");
    assert.ok(result.detail.includes("artifact[0]"));
  });

});

// ── AC-K11-05: Missing required field → ADAPTER_MISSING_REQUIRED_FIELD ────────

describe("K11 — AC-K11-05: malformed artifact missing required field", () => {

  it("run.started missing run_id → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { run_id: _omit, ...rest } = runStarted();
    const result = adaptForeman([rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("run_id"), "detail must name the missing field");
  });

  it("run.started missing id → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { id: _omit, ...rest } = runStarted();
    const result = adaptForeman([rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes('"id"'));
  });

  it("run.started missing project_id → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { project_id: _omit, ...rest } = runStarted();
    const result = adaptForeman([rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("project_id"));
  });

  it("run.started missing ts → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { ts: _omit, ...rest } = runStarted();
    const result = adaptForeman([rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes('"ts"'));
  });

  it("step.succeeded missing step_id → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { step_id: _omit, ...rest } = stepSucceeded();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("step_id"), "detail must name the missing step field");
  });

  it("step.succeeded missing actor → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { actor: _omit, ...rest } = stepSucceeded();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("actor"));
  });

  it("step.started missing step_index → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { step_index: _omit, ...rest } = stepStarted();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("step_index"));
  });

  it("empty string run_id → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const result = adaptForeman([runStarted({ run_id: "" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
  });

});

// ── AC-K11-06: runIngest is never called on ok: false ────────────────────────

describe("K11 — AC-K11-06: runIngest not called when adaptation fails", () => {

  it("on ok: false the result shape has code and detail — no ingestInput present", () => {
    // adaptForeman never calls runIngest internally; it only returns the
    // ingestInput for the caller to pass. This test verifies the return shape.
    const result = adaptForeman([runStarted(), stepStarted({ step_schema_version: "k9" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    // ok: false result must not have ingestInput
    assert.ok(!("ingestInput" in result), "failed result must not contain ingestInput");
    assert.equal(typeof result.code, "string");
    assert.equal(typeof result.detail, "string");
  });

  it("on ok: true the result shape has ingestInput and no error fields", () => {
    const result = adaptForeman([runStarted(), runSucceeded()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok("ingestInput" in result, "success result must contain ingestInput");
    assert.ok(!("code" in result), "success result must not contain code");
    assert.ok(!("detail" in result), "success result must not contain detail");
  });

});

// ── AC-K11-07: memory_context_hash forwarded into episodic payload ────────────

describe("K11 — AC-K11-07: memory_context_hash handling in step.started", () => {

  it("memory_context_hash present on K10+ step.started → present in episodic payload", () => {
    const result = adaptForeman([
      runStarted(),
      stepStarted({ memory_context_hash: VALID_HASH }),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const stepStartedInput = result.ingestInput.episodic[1];
    assert.equal(stepStartedInput.event_type, K2_EVENT_TYPE.STEP_STARTED,
      "episodic[1] must be STEP_STARTED");
    assert.equal(
      stepStartedInput.payload["memory_context_hash"],
      VALID_HASH,
      "memory_context_hash must be forwarded into payload",
    );
  });

  it("memory_context_hash absent from K10+ step.started → absent from episodic payload", () => {
    const { memory_context_hash: _omit, ...artifactWithoutHash } = stepStarted();
    const result = adaptForeman([
      runStarted(),
      artifactWithoutHash as ForemanArtifact,
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const stepStartedInput = result.ingestInput.episodic[1];
    assert.ok(
      !("memory_context_hash" in stepStartedInput.payload),
      "memory_context_hash must be absent from payload when not on artifact",
    );
  });

  it("step_schema_version is also forwarded into the step.started episodic payload", () => {
    const result = adaptForeman([runStarted(), stepStarted(), runSucceeded()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const stepStartedInput = result.ingestInput.episodic[1];
    assert.equal(
      stepStartedInput.payload["step_schema_version"],
      "k10",
      "step_schema_version must be forwarded into payload",
    );
  });

  it("memory_context_hash on a non-step.started artifact is forwarded as a generic payload field", () => {
    // Only step.started carries step_schema_version enforcement;
    // other artifact types forward all fields generically.
    const result = adaptForeman([
      runStarted({ memory_context_hash: "some-value" }),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(
      result.ingestInput.episodic[0].payload["memory_context_hash"],
      "some-value",
    );
  });

});

// ── AC-K11-08: Artifact order preserved in episodic array ────────────────────

describe("K11 — AC-K11-08: input artifact order preserved in episodic output", () => {

  it("5-event sequence: event IDs appear in episodic in the same order", () => {
    const result = adaptForeman([
      runStarted({   id: "id-0" }),
      stepStarted({ id: "id-1" }),
      stepSucceeded({ id: "id-2" }),
      stepStarted({ id: "id-3", step_id: "step-1", step_index: 1 }),
      stepFailed({ id: "id-4", step_id: "step-1", step_index: 1 }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const ids = result.ingestInput.episodic.map((e) => e.id);
    assert.deepEqual(ids, ["id-0", "id-1", "id-2", "id-3", "id-4"],
      "episodic IDs must appear in the same order as input artifacts");
  });

  it("event_type sequence matches artifact type sequence exactly", () => {
    const result = adaptForeman([
      runStarted(),
      stepStarted(),
      stepFailed(),
      runFailed(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const eventTypes = result.ingestInput.episodic.map((e) => e.event_type);
    assert.deepEqual(eventTypes, [
      K2_EVENT_TYPE.RUN_STARTED,
      K2_EVENT_TYPE.STEP_STARTED,
      K2_EVENT_TYPE.STEP_FAILED,
      K2_EVENT_TYPE.RUN_FAILED,
    ]);
  });

  it("single-artifact sequence produces exactly one episodic input", () => {
    const result = adaptForeman([runStarted()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic.length, 1);
    assert.equal(result.ingestInput.episodic[0].event_type, K2_EVENT_TYPE.RUN_STARTED);
  });

});

// ── Sequence validation (ADAPTER_ARTIFACT_SEQUENCE_INVALID) ───────────────────

describe("K11 — ADAPTER_ARTIFACT_SEQUENCE_INVALID", () => {

  it("step.started at position 0 without preceding run.started → ADAPTER_ARTIFACT_SEQUENCE_INVALID", () => {
    const result = adaptForeman([stepStarted()]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_ARTIFACT_SEQUENCE_INVALID");
    assert.ok(result.detail.includes("step.started"));
  });

  it("step.succeeded before run.started → ADAPTER_ARTIFACT_SEQUENCE_INVALID", () => {
    const result = adaptForeman([stepSucceeded()]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_ARTIFACT_SEQUENCE_INVALID");
  });

  it("step.failed before run.started → ADAPTER_ARTIFACT_SEQUENCE_INVALID", () => {
    const result = adaptForeman([stepFailed()]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_ARTIFACT_SEQUENCE_INVALID");
  });

  it("run.succeeded before run.started is valid (terminal without steps)", () => {
    // run.succeeded and run.failed are not in STEP_ARTIFACT_TYPES
    const result = adaptForeman([runSucceeded()]);
    assert.equal(result.ok, true);
  });

});

// ── INV-K11-01: Statelessness ─────────────────────────────────────────────────

describe("K11 — INV-K11-01: adapter is stateless", () => {

  it("two sequential calls with different inputs produce independent results", () => {
    const first = adaptForeman([runStarted({ run_id: "run-first" }), runSucceeded({ run_id: "run-first" })]);
    const second = adaptForeman([runStarted({ run_id: "run-second" }), runFailed({ run_id: "run-second" })]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;

    assert.equal(first.ingestInput.episodic[0].run_id, "run-first");
    assert.equal(second.ingestInput.episodic[0].run_id, "run-second");
    // No cross-contamination between calls.
    assert.notEqual(
      first.ingestInput.episodic[1].event_type,
      second.ingestInput.episodic[1].event_type,
      "terminal event types must differ between runs (RUN_SUCCEEDED vs RUN_FAILED)",
    );
  });

  it("a failing call does not affect a subsequent successful call", () => {
    const failing = adaptForeman([stepStarted()]); // no preceding run.started
    assert.equal(failing.ok, false);

    const succeeding = adaptForeman([runStarted(), runSucceeded()]);
    assert.equal(succeeding.ok, true);
  });

});

// ── INV-K11-03: Fail-closed — validation before normalization ─────────────────

describe("K11 — INV-K11-04: full validation before any normalization", () => {

  it("error in later artifact returns error before any normalization runs", () => {
    // artifact[2] has a bad step_schema_version.
    // Validation must catch it before producing any ingestInput.
    const result = adaptForeman([
      runStarted(),
      stepStarted({ id: "id-1" }),         // valid
      stepStarted({ id: "id-2", step_schema_version: "k9" }),  // invalid
      runSucceeded(),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN");
    // No ingestInput present.
    assert.ok(!("ingestInput" in result));
  });

  it("error reported at the correct artifact index", () => {
    const result = adaptForeman([
      runStarted(),                  // [0] valid
      stepStarted(),                 // [1] valid
      stepSucceeded(),               // [2] valid
      runFailed({ run_id: "" }),     // [3] empty run_id → ADAPTER_MISSING_REQUIRED_FIELD
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("artifact[3]"), "detail must reference artifact[3]");
  });

});

// ── Payload forwarding ────────────────────────────────────────────────────────

describe("K11 — payload forwarding", () => {

  it("step artifact fields (step_id, step_index, actor, action) forwarded into payload", () => {
    const result = adaptForeman([
      runStarted(),
      stepSucceeded({ step_id: "my-step", step_index: 3, actor: "compass", action: "compass.validate" }),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const ev = result.ingestInput.episodic[1];
    assert.equal(ev.payload["step_id"],    "my-step");
    assert.equal(ev.payload["step_index"], 3);
    assert.equal(ev.payload["actor"],      "compass");
    assert.equal(ev.payload["action"],     "compass.validate");
  });

  it("identity fields are NOT duplicated in payload", () => {
    const result = adaptForeman([runStarted(), runSucceeded()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const ev = result.ingestInput.episodic[0];
    // These are promoted to top-level fields and must NOT appear in payload.
    assert.ok(!("id"                      in ev.payload), "id must not be in payload");
    assert.ok(!("run_id"                  in ev.payload), "run_id must not be in payload");
    assert.ok(!("project_id"              in ev.payload), "project_id must not be in payload");
    assert.ok(!("pipeline_schema_version" in ev.payload), "pipeline_schema_version must not be in payload");
    assert.ok(!("session_id"              in ev.payload), "session_id must not be in payload");
    assert.ok(!("ts"                      in ev.payload), "ts must not be in payload");
    assert.ok(!("type"                    in ev.payload), "type must not be in payload");
  });

  it("extra artifact fields are forwarded verbatim into payload", () => {
    const result = adaptForeman([
      runStarted({ custom_field: "custom-value", numeric_field: 42 }),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const ev = result.ingestInput.episodic[0];
    assert.equal(ev.payload["custom_field"],  "custom-value");
    assert.equal(ev.payload["numeric_field"], 42);
  });

  it("run.failed reason field is forwarded into payload", () => {
    const result = adaptForeman([
      runStarted(),
      runFailed({ reason: "INCOMPLETE_STEP_RECOVERY_REQUIRED" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const terminalEv = result.ingestInput.episodic[1];
    assert.equal(terminalEv.payload["reason"], "INCOMPLETE_STEP_RECOVERY_REQUIRED");
  });

});
