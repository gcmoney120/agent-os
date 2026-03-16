/**
 * Agent OS — K6 Hybrid Memory Retrieval
 * Tests covering AC-K6-01 through AC-K6-29 + arm-k3 unit tests.
 *
 * Read-only logic tests. No DB access. No mutation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hybridSearch, computeArmFetchLimit } from "../src/memory/hybrid-search/hybrid-search.js";
import { validateHybridSearchParams, K6_ERROR_CODE } from "../src/memory/hybrid-search/types.js";
import { mergeArmResults } from "../src/memory/hybrid-search/merge.js";
import { rankMergedResults } from "../src/memory/hybrid-search/rank.js";
import {
  encodeK6Cursor,
  decodeK6Cursor,
  validateCursor,
} from "../src/memory/hybrid-search/cursor.js";
import { fetchK3Arm } from "../src/memory/hybrid-search/arm-k3.js";

import type { K6ReadBackend } from "../src/memory/hybrid-search/hybrid-search.js";
import type { HybridSearchParams, HybridSearchResult } from "../src/memory/hybrid-search/types.js";
import type {
  K2SemanticFact,
  K2EmbeddingRecord,
  K2EpisodicEvent,
  K2DecisionEvent,
  K2SemanticFactEvent,
  K2EmbeddingStatusEvent,
} from "../src/memory/pipeline/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_A = "proj-k6-a";
const PROJECT_B = "proj-k6-b";
const MODEL = "text-embedding-3-small";
const SV = "1.0";

const T0 = new Date("2026-03-12T00:00:00.000Z");
const T1 = new Date("2026-03-12T00:00:01.000Z");
const T2 = new Date("2026-03-12T00:00:02.000Z");
const T3 = new Date("2026-03-12T00:00:03.000Z");
const T4 = new Date("2026-03-12T00:00:04.000Z");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(value: number): number[] {
  const v = new Array(1536).fill(0);
  v[0] = value;
  return v;
}

const QUERY_VECTOR = makeVector(1.0);

let _factSeq = 0;
function factId(): string { return "k6-fact-" + String(++_factSeq).padStart(3, "0"); }

let _erSeq = 0;
function erId(): string { return "k6-er-" + String(++_erSeq).padStart(3, "0"); }

function makeFact(overrides?: Partial<K2SemanticFact>): K2SemanticFact {
  return {
    id: factId(),
    project_id: PROJECT_A,
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
): K6ReadBackend {
  return {
    allSemanticFacts: () => facts,
    allEmbeddingRecords: () => records,
    allEpisodicEvents: () => [] as K2EpisodicEvent[],
    allDecisionEvents: () => [] as K2DecisionEvent[],
    allSemanticFactEvents: () => [] as K2SemanticFactEvent[],
    allEmbeddingStatusEvents: () => [] as K2EmbeddingStatusEvent[],
  };
}

/**
 * Backend that simulates K3 arm failure.
 * K3 arm calls allSemanticFacts() first; K5 arm also calls it.
 * Use a call counter so the first call (K3) throws and subsequent
 * calls (K5) succeed. This matches the call order in hybridSearch.
 */
function makeBrokenK3Backend(
  facts: K2SemanticFact[],
  records: K2EmbeddingRecord[],
): K6ReadBackend {
  let factCallCount = 0;
  return {
    allSemanticFacts: () => {
      factCallCount++;
      if (factCallCount === 1) throw new Error("K3 backend failure");
      return facts;
    },
    allEmbeddingRecords: () => records,
    allEpisodicEvents: () => [] as K2EpisodicEvent[],
    allDecisionEvents: () => [] as K2DecisionEvent[],
    allSemanticFactEvents: () => [] as K2SemanticFactEvent[],
    allEmbeddingStatusEvents: () => [] as K2EmbeddingStatusEvent[],
  };
}

/** Backend where allEmbeddingRecords throws — simulates K5 arm failure */
function makeBrokenK5Backend(
  facts: K2SemanticFact[],
  records: K2EmbeddingRecord[],
): K6ReadBackend {
  return {
    allSemanticFacts: () => facts,
    allEmbeddingRecords: () => { throw new Error("K5 backend failure"); },
    allEpisodicEvents: () => [] as K2EpisodicEvent[],
    allDecisionEvents: () => [] as K2DecisionEvent[],
    allSemanticFactEvents: () => [] as K2SemanticFactEvent[],
    allEmbeddingStatusEvents: () => [] as K2EmbeddingStatusEvent[],
  };
}

/** Backend where both data accessors throw */
function makeBothBrokenBackend(): K6ReadBackend {
  return {
    allSemanticFacts: () => { throw new Error("K3 backend failure"); },
    allEmbeddingRecords: () => { throw new Error("K5 backend failure"); },
    allEpisodicEvents: () => [] as K2EpisodicEvent[],
    allDecisionEvents: () => [] as K2DecisionEvent[],
    allSemanticFactEvents: () => [] as K2SemanticFactEvent[],
    allEmbeddingStatusEvents: () => [] as K2EmbeddingStatusEvent[],
  };
}

function baseParams(overrides?: Partial<HybridSearchParams>): HybridSearchParams {
  return {
    project_id: PROJECT_A,
    query_vector: QUERY_VECTOR,
    model_id: MODEL,
    ...overrides,
  };
}

/** Deep-clone for structural comparison (serializable objects only) */
function snapshot<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ===========================================================================
// ARM-K3 UNIT TESTS (Command-requested)
// ===========================================================================

describe("K6 arm-k3 unit tests", () => {
  it("K3 arm returns all project-scoped facts without cursor-based truncation", () => {
    // Behavioral proof: all facts in project are returned, confirming
    // no cursor-based pagination is restricting the result set.
    const fact1 = makeFact({ created_at: T0 });
    const fact2 = makeFact({ created_at: T1 });
    const fact3 = makeFact({ created_at: T2 });
    const backend = makeBackend([fact1, fact2, fact3], []);
    const validated = validateHybridSearchParams(baseParams())!;
    assert.ok(validated.ok);
    const result = fetchK3Arm(backend, validated.validated, 60);
    assert.ok(result.ok);
    assert.equal(result.items.length, 3);
    const ids = new Set(result.items.map((i) => i.fact_id));
    assert.ok(ids.has(fact1.id));
    assert.ok(ids.has(fact2.id));
    assert.ok(ids.has(fact3.id));
  });

  it("fact_type filter constrains K3 arm results", () => {
    const factA = makeFact({ fact_type: "observation" });
    const factB = makeFact({ fact_type: "decision" });
    const backend = makeBackend([factA, factB], []);
    const validated = validateHybridSearchParams(baseParams({
      structured_filters: { fact_type: ["observation"] },
    }))!;
    assert.ok(validated.ok);
    const result = fetchK3Arm(backend, validated.validated, 60);
    assert.ok(result.ok);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].fact_type, "observation");
  });

  it("created_at filters constrain K3 arm results", () => {
    const factEarly = makeFact({ created_at: T0 });
    const factLate = makeFact({ created_at: T2 });
    const backend = makeBackend([factEarly, factLate], []);
    const validated = validateHybridSearchParams(baseParams({
      structured_filters: {
        created_at_from: T1.toISOString(),
        created_at_to: T3.toISOString(),
      },
    }))!;
    assert.ok(validated.ok);
    const result = fetchK3Arm(backend, validated.validated, 60);
    assert.ok(result.ok);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].fact_created_at, T2.toISOString());
  });

  it("source_run_id is applied as post-filter on K3 results", () => {
    const factA = makeFact({ source_run_id: "run-001" });
    const factB = makeFact({ source_run_id: "run-002" });
    const backend = makeBackend([factA, factB], []);
    const validated = validateHybridSearchParams(baseParams({
      structured_filters: { source_run_id: "run-002" },
    }))!;
    assert.ok(validated.ok);
    const result = fetchK3Arm(backend, validated.validated, 60);
    assert.ok(result.ok);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].source_run_id, "run-002");
  });

  it("post-filter yield reduction does not overclaim completeness", () => {
    // 5 facts, 3 match source_run_id. Post-filter reduces yield.
    // The arm returns only matching items; it does not claim all matching
    // items in the store were returned (arm fetch limit may truncate
    // before post-filtering).
    const facts = [
      makeFact({ source_run_id: "run-A" }),
      makeFact({ source_run_id: "run-B" }),
      makeFact({ source_run_id: "run-A" }),
      makeFact({ source_run_id: "run-B" }),
      makeFact({ source_run_id: "run-A" }),
    ];
    const backend = makeBackend(facts, []);
    const validated = validateHybridSearchParams(baseParams({
      structured_filters: { source_run_id: "run-A" },
    }))!;
    assert.ok(validated.ok);
    const result = fetchK3Arm(backend, validated.validated, 5);
    assert.ok(result.ok);
    assert.equal(result.items.length, 3);
    for (const item of result.items) {
      assert.equal(item.source_run_id, "run-A");
    }
  });

  it("K3 arm does not mutate backend data", () => {
    const facts = [makeFact()];
    const factsSnapshot = snapshot(facts);
    const backend = makeBackend(facts, []);
    const validated = validateHybridSearchParams(baseParams())!;
    assert.ok(validated.ok);
    fetchK3Arm(backend, validated.validated, 60);
    assert.deepEqual(snapshot(backend.allSemanticFacts()), factsSnapshot);
  });
});

// ===========================================================================
// PARAM VALIDATION TESTS
// ===========================================================================

describe("K6 param validation", () => {
  it("AC-K6-03 — missing project_id rejection", () => {
    const result = hybridSearch(
      makeBackend([], []),
      baseParams({ project_id: "" }),
    );
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.MISSING_PROJECT_ID);
  });

  it("AC-K6-04 — missing query_vector rejection", () => {
    const result = hybridSearch(
      makeBackend([], []),
      { project_id: PROJECT_A, model_id: MODEL } as HybridSearchParams,
    );
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.MISSING_QUERY_VECTOR);
  });

  it("AC-K6-05 — invalid vector dimension rejection", () => {
    const result = hybridSearch(
      makeBackend([], []),
      baseParams({ query_vector: [1, 2, 3] }),
    );
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.INVALID_VECTOR_DIMENSION);
  });

  it("missing model_id rejection", () => {
    const result = hybridSearch(
      makeBackend([], []),
      baseParams({ model_id: "" }),
    );
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.MISSING_MODEL_ID);
  });

  it("invalid min_vector_score rejection", () => {
    const result = hybridSearch(
      makeBackend([], []),
      baseParams({ min_vector_score: 1.5 }),
    );
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.INVALID_SCORE_THRESHOLD);
  });

  it("exclude_fact_ids > 50 rejection", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const result = hybridSearch(
      makeBackend([], []),
      baseParams({ vector_filters: { exclude_fact_ids: ids } }),
    );
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.EXCLUSION_LIST_TOO_LARGE);
  });

  it("limit > 100 is clamped, not rejected", () => {
    const v = validateHybridSearchParams(baseParams({ limit: 200 }));
    assert.ok(v.ok);
    assert.equal(v.validated.resolvedLimit, 100);
  });

  it("invalid cursor rejection", () => {
    const result = hybridSearch(
      makeBackend([], []),
      baseParams({ cursor: "not-a-valid-cursor" }),
    );
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.INVALID_CURSOR);
  });
});

// ===========================================================================
// PROJECT ISOLATION TESTS
// ===========================================================================

describe("K6 project isolation", () => {
  it("AC-K6-01 — project isolation, K3 arm", () => {
    const factA = makeFact({ project_id: PROJECT_A });
    const factB = makeFact({ project_id: PROJECT_B });
    const backend = makeBackend([factA, factB], []);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    for (const item of result.page.items) {
      assert.notEqual(item.fact_id, factB.id);
    }
    // Project A fact is present
    assert.ok(result.page.items.some((i) => i.fact_id === factA.id));
  });

  it("AC-K6-02 — project isolation, K5 arm", () => {
    const factA = makeFact({ project_id: PROJECT_A });
    const factB = makeFact({ project_id: PROJECT_B });
    const erA = makeEmbeddingRecord(factA, makeVector(0.9));
    const erB = makeEmbeddingRecord(factB, makeVector(0.9));
    const backend = makeBackend([factA, factB], [erA, erB]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    for (const item of result.page.items) {
      assert.notEqual(item.fact_id, factB.id);
    }
    assert.ok(result.page.items.some((i) => i.fact_id === factA.id));
  });
});

// ===========================================================================
// DEDUPLICATION TESTS
// ===========================================================================

describe("K6 deduplication", () => {
  it("AC-K6-06 — dedup by fact_id, sources contain both", () => {
    const fact = makeFact();
    const er = makeEmbeddingRecord(fact, makeVector(0.9));
    const backend = makeBackend([fact], [er]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    assert.equal(result.page.items.length, 1);
    const item = result.page.items[0];
    assert.equal(item.fact_id, fact.id);
    assert.ok(item.sources.includes("STRUCTURED"));
    assert.ok(item.sources.includes("VECTOR"));
  });

  it("AC-K6-07 — field authority on deduplication (K3 fields win) — unit proof", () => {
    // Unit-level proof via merge function directly
    const k3Items = [{
      fact_id: "shared",
      fact_type: "k3-type",
      fact_key: "k3-key",
      fact_value: '{"from":"k3"}',
      source_run_id: "k3-run",
      fact_created_at: "2026-01-01T00:00:00.000Z",
      fact_schema_version: "1.0",
    }];
    const k5Items = [{
      fact_id: "shared",
      fact_type: "k5-type",
      fact_key: "k5-key",
      fact_value: '{"from":"k5"}',
      source_run_id: "k5-run",
      fact_created_at: "2026-02-01T00:00:00.000Z",
      fact_schema_version: "2.0",
      vector_score: 0.95,
    }];
    const merged = mergeArmResults(k3Items, k5Items);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].fact_type, "k3-type");
    assert.equal(merged[0].fact_key, "k3-key");
    assert.equal(merged[0].fact_value, '{"from":"k3"}');
    assert.equal(merged[0].source_run_id, "k3-run");
    assert.equal(merged[0].fact_created_at, "2026-01-01T00:00:00.000Z");
    assert.equal(merged[0].fact_schema_version, "1.0");
  });

  it("AC-K6-08 — score preserved on deduplicated fact", () => {
    const fact = makeFact();
    const er = makeEmbeddingRecord(fact, makeVector(0.9));
    const backend = makeBackend([fact], [er]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    const item = result.page.items[0];
    assert.notEqual(item.vector_score, null);
    assert.ok(typeof item.vector_score === "number");
  });

  it("AC-K6-23 — within-page deduplication guarantee", () => {
    const fact = makeFact();
    const er = makeEmbeddingRecord(fact, makeVector(0.9));
    const backend = makeBackend([fact], [er]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    const ids = result.page.items.map((i) => i.fact_id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, "no duplicate fact_id within page");
  });
});

// ===========================================================================
// ORDERING TESTS
// ===========================================================================

describe("K6 ordering", () => {
  it("AC-K6-09 — scored facts above unscored", () => {
    const scoredFact = makeFact({ created_at: T1 });
    const unscoredFact = makeFact({ created_at: T0 });
    const er = makeEmbeddingRecord(scoredFact, makeVector(0.8));
    const backend = makeBackend([scoredFact, unscoredFact], [er]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    assert.equal(result.page.items.length, 2);
    assert.notEqual(result.page.items[0].vector_score, null);
    assert.equal(result.page.items[1].vector_score, null);
  });

  it("AC-K6-10 — score descending among scored items", () => {
    const factHigh = makeFact({ created_at: T0 });
    const factLow = makeFact({ created_at: T1 });
    const erHigh = makeEmbeddingRecord(factHigh, makeVector(1.0));
    const erLow = makeEmbeddingRecord(factLow, makeVector(0.5));
    const backend = makeBackend([factHigh, factLow], [erHigh, erLow]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    assert.equal(result.page.items.length, 2);
    assert.ok(result.page.items[0].vector_score! >= result.page.items[1].vector_score!);
  });

  it("AC-K6-11 — created_at ASC tie-break for equal scores", () => {
    const factEarly = makeFact({ created_at: T0 });
    const factLate = makeFact({ created_at: T2 });
    const vec = makeVector(0.7);
    const erEarly = makeEmbeddingRecord(factEarly, vec);
    const erLate = makeEmbeddingRecord(factLate, vec);
    const backend = makeBackend([factEarly, factLate], [erEarly, erLate]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    assert.equal(result.page.items.length, 2);
    assert.ok(result.page.items[0].fact_created_at <= result.page.items[1].fact_created_at);
  });

  it("AC-K6-12 — fact_id ASC final tie-break", () => {
    const factA = makeFact({ created_at: T0 });
    const factB = makeFact({ created_at: T0 });
    const backend = makeBackend([factA, factB], []);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    assert.equal(result.page.items.length, 2);
    assert.ok(result.page.items[0].fact_id < result.page.items[1].fact_id);
  });
});

// ===========================================================================
// PROVENANCE TESTS
// ===========================================================================

describe("K6 provenance", () => {
  it("AC-K6-14 — STRUCTURED-only provenance", () => {
    const fact = makeFact();
    const backend = makeBackend([fact], []);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    assert.equal(result.page.items.length, 1);
    assert.deepEqual(result.page.items[0].sources, ["STRUCTURED"]);
    assert.equal(result.page.items[0].vector_score, null);
  });

  it("AC-K6-15 — VECTOR-only provenance via filter isolation", () => {
    const factVisible = makeFact({ fact_type: "observation", created_at: T0 });
    const factVectorOnly = makeFact({ fact_type: "special", created_at: T1 });
    const erVectorOnly = makeEmbeddingRecord(factVectorOnly, makeVector(0.8));
    const backend = makeBackend([factVisible, factVectorOnly], [erVectorOnly]);
    // structured_filters restricts K3 arm to 'observation' type only
    const result = hybridSearch(backend, baseParams({
      structured_filters: { fact_type: ["observation"] },
    }));
    assert.ok(result.ok);
    const vectorOnlyItem = result.page.items.find(
      (i) => i.fact_id === factVectorOnly.id,
    );
    assert.ok(vectorOnlyItem, "vector-only fact should be in results");
    assert.deepEqual(vectorOnlyItem!.sources, ["VECTOR"]);
    assert.notEqual(vectorOnlyItem!.vector_score, null);
  });
});

// ===========================================================================
// DETERMINISM TEST
// ===========================================================================

describe("K6 determinism", () => {
  it("AC-K6-13 — identical inputs, identical outputs (stable DB state)", () => {
    const fact1 = makeFact({ created_at: T0 });
    const fact2 = makeFact({ created_at: T1 });
    const er1 = makeEmbeddingRecord(fact1, makeVector(0.9));
    const backend = makeBackend([fact1, fact2], [er1]);
    const params = baseParams();
    const result1 = hybridSearch(backend, params);
    const result2 = hybridSearch(backend, params);
    assert.ok(result1.ok);
    assert.ok(result2.ok);
    assert.deepEqual(result1.page.items, result2.page.items);
    assert.equal(result1.page.next_cursor, result2.page.next_cursor);
    assert.equal(result1.page.has_more, result2.page.has_more);
  });
});

// ===========================================================================
// MIN_VECTOR_SCORE TESTS
// ===========================================================================

describe("K6 min_vector_score", () => {
  it("AC-K6-16 — min_vector_score applied before merge", () => {
    const fact = makeFact();
    // Use an orthogonal vector (non-zero in dimension 1, not 0)
    // so cosine similarity with query_vector [1,0,...] is 0.0
    const orthogonalVec = new Array(1536).fill(0);
    orthogonalVec[1] = 1.0; // perpendicular to query_vector
    const er = makeEmbeddingRecord(fact, orthogonalVec);
    const backend = makeBackend([fact], [er]);
    // Threshold of 0.5 excludes the orthogonal vector (score ~0.0)
    const result = hybridSearch(backend, baseParams({ min_vector_score: 0.5 }));
    assert.ok(result.ok);
    const item = result.page.items.find((i) => i.fact_id === fact.id);
    assert.ok(item);
    assert.deepEqual(item!.sources, ["STRUCTURED"]);
    assert.equal(item!.vector_score, null);
  });
});

// ===========================================================================
// FAILURE / ERROR CONTRACT TESTS
// ===========================================================================

describe("K6 failure contract", () => {
  it("AC-K6-17 — fail closed, K3 arm failure (default)", () => {
    const fact = makeFact();
    const er = makeEmbeddingRecord(fact, makeVector(0.9));
    const backend = makeBrokenK3Backend([fact], [er]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.STRUCTURED_ARM_FAILURE);
  });

  it("AC-K6-18 — fail closed, K5 arm failure (default)", () => {
    const fact = makeFact();
    const backend = makeBrokenK5Backend([fact], []);
    const result = hybridSearch(backend, baseParams());
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.VECTOR_ARM_FAILURE);
  });

  it("AC-K6-19 — partial mode, K3 failure → degraded with VECTOR items", () => {
    const fact = makeFact();
    const er = makeEmbeddingRecord(fact, makeVector(0.9));
    const backend = makeBrokenK3Backend([fact], [er]);
    const result = hybridSearch(backend, baseParams({ allow_partial: true }));
    assert.ok(result.ok);
    assert.equal(result.page.degraded, true);
    assert.deepEqual(result.page.degraded_arms, ["STRUCTURED"]);
  });

  it("AC-K6-20 — partial mode, K5 failure → degraded with STRUCTURED items", () => {
    const fact = makeFact();
    const backend = makeBrokenK5Backend([fact], []);
    const result = hybridSearch(backend, baseParams({ allow_partial: true }));
    assert.ok(result.ok);
    assert.equal(result.page.degraded, true);
    assert.deepEqual(result.page.degraded_arms, ["VECTOR"]);
    assert.ok(result.page.items.length > 0);
  });

  it("AC-K6-21 — all arms failed (even with allow_partial)", () => {
    const backend = makeBothBrokenBackend();
    const result = hybridSearch(backend, baseParams({ allow_partial: true }));
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.ALL_ARMS_FAILED);
  });
});

// ===========================================================================
// EMPTY RESULT TEST
// ===========================================================================

describe("K6 empty result", () => {
  it("AC-K6-22 — empty result is not an error", () => {
    const backend = makeBackend([], []);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    assert.deepEqual(result.page.items, []);
    assert.equal(result.page.next_cursor, null);
    assert.equal(result.page.has_more, false);
    assert.equal(result.page.degraded, false);
    assert.deepEqual(result.page.degraded_arms, []);
  });
});

// ===========================================================================
// CURSOR / PAGINATION TESTS
// ===========================================================================

describe("K6 cursor pagination", () => {
  it("AC-K6-24 — cursor encodes valid sort position (stable DB state)", () => {
    const facts: K2SemanticFact[] = [];
    const records: K2EmbeddingRecord[] = [];
    for (let i = 0; i < 5; i++) {
      const f = makeFact({ created_at: new Date(T0.getTime() + i * 1000) });
      facts.push(f);
      records.push(makeEmbeddingRecord(f, makeVector(0.9 - i * 0.1)));
    }
    const backend = makeBackend(facts, records);
    const params = baseParams({ limit: 2 });

    // Page 1
    const page1 = hybridSearch(backend, params);
    assert.ok(page1.ok);
    assert.equal(page1.page.items.length, 2);
    assert.equal(page1.page.has_more, true);
    assert.notEqual(page1.page.next_cursor, null);

    // Page 2
    const page2 = hybridSearch(backend, { ...params, cursor: page1.page.next_cursor! });
    assert.ok(page2.ok);
    assert.equal(page2.page.items.length, 2);

    // No item from page 1 reappears on page 2
    const page1Ids = new Set(page1.page.items.map((i) => i.fact_id));
    for (const item of page2.page.items) {
      assert.ok(!page1Ids.has(item.fact_id), "no page-1 item should reappear on page 2");
    }

    // Page-2 items come after page-1 items in K6 ordering
    const lastPage1 = page1.page.items[page1.page.items.length - 1];
    for (const item of page2.page.items) {
      if (item.vector_score !== null && lastPage1.vector_score !== null) {
        assert.ok(
          item.vector_score! <= lastPage1.vector_score!,
          "page-2 scored items should have equal or lower score",
        );
      }
    }
  });

  it("cursor encode/decode roundtrip with scored item", () => {
    const encoded = encodeK6Cursor(0.85, "2026-03-12T00:00:00.000Z", "fact-001");
    const decoded = decodeK6Cursor(encoded);
    assert.ok(decoded);
    assert.equal(decoded.vector_score, 0.85);
    assert.equal(decoded.fact_created_at, "2026-03-12T00:00:00.000Z");
    assert.equal(decoded.fact_id, "fact-001");
  });

  it("cursor encode/decode roundtrip with null score", () => {
    const encoded = encodeK6Cursor(null, "2026-03-12T00:00:00.000Z", "fact-002");
    const decoded = decodeK6Cursor(encoded);
    assert.ok(decoded);
    assert.equal(decoded.vector_score, null);
  });

  it("invalid cursor returns null on decode", () => {
    assert.equal(decodeK6Cursor("garbage"), null);
    assert.equal(decodeK6Cursor(""), null);
  });

  it("validateCursor returns error for invalid cursor string", () => {
    const result = validateCursor("not-valid");
    assert.ok(!result.ok);
    assert.equal(result.code, K6_ERROR_CODE.INVALID_CURSOR);
  });

  it("validateCursor returns null decoded for undefined cursor", () => {
    const result = validateCursor(undefined);
    assert.ok(result.ok);
    assert.equal(result.decoded, null);
  });
});

// ===========================================================================
// READ-ONLY / NO-WRITES TESTS
// ===========================================================================

describe("K6 read-only invariants", () => {
  it("AC-K6-25 — no writes: backend data structurally unchanged after hybridSearch", () => {
    const facts = [makeFact(), makeFact({ created_at: T1 })];
    const records = [makeEmbeddingRecord(facts[0], makeVector(0.9))];
    const factsSnapshot = snapshot(facts);
    const recordsSnapshot = snapshot(records);
    const backend = makeBackend(facts, records);

    hybridSearch(backend, baseParams());

    // Structural deep equality — not just length
    assert.deepEqual(snapshot(backend.allSemanticFacts()), factsSnapshot);
    assert.deepEqual(snapshot(backend.allEmbeddingRecords()), recordsSnapshot);
  });

  it("hybridSearch does not add or remove elements from backend arrays", () => {
    const facts = [makeFact()];
    const records = [makeEmbeddingRecord(facts[0], makeVector(0.9))];
    const factsSnapshot = snapshot(facts);
    const recordsSnapshot = snapshot(records);
    const backend = makeBackend(facts, records);

    // Run multiple times
    hybridSearch(backend, baseParams());
    hybridSearch(backend, baseParams({ limit: 1 }));
    hybridSearch(backend, baseParams({ include_scores: false }));

    assert.deepEqual(snapshot(backend.allSemanticFacts()), factsSnapshot);
    assert.deepEqual(snapshot(backend.allEmbeddingRecords()), recordsSnapshot);
  });
});

// ===========================================================================
// EMBEDDING VECTOR NOT RETURNED TEST
// ===========================================================================

describe("K6 embedding safety", () => {
  it("AC-K6-26 — raw embedding vector not returned in any result field", () => {
    const fact = makeFact();
    const er = makeEmbeddingRecord(fact, makeVector(0.9));
    const backend = makeBackend([fact], [er]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    for (const item of result.page.items) {
      assert.ok(!("embedding" in item));
      assert.ok(!("embedding_record_id" in item));
      assert.ok(!("embedding_created_at" in item));
    }
  });
});

// ===========================================================================
// INCLUDE_SCORES TEST
// ===========================================================================

describe("K6 include_scores", () => {
  it("AC-K6-27 — include_scores: false nulls all vector_score", () => {
    const fact = makeFact();
    const er = makeEmbeddingRecord(fact, makeVector(0.9));
    const backend = makeBackend([fact], [er]);
    const result = hybridSearch(backend, baseParams({ include_scores: false }));
    assert.ok(result.ok);
    for (const item of result.page.items) {
      assert.equal(item.vector_score, null);
    }
  });

  it("include_scores: true (default) preserves non-null scores on vector-sourced items", () => {
    const fact = makeFact();
    const er = makeEmbeddingRecord(fact, makeVector(0.9));
    const backend = makeBackend([fact], [er]);
    const result = hybridSearch(backend, baseParams());
    assert.ok(result.ok);
    const item = result.page.items.find((i) => i.sources.includes("VECTOR"));
    assert.ok(item);
    assert.notEqual(item!.vector_score, null);
  });
});

// ===========================================================================
// FILTER ISOLATION TESTS
// ===========================================================================

describe("K6 filter isolation", () => {
  it("AC-K6-28 — structured_filters applied to K3 arm only", () => {
    const factObs = makeFact({ fact_type: "observation", created_at: T0 });
    const factDec = makeFact({ fact_type: "decision", created_at: T1 });
    const erDec = makeEmbeddingRecord(factDec, makeVector(0.8));
    const backend = makeBackend([factObs, factDec], [erDec]);
    const result = hybridSearch(backend, baseParams({
      structured_filters: { fact_type: ["observation"] },
    }));
    assert.ok(result.ok);
    // factDec appears from K5 arm only (not filtered by structured_filters)
    const decItem = result.page.items.find((i) => i.fact_id === factDec.id);
    assert.ok(decItem, "decision fact should appear from K5 arm");
    assert.deepEqual(decItem!.sources, ["VECTOR"]);
  });

  it("AC-K6-29 — vector_filters applied to K5 arm only", () => {
    const factA = makeFact({ created_at: T0 });
    const factB = makeFact({ created_at: T1 });
    const erA = makeEmbeddingRecord(factA, makeVector(0.9));
    const erB = makeEmbeddingRecord(factB, makeVector(0.8));
    const backend = makeBackend([factA, factB], [erA, erB]);
    const result = hybridSearch(backend, baseParams({
      vector_filters: { exclude_fact_ids: [factA.id] },
    }));
    assert.ok(result.ok);
    // factA excluded from K5 but still present from K3
    const itemA = result.page.items.find((i) => i.fact_id === factA.id);
    assert.ok(itemA, "excluded-from-K5 fact should appear from K3 arm");
    assert.deepEqual(itemA!.sources, ["STRUCTURED"]);
    assert.equal(itemA!.vector_score, null);
    // factB appears with VECTOR source
    const itemB = result.page.items.find((i) => i.fact_id === factB.id);
    assert.ok(itemB);
    assert.ok(itemB!.sources.includes("VECTOR"));
  });
});

// ===========================================================================
// ARM FETCH LIMIT TEST (exported intentional testable surface)
// ===========================================================================

describe("K6 arm fetch limit", () => {
  it("computeArmFetchLimit = min(limit * 3, 300) exactly", () => {
    assert.equal(computeArmFetchLimit(20), 60);
    assert.equal(computeArmFetchLimit(100), 300);
    assert.equal(computeArmFetchLimit(50), 150);
    assert.equal(computeArmFetchLimit(1), 3);
    assert.equal(computeArmFetchLimit(101), 300);
  });
});

// ===========================================================================
// MERGE UNIT TESTS
// ===========================================================================

describe("K6 merge unit", () => {
  it("K3 field authority on collision — K3 values override K5 values", () => {
    const k3Items = [{
      fact_id: "shared-fact",
      fact_type: "k3-type",
      fact_key: "k3-key",
      fact_value: '{"source":"k3"}',
      source_run_id: "k3-run",
      fact_created_at: "2026-01-01T00:00:00.000Z",
      fact_schema_version: "1.0",
    }];
    const k5Items = [{
      fact_id: "shared-fact",
      fact_type: "k5-type",
      fact_key: "k5-key",
      fact_value: '{"source":"k5"}',
      source_run_id: "k5-run",
      fact_created_at: "2026-02-01T00:00:00.000Z",
      fact_schema_version: "2.0",
      vector_score: 0.95,
    }];
    const merged = mergeArmResults(k3Items, k5Items);
    assert.equal(merged.length, 1);
    const item = merged[0];
    assert.equal(item.fact_type, "k3-type");
    assert.equal(item.fact_key, "k3-key");
    assert.equal(item.fact_value, '{"source":"k3"}');
    assert.equal(item.source_run_id, "k3-run");
    assert.equal(item.fact_created_at, "2026-01-01T00:00:00.000Z");
    assert.equal(item.fact_schema_version, "1.0");
    assert.equal(item.vector_score, 0.95);
    assert.ok(item.sources.includes("STRUCTURED"));
    assert.ok(item.sources.includes("VECTOR"));
  });
});

// ===========================================================================
// RANK UNIT TESTS
// ===========================================================================

describe("K6 rank unit", () => {
  it("null scores rank below all scored facts", () => {
    const items: HybridSearchResult[] = [
      {
        fact_id: "null-score",
        fact_type: "t", fact_key: "k", fact_value: "v",
        source_run_id: "r",
        fact_created_at: "2026-01-01T00:00:00.000Z",
        fact_schema_version: "1.0",
        sources: ["STRUCTURED"],
        vector_score: null,
      },
      {
        fact_id: "low-score",
        fact_type: "t", fact_key: "k", fact_value: "v",
        source_run_id: "r",
        fact_created_at: "2026-01-02T00:00:00.000Z",
        fact_schema_version: "1.0",
        sources: ["VECTOR"],
        vector_score: 0.1,
      },
    ];
    const ranked = rankMergedResults(items);
    assert.equal(ranked[0].fact_id, "low-score");
    assert.equal(ranked[1].fact_id, "null-score");
  });
});
