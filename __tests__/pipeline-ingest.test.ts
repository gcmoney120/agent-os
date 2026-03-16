/**
 * Agent OS — K2 Ingestion Orchestrator Tests
 *
 * Covers:
 *   - ingestEpisodicEvent: success, terminal guard, duplicate, caller-supplied fields
 *   - ingestDecisionEvent: success without promotion, terminal guard, duplicate,
 *     promotion authority (FORBIDDEN), promotion target (MISSING),
 *     promotion eligibility metadata, caller-supplied fields,
 *     no promotion writes occur
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryK2Backend } from "../src/memory/pipeline/backend.js";
import { ingestEpisodicEvent, ingestDecisionEvent } from "../src/memory/pipeline/ingest.js";
import { K2_EVENT_TYPE } from "../src/memory/pipeline/types.js";
import type {
  IngestEpisodicInput,
  IngestDecisionInput,
  PromotionTarget,
} from "../src/memory/pipeline/ingest.js";

// -- Helpers ------------------------------------------------------------------

const NOW = new Date("2026-03-11T00:00:00Z");
const LATER = new Date("2026-03-11T01:00:00Z");

let _seq = 0;
function uid(prefix: string): string { return `${prefix}-${++_seq}`; }

function makeEpisodicInput(overrides?: Partial<IngestEpisodicInput>): IngestEpisodicInput {
  return {
    id: uid("ep"),
    project_id: "proj-1",
    schema_version: "1.1",
    run_id: "run-1",
    session_id: "sess-1",
    agent_role: "foreman",
    event_type: K2_EVENT_TYPE.STEP_STARTED,
    payload: {},
    occurred_at: NOW,
    created_at: NOW,
    ...overrides,
  };
}

function makeDecisionInput(overrides?: Partial<IngestDecisionInput>): IngestDecisionInput {
  return {
    id: uid("dec"),
    project_id: "proj-1",
    schema_version: "1.1",
    run_id: "run-1",
    decision_type: "ACCEPT",
    actor_role: "command",
    episodic_event_id: "ep-1",
    decision_payload: {},
    decided_at: NOW,
    created_at: NOW,
    ...overrides,
  };
}

function makePromotion(overrides?: Partial<PromotionTarget>): PromotionTarget {
  return {
    fact_id: uid("fact"),
    fact_type: "CAPABILITY",
    fact_key: "key-1",
    fact_value: { data: true },
    fact_created_at: LATER,
    fact_event_id: uid("fe"),
    fact_event_observed_at: NOW,
    fact_event_created_at: LATER,
    embedding_id: uid("emb"),
    embedding_created_at: LATER,
    embedding_status_id: uid("es"),
    embedding_status_transitioned_at: LATER,
    embedding_status_created_at: LATER,
    ...overrides,
  };
}

// -- Tests --------------------------------------------------------------------

describe("ingestEpisodicEvent", () => {

  it("success: appends event and returns ok with record", () => {
    const backend = new InMemoryK2Backend();
    const input = makeEpisodicInput();
    const result = ingestEpisodicEvent(backend, input);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.id, input.id);
      assert.equal(result.event.event_type, K2_EVENT_TYPE.STEP_STARTED);
    }
    assert.equal(backend.snapshotEpisodicEvents().length, 1);
  });

  it("terminal guard: returns INGEST_RUN_TERMINATED when run has terminal event", () => {
    const backend = new InMemoryK2Backend();
    ingestEpisodicEvent(backend, makeEpisodicInput({
      event_type: K2_EVENT_TYPE.RUN_SUCCEEDED,
    }));
    const result = ingestEpisodicEvent(backend, makeEpisodicInput());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_RUN_TERMINATED");
    assert.equal(backend.snapshotEpisodicEvents().length, 1);
  });

  it("duplicate: returns INGEST_DUPLICATE when id already exists", () => {
    const backend = new InMemoryK2Backend();
    const input = makeEpisodicInput({ id: "fixed-id" });
    ingestEpisodicEvent(backend, input);
    const result = ingestEpisodicEvent(backend, makeEpisodicInput({ id: "fixed-id" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_DUPLICATE");
    assert.equal(backend.snapshotEpisodicEvents().length, 1);
  });

  it("caller-supplied id is preserved exactly", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestEpisodicEvent(backend, makeEpisodicInput({ id: "caller-id-abc" }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.event.id, "caller-id-abc");
  });

  it("caller-supplied created_at is preserved exactly", () => {
    const backend = new InMemoryK2Backend();
    const ts = new Date("2025-06-15T12:00:00Z");
    const result = ingestEpisodicEvent(backend, makeEpisodicInput({ created_at: ts }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.event.created_at, ts);
  });

  it("caller-supplied schema_version is preserved exactly", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestEpisodicEvent(backend, makeEpisodicInput({ schema_version: "99.9" }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.event.schema_version, "99.9");
  });

  it("terminal guard is scoped to run_id", () => {
    const backend = new InMemoryK2Backend();
    ingestEpisodicEvent(backend, makeEpisodicInput({
      run_id: "run-A",
      event_type: K2_EVENT_TYPE.RUN_FAILED,
    }));
    const result = ingestEpisodicEvent(backend, makeEpisodicInput({ run_id: "run-B" }));
    assert.equal(result.ok, true);
  });
});

describe("ingestDecisionEvent", () => {

  it("success without promotion: appends decision, promotionEligible false", () => {
    const backend = new InMemoryK2Backend();
    const input = makeDecisionInput();
    const result = ingestDecisionEvent(backend, input);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.decision.id, input.id);
      assert.equal(result.promotionEligible.eligible, false);
    }
    assert.equal(backend.snapshotDecisionEvents().length, 1);
  });

  it("terminal guard: returns INGEST_RUN_TERMINATED", () => {
    const backend = new InMemoryK2Backend();
    ingestEpisodicEvent(backend, makeEpisodicInput({
      event_type: K2_EVENT_TYPE.RUN_SUCCEEDED,
    }));
    const result = ingestDecisionEvent(backend, makeDecisionInput());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_RUN_TERMINATED");
    assert.equal(backend.snapshotDecisionEvents().length, 0);
  });

  it("duplicate: returns INGEST_DUPLICATE when decision already exists", () => {
    const backend = new InMemoryK2Backend();
    const input = makeDecisionInput({ id: "fixed-dec" });
    ingestDecisionEvent(backend, input);
    const result = ingestDecisionEvent(backend, makeDecisionInput({ id: "fixed-dec" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_DUPLICATE");
    assert.equal(backend.snapshotDecisionEvents().length, 1);
  });

  it("promotion authority: INGEST_PROMOTION_FORBIDDEN when actor_role is not command", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestDecisionEvent(backend, makeDecisionInput({
      actor_role: "foreman",
      decision_payload: { promote_to_semantic: true },
      promotion: makePromotion(),
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_PROMOTION_FORBIDDEN");
    assert.equal(backend.snapshotDecisionEvents().length, 0);
  });

  it("promotion authority: nothing written when INGEST_PROMOTION_FORBIDDEN", () => {
    const backend = new InMemoryK2Backend();
    ingestDecisionEvent(backend, makeDecisionInput({
      actor_role: "atlas",
      decision_payload: { promote_to_semantic: true },
      promotion: makePromotion(),
    }));
    assert.equal(backend.snapshotDecisionEvents().length, 0);
    assert.equal(backend.snapshotSemanticFacts().length, 0);
    assert.equal(backend.snapshotSemanticFactEvents().length, 0);
    assert.equal(backend.snapshotEmbeddingRecords().length, 0);
    assert.equal(backend.snapshotEmbeddingStatusEvents().length, 0);
  });

  it("promotion missing: INGEST_PROMOTION_MISSING when target absent", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestDecisionEvent(backend, makeDecisionInput({
      actor_role: "command",
      decision_payload: { promote_to_semantic: true },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_PROMOTION_MISSING");
    assert.equal(backend.snapshotDecisionEvents().length, 0);
  });

  it("promotion eligibility: eligible true with target when promotion gate passes", () => {
    const backend = new InMemoryK2Backend();
    const promo = makePromotion();
    const result = ingestDecisionEvent(backend, makeDecisionInput({
      actor_role: "command",
      decision_payload: { promote_to_semantic: true },
      promotion: promo,
    }));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.promotionEligible.eligible, true);
      if (result.promotionEligible.eligible) {
        assert.equal(result.promotionEligible.target, promo);
      }
    }
  });

  it("no promotion writes: semantic/embedding tables empty after eligible decision", () => {
    const backend = new InMemoryK2Backend();
    ingestDecisionEvent(backend, makeDecisionInput({
      actor_role: "command",
      decision_payload: { promote_to_semantic: true },
      promotion: makePromotion(),
    }));
    assert.equal(backend.snapshotDecisionEvents().length, 1);
    assert.equal(backend.snapshotSemanticFacts().length, 0);
    assert.equal(backend.snapshotSemanticFactEvents().length, 0);
    assert.equal(backend.snapshotEmbeddingRecords().length, 0);
    assert.equal(backend.snapshotEmbeddingStatusEvents().length, 0);
  });

  it("promote_to_semantic absent: promotionEligible false", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestDecisionEvent(backend, makeDecisionInput({
      decision_payload: {},
    }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.promotionEligible.eligible, false);
  });

  it("promote_to_semantic false: promotionEligible false", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestDecisionEvent(backend, makeDecisionInput({
      decision_payload: { promote_to_semantic: false },
    }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.promotionEligible.eligible, false);
  });

  it("caller-supplied id preserved exactly on decision", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestDecisionEvent(backend, makeDecisionInput({ id: "dec-exact" }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.decision.id, "dec-exact");
  });

  it("caller-supplied created_at preserved exactly on decision", () => {
    const backend = new InMemoryK2Backend();
    const ts = new Date("2025-01-01T00:00:00Z");
    const result = ingestDecisionEvent(backend, makeDecisionInput({ created_at: ts }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.decision.created_at, ts);
  });

  it("caller-supplied schema_version preserved exactly on decision", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestDecisionEvent(backend, makeDecisionInput({ schema_version: "42.0" }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.decision.schema_version, "42.0");
  });
});

describe("ingest.ts module hygiene", () => {
  it("no time or ID generation: module source contains no crypto.randomUUID or new Date", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src", "memory", "pipeline", "ingest.ts"),
      "utf8",
    );
    assert.equal(src.includes("crypto.randomUUID"), false, "must not contain crypto.randomUUID");
    assert.equal(src.includes("new Date"), false, "must not contain new Date");
  });
});
