/**
 * Agent OS — K2 Run Step Orchestrator Tests (ingestRunStep)
 *
 * Covers:
 *   - empty episodic array returns INGEST_EPISODIC_EMPTY
 *   - episodic fail-fast: first episodic failure aborts before any decision writes
 *   - decision fail-fast: first decision failure aborts before later decisions/promotions
 *   - promotion skipped when backend lacks appendPromotionChain
 *   - promotion skipped when promotionContext is absent
 *   - promotion fail-fast on first failing eligible promotion
 *   - success counts are exact (episodic-only, episodic+decision, with promotion)
 *   - multiple episodic events: all written, count exact
 *   - module hygiene: no ID or time generation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryK2Backend } from "../src/memory/pipeline/backend.js";
import { ingestRunStep } from "../src/memory/pipeline/run-ingest.js";
import { K2_EVENT_TYPE } from "../src/memory/pipeline/types.js";
import type { K2WriteBackend } from "../src/memory/pipeline/backend.js";
import type { IngestEpisodicInput, IngestDecisionInput, PromotionContext } from "../src/memory/pipeline/run-ingest.js";
import type { PromotionTarget } from "../src/memory/pipeline/ingest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW   = new Date("2026-03-11T00:00:00Z");
const LATER = new Date("2026-03-11T01:00:00Z");

let _seq = 0;
function uid(prefix: string): string { return `${prefix}-${++_seq}`; }

function makeEpisodic(overrides?: Partial<IngestEpisodicInput>): IngestEpisodicInput {
  return {
    id: uid("ep"),
    project_id: "proj-1",
    schema_version: "1.1",
    run_id: "run-1",
    session_id: "sess-1",
    agent_role: "forge",
    event_type: K2_EVENT_TYPE.STEP_STARTED,
    payload: {},
    occurred_at: NOW,
    created_at: NOW,
    ...overrides,
  };
}

function makeDecision(overrides?: Partial<IngestDecisionInput>): IngestDecisionInput {
  return {
    id: uid("dec"),
    project_id: "proj-1",
    schema_version: "1.1",
    run_id: "run-1",
    decision_type: "ACCEPT",
    actor_role: "command",
    episodic_event_id: uid("ep-ref"),
    decision_payload: {},
    decided_at: NOW,
    created_at: NOW,
    ...overrides,
  };
}

function makePromotion(overrides?: Partial<PromotionTarget>): PromotionTarget {
  return {
    fact_id:                          uid("fact"),
    fact_type:                        "CAPABILITY",
    fact_key:                         uid("fk"),
    fact_value:                       { data: true },
    fact_created_at:                  LATER,
    fact_event_id:                    uid("fe"),
    fact_event_observed_at:           NOW,
    fact_event_created_at:            LATER,
    embedding_id:                     uid("emb"),
    embedding_created_at:             LATER,
    embedding_status_id:              uid("es"),
    embedding_status_transitioned_at: LATER,
    embedding_status_created_at:      LATER,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<PromotionContext>): PromotionContext {
  return {
    project_id:        "proj-1",
    schema_version:    "1.1",
    run_id:            "run-1",
    episodic_event_id: uid("ctx-ep"),
    ...overrides,
  };
}

/** Write-only backend: K2WriteBackend only — no appendPromotionChain. */
class WriteOnlyBackend implements K2WriteBackend {
  private readonly _inner = new InMemoryK2Backend();
  appendEpisodicEvent(e: Parameters<K2WriteBackend["appendEpisodicEvent"]>[0]) {
    return this._inner.appendEpisodicEvent(e);
  }
  appendDecisionEvent(e: Parameters<K2WriteBackend["appendDecisionEvent"]>[0]) {
    return this._inner.appendDecisionEvent(e);
  }
  appendSemanticFact(f: Parameters<K2WriteBackend["appendSemanticFact"]>[0]) {
    return this._inner.appendSemanticFact(f);
  }
  appendSemanticFactEvent(l: Parameters<K2WriteBackend["appendSemanticFactEvent"]>[0]) {
    return this._inner.appendSemanticFactEvent(l);
  }
  appendEmbeddingRecord(r: Parameters<K2WriteBackend["appendEmbeddingRecord"]>[0]) {
    return this._inner.appendEmbeddingRecord(r);
  }
  appendEmbeddingStatusEvent(e: Parameters<K2WriteBackend["appendEmbeddingStatusEvent"]>[0]) {
    return this._inner.appendEmbeddingStatusEvent(e);
  }
  hasTerminalEvent(run_id: string): boolean {
    return this._inner.hasTerminalEvent(run_id);
  }
  snapshot() { return this._inner; }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ingestRunStep — episodic contract", () => {

  it("empty episodic array returns INGEST_EPISODIC_EMPTY", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, { episodic: [] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_EPISODIC_EMPTY");
  });

  it("empty episodic: no records written to backend", () => {
    const backend = new InMemoryK2Backend();
    ingestRunStep(backend, { episodic: [] });
    assert.equal(backend.snapshotEpisodicEvents().length, 0);
  });

});

describe("ingestRunStep — episodic-only success", () => {

  it("single episodic: ok:true, episodicWritten=1, others=0", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, { episodic: [makeEpisodic()] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.episodicWritten, 1);
    assert.equal(result.decisionsWritten, 0);
    assert.equal(result.promotionsExecuted, 0);
  });

  it("multiple episodic events: all written, count exact", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic(), makeEpisodic(), makeEpisodic()],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.episodicWritten, 3);
    assert.equal(backend.snapshotEpisodicEvents().length, 3);
  });

});

describe("ingestRunStep — episodic fail-fast", () => {

  it("failing episodic returns INGEST_DUPLICATE immediately", () => {
    const backend = new InMemoryK2Backend();
    const ep = makeEpisodic();
    // Pre-write the event so the second attempt collides.
    ingestRunStep(backend, { episodic: [ep] });
    const result = ingestRunStep(backend, { episodic: [ep] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_DUPLICATE");
  });

  it("episodic failure aborts before any decision is written", () => {
    const backend = new InMemoryK2Backend();
    const ep = makeEpisodic();
    ingestRunStep(backend, { episodic: [ep] });
    const decsBefore = backend.snapshotDecisionEvents().length;

    ingestRunStep(backend, {
      episodic: [ep],
      decisions: [makeDecision()],
    });

    assert.equal(backend.snapshotDecisionEvents().length, decsBefore);
  });

  it("failing second episodic aborts before remaining episodics are written", () => {
    const backend = new InMemoryK2Backend();
    const ep2 = makeEpisodic();
    // Pre-write ep2 to make it duplicate.
    ingestRunStep(backend, { episodic: [ep2] });
    const countBefore = backend.snapshotEpisodicEvents().length;

    const ep1 = makeEpisodic(); // new — would succeed
    const ep3 = makeEpisodic(); // new — must not be reached
    ingestRunStep(backend, { episodic: [ep1, ep2, ep3] });

    // ep1 written (+1), ep2 failed, ep3 not reached.
    assert.equal(backend.snapshotEpisodicEvents().length, countBefore + 1);
  });

});

describe("ingestRunStep — episodic + decision success", () => {

  it("episodic + non-promoting decision: correct counts", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [makeDecision()],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.episodicWritten, 1);
    assert.equal(result.decisionsWritten, 1);
    assert.equal(result.promotionsExecuted, 0);
  });

  it("multiple decisions without promotion: decisionsWritten exact", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [makeDecision(), makeDecision(), makeDecision()],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.decisionsWritten, 3);
    assert.equal(backend.snapshotDecisionEvents().length, 3);
  });

});

describe("ingestRunStep — decision fail-fast", () => {

  it("failing decision returns error immediately", () => {
    const backend = new InMemoryK2Backend();
    const dec = makeDecision();
    // Pre-write dec so a second attempt collides.
    ingestRunStep(backend, { episodic: [makeEpisodic()], decisions: [dec] });
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [dec],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INGEST_DUPLICATE");
  });

  it("decision failure aborts before later decisions are written", () => {
    const backend = new InMemoryK2Backend();
    const dec = makeDecision();
    ingestRunStep(backend, { episodic: [makeEpisodic()], decisions: [dec] });
    const decsBefore = backend.snapshotDecisionEvents().length;

    const dec2 = makeDecision(); // would succeed but must not be reached
    ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [dec, dec2],
    });

    assert.equal(backend.snapshotDecisionEvents().length, decsBefore);
  });

  it("decision failure aborts before any promotion is executed", () => {
    const backend = new InMemoryK2Backend();
    const dec = makeDecision({
      decision_payload: { promote_to_semantic: true },
      promotion: makePromotion(),
    });
    ingestRunStep(backend, { episodic: [makeEpisodic()], decisions: [dec] });

    ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [dec],
      promotionContext: makeContext(),
    });

    // No semantic facts written because decision failed before promotion.
    assert.equal(backend.snapshotSemanticFacts().length, 0);
  });

});

describe("ingestRunStep — promotion skip conditions", () => {

  it("promotion skipped when backend lacks appendPromotionChain", () => {
    const backend = new WriteOnlyBackend();
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [
        makeDecision({
          decision_payload: { promote_to_semantic: true },
          promotion: makePromotion(),
        }),
      ],
      promotionContext: makeContext(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.promotionsExecuted, 0);
    assert.equal(backend.snapshot().snapshotSemanticFacts().length, 0);
  });

  it("promotion skipped when promotionContext is absent", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [
        makeDecision({
          decision_payload: { promote_to_semantic: true },
          promotion: makePromotion(),
        }),
      ],
      // No promotionContext supplied.
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.promotionsExecuted, 0);
    assert.equal(backend.snapshotSemanticFacts().length, 0);
  });

});

describe("ingestRunStep — promotion execution", () => {

  it("eligible decision + full backend + context: promotion executed, count=1", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [
        makeDecision({
          decision_payload: { promote_to_semantic: true },
          promotion: makePromotion(),
        }),
      ],
      promotionContext: makeContext(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.promotionsExecuted, 1);
    assert.equal(backend.snapshotSemanticFacts().length, 1);
    assert.equal(backend.snapshotSemanticFactEvents().length, 1);
    assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
  });

  it("two eligible decisions: both promoted, count=2", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [
        makeDecision({ decision_payload: { promote_to_semantic: true }, promotion: makePromotion() }),
        makeDecision({ decision_payload: { promote_to_semantic: true }, promotion: makePromotion() }),
      ],
      promotionContext: makeContext(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.promotionsExecuted, 2);
    assert.equal(backend.snapshotSemanticFacts().length, 2);
  });

  it("promotion fail-fast: first failing eligible aborts, subsequent not executed", () => {
    const backend = new InMemoryK2Backend();
    const sharedFactKey = `shared-fk-${uid("x")}`;
    // Pre-write a promotion to occupy the fact key.
    ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [
        makeDecision({
          decision_payload: { promote_to_semantic: true },
          promotion: makePromotion({ fact_key: sharedFactKey }),
        }),
      ],
      promotionContext: makeContext(),
    });
    assert.equal(backend.snapshotSemanticFacts().length, 1);

    // Second call: first eligible collides (PROMOTE_DUPLICATE), second is never reached.
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic()],
      decisions: [
        makeDecision({
          decision_payload: { promote_to_semantic: true },
          promotion: makePromotion({ fact_key: sharedFactKey }), // collides
        }),
        makeDecision({
          decision_payload: { promote_to_semantic: true },
          promotion: makePromotion(), // would succeed — must not be reached
        }),
      ],
      promotionContext: makeContext(),
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PROMOTE_DUPLICATE");
    // Only 1 semantic fact total — the second eligible was not executed.
    assert.equal(backend.snapshotSemanticFacts().length, 1);
  });

});

describe("ingestRunStep — exact count invariants", () => {

  it("success result counts match actual backend state", () => {
    const backend = new InMemoryK2Backend();
    const result = ingestRunStep(backend, {
      episodic: [makeEpisodic(), makeEpisodic()],
      decisions: [
        makeDecision(),
        makeDecision({ decision_payload: { promote_to_semantic: true }, promotion: makePromotion() }),
      ],
      promotionContext: makeContext(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.episodicWritten,    backend.snapshotEpisodicEvents().length);
    assert.equal(result.decisionsWritten,   backend.snapshotDecisionEvents().length);
    assert.equal(result.promotionsExecuted, backend.snapshotSemanticFacts().length);
  });

});

describe("run-ingest.ts module hygiene", () => {

  it("no ID or time generation in source", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src", "memory", "pipeline", "run-ingest.ts"),
      "utf8",
    );
    assert.equal(src.includes("crypto.randomUUID"), false, "must not contain crypto.randomUUID");
    assert.equal(src.includes("new Date"), false, "must not contain new Date");
  });

});
