/**
 * Agent OS — K3 Memory Retrieval Layer
 * Tests for pagination.ts — cursor encode/decode, limit clamping,
 * deterministic ordering, keyset filtering, and page building.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampLimit,
  encodeCursor,
  decodeCursor,
  compareByCreatedAtId,
  compareByTransitionedAtId,
  applyCreatedAtCursor,
  applyTransitionedAtCursor,
  buildPage,
} from "../../src/memory/retrieval/pagination.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T0 = new Date("2026-03-11T00:00:00.000Z");
const T1 = new Date("2026-03-11T00:00:01.000Z");
const T2 = new Date("2026-03-11T00:00:02.000Z");

function makeRecord(id: string, created_at: Date) {
  return { id, created_at };
}

function makeTransitionRecord(id: string, transitioned_at: Date) {
  return { id, transitioned_at };
}

// ---------------------------------------------------------------------------
// clampLimit
// ---------------------------------------------------------------------------

describe("clampLimit", () => {
  it("returns default 50 when undefined", () => {
    assert.equal(clampLimit(undefined), 50);
  });

  it("returns default 50 when 0", () => {
    assert.equal(clampLimit(0), 50);
  });

  it("returns default 50 when negative", () => {
    assert.equal(clampLimit(-5), 50);
  });

  it("returns value when within range", () => {
    assert.equal(clampLimit(1), 1);
    assert.equal(clampLimit(100), 100);
    assert.equal(clampLimit(200), 200);
  });

  it("clamps to 200 when above max", () => {
    assert.equal(clampLimit(201), 200);
    assert.equal(clampLimit(1000), 200);
  });

  it("floors fractional values", () => {
    assert.equal(clampLimit(10.7), 10);
    assert.equal(clampLimit(199.9), 199);
  });
});

// ---------------------------------------------------------------------------
// encodeCursor / decodeCursor
// ---------------------------------------------------------------------------

describe("cursor encode/decode", () => {
  it("round-trips sort_key and id", () => {
    const sort_key = "2026-03-11T00:00:00.000Z";
    const id = "evt-001";
    const cursor = encodeCursor(sort_key, id);
    const decoded = decodeCursor(cursor);
    assert.ok(decoded !== null);
    assert.equal(decoded.sort_key, sort_key);
    assert.equal(decoded.id, id);
  });

  it("produces opaque base64 string", () => {
    const cursor = encodeCursor("2026-03-11T00:00:00.000Z", "id-1");
    const re = /^[A-Za-z0-9+/]+=*$/;
    assert.ok(re.test(cursor), "cursor should be base64");
  });

  it("handles ids containing colons", () => {
    const sort_key = "2026-03-11T12:30:45.000Z";
    const id = "ns:sub:id-42";
    const cursor = encodeCursor(sort_key, id);
    const decoded = decodeCursor(cursor);
    assert.ok(decoded !== null);
    assert.equal(decoded.sort_key, sort_key);
    assert.equal(decoded.id, id);
  });

  it("handles ids containing special characters", () => {
    const sort_key = "2026-03-11T00:00:00.000Z";
    const id = "id with spaces & {braces}";
    const cursor = encodeCursor(sort_key, id);
    const decoded = decodeCursor(cursor);
    assert.ok(decoded !== null);
    assert.equal(decoded.id, id);
  });

  it("returns null for garbage input", () => {
    assert.equal(decodeCursor("not-a-cursor"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(decodeCursor(""), null);
  });

  it("returns null for valid base64 but wrong version", () => {
    const bad = Buffer.from(
      JSON.stringify({ v: "k3v99", sort_key: "2026-03-11T00:00:00.000Z", id: "x" }),
    ).toString("base64");
    assert.equal(decodeCursor(bad), null);
  });

  it("returns null for valid base64 JSON missing sort_key", () => {
    const bad = Buffer.from(
      JSON.stringify({ v: "k3v1", id: "x" }),
    ).toString("base64");
    assert.equal(decodeCursor(bad), null);
  });

  it("returns null for valid base64 JSON missing id", () => {
    const bad = Buffer.from(
      JSON.stringify({ v: "k3v1", sort_key: "2026-03-11T00:00:00.000Z" }),
    ).toString("base64");
    assert.equal(decodeCursor(bad), null);
  });

  it("returns null for empty sort_key", () => {
    const bad = Buffer.from(
      JSON.stringify({ v: "k3v1", sort_key: "", id: "x" }),
    ).toString("base64");
    assert.equal(decodeCursor(bad), null);
  });

  it("returns null for empty id", () => {
    const bad = Buffer.from(
      JSON.stringify({ v: "k3v1", sort_key: "2026-03-11T00:00:00.000Z", id: "" }),
    ).toString("base64");
    assert.equal(decodeCursor(bad), null);
  });

  it("returns null for invalid timestamp in sort_key", () => {
    const bad = Buffer.from(
      JSON.stringify({ v: "k3v1", sort_key: "not-a-date", id: "x" }),
    ).toString("base64");
    assert.equal(decodeCursor(bad), null);
  });

  it("returns null for non-object JSON", () => {
    const bad = Buffer.from(JSON.stringify("string")).toString("base64");
    assert.equal(decodeCursor(bad), null);
  });

  it("returns null for null JSON", () => {
    const bad = Buffer.from(JSON.stringify(null)).toString("base64");
    assert.equal(decodeCursor(bad), null);
  });
});

// ---------------------------------------------------------------------------
// compareByCreatedAtId
// ---------------------------------------------------------------------------

describe("compareByCreatedAtId", () => {
  it("sorts by created_at ascending", () => {
    const a = makeRecord("a", T0);
    const b = makeRecord("b", T1);
    assert.ok(compareByCreatedAtId(a, b) < 0);
    assert.ok(compareByCreatedAtId(b, a) > 0);
  });

  it("uses id as tie-breaker when created_at is equal", () => {
    const a = makeRecord("aaa", T0);
    const b = makeRecord("bbb", T0);
    assert.ok(compareByCreatedAtId(a, b) < 0);
    assert.ok(compareByCreatedAtId(b, a) > 0);
  });

  it("returns 0 for identical records", () => {
    const a = makeRecord("same", T0);
    assert.equal(compareByCreatedAtId(a, a), 0);
  });

  it("produces deterministic sort across array", () => {
    const records = [
      makeRecord("c", T1),
      makeRecord("a", T0),
      makeRecord("b", T0),
      makeRecord("d", T2),
    ];
    const sorted = [...records].sort(compareByCreatedAtId);
    assert.deepStrictEqual(
      sorted.map((r) => r.id),
      ["a", "b", "c", "d"],
    );
  });
});

// ---------------------------------------------------------------------------
// compareByTransitionedAtId
// ---------------------------------------------------------------------------

describe("compareByTransitionedAtId", () => {
  it("sorts by transitioned_at ascending", () => {
    const a = makeTransitionRecord("a", T0);
    const b = makeTransitionRecord("b", T1);
    assert.ok(compareByTransitionedAtId(a, b) < 0);
    assert.ok(compareByTransitionedAtId(b, a) > 0);
  });

  it("uses id as tie-breaker when transitioned_at is equal", () => {
    const a = makeTransitionRecord("aaa", T0);
    const b = makeTransitionRecord("bbb", T0);
    assert.ok(compareByTransitionedAtId(a, b) < 0);
    assert.ok(compareByTransitionedAtId(b, a) > 0);
  });

  it("returns 0 for identical records", () => {
    const a = makeTransitionRecord("same", T0);
    assert.equal(compareByTransitionedAtId(a, a), 0);
  });
});

// ---------------------------------------------------------------------------
// applyCreatedAtCursor
// ---------------------------------------------------------------------------

describe("applyCreatedAtCursor", () => {
  it("retains only records after cursor position", () => {
    const records = [
      makeRecord("a", T0),
      makeRecord("b", T1),
      makeRecord("c", T2),
    ];
    const result = applyCreatedAtCursor(records, {
      sort_key: T0.toISOString(),
      id: "a",
    });
    assert.deepStrictEqual(
      result.map((r) => r.id),
      ["b", "c"],
    );
  });

  it("handles tie-breaker correctly — same timestamp, later id passes", () => {
    const records = [
      makeRecord("a", T0),
      makeRecord("b", T0),
      makeRecord("c", T0),
    ];
    const result = applyCreatedAtCursor(records, {
      sort_key: T0.toISOString(),
      id: "a",
    });
    assert.deepStrictEqual(
      result.map((r) => r.id),
      ["b", "c"],
    );
  });

  it("returns empty when cursor is past all records", () => {
    const records = [makeRecord("a", T0)];
    const result = applyCreatedAtCursor(records, {
      sort_key: T2.toISOString(),
      id: "z",
    });
    assert.equal(result.length, 0);
  });

  it("returns all records when cursor is before all records", () => {
    const records = [makeRecord("b", T1), makeRecord("c", T2)];
    const result = applyCreatedAtCursor(records, {
      sort_key: T0.toISOString(),
      id: "a",
    });
    assert.equal(result.length, 2);
  });
});

// ---------------------------------------------------------------------------
// applyTransitionedAtCursor
// ---------------------------------------------------------------------------

describe("applyTransitionedAtCursor", () => {
  it("retains only records after cursor position", () => {
    const records = [
      makeTransitionRecord("a", T0),
      makeTransitionRecord("b", T1),
      makeTransitionRecord("c", T2),
    ];
    const result = applyTransitionedAtCursor(records, {
      sort_key: T0.toISOString(),
      id: "a",
    });
    assert.deepStrictEqual(
      result.map((r) => r.id),
      ["b", "c"],
    );
  });

  it("handles tie-breaker correctly", () => {
    const records = [
      makeTransitionRecord("a", T0),
      makeTransitionRecord("b", T0),
    ];
    const result = applyTransitionedAtCursor(records, {
      sort_key: T0.toISOString(),
      id: "a",
    });
    assert.deepStrictEqual(
      result.map((r) => r.id),
      ["b"],
    );
  });
});

// ---------------------------------------------------------------------------
// buildPage
// ---------------------------------------------------------------------------

describe("buildPage", () => {
  const items = [
    { id: "a", ts: "2026-03-11T00:00:00.000Z" },
    { id: "b", ts: "2026-03-11T00:00:01.000Z" },
    { id: "c", ts: "2026-03-11T00:00:02.000Z" },
  ];
  const extractSortKey = (item: { ts: string }) => item.ts;
  const extractId = (item: { id: string }) => item.id;

  it("returns all items when count <= limit", () => {
    const page = buildPage(items, 5, extractSortKey, extractId);
    assert.equal(page.items.length, 3);
    assert.equal(page.has_more, false);
    assert.equal(page.next_cursor, null);
  });

  it("returns exactly limit items when count > limit", () => {
    const page = buildPage(items, 2, extractSortKey, extractId);
    assert.equal(page.items.length, 2);
    assert.equal(page.has_more, true);
    assert.ok(page.next_cursor !== null);
  });

  it("cursor from page decodes to last item on page", () => {
    const page = buildPage(items, 2, extractSortKey, extractId);
    assert.ok(page.next_cursor !== null);
    const decoded = decodeCursor(page.next_cursor);
    assert.ok(decoded !== null);
    assert.equal(decoded.sort_key, "2026-03-11T00:00:01.000Z");
    assert.equal(decoded.id, "b");
  });

  it("returns empty page for empty input", () => {
    const page = buildPage([] as typeof items, 50, extractSortKey, extractId);
    assert.equal(page.items.length, 0);
    assert.equal(page.has_more, false);
    assert.equal(page.next_cursor, null);
  });

  it("exact limit count has no more pages", () => {
    const page = buildPage(items, 3, extractSortKey, extractId);
    assert.equal(page.items.length, 3);
    assert.equal(page.has_more, false);
    assert.equal(page.next_cursor, null);
  });
});

// ---------------------------------------------------------------------------
// Module hygiene
// ---------------------------------------------------------------------------

describe("pagination module hygiene", () => {
  it("does not generate IDs or timestamps", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../../src/memory/retrieval/pagination.ts", import.meta.url),
      "utf-8",
    );
    assert.ok(!src.includes("crypto.randomUUID"), "no UUID generation");
    assert.ok(!src.includes("Date.now()"), "no Date.now()");
    assert.ok(!src.includes("new Date()"), "no zero-arg new Date()");
  });
});
