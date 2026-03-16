/**
 * Agent OS — K13 Capability-Used Adapter — Acceptance Tests
 *
 * Slice: K13 — Capability-Used Adapter (Foreman → K2)
 *
 * Locked Atlas acceptance criteria under test:
 *
 *   AC-K13-01 — capability.used with all valid required fields + preceding
 *               run.started → ok: true, one CAPABILITY_USED episodic, no decisions.
 *
 *   AC-K13-02 — capability.used before run.started → ok: false,
 *               ADAPTER_ARTIFACT_SEQUENCE_INVALID.
 *
 *   AC-K13-03 — capability.used missing any required field (step_id,
 *               capability_id, invocation_id, actor_role, occurred_at)
 *               → ok: false, ADAPTER_MISSING_REQUIRED_FIELD, detail names field.
 *
 *   AC-K13-04 — capability.used with promote_to_semantic: true → ok: true,
 *               episodic-only, no decisions (INV-K13-03).
 *
 *   AC-K13-05 — Required fields forwarded verbatim into episodic payload:
 *               step_id, capability_id, invocation_id, actor_role, occurred_at.
 *
 *   AC-K13-06 — Optional fields (outcome, evidence) forwarded when present.
 *
 *   AC-K13-07 — Optional fields absent from payload when not supplied.
 *
 *   AC-K13-08 — Mixed sequence (run lifecycle + capability.used) → ok: true,
 *               all events in episodic in input order (INV-K13-06).
 *
 *   AC-K13-09 — capability.used produces no decision regardless of any fields.
 *
 *   AC-K13-10 — Adapter remains stateless across calls (INV-K13-01).
 *
 *   AC-K13-11 — Identity fields (id, run_id, project_id, pipeline_schema_version,
 *               session_id, ts, type) are not present in episodic payload bag.
 *
 *   AC-K13-12 — agent_role on episodic is derived from actor_role on artifact.
 *
 *   AC-K13-13 — Base required fields (id, run_id, project_id,
 *               pipeline_schema_version, session_id, ts) still validated for
 *               capability.used (existing INV-K11-02 base field rule).
 *
 *   AC-K13-14 — Multiple capability.used artifacts in one sequence → all
 *               produce CAPABILITY_USED episodic entries in input order.
 *
 * INV-K13-02 — capability.used is episodic-only; no decision output.
 * INV-K13-03 — promote_to_semantic ignored for capability.used.
 * INV-K13-04 — Fail-closed on missing required fields.
 * INV-K13-05 — capability.used requires preceding run.started.
 * INV-K13-06 — Artifact ordering preserved.
 * INV-K13-07 — No ID or timestamp generation.
 * INV-K13-08 — adaptForeman signature unchanged.
 *
 * Uses Node.js native test runner. No real filesystem. No live K2 dependency.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptForeman } from "../artifact-adapter.js";
import type { ForemanArtifact } from "../artifact-adapter.js";
import { K2_EVENT_TYPE } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CONTEXT = {
  project_id:              "proj-k13",
  pipeline_schema_version: "1.1",
  session_id:              "sess-k13",
} as const;

function runStarted(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:   "run.started",
    id:     "evt-run-started",
    run_id: "run-k13",
    ts:     "2026-01-01T00:00:00.000Z",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function runSucceeded(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:   "run.succeeded",
    id:     "evt-run-succeeded",
    run_id: "run-k13",
    ts:     "2026-01-01T00:01:00.000Z",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function capabilityUsed(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:          "capability.used",
    id:            "evt-cap-used",
    run_id:        "run-k13",
    ts:            "2026-01-01T00:00:30.000Z",
    step_id:       "step-001",
    capability_id: "write_output",
    invocation_id: "inv-abc123",
    actor_role:    "forge",
    occurred_at:   "2026-01-01T00:00:30.000Z",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

// ── AC-K13-01: valid capability.used after run.started ────────────────────────

describe("K13 — AC-K13-01: valid capability.used produces CAPABILITY_USED episodic", () => {

  it("produces ok: true", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true);
  });

  it("produces exactly one episodic entry per capability.used artifact", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // run.started + capability.used = 2 episodic entries
    assert.equal(result.ingestInput.episodic.length, 2);
  });

  it("episodic event_type for capability.used is CAPABILITY_USED", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].event_type, K2_EVENT_TYPE.CAPABILITY_USED);
  });

  it("produces no decisions (INV-K13-02)", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false, "capability.used must never produce a decision input");
  });

  it("episodic identity fields match artifact", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ id: "cap-evt-id", run_id: "run-k13" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ep = result.ingestInput.episodic[1];
    assert.equal(ep.id,         "cap-evt-id");
    assert.equal(ep.run_id,     "run-k13");
    assert.equal(ep.project_id, "proj-k13");
    assert.equal(ep.schema_version, "1.1");
    assert.equal(ep.session_id, "sess-k13");
  });

  it("episodic occurred_at and created_at are parsed from artifact ts", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ ts: "2026-06-15T09:00:00.000Z" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ep = result.ingestInput.episodic[1];
    assert.ok(ep.occurred_at instanceof Date);
    assert.equal(ep.occurred_at.toISOString(), "2026-06-15T09:00:00.000Z");
    assert.ok(ep.created_at instanceof Date);
    assert.equal(ep.created_at.toISOString(), "2026-06-15T09:00:00.000Z");
  });

});

// ── AC-K13-02: capability.used before run.started ─────────────────────────────

describe("K13 — AC-K13-02: capability.used before run.started → ADAPTER_ARTIFACT_SEQUENCE_INVALID", () => {

  it("capability.used as the only artifact (no run.started) → sequence error", () => {
    const result = adaptForeman([capabilityUsed()]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_ARTIFACT_SEQUENCE_INVALID");
  });

  it("detail references capability.used", () => {
    const result = adaptForeman([capabilityUsed()]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.detail.includes("capability.used"),
      "detail must reference the artifact type that violated the sequence rule");
  });

  it("capability.used before run.started (with run.started after) → sequence error", () => {
    const result = adaptForeman([capabilityUsed(), runStarted()]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_ARTIFACT_SEQUENCE_INVALID");
  });

  it("capability.used after run.started (valid position) → ok: true", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true,
      "capability.used positioned after run.started must pass the sequence check");
  });

});

// ── AC-K13-03: capability.used missing required fields ────────────────────────

describe("K13 — AC-K13-03: capability.used missing required fields → ADAPTER_MISSING_REQUIRED_FIELD", () => {

  it("missing step_id → ADAPTER_MISSING_REQUIRED_FIELD naming step_id", () => {
    const { step_id: _omit, ...rest } = capabilityUsed();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("step_id"), "detail must name the missing field");
  });

  it("missing capability_id → ADAPTER_MISSING_REQUIRED_FIELD naming capability_id", () => {
    const { capability_id: _omit, ...rest } = capabilityUsed();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("capability_id"));
  });

  it("missing invocation_id → ADAPTER_MISSING_REQUIRED_FIELD naming invocation_id", () => {
    const { invocation_id: _omit, ...rest } = capabilityUsed();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("invocation_id"));
  });

  it("missing actor_role → ADAPTER_MISSING_REQUIRED_FIELD naming actor_role", () => {
    const { actor_role: _omit, ...rest } = capabilityUsed();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("actor_role"));
  });

  it("missing occurred_at → ADAPTER_MISSING_REQUIRED_FIELD naming occurred_at", () => {
    const { occurred_at: _omit, ...rest } = capabilityUsed();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("occurred_at"));
  });

  it("empty string step_id → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const result = adaptForeman([runStarted(), capabilityUsed({ step_id: "" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("step_id"));
  });

  it("empty string capability_id → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const result = adaptForeman([runStarted(), capabilityUsed({ capability_id: "" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("capability_id"));
  });

  it("empty string occurred_at → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const result = adaptForeman([runStarted(), capabilityUsed({ occurred_at: "" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("occurred_at"));
  });

  it("validation fails at correct artifact index — artifact[2] reported as artifact[2]", () => {
    const { step_id: _omit, ...badArtifact } = capabilityUsed({ id: "cap-bad" });
    const result = adaptForeman([
      runStarted(),                       // [0] valid
      capabilityUsed({ id: "cap-good" }), // [1] valid
      badArtifact as ForemanArtifact,     // [2] invalid
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("artifact[2]"), "detail must reference the failing artifact index");
  });

});

// ── AC-K13-04: promote_to_semantic ignored for capability.used ─────────────────

describe("K13 — AC-K13-04: promote_to_semantic is ignored for capability.used (INV-K13-03)", () => {

  it("promote_to_semantic: true + actor_role: 'COMMAND' → episodic only, no decisions", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ promote_to_semantic: true, actor_role: "COMMAND" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false,
      "capability.used must never produce a decision input regardless of promote_to_semantic");
  });

  it("promote_to_semantic: false → episodic only, no decisions", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ promote_to_semantic: false }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false);
  });

  it("promote_to_semantic absent → episodic only, no decisions", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false);
  });

});

// ── AC-K13-05: Required fields forwarded into payload ─────────────────────────

describe("K13 — AC-K13-05: required fields forwarded verbatim into episodic payload", () => {

  it("step_id forwarded into payload", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ step_id: "step-007" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].payload["step_id"], "step-007");
  });

  it("capability_id forwarded into payload", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ capability_id: "read_file" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].payload["capability_id"], "read_file");
  });

  it("invocation_id forwarded into payload", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ invocation_id: "inv-xyz999" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].payload["invocation_id"], "inv-xyz999");
  });

  it("actor_role forwarded into payload", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ actor_role: "sentinel" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].payload["actor_role"], "sentinel");
  });

  it("occurred_at forwarded into payload", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ occurred_at: "2026-03-12T10:00:00.000Z" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].payload["occurred_at"], "2026-03-12T10:00:00.000Z");
  });

  it("all required fields forwarded together", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({
        step_id:       "step-k13",
        capability_id: "write_output",
        invocation_id: "inv-k13-test",
        actor_role:    "forge",
        occurred_at:   "2026-03-12T10:30:00.000Z",
      }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const p = result.ingestInput.episodic[1].payload;
    assert.equal(p["step_id"],       "step-k13");
    assert.equal(p["capability_id"], "write_output");
    assert.equal(p["invocation_id"], "inv-k13-test");
    assert.equal(p["actor_role"],    "forge");
    assert.equal(p["occurred_at"],   "2026-03-12T10:30:00.000Z");
  });

});

// ── AC-K13-06: Optional fields forwarded when present ─────────────────────────

describe("K13 — AC-K13-06: optional fields forwarded when present", () => {

  it("outcome forwarded when present", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ outcome: "SUCCESS" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].payload["outcome"], "SUCCESS");
  });

  it("evidence forwarded when present", () => {
    const evidence = { bytes_written: 1024, path: "/tmp/out.json" };
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ evidence }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.ingestInput.episodic[1].payload["evidence"], evidence);
  });

  it("both outcome and evidence forwarded when present", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ outcome: "FAILURE", evidence: { error: "permission denied" } }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const p = result.ingestInput.episodic[1].payload;
    assert.equal(p["outcome"], "FAILURE");
    assert.deepEqual(p["evidence"], { error: "permission denied" });
  });

});

// ── AC-K13-07: Optional fields absent when not supplied ───────────────────────

describe("K13 — AC-K13-07: optional fields absent from payload when not supplied", () => {

  it("outcome absent from payload when not in artifact", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(!("outcome" in result.ingestInput.episodic[1].payload),
      "outcome must not be present in payload when not supplied on artifact");
  });

  it("evidence absent from payload when not in artifact", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(!("evidence" in result.ingestInput.episodic[1].payload),
      "evidence must not be present in payload when not supplied on artifact");
  });

});

// ── AC-K13-08: Mixed sequences ────────────────────────────────────────────────

describe("K13 — AC-K13-08: mixed sequences with capability.used", () => {

  it("run.started + capability.used + run.succeeded → 3 episodic in order", () => {
    const result = adaptForeman([
      runStarted({      id: "id-0" }),
      capabilityUsed({  id: "id-1" }),
      runSucceeded({    id: "id-2" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic.length, 3);
    const ids = result.ingestInput.episodic.map((e) => e.id);
    assert.deepEqual(ids, ["id-0", "id-1", "id-2"]);
  });

  it("event_type sequence is correct across mixed events", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed(),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const types = result.ingestInput.episodic.map((e) => e.event_type);
    assert.deepEqual(types, [
      K2_EVENT_TYPE.RUN_STARTED,
      K2_EVENT_TYPE.CAPABILITY_USED,
      K2_EVENT_TYPE.RUN_SUCCEEDED,
    ]);
  });

  it("capability.used interleaved with K12 governance artifacts → all in order", () => {
    const result = adaptForeman([
      runStarted({         id: "id-0" }),
      capabilityUsed({     id: "id-1" }),
      {
        type:             "governance.decision",
        id:               "id-2",
        run_id:           "run-k13",
        ts:               "2026-01-01T00:00:40.000Z",
        decision_type:    "PHASE_BOUNDARY",
        actor_role:       "COMMAND",
        decision_payload: { phase: "k13" },
        ...BASE_CONTEXT,
      } as ForemanArtifact,
      capabilityUsed({     id: "id-3", capability_id: "read_file" }),
      runSucceeded({       id: "id-4" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic.length, 5);
    const ids = result.ingestInput.episodic.map((e) => e.id);
    assert.deepEqual(ids, ["id-0", "id-1", "id-2", "id-3", "id-4"]);
  });

});

// ── AC-K13-09: No decision output ─────────────────────────────────────────────

describe("K13 — AC-K13-09: capability.used never produces decision output", () => {

  it("capability.used in sequence with promotable governance.decision → only governance.decision produces decision", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ id: "cap-1", promote_to_semantic: true, actor_role: "COMMAND" }),
      {
        type:             "governance.decision",
        id:               "gov-1",
        run_id:           "run-k13",
        ts:               "2026-01-01T00:00:40.000Z",
        decision_type:    "STATE_IMPACT_REVIEWED",
        actor_role:       "COMMAND",
        decision_payload: { reviewed: true },
        promote_to_semantic: true,
        ...BASE_CONTEXT,
      } as ForemanArtifact,
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.ingestInput.decisions, "decisions must be present from governance.decision");
    assert.equal(result.ingestInput.decisions!.length, 1, "exactly one decision from governance.decision only");
    assert.equal(result.ingestInput.decisions![0].id, "gov-1",
      "the decision must correspond to governance.decision, not capability.used");
  });

});

// ── AC-K13-10: Statelessness ──────────────────────────────────────────────────

describe("K13 — AC-K13-10: adapter remains stateless across calls (INV-K13-01)", () => {

  it("two successive calls produce independent results", () => {
    const first = adaptForeman([
      runStarted({ id: "rs-first", run_id: "run-first" }),
      capabilityUsed({ id: "cap-first", run_id: "run-first", capability_id: "write_output" }),
    ]);
    const second = adaptForeman([
      runStarted({ id: "rs-second", run_id: "run-second" }),
      capabilityUsed({ id: "cap-second", run_id: "run-second", capability_id: "read_file" }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.ingestInput.episodic[1].id,  "cap-first");
    assert.equal(second.ingestInput.episodic[1].id, "cap-second");
    assert.equal(
      first.ingestInput.episodic[1].payload["capability_id"],
      "write_output",
    );
    assert.equal(
      second.ingestInput.episodic[1].payload["capability_id"],
      "read_file",
    );
  });

  it("failed first call does not contaminate second call", () => {
    const first = adaptForeman([capabilityUsed()]); // no run.started → sequence error
    const second = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(first.ok, false);
    assert.equal(second.ok, true,
      "second call must succeed regardless of first call's failure");
  });

});

// ── AC-K13-11: Identity fields not in payload ─────────────────────────────────

describe("K13 — AC-K13-11: identity fields excluded from episodic payload", () => {

  it("id, run_id, project_id, pipeline_schema_version, session_id, ts, type not in payload", () => {
    const result = adaptForeman([runStarted(), capabilityUsed()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const p = result.ingestInput.episodic[1].payload;
    assert.ok(!("id"                      in p), "id must not be in payload");
    assert.ok(!("run_id"                  in p), "run_id must not be in payload");
    assert.ok(!("project_id"              in p), "project_id must not be in payload");
    assert.ok(!("pipeline_schema_version" in p), "pipeline_schema_version must not be in payload");
    assert.ok(!("session_id"              in p), "session_id must not be in payload");
    assert.ok(!("ts"                      in p), "ts must not be in payload");
    assert.ok(!("type"                    in p), "type must not be in payload");
  });

});

// ── AC-K13-12: agent_role derived from actor_role ─────────────────────────────

describe("K13 — AC-K13-12: agent_role on episodic derived from actor_role field", () => {

  it("agent_role is set to actor_role value from artifact", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ actor_role: "sentinel" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].agent_role, "sentinel");
  });

  it("agent_role is 'COMMAND' when actor_role is 'COMMAND'", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ actor_role: "COMMAND" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].agent_role, "COMMAND");
  });

});

// ── AC-K13-13: Base required fields still validated ───────────────────────────

describe("K13 — AC-K13-13: base required fields validated on capability.used", () => {

  it("missing id → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { id: _omit, ...rest } = capabilityUsed();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes('"id"'));
  });

  it("missing ts → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { ts: _omit, ...rest } = capabilityUsed();
    const result = adaptForeman([runStarted(), rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes('"ts"'));
  });

});

// ── AC-K13-14: Multiple capability.used artifacts in sequence ─────────────────

describe("K13 — AC-K13-14: multiple capability.used artifacts in one sequence", () => {

  it("two capability.used artifacts both produce CAPABILITY_USED episodic entries", () => {
    const result = adaptForeman([
      runStarted({       id: "id-0" }),
      capabilityUsed({   id: "id-1", capability_id: "write_output" }),
      capabilityUsed({   id: "id-2", capability_id: "read_file" }),
      runSucceeded({     id: "id-3" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic.length, 4);
    assert.equal(result.ingestInput.episodic[1].event_type, K2_EVENT_TYPE.CAPABILITY_USED);
    assert.equal(result.ingestInput.episodic[2].event_type, K2_EVENT_TYPE.CAPABILITY_USED);
  });

  it("multiple capability.used artifacts preserve input order", () => {
    const result = adaptForeman([
      runStarted({     id: "id-0" }),
      capabilityUsed({ id: "id-1", capability_id: "write_output" }),
      capabilityUsed({ id: "id-2", capability_id: "read_file" }),
      capabilityUsed({ id: "id-3", capability_id: "execute_sql" }),
      runSucceeded({   id: "id-4" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ids = result.ingestInput.episodic.map((e) => e.id);
    assert.deepEqual(ids, ["id-0", "id-1", "id-2", "id-3", "id-4"]);
  });

  it("multiple capability.used artifacts each forward their own capability_id", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ id: "id-1", capability_id: "write_output" }),
      capabilityUsed({ id: "id-2", capability_id: "read_file"    }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ingestInput.episodic[1].payload["capability_id"], "write_output");
    assert.equal(result.ingestInput.episodic[2].payload["capability_id"], "read_file");
  });

  it("two capability.used artifacts produce no decisions", () => {
    const result = adaptForeman([
      runStarted(),
      capabilityUsed({ id: "id-1", promote_to_semantic: true, actor_role: "COMMAND" }),
      capabilityUsed({ id: "id-2", promote_to_semantic: true, actor_role: "COMMAND" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false, "capability.used must never produce decisions regardless of count");
  });

});
