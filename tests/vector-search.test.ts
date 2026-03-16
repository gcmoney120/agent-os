/**
 * Agent OS - K5 Vector Search Retrieval
 * Tests for vectorSearch, query guards, pagination.
 *
 * Read-only logic tests. No DB access. No mutation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { vectorSearch } from "../src/memory/vector-search/vector-search.js";
import { guardVectorSearch } from "../src/memory/vector-search/query-guards.js";
import { K5_ERROR_CODE } from "../src/memory/vector-search/types.js";
import {
  encodeVectorCursor,
  decodeVectorCursor,
} from "../src/memory/vector-search/pagination.js";

import type { K5ReadBackend } from "../src/memory/vector-search/types.js";
import type { K2EmbeddingRecord, K2SemanticFact } from "../src/memory/pipeline/types.js";

const PROJECT = "proj-k5-001";
const OTHER_PROJECT = "proj-k5-002";
const MODEL = "text-embedding-3-small";
const OTHER_MODEL = "text-embedding-ada-002";
const SV = "1.0";

const T0 = new Date("2026-03-11T00:00:00.000Z");
const T1 = new Date("2026-03-11T00:00:01.000Z");
const T2 = new Date("2026-03-11T00:00:02.000Z");

function makeVector(value: number): number[] {
  const v = new Array(1536).fill(0);
  v[0] = value;
  return v;
}

let _factSeq = 0;
function factId(): string { return "k5-fact-" + String(++_factSeq); }

let _erSeq = 0;
function erId(): string { return "k5-er-" + String(++_erSeq); }

function makeFact(overrides?: Partial<K2SemanticFact>): K2SemanticFact {
  return {
    id: factId(),
    project_id: PROJECT,
    schema_version: SV,
    fact_type: "observation",
    fact_key: "test-key",
    fact_value: { text: "test value" },
    source_run_id: "run-001",
    created_at: T0,
    ...overrides,
  };
}

function makeEmbeddingRecord(
  fact: K2SemanticFact,
  embedding: number[],
  overrides?: Partial<K2EmbeddingRecord>,
): K2EmbeddingRecord {
  return {
    id: erId(),
    project_id: fact.project_id,
    schema_version: SV,
    semantic_fact_id: fact.id,
    status: "COMPLETE",
    model_id: MODEL,
    embedding,
    created_at: fact.created_at,
    ...overrides,
  };
}

function makeBackend(
  facts: K2SemanticFact[],
  records: K2EmbeddingRecord[],
): K5ReadBackend {
  return {
    allSemanticFacts: () => facts,
    allEmbeddingRecords: () => records,
  };
}

function validParams(overrides?: Record<string, unknown>) {
  return {
    project_id: PROJECT,
    query_vector: makeVector(1),
    model_id: MODEL,
    ...overrides,
  };
}

describe("K5 query guards", () => {
  it("rejects missing project_id (AC-K5-07)", () => {
    const r = guardVectorSearch({ ...validParams(), project_id: "" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, K5_ERROR_CODE.MISSING_PROJECT_ID);
  });

  it("rejects missing query_vector (AC-K5-06)", () => {
    const r = guardVectorSearch({
      project_id: PROJECT,
      query_vector: undefined as any,
      model_id: MODEL,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, K5_ERROR_CODE.MISSING_QUERY_VECTOR);
  });

  it("rejects wrong vector dimension (AC-K5-06)", () => {
    const r = guardVectorSearch({
      ...validParams(),
      query_vector: [1, 2, 3],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, K5_ERROR_CODE.INVALID_VECTOR_DIMENSION);
  });

  it("rejects missing model_id", () => {
    const r = guardVectorSearch({ ...validParams(), model_id: "" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, K5_ERROR_CODE.MISSING_MODEL_ID);
  });

  it("rejects min_score outside 0-1 (AC-K5-08)", () => {
    const r = guardVectorSearch({ ...validParams(), min_score: 1.5 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, K5_ERROR_CODE.INVALID_SCORE_THRESHOLD);
  });

  it("rejects negative min_score", () => {
    const r = guardVectorSearch({ ...validParams(), min_score: -0.1 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, K5_ERROR_CODE.INVALID_SCORE_THRESHOLD);
  });

  it("rejects exclusion list > 50 (AC-K5-14)", () => {
    const ids = Array.from({ length: 51 }, (_, i) => "fact-" + String(i));
    const r = guardVectorSearch({ ...validParams(), exclude_fact_ids: ids });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, K5_ERROR_CODE.EXCLUSION_LIST_TOO_LARGE);
  });

  it("rejects malformed cursor", () => {
    const r = guardVectorSearch({ ...validParams(), cursor: "not-valid" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, K5_ERROR_CODE.INVALID_CURSOR);
  });

  it("clamps limit to 100", () => {
    const r = guardVectorSearch({ ...validParams(), limit: 200 });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.params.resolvedLimit, 100);
  });

  it("defaults limit to 10", () => {
    const r = guardVectorSearch(validParams());
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.params.resolvedLimit, 10);
  });

  it("defaults include_score to true", () => {
    const r = guardVectorSearch(validParams());
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.params.include_score, true);
  });
});

describe("K5 pagination cursors", () => {
  it("round-trips encode/decode", () => {
    const encoded = encodeVectorCursor(0.95, "2026-03-11T00:00:00.000Z", "er-1");
    const decoded = decodeVectorCursor(encoded);
    assert.ok(decoded);
    assert.equal(decoded.last_similarity, 0.95);
    assert.equal(decoded.last_created_at, "2026-03-11T00:00:00.000Z");
    assert.equal(decoded.last_id, "er-1");
  });

  it("rejects invalid base64", () => {
    assert.equal(decodeVectorCursor("%%%invalid%%%"), null);
  });

  it("rejects wrong version", () => {
    const payload = JSON.stringify({ v: "k3v1", last_similarity: 0.5, last_created_at: "2026-01-01T00:00:00Z", last_id: "x" });
    const encoded = Buffer.from(payload, "utf-8").toString("base64");
    assert.equal(decodeVectorCursor(encoded), null);
  });

  it("rejects missing fields", () => {
    const payload = JSON.stringify({ v: "k5v1", last_similarity: 0.5 });
    const encoded = Buffer.from(payload, "utf-8").toString("base64");
    assert.equal(decodeVectorCursor(encoded), null);
  });
});

describe("K5 vectorSearch", () => {
  it("returns empty result for empty backend (AC-K5-10)", () => {
    const backend = makeBackend([], []);
    const r = vectorSearch(backend, validParams());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 0);
      assert.equal(r.page.next_cursor, null);
      assert.equal(r.page.has_more, false);
    }
  });

  it("enforces project isolation (AC-K5-01)", () => {
    const factA = makeFact({ project_id: PROJECT, created_at: T0 });
    const factB = makeFact({ project_id: OTHER_PROJECT, created_at: T1 });
    const erA = makeEmbeddingRecord(factA, makeVector(1));
    const erB = makeEmbeddingRecord(factB, makeVector(1), { project_id: OTHER_PROJECT });
    const backend = makeBackend([factA, factB], [erA, erB]);

    const r = vectorSearch(backend, validParams());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 1);
      assert.equal(r.page.items[0].fact_id, factA.id);
    }
  });

  it("enforces model homogeneity (AC-K5-02)", () => {
    const fact = makeFact({ created_at: T0 });
    const erCorrect = makeEmbeddingRecord(fact, makeVector(1), { model_id: MODEL });
    const erWrong = makeEmbeddingRecord(fact, makeVector(1), {
      id: erId(),
      model_id: OTHER_MODEL,
      semantic_fact_id: fact.id,
    });
    const backend = makeBackend([fact], [erCorrect, erWrong]);

    const r = vectorSearch(backend, validParams());
    assert.equal(r.ok, true);
    if (r.ok) {
      for (const item of r.page.items) {
        assert.equal(item.model_id, MODEL);
      }
    }
  });

  it("excludes non-COMPLETE records (AC-K5-05)", () => {
    const fact = makeFact({ created_at: T0 });
    const erComplete = makeEmbeddingRecord(fact, makeVector(1));
    const erPending = makeEmbeddingRecord(fact, makeVector(1), {
      id: erId(),
      status: "PENDING",
      embedding: null,
      model_id: null,
    });
    const erFailed = makeEmbeddingRecord(fact, makeVector(1), {
      id: erId(),
      status: "FAILED",
    });
    const backend = makeBackend([fact], [erComplete, erPending, erFailed]);

    const r = vectorSearch(backend, validParams());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 1);
      assert.equal(r.page.items[0].embedding_record_id, erComplete.id);
    }
  });

  it("orders by cosine similarity descending (AC-K5-03)", () => {
    const factHigh = makeFact({ created_at: T0 });
    const factLow = makeFact({ created_at: T1 });
    const erHigh = makeEmbeddingRecord(factHigh, makeVector(0.9), { created_at: T0 });
    const erLow = makeEmbeddingRecord(factLow, makeVector(0.1), { created_at: T1 });
    const backend = makeBackend([factHigh, factLow], [erLow, erHigh]);

    const r = vectorSearch(backend, validParams());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 2);
      assert.equal(r.page.items[0].fact_id, factHigh.id);
      assert.equal(r.page.items[1].fact_id, factLow.id);
    }
  });

  it("tie-breaks by created_at ASC then id ASC (AC-K5-04)", () => {
    const factOlder = makeFact({ created_at: T0 });
    const factNewer = makeFact({ created_at: T1 });
    const erOlder = makeEmbeddingRecord(factOlder, makeVector(1), { created_at: T0 });
    const erNewer = makeEmbeddingRecord(factNewer, makeVector(1), { created_at: T1 });
    const backend = makeBackend([factNewer, factOlder], [erNewer, erOlder]);

    const r = vectorSearch(backend, validParams());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 2);
      assert.equal(r.page.items[0].fact_id, factOlder.id);
      assert.equal(r.page.items[1].fact_id, factNewer.id);
    }
  });

  it("applies min_score filter (AC-K5-08)", () => {
    const factHigh = makeFact({ created_at: T0 });
    const factLow = makeFact({ created_at: T1 });
    // Use orthogonal vector for low similarity (non-zero at index 1 only)
    const lowVec = new Array(1536).fill(0);
    lowVec[1] = 1;
    const erHigh = makeEmbeddingRecord(factHigh, makeVector(0.95), { created_at: T0 });
    const erLow = makeEmbeddingRecord(factLow, lowVec, { created_at: T1 });
    const backend = makeBackend([factHigh, factLow], [erHigh, erLow]);

    const r = vectorSearch(backend, { ...validParams(), min_score: 0.5 });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 1);
      assert.equal(r.page.items[0].fact_id, factHigh.id);
    }
  });

  it("applies fact_type filter (AC-K5-12)", () => {
    const factObs = makeFact({ fact_type: "observation", created_at: T0 });
    const factRule = makeFact({ fact_type: "rule", created_at: T1 });
    const erObs = makeEmbeddingRecord(factObs, makeVector(1), { created_at: T0 });
    const erRule = makeEmbeddingRecord(factRule, makeVector(1), { created_at: T1 });
    const backend = makeBackend([factObs, factRule], [erObs, erRule]);

    const r = vectorSearch(backend, { ...validParams(), fact_type: ["rule"] });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 1);
      assert.equal(r.page.items[0].fact_type, "rule");
    }
  });

  it("applies source_run_id filter (AC-K5-13)", () => {
    const factR1 = makeFact({ source_run_id: "run-001", created_at: T0 });
    const factR2 = makeFact({ source_run_id: "run-002", created_at: T1 });
    const erR1 = makeEmbeddingRecord(factR1, makeVector(1), { created_at: T0 });
    const erR2 = makeEmbeddingRecord(factR2, makeVector(1), { created_at: T1 });
    const backend = makeBackend([factR1, factR2], [erR1, erR2]);

    const r = vectorSearch(backend, { ...validParams(), source_run_id: "run-002" });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 1);
      assert.equal(r.page.items[0].source_run_id, "run-002");
    }
  });

  it("applies exclude_fact_ids filter (AC-K5-14)", () => {
    const fact1 = makeFact({ created_at: T0 });
    const fact2 = makeFact({ created_at: T1 });
    const er1 = makeEmbeddingRecord(fact1, makeVector(1), { created_at: T0 });
    const er2 = makeEmbeddingRecord(fact2, makeVector(1), { created_at: T1 });
    const backend = makeBackend([fact1, fact2], [er1, er2]);

    const r = vectorSearch(backend, { ...validParams(), exclude_fact_ids: [fact1.id] });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 1);
      assert.equal(r.page.items[0].fact_id, fact2.id);
    }
  });

  it("does not return raw embedding vector (AC-K5-11)", () => {
    const fact = makeFact({ created_at: T0 });
    const er = makeEmbeddingRecord(fact, makeVector(1));
    const backend = makeBackend([fact], [er]);

    const r = vectorSearch(backend, validParams());
    assert.equal(r.ok, true);
    if (r.ok) {
      for (const item of r.page.items) {
        assert.equal((item as any).embedding, undefined);
        assert.equal((item as any).query_vector, undefined);
      }
    }
  });

  it("includes score when include_score is true", () => {
    const fact = makeFact({ created_at: T0 });
    const er = makeEmbeddingRecord(fact, makeVector(1));
    const backend = makeBackend([fact], [er]);

    const r = vectorSearch(backend, { ...validParams(), include_score: true });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 1);
      assert.equal(typeof r.page.items[0].score, "number");
      assert.ok(r.page.items[0].score! > 0);
    }
  });

  it("omits score when include_score is false", () => {
    const fact = makeFact({ created_at: T0 });
    const er = makeEmbeddingRecord(fact, makeVector(1));
    const backend = makeBackend([fact], [er]);

    const r = vectorSearch(backend, { ...validParams(), include_score: false });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items.length, 1);
      assert.equal(r.page.items[0].score, undefined);
    }
  });

  it("paginates correctly with no duplicates (AC-K5-09)", () => {
    const facts: K2SemanticFact[] = [];
    const records: K2EmbeddingRecord[] = [];
    for (let i = 1; i <= 5; i++) {
      const f = makeFact({ created_at: new Date("2026-03-11T00:00:0" + String(i) + ".000Z") });
      const er = makeEmbeddingRecord(f, makeVector(i * 0.1), {
        created_at: new Date("2026-03-11T00:00:0" + String(i) + ".000Z"),
      });
      facts.push(f);
      records.push(er);
    }
    const backend = makeBackend(facts, records);

    const r1 = vectorSearch(backend, { ...validParams(), limit: 2 });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    assert.equal(r1.page.items.length, 2);
    assert.equal(r1.page.has_more, true);
    assert.ok(r1.page.next_cursor);

    const r2 = vectorSearch(backend, { ...validParams(), limit: 2, cursor: r1.page.next_cursor! });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.page.items.length, 2);
    assert.equal(r2.page.has_more, true);

    const r3 = vectorSearch(backend, { ...validParams(), limit: 2, cursor: r2.page.next_cursor! });
    assert.equal(r3.ok, true);
    if (!r3.ok) return;
    assert.equal(r3.page.items.length, 1);
    assert.equal(r3.page.has_more, false);
    assert.equal(r3.page.next_cursor, null);

    const allFactIds = [
      ...r1.page.items.map((i) => i.fact_id),
      ...r2.page.items.map((i) => i.fact_id),
      ...r3.page.items.map((i) => i.fact_id),
    ];
    const uniqueIds = new Set(allFactIds);
    assert.equal(uniqueIds.size, 5);
    assert.equal(allFactIds.length, 5);
  });

  it("no write side effects (AC-K5-15)", () => {
    const fact = makeFact({ created_at: T0 });
    const er = makeEmbeddingRecord(fact, makeVector(1));
    const facts = [fact];
    const records = [er];
    const backend = makeBackend(facts, records);

    const factsBefore = JSON.stringify(facts);
    const recordsBefore = JSON.stringify(records);

    vectorSearch(backend, validParams());

    assert.equal(JSON.stringify(facts), factsBefore);
    assert.equal(JSON.stringify(records), recordsBefore);
  });

  it("returns schema_version on all result items", () => {
    const fact = makeFact({ created_at: T0, schema_version: "2.0" });
    const er = makeEmbeddingRecord(fact, makeVector(1));
    const backend = makeBackend([fact], [er]);

    const r = vectorSearch(backend, validParams());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.page.items[0].fact_schema_version, "2.0");
    }
  });
});
