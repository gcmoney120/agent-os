/**
 * Agent OS — K12 Governance Decision Adapter — Acceptance Tests
 *
 * Slice: K12 — Governance Decision Adapter (Foreman → K2)
 *
 * Locked Atlas acceptance criteria under test:
 *
 *   AC-K12-01 — governance.decision with valid fields + promote_to_semantic: true
 *               + actor_role: "COMMAND" → ok: true, one episodic, one decision.
 *
 *   AC-K12-02 — governance.decision with promote_to_semantic: true but actor_role
 *               NOT "COMMAND" → ok: true, one episodic, empty/absent decisions.
 *
 *   AC-K12-03 — governance.decision with promote_to_semantic: false (or absent)
 *               → ok: true, one episodic, no decision regardless of actor_role.
 *
 *   AC-K12-04 — governance.decision missing decision_type, actor_role, or
 *               decision_payload → ok: false, ADAPTER_MISSING_REQUIRED_FIELD.
 *
 *   AC-K12-05 — governance.halt with valid fields → ok: true, one
 *               GOVERNANCE_HALT episodic, no decisions.
 *
 *   AC-K12-06 — trust.change_declared with valid fields → ok: true, one
 *               TRUST_CHANGE_DECLARED episodic, no decisions, regardless of
 *               any promote_to_semantic-like field on the payload.
 *
 *   AC-K12-07 — Mixed sequence (run lifecycle + governance events) → ok: true,
 *               all events present in episodic in input order.
 *
 *   AC-K12-08 — "capability.used" artifact type continues to return
 *               ADAPTER_UNKNOWN_EVENT_TYPE (K12 does not handle it).
 *
 *   AC-K12-09 — All K11 acceptance criteria pass without modification to K11
 *               test files. (Structural guarantee: K11 test file not modified.)
 *
 *   AC-K12-10 — All existing K2 and K10 tests pass without modification.
 *               (Verified by running the full suite.)
 *
 *   AC-K12-11 — No locked file outside artifact-adapter.ts and this test file
 *               was modified. Compass cross-check.
 *
 * INV-K12-02 — Promotion authority: produce decision input only when
 *              promote_to_semantic === true AND actor_role === "COMMAND".
 *
 * INV-K12-03 — TRUST_CHANGE_DECLARED: never promotable.
 * INV-K12-04 — GOVERNANCE_HALT: never promotable.
 * INV-K12-06 — actor_role: passthrough field, not enum-validated.
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
  project_id:              "proj-k12",
  pipeline_schema_version: "1.1",
  session_id:              "sess-k12",
} as const;

function runStarted(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:   "run.started",
    id:     "evt-run-started",
    run_id: "run-k12",
    ts:     "2026-01-01T00:00:00.000Z",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function runSucceeded(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:   "run.succeeded",
    id:     "evt-run-succeeded",
    run_id: "run-k12",
    ts:     "2026-01-01T00:01:00.000Z",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function governanceDecision(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:             "governance.decision",
    id:               "evt-gov-decision",
    run_id:           "run-k12",
    ts:               "2026-01-01T00:00:30.000Z",
    decision_type:    "STATE_IMPACT_REVIEWED",
    actor_role:       "COMMAND",
    decision_payload: { reviewed: true },
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function governanceHalt(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:        "governance.halt",
    id:          "evt-gov-halt",
    run_id:      "run-k12",
    ts:          "2026-01-01T00:00:40.000Z",
    halt_reason: "TRUST_CHANGE_REQUIRES_REVIEW",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

function trustChangeDeclared(overrides: Partial<ForemanArtifact> = {}): ForemanArtifact {
  return {
    type:        "trust.change_declared",
    id:          "evt-trust-change",
    run_id:      "run-k12",
    ts:          "2026-01-01T00:00:35.000Z",
    change_type: "TIER_UPGRADE",
    ...BASE_CONTEXT,
    ...overrides,
  };
}

// ── AC-K12-01: governance.decision with full promotion conditions ─────────────

describe("K12 — AC-K12-01: governance.decision with promote_to_semantic + actor_role COMMAND", () => {

  it("produces ok: true with one episodic and one decision", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: true }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic.length, 1, "must have one episodic input");
    assert.ok(result.ingestInput.decisions, "decisions must be present");
    assert.equal(result.ingestInput.decisions!.length, 1, "must have one decision input");
  });

  it("episodic event_type is GOVERNANCE_DECISION", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: true }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic[0].event_type, K2_EVENT_TYPE.GOVERNANCE_DECISION);
  });

  it("decision input carries correct fields from artifact", () => {
    const result = adaptForeman([
      governanceDecision({
        promote_to_semantic: true,
        decision_type:       "PHASE_TRANSITION",
        actor_role:          "COMMAND",
        decision_payload:    { approved: true, phase: "k12" },
      }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const dec = result.ingestInput.decisions![0];
    assert.equal(dec.decision_type,     "PHASE_TRANSITION");
    assert.equal(dec.actor_role,        "COMMAND");
    assert.deepEqual(dec.decision_payload, { approved: true, phase: "k12" });
  });

  it("decision input identity fields are correct", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: true, id: "gov-evt-id" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const dec = result.ingestInput.decisions![0];
    assert.equal(dec.id,                "gov-evt-id");
    assert.equal(dec.run_id,            "run-k12");
    assert.equal(dec.project_id,        "proj-k12");
    assert.equal(dec.schema_version,    "1.1");
    assert.equal(dec.episodic_event_id, "gov-evt-id", "episodic_event_id links to the artifact id");
  });

  it("decision input decided_at and created_at are parsed from artifact ts", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: true, ts: "2026-06-01T12:00:00.000Z" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const dec = result.ingestInput.decisions![0];
    assert.ok(dec.decided_at instanceof Date);
    assert.equal(dec.decided_at.toISOString(), "2026-06-01T12:00:00.000Z");
    assert.ok(dec.created_at instanceof Date);
    assert.equal(dec.created_at.toISOString(), "2026-06-01T12:00:00.000Z");
  });

  it("agent_role on episodic is taken from actor_role field", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: true, actor_role: "COMMAND" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic[0].agent_role, "COMMAND");
  });

});

// ── AC-K12-02: promote_to_semantic: true but actor_role NOT "COMMAND" ─────────

describe("K12 — AC-K12-02: governance.decision with non-COMMAND actor_role", () => {

  it("actor_role 'atlas' with promote_to_semantic: true → episodic only, no decision", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: true, actor_role: "atlas" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic.length, 1);
    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false, "non-COMMAND actor must not produce a decision input");
  });

  it("actor_role 'forge' with promote_to_semantic: true → episodic only", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: true, actor_role: "forge" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false);
  });

  it("actor_role 'command' (lowercase) with promote_to_semantic: true → episodic only", () => {
    // Only uppercase "COMMAND" triggers promotion gating (INV-K12-06)
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: true, actor_role: "command" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false,
      "lowercase 'command' must not trigger promotion — only uppercase 'COMMAND'");
  });

  it("unknown actor_role passes through without rejection (INV-K12-06 — no enum validation)", () => {
    const result = adaptForeman([
      governanceDecision({ actor_role: "some-future-role", promote_to_semantic: false }),
    ]);
    assert.equal(result.ok, true, "unknown actor_role must not cause a validation error");
  });

});

// ── AC-K12-03: promote_to_semantic false or absent ────────────────────────────

describe("K12 — AC-K12-03: governance.decision without promotion intent", () => {

  it("promote_to_semantic: false with actor_role COMMAND → episodic only", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: false, actor_role: "COMMAND" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic.length, 1);
    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false);
  });

  it("promote_to_semantic absent with actor_role COMMAND → episodic only", () => {
    const { promote_to_semantic: _omit, ...artifact } = { ...governanceDecision(), promote_to_semantic: undefined };
    const result = adaptForeman([artifact as ForemanArtifact]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false);
  });

  it("promote_to_semantic: false with non-COMMAND actor_role → episodic only", () => {
    const result = adaptForeman([
      governanceDecision({ promote_to_semantic: false, actor_role: "sentinel" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false);
  });

});

// ── AC-K12-04: governance.decision missing required fields ────────────────────

describe("K12 — AC-K12-04: governance.decision missing required fields", () => {

  it("missing decision_type → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { decision_type: _omit, ...rest } = governanceDecision();
    const result = adaptForeman([rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("decision_type"), "detail must name the missing field");
  });

  it("missing actor_role → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { actor_role: _omit, ...rest } = governanceDecision();
    const result = adaptForeman([rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("actor_role"));
  });

  it("missing decision_payload → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const { decision_payload: _omit, ...rest } = governanceDecision();
    const result = adaptForeman([rest as ForemanArtifact]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("decision_payload"));
  });

  it("decision_payload: null → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = adaptForeman([governanceDecision({ decision_payload: null as any })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("decision_payload"));
  });

  it("decision_payload: array → ADAPTER_MISSING_REQUIRED_FIELD (must be a non-array object)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = adaptForeman([governanceDecision({ decision_payload: [] as any })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
  });

  it("empty string decision_type → ADAPTER_MISSING_REQUIRED_FIELD", () => {
    const result = adaptForeman([governanceDecision({ decision_type: "" })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
  });

  it("validation runs on later artifacts too — missing field at artifact[1] reported at [1]", () => {
    const { decision_type: _omit, ...badArtifact } = governanceDecision({ id: "evt-bad" });
    const result = adaptForeman([
      governanceDecision({ id: "evt-good" }),       // [0] valid
      badArtifact as ForemanArtifact,               // [1] invalid
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_MISSING_REQUIRED_FIELD");
    assert.ok(result.detail.includes("artifact[1]"));
  });

});

// ── AC-K12-05: governance.halt ────────────────────────────────────────────────

describe("K12 — AC-K12-05: governance.halt", () => {

  it("valid governance.halt → ok: true with GOVERNANCE_HALT episodic", () => {
    const result = adaptForeman([governanceHalt()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic.length, 1);
    assert.equal(result.ingestInput.episodic[0].event_type, K2_EVENT_TYPE.GOVERNANCE_HALT);
  });

  it("governance.halt produces no decisions (INV-K12-04)", () => {
    const result = adaptForeman([governanceHalt()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false, "governance.halt must never produce a decision input");
  });

  it("governance.halt with promote_to_semantic: true still produces no decisions (INV-K12-04)", () => {
    // Promotion intent on halt is explicitly prohibited.
    const result = adaptForeman([
      governanceHalt({ promote_to_semantic: true, actor_role: "COMMAND" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false,
      "governance.halt must never produce a decision input even with promote_to_semantic: true");
  });

  it("halt_reason is forwarded into episodic payload", () => {
    const result = adaptForeman([governanceHalt({ halt_reason: "MANUAL_INTERVENTION_REQUIRED" })]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(
      result.ingestInput.episodic[0].payload["halt_reason"],
      "MANUAL_INTERVENTION_REQUIRED",
    );
  });

});

// ── AC-K12-06: trust.change_declared ─────────────────────────────────────────

describe("K12 — AC-K12-06: trust.change_declared", () => {

  it("valid trust.change_declared → ok: true with TRUST_CHANGE_DECLARED episodic", () => {
    const result = adaptForeman([trustChangeDeclared()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic.length, 1);
    assert.equal(result.ingestInput.episodic[0].event_type, K2_EVENT_TYPE.TRUST_CHANGE_DECLARED);
  });

  it("trust.change_declared produces no decisions (INV-K12-03)", () => {
    const result = adaptForeman([trustChangeDeclared()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false, "trust.change_declared must never produce a decision input");
  });

  it("trust.change_declared with promote_to_semantic: true still produces no decisions (INV-K12-03)", () => {
    const result = adaptForeman([
      trustChangeDeclared({ promote_to_semantic: true, actor_role: "COMMAND" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const hasDecisions = "decisions" in result.ingestInput && (result.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasDecisions, false,
      "trust.change_declared must never produce a decision input regardless of payload content");
  });

  it("change_type is forwarded into episodic payload", () => {
    const result = adaptForeman([trustChangeDeclared({ change_type: "TIER_DOWNGRADE" })]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic[0].payload["change_type"], "TIER_DOWNGRADE");
  });

});

// ── AC-K12-07: Mixed artifact sequences ───────────────────────────────────────

describe("K12 — AC-K12-07: mixed run lifecycle + governance sequences", () => {

  it("complete mixed sequence: run lifecycle + governance.decision + governance.halt → all events in episodic", () => {
    const result = adaptForeman([
      runStarted(),
      governanceDecision({ id: "gov-1", promote_to_semantic: false }),
      governanceHalt({ id: "halt-1" }),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic.length, 4, "all 4 artifacts must produce episodic inputs");
  });

  it("governance artifacts appear in correct position in episodic array (INV-K12-07)", () => {
    const result = adaptForeman([
      runStarted({          id: "id-0" }),
      governanceDecision({  id: "id-1", promote_to_semantic: false }),
      trustChangeDeclared({ id: "id-2" }),
      governanceHalt({      id: "id-3" }),
      runSucceeded({        id: "id-4" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const ids = result.ingestInput.episodic.map((e) => e.id);
    assert.deepEqual(ids, ["id-0", "id-1", "id-2", "id-3", "id-4"],
      "episodic IDs must match input artifact order exactly");
  });

  it("event_type sequence is correct across mixed events", () => {
    const result = adaptForeman([
      runStarted(),
      governanceDecision({ promote_to_semantic: false }),
      trustChangeDeclared(),
      governanceHalt(),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const types = result.ingestInput.episodic.map((e) => e.event_type);
    assert.deepEqual(types, [
      K2_EVENT_TYPE.RUN_STARTED,
      K2_EVENT_TYPE.GOVERNANCE_DECISION,
      K2_EVENT_TYPE.TRUST_CHANGE_DECLARED,
      K2_EVENT_TYPE.GOVERNANCE_HALT,
      K2_EVENT_TYPE.RUN_SUCCEEDED,
    ]);
  });

  it("promotable governance.decision in mixed sequence produces decision at correct position", () => {
    const result = adaptForeman([
      runStarted(),
      governanceDecision({ id: "gov-1", promote_to_semantic: true, actor_role: "COMMAND" }),
      governanceDecision({ id: "gov-2", promote_to_semantic: false }),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.episodic.length, 4);
    assert.ok(result.ingestInput.decisions, "decisions must be present");
    assert.equal(result.ingestInput.decisions!.length, 1, "only one promotable decision");
    assert.equal(result.ingestInput.decisions![0].id, "gov-1",
      "decision must correspond to the promotable artifact");
  });

  it("multiple promotable governance.decisions both appear in decisions array", () => {
    const result = adaptForeman([
      runStarted(),
      governanceDecision({ id: "gov-a", promote_to_semantic: true, actor_role: "COMMAND", decision_type: "DT_A" }),
      governanceDecision({ id: "gov-b", promote_to_semantic: true, actor_role: "COMMAND", decision_type: "DT_B" }),
      runSucceeded(),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.ingestInput.decisions!.length, 2);
    assert.equal(result.ingestInput.decisions![0].decision_type, "DT_A");
    assert.equal(result.ingestInput.decisions![1].decision_type, "DT_B");
  });

});

// ── AC-K12-08: capability.used — superseded by K13 ───────────────────────────
//
// K12 deferred capability.used to K13. K13 now recognizes it.
// A standalone capability.used artifact (no preceding run.started) now
// returns ADAPTER_ARTIFACT_SEQUENCE_INVALID rather than ADAPTER_UNKNOWN_EVENT_TYPE.
// Uppercase "CAPABILITY_USED" remains unrecognized (not a valid event type).

describe("K12 — AC-K12-08: capability.used — K13 now handles it (K12 deferred)", () => {

  it("capability.used without preceding run.started → ok: false (sequence violation)", () => {
    // K13 recognizes capability.used; a standalone occurrence fails the sequence check.
    const result = adaptForeman([
      { ...runStarted(), type: "capability.used" },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_ARTIFACT_SEQUENCE_INVALID",
      "capability.used is now K13-handled; without run.started it fails the sequence check");
    assert.ok(result.detail.includes("capability.used"));
  });

  it("CAPABILITY_USED uppercase still returns ADAPTER_UNKNOWN_EVENT_TYPE", () => {
    const result = adaptForeman([
      { ...runStarted(), type: "CAPABILITY_USED" },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ADAPTER_UNKNOWN_EVENT_TYPE");
  });

});

// ── INV-K12-01: Statelessness ─────────────────────────────────────────────────

describe("K12 — INV-K12-01: adapter remains stateless", () => {

  it("two successive calls with governance.decision produce independent results", () => {
    const first = adaptForeman([
      governanceDecision({ id: "gov-first", run_id: "run-first", promote_to_semantic: true }),
    ]);
    const second = adaptForeman([
      governanceDecision({ id: "gov-second", run_id: "run-second", promote_to_semantic: false }),
    ]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;

    assert.equal(first.ingestInput.decisions!.length, 1, "first call must have a decision");
    const hasSecondDecisions =
      "decisions" in second.ingestInput && (second.ingestInput.decisions?.length ?? 0) > 0;
    assert.equal(hasSecondDecisions, false, "second call must not be contaminated by first");
  });

});

// ── Payload forwarding for governance + trust artifacts ───────────────────────

describe("K12 — payload forwarding for governance and trust artifacts", () => {

  it("governance.decision: decision_type, actor_role, decision_payload forwarded into episodic payload", () => {
    const result = adaptForeman([
      governanceDecision({
        decision_type:    "PHASE_BOUNDARY",
        actor_role:       "COMMAND",
        decision_payload: { phase: "k12-start" },
      }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const p = result.ingestInput.episodic[0].payload;
    assert.equal(p["decision_type"],    "PHASE_BOUNDARY");
    assert.equal(p["actor_role"],       "COMMAND");
    assert.deepEqual(p["decision_payload"], { phase: "k12-start" });
  });

  it("governance.decision: identity fields not in payload", () => {
    const result = adaptForeman([governanceDecision({ promote_to_semantic: false })]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const p = result.ingestInput.episodic[0].payload;
    assert.ok(!("id"                      in p));
    assert.ok(!("run_id"                  in p));
    assert.ok(!("project_id"              in p));
    assert.ok(!("pipeline_schema_version" in p));
    assert.ok(!("session_id"              in p));
    assert.ok(!("ts"                      in p));
    assert.ok(!("type"                    in p));
  });

  it("governance.halt: halt_reason and extra fields forwarded into episodic payload", () => {
    const result = adaptForeman([
      governanceHalt({ halt_reason: "MANUAL_REVIEW", extra: "data" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const p = result.ingestInput.episodic[0].payload;
    assert.equal(p["halt_reason"], "MANUAL_REVIEW");
    assert.equal(p["extra"], "data");
  });

  it("trust.change_declared: change_type and extra fields forwarded into episodic payload", () => {
    const result = adaptForeman([
      trustChangeDeclared({ change_type: "TIER_UPGRADE", trust_notes: "performance excellent" }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const p = result.ingestInput.episodic[0].payload;
    assert.equal(p["change_type"], "TIER_UPGRADE");
    assert.equal(p["trust_notes"], "performance excellent");
  });

});
