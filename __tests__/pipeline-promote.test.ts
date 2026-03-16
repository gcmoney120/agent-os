/**
 * Agent OS — K2 Promotion Orchestrator Tests
 *
 * Covers:
 *   - executePromotion success: 4 records created with correct fields
 *   - Field mapping from PromotionTarget + PromotionContext
 *   - Duplicate forwarding from backend
 *   - Fixed fields: status PENDING, model_id null, embedding null,
 *     previous_status null, new_status PENDING, transition_reason "promotion"
 *   - Integration: ingestDecisionEvent eligible result feeds executePromotion
 *   - Module hygiene: no time or ID generation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryK2Backend } from "../src/memory/pipeline/backend.js";
import { ingestDecisionEvent } from "../src/memory/pipeline/ingest.js";
import { executePromotion } from "../src/memory/pipeline/promote.js";
import { K2_EVENT_TYPE } from "../src/memory/pipeline/types.js";
import type { PromotionTarget, IngestDecisionInput } from "../src/memory/pipeline/ingest.js";
import type { PromotionContext } from "../src/memory/pipeline/promote.js";

// -- Helpers ------------------------------------------------------------------

const NOW = new Date("2026-03-11T00:00:00Z");
const LATER = new Date("2026-03-11T01:00:00Z");

let _seq = 0;
function uid(prefix: string): string { return `${prefix}-${++_seq}`; }

function makePromotion(overrides?: Partial<PromotionTarget>): PromotionTarget {
  return {
    fact_id: uid("fact"),
    fact_type: "CAPABILITY",
    fact_key: uid("key"),
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

function makeContext(overrides?: Partial<PromotionContext>): PromotionContext {
  return {
    project_id: "proj-1",
    schema_version: "1.1",
    run_id: "run-1",
    episodic_event_id: "ep-1",
    ...overrides,
  };
}

// -- Tests --------------------------------------------------------------------

describe("executePromotion", () => {

  it("success: creates all 4 records", () => {
    const backend = new InMemoryK2Backend();
    const target = makePromotion();
    const ctx = makeContext();
    const result = executePromotion(
      backend,
      { eligible: true, target },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.equal(backend.snapshotSemanticFacts().length, 1);
    assert.equal(backend.snapshotSemanticFactEvents().length, 1);
    assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
  });

  it("fact inherits project_id, schema_version, run_id from context", () => {
    const backend = new InMemoryK2Backend();
    const target = makePromotion();
    const ctx = makeContext({ project_id: "proj-X", schema_version: "9.0", run_id: "run-X" });
    executePromotion(backend, { eligible: true, target }, ctx);
    const fact = backend.snapshotSemanticFacts()[0];
    assert.equal(fact.project_id, "proj-X");
    assert.equal(fact.schema_version, "9.0");
    assert.equal(fact.source_run_id, "run-X");
  });

  it("fact uses caller-supplied id and created_at from target", () => {
    const backend = new InMemoryK2Backend();
    const ts = new Date("2025-06-01T00:00:00Z");
    const target = makePromotion({ fact_id: "my-fact-id", fact_created_at: ts });
    executePromotion(backend, { eligible: true, target }, makeContext());
    const fact = backend.snapshotSemanticFacts()[0];
    assert.equal(fact.id, "my-fact-id");
    assert.equal(fact.created_at, ts);
  });

  it("factEvent links semantic_fact_id to fact and episodic_event_id from context", () => {
    const backend = new InMemoryK2Backend();
    const target = makePromotion({ fact_id: "f-link" });
    const ctx = makeContext({ episodic_event_id: "ep-link" });
    executePromotion(backend, { eligible: true, target }, ctx);
    const fe = backend.snapshotSemanticFactEvents()[0];
    assert.equal(fe.semantic_fact_id, "f-link");
    assert.equal(fe.episodic_event_id, "ep-link");
  });

  it("factEvent uses caller-supplied observed_at from target", () => {
    const backend = new InMemoryK2Backend();
    const obsAt = new Date("2025-12-25T00:00:00Z");
    const target = makePromotion({ fact_event_observed_at: obsAt });
    executePromotion(backend, { eligible: true, target }, makeContext());
    const fe = backend.snapshotSemanticFactEvents()[0];
    assert.equal(fe.observed_at, obsAt);
  });

  it("embedding: status PENDING, model_id null, embedding null", () => {
    const backend = new InMemoryK2Backend();
    executePromotion(backend, { eligible: true, target: makePromotion() }, makeContext());
    const emb = backend.snapshotEmbeddingRecords()[0];
    assert.equal(emb.status, "PENDING");
    assert.equal(emb.model_id, null);
    assert.equal(emb.embedding, null);
  });

  it("embedding links semantic_fact_id to fact", () => {
    const backend = new InMemoryK2Backend();
    const target = makePromotion({ fact_id: "f-emb-link" });
    executePromotion(backend, { eligible: true, target }, makeContext());
    const emb = backend.snapshotEmbeddingRecords()[0];
    assert.equal(emb.semantic_fact_id, "f-emb-link");
  });

  it("embeddingStatus: previous_status null, new_status PENDING, reason promotion", () => {
    const backend = new InMemoryK2Backend();
    executePromotion(backend, { eligible: true, target: makePromotion() }, makeContext());
    const es = backend.snapshotEmbeddingStatusEvents()[0];
    assert.equal(es.previous_status, null);
    assert.equal(es.new_status, "PENDING");
    assert.equal(es.transition_reason, "promotion");
  });

  it("embeddingStatus links embedding_record_id to embedding", () => {
    const backend = new InMemoryK2Backend();
    const target = makePromotion({ embedding_id: "emb-link" });
    executePromotion(backend, { eligible: true, target }, makeContext());
    const es = backend.snapshotEmbeddingStatusEvents()[0];
    assert.equal(es.embedding_record_id, "emb-link");
  });

  it("duplicate: returns PROMOTE_DUPLICATE on backend failure", () => {
    const backend = new InMemoryK2Backend();
    const target = makePromotion({ fact_key: "dup-key" });
    executePromotion(backend, { eligible: true, target }, makeContext());
    // Second promotion with same fact_key collides
    const target2 = makePromotion({ fact_key: "dup-key" });
    const result = executePromotion(backend, { eligible: true, target: target2 }, makeContext());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PROMOTE_DUPLICATE");
  });

  it("duplicate: zero new records on failure", () => {
    const backend = new InMemoryK2Backend();
    const target = makePromotion({ fact_key: "dup-key2" });
    executePromotion(backend, { eligible: true, target }, makeContext());
    const target2 = makePromotion({ fact_key: "dup-key2" });
    executePromotion(backend, { eligible: true, target: target2 }, makeContext());
    assert.equal(backend.snapshotSemanticFacts().length, 1);
    assert.equal(backend.snapshotSemanticFactEvents().length, 1);
    assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
  });

  it("integration: ingestDecisionEvent eligible result feeds executePromotion", () => {
    const backend = new InMemoryK2Backend();
    const promo = makePromotion();
    const decInput: IngestDecisionInput = {
      id: uid("dec"),
      project_id: "proj-1",
      schema_version: "1.1",
      run_id: "run-1",
      decision_type: "ACCEPT",
      actor_role: "command",
      episodic_event_id: "ep-1",
      decision_payload: { promote_to_semantic: true },
      decided_at: NOW,
      created_at: NOW,
      promotion: promo,
    };
    const ingestResult = ingestDecisionEvent(backend, decInput);
    assert.equal(ingestResult.ok, true);
    if (!ingestResult.ok) return;
    assert.equal(ingestResult.promotionEligible.eligible, true);
    if (!ingestResult.promotionEligible.eligible) return;

    const promoteResult = executePromotion(
      backend,
      ingestResult.promotionEligible,
      {
        project_id: decInput.project_id,
        schema_version: decInput.schema_version,
        run_id: decInput.run_id,
        episodic_event_id: decInput.episodic_event_id,
      },
    );
    assert.equal(promoteResult.ok, true);
    assert.equal(backend.snapshotDecisionEvents().length, 1);
    assert.equal(backend.snapshotSemanticFacts().length, 1);
    assert.equal(backend.snapshotSemanticFactEvents().length, 1);
    assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
  });
});

describe("promote.ts module hygiene", () => {
  it("no time or ID generation: module source contains no crypto.randomUUID or new Date", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src", "memory", "pipeline", "promote.ts"),
      "utf8",
    );
    assert.equal(src.includes("crypto.randomUUID"), false, "must not contain crypto.randomUUID");
    assert.equal(src.includes("new Date"), false, "must not contain new Date");
  });
});
