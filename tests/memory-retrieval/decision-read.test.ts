/**
 * Agent OS — K3 Memory Retrieval Layer
 * Tests for decision-read.ts — queryDecisionEvents, getDecisionEventById,
 * getDecisionsByEpisodicEvent.
 *
 * Covers: project isolation, filter correctness, deterministic ordering,
 * cursor pagination, guard rejection passthrough, exact return-shape projection,
 * no mutation, no DB access.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  queryDecisionEvents,
  getDecisionEventById,
  getDecisionsByEpisodicEvent,
} from "../../src/memory/retrieval/decision-read.js";

import { GUARD_CODE } from "../../src/memory/retrieval/query-guards.js";
import { decodeCursor } from "../../src/memory/retrieval/pagination.js";

import type { K3ReadBackend } from "../../src/memory/retrieval/types.js";
import type { K2DecisionEvent } from "../../src/memory/pipeline/types.js";

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

let _seq = 0;
function uid(): string { return `dec-${++_seq}`; }

function makeDecision(overrides?: Partial<K2DecisionEvent>): K2DecisionEvent {
  return {
    id: uid(),
    project_id: PROJECT,
    schema_version: "1.0",
    run_id: "run-1",
    decision_type: "GOVERNANCE_DECISION",
    actor_role: "command",
    episodic_event_id: "ep-1",
    decision_payload: {},
    decided_at: T0,
    created_at: T0,
    ...overrides,
  };
}

function makeBackend(decisions: K2DecisionEvent[]): K3ReadBackend {
  return {
    allEpisodicEvents: () => [],
    allDecisionEvents: () => decisions,
    allSemanticFacts: () => [],
    allSemanticFactEvents: () => [],
    allEmbeddingRecords: () => [],
    allEmbeddingStatusEvents: () => [],
  };
}

/** Deep-clone a K2DecisionEvent for snapshot comparison. */
function snapshot(record: K2DecisionEvent): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    ...record,
    decided_at: record.decided_at.toISOString(),
    created_at: record.created_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// queryDecisionEvents — project isolation
// ---------------------------------------------------------------------------

describe("queryDecisionEvents — project isolation", () => {
  it("returns only records matching project_id", () => {
    const decisions = [
      makeDecision({ project_id: PROJECT, created_at: T0 }),
      makeDecision({ project_id: OTHER_PROJECT, created_at: T1 }),
      makeDecision({ project_id: PROJECT, created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      for (const item of result.page.items) {
        assert.equal(item.project_id, PROJECT);
      }
    }
  });

  it("returns empty page when no records match project_id", () => {
    const decisions = [
      makeDecision({ project_id: OTHER_PROJECT }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 0);
      assert.equal(result.page.has_more, false);
      assert.equal(result.page.next_cursor, null);
    }
  });
});

// ---------------------------------------------------------------------------
// queryDecisionEvents — filter correctness
// ---------------------------------------------------------------------------

describe("queryDecisionEvents — filters", () => {
  it("filters by run_id", () => {
    const decisions = [
      makeDecision({ run_id: "run-1", created_at: T0 }),
      makeDecision({ run_id: "run-2", created_at: T1 }),
      makeDecision({ run_id: "run-1", created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      for (const item of result.page.items) {
        assert.equal(item.run_id, "run-1");
      }
    }
  });

  it("filters by decision_type", () => {
    const decisions = [
      makeDecision({ decision_type: "GOVERNANCE_DECISION", created_at: T0 }),
      makeDecision({ decision_type: "ARCHITECTURE_APPROVAL", created_at: T1 }),
      makeDecision({ decision_type: "TRUST_CHANGE", created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, {
      project_id: PROJECT,
      decision_type: ["GOVERNANCE_DECISION", "TRUST_CHANGE"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      const types = result.page.items.map((i) => i.decision_type);
      assert.ok(types.includes("GOVERNANCE_DECISION"));
      assert.ok(types.includes("TRUST_CHANGE"));
    }
  });

  it("filters by actor_role", () => {
    const decisions = [
      makeDecision({ actor_role: "command", created_at: T0 }),
      makeDecision({ actor_role: "atlas", created_at: T1 }),
      makeDecision({ actor_role: "command", created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, {
      project_id: PROJECT,
      actor_role: ["atlas"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 1);
      assert.equal(result.page.items[0].actor_role, "atlas");
    }
  });

  it("filters by episodic_event_id", () => {
    const decisions = [
      makeDecision({ episodic_event_id: "ep-1", created_at: T0 }),
      makeDecision({ episodic_event_id: "ep-2", created_at: T1 }),
      makeDecision({ episodic_event_id: "ep-1", created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, {
      project_id: PROJECT,
      episodic_event_id: "ep-2",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 1);
      assert.equal(result.page.items[0].episodic_event_id, "ep-2");
    }
  });

  it("filters by created_at_from (inclusive)", () => {
    const decisions = [
      makeDecision({ created_at: T0 }),
      makeDecision({ created_at: T1 }),
      makeDecision({ created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, {
      project_id: PROJECT,
      created_at_from: T1.toISOString(),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
    }
  });

  it("filters by created_at_to (exclusive)", () => {
    const decisions = [
      makeDecision({ created_at: T0 }),
      makeDecision({ created_at: T1 }),
      makeDecision({ created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, {
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
    const decisions = [
      makeDecision({ run_id: "run-1", decision_type: "GOVERNANCE_DECISION", actor_role: "command", created_at: T0 }),
      makeDecision({ run_id: "run-1", decision_type: "ARCHITECTURE_APPROVAL", actor_role: "command", created_at: T1 }),
      makeDecision({ run_id: "run-2", decision_type: "GOVERNANCE_DECISION", actor_role: "command", created_at: T2 }),
      makeDecision({ run_id: "run-1", decision_type: "GOVERNANCE_DECISION", actor_role: "atlas", created_at: T3 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
      decision_type: ["GOVERNANCE_DECISION"],
      actor_role: ["command"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 1);
      assert.equal(result.page.items[0].decision_type, "GOVERNANCE_DECISION");
      assert.equal(result.page.items[0].actor_role, "command");
      assert.equal(result.page.items[0].run_id, "run-1");
    }
  });
});

// ---------------------------------------------------------------------------
// queryDecisionEvents — deterministic ordering
// ---------------------------------------------------------------------------

describe("queryDecisionEvents — ordering", () => {
  it("returns results in (created_at ASC, id ASC) order", () => {
    const d1 = makeDecision({ id: "z-last", created_at: T0 });
    const d2 = makeDecision({ id: "a-first", created_at: T0 });
    const d3 = makeDecision({ id: "m-mid", created_at: T1 });
    const backend = makeBackend([d1, d2, d3]);
    const result = queryDecisionEvents(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      const ids = result.page.items.map((i) => i.id);
      assert.deepStrictEqual(ids, ["a-first", "z-last", "m-mid"]);
    }
  });

  it("is stable across repeated calls", () => {
    const decisions = [
      makeDecision({ id: "c", created_at: T1 }),
      makeDecision({ id: "a", created_at: T0 }),
      makeDecision({ id: "b", created_at: T1 }),
    ];
    const backend = makeBackend(decisions);
    const r1 = queryDecisionEvents(backend, { project_id: PROJECT });
    const r2 = queryDecisionEvents(backend, { project_id: PROJECT });
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
// queryDecisionEvents — cursor pagination
// ---------------------------------------------------------------------------

describe("queryDecisionEvents — cursor pagination", () => {
  it("paginates correctly with limit=2", () => {
    const decisions = [
      makeDecision({ created_at: T0 }),
      makeDecision({ created_at: T1 }),
      makeDecision({ created_at: T2 }),
      makeDecision({ created_at: T3 }),
      makeDecision({ created_at: T4 }),
    ];
    const backend = makeBackend(decisions);

    // Page 1
    const page1 = queryDecisionEvents(backend, {
      project_id: PROJECT,
      limit: 2,
    });
    assert.equal(page1.ok, true);
    if (!page1.ok) return;
    assert.equal(page1.page.items.length, 2);
    assert.equal(page1.page.has_more, true);
    assert.ok(page1.page.next_cursor !== null);

    // Page 2
    const page2 = queryDecisionEvents(backend, {
      project_id: PROJECT,
      limit: 2,
      cursor: page1.page.next_cursor!,
    });
    assert.equal(page2.ok, true);
    if (!page2.ok) return;
    assert.equal(page2.page.items.length, 2);
    assert.equal(page2.page.has_more, true);

    // Page 3 (last)
    const page3 = queryDecisionEvents(backend, {
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
    const decisions = [
      makeDecision({ id: "d-aaa", created_at: T0 }),
      makeDecision({ id: "d-bbb", created_at: T1 }),
      makeDecision({ id: "d-ccc", created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = queryDecisionEvents(backend, {
      project_id: PROJECT,
      limit: 2,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.page.next_cursor !== null);
    const decoded = decodeCursor(result.page.next_cursor!);
    assert.ok(decoded !== null);
    assert.equal(decoded!.sort_key, T1.toISOString());
    assert.equal(decoded!.id, "d-bbb");
  });
});

// ---------------------------------------------------------------------------
// queryDecisionEvents — guard rejection passthrough
// ---------------------------------------------------------------------------

describe("queryDecisionEvents — guard passthrough", () => {
  it("rejects missing project_id via guard", () => {
    const backend = makeBackend([]);
    const result = queryDecisionEvents(backend, { project_id: "" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.PROJECT_ID_REQUIRED);
    }
  });

  it("rejects invalid cursor via guard", () => {
    const backend = makeBackend([]);
    const result = queryDecisionEvents(backend, {
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
// queryDecisionEvents — exact return-shape projection
// ---------------------------------------------------------------------------

describe("queryDecisionEvents — return shape", () => {
  it("projects K2 record to exact K3 return shape", () => {
    const decision = makeDecision({
      id: "dec-shape-test",
      project_id: PROJECT,
      schema_version: "1.0",
      run_id: "run-shape",
      decision_type: "ARCHITECTURE_APPROVAL",
      actor_role: "command",
      episodic_event_id: "ep-shape",
      decision_payload: { approved: true },
      created_at: T0,
    });
    const backend = makeBackend([decision]);
    const result = queryDecisionEvents(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.page.items.length, 1);
    const item = result.page.items[0];
    assert.equal(item.id, "dec-shape-test");
    assert.equal(item.project_id, PROJECT);
    assert.equal(item.run_id, "run-shape");
    assert.equal(item.decision_type, "ARCHITECTURE_APPROVAL");
    assert.equal(item.actor_role, "command");
    assert.equal(item.episodic_event_id, "ep-shape");
    assert.deepStrictEqual(item.decision_payload, { approved: true });
    assert.equal(item.created_at, T0.toISOString());
    assert.equal(item.schema_version, "1.0");
    // Verify no extra fields leaked (decided_at, etc.)
    const keys = Object.keys(item).sort();
    assert.deepStrictEqual(keys, [
      "actor_role", "created_at", "decision_payload", "decision_type",
      "episodic_event_id", "id", "project_id", "run_id", "schema_version",
    ]);
  });

  it("converts created_at Date to ISO 8601 string", () => {
    const decision = makeDecision({ created_at: T2 });
    const backend = makeBackend([decision]);
    const result = queryDecisionEvents(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.page.items[0].created_at, "string");
      assert.equal(result.page.items[0].created_at, "2026-03-11T00:00:02.000Z");
    }
  });

  it("normalizes undefined decision_payload to null", () => {
    const decision = makeDecision({
      decision_payload: undefined as unknown as Record<string, unknown>,
    });
    const backend = makeBackend([decision]);
    const result = queryDecisionEvents(backend, { project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items[0].decision_payload, null);
    }
  });
});

// ---------------------------------------------------------------------------
// getDecisionEventById
// ---------------------------------------------------------------------------

describe("getDecisionEventById", () => {
  it("returns matching record projected to K3 shape", () => {
    const decision = makeDecision({ id: "target-dec" });
    const backend = makeBackend([decision]);
    const result = getDecisionEventById(backend, PROJECT, "target-dec");
    assert.ok(result !== null);
    assert.equal(result.id, "target-dec");
    assert.equal(result.project_id, PROJECT);
    assert.equal(typeof result.created_at, "string");
  });

  it("returns null for non-existent id", () => {
    const backend = makeBackend([makeDecision()]);
    const result = getDecisionEventById(backend, PROJECT, "does-not-exist");
    assert.equal(result, null);
  });

  it("returns null when project_id does not match", () => {
    const decision = makeDecision({ project_id: OTHER_PROJECT, id: "cross-proj" });
    const backend = makeBackend([decision]);
    const result = getDecisionEventById(backend, PROJECT, "cross-proj");
    assert.equal(result, null);
  });

  it("returns null for empty project_id", () => {
    const decision = makeDecision({ id: "some-dec" });
    const backend = makeBackend([decision]);
    const result = getDecisionEventById(backend, "", "some-dec");
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// getDecisionsByEpisodicEvent
// ---------------------------------------------------------------------------

describe("getDecisionsByEpisodicEvent", () => {
  it("returns all decisions linked to episodic_event_id", () => {
    const decisions = [
      makeDecision({ episodic_event_id: "ep-target", created_at: T0 }),
      makeDecision({ episodic_event_id: "ep-other", created_at: T1 }),
      makeDecision({ episodic_event_id: "ep-target", created_at: T2 }),
    ];
    const backend = makeBackend(decisions);
    const result = getDecisionsByEpisodicEvent(backend, PROJECT, "ep-target");
    assert.equal(result.length, 2);
    for (const item of result) {
      assert.equal(item.episodic_event_id, "ep-target");
    }
  });

  it("enforces project isolation", () => {
    const decisions = [
      makeDecision({ project_id: PROJECT, episodic_event_id: "ep-shared", created_at: T0 }),
      makeDecision({ project_id: OTHER_PROJECT, episodic_event_id: "ep-shared", created_at: T1 }),
    ];
    const backend = makeBackend(decisions);
    const result = getDecisionsByEpisodicEvent(backend, PROJECT, "ep-shared");
    assert.equal(result.length, 1);
    assert.equal(result[0].project_id, PROJECT);
  });

  it("returns deterministic (created_at ASC, id ASC) order", () => {
    const decisions = [
      makeDecision({ id: "z-dec", episodic_event_id: "ep-1", created_at: T0 }),
      makeDecision({ id: "a-dec", episodic_event_id: "ep-1", created_at: T0 }),
      makeDecision({ id: "m-dec", episodic_event_id: "ep-1", created_at: T1 }),
    ];
    const backend = makeBackend(decisions);
    const result = getDecisionsByEpisodicEvent(backend, PROJECT, "ep-1");
    const ids = result.map((i) => i.id);
    assert.deepStrictEqual(ids, ["a-dec", "z-dec", "m-dec"]);
  });

  it("returns empty array when no decisions match", () => {
    const decisions = [
      makeDecision({ episodic_event_id: "ep-other" }),
    ];
    const backend = makeBackend(decisions);
    const result = getDecisionsByEpisodicEvent(backend, PROJECT, "ep-missing");
    assert.equal(result.length, 0);
  });

  it("returns empty array for empty project_id", () => {
    const decisions = [
      makeDecision({ episodic_event_id: "ep-1" }),
    ];
    const backend = makeBackend(decisions);
    const result = getDecisionsByEpisodicEvent(backend, "", "ep-1");
    assert.equal(result.length, 0);
  });

  it("returns projected K3 shapes (not raw K2 records)", () => {
    const decision = makeDecision({
      id: "proj-check",
      episodic_event_id: "ep-1",
      decision_payload: { note: "test" },
      created_at: T0,
    });
    const backend = makeBackend([decision]);
    const result = getDecisionsByEpisodicEvent(backend, PROJECT, "ep-1");
    assert.equal(result.length, 1);
    const item = result[0];
    assert.equal(typeof item.created_at, "string");
    assert.equal(item.created_at, T0.toISOString());
    // No decided_at field leaked
    const keys = Object.keys(item).sort();
    assert.deepStrictEqual(keys, [
      "actor_role", "created_at", "decision_payload", "decision_type",
      "episodic_event_id", "id", "project_id", "run_id", "schema_version",
    ]);
  });
});

// ---------------------------------------------------------------------------
// No mutation — backend, K2 records, and query params must be unchanged
// ---------------------------------------------------------------------------

describe("decision-read — no mutation", () => {
  it("queryDecisionEvents does not mutate the backend source array", () => {
    const d1 = makeDecision({ id: "mut-a", created_at: T1 });
    const d2 = makeDecision({ id: "mut-b", created_at: T0 });
    const source = [d1, d2];
    const lengthBefore = source.length;
    const orderBefore = source.map((r) => r.id);
    const backend = makeBackend(source);

    queryDecisionEvents(backend, { project_id: PROJECT });

    assert.equal(source.length, lengthBefore, "array length unchanged");
    assert.deepStrictEqual(source.map((r) => r.id), orderBefore, "element order unchanged");
  });

  it("queryDecisionEvents does not mutate individual K2 records", () => {
    const d1 = makeDecision({
      id: "immut-1",
      decision_payload: { nested: { value: 42 } },
      created_at: T0,
    });
    const snap = snapshot(d1);
    const backend = makeBackend([d1]);

    queryDecisionEvents(backend, { project_id: PROJECT });

    assert.deepStrictEqual(snapshot(d1), snap, "K2 record unchanged after query");
  });

  it("queryDecisionEvents does not mutate caller-provided query params", () => {
    const params = {
      project_id: PROJECT,
      run_id: "run-1",
      decision_type: ["GOVERNANCE_DECISION"] as readonly string[],
      actor_role: ["command"] as readonly string[],
      limit: 10,
    };
    const paramSnap = JSON.parse(JSON.stringify(params));
    const backend = makeBackend([makeDecision()]);

    queryDecisionEvents(backend, params);

    assert.deepStrictEqual(JSON.parse(JSON.stringify(params)), paramSnap, "params unchanged");
  });

  it("getDecisionEventById does not mutate K2 records", () => {
    const d1 = makeDecision({ id: "immut-get", decision_payload: { key: "val" } });
    const snap = snapshot(d1);
    const backend = makeBackend([d1]);

    getDecisionEventById(backend, PROJECT, "immut-get");

    assert.deepStrictEqual(snapshot(d1), snap, "K2 record unchanged after getById");
  });

  it("getDecisionsByEpisodicEvent does not mutate the backend source array", () => {
    const d1 = makeDecision({ id: "ep-mut-a", episodic_event_id: "ep-x", created_at: T1 });
    const d2 = makeDecision({ id: "ep-mut-b", episodic_event_id: "ep-x", created_at: T0 });
    const source = [d1, d2];
    const orderBefore = source.map((r) => r.id);
    const backend = makeBackend(source);

    getDecisionsByEpisodicEvent(backend, PROJECT, "ep-x");

    assert.deepStrictEqual(source.map((r) => r.id), orderBefore, "array order unchanged");
  });

  it("getDecisionsByEpisodicEvent does not mutate individual K2 records", () => {
    const d1 = makeDecision({
      id: "ep-immut",
      episodic_event_id: "ep-y",
      decision_payload: { deep: { obj: true } },
    });
    const snap = snapshot(d1);
    const backend = makeBackend([d1]);

    getDecisionsByEpisodicEvent(backend, PROJECT, "ep-y");

    assert.deepStrictEqual(snapshot(d1), snap, "K2 record unchanged after episodic lookup");
  });
});

// ---------------------------------------------------------------------------
// No DB access — decision-read operates entirely through K3ReadBackend
// ---------------------------------------------------------------------------

describe("decision-read — no DB access", () => {
  it("decision-read.ts does not import any database module", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../../src/memory/retrieval/decision-read.ts", import.meta.url),
      "utf-8",
    );
    // No Prisma client imports
    assert.ok(!src.includes("@prisma/client"), "no @prisma/client import");
    assert.ok(!src.includes("prisma"), "no prisma reference");
    // No raw SQL / database driver imports
    assert.ok(!src.includes("pg"), "no pg import");
    assert.ok(!src.includes("postgres"), "no postgres import");
    assert.ok(!src.includes("supabase"), "no supabase import");
    // No network access
    assert.ok(!src.includes("fetch("), "no fetch() call");
    assert.ok(!src.includes("node:http"), "no node:http import");
    assert.ok(!src.includes("node:https"), "no node:https import");
  });

  it("queryDecisionEvents succeeds using only the K3ReadBackend interface", () => {
    // Patch globalThis.fetch to throw if touched
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("DB/network access attempted via fetch"); }) as typeof fetch;
    try {
      const decisions = [makeDecision({ created_at: T0 })];
      const backend = makeBackend(decisions);
      const result = queryDecisionEvents(backend, { project_id: PROJECT });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.page.items.length, 1);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getDecisionEventById succeeds using only the K3ReadBackend interface", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("DB/network access attempted via fetch"); }) as typeof fetch;
    try {
      const decision = makeDecision({ id: "fetch-guard" });
      const backend = makeBackend([decision]);
      const result = getDecisionEventById(backend, PROJECT, "fetch-guard");
      assert.ok(result !== null);
      assert.equal(result.id, "fetch-guard");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getDecisionsByEpisodicEvent succeeds using only the K3ReadBackend interface", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("DB/network access attempted via fetch"); }) as typeof fetch;
    try {
      const decision = makeDecision({ episodic_event_id: "ep-fetch-guard" });
      const backend = makeBackend([decision]);
      const result = getDecisionsByEpisodicEvent(backend, PROJECT, "ep-fetch-guard");
      assert.equal(result.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Module hygiene
// ---------------------------------------------------------------------------

describe("decision-read module hygiene", () => {
  it("does not generate IDs or timestamps", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../../src/memory/retrieval/decision-read.ts", import.meta.url),
      "utf-8",
    );
    assert.ok(!src.includes("crypto.randomUUID"), "no UUID generation");
    assert.ok(!src.includes("Date.now()"), "no Date.now()");
    assert.ok(!src.includes("new Date()"), "no zero-arg new Date()");
  });
});
