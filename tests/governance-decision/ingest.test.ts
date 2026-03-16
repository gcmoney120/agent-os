/**
 * Agent OS — K8 Governance Decision Ingestion
 * Acceptance tests — AC-K8-01 through AC-K8-18.
 *
 * Source: governance-decision-ingestion-k8-v1.1.md §16
 * Slice: K8 — Governance Decision Ingestion
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { InMemoryK2Backend } from "../../src/memory/pipeline/backend.js";
import { ingestGovernanceDecision } from "../../src/memory/governance-decision/ingest.js";
import { ingestDecisionEvent } from "../../src/memory/pipeline/ingest.js";
import type { DecisionIngestRequest, PromotionDirective } from "../../src/memory/governance-decision/types.js";
import type { StepReportV1 } from "../../src/step-report/stepReport.schema.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TS = "2026-03-12T10:00:00.000Z";
const PROJECT = "proj-k8-test";
const RUN_ID = "run-k8-001";
const EPISODIC_EVENT_ID = "ep-001";
const DECISION_ID = "dec-001";
const SCHEMA_V = "1.0";

function makeStepReport(
  overrides: Partial<StepReportV1> & { state_impact: StepReportV1["state_impact"] | string },
): StepReportV1 {
  const { state_impact, ...restOverrides } = overrides;
  return {
    schema_version: "1.0",
    run_id: RUN_ID,
    step_id: "step-001",
    step_index: 0,
    actor: "forge",
    action: "forge.implement",
    status: "succeeded",
    success: true,
    summary: "Step completed",
    artifacts: {},
    state_impact: state_impact as StepReportV1["state_impact"],
    timestamp: TS,
    ...restOverrides,
  } as StepReportV1;
}

function makeRequest(
  overrides: Partial<DecisionIngestRequest> & {
    state_impact?: StepReportV1["state_impact"] | string;
  } = {},
): DecisionIngestRequest {
  const { state_impact = "trust_change", ...rest } = overrides;
  return {
    project_id: PROJECT,
    run_id: RUN_ID,
    step_report: makeStepReport({ state_impact: state_impact as StepReportV1["state_impact"] }),
    episodic_event_id: EPISODIC_EVENT_ID,
    decision_id: DECISION_ID,
    decision_payload: { reason: "test" },
    schema_version: SCHEMA_V,
    timestamp: TS,
    ...rest,
  };
}

function makePromotion(): PromotionDirective {
  return {
    fact_id:                   "fact-001",
    fact_event_id:             "fe-001",
    embedding_record_id:       "emb-001",
    embedding_status_event_id: "es-001",
    fact_type:                 "PHASE_DECISION",
    fact_key:                  "k8-phase-key-001",
    fact_value:                { summary: "K8 phase boundary reached" },
  };
}

// ---------------------------------------------------------------------------
// AC-K8-01 — Project isolation
// ---------------------------------------------------------------------------

describe("AC-K8-01 — project isolation", () => {
  it("all written records carry the request project_id", () => {
    const backend = new InMemoryK2Backend();
    // Pre-seed episodic event for the FK linkage context
    const req = makeRequest({ state_impact: "trust_change" });
    const result = ingestGovernanceDecision(backend, req);
    assert.equal(result.ok, true);
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].project_id, PROJECT);
  });

  it("multi-project fixture — records isolated to their own project_id", () => {
    const backend = new InMemoryK2Backend();
    // Use distinct run_ids + decision_ids to avoid UNIQUE(run_id, decision_type, episodic_event_id)
    const reqA = makeRequest({
      project_id: "proj-a",
      decision_id: "dec-a",
      run_id: "run-a",
      state_impact: "trust_change",
    });
    const reqB = makeRequest({
      project_id: "proj-b",
      decision_id: "dec-b",
      run_id: "run-b",
      state_impact: "trust_change",
    });
    const rA = ingestGovernanceDecision(backend, reqA);
    const rB = ingestGovernanceDecision(backend, reqB);
    assert.equal(rA.ok, true);
    assert.equal(rB.ok, true);
    const decisions = backend.snapshotDecisionEvents();
    const ids = decisions.map((d) => d.project_id);
    assert.ok(ids.includes("proj-a"));
    assert.ok(ids.includes("proj-b"));
  });
});

// ---------------------------------------------------------------------------
// AC-K8-02 — Ineligible state_impact: distinct code
// ---------------------------------------------------------------------------

describe("AC-K8-02 — ineligible state_impact returns K8_INELIGIBLE_STATE_IMPACT", () => {
  it("state_impact = 'none' → K8_INELIGIBLE_STATE_IMPACT (not UNKNOWN)", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestGovernanceDecision(backend, makeRequest({ state_impact: "none" }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "K8_INELIGIBLE_STATE_IMPACT");
  });

  it("state_impact = 'trivial' → K8_INELIGIBLE_STATE_IMPACT (not UNKNOWN)", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestGovernanceDecision(backend, makeRequest({ state_impact: "trivial" }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "K8_INELIGIBLE_STATE_IMPACT");
  });

  it("no K2 writes on ineligible state_impact", () => {
    const backend = new InMemoryK2Backend();
    ingestGovernanceDecision(backend, makeRequest({ state_impact: "none" }));
    assert.equal(backend.snapshotDecisionEvents().length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-03 — Unknown state_impact: distinct code
// ---------------------------------------------------------------------------

describe("AC-K8-03 — unknown state_impact returns K8_UNKNOWN_STATE_IMPACT", () => {
  it("unrecognised value → K8_UNKNOWN_STATE_IMPACT (not INELIGIBLE)", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestGovernanceDecision(backend, makeRequest({ state_impact: "super_critical" as never }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "K8_UNKNOWN_STATE_IMPACT");
  });

  it("empty string → K8_UNKNOWN_STATE_IMPACT", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestGovernanceDecision(backend, makeRequest({ state_impact: "" as never }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "K8_UNKNOWN_STATE_IMPACT");
  });

  it("no K2 writes on unknown state_impact", () => {
    const backend = new InMemoryK2Backend();
    ingestGovernanceDecision(backend, makeRequest({ state_impact: "unknown_value" as never }));
    assert.equal(backend.snapshotDecisionEvents().length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-04 — Promotion prohibited for trust_change
// ---------------------------------------------------------------------------

describe("AC-K8-04 — promotion_directive with trust_change is rejected", () => {
  it("returns K8_PROMOTION_PROHIBITED_FOR_TRUST_CHANGE", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestGovernanceDecision(backend, makeRequest({
      state_impact: "trust_change",
      promotion_directive: makePromotion(),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "K8_PROMOTION_PROHIBITED_FOR_TRUST_CHANGE");
  });

  it("no K2 writes when promotion prohibited", () => {
    const backend = new InMemoryK2Backend();
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "trust_change",
      promotion_directive: makePromotion(),
    }));
    assert.equal(backend.snapshotDecisionEvents().length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-05 — Decision write for trust_change
// ---------------------------------------------------------------------------

describe("AC-K8-05 — trust_change writes decision_event only", () => {
  it("returns ok: true with promotion_written: false", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestGovernanceDecision(backend, makeRequest({ state_impact: "trust_change" }));
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.written.promotion_written, false);
    assert.equal(result.written.semantic_fact_id, null);
    assert.equal(result.written.embedding_record_id, null);
  });

  it("decision_type is TRUST_CHANGE", () => {
    const backend = new InMemoryK2Backend();
    ingestGovernanceDecision(backend, makeRequest({ state_impact: "trust_change" }));
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision_type, "TRUST_CHANGE");
  });

  it("no semantic_fact records written", () => {
    const backend = new InMemoryK2Backend();
    ingestGovernanceDecision(backend, makeRequest({ state_impact: "trust_change" }));
    assert.equal(backend.snapshotSemanticFacts().length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-06 — Decision write for phase_boundary, no promotion
// ---------------------------------------------------------------------------

describe("AC-K8-06 — phase_boundary without promotion_directive", () => {
  it("returns ok: true with promotion_written: false", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestGovernanceDecision(backend, makeRequest({ state_impact: "phase_boundary" }));
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.written.promotion_written, false);
  });

  it("decision_type is PHASE_BOUNDARY", () => {
    const backend = new InMemoryK2Backend();
    ingestGovernanceDecision(backend, makeRequest({ state_impact: "phase_boundary" }));
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision_type, "PHASE_BOUNDARY");
  });
});

// ---------------------------------------------------------------------------
// AC-K8-07 — Full promotion for phase_boundary with directive
// ---------------------------------------------------------------------------

describe("AC-K8-07 — phase_boundary with promotion_directive writes full chain", () => {
  it("returns ok: true with promotion_written: true and non-null IDs", () => {
    const backend = new InMemoryK2Backend();
    const promo = makePromotion();
    const result = ingestGovernanceDecision(backend, makeRequest({
      state_impact: "phase_boundary",
      promotion_directive: promo,
    }));
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.written.promotion_written, true);
    assert.equal(result.written.semantic_fact_id, promo.fact_id);
    assert.equal(result.written.embedding_record_id, promo.embedding_record_id);
  });

  it("semantic_fact, semantic_fact_event, embedding_record, embedding_status_event are all written", () => {
    const backend = new InMemoryK2Backend();
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "phase_boundary",
      promotion_directive: makePromotion(),
    }));
    assert.equal(backend.snapshotSemanticFacts().length, 1);
    assert.equal(backend.snapshotSemanticFactEvents().length, 1);
    assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
  });

  it("embedding_record status is PENDING", () => {
    const backend = new InMemoryK2Backend();
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "phase_boundary",
      promotion_directive: makePromotion(),
    }));
    const embeddings = backend.snapshotEmbeddingRecords();
    assert.equal(embeddings[0].status, "PENDING");
    assert.equal(embeddings[0].model_id, null);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-08 — actor_role from step_report.actor
// ---------------------------------------------------------------------------

describe("AC-K8-08 — actor_role is taken from step_report.actor", () => {
  it("actor_role = 'command'", () => {
    const backend = new InMemoryK2Backend();
    const req = makeRequest({ state_impact: "trust_change" });
    (req.step_report as { actor: string }).actor = "command";
    ingestGovernanceDecision(backend, req);
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions[0].actor_role, "command");
  });

  it("actor_role = 'atlas'", () => {
    const backend = new InMemoryK2Backend();
    const req = makeRequest({
      state_impact: "phase_boundary",
      step_report: makeStepReport({ state_impact: "phase_boundary", actor: "atlas" }),
    });
    ingestGovernanceDecision(backend, req);
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions[0].actor_role, "atlas");
  });
});

// ---------------------------------------------------------------------------
// AC-K8-09 — decision_payload is caller-supplied verbatim
// ---------------------------------------------------------------------------

describe("AC-K8-09 — decision_payload written verbatim", () => {
  it("decision_payload matches input exactly", () => {
    const backend = new InMemoryK2Backend();
    const payload = { reason: "test-reason", score: 42, nested: { flag: true } };
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "trust_change",
      decision_payload: payload,
    }));
    const decisions = backend.snapshotDecisionEvents();
    assert.deepEqual(decisions[0].decision_payload, payload);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-10 — No ID generation
// ---------------------------------------------------------------------------

describe("AC-K8-10 — no ID generation, uses caller-supplied decision_id", () => {
  it("decision_event.id equals request.decision_id", () => {
    const backend = new InMemoryK2Backend();
    const decisionId = "caller-supplied-id-XYZ";
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "trust_change",
      decision_id: decisionId,
    }));
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions[0].id, decisionId);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-11 — No timestamp generation
// ---------------------------------------------------------------------------

describe("AC-K8-11 — no timestamp generation, uses caller-supplied timestamp", () => {
  it("decision_event.created_at equals request.timestamp", () => {
    const backend = new InMemoryK2Backend();
    const ts = "2026-01-01T00:00:00.000Z";
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "trust_change",
      timestamp: ts,
    }));
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions[0].created_at.toISOString(), ts);
  });

  it("decided_at equals request.timestamp", () => {
    const backend = new InMemoryK2Backend();
    const ts = "2026-06-15T12:30:00.000Z";
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "phase_boundary",
      timestamp: ts,
    }));
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions[0].decided_at.toISOString(), ts);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-12 — Partial-write on Phase 2 failure
// ---------------------------------------------------------------------------

// Backend stub: accepts decision writes, rejects all promotion chain writes
class Phase2FailBackend extends InMemoryK2Backend {
  override appendPromotionChain() {
    return {
      ok: false as const,
      code: "DUPLICATE" as const,
      table: "semantic_fact",
      existing: null,
    };
  }
}

describe("AC-K8-12 — partial-write on Phase 2 failure", () => {
  it("returns K8_PROMOTION_WRITE_FAILED", () => {
    const backend = new Phase2FailBackend();
    const result = ingestGovernanceDecision(backend, makeRequest({
      state_impact: "phase_boundary",
      promotion_directive: makePromotion(),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "K8_PROMOTION_WRITE_FAILED");
  });

  it("decision_event is written (Phase 1 succeeded)", () => {
    const backend = new Phase2FailBackend();
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "phase_boundary",
      promotion_directive: makePromotion(),
    }));
    assert.equal(backend.snapshotDecisionEvents().length, 1);
  });

  it("no semantic_fact written (Phase 2 failed)", () => {
    const backend = new Phase2FailBackend();
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "phase_boundary",
      promotion_directive: makePromotion(),
    }));
    assert.equal(backend.snapshotSemanticFacts().length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-13 — No writes on validation failure
// ---------------------------------------------------------------------------

describe("AC-K8-13 — no writes on validation failure", () => {
  const validationFailureCases: [string, Parameters<typeof makeRequest>[0]][] = [
    ["missing project_id",        { project_id: "" }],
    ["missing run_id",            { run_id: "" }],
    ["missing episodic_event_id", { episodic_event_id: "" }],
    ["missing decision_id",       { decision_id: "" }],
    ["missing schema_version",    { schema_version: "" }],
    ["invalid timestamp",         { timestamp: "not-a-date" }],
    ["ineligible state_impact",   { state_impact: "none" }],
    ["unknown state_impact",      { state_impact: "weird" }],
  ];

  for (const [label, overrides] of validationFailureCases) {
    it(`${label} → no K2 writes`, () => {
      const backend = new InMemoryK2Backend();
      ingestGovernanceDecision(backend, makeRequest(overrides));
      assert.equal(backend.snapshotDecisionEvents().length, 0);
      assert.equal(backend.snapshotSemanticFacts().length, 0);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-K8-14 — Append-only: no UPDATE or DELETE
// (Structural: InMemoryK2Backend has no update/delete API; K8 never calls them.)
// Verified by inspection that no such calls exist in the K8 code path.
// ---------------------------------------------------------------------------

describe("AC-K8-14 — append-only (structural verification)", () => {
  it("InMemoryK2Backend exposes no update or delete API callable by K8", () => {
    const backend = new InMemoryK2Backend() as unknown as Record<string, unknown>;
    assert.equal(typeof backend["updateDecisionEvent"], "undefined");
    assert.equal(typeof backend["deleteDecisionEvent"], "undefined");
    assert.equal(typeof backend["updateSemanticFact"], "undefined");
    assert.equal(typeof backend["deleteSemanticFact"], "undefined");
  });
});

// ---------------------------------------------------------------------------
// AC-K8-15 — episodic_event_id FK linkage
// ---------------------------------------------------------------------------

describe("AC-K8-15 — episodic_event_id FK linkage", () => {
  it("decision_event.episodic_event_id equals request.episodic_event_id", () => {
    const backend = new InMemoryK2Backend();
    const eid = "ep-fixture-abc";
    ingestGovernanceDecision(backend, makeRequest({
      state_impact: "trust_change",
      episodic_event_id: eid,
    }));
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions[0].episodic_event_id, eid);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-16 — Not idempotent: duplicate decision_id rejected
// ---------------------------------------------------------------------------

describe("AC-K8-16 — duplicate decision_id is rejected on second call", () => {
  it("second call with same decision_id returns K8_DECISION_WRITE_FAILED", () => {
    const backend = new InMemoryK2Backend();
    const req = makeRequest({ state_impact: "trust_change" });
    const first = ingestGovernanceDecision(backend, req);
    assert.equal(first.ok, true);
    const second = ingestGovernanceDecision(backend, req);
    assert.equal(second.ok, false);
    assert.equal(second.code, "K8_DECISION_WRITE_FAILED");
  });

  it("first call's record is unmodified after duplicate rejection", () => {
    const backend = new InMemoryK2Backend();
    const payload = { original: true };
    const req1 = makeRequest({ state_impact: "trust_change", decision_payload: payload });
    ingestGovernanceDecision(backend, req1);
    // Second call with same decision_id but different payload
    const req2 = makeRequest({ state_impact: "trust_change", decision_payload: { original: false } });
    ingestGovernanceDecision(backend, req2);
    const decisions = backend.snapshotDecisionEvents();
    assert.equal(decisions.length, 1);
    assert.deepEqual(decisions[0].decision_payload, payload);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-17 — K2 contracts unchanged
// (Structural: K8 only wraps ingestDecisionEvent and executePromotion; no K2
// internal modifications. Verified by running existing K2 test suite alongside.)
// ---------------------------------------------------------------------------

describe("AC-K8-17 — K2 contracts unchanged (structural)", () => {
  it("ingestDecisionEvent still works independently after K8 import", () => {
    // Verify K2 ingest still works correctly by calling it directly (static import above)
    const backend = new InMemoryK2Backend();
    const result = ingestDecisionEvent(backend, {
      id: "direct-dec-001",
      project_id: PROJECT,
      schema_version: SCHEMA_V,
      run_id: RUN_ID,
      decision_type: "DIRECT_TEST",
      actor_role: "forge",
      episodic_event_id: EPISODIC_EVENT_ID,
      decision_payload: {},
      decided_at: new Date(TS),
      created_at: new Date(TS),
    });
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// AC-K8-18 — No runtime K3–K7 calls
// K8Backend type only accepts K2WriteBackend & K2PromotionBackend.
// InMemoryK2Backend exposes no K3–K7 interfaces.
// K8 ingest.ts imports only from ../pipeline/* — no K3–K7 imports.
// ---------------------------------------------------------------------------

describe("AC-K8-18 — no K3–K7 calls (structural)", () => {
  it("K8Backend (InMemoryK2Backend) exposes no K3/K4/K5/K6/K7 interfaces", () => {
    const backend = new InMemoryK2Backend() as unknown as Record<string, unknown>;
    // K3 interfaces
    assert.equal(typeof backend["queryEpisodicEvents"], "undefined");
    assert.equal(typeof backend["queryDecisionEvents"], "undefined");
    assert.equal(typeof backend["querySemanticFacts"], "undefined");
    // K5/K6 interfaces
    assert.equal(typeof backend["vectorSearch"], "undefined");
    assert.equal(typeof backend["hybridSearch"], "undefined");
  });

  it("ingestGovernanceDecision completes without accessing any read surface", () => {
    // Backend with read-method traps that throw if called
    const backend = new InMemoryK2Backend() as InMemoryK2Backend & Record<string, unknown>;
    backend["queryEpisodicEvents"] = () => { throw new Error("K3 called — FORBIDDEN"); };
    backend["hybridSearch"]        = () => { throw new Error("K6 called — FORBIDDEN"); };
    // Must not throw
    const result = ingestGovernanceDecision(backend, makeRequest({ state_impact: "trust_change" }));
    assert.equal(result.ok, true);
  });
});
