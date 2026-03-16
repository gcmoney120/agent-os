/**
 * Agent OS — K3 Memory Retrieval Layer
 * Tests for episodic-read.ts — queryEpisodicEvents, getEpisodicEventById.
 *
 * Covers: project isolation, filter correctness, deterministic ordering,
 * cursor pagination, open-ended query rejection passthrough,
 * exact return-shape projection.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  queryEpisodicEvents,
  getEpisodicEventById,
} from "../../src/memory/retrieval/episodic-read.js";

import { GUARD_CODE } from "../../src/memory/retrieval/query-guards.js";
import { decodeCursor } from "../../src/memory/retrieval/pagination.js";

import type { K3ReadBackend } from "../../src/memory/retrieval/types.js";
import type { K2EpisodicEvent } from "../../src/memory/pipeline/types.js";

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
function uid(): string { return `evt-${++_seq}`; }

function makeEpisodic(overrides?: Partial<K2EpisodicEvent>): K2EpisodicEvent {
  return {
    id: uid(),
    project_id: PROJECT,
    schema_version: "1.0",
    run_id: "run-1",
    session_id: "sess-1",
    agent_role: "forge",
    event_type: "STEP_STARTED",
    payload: {},
    occurred_at: T0,
    created_at: T0,
    ...overrides,
  };
}

function makeBackend(events: K2EpisodicEvent[]): K3ReadBackend {
  return {
    allEpisodicEvents: () => events,
    allDecisionEvents: () => [],
    allSemanticFacts: () => [],
    allSemanticFactEvents: () => [],
    allEmbeddingRecords: () => [],
    allEmbeddingStatusEvents: () => [],
  };
}

// ---------------------------------------------------------------------------
// Project isolation
// ---------------------------------------------------------------------------

describe("queryEpisodicEvents — project isolation", () => {
  it("returns only records matching project_id", () => {
    const events = [
      makeEpisodic({ project_id: PROJECT, created_at: T0 }),
      makeEpisodic({ project_id: OTHER_PROJECT, created_at: T1 }),
      makeEpisodic({ project_id: PROJECT, created_at: T2 }),
    ];
    const backend = makeBackend(events);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      for (const item of result.page.items) {
        assert.equal(item.project_id, PROJECT);
      }
    }
  });

  it("returns empty page when no records match project_id", () => {
    const events = [
      makeEpisodic({ project_id: OTHER_PROJECT }),
    ];
    const backend = makeBackend(events);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 0);
      assert.equal(result.page.has_more, false);
    }
  });
});

// ---------------------------------------------------------------------------
// Filter correctness
// ---------------------------------------------------------------------------

describe("queryEpisodicEvents — filters", () => {
  it("filters by run_id", () => {
    const events = [
      makeEpisodic({ run_id: "run-1", created_at: T0 }),
      makeEpisodic({ run_id: "run-2", created_at: T1 }),
      makeEpisodic({ run_id: "run-1", created_at: T2 }),
    ];
    const backend = makeBackend(events);
    const result = queryEpisodicEvents(backend, {
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

  it("filters by event_type", () => {
    const events = [
      makeEpisodic({ event_type: "STEP_STARTED", created_at: T0 }),
      makeEpisodic({ event_type: "STEP_SUCCEEDED", created_at: T1 }),
      makeEpisodic({ event_type: "STEP_FAILED", created_at: T2 }),
    ];
    const backend = makeBackend(events);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      event_type: ["STEP_STARTED", "STEP_FAILED"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
      const types = result.page.items.map((i) => i.event_type);
      assert.ok(types.includes("STEP_STARTED"));
      assert.ok(types.includes("STEP_FAILED"));
    }
  });

  it("filters by actor_role", () => {
    const events = [
      makeEpisodic({ agent_role: "forge", created_at: T0 }),
      makeEpisodic({ agent_role: "sentinel", created_at: T1 }),
      makeEpisodic({ agent_role: "compass", created_at: T2 }),
    ];
    const backend = makeBackend(events);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
      actor_role: ["sentinel"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 1);
      assert.equal(result.page.items[0].actor_role, "sentinel");
    }
  });

  it("filters by created_at_from (inclusive)", () => {
    const events = [
      makeEpisodic({ created_at: T0 }),
      makeEpisodic({ created_at: T1 }),
      makeEpisodic({ created_at: T2 }),
    ];
    const backend = makeBackend(events);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      created_at_from: T1.toISOString(),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 2);
    }
  });

  it("filters by created_at_to (exclusive)", () => {
    const events = [
      makeEpisodic({ created_at: T0 }),
      makeEpisodic({ created_at: T1 }),
      makeEpisodic({ created_at: T2 }),
    ];
    const backend = makeBackend(events);
    const result = queryEpisodicEvents(backend, {
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
    const events = [
      makeEpisodic({ run_id: "run-1", event_type: "STEP_STARTED", agent_role: "forge", created_at: T0 }),
      makeEpisodic({ run_id: "run-1", event_type: "STEP_SUCCEEDED", agent_role: "forge", created_at: T1 }),
      makeEpisodic({ run_id: "run-2", event_type: "STEP_STARTED", agent_role: "forge", created_at: T2 }),
      makeEpisodic({ run_id: "run-1", event_type: "STEP_STARTED", agent_role: "sentinel", created_at: T3 }),
    ];
    const backend = makeBackend(events);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
      event_type: ["STEP_STARTED"],
      actor_role: ["forge"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items.length, 1);
      assert.equal(result.page.items[0].event_type, "STEP_STARTED");
      assert.equal(result.page.items[0].actor_role, "forge");
      assert.equal(result.page.items[0].run_id, "run-1");
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

describe("queryEpisodicEvents — ordering", () => {
  it("returns results in (created_at ASC, id ASC) order", () => {
    const e1 = makeEpisodic({ id: "z-last", created_at: T0 });
    const e2 = makeEpisodic({ id: "a-first", created_at: T0 });
    const e3 = makeEpisodic({ id: "m-mid", created_at: T1 });
    const backend = makeBackend([e1, e2, e3]);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const ids = result.page.items.map((i) => i.id);
      assert.deepStrictEqual(ids, ["a-first", "z-last", "m-mid"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

describe("queryEpisodicEvents — cursor pagination", () => {
  it("paginates correctly with limit=2", () => {
    const events = [
      makeEpisodic({ created_at: T0 }),
      makeEpisodic({ created_at: T1 }),
      makeEpisodic({ created_at: T2 }),
      makeEpisodic({ created_at: T3 }),
      makeEpisodic({ created_at: T4 }),
    ];
    const backend = makeBackend(events);

    // Page 1
    const page1 = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
      limit: 2,
    });
    assert.equal(page1.ok, true);
    if (!page1.ok) return;
    assert.equal(page1.page.items.length, 2);
    assert.equal(page1.page.has_more, true);
    assert.ok(page1.page.next_cursor !== null);

    // Page 2
    const page2 = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
      limit: 2,
      cursor: page1.page.next_cursor!,
    });
    assert.equal(page2.ok, true);
    if (!page2.ok) return;
    assert.equal(page2.page.items.length, 2);
    assert.equal(page2.page.has_more, true);

    // Page 3 (last)
    const page3 = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
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
});

// ---------------------------------------------------------------------------
// Open-ended query rejection passthrough
// ---------------------------------------------------------------------------

describe("queryEpisodicEvents — guard passthrough", () => {
  it("rejects open-ended query via guard", () => {
    const backend = makeBackend([]);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.OPEN_ENDED_SCAN);
    }
  });

  it("rejects missing project_id via guard", () => {
    const backend = makeBackend([]);
    const result = queryEpisodicEvents(backend, {
      project_id: "",
      run_id: "run-1",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.PROJECT_ID_REQUIRED);
    }
  });
});

// ---------------------------------------------------------------------------
// Exact return-shape projection
// ---------------------------------------------------------------------------

describe("queryEpisodicEvents — return shape", () => {
  it("projects K2 record to exact K3 return shape", () => {
    const event = makeEpisodic({
      id: "evt-shape-test",
      project_id: PROJECT,
      schema_version: "1.0",
      run_id: "run-shape",
      agent_role: "sentinel",
      event_type: "GOVERNANCE_DECISION",
      payload: { key: "value" },
      created_at: T0,
    });
    const backend = makeBackend([event]);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-shape",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.page.items.length, 1);
    const item = result.page.items[0];
    assert.equal(item.id, "evt-shape-test");
    assert.equal(item.project_id, PROJECT);
    assert.equal(item.run_id, "run-shape");
    assert.equal(item.event_type, "GOVERNANCE_DECISION");
    assert.equal(item.actor_role, "sentinel");
    assert.deepStrictEqual(item.payload, { key: "value" });
    assert.equal(item.created_at, T0.toISOString());
    assert.equal(item.schema_version, "1.0");
    // Verify no extra fields leaked
    const keys = Object.keys(item).sort();
    assert.deepStrictEqual(keys, [
      "actor_role", "created_at", "event_type", "id",
      "payload", "project_id", "run_id", "schema_version",
    ]);
  });

  it("maps agent_role to actor_role in return shape", () => {
    const event = makeEpisodic({ agent_role: "compass" });
    const backend = makeBackend([event]);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.page.items[0].actor_role, "compass");
    }
  });

  it("converts created_at Date to ISO 8601 string", () => {
    const event = makeEpisodic({ created_at: T2 });
    const backend = makeBackend([event]);
    const result = queryEpisodicEvents(backend, {
      project_id: PROJECT,
      run_id: "run-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.page.items[0].created_at, "string");
      assert.equal(result.page.items[0].created_at, "2026-03-11T00:00:02.000Z");
    }
  });
});

// ---------------------------------------------------------------------------
// getEpisodicEventById
// ---------------------------------------------------------------------------

describe("getEpisodicEventById", () => {
  it("returns matching record projected to K3 shape", () => {
    const event = makeEpisodic({ id: "target-id" });
    const backend = makeBackend([event]);
    const result = getEpisodicEventById(backend, PROJECT, "target-id");
    assert.ok(result !== null);
    assert.equal(result.id, "target-id");
    assert.equal(result.project_id, PROJECT);
    assert.equal(typeof result.created_at, "string");
  });

  it("returns null for non-existent id", () => {
    const backend = makeBackend([makeEpisodic()]);
    const result = getEpisodicEventById(backend, PROJECT, "does-not-exist");
    assert.equal(result, null);
  });

  it("returns null when project_id does not match", () => {
    const event = makeEpisodic({ project_id: OTHER_PROJECT, id: "cross-proj" });
    const backend = makeBackend([event]);
    const result = getEpisodicEventById(backend, PROJECT, "cross-proj");
    assert.equal(result, null);
  });

  it("returns null for empty project_id", () => {
    const event = makeEpisodic({ id: "some-id" });
    const backend = makeBackend([event]);
    const result = getEpisodicEventById(backend, "", "some-id");
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// Module hygiene
// ---------------------------------------------------------------------------

describe("episodic-read module hygiene", () => {
  it("does not generate IDs or timestamps", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../../src/memory/retrieval/episodic-read.ts", import.meta.url),
      "utf-8",
    );
    assert.ok(!src.includes("crypto.randomUUID"), "no UUID generation");
    assert.ok(!src.includes("Date.now()"), "no Date.now()");
    assert.ok(!src.includes("new Date()"), "no zero-arg new Date()");
  });
});
