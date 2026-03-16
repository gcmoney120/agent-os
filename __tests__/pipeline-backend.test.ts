/**
 * Agent OS — K2 Write Backend Tests
 *
 * Covers:
 *   - Initial state (empty snapshots, hasTerminalEvent false)
 *   - Append success paths (all 6 tables)
 *   - Multiple appends accumulate
 *   - PK uniqueness by id (all 6 tables)
 *   - Composite UNIQUE constraint enforcement (5 tables with composite keys)
 *   - Non-violation UNIQUE cases (partial key match is not a duplicate)
 *   - Duplicate does not corrupt existing records
 *   - hasTerminalEvent (RUN_SUCCEEDED, RUN_FAILED, run_id scoping, non-terminal)
 *   - Snapshot isolation (copy not reference)
 *   - Store hygiene (no forbidden method patterns)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryK2Backend } from "../src/memory/pipeline/backend.js";
import { K2_EVENT_TYPE } from "../src/memory/pipeline/types.js";
import type {
  K2EpisodicEvent,
  K2DecisionEvent,
  K2SemanticFact,
  K2SemanticFactEvent,
  K2EmbeddingRecord,
  K2EmbeddingStatusEvent,
} from "../src/memory/pipeline/types.js";

// -- Helpers ------------------------------------------------------------------

const NOW = new Date("2026-03-11T00:00:00Z");
let _seq = 0;
function uid(): string { return `id-${++_seq}`; }

function makeEpisodicEvent(overrides?: Partial<K2EpisodicEvent>): K2EpisodicEvent {
  return {
    id: uid(),
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

function makeDecisionEvent(overrides?: Partial<K2DecisionEvent>): K2DecisionEvent {
  return {
    id: uid(),
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

function makeSemanticFact(overrides?: Partial<K2SemanticFact>): K2SemanticFact {
  return {
    id: uid(),
    project_id: "proj-1",
    schema_version: "1.1",
    fact_type: "CAPABILITY",
    fact_key: "key-1",
    fact_value: {},
    source_run_id: "run-1",
    created_at: NOW,
    ...overrides,
  };
}

function makeSemanticFactEvent(overrides?: Partial<K2SemanticFactEvent>): K2SemanticFactEvent {
  return {
    id: uid(),
    project_id: "proj-1",
    schema_version: "1.1",
    semantic_fact_id: "sf-1",
    episodic_event_id: "ep-1",
    observed_at: NOW,
    created_at: NOW,
    ...overrides,
  };
}

function makeEmbeddingRecord(overrides?: Partial<K2EmbeddingRecord>): K2EmbeddingRecord {
  return {
    id: uid(),
    project_id: "proj-1",
    schema_version: "1.1",
    semantic_fact_id: "sf-1",
    status: "PENDING",
    model_id: null,
    embedding: null,
    created_at: NOW,
    ...overrides,
  };
}

function makeEmbeddingStatusEvent(overrides?: Partial<K2EmbeddingStatusEvent>): K2EmbeddingStatusEvent {
  return {
    id: uid(),
    project_id: "proj-1",
    schema_version: "1.1",
    embedding_record_id: "emb-1",
    previous_status: null,
    new_status: "PENDING",
    transition_reason: "initial",
    transitioned_at: NOW,
    created_at: NOW,
    ...overrides,
  };
}

// -- Tests --------------------------------------------------------------------

describe("InMemoryK2Backend", () => {

  // -- Initial state ----------------------------------------------------------

  describe("initial state", () => {
    it("all snapshots are empty arrays", () => {
      const backend = new InMemoryK2Backend();
      assert.deepStrictEqual(backend.snapshotEpisodicEvents(), []);
      assert.deepStrictEqual(backend.snapshotDecisionEvents(), []);
      assert.deepStrictEqual(backend.snapshotSemanticFacts(), []);
      assert.deepStrictEqual(backend.snapshotSemanticFactEvents(), []);
      assert.deepStrictEqual(backend.snapshotEmbeddingRecords(), []);
      assert.deepStrictEqual(backend.snapshotEmbeddingStatusEvents(), []);
    });

    it("hasTerminalEvent returns false for any run_id", () => {
      const backend = new InMemoryK2Backend();
      assert.equal(backend.hasTerminalEvent("run-1"), false);
      assert.equal(backend.hasTerminalEvent("nonexistent"), false);
    });
  });

  // -- Append success paths ---------------------------------------------------

  describe("append success paths", () => {
    it("appendEpisodicEvent returns ok with record", () => {
      const backend = new InMemoryK2Backend();
      const event = makeEpisodicEvent();
      const result = backend.appendEpisodicEvent(event);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.record, event);
      assert.deepStrictEqual(backend.snapshotEpisodicEvents(), [event]);
    });

    it("appendDecisionEvent returns ok with record", () => {
      const backend = new InMemoryK2Backend();
      const event = makeDecisionEvent();
      const result = backend.appendDecisionEvent(event);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.record, event);
      assert.deepStrictEqual(backend.snapshotDecisionEvents(), [event]);
    });

    it("appendSemanticFact returns ok with record", () => {
      const backend = new InMemoryK2Backend();
      const fact = makeSemanticFact();
      const result = backend.appendSemanticFact(fact);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.record, fact);
      assert.deepStrictEqual(backend.snapshotSemanticFacts(), [fact]);
    });

    it("appendSemanticFactEvent returns ok with record", () => {
      const backend = new InMemoryK2Backend();
      const link = makeSemanticFactEvent();
      const result = backend.appendSemanticFactEvent(link);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.record, link);
      assert.deepStrictEqual(backend.snapshotSemanticFactEvents(), [link]);
    });

    it("appendEmbeddingRecord returns ok with record", () => {
      const backend = new InMemoryK2Backend();
      const record = makeEmbeddingRecord();
      const result = backend.appendEmbeddingRecord(record);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.record, record);
      assert.deepStrictEqual(backend.snapshotEmbeddingRecords(), [record]);
    });

    it("appendEmbeddingStatusEvent returns ok with record", () => {
      const backend = new InMemoryK2Backend();
      const event = makeEmbeddingStatusEvent();
      const result = backend.appendEmbeddingStatusEvent(event);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.record, event);
      assert.deepStrictEqual(backend.snapshotEmbeddingStatusEvents(), [event]);
    });

    it("multiple appends accumulate", () => {
      const backend = new InMemoryK2Backend();
      const e1 = makeEpisodicEvent();
      const e2 = makeEpisodicEvent();
      backend.appendEpisodicEvent(e1);
      backend.appendEpisodicEvent(e2);
      assert.equal(backend.snapshotEpisodicEvents().length, 2);
    });
  });

  // -- PK uniqueness by id ---------------------------------------------------

  describe("PK uniqueness by id", () => {
    it("episodic_event rejects duplicate id", () => {
      const backend = new InMemoryK2Backend();
      const first = makeEpisodicEvent({ id: "same-id" });
      const second = makeEpisodicEvent({ id: "same-id" });
      backend.appendEpisodicEvent(first);
      const result = backend.appendEpisodicEvent(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotEpisodicEvents().length, 1);
    });

    it("decision_event rejects duplicate id", () => {
      const backend = new InMemoryK2Backend();
      const first = makeDecisionEvent({ id: "same-id" });
      const second = makeDecisionEvent({ id: "same-id", decision_type: "REJECT" });
      backend.appendDecisionEvent(first);
      const result = backend.appendDecisionEvent(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotDecisionEvents().length, 1);
    });

    it("semantic_fact rejects duplicate id", () => {
      const backend = new InMemoryK2Backend();
      const first = makeSemanticFact({ id: "same-id" });
      const second = makeSemanticFact({ id: "same-id", fact_key: "different-key" });
      backend.appendSemanticFact(first);
      const result = backend.appendSemanticFact(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotSemanticFacts().length, 1);
    });

    it("semantic_fact_event rejects duplicate id", () => {
      const backend = new InMemoryK2Backend();
      const first = makeSemanticFactEvent({ id: "same-id" });
      const second = makeSemanticFactEvent({ id: "same-id", episodic_event_id: "ep-other" });
      backend.appendSemanticFactEvent(first);
      const result = backend.appendSemanticFactEvent(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotSemanticFactEvents().length, 1);
    });

    it("embedding_record rejects duplicate id", () => {
      const backend = new InMemoryK2Backend();
      const first = makeEmbeddingRecord({ id: "same-id" });
      const second = makeEmbeddingRecord({ id: "same-id", semantic_fact_id: "sf-other" });
      backend.appendEmbeddingRecord(first);
      const result = backend.appendEmbeddingRecord(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    });

    it("embedding_status_event rejects duplicate id", () => {
      const backend = new InMemoryK2Backend();
      const first = makeEmbeddingStatusEvent({ id: "same-id" });
      const second = makeEmbeddingStatusEvent({ id: "same-id", new_status: "COMPLETE" });
      backend.appendEmbeddingStatusEvent(first);
      const result = backend.appendEmbeddingStatusEvent(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
    });
  });

  // -- Composite UNIQUE constraint enforcement --------------------------------

  describe("composite UNIQUE constraint enforcement", () => {
    it("decision_event: DUPLICATE on (run_id, decision_type, episodic_event_id)", () => {
      const backend = new InMemoryK2Backend();
      const first = makeDecisionEvent({
        run_id: "r1", decision_type: "ACCEPT", episodic_event_id: "ep-1",
      });
      const second = makeDecisionEvent({
        run_id: "r1", decision_type: "ACCEPT", episodic_event_id: "ep-1",
      });
      backend.appendDecisionEvent(first);
      const result = backend.appendDecisionEvent(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotDecisionEvents().length, 1);
    });

    it("decision_event: different decision_type is not a duplicate", () => {
      const backend = new InMemoryK2Backend();
      backend.appendDecisionEvent(makeDecisionEvent({
        run_id: "r1", decision_type: "ACCEPT", episodic_event_id: "ep-1",
      }));
      const result = backend.appendDecisionEvent(makeDecisionEvent({
        run_id: "r1", decision_type: "REJECT", episodic_event_id: "ep-1",
      }));
      assert.equal(result.ok, true);
      assert.equal(backend.snapshotDecisionEvents().length, 2);
    });

    it("semantic_fact: DUPLICATE on (project_id, fact_type, fact_key)", () => {
      const backend = new InMemoryK2Backend();
      const first = makeSemanticFact({
        project_id: "p1", fact_type: "CAP", fact_key: "k1",
      });
      const second = makeSemanticFact({
        project_id: "p1", fact_type: "CAP", fact_key: "k1",
      });
      backend.appendSemanticFact(first);
      const result = backend.appendSemanticFact(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotSemanticFacts().length, 1);
    });

    it("semantic_fact: different fact_key is not a duplicate", () => {
      const backend = new InMemoryK2Backend();
      backend.appendSemanticFact(makeSemanticFact({
        project_id: "p1", fact_type: "CAP", fact_key: "k1",
      }));
      const result = backend.appendSemanticFact(makeSemanticFact({
        project_id: "p1", fact_type: "CAP", fact_key: "k2",
      }));
      assert.equal(result.ok, true);
      assert.equal(backend.snapshotSemanticFacts().length, 2);
    });

    it("semantic_fact_event: DUPLICATE on (semantic_fact_id, episodic_event_id)", () => {
      const backend = new InMemoryK2Backend();
      const first = makeSemanticFactEvent({
        semantic_fact_id: "sf-1", episodic_event_id: "ep-1",
      });
      const second = makeSemanticFactEvent({
        semantic_fact_id: "sf-1", episodic_event_id: "ep-1",
      });
      backend.appendSemanticFactEvent(first);
      const result = backend.appendSemanticFactEvent(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotSemanticFactEvents().length, 1);
    });

    it("semantic_fact_event: different episodic_event_id is not a duplicate", () => {
      const backend = new InMemoryK2Backend();
      backend.appendSemanticFactEvent(makeSemanticFactEvent({
        semantic_fact_id: "sf-1", episodic_event_id: "ep-1",
      }));
      const result = backend.appendSemanticFactEvent(makeSemanticFactEvent({
        semantic_fact_id: "sf-1", episodic_event_id: "ep-2",
      }));
      assert.equal(result.ok, true);
      assert.equal(backend.snapshotSemanticFactEvents().length, 2);
    });

    it("embedding_record: DUPLICATE on (semantic_fact_id)", () => {
      const backend = new InMemoryK2Backend();
      const first = makeEmbeddingRecord({ semantic_fact_id: "sf-1" });
      const second = makeEmbeddingRecord({ semantic_fact_id: "sf-1" });
      backend.appendEmbeddingRecord(first);
      const result = backend.appendEmbeddingRecord(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    });

    it("embedding_record: different semantic_fact_id is not a duplicate", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEmbeddingRecord(makeEmbeddingRecord({ semantic_fact_id: "sf-1" }));
      const result = backend.appendEmbeddingRecord(makeEmbeddingRecord({ semantic_fact_id: "sf-2" }));
      assert.equal(result.ok, true);
      assert.equal(backend.snapshotEmbeddingRecords().length, 2);
    });

    it("embedding_status_event: DUPLICATE on (embedding_record_id, new_status, transitioned_at)", () => {
      const backend = new InMemoryK2Backend();
      const ts = new Date("2026-03-11T01:00:00Z");
      const first = makeEmbeddingStatusEvent({
        embedding_record_id: "emb-1", new_status: "COMPLETE", transitioned_at: ts,
      });
      const second = makeEmbeddingStatusEvent({
        embedding_record_id: "emb-1", new_status: "COMPLETE", transitioned_at: ts,
      });
      backend.appendEmbeddingStatusEvent(first);
      const result = backend.appendEmbeddingStatusEvent(second);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.existing, first);
      }
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
    });

    it("embedding_status_event: different transitioned_at is not a duplicate", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEmbeddingStatusEvent(makeEmbeddingStatusEvent({
        embedding_record_id: "emb-1", new_status: "COMPLETE",
        transitioned_at: new Date("2026-03-11T01:00:00Z"),
      }));
      const result = backend.appendEmbeddingStatusEvent(makeEmbeddingStatusEvent({
        embedding_record_id: "emb-1", new_status: "COMPLETE",
        transitioned_at: new Date("2026-03-11T02:00:00Z"),
      }));
      assert.equal(result.ok, true);
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 2);
    });
  });

  // -- Duplicate does not corrupt --------------------------------------------

  describe("duplicate does not corrupt existing records", () => {
    it("rejected PK duplicate leaves original record unchanged", () => {
      const backend = new InMemoryK2Backend();
      const original = makeEpisodicEvent({
        id: "fixed-id",
        payload: { original: true },
      });
      backend.appendEpisodicEvent(original);
      const impostor = makeEpisodicEvent({
        id: "fixed-id",
        payload: { impostor: true },
      });
      backend.appendEpisodicEvent(impostor);
      const snapshot = backend.snapshotEpisodicEvents();
      assert.equal(snapshot.length, 1);
      assert.deepStrictEqual(snapshot[0].payload, { original: true });
    });

    it("rejected composite duplicate leaves original record unchanged", () => {
      const backend = new InMemoryK2Backend();
      const original = makeSemanticFact({
        project_id: "p1", fact_type: "CAP", fact_key: "k1",
        fact_value: { original: true },
      });
      backend.appendSemanticFact(original);
      const impostor = makeSemanticFact({
        project_id: "p1", fact_type: "CAP", fact_key: "k1",
        fact_value: { impostor: true },
      });
      backend.appendSemanticFact(impostor);
      const snapshot = backend.snapshotSemanticFacts();
      assert.equal(snapshot.length, 1);
      assert.deepStrictEqual(snapshot[0].fact_value, { original: true });
    });
  });

  // -- hasTerminalEvent -------------------------------------------------------

  describe("hasTerminalEvent", () => {
    it("returns true after RUN_SUCCEEDED for the given run_id", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEpisodicEvent(makeEpisodicEvent({
        run_id: "r1", event_type: K2_EVENT_TYPE.RUN_SUCCEEDED,
      }));
      assert.equal(backend.hasTerminalEvent("r1"), true);
    });

    it("returns true after RUN_FAILED for the given run_id", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEpisodicEvent(makeEpisodicEvent({
        run_id: "r1", event_type: K2_EVENT_TYPE.RUN_FAILED,
      }));
      assert.equal(backend.hasTerminalEvent("r1"), true);
    });

    it("returns false for non-terminal event types", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEpisodicEvent(makeEpisodicEvent({
        run_id: "r1", event_type: K2_EVENT_TYPE.STEP_SUCCEEDED,
      }));
      assert.equal(backend.hasTerminalEvent("r1"), false);
    });

    it("is scoped to run_id", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEpisodicEvent(makeEpisodicEvent({
        run_id: "r1", event_type: K2_EVENT_TYPE.RUN_SUCCEEDED,
      }));
      assert.equal(backend.hasTerminalEvent("r1"), true);
      assert.equal(backend.hasTerminalEvent("r2"), false);
    });
  });

  // -- Snapshot isolation -----------------------------------------------------

  describe("snapshot isolation", () => {
    it("snapshot returns a copy, not a reference to internal state", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEpisodicEvent(makeEpisodicEvent());
      const snap1 = backend.snapshotEpisodicEvents();
      backend.appendEpisodicEvent(makeEpisodicEvent());
      const snap2 = backend.snapshotEpisodicEvents();
      assert.equal(snap1.length, 1);
      assert.equal(snap2.length, 2);
    });
  });

  // -- appendPromotionChain (atomic) ------------------------------------------

  describe("appendPromotionChain", () => {
    function makeChain(overrides?: {
      factId?: string; factKey?: string;
      feId?: string; feSfId?: string; feEpId?: string;
      embId?: string; embSfId?: string;
      esId?: string; esEmbId?: string; esStatus?: string; esAt?: Date;
    }) {
      const o = overrides ?? {};
      const factId = o.factId ?? uid();
      const embId = o.embId ?? uid();
      return {
        fact: makeSemanticFact({
          id: factId,
          fact_key: o.factKey ?? uid(),
        }),
        factEvent: makeSemanticFactEvent({
          id: o.feId ?? uid(),
          semantic_fact_id: o.feSfId ?? factId,
          episodic_event_id: o.feEpId ?? uid(),
        }),
        embedding: makeEmbeddingRecord({
          id: embId,
          semantic_fact_id: o.embSfId ?? factId,
        }),
        embeddingStatus: makeEmbeddingStatusEvent({
          id: o.esId ?? uid(),
          embedding_record_id: o.esEmbId ?? embId,
          new_status: o.esStatus ?? "PENDING",
          transitioned_at: o.esAt ?? NOW,
        }),
      };
    }

    it("success: appends all 4 records and returns ok", () => {
      const backend = new InMemoryK2Backend();
      const chain = makeChain();
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.chain, chain);
      assert.equal(backend.snapshotSemanticFacts().length, 1);
      assert.equal(backend.snapshotSemanticFactEvents().length, 1);
      assert.equal(backend.snapshotEmbeddingRecords().length, 1);
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
    });

    it("semantic_fact PK duplicate: zero writes", () => {
      const backend = new InMemoryK2Backend();
      backend.appendSemanticFact(makeSemanticFact({ id: "dup-fact", fact_key: "existing" }));
      const chain = makeChain({ factId: "dup-fact", factKey: "new-key" });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DUPLICATE");
        assert.equal(result.table, "semantic_fact");
      }
      assert.equal(backend.snapshotSemanticFacts().length, 1);
      assert.equal(backend.snapshotSemanticFactEvents().length, 0);
      assert.equal(backend.snapshotEmbeddingRecords().length, 0);
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 0);
    });

    it("semantic_fact composite duplicate: zero writes", () => {
      const backend = new InMemoryK2Backend();
      backend.appendSemanticFact(makeSemanticFact({ fact_key: "shared-key" }));
      const chain = makeChain({ factKey: "shared-key" });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.table, "semantic_fact");
      assert.equal(backend.snapshotSemanticFacts().length, 1);
      assert.equal(backend.snapshotSemanticFactEvents().length, 0);
      assert.equal(backend.snapshotEmbeddingRecords().length, 0);
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 0);
    });

    it("semantic_fact_event PK duplicate: zero writes", () => {
      const backend = new InMemoryK2Backend();
      backend.appendSemanticFactEvent(makeSemanticFactEvent({ id: "dup-fe" }));
      const chain = makeChain({ feId: "dup-fe" });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.table, "semantic_fact_event");
      assert.equal(backend.snapshotSemanticFacts().length, 0);
      assert.equal(backend.snapshotSemanticFactEvents().length, 1);
      assert.equal(backend.snapshotEmbeddingRecords().length, 0);
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 0);
    });

    it("semantic_fact_event composite duplicate: zero writes", () => {
      const backend = new InMemoryK2Backend();
      backend.appendSemanticFactEvent(makeSemanticFactEvent({
        semantic_fact_id: "sf-x", episodic_event_id: "ep-x",
      }));
      const chain = makeChain({ feSfId: "sf-x", feEpId: "ep-x" });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.table, "semantic_fact_event");
      assert.equal(backend.snapshotSemanticFacts().length, 0);
      assert.equal(backend.snapshotSemanticFactEvents().length, 1);
    });

    it("embedding_record PK duplicate: zero writes", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEmbeddingRecord(makeEmbeddingRecord({ id: "dup-emb", semantic_fact_id: "other" }));
      const chain = makeChain({ embId: "dup-emb" });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.table, "embedding_record");
      assert.equal(backend.snapshotSemanticFacts().length, 0);
      assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    });

    it("embedding_record composite duplicate: zero writes", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEmbeddingRecord(makeEmbeddingRecord({ semantic_fact_id: "sf-dup" }));
      const chain = makeChain({ embSfId: "sf-dup" });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.table, "embedding_record");
      assert.equal(backend.snapshotSemanticFacts().length, 0);
      assert.equal(backend.snapshotEmbeddingRecords().length, 1);
    });

    it("embedding_status_event PK duplicate: zero writes", () => {
      const backend = new InMemoryK2Backend();
      backend.appendEmbeddingStatusEvent(makeEmbeddingStatusEvent({ id: "dup-es" }));
      const chain = makeChain({ esId: "dup-es" });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.table, "embedding_status_event");
      assert.equal(backend.snapshotSemanticFacts().length, 0);
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
    });

    it("embedding_status_event composite duplicate: zero writes", () => {
      const backend = new InMemoryK2Backend();
      const ts = new Date("2026-03-11T05:00:00Z");
      backend.appendEmbeddingStatusEvent(makeEmbeddingStatusEvent({
        embedding_record_id: "emb-y", new_status: "PENDING", transitioned_at: ts,
      }));
      const chain = makeChain({ esEmbId: "emb-y", esStatus: "PENDING", esAt: ts });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.table, "embedding_status_event");
      assert.equal(backend.snapshotSemanticFacts().length, 0);
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 1);
    });

    it("atomicity: no records appended when a later table fails", () => {
      const backend = new InMemoryK2Backend();
      // Pre-populate embedding_record to cause failure at step 3
      backend.appendEmbeddingRecord(makeEmbeddingRecord({ semantic_fact_id: "will-collide" }));
      const chain = makeChain({ embSfId: "will-collide" });
      const result = backend.appendPromotionChain(chain);
      assert.equal(result.ok, false);
      // fact and factEvent should NOT have been appended
      assert.equal(backend.snapshotSemanticFacts().length, 0);
      assert.equal(backend.snapshotSemanticFactEvents().length, 0);
      // embedding_record was pre-existing (1), not 2
      assert.equal(backend.snapshotEmbeddingRecords().length, 1);
      assert.equal(backend.snapshotEmbeddingStatusEvents().length, 0);
    });
  });

  // -- Store hygiene ----------------------------------------------------------

  describe("store hygiene", () => {
    it("no update, delete, remove, clear, or reset methods exist", () => {
      const backend = new InMemoryK2Backend();
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(backend));
      const forbidden = /update|delete|remove|clear|reset/i;
      const violations = proto.filter((name) => forbidden.test(name));
      assert.deepStrictEqual(violations, []);
    });
  });
});
