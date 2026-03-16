/**
 * Agent OS — K7 Memory Context Assembly
 * Tests covering AC-K7-01 through AC-K7-25.
 *
 * Source: memory-context-assembly-k7-v1.1.md §15
 * Slice: K7 — Memory Context Assembly
 *
 * Read-only logic tests. No DB access. No mutation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assembleMemoryContext } from "../../src/memory/memory-context/assemble.js";
import type { MemoryContextBackends } from "../../src/memory/memory-context/assemble.js";
import { attachMemoryContext } from "../../src/memory/memory-context/attach.js";
import { K7_ERROR_CODE } from "../../src/memory/memory-context/types.js";
import type {
  MemoryContextRequest,
  MemoryContext,
} from "../../src/memory/memory-context/types.js";

import type { K3ReadBackend } from "../../src/memory/retrieval/types.js";
import type { K6ReadBackend } from "../../src/memory/hybrid-search/hybrid-search.js";
import type {
  K2EpisodicEvent,
  K2DecisionEvent,
  K2SemanticFact,
  K2SemanticFactEvent,
  K2EmbeddingRecord,
  K2EmbeddingStatusEvent,
} from "../../src/memory/pipeline/types.js";
import type { FrozenStepContext } from "../../src/dispatcher/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_A = "proj-k7-a";
const PROJECT_B = "proj-k7-b";
const RUN_1 = "run-k7-001";
const RUN_2 = "run-k7-002";
const SV = "1.0";
const MODEL = "text-embedding-3-small";

const T0 = new Date("2026-03-12T00:00:00.000Z");
const T1 = new Date("2026-03-12T00:00:01.000Z");
const T2 = new Date("2026-03-12T00:00:02.000Z");
const T3 = new Date("2026-03-12T00:00:03.000Z");
const T4 = new Date("2026-03-12T00:00:04.000Z");

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

let _seq = 0;
function uid(prefix: string): string {
  return `${prefix}-${String(++_seq).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeEpisodicEvent(overrides?: Partial<K2EpisodicEvent>): K2EpisodicEvent {
  return {
    id: uid("ep"),
    project_id: PROJECT_A,
    schema_version: SV,
    run_id: RUN_1,
    session_id: "sess-001",
    agent_role: "forge",
    event_type: "STEP_SUCCEEDED",
    payload: {},
    occurred_at: T0,
    created_at: T0,
    ...overrides,
  };
}

function makeDecisionEvent(overrides?: Partial<K2DecisionEvent>): K2DecisionEvent {
  return {
    id: uid("de"),
    project_id: PROJECT_A,
    schema_version: SV,
    run_id: RUN_1,
    episodic_event_id: uid("ep-ref"),
    decision_type: "ARCHITECTURE_APPROVAL",
    actor_role: "command",
    decision_payload: {},
    decided_at: T0,
    created_at: T0,
    ...overrides,
  };
}

function makeSemanticFact(overrides?: Partial<K2SemanticFact>): K2SemanticFact {
  return {
    id: uid("sf"),
    project_id: PROJECT_A,
    schema_version: SV,
    fact_type: "system_pattern",
    fact_key: "test-key",
    fact_value: { text: "test value" },
    source_run_id: RUN_1,
    created_at: T0,
  };
}

function makeEmbeddingRecord(fact: K2SemanticFact, embedding: number[]): K2EmbeddingRecord {
  return {
    id: uid("er"),
    project_id: fact.project_id,
    schema_version: SV,
    semantic_fact_id: fact.id,
    status: "COMPLETE",
    model_id: MODEL,
    embedding,
    created_at: fact.created_at,
  };
}

function makeVector(value: number): number[] {
  const v = new Array(1536).fill(0);
  v[0] = value;
  return v;
}

const QUERY_VECTOR = makeVector(1.0);

// ---------------------------------------------------------------------------
// Backend builders
// ---------------------------------------------------------------------------

function makeBackend(
  episodic: K2EpisodicEvent[] = [],
  decisions: K2DecisionEvent[] = [],
  facts: K2SemanticFact[] = [],
  records: K2EmbeddingRecord[] = [],
): K6ReadBackend {
  return {
    allEpisodicEvents: () => episodic,
    allDecisionEvents: () => decisions,
    allSemanticFacts: () => facts,
    allSemanticFactEvents: () => [] as K2SemanticFactEvent[],
    allEmbeddingRecords: () => records,
    allEmbeddingStatusEvents: () => [] as K2EmbeddingStatusEvent[],
  };
}

function makeK3Backend(
  episodic: K2EpisodicEvent[] = [],
  decisions: K2DecisionEvent[] = [],
  facts: K2SemanticFact[] = [],
): K3ReadBackend {
  return {
    allEpisodicEvents: () => episodic,
    allDecisionEvents: () => decisions,
    allSemanticFacts: () => facts,
    allSemanticFactEvents: () => [] as K2SemanticFactEvent[],
    allEmbeddingRecords: () => [] as K2EmbeddingRecord[],
    allEmbeddingStatusEvents: () => [] as K2EmbeddingStatusEvent[],
  };
}

/** Backend where allEpisodicEvents throws */
function makeFailingEpisodicBackend(): K6ReadBackend {
  return {
    allEpisodicEvents: () => { throw new Error("episodic failure"); },
    allDecisionEvents: () => [],
    allSemanticFacts: () => [],
    allSemanticFactEvents: () => [],
    allEmbeddingRecords: () => [],
    allEmbeddingStatusEvents: () => [],
  };
}

/** Backend where allDecisionEvents throws */
function makeFailingDecisionBackend(): K6ReadBackend {
  return {
    allEpisodicEvents: () => [],
    allDecisionEvents: () => { throw new Error("decision failure"); },
    allSemanticFacts: () => [],
    allSemanticFactEvents: () => [],
    allEmbeddingRecords: () => [],
    allEmbeddingStatusEvents: () => [],
  };
}

/** Backend where allSemanticFacts throws */
function makeFailingSemanticBackend(): K6ReadBackend {
  return {
    allEpisodicEvents: () => [],
    allDecisionEvents: () => [],
    allSemanticFacts: () => { throw new Error("semantic failure"); },
    allSemanticFactEvents: () => [],
    allEmbeddingRecords: () => [],
    allEmbeddingStatusEvents: () => [],
  };
}

/** Minimal frozen FrozenStepContext for attach tests */
function makeContext(extra?: Partial<FrozenStepContext>): FrozenStepContext {
  return {
    run_id: RUN_1,
    step_index: 0,
    step_id: "step-001",
    actor: "forge",
    action: "forge.implement",
    project_root: "/project",
    artifacts_root: "/artifacts",
    capabilities: [],
    adapter: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// AC-K7-01 — Project isolation
// ---------------------------------------------------------------------------

describe("AC-K7-01: project isolation", () => {
  it("assembleMemoryContext must not include items from other project_ids", () => {
    const e_a = makeEpisodicEvent({ project_id: PROJECT_A, run_id: RUN_1 });
    const e_b = makeEpisodicEvent({ project_id: PROJECT_B, run_id: RUN_1 });
    const backends: MemoryContextBackends = {
      k3: makeK3Backend([e_a, e_b]),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    const ids = result.context.episodic.map((e) => e.id);
    assert.ok(ids.includes(e_a.id), "project A event should be included");
    assert.ok(!ids.includes(e_b.id), "project B event must not be included");
  });
});

// ---------------------------------------------------------------------------
// AC-K7-02 — No writes
// ---------------------------------------------------------------------------

describe("AC-K7-02: no writes", () => {
  it("assembleMemoryContext must not modify the backend state", () => {
    const episodic = [makeEpisodicEvent()];
    const decisions = [makeDecisionEvent()];
    const backends: MemoryContextBackends = {
      k3: makeK3Backend(episodic, decisions),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {
        episodic: { enabled: true },
        decision: { enabled: true },
      },
    };
    const before = {
      episodic: backends.k3.allEpisodicEvents().length,
      decisions: backends.k3.allDecisionEvents().length,
    };
    assembleMemoryContext(backends, req);
    assert.equal(backends.k3.allEpisodicEvents().length, before.episodic);
    assert.equal(backends.k3.allDecisionEvents().length, before.decisions);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-03 — Immutable attached memory
// ---------------------------------------------------------------------------

describe("AC-K7-03: immutable attached memory", () => {
  it("mutation attempt on context.memory must throw", () => {
    const e = makeEpisodicEvent();
    const backends: MemoryContextBackends = { k3: makeK3Backend([e]) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
    };
    const assembled = assembleMemoryContext(backends, req);
    assert.ok(assembled.ok);

    const ctx = makeContext();
    const attached = attachMemoryContext(ctx, assembled.context);
    assert.ok(attached.ok);

    // Attempt to mutate context.memory — must throw in strict mode
    assert.throws(() => {
      (attached.context.memory as Record<string, unknown>).project_id = "mutated";
    }, "mutation of memory.project_id must throw");

    assert.throws(() => {
      (attached.context.memory as { episodic: unknown[] }).episodic.push({} as never);
    }, "mutation of memory.episodic must throw");
  });
});

// ---------------------------------------------------------------------------
// AC-K7-04 — Memory is optional
// ---------------------------------------------------------------------------

describe("AC-K7-04: memory is optional", () => {
  it("FrozenStepContext without attach has memory === undefined", () => {
    const ctx = makeContext();
    assert.equal(ctx.memory, undefined);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-05 — Deterministic content
// ---------------------------------------------------------------------------

describe("AC-K7-05: deterministic content", () => {
  it("same request against same backend state produces identical results (excluding assembled_at)", () => {
    const events = [
      makeEpisodicEvent({ created_at: T0 }),
      makeEpisodicEvent({ created_at: T1 }),
    ];
    const backends: MemoryContextBackends = { k3: makeK3Backend(events) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
    };

    const r1 = assembleMemoryContext(backends, req);
    const r2 = assembleMemoryContext(backends, req);
    assert.ok(r1.ok && r2.ok);

    // Content fields must match
    assert.deepEqual(r1.context.episodic, r2.context.episodic);
    assert.deepEqual(r1.context.item_counts, r2.context.item_counts);
    assert.deepEqual(r1.context.lane_states, r2.context.lane_states);
    // assembled_at is excluded from determinism contract — not compared
  });
});

// ---------------------------------------------------------------------------
// AC-K7-06 — Episodic lane bounded
// ---------------------------------------------------------------------------

describe("AC-K7-06: episodic lane bounded", () => {
  it("when K3 returns more items than max_items, included = max_items", () => {
    const MAX = 3;
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEpisodicEvent({ created_at: new Date(T0.getTime() + i * 1000) }),
    );
    const backends: MemoryContextBackends = { k3: makeK3Backend(events) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true, max_items: MAX } },
    };

    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.episodic.length, MAX);
    assert.equal(result.context.item_counts.episodic_included, MAX);
    assert.ok(
      result.context.item_counts.episodic_available >= MAX,
      "available must be >= included",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-K7-07 — Episodic truncation is most-recent-first
// ---------------------------------------------------------------------------

describe("AC-K7-07: episodic truncation is most-recent-first", () => {
  it("truncated episodic items are the most recent max_items by created_at DESC", () => {
    // 5 events at T0..T4 (ascending)
    const events = [
      makeEpisodicEvent({ created_at: T0 }),
      makeEpisodicEvent({ created_at: T1 }),
      makeEpisodicEvent({ created_at: T2 }),
      makeEpisodicEvent({ created_at: T3 }),
      makeEpisodicEvent({ created_at: T4 }),
    ];
    const backends: MemoryContextBackends = { k3: makeK3Backend(events) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true, max_items: 3 } },
    };

    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    // Should have the 3 most recent: T4, T3, T2 (DESC)
    const timestamps = result.context.episodic.map((e) => e.created_at);
    assert.equal(timestamps[0], T4.toISOString(), "first item must be most recent (T4)");
    assert.equal(timestamps[1], T3.toISOString(), "second item must be T3");
    assert.equal(timestamps[2], T2.toISOString(), "third item must be T2");
  });
});

// ---------------------------------------------------------------------------
// AC-K7-08 — Decision lane bounded
// ---------------------------------------------------------------------------

describe("AC-K7-08: decision lane bounded", () => {
  it("when K3 returns more decisions than max_items, included = max_items", () => {
    const MAX = 2;
    const decisions = Array.from({ length: 8 }, (_, i) =>
      makeDecisionEvent({ created_at: new Date(T0.getTime() + i * 1000) }),
    );
    const backends: MemoryContextBackends = { k3: makeK3Backend([], decisions) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { decision: { enabled: true, max_items: MAX } },
    };

    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.decisions.length, MAX);
    assert.equal(result.context.item_counts.decision_included, MAX);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-09 — Semantic lane bounded (hybrid mode)
// ---------------------------------------------------------------------------

describe("AC-K7-09: semantic lane bounded in hybrid mode", () => {
  it("when K6 returns more facts than max_items, included = max_items", () => {
    const MAX = 2;
    const facts = Array.from({ length: 6 }, (_, i) =>
      makeSemanticFact({ created_at: new Date(T0.getTime() + i * 1000) }),
    );
    const records = facts.map((f) => makeEmbeddingRecord(f, makeVector(0.5)));
    const k6 = makeBackend([], [], facts, records);
    const backends: MemoryContextBackends = { k3: k6, k6 };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { semantic: { enabled: true, max_items: MAX } },
      query_vector: QUERY_VECTOR,
      model_id: MODEL,
    };

    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.ok(result.context.semantic.length <= MAX);
    assert.equal(result.context.item_counts.semantic_included, result.context.semantic.length);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-10 — semantic_mode flag
// ---------------------------------------------------------------------------

describe("AC-K7-10: semantic_mode flag", () => {
  it("semantic_mode is 'hybrid' when query_vector supplied", () => {
    const fact = makeSemanticFact();
    const record = makeEmbeddingRecord(fact, makeVector(0.9));
    const k6 = makeBackend([], [], [fact], [record]);
    const backends: MemoryContextBackends = { k3: k6, k6 };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { semantic: { enabled: true } },
      query_vector: QUERY_VECTOR,
      model_id: MODEL,
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.semantic_mode, "hybrid");
  });

  it("semantic_mode is 'structured_only' when query_vector absent", () => {
    const fact = makeSemanticFact();
    const backends: MemoryContextBackends = { k3: makeK3Backend([], [], [fact]) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { semantic: { enabled: true } },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.semantic_mode, "structured_only");
  });

  it("semantic_mode is 'disabled' when semantic lane not enabled", () => {
    const backends: MemoryContextBackends = { k3: makeK3Backend() };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.semantic_mode, "disabled");
  });
});

// ---------------------------------------------------------------------------
// AC-K7-11 — disabled vs degraded unambiguous
// ---------------------------------------------------------------------------

describe("AC-K7-11: disabled vs degraded lane states are unambiguous", () => {
  it("disabled lane produces state='disabled', not 'degraded'", () => {
    const backends: MemoryContextBackends = { k3: makeK3Backend() };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {
        episodic: { enabled: true },
        decision: { enabled: false },
        semantic: { enabled: false },
      },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.lane_states.decision, "disabled");
    assert.equal(result.context.lane_states.semantic, "disabled");
  });

  it("degraded lane (failure + allow_partial) produces state='degraded', not 'disabled'", () => {
    const backends: MemoryContextBackends = {
      k3: makeFailingEpisodicBackend(),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
      allow_partial: true,
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.lane_states.episodic, "degraded");
    // Must not be 'disabled'
    assert.notEqual(result.context.lane_states.episodic, "disabled");
  });

  it("disabled and degraded counts are both 0 but for different reasons", () => {
    const backends: MemoryContextBackends = {
      k3: makeFailingEpisodicBackend(),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {
        episodic: { enabled: true },  // will degrade
        decision: { enabled: false }, // disabled
      },
      allow_partial: true,
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.lane_states.episodic, "degraded");
    assert.equal(result.context.lane_states.decision, "disabled");
    assert.equal(result.context.item_counts.episodic_included, 0);
    assert.equal(result.context.item_counts.decision_included, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-12 — Fail closed (default allow_partial: false)
// ---------------------------------------------------------------------------

describe("AC-K7-12: fail closed under default allow_partial=false", () => {
  it("episodic lane failure returns ok:false with K7_EPISODIC_LANE_FAILURE", () => {
    const backends: MemoryContextBackends = {
      k3: makeFailingEpisodicBackend(),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(!result.ok);
    assert.equal(result.code, K7_ERROR_CODE.EPISODIC_LANE_FAILURE);
    // No context field
    assert.ok(!("context" in result));
  });

  it("decision lane failure returns ok:false with K7_DECISION_LANE_FAILURE", () => {
    const backends: MemoryContextBackends = {
      k3: makeFailingDecisionBackend(),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { decision: { enabled: true } },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(!result.ok);
    assert.equal(result.code, K7_ERROR_CODE.DECISION_LANE_FAILURE);
  });

  it("semantic lane failure returns ok:false with K7_SEMANTIC_LANE_FAILURE", () => {
    const backends: MemoryContextBackends = {
      k3: makeFailingSemanticBackend(),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { semantic: { enabled: true } },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(!result.ok);
    assert.equal(result.code, K7_ERROR_CODE.SEMANTIC_LANE_FAILURE);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-13 — Partial mode success with degraded lane
// ---------------------------------------------------------------------------

describe("AC-K7-13: partial mode with one degraded lane", () => {
  it("episodic fails but decision succeeds → ok:true, episodic=degraded, decision=ok", () => {
    const decision = makeDecisionEvent();
    const backends: MemoryContextBackends = {
      k3: {
        allEpisodicEvents: () => { throw new Error("episodic failure"); },
        allDecisionEvents: () => [decision],
        allSemanticFacts: () => [],
        allSemanticFactEvents: () => [],
        allEmbeddingRecords: () => [],
        allEmbeddingStatusEvents: () => [],
      },
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {
        episodic: { enabled: true },
        decision: { enabled: true },
      },
      allow_partial: true,
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.lane_states.episodic, "degraded");
    assert.equal(result.context.lane_states.decision, "ok");
    assert.deepEqual(result.context.episodic, []);
    assert.equal(result.context.item_counts.episodic_included, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-14 — Partial mode all degraded → ok:true
// ---------------------------------------------------------------------------

describe("AC-K7-14: partial mode with all lanes degraded → ok:true", () => {
  it("all enabled lanes fail under allow_partial=true → ok:true, all degraded", () => {
    const backends: MemoryContextBackends = {
      k3: {
        allEpisodicEvents: () => { throw new Error("fail"); },
        allDecisionEvents: () => { throw new Error("fail"); },
        allSemanticFacts: () => { throw new Error("fail"); },
        allSemanticFactEvents: () => [],
        allEmbeddingRecords: () => [],
        allEmbeddingStatusEvents: () => [],
      },
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {
        episodic: { enabled: true },
        decision: { enabled: true },
        semantic: { enabled: true },
      },
      allow_partial: true,
    };
    const result = assembleMemoryContext(backends, req);
    // Must be ok:true even when all lanes are degraded
    assert.ok(result.ok);
    assert.equal(result.context.lane_states.episodic, "degraded");
    assert.equal(result.context.lane_states.decision, "degraded");
    assert.equal(result.context.lane_states.semantic, "degraded");
    assert.deepEqual(result.context.episodic, []);
    assert.deepEqual(result.context.decisions, []);
    assert.deepEqual(result.context.semantic, []);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-15 — Empty retrieval is ok, not an error
// ---------------------------------------------------------------------------

describe("AC-K7-15: empty retrieval is ok:true with lane_states=empty", () => {
  it("zero items from all enabled lanes → ok:true, all lane_states=empty", () => {
    const backends: MemoryContextBackends = { k3: makeK3Backend() };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {
        episodic: { enabled: true },
        decision: { enabled: true },
      },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.lane_states.episodic, "empty");
    assert.equal(result.context.lane_states.decision, "empty");
    assert.deepEqual(result.context.episodic, []);
    assert.deepEqual(result.context.decisions, []);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-16 — Run scoping default
// ---------------------------------------------------------------------------

describe("AC-K7-16: run scoping default (include_current_run_only=true)", () => {
  it("episodic items contain only events from the current run_id", () => {
    const e1 = makeEpisodicEvent({ run_id: RUN_1, created_at: T0 });
    const e2 = makeEpisodicEvent({ run_id: RUN_2, created_at: T1 }); // different run
    const backends: MemoryContextBackends = {
      k3: makeK3Backend([e1, e2]),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } }, // include_current_run_only defaults to true
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    const ids = result.context.episodic.map((e) => e.id);
    assert.ok(ids.includes(e1.id));
    assert.ok(!ids.includes(e2.id));
  });
});

// ---------------------------------------------------------------------------
// AC-K7-17 — Cross-run scoping
// ---------------------------------------------------------------------------

describe("AC-K7-17: cross-run scoping with run_id_list", () => {
  it("items include only run_ids from run_id_list", () => {
    const e1 = makeEpisodicEvent({ run_id: RUN_1, created_at: T0 });
    const e2 = makeEpisodicEvent({ run_id: RUN_2, created_at: T1 });
    const RUN_3 = "run-k7-003";
    const e3 = makeEpisodicEvent({ run_id: RUN_3, created_at: T2 });
    const backends: MemoryContextBackends = {
      k3: makeK3Backend([e1, e2, e3]),
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {
        episodic: {
          enabled: true,
          include_current_run_only: false,
          run_id_list: [RUN_1, RUN_2],
        },
      },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    const runIds = new Set(result.context.episodic.map((e) => e.run_id));
    assert.ok(runIds.has(RUN_1));
    assert.ok(runIds.has(RUN_2));
    assert.ok(!runIds.has(RUN_3));
  });
});

// ---------------------------------------------------------------------------
// AC-K7-18 — Parameter rejection: missing project_id
// ---------------------------------------------------------------------------

describe("AC-K7-18: parameter rejection — missing project_id", () => {
  it("returns ok:false K7_MISSING_PROJECT_ID, no retrieval called", () => {
    let called = false;
    const backends: MemoryContextBackends = {
      k3: {
        ...makeK3Backend(),
        allEpisodicEvents: () => { called = true; return []; },
      },
    };
    const req = {
      project_id: "",
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
    } as MemoryContextRequest;
    const result = assembleMemoryContext(backends, req);
    assert.ok(!result.ok);
    assert.equal(result.code, K7_ERROR_CODE.MISSING_PROJECT_ID);
    assert.ok(!called, "no retrieval should be called on param failure");
  });
});

// ---------------------------------------------------------------------------
// AC-K7-19 — Parameter rejection: invalid vector dimension
// ---------------------------------------------------------------------------

describe("AC-K7-19: parameter rejection — invalid vector dimension", () => {
  it("returns ok:false K7_INVALID_VECTOR_DIMENSION, no retrieval called", () => {
    let called = false;
    const backends: MemoryContextBackends = {
      k3: {
        ...makeK3Backend(),
        allEpisodicEvents: () => { called = true; return []; },
      },
    };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { semantic: { enabled: true } },
      query_vector: [0.1, 0.2, 0.3], // wrong dimension
      model_id: MODEL,
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(!result.ok);
    assert.equal(result.code, K7_ERROR_CODE.INVALID_VECTOR_DIMENSION);
    assert.ok(!called);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-20 — Parameter rejection: model_id required with query_vector
// ---------------------------------------------------------------------------

describe("AC-K7-20: parameter rejection — model_id required with query_vector", () => {
  it("returns ok:false K7_MISSING_MODEL_ID", () => {
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { semantic: { enabled: true } },
      query_vector: QUERY_VECTOR,
      // model_id absent
    };
    const backends: MemoryContextBackends = { k3: makeK3Backend() };
    const result = assembleMemoryContext(backends, req);
    assert.ok(!result.ok);
    assert.equal(result.code, K7_ERROR_CODE.MISSING_MODEL_ID);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-21 — Parameter rejection: no lanes enabled
// ---------------------------------------------------------------------------

describe("AC-K7-21: parameter rejection — no lanes enabled", () => {
  it("all lanes disabled returns ok:false K7_NO_LANES_ENABLED", () => {
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {
        episodic: { enabled: false },
        decision: { enabled: false },
        semantic: { enabled: false },
      },
    };
    const backends: MemoryContextBackends = { k3: makeK3Backend() };
    const result = assembleMemoryContext(backends, req);
    assert.ok(!result.ok);
    assert.equal(result.code, K7_ERROR_CODE.NO_LANES_ENABLED);
  });

  it("empty lanes object returns ok:false K7_NO_LANES_ENABLED", () => {
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: {},
    };
    const backends: MemoryContextBackends = { k3: makeK3Backend() };
    const result = assembleMemoryContext(backends, req);
    assert.ok(!result.ok);
    assert.equal(result.code, K7_ERROR_CODE.NO_LANES_ENABLED);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-22 — One-time attachment
// ---------------------------------------------------------------------------

describe("AC-K7-22: one-time attachment", () => {
  it("attachMemoryContext on context already having memory returns error", () => {
    const e = makeEpisodicEvent();
    const backends: MemoryContextBackends = { k3: makeK3Backend([e]) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
    };
    const assembled = assembleMemoryContext(backends, req);
    assert.ok(assembled.ok);

    const ctx = makeContext();
    const first = attachMemoryContext(ctx, assembled.context);
    assert.ok(first.ok);

    // Second attach on same result must fail
    const second = attachMemoryContext(first.context, assembled.context);
    assert.ok(!second.ok);
    assert.equal(second.code, K7_ERROR_CODE.MEMORY_ALREADY_ATTACHED);
  });
});

// ---------------------------------------------------------------------------
// AC-K7-23 — vector_score null in structured_only mode
// ---------------------------------------------------------------------------

describe("AC-K7-23: vector_score null in structured_only mode", () => {
  it("all SemanticMemoryItem.vector_score are null when query_vector absent", () => {
    const facts = [
      makeSemanticFact({ created_at: T0 }),
      makeSemanticFact({ created_at: T1 }),
    ];
    const backends: MemoryContextBackends = { k3: makeK3Backend([], [], facts) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { semantic: { enabled: true } },
      // no query_vector
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    for (const item of result.context.semantic) {
      assert.equal(item.vector_score, null);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-K7-24 — item_counts reflect pre-truncation availability
// ---------------------------------------------------------------------------

describe("AC-K7-24: item_counts reflect pre-truncation availability", () => {
  it("episodic_available equals items returned by K3 before K7 truncation", () => {
    // 3 events in DB; max_items=2 so over-fetch = min(4, 200) = 4.
    // K3 returns all 3 (3 < over-fetch limit). available=3, included=2.
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEpisodicEvent({ created_at: new Date(T0.getTime() + i * 1000) }),
    );
    const backends: MemoryContextBackends = { k3: makeK3Backend(events) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true, max_items: 2 } },
    };
    const result = assembleMemoryContext(backends, req);
    assert.ok(result.ok);
    assert.equal(result.context.item_counts.episodic_included, 2);
    assert.equal(result.context.item_counts.episodic_available, 3);
    // invariant: available >= included
    assert.ok(
      result.context.item_counts.episodic_available >=
        result.context.item_counts.episodic_included,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-K7-25 — Foreman internals unchanged
// ---------------------------------------------------------------------------

describe("AC-K7-25: Foreman FrozenStepContext optional memory field is additive only", () => {
  it("FrozenStepContext can be constructed without memory and remains valid", () => {
    const ctx: FrozenStepContext = {
      run_id: "run-ac25",
      step_index: 0,
      step_id: "step-001",
      actor: "forge",
      action: "forge.implement",
      project_root: "/project",
      artifacts_root: "/artifacts",
      capabilities: [],
      adapter: null,
    };
    // memory is absent — must be undefined
    assert.equal(ctx.memory, undefined);
    // existing fields unchanged
    assert.equal(ctx.run_id, "run-ac25");
    assert.equal(ctx.actor, "forge");
  });

  it("attachMemoryContext preserves all existing FrozenStepContext fields", () => {
    const ctx = makeContext({
      run_id: "run-ac25b",
      step_id: "step-999",
      action: "sentinel.review",
    });
    const e = makeEpisodicEvent();
    const backends: MemoryContextBackends = { k3: makeK3Backend([e]) };
    const req: MemoryContextRequest = {
      project_id: PROJECT_A,
      run_id: RUN_1,
      lanes: { episodic: { enabled: true } },
    };
    const assembled = assembleMemoryContext(backends, req);
    assert.ok(assembled.ok);

    const attached = attachMemoryContext(ctx, assembled.context);
    assert.ok(attached.ok);

    // All prior fields preserved
    assert.equal(attached.context.run_id, ctx.run_id);
    assert.equal(attached.context.step_id, ctx.step_id);
    assert.equal(attached.context.action, ctx.action);
    assert.equal(attached.context.actor, ctx.actor);
    // memory is now present
    assert.ok(attached.context.memory !== undefined);
  });
});
