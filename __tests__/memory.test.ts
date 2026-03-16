/**
 * Agent OS — Memory Engine K1
 * Tests for all K1 enforcement points.
 *
 * Source: .claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md
 * Slice: K1 — Memory Engine Foundation
 *
 * Coverage:
 *   AC-MEM-01  FOREMAN-only write enforcement for EPISODIC_EVENT.
 *   AC-MEM-03  SemanticFact APPROVED gate (transition + retrieval).
 *   AC-MEM-06  FOREMAN-only write enforcement for TOOL_INVOCATION.
 *   AC-MEM-07  First SemanticFactEvent must be PROPOSED.
 *   AC-MEM-09  Per-table writer identity role sets.
 *              written_by_role must match caller identity.
 *   K1 write contract  project_id required, schema_version stamped.
 *   Write integrity    fact existence + same-project checks.
 *   RETRACTED          decision_event_id presence, existence, same-project.
 *   Cross-project      project namespace isolation enforced in write + retrieval.
 *   Stubs              EMBEDDING_RECORD and EMBEDDING_STATUS_EVENT return
 *                      DEFERRED_TO_K4 on write; [] on retrieval.
 *   Deny-by-default    retrieval with empty projectId returns [].
 *   Foreign-id probe   getSemanticFactEvents() with foreign fact ID returns [].
 *   Store hygiene      MemoryStore exposes no update/delete/remove/reset methods.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  WRITER_IDENTITY,
  SEMANTIC_FACT_TYPE,
  SEMANTIC_FACT_LIFECYCLE_STATE,
  DECISION_CONTEXT_TYPE,
  AUTHORITY_CLASS,
  BINDING_SCOPE,
  TOOL_OUTCOME,
} from "../src/memory/enums.js";
import { K1_SCHEMA_VERSION } from "../src/memory/schemas.js";
import { MemoryStore } from "../src/memory/store.js";
import {
  writeEpisodicEvent,
  writeSemanticFact,
  writeSemanticFactEvent,
  writeDecisionEvent,
  writeToolInvocation,
  writeEmbeddingRecord,
  writeEmbeddingStatusEvent,
} from "../src/memory/write.js";
import {
  getApprovedSemanticFacts,
  getEpisodicEvents,
  getSemanticFactEvents,
  getDecisionEvents,
  getEmbeddingRecords,
  getEmbeddingStatusEvents,
} from "../src/memory/retrieval.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_A = "project-alpha";
const PROJECT_B = "project-beta";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a fresh isolated store for each test (no singleton, no reset). */
function newStore(): MemoryStore {
  return new MemoryStore();
}

function makeEpisodicInput() {
  return {
    run_id: "run-001",
    stop_triggered: false as const,
  };
}

/** written_by_role must match the caller — helper enforces this constraint. */
function makeFactInput(role: "command" | "atlas" = "atlas") {
  return {
    fact_type: SEMANTIC_FACT_TYPE.DOMAIN_FACT,
    content: "Generic domain test fact.",
    confidence: 0.9,
    valid_from: new Date(),
    written_by_role: role,
  };
}

function makeDecisionInput() {
  return {
    decision_context_type: DECISION_CONTEXT_TYPE.ARCHITECTURE,
    authority_class: AUTHORITY_CLASS.BINDING,
    binding_scope: BINDING_SCOPE.PROJECT,
    rationale: "Test governance ruling.",
  };
}

function makeToolInput() {
  return {
    run_id: "run-001",
    tool_name: "readFile",
    invoked_at: new Date(),
    outcome: TOOL_OUTCOME.SUCCESS,
  };
}

/**
 * Write a fact and return its id. Asserts success.
 * Uses ATLAS caller and matching written_by_role.
 */
function writeFact(store: MemoryStore, projectId: string): string {
  const r = writeSemanticFact(
    store,
    WRITER_IDENTITY.ATLAS,
    projectId,
    makeFactInput("atlas")
  );
  assert.equal(r.ok, true, "writeFact helper: expected ok:true");
  if (!r.ok) throw new Error("writeFact failed");
  return r.record.id;
}

/**
 * Advance a fact from (none) → PROPOSED → APPROVED.
 * Returns the fact id.
 */
function writeFactApproved(store: MemoryStore, projectId: string): string {
  const factId = writeFact(store, projectId);
  const e1 = writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, projectId, {
    semantic_fact_id: factId,
    state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
  });
  assert.equal(e1.ok, true, "PROPOSED event failed");
  const e2 = writeSemanticFactEvent(store, WRITER_IDENTITY.COMMAND, projectId, {
    semantic_fact_id: factId,
    state: SEMANTIC_FACT_LIFECYCLE_STATE.APPROVED,
  });
  assert.equal(e2.ok, true, "APPROVED event failed");
  return factId;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Memory Engine K1", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = newStore();
  });

  // -------------------------------------------------------------------------
  // AC-MEM-01: FOREMAN-only write enforcement for EPISODIC_EVENT
  // -------------------------------------------------------------------------

  describe("AC-MEM-01: FOREMAN-only writes for EPISODIC_EVENT", () => {
    it("succeeds with FOREMAN identity", () => {
      const r = writeEpisodicEvent(
        store, WRITER_IDENTITY.FOREMAN, PROJECT_A, makeEpisodicInput()
      );
      assert.equal(r.ok, true);
    });

    it("fails with COMMAND identity → FORBIDDEN", () => {
      const r = writeEpisodicEvent(
        store, WRITER_IDENTITY.COMMAND, PROJECT_A, makeEpisodicInput()
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "FORBIDDEN");
    });

    it("fails with ATLAS identity → FORBIDDEN", () => {
      const r = writeEpisodicEvent(
        store, WRITER_IDENTITY.ATLAS, PROJECT_A, makeEpisodicInput()
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // AC-MEM-06: FOREMAN-only write enforcement for TOOL_INVOCATION
  // -------------------------------------------------------------------------

  describe("AC-MEM-06: FOREMAN-only writes for TOOL_INVOCATION", () => {
    it("succeeds with FOREMAN identity", () => {
      const r = writeToolInvocation(
        store, WRITER_IDENTITY.FOREMAN, PROJECT_A, makeToolInput()
      );
      assert.equal(r.ok, true);
    });

    it("fails with ATLAS identity → FORBIDDEN", () => {
      const r = writeToolInvocation(
        store, WRITER_IDENTITY.ATLAS, PROJECT_A, makeToolInput()
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "FORBIDDEN");
    });

    it("fails with SENTINEL identity → FORBIDDEN", () => {
      const r = writeToolInvocation(
        store, WRITER_IDENTITY.SENTINEL, PROJECT_A, makeToolInput()
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // AC-MEM-09: Per-table writer identity role sets
  // -------------------------------------------------------------------------

  describe("AC-MEM-09: Per-table writer identity role sets", () => {
    it("writeSemanticFact: ATLAS succeeds", () => {
      const r = writeSemanticFact(
        store, WRITER_IDENTITY.ATLAS, PROJECT_A, makeFactInput("atlas")
      );
      assert.equal(r.ok, true);
    });

    it("writeSemanticFact: COMMAND succeeds", () => {
      const r = writeSemanticFact(
        store, WRITER_IDENTITY.COMMAND, PROJECT_A, makeFactInput("command")
      );
      assert.equal(r.ok, true);
    });

    it("writeSemanticFact: SENTINEL fails → FORBIDDEN", () => {
      const r = writeSemanticFact(
        store, WRITER_IDENTITY.SENTINEL, PROJECT_A, makeFactInput("atlas")
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "FORBIDDEN");
    });

    it("writeDecisionEvent: COMMAND succeeds", () => {
      const r = writeDecisionEvent(
        store, WRITER_IDENTITY.COMMAND, PROJECT_A, makeDecisionInput()
      );
      assert.equal(r.ok, true);
    });

    it("writeDecisionEvent: SENTINEL succeeds", () => {
      const r = writeDecisionEvent(
        store, WRITER_IDENTITY.SENTINEL, PROJECT_A, makeDecisionInput()
      );
      assert.equal(r.ok, true);
    });

    it("writeDecisionEvent: ATLAS fails → FORBIDDEN", () => {
      const r = writeDecisionEvent(
        store, WRITER_IDENTITY.ATLAS, PROJECT_A, makeDecisionInput()
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "FORBIDDEN");
    });

    it("writeSemanticFactEvent: COMPASS succeeds", () => {
      const factId = writeFact(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.COMPASS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      assert.equal(r.ok, true);
    });

    it("writeSemanticFactEvent: FOREMAN fails → FORBIDDEN", () => {
      const factId = writeFact(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.FOREMAN, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // written_by_role must match caller identity (spec §7.1)
  // -------------------------------------------------------------------------

  describe("written_by_role binding in writeSemanticFact", () => {
    it("ATLAS caller with written_by_role=atlas succeeds", () => {
      const r = writeSemanticFact(
        store, WRITER_IDENTITY.ATLAS, PROJECT_A, makeFactInput("atlas")
      );
      assert.equal(r.ok, true);
    });

    it("COMMAND caller with written_by_role=atlas fails → WRITER_ROLE_MISMATCH", () => {
      const r = writeSemanticFact(
        store, WRITER_IDENTITY.COMMAND, PROJECT_A, makeFactInput("atlas")
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "WRITER_ROLE_MISMATCH");
    });

    it("ATLAS caller with written_by_role=command fails → WRITER_ROLE_MISMATCH", () => {
      const r = writeSemanticFact(
        store, WRITER_IDENTITY.ATLAS, PROJECT_A, makeFactInput("command")
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "WRITER_ROLE_MISMATCH");
    });

    it("stored record carries caller identity as written_by_role", () => {
      const r = writeSemanticFact(
        store, WRITER_IDENTITY.COMMAND, PROJECT_A, makeFactInput("command")
      );
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.record.written_by_role, "command");
    });
  });

  // -------------------------------------------------------------------------
  // K1 write contract: project_id required, schema_version stamped
  // -------------------------------------------------------------------------

  describe("K1 write contract: project_id and schema_version", () => {
    it("fails when projectId is empty string → MISSING_PROJECT_ID", () => {
      const r = writeDecisionEvent(
        store, WRITER_IDENTITY.COMMAND, "", makeDecisionInput()
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "MISSING_PROJECT_ID");
    });

    it("fails when projectId is whitespace-only → MISSING_PROJECT_ID", () => {
      const r = writeSemanticFact(
        store, WRITER_IDENTITY.ATLAS, "   ", makeFactInput("atlas")
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "MISSING_PROJECT_ID");
    });

    it("stamped schema_version equals K1_SCHEMA_VERSION", () => {
      const r = writeEpisodicEvent(
        store, WRITER_IDENTITY.FOREMAN, PROJECT_A, makeEpisodicInput()
      );
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.record.schema_version, K1_SCHEMA_VERSION);
    });

    it("K1_SCHEMA_VERSION is '1.0'", () => {
      assert.equal(K1_SCHEMA_VERSION, "1.0");
    });

    it("stamped project_id matches the provided projectId", () => {
      const r = writeDecisionEvent(
        store, WRITER_IDENTITY.COMMAND, PROJECT_A, makeDecisionInput()
      );
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.record.project_id, PROJECT_A);
    });
  });

  // -------------------------------------------------------------------------
  // Store surface hygiene: no update/delete/remove/reset methods exposed
  // (Additional K1 guardrail — not a canonical AC-MEM mapping)
  // -------------------------------------------------------------------------

  describe("Store surface hygiene: no update/delete/remove/reset methods exposed", () => {
    it("MemoryStore prototype has no method matching update/delete/remove/set/mutate/clear/reset", () => {
      const forbidden = ["update", "delete", "remove", "set", "mutate", "clear", "reset"];
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(store))
        .filter((m) => m !== "constructor");
      for (const method of methods) {
        for (const pattern of forbidden) {
          assert.ok(
            !method.toLowerCase().includes(pattern),
            `MemoryStore must not expose '${method}' (matches forbidden pattern '${pattern}')`
          );
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Write integrity: fact existence + same-project check before event write
  // -------------------------------------------------------------------------

  describe("Write integrity: fact existence and project isolation", () => {
    it("fails when semantic_fact_id does not exist → SEMANTIC_FACT_NOT_FOUND", () => {
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: "00000000-0000-0000-0000-000000000000",
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "SEMANTIC_FACT_NOT_FOUND");
    });

    it("fails when semantic_fact_id belongs to a different project → CROSS_PROJECT_REFERENCE_FORBIDDEN", () => {
      const factIdInB = writeFact(store, PROJECT_B);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factIdInB,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "CROSS_PROJECT_REFERENCE_FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // AC-MEM-07: First SemanticFactEvent must be PROPOSED
  // -------------------------------------------------------------------------

  describe("AC-MEM-07: First SemanticFactEvent must be PROPOSED", () => {
    it("PROPOSED as first event succeeds", () => {
      const factId = writeFact(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      assert.equal(r.ok, true);
    });

    it("APPROVED as first event fails → INVALID_TRANSITION", () => {
      const factId = writeFact(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.APPROVED,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "INVALID_TRANSITION");
    });

    it("SUPERSEDED as first event fails → INVALID_TRANSITION", () => {
      const factId = writeFact(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.SUPERSEDED,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "INVALID_TRANSITION");
    });
  });

  // -------------------------------------------------------------------------
  // AC-MEM-03: SemanticFactEvent transition gate
  // -------------------------------------------------------------------------

  describe("AC-MEM-03: SemanticFactEvent transition enforcement", () => {
    it("PROPOSED → APPROVED succeeds", () => {
      const factId = writeFact(store, PROJECT_A);
      writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.COMMAND, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.APPROVED,
      });
      assert.equal(r.ok, true);
    });

    it("PROPOSED → SUPERSEDED fails → INVALID_TRANSITION", () => {
      const factId = writeFact(store, PROJECT_A);
      writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.SUPERSEDED,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "INVALID_TRANSITION");
    });

    it("APPROVED → SUPERSEDED succeeds", () => {
      const factId = writeFactApproved(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.SUPERSEDED,
      });
      assert.equal(r.ok, true);
    });

    it("SUPERSEDED is terminal — further transitions fail → INVALID_TRANSITION", () => {
      const factId = writeFactApproved(store, PROJECT_A);
      writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.SUPERSEDED,
      });
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.COMMAND, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.APPROVED,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "INVALID_TRANSITION");
    });
  });

  // -------------------------------------------------------------------------
  // RETRACTED: decision_event_id presence, existence, and same-project check
  // -------------------------------------------------------------------------

  describe("RETRACTED lifecycle gate", () => {
    it("RETRACTED without decision_event_id fails → MISSING_DECISION_EVENT_ID", () => {
      const factId = writeFactApproved(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.SENTINEL, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.RETRACTED,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "MISSING_DECISION_EVENT_ID");
    });

    it("RETRACTED with nonexistent decision_event_id fails → DECISION_EVENT_NOT_FOUND", () => {
      const factId = writeFactApproved(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.SENTINEL, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.RETRACTED,
        decision_event_id: "00000000-0000-0000-0000-000000000000",
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "DECISION_EVENT_NOT_FOUND");
    });

    it("RETRACTED with cross-project decision_event_id fails → CROSS_PROJECT_REFERENCE_FORBIDDEN", () => {
      const decisionResult = writeDecisionEvent(
        store, WRITER_IDENTITY.COMMAND, PROJECT_B, makeDecisionInput()
      );
      assert.equal(decisionResult.ok, true);
      if (!decisionResult.ok) return;

      const factId = writeFactApproved(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.SENTINEL, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.RETRACTED,
        decision_event_id: decisionResult.record.id,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "CROSS_PROJECT_REFERENCE_FORBIDDEN");
    });

    it("RETRACTED with same-project decision_event_id succeeds", () => {
      const decisionResult = writeDecisionEvent(
        store, WRITER_IDENTITY.SENTINEL, PROJECT_A, makeDecisionInput()
      );
      assert.equal(decisionResult.ok, true);
      if (!decisionResult.ok) return;

      const factId = writeFactApproved(store, PROJECT_A);
      const r = writeSemanticFactEvent(store, WRITER_IDENTITY.SENTINEL, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.RETRACTED,
        decision_event_id: decisionResult.record.id,
      });
      assert.equal(r.ok, true);
    });
  });

  // -------------------------------------------------------------------------
  // Embedding write stubs return DEFERRED_TO_K4
  // -------------------------------------------------------------------------

  describe("Embedding write stubs: DEFERRED_TO_K4", () => {
    it("writeEmbeddingRecord returns DEFERRED_TO_K4", () => {
      const r = writeEmbeddingRecord(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: "any-id",
        embedding_model: "text-embedding-3-small",
        embedding_version: "1",
        embedding_generated_at: new Date(),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "DEFERRED_TO_K4");
    });

    it("writeEmbeddingStatusEvent returns DEFERRED_TO_K4", () => {
      const r = writeEmbeddingStatusEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        embedding_record_id: "any-id",
        state: "PENDING",
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "DEFERRED_TO_K4");
    });
  });

  // -------------------------------------------------------------------------
  // AC-MEM-03 / AC-MEM-07: Retrieval APPROVED gate
  // -------------------------------------------------------------------------

  describe("Retrieval: APPROVED gate (AC-MEM-03, AC-MEM-07)", () => {
    it("fact with no lifecycle events is not returned", () => {
      writeFact(store, PROJECT_A);
      assert.equal(getApprovedSemanticFacts(store, PROJECT_A).length, 0);
    });

    it("fact in PROPOSED state is not returned", () => {
      const factId = writeFact(store, PROJECT_A);
      writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      assert.equal(getApprovedSemanticFacts(store, PROJECT_A).length, 0);
    });

    it("fact in APPROVED state is returned", () => {
      const factId = writeFactApproved(store, PROJECT_A);
      const facts = getApprovedSemanticFacts(store, PROJECT_A);
      assert.equal(facts.length, 1);
      assert.equal(facts[0]!.id, factId);
    });

    it("fact in SUPERSEDED state is not returned", () => {
      const factId = writeFactApproved(store, PROJECT_A);
      writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.SUPERSEDED,
      });
      assert.equal(getApprovedSemanticFacts(store, PROJECT_A).length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Retrieval: deny-by-default — empty projectId returns []
  // -------------------------------------------------------------------------

  describe("Retrieval: deny-by-default on empty projectId", () => {
    it("getApprovedSemanticFacts('') returns []", () => {
      writeFactApproved(store, PROJECT_A);
      assert.equal(getApprovedSemanticFacts(store, "").length, 0);
    });

    it("getEpisodicEvents('') returns []", () => {
      writeEpisodicEvent(store, WRITER_IDENTITY.FOREMAN, PROJECT_A, makeEpisodicInput());
      assert.equal(getEpisodicEvents(store, "").length, 0);
    });

    it("getDecisionEvents('   ') returns [] for whitespace projectId", () => {
      writeDecisionEvent(store, WRITER_IDENTITY.COMMAND, PROJECT_A, makeDecisionInput());
      assert.equal(getDecisionEvents(store, "   ").length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Retrieval: project namespace isolation
  // -------------------------------------------------------------------------

  describe("Retrieval: project namespace isolation", () => {
    it("approved fact in PROJECT_B is not returned for PROJECT_A query", () => {
      writeFactApproved(store, PROJECT_B);
      assert.equal(getApprovedSemanticFacts(store, PROJECT_A).length, 0);
    });

    it("approved facts in PROJECT_A are not returned for PROJECT_B query", () => {
      writeFactApproved(store, PROJECT_A);
      writeFactApproved(store, PROJECT_A);
      assert.equal(getApprovedSemanticFacts(store, PROJECT_B).length, 0);
    });

    it("each project only sees its own approved facts", () => {
      writeFactApproved(store, PROJECT_A);
      writeFactApproved(store, PROJECT_B);
      writeFactApproved(store, PROJECT_B);
      assert.equal(getApprovedSemanticFacts(store, PROJECT_A).length, 1);
      assert.equal(getApprovedSemanticFacts(store, PROJECT_B).length, 2);
    });
  });

  // -------------------------------------------------------------------------
  // Retrieval: getSemanticFactEvents — foreign-id probe prevention
  // -------------------------------------------------------------------------

  describe("Retrieval: getSemanticFactEvents foreign-id probe prevention", () => {
    it("querying with a fact ID from another project returns []", () => {
      const factIdInB = writeFact(store, PROJECT_B);
      writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_B, {
        semantic_fact_id: factIdInB,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      const events = getSemanticFactEvents(store, PROJECT_A, factIdInB);
      assert.equal(events.length, 0);
    });

    it("querying with a nonexistent fact ID returns []", () => {
      const events = getSemanticFactEvents(
        store, PROJECT_A, "00000000-0000-0000-0000-000000000000"
      );
      assert.equal(events.length, 0);
    });

    it("querying with an in-project fact ID returns its events", () => {
      const factId = writeFact(store, PROJECT_A);
      writeSemanticFactEvent(store, WRITER_IDENTITY.ATLAS, PROJECT_A, {
        semantic_fact_id: factId,
        state: SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED,
      });
      const events = getSemanticFactEvents(store, PROJECT_A, factId);
      assert.equal(events.length, 1);
    });
  });

  // -------------------------------------------------------------------------
  // Retrieval: embedding stubs return [] in K1 (write path deferred to K4)
  // -------------------------------------------------------------------------

  describe("Retrieval: embedding stubs return [] in K1", () => {
    it("getEmbeddingRecords returns [] — write path deferred to K4", () => {
      assert.equal(getEmbeddingRecords(store, PROJECT_A).length, 0);
    });

    it("getEmbeddingStatusEvents returns [] — write path deferred to K4", () => {
      assert.equal(getEmbeddingStatusEvents(store, PROJECT_A).length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Store isolation: fresh store per test (no shared state)
  // -------------------------------------------------------------------------

  describe("Store isolation: fresh instance per test", () => {
    it("a fresh store starts empty for all record types", () => {
      assert.equal(getEpisodicEvents(store, PROJECT_A).length, 0);
      assert.equal(getApprovedSemanticFacts(store, PROJECT_A).length, 0);
      assert.equal(getDecisionEvents(store, PROJECT_A).length, 0);
    });
  });
});
