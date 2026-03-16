/**
 * Agent OS — K3 Memory Retrieval Layer
 * Tests for query-guards.ts — parameter validation, open-ended scan
 * rejection, cursor validation, limit normalization, fact_key passthrough.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  guardEpisodicQuery,
  guardDecisionQuery,
  guardSemanticQuery,
  GUARD_CODE,
} from "../../src/memory/retrieval/query-guards.js";

import { encodeCursor } from "../../src/memory/retrieval/pagination.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT = "proj-001";

// ---------------------------------------------------------------------------
// guardEpisodicQuery — project_id required
// ---------------------------------------------------------------------------

describe("guardEpisodicQuery — project_id", () => {
  it("rejects missing project_id", () => {
    const result = guardEpisodicQuery({ project_id: "", run_id: "run-1" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.PROJECT_ID_REQUIRED);
    }
  });
});

// ---------------------------------------------------------------------------
// guardEpisodicQuery — open-ended scan rejection (spec §6.1)
// ---------------------------------------------------------------------------

describe("guardEpisodicQuery — open-ended scan", () => {
  it("rejects query with no run_id, no created_at_from, no event_type", () => {
    const result = guardEpisodicQuery({ project_id: PROJECT });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.OPEN_ENDED_SCAN);
    }
  });

  it("accepts query with run_id only", () => {
    const result = guardEpisodicQuery({ project_id: PROJECT, run_id: "run-1" });
    assert.equal(result.ok, true);
  });

  it("accepts query with created_at_from only", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      created_at_from: "2026-03-11T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
  });

  it("accepts query with event_type only", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      event_type: ["STEP_STARTED"],
    });
    assert.equal(result.ok, true);
  });

  it("rejects empty event_type array as open-ended", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      event_type: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.OPEN_ENDED_SCAN);
    }
  });

  it("rejects empty string run_id as open-ended", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      run_id: "",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.OPEN_ENDED_SCAN);
    }
  });
});

// ---------------------------------------------------------------------------
// guardEpisodicQuery — cursor validation
// ---------------------------------------------------------------------------

describe("guardEpisodicQuery — cursor", () => {
  it("accepts valid cursor", () => {
    const cursor = encodeCursor("2026-03-11T00:00:00.000Z", "evt-1");
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      run_id: "run-1",
      cursor,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.params.decodedCursor !== null);
      assert.equal(result.params.decodedCursor.id, "evt-1");
    }
  });

  it("rejects malformed cursor", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      run_id: "run-1",
      cursor: "garbage-cursor",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.INVALID_CURSOR);
    }
  });

  it("passes null cursor when no cursor supplied", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      run_id: "run-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.params.decodedCursor, null);
    }
  });
});

// ---------------------------------------------------------------------------
// guardEpisodicQuery — limit normalization
// ---------------------------------------------------------------------------

describe("guardEpisodicQuery — limit", () => {
  it("defaults to 50 when not specified", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      run_id: "run-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.params.resolvedLimit, 50);
    }
  });

  it("clamps to 200 when above max", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      run_id: "run-1",
      limit: 500,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.params.resolvedLimit, 200);
    }
  });

  it("uses specified value within range", () => {
    const result = guardEpisodicQuery({
      project_id: PROJECT,
      run_id: "run-1",
      limit: 25,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.params.resolvedLimit, 25);
    }
  });
});

// ---------------------------------------------------------------------------
// guardDecisionQuery — project_id required
// ---------------------------------------------------------------------------

describe("guardDecisionQuery — project_id", () => {
  it("rejects missing project_id", () => {
    const result = guardDecisionQuery({ project_id: "" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.PROJECT_ID_REQUIRED);
    }
  });

  it("accepts valid project_id with no other filters", () => {
    const result = guardDecisionQuery({ project_id: PROJECT });
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// guardDecisionQuery — cursor validation
// ---------------------------------------------------------------------------

describe("guardDecisionQuery — cursor", () => {
  it("rejects malformed cursor", () => {
    const result = guardDecisionQuery({
      project_id: PROJECT,
      cursor: "bad",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.INVALID_CURSOR);
    }
  });

  it("accepts valid cursor", () => {
    const cursor = encodeCursor("2026-03-11T00:00:00.000Z", "dec-1");
    const result = guardDecisionQuery({
      project_id: PROJECT,
      cursor,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.params.decodedCursor !== null);
      assert.equal(result.params.decodedCursor.id, "dec-1");
    }
  });
});

// ---------------------------------------------------------------------------
// guardSemanticQuery — project_id required
// ---------------------------------------------------------------------------

describe("guardSemanticQuery — project_id", () => {
  it("rejects missing project_id", () => {
    const result = guardSemanticQuery({ project_id: "" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.PROJECT_ID_REQUIRED);
    }
  });
});

// ---------------------------------------------------------------------------
// guardSemanticQuery — fact_key passthrough
// ---------------------------------------------------------------------------

describe("guardSemanticQuery — fact_key", () => {
  it("passes through fact_key when present", () => {
    const result = guardSemanticQuery({
      project_id: PROJECT,
      fact_key: "actor.forge.trust_level",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.params.fact_key, "actor.forge.trust_level");
    }
  });

  it("passes through undefined fact_key when absent", () => {
    const result = guardSemanticQuery({ project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.params.fact_key, undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// guardSemanticQuery — cursor validation
// ---------------------------------------------------------------------------

describe("guardSemanticQuery — cursor", () => {
  it("rejects malformed cursor", () => {
    const result = guardSemanticQuery({
      project_id: PROJECT,
      cursor: "bad",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, GUARD_CODE.INVALID_CURSOR);
    }
  });
});

// ---------------------------------------------------------------------------
// guardSemanticQuery — limit normalization
// ---------------------------------------------------------------------------

describe("guardSemanticQuery — limit", () => {
  it("defaults to 50", () => {
    const result = guardSemanticQuery({ project_id: PROJECT });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.params.resolvedLimit, 50);
    }
  });

  it("clamps above 200", () => {
    const result = guardSemanticQuery({ project_id: PROJECT, limit: 999 });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.params.resolvedLimit, 200);
    }
  });
});

// ---------------------------------------------------------------------------
// Module hygiene
// ---------------------------------------------------------------------------

describe("query-guards module hygiene", () => {
  it("does not generate IDs or timestamps", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../../src/memory/retrieval/query-guards.ts", import.meta.url),
      "utf-8",
    );
    assert.ok(!src.includes("crypto.randomUUID"), "no UUID generation");
    assert.ok(!src.includes("Date.now()"), "no Date.now()");
    assert.ok(!src.includes("new Date()"), "no zero-arg new Date()");
  });
});
