/**
 * Agent OS — K3 Memory Retrieval Layer
 * Tests for semantic-read.ts — querySemanticFacts, getSemanticFactById,
 * getSemanticFactHistory.
 *
 * Covers: project isolation, filter correctness, deterministic ordering,
 * cursor pagination, guard rejection passthrough, exact return-shape
 * projection, no mutation, no DB access.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  querySemanticFacts,
  getSemanticFactById,
  getSemanticFactHistory,
} from "../../src/memory/retrieval/semantic-read.js";

import { GUARD_CODE } from "../../src/memory/retrieval/query-guards.js";
import { decodeCursor } from "../../src/memory/retrieval/pagination.js";

import type { K3ReadBackend } from "../../src/memory/retrieval/types.js";
import type {
  K2SemanticFact,
  K2SemanticFactEvent,
} from "../../src/memory/pipeline/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT = "proj-001";
const OTHER_PROJECT = "proj-002";

const T0 = new Date("2026-03-11T00:00:00.000Z");
const T1 = new Date("2026-03-11T00:00:01.000Z");
const T2 = new Date("2026-03-11T00:00:02.000Z");
const T3 = new Date("2026-03-11T00:00:03.000Z");
const T4 = new Date("2026-03-11T00:00:04.000Z");

let _factSeq = 0;
function factId(): string { return `fact-${++_factSeq}`; }

let _eventSeq = 0;
function eventId(): string { return `sfe-${++_eventSeq}`; }

function makeFact(overrides?: Partial<K2SemanticFact>): K2SemanticFact {
  return {
    id: factId(),
    project_id: PROJECT,
    schema_version: "1.0",
    fact_type: "GOVERNANCE_DECISION",
    fact_key: "default.key",
    fact_value: { decision: "approved" },
    source_run_id: "run-1",
    created_at: T0,
    ...overrides,
  };
}

function makeFactEvent(overrides?: Partial<K2SemanticFactEvent>): K2SemanticFactEvent {
  return {
    id: eventId(),
    project_id: PROJECT,
    schema_version: "1.0",
    semantic_fact_id: "fact-1",
    episodic_event_id: "ep-1",
    observed_at: T0,
    created_at: T0,
    ...overrides,
  };
}

function makeBackend(
  facts: K2SemanticFact[],
  factEvents?: K2SemanticFactEvent[],
): K3ReadBackend {
  return {
    allEpisodicEvents: () => [],
    allDecisionEvents: () => [],
    allSemanticFacts: () => facts,
    allSemanticFactEvents: () => factEvents ?? [],
    allEmbeddingRecords: () => [],
    allEmbeddingStatusEvents: () => [],
  };
}

/** Deep-clone a K2SemanticFact for snapshot comparison. */
function snapshotFact(record: K2SemanticFact): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    ...record,
    created_at: record.created_at.toISOString(),
  }));
}

/** Deep-clone a K2SemanticFactEvent for snapshot comparison. */
function snapshotFactEvent(record: K2SemanticFactEvent): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    ...record,
    observed_at: record.observed_at.toISOString(),
    created_at: record.created_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// querySemanticFacts — project isolation
// ---------------------------------------------------------------------------

describe("querySemanticFacts — project isolation", () => {
  it("returns only records matching project_id", () => {
    const facts = [
      makeFact({ project_id: PROJECT, created_at: T0 }),
      makeFact({ project_id: OTHER_PROJECT, created_at: T1 }),
      makeFact({ project_id: PROJECT, created_at: T2 }),
    ];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      for (const item of result.page.items) {
        assert.equal(item.project_id, PROJECT);
      }
    }
  });

  it("returns empty page when no records match project_id", () => {
    const facts = [makeFact({ project_id: OTHER_PROJECT })];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 0);
      assert.equal(result.page.has_more, false);
      assert.equal(result.page.next_cursor, null);
    }
  });
});

// ---------------------------------------------------------------------------
// querySemanticFacts — filter correctness
// ---------------------------------------------------------------------------

describe("querySemanticFacts — filters", () => {
  it("filters by fact_type", () => {
    const facts = [
      makeFact({ fact_type: "GOVERNANCE_DECISION", created_at: T0 }),
      makeFact({ fact_type: "ARCHITECTURE_APPROVAL", created_at: T1 }),
      makeFact({ fact_type: "TRUST_CHANGE", created_at: T2 }),
    ];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, {
      project_id: PROJECT,
      fact_type: ["GOVERNANCE_DECISION", "TRUST_CHANGE"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      const types = result.page.items.map((i) => i.fact_type);
      assert.ok(types.includes("GOVERNANCE_DECISION"));
      assert.ok(types.includes("TRUST_CHANGE"));
    }
  });

  it("filters by fact_key", () => {
    const facts = [
      makeFact({ fact_key: "actor.forge.trust_level", created_at: T0 }),
      makeFact({ fact_key: "actor.sentinel.trust_level", created_at: T1 }),
      makeFact({ fact_key: "actor.forge.trust_level", created_at: T2 }),
    ];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, {
      project_id: PROJECT,
      fact_key: "actor.forge.trust_level",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      for (const item of result.page.items) {
        assert.equal(item.fact_key, "actor.forge.trust_level");
      }
    }
  });

  it("filters by created_at_from (inclusive)", () => {
    const facts = [
      makeFact({ created_at: T0 }),
      makeFact({ created_at: T1 }),
      makeFact({ created_at: T2 }),
    ];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, {
      project_id: PROJECT,
      created_at_from: T1.toISOString(),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
    }
  });

  it("filters by created_at_to (exclusive)", () => {
    const facts = [
      makeFact({ created_at: T0 }),
      makeFact({ created_at: T1 }),
      makeFact({ created_at: T2 }),
    ];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, {
      project_id: PROJECT,
      created_at_from: T0.toISOString(),
      created_at_to: T2.toISOString(),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
    }
  });

  it("combines multiple filters", () => {
    const facts = [
      makeFact({ fact_type: "GOV", fact_key: "k1", created_at: T0 }),
      makeFact({ fact_type: "GOV", fact_key: "k2", created_at: T1 }),
      makeFact({ fact_type: "ARCH", fact_key: "k1", created_at: T2 }),
      makeFact({ fact_type: "GOV", fact_key: "k1", created_at: T3 }),
    ];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, {
      project_id: PROJECT,
      fact_type: ["GOV"],
      fact_key: "k1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      for (const item of result.page.items) {
        assert.equal(item.fact_type, "GOV");
        assert.equal(item.fact_key, "k1");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// querySemanticFacts — deterministic ordering
// ---------------------------------------------------------------------------

describe("querySemanticFacts — ordering", () => {
  it("returns results in (created_at ASC, id ASC) order", () => {
    const f1 = makeFact({ id: "z-last", created_at: T0 });
    const f2 = makeFact({ id: "a-first", created_at: T0 });
    const f3 = makeFact({ id: "m-mid", created_at: T1 });
    const backend = makeBackend([f1, f2, f3]);
    const result = querySemanticFacts(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      const ids = result.page.items.map((i) => i.id);
      assert.deepStrictEqual(ids, ["a-first", "z-last", "m-mid"]);
    }
  });

  it("is stable across repeated calls", () => {
    const facts = [
      makeFact({ id: "c", created_at: T1 }),
      makeFact({ id: "a", created_at: T0 }),
      makeFact({ id: "b", created_at: T1 }),
    ];
    const backend = makeBackend(facts);
    const r1 = querySemanticFacts(backend, { project_id: PROJECT });
    const r2 = querySemanticFacts(backend, { project_id: PROJECT });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (r1.ok && r2.ok) {
      assert.deepStrictEqual(
        r1.page.items.map((i) => i.id),
        r2.page.items.map((i) => i.id),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// querySemanticFacts — cursor pagination
// ---------------------------------------------------------------------------

describe("querySemanticFacts — cursor pagination", () => {
  it("paginates correctly with limit=2", () => {
    const facts = [
      makeFact({ created_at: T0 }),
      makeFact({ created_at: T1 }),
      makeFact({ created_at: T2 }),
      makeFact({ created_at: T3 }),
      makeFact({ created_at: T4 }),
    ];
    const backend = makeBackend(facts);

    // Page 1
    const page1 = querySemanticFacts(backend, {
      project_id: PROJECT,
      limit: 2,
    });
    assert.equal(page1.ok, true);
    if (!page1.ok) return;
    assert.equal(page1.page.items.length, 2);
    assert.equal(page1.page.has_more, true);
    assert.ok(page1.page.next_cursor !== null);

    // Page 2
    const page2 = querySemanticFacts(backend, {
      project_id: PROJECT,
      limit: 2,
      cursor: page1.page.next_cursor!,
    });
    assert.equal(page2.ok, true);
    if (!page2.ok) return;
    assert.equal(page2.page.items.length, 2);
    assert.equal(page2.page.has_more, true);

    // Page 3 (last)
    const page3 = querySemanticFacts(backend, {
      project_id: PROJECT,
      limit: 2,
      cursor: page2.page.next_cursor!,
    });
    assert.equal(page3.ok, true);
    if (!page3.ok) return;
    assert.equal(page3.page.items.length, 1);
    assert.equal(page3.page.has_more, false);
    assert.equal(page3.page.next_cursor, null);

    // All 5 records seen, no duplicates
    const allIds = [
      ...page1.page.items.map((i) => i.id),
      ...page2.page.items.map((i) => i.id),
      ...page3.page.items.map((i) => i.id),
    ];
    assert.equal(new Set(allIds).size, 5);
  });

  it("cursor encodes last item sort_key and id", () => {
    const facts = [
      makeFact({ id: "f-aaa", created_at: T0 }),
      makeFact({ id: "f-bbb", created_at: T1 }),
      makeFact({ id: "f-ccc", created_at: T2 }),
    ];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, {
      project_id: PROJECT,
      limit: 2,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.page.next_cursor !== null);
    const decoded = decodeCursor(result.page.next_cursor!);
    assert.ok(decoded !== null);
    assert.equal(decoded!.sort_key, T1.toISOString());
    assert.equal(decoded!.id, "f-bbb");
  });
});

// ---------------------------------------------------------------------------
// querySemanticFacts — guard rejection passthrough
// ---------------------------------------------------------------------------

describe("querySemanticFacts — guard passthrough", () => {
  it("rejects missing project_id via guard", () => {
    const backend = makeBackend([]);
    const result = querySemanticFacts(backend, { project_id: "" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.PROJECT_ID_REQUIRED);
    }
  });

  it("rejects invalid cursor via guard", () => {
    const backend = makeBackend([]);
    const result = querySemanticFacts(backend, {
      project_id: PROJECT,
      cursor: "not-a-valid-cursor",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.INVALID_CURSOR);
    }
  });
});

// ---------------------------------------------------------------------------
// querySemanticFacts — exact return-shape projection
// ---------------------------------------------------------------------------

describe("querySemanticFacts — return shape", () => {
  it("projects K2 record to exact K3 return shape", () => {
    const fact = makeFact({
      id: "fact-shape-test",
      project_id: PROJECT,
      schema_version: "1.0",
      fact_type: "GOVERNANCE_DECISION",
      fact_key: "actor.forge.trust_level",
      fact_value: { level: "high" },
      source_run_id: "run-shape",
      created_at: T0,
    });
    const backend = makeBackend([fact]);
    const result = querySemanticFacts(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.page.items.length, 1);
    const item = result.page.items[0];
    assert.equal(item.id, "fact-shape-test");
    assert.equal(item.project_id, PROJECT);
    assert.equal(item.fact_type, "GOVERNANCE_DECISION");
    assert.equal(item.fact_key, "actor.forge.trust_level");
    assert.equal(item.fact_value, JSON.stringify({ level: "high" }));
    assert.equal(item.status, "ACTIVE");
    assert.equal(item.source_run_id, "run-shape");
    assert.equal(item.created_at, T0.toISOString());
    assert.equal(item.schema_version, "1.0");
    // Verify no extra fields leaked
    const keys = Object.keys(item).sort();
    assert.deepStrictEqual(keys, [
      "created_at", "fact_key", "fact_type", "fact_value", "id",
      "project_id", "schema_version", "source_run_id", "status",
    ]);
  });

  it("converts created_at Date to ISO 8601 string", () => {
    const fact = makeFact({ created_at: T2 });
    const backend = makeBackend([fact]);
    const result = querySemanticFacts(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.page.items[0].created_at, "string");
      assert.equal(result.page.items[0].created_at, "2026-03-11T00:00:02.000Z");
    }
  });

  it("serializes fact_value Record to JSON string", () => {
    const fact = makeFact({ fact_value: { nested: { deep: true }, count: 42 } });
    const backend = makeBackend([fact]);
    const result = querySemanticFacts(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.page.items[0].fact_value, "string");
      assert.deepStrictEqual(
        JSON.parse(result.page.items[0].fact_value),
        { nested: { deep: true }, count: 42 },
      );
    }
  });

  it("sets status to ACTIVE for all facts", () => {
    const facts = [
      makeFact({ created_at: T0 }),
      makeFact({ created_at: T1 }),
    ];
    const backend = makeBackend(facts);
    const result = querySemanticFacts(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      for (const item of result.page.items) {
        assert.equal(item.status, "ACTIVE");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getSemanticFactById
// ---------------------------------------------------------------------------

describe("getSemanticFactById", () => {
  it("returns matching record projected to K3 shape", () => {
    const fact = makeFact({ id: "target-fact" });
    const backend = makeBackend([fact]);
    const result = getSemanticFactById(backend, PROJECT, "target-fact");
    assert.ok(result !== null);
    assert.equal(result.id, "target-fact");
    assert.equal(result.project_id, PROJECT);
    assert.equal(typeof result.created_at, "string");
    assert.equal(result.status, "ACTIVE");
  });

  it("returns null for non-existent id", () => {
    const backend = makeBackend([makeFact()]);
    const result = getSemanticFactById(backend, PROJECT, "does-not-exist");
    assert.equal(result, null);
  });

  it("returns null when project_id does not match", () => {
    const fact = makeFact({ project_id: OTHER_PROJECT, id: "cross-proj" });
    const backend = makeBackend([fact]);
    const result = getSemanticFactById(backend, PROJECT, "cross-proj");
    assert.equal(result, null);
  });

  it("returns null for empty project_id", () => {
    const fact = makeFact({ id: "some-fact" });
    const backend = makeBackend([fact]);
    const result = getSemanticFactById(backend, "", "some-fact");
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// getSemanticFactHistory
// ---------------------------------------------------------------------------

describe("getSemanticFactHistory", () => {
  it("returns all events linked to semantic_fact_id", () => {
    const events = [
      makeFactEvent({ semantic_fact_id: "fact-target", created_at: T0 }),
      makeFactEvent({ semantic_fact_id: "fact-other", created_at: T1 }),
      makeFactEvent({ semantic_fact_id: "fact-target", created_at: T2 }),
    ];
    const backend = makeBackend([], events);
    const result = getSemanticFactHistory(backend, PROJECT, "fact-target");
    assert.equal(result.length, 2);
    for (const item of result) {
      assert.equal(item.semantic_fact_id, "fact-target");
    }
  });

  it("enforces project isolation", () => {
    const events = [
      makeFactEvent({ project_id: PROJECT, semantic_fact_id: "shared", created_at: T0 }),
      makeFactEvent({ project_id: OTHER_PROJECT, semantic_fact_id: "shared", created_at: T1 }),
    ];
    const backend = makeBackend([], events);
    const result = getSemanticFactHistory(backend, PROJECT, "shared");
    assert.equal(result.length, 1);
  });

  it("returns deterministic (created_at ASC, id ASC) order", () => {
    const events = [
      makeFactEvent({ id: "z-evt", semantic_fact_id: "f1", created_at: T0 }),
      makeFactEvent({ id: "a-evt", semantic_fact_id: "f1", created_at: T0 }),
      makeFactEvent({ id: "m-evt", semantic_fact_id: "f1", created_at: T1 }),
    ];
    const backend = makeBackend([], events);
    const result = getSemanticFactHistory(backend, PROJECT, "f1");
    const ids = result.map((i) => i.id);
    assert.deepStrictEqual(ids, ["a-evt", "z-evt", "m-evt"]);
  });

  it("returns empty array when no events match", () => {
    const events = [makeFactEvent({ semantic_fact_id: "other" })];
    const backend = makeBackend([], events);
    const result = getSemanticFactHistory(backend, PROJECT, "missing");
    assert.equal(result.length, 0);
  });

  it("returns empty array for empty project_id", () => {
    const events = [makeFactEvent({ semantic_fact_id: "f1" })];
    const backend = makeBackend([], events);
    const result = getSemanticFactHistory(backend, "", "f1");
    assert.equal(result.length, 0);
  });

  it("returns projected K3 shapes with observed_at as ISO string", () => {
    const event = makeFactEvent({
      id: "proj-check",
      semantic_fact_id: "f1",
      episodic_event_id: "ep-99",
      observed_at: T2,
      created_at: T0,
    });
    const backend = makeBackend([], [event]);
    const result = getSemanticFactHistory(backend, PROJECT, "f1");
    assert.equal(result.length, 1);
    const item = result[0];
    assert.equal(typeof item.observed_at, "string");
    assert.equal(item.observed_at, T2.toISOString());
    assert.equal(item.episodic_event_id, "ep-99");
    // No created_at or project_id leaked in projected shape
    const keys = Object.keys(item).sort();
    assert.deepStrictEqual(keys, [
      "episodic_event_id", "id", "observed_at", "schema_version", "semantic_fact_id",
    ]);
  });
});

// ---------------------------------------------------------------------------
// No mutation — backend, K2 records, and query params must be unchanged
// ---------------------------------------------------------------------------

describe("semantic-read — no mutation", () => {
  it("querySemanticFacts does not mutate the backend source array", () => {
    const f1 = makeFact({ id: "mut-a", created_at: T1 });
    const f2 = makeFact({ id: "mut-b", created_at: T0 });
    const source = [f1, f2];
    const lengthBefore = source.length;
    const orderBefore = source.map((r) => r.id);
    const backend = makeBackend(source);

    querySemanticFacts(backend, { project_id: PROJECT });

    assert.equal(source.length, lengthBefore, "array length unchanged");
    assert.deepStrictEqual(source.map((r) => r.id), orderBefore, "element order unchanged");
  });

  it("querySemanticFacts does not mutate individual K2 records", () => {
    const f1 = makeFact({
      id: "immut-1",
      fact_value: { nested: { value: 42 } },
      created_at: T0,
    });
    const snap = snapshotFact(f1);
    const backend = makeBackend([f1]);

    querySemanticFacts(backend, { project_id: PROJECT });

    assert.deepStrictEqual(snapshotFact(f1), snap, "K2 record unchanged after query");
  });

  it("querySemanticFacts does not mutate caller-provided query params", () => {
    const params = {
      project_id: PROJECT,
      fact_type: ["GOVERNANCE_DECISION"] as readonly string[],
      fact_key: "some.key",
      limit: 10,
    };
    const paramSnap = JSON.parse(JSON.stringify(params));
    const backend = makeBackend([makeFact()]);

    querySemanticFacts(backend, params);

    assert.deepStrictEqual(JSON.parse(JSON.stringify(params)), paramSnap, "params unchanged");
  });

  it("getSemanticFactById does not mutate K2 records", () => {
    const f1 = makeFact({ id: "immut-get", fact_value: { key: "val" } });
    const snap = snapshotFact(f1);
    const backend = makeBackend([f1]);

    getSemanticFactById(backend, PROJECT, "immut-get");

    assert.deepStrictEqual(snapshotFact(f1), snap, "K2 record unchanged after getById");
  });

  it("getSemanticFactHistory does not mutate the backend source array", () => {
    const e1 = makeFactEvent({ id: "hmut-a", semantic_fact_id: "fx", created_at: T1 });
    const e2 = makeFactEvent({ id: "hmut-b", semantic_fact_id: "fx", created_at: T0 });
    const source = [e1, e2];
    const orderBefore = source.map((r) => r.id);
    const backend = makeBackend([], source);

    getSemanticFactHistory(backend, PROJECT, "fx");

    assert.deepStrictEqual(source.map((r) => r.id), orderBefore, "array order unchanged");
  });

  it("getSemanticFactHistory does not mutate individual K2 records", () => {
    const e1 = makeFactEvent({ id: "himmut", semantic_fact_id: "fy" });
    const snap = snapshotFactEvent(e1);
    const backend = makeBackend([], [e1]);

    getSemanticFactHistory(backend, PROJECT, "fy");

    assert.deepStrictEqual(snapshotFactEvent(e1), snap, "K2 record unchanged after history lookup");
  });
});

// ---------------------------------------------------------------------------
// No DB access — semantic-read operates entirely through K3ReadBackend
// ---------------------------------------------------------------------------

describe("semantic-read — no DB access", () => {
  it("semantic-read.ts does not import any database module", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../../src/memory/retrieval/semantic-read.ts", import.meta.url),
      "utf-8",
    );
    assert.ok(!src.includes("@prisma/client"), "no @prisma/client import");
    assert.ok(!src.includes("prisma"), "no prisma reference");
    assert.ok(!src.includes("pg"), "no pg import");
    assert.ok(!src.includes("postgres"), "no postgres import");
    assert.ok(!src.includes("supabase"), "no supabase import");
    assert.ok(!src.includes("fetch("), "no fetch() call");
    assert.ok(!src.includes("node:http"), "no node:http import");
    assert.ok(!src.includes("node:https"), "no node:https import");
  });

  it("querySemanticFacts succeeds using only the K3ReadBackend interface", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("DB/network access attempted via fetch"); }) as typeof fetch;
    try {
      const facts = [makeFact({ created_at: T0 })];
      const backend = makeBackend(facts);
      const result = querySemanticFacts(backend, { project_id: PROJECT });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.page.items.length, 1);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getSemanticFactById succeeds using only the K3ReadBackend interface", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("DB/network access attempted via fetch"); }) as typeof fetch;
    try {
      const fact = makeFact({ id: "fetch-guard" });
      const backend = makeBackend([fact]);
      const result = getSemanticFactById(backend, PROJECT, "fetch-guard");
      assert.ok(result !== null);
      assert.equal(result.id, "fetch-guard");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getSemanticFactHistory succeeds using only the K3ReadBackend interface", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("DB/network access attempted via fetch"); }) as typeof fetch;
    try {
      const event = makeFactEvent({ semantic_fact_id: "fetch-hist" });
      const backend = makeBackend([], [event]);
      const result = getSemanticFactHistory(backend, PROJECT, "fetch-hist");
      assert.equal(result.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Module hygiene
// ---------------------------------------------------------------------------

describe("semantic-read module hygiene", () => {
  it("does not generate IDs or timestamps", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../../src/memory/retrieval/semantic-read.ts", import.meta.url),
      "utf-8",
    );
    assert.ok(!src.includes("crypto.randomUUID"), "no UUID generation");
    assert.ok(!src.includes("Date.now()"), "no Date.now()");
    // Note: semantic-read uses .toISOString() on existing Date objects,
    // not new Date() constructor
  });
});
