/**
 * Agent OS — K4 Embedding Pipeline Tests
 *
 * Slice: K4 — Embedding Pipeline
 * Coverage: status transitions, queue, claim, generate, retry, worker, invariants.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type {
  K2EmbeddingRecord,
  K2EmbeddingStatusEvent,
  K2SemanticFact,
} from "../../src/memory/pipeline/types.js";

import {
  EMBEDDING_STATUS,
  InMemoryK4Store,
  DEFAULT_MAX_ATTEMPTS,
} from "../../src/memory/embedding/types.js";

import {
  isValidTransition,
  validateTransition,
} from "../../src/memory/embedding/status-transition.js";

import { pollQueue } from "../../src/memory/embedding/queue.js";
import { claimRecord } from "../../src/memory/embedding/claim.js";
import { completeRecord, failRecord } from "../../src/memory/embedding/generate.js";
import {
  getFailureCount,
  isRetryEligible,
  requeueRecord,
  abandonRecord,
} from "../../src/memory/embedding/retry.js";
import { processNextEmbedding } from "../../src/memory/embedding/worker.js";
import type { K4WorkerDeps } from "../../src/memory/embedding/worker.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "proj-test-001";
const SCHEMA_VERSION = "1.0";
const T0 = new Date("2026-03-11T00:00:00Z");
const T1 = new Date("2026-03-11T00:01:00Z");
const T2 = new Date("2026-03-11T00:02:00Z");

let idCounter = 0;
function nextId(): string {
  return `test-id-${++idCounter}`;
}

function resetIdCounter(): void {
  idCounter = 0;
}

function makeFact(overrides?: Partial<K2SemanticFact>): K2SemanticFact {
  return {
    id: nextId(),
    project_id: PROJECT_ID,
    schema_version: SCHEMA_VERSION,
    fact_type: "test_fact",
    fact_key: "key-" + idCounter,
    fact_value: { text: "test value" },
    source_run_id: "run-001",
    created_at: T0,
    ...overrides,
  };
}

function makeRecord(
  factId: string,
  overrides?: Partial<K2EmbeddingRecord>,
): K2EmbeddingRecord {
  return {
    id: nextId(),
    project_id: PROJECT_ID,
    schema_version: SCHEMA_VERSION,
    semantic_fact_id: factId,
    status: EMBEDDING_STATUS.PENDING,
    model_id: null,
    embedding: null,
    created_at: T0,
    ...overrides,
  };
}

function makeEvent(
  recordId: string,
  previousStatus: string,
  newStatus: string,
  overrides?: Partial<K2EmbeddingStatusEvent>,
): K2EmbeddingStatusEvent {
  return {
    id: nextId(),
    project_id: PROJECT_ID,
    schema_version: SCHEMA_VERSION,
    embedding_record_id: recordId,
    previous_status: previousStatus,
    new_status: newStatus,
    transition_reason: "test",
    transitioned_at: T1,
    created_at: T1,
    ...overrides,
  };
}

function makeWorkerDeps(
  store: InMemoryK4Store,
  overrides?: Partial<K4WorkerDeps>,
): K4WorkerDeps {
  let wIdCounter = 100;
  return {
    store,
    generateEmbedding: async () => ({
      modelId: "text-embedding-3-small",
      embedding: [0.1, 0.2, 0.3],
    }),
    generateId: () => `worker-id-${++wIdCounter}`,
    now: () => T1,
    projectId: PROJECT_ID,
    schemaVersion: SCHEMA_VERSION,
    ...overrides,
  };
}

// ===========================================================================
// 1. Status Transition Validation
// ===========================================================================

describe("K4 — status-transition", () => {
  it("PENDING → IN_PROGRESS is valid", () => {
    assert.equal(isValidTransition("PENDING", "IN_PROGRESS"), true);
  });

  it("IN_PROGRESS → COMPLETE is valid", () => {
    assert.equal(isValidTransition("IN_PROGRESS", "COMPLETE"), true);
  });

  it("IN_PROGRESS → FAILED is valid", () => {
    assert.equal(isValidTransition("IN_PROGRESS", "FAILED"), true);
  });

  it("FAILED → PENDING is valid (retry)", () => {
    assert.equal(isValidTransition("FAILED", "PENDING"), true);
  });

  it("FAILED → ABANDONED is valid", () => {
    assert.equal(isValidTransition("FAILED", "ABANDONED"), true);
  });

  it("PENDING → COMPLETE is rejected (no skipping IN_PROGRESS)", () => {
    assert.equal(isValidTransition("PENDING", "COMPLETE"), false);
  });

  it("PENDING → FAILED is rejected", () => {
    assert.equal(isValidTransition("PENDING", "FAILED"), false);
  });

  it("COMPLETE → any is rejected (terminal)", () => {
    const result = validateTransition("COMPLETE", "PENDING");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TERMINAL_STATE");
  });

  it("ABANDONED → any is rejected (terminal)", () => {
    const result = validateTransition("ABANDONED", "IN_PROGRESS");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TERMINAL_STATE");
  });

  it("IN_PROGRESS → PENDING is rejected", () => {
    assert.equal(isValidTransition("IN_PROGRESS", "PENDING"), false);
  });

  it("validates all 5 approved transitions", () => {
    const approved: [string, string][] = [
      ["PENDING", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETE"],
      ["IN_PROGRESS", "FAILED"],
      ["FAILED", "PENDING"],
      ["FAILED", "ABANDONED"],
    ];
    for (const [from, to] of approved) {
      const result = validateTransition(from, to);
      assert.equal(result.ok, true, `${from} → ${to} should be valid`);
    }
  });
});

// ===========================================================================
// 2. Queue Polling
// ===========================================================================

describe("K4 — queue", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("returns only PENDING records for the given project", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const r1 = makeRecord(fact.id, { status: "PENDING" });
    const r2 = makeRecord(fact.id, {
      status: "IN_PROGRESS",
      semantic_fact_id: fact.id,
    });
    const r3 = makeRecord(fact.id, {
      project_id: "other-project",
      status: "PENDING",
      semantic_fact_id: fact.id,
    });
    store.seedRecord(r1);
    store.seedRecord(r2);
    store.seedRecord(r3);

    const result = pollQueue(store, PROJECT_ID, 10);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, r1.id);
  });

  it("orders by created_at ASC, then id ASC", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const r1 = makeRecord(fact.id, { id: "b-record", created_at: T1 });
    const r2 = makeRecord(fact.id, { id: "a-record", created_at: T1 });
    const r3 = makeRecord(fact.id, { id: "c-record", created_at: T0 });
    store.seedRecord(r1);
    store.seedRecord(r2);
    store.seedRecord(r3);

    const result = pollQueue(store, PROJECT_ID, 10);
    assert.equal(result.length, 3);
    assert.equal(result[0].id, "c-record"); // earliest created_at
    assert.equal(result[1].id, "a-record"); // same T1, id sort
    assert.equal(result[2].id, "b-record");
  });

  it("respects batch size cap", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    for (let i = 0; i < 5; i++) {
      store.seedRecord(
        makeRecord(fact.id, { created_at: new Date(T0.getTime() + i) }),
      );
    }

    const result = pollQueue(store, PROJECT_ID, 2);
    assert.equal(result.length, 2);
  });

  it("caps batch size at MAX_BATCH_SIZE internally", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    store.seedRecord(makeRecord(fact.id));

    // Request above max — should still work, capped internally
    const result = pollQueue(store, PROJECT_ID, 999);
    assert.equal(result.length, 1);
  });
});

// ===========================================================================
// 3. Claim
// ===========================================================================

describe("K4 — claim", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("claims a PENDING record → IN_PROGRESS with event", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    const event = makeEvent(record.id, "PENDING", "IN_PROGRESS", {
      transition_reason: "DISPATCH",
    });
    const result = claimRecord(store, record.id, event);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.status, "IN_PROGRESS");
    }

    const events = store.snapshotStatusEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].new_status, "IN_PROGRESS");
  });

  it("rejects claim on non-existent record", () => {
    const result = claimRecord(
      store,
      "nonexistent",
      makeEvent("nonexistent", "PENDING", "IN_PROGRESS"),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "RECORD_NOT_FOUND");
  });

  it("rejects claim on non-PENDING record", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "PENDING", "IN_PROGRESS");
    const result = claimRecord(store, record.id, event);
    assert.equal(result.ok, false);
  });

  it("rejects event with wrong previous_status", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    const event = makeEvent(record.id, "FAILED", "IN_PROGRESS");
    const result = claimRecord(store, record.id, event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EVENT_CONTRACT_VIOLATION");
  });

  it("rejects event with wrong new_status", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    const event = makeEvent(record.id, "PENDING", "COMPLETE");
    const result = claimRecord(store, record.id, event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EVENT_CONTRACT_VIOLATION");
  });
});

// ===========================================================================
// 4. Complete (generate.ts)
// ===========================================================================

describe("K4 — completeRecord", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("completes IN_PROGRESS → COMPLETE with model_id + embedding atomically", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "COMPLETE", {
      transition_reason: "EMBEDDING_GENERATED",
    });
    const embedding = [0.1, 0.2, 0.3, 0.4];
    const result = completeRecord(
      store,
      record.id,
      "text-embedding-3-small",
      embedding,
      event,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.status, "COMPLETE");
      assert.equal(result.record.model_id, "text-embedding-3-small");
      assert.deepEqual(result.record.embedding, embedding);
    }

    const events = store.snapshotStatusEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].new_status, "COMPLETE");
  });

  it("rejects complete on non-IN_PROGRESS record", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "PENDING" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "COMPLETE");
    const result = completeRecord(store, record.id, "model", [0.1], event);
    assert.equal(result.ok, false);
  });

  it("rejects event with wrong previous_status", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "PENDING", "COMPLETE");
    const result = completeRecord(store, record.id, "model", [0.1], event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EVENT_CONTRACT_VIOLATION");
  });

  it("rejects event with wrong new_status", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "FAILED");
    const result = completeRecord(store, record.id, "model", [0.1], event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EVENT_CONTRACT_VIOLATION");
  });

  it("rejects blank modelId", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "COMPLETE");
    const result = completeRecord(store, record.id, "", [0.1], event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INCOMPLETE_PAYLOAD");
  });

  it("rejects empty embedding", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "COMPLETE");
    const result = completeRecord(store, record.id, "model", [], event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INCOMPLETE_PAYLOAD");
  });

  it("rejects non-existent record", () => {
    const event = makeEvent("nonexistent", "IN_PROGRESS", "COMPLETE");
    const result = completeRecord(
      store,
      "nonexistent",
      "model",
      [0.1],
      event,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "RECORD_NOT_FOUND");
  });
});

// ===========================================================================
// 5. Fail (generate.ts)
// ===========================================================================

describe("K4 — failRecord", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("fails IN_PROGRESS → FAILED with event appended", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "FAILED", {
      transition_reason: "MODEL_ERROR",
    });
    const result = failRecord(store, record.id, event);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.status, "FAILED");
    }

    const events = store.snapshotStatusEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].transition_reason, "MODEL_ERROR");
  });

  it("rejects fail on non-IN_PROGRESS record", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "PENDING" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "FAILED");
    const result = failRecord(store, record.id, event);
    assert.equal(result.ok, false);
  });

  it("rejects event with wrong previous_status", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "PENDING", "FAILED");
    const result = failRecord(store, record.id, event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EVENT_CONTRACT_VIOLATION");
  });
});

// ===========================================================================
// 6. Retry Eligibility
// ===========================================================================

describe("K4 — retry", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("counts failures from event history only", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "FAILED" });
    store.seedRecord(record);

    store.seedStatusEvent(
      makeEvent(record.id, "IN_PROGRESS", "FAILED", { transitioned_at: T1 }),
    );
    store.seedStatusEvent(
      makeEvent(record.id, "IN_PROGRESS", "FAILED", { transitioned_at: T2 }),
    );

    assert.equal(getFailureCount(store, record.id), 2);
  });

  it("eligible when failure count < maxAttempts", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "FAILED" });
    store.seedRecord(record);

    store.seedStatusEvent(
      makeEvent(record.id, "IN_PROGRESS", "FAILED"),
    );

    assert.equal(isRetryEligible(store, record.id, 3), true);
  });

  it("not eligible when failure count >= maxAttempts", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "FAILED" });
    store.seedRecord(record);

    for (let i = 0; i < 3; i++) {
      store.seedStatusEvent(
        makeEvent(record.id, "IN_PROGRESS", "FAILED", {
          transitioned_at: new Date(T1.getTime() + i),
        }),
      );
    }

    assert.equal(isRetryEligible(store, record.id, 3), false);
  });

  it("uses DEFAULT_MAX_ATTEMPTS when not specified", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "FAILED" });
    store.seedRecord(record);

    assert.equal(isRetryEligible(store, record.id), true);
    assert.equal(DEFAULT_MAX_ATTEMPTS, 3);
  });
});

// ===========================================================================
// 7. Requeue
// ===========================================================================

describe("K4 — requeueRecord", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("requeues FAILED → PENDING", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "FAILED" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "FAILED", "PENDING", {
      transition_reason: "RETRY_SCHEDULED",
    });
    const result = requeueRecord(store, record.id, event);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.status, "PENDING");
    }
  });

  it("rejects requeue on non-FAILED record", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "FAILED", "PENDING");
    const result = requeueRecord(store, record.id, event);
    assert.equal(result.ok, false);
  });
});

// ===========================================================================
// 8. Abandon
// ===========================================================================

describe("K4 — abandonRecord", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("abandons FAILED → ABANDONED (terminal)", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "FAILED" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "FAILED", "ABANDONED", {
      transition_reason: "RETRY_LIMIT_EXHAUSTED",
    });
    const result = abandonRecord(store, record.id, event);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.status, "ABANDONED");
    }
  });

  it("ABANDONED cannot transition further", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "ABANDONED" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "ABANDONED", "PENDING");
    const result = requeueRecord(store, record.id, event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TERMINAL_STATE");
  });
});

// ===========================================================================
// 9. Worker — success path
// ===========================================================================

describe("K4 — worker success path", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("poll → claim → generate → complete", async () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    const deps = makeWorkerDeps(store);
    const result = await processNextEmbedding(deps);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.action, "completed");
      if (result.action === "completed") {
        assert.equal(result.recordId, record.id);
        assert.equal(result.modelId, "text-embedding-3-small");
      }
    }

    // Verify record state
    const updated = store.getRecord(record.id);
    assert.ok(updated);
    assert.equal(updated.status, "COMPLETE");
    assert.equal(updated.model_id, "text-embedding-3-small");
    assert.deepEqual(updated.embedding, [0.1, 0.2, 0.3]);

    // Verify events: DISPATCH + EMBEDDING_GENERATED
    const events = store.snapshotStatusEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].transition_reason, "DISPATCH");
    assert.equal(events[0].new_status, "IN_PROGRESS");
    assert.equal(events[1].transition_reason, "EMBEDDING_GENERATED");
    assert.equal(events[1].new_status, "COMPLETE");
  });

  it("returns queue_empty when no PENDING records", async () => {
    const deps = makeWorkerDeps(store);
    const result = await processNextEmbedding(deps);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.action, "queue_empty");
  });
});

// ===========================================================================
// 10. Worker — failure path
// ===========================================================================

describe("K4 — worker failure path", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("generator error → fail → requeue (eligible)", async () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    const deps = makeWorkerDeps(store, {
      generateEmbedding: async () => {
        throw new Error("MODEL_ERROR");
      },
    });
    const result = await processNextEmbedding(deps);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.action, "failed_and_requeued");
    }

    // Record should be back to PENDING
    const updated = store.getRecord(record.id);
    assert.ok(updated);
    assert.equal(updated.status, "PENDING");

    // Events: DISPATCH + MODEL_ERROR + RETRY_SCHEDULED
    const events = store.snapshotStatusEvents();
    assert.equal(events.length, 3);
    assert.equal(events[0].new_status, "IN_PROGRESS");
    assert.equal(events[1].new_status, "FAILED");
    assert.equal(events[1].transition_reason, "MODEL_ERROR");
    assert.equal(events[2].new_status, "PENDING");
    assert.equal(events[2].transition_reason, "RETRY_SCHEDULED");
  });

  it("generator error → fail → abandon (max attempts exhausted)", async () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    // Pre-seed failure events at max attempts
    for (let i = 0; i < 3; i++) {
      store.seedStatusEvent(
        makeEvent(record.id, "IN_PROGRESS", "FAILED", {
          transitioned_at: new Date(T0.getTime() + i),
        }),
      );
    }

    const deps = makeWorkerDeps(store, {
      maxAttempts: 3,
      generateEmbedding: async () => {
        throw new Error("TIMEOUT");
      },
    });
    const result = await processNextEmbedding(deps);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.action, "failed_and_abandoned");
    }

    const updated = store.getRecord(record.id);
    assert.ok(updated);
    assert.equal(updated.status, "ABANDONED");
  });

  it("classifies TIMEOUT errors correctly", async () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    const deps = makeWorkerDeps(store, {
      generateEmbedding: async () => {
        throw new Error("Request TIMEOUT exceeded");
      },
    });
    await processNextEmbedding(deps);

    const events = store.snapshotStatusEvents();
    const failEvent = events.find((e) => e.new_status === "FAILED");
    assert.ok(failEvent);
    assert.equal(failEvent.transition_reason, "TIMEOUT");
  });

  it("classifies non-Error throws as MODEL_ERROR", async () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    const deps = makeWorkerDeps(store, {
      generateEmbedding: async () => {
        throw "string error";
      },
    });
    await processNextEmbedding(deps);

    const events = store.snapshotStatusEvents();
    const failEvent = events.find((e) => e.new_status === "FAILED");
    assert.ok(failEvent);
    assert.equal(failEvent.transition_reason, "MODEL_ERROR");
  });
});

// ===========================================================================
// 11. Worker — semantic fact lookup
// ===========================================================================

describe("K4 — worker fact lookup", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("fails with WORKER_ABORT when semantic fact not found", async () => {
    const record = makeRecord("nonexistent-fact-id");
    store.seedRecord(record);

    const deps = makeWorkerDeps(store);
    const result = await processNextEmbedding(deps);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.action, "failed_and_requeued");
    }

    const events = store.snapshotStatusEvents();
    const failEvent = events.find((e) => e.new_status === "FAILED");
    assert.ok(failEvent);
    assert.equal(failEvent.transition_reason, "WORKER_ABORT");
  });

  it("fails with WORKER_ABORT on project isolation mismatch", async () => {
    const fact = makeFact({ project_id: "different-project" });
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    const deps = makeWorkerDeps(store);
    const result = await processNextEmbedding(deps);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.action, "failed_and_requeued");
    }

    const events = store.snapshotStatusEvents();
    const failEvent = events.find((e) => e.new_status === "FAILED");
    assert.ok(failEvent);
    assert.equal(failEvent.transition_reason, "WORKER_ABORT");
  });
});

// ===========================================================================
// 12. Invariants
// ===========================================================================

describe("K4 — invariants", () => {
  let store: InMemoryK4Store;

  beforeEach(() => {
    resetIdCounter();
    store = new InMemoryK4Store();
  });

  it("every valid transition appends exactly one status event", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    // PENDING → IN_PROGRESS
    store.transition(
      record.id,
      makeEvent(record.id, "PENDING", "IN_PROGRESS"),
    );
    assert.equal(store.snapshotStatusEvents().length, 1);

    // IN_PROGRESS → FAILED
    store.transition(
      record.id,
      makeEvent(record.id, "IN_PROGRESS", "FAILED"),
    );
    assert.equal(store.snapshotStatusEvents().length, 2);

    // FAILED → PENDING (retry)
    store.transition(
      record.id,
      makeEvent(record.id, "FAILED", "PENDING"),
    );
    assert.equal(store.snapshotStatusEvents().length, 3);
  });

  it("store rejects transition with mismatched event.previous_status", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id);
    store.seedRecord(record);

    // Record is PENDING but event says previous_status is FAILED
    const event = makeEvent(record.id, "FAILED", "IN_PROGRESS");
    const result = store.transition(record.id, event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EVENT_RECORD_MISMATCH");

    // No event appended
    assert.equal(store.snapshotStatusEvents().length, 0);
  });

  it("store rejects transitionComplete with blank modelId", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "COMPLETE");
    const result = store.transitionComplete(record.id, "  ", [0.1], event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INCOMPLETE_PAYLOAD");
  });

  it("store rejects transitionComplete with empty embedding", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "COMPLETE");
    const result = store.transitionComplete(record.id, "model", [], event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INCOMPLETE_PAYLOAD");
  });

  it("store rejects transitionComplete when event.new_status is not COMPLETE", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "IN_PROGRESS" });
    store.seedRecord(record);

    const event = makeEvent(record.id, "IN_PROGRESS", "FAILED");
    const result = store.transitionComplete(record.id, "model", [0.1], event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EVENT_RECORD_MISMATCH");
  });

  it("K4 does not write semantic facts (no create/mutation path exists)", () => {
    const storeProto = Object.getOwnPropertyNames(InMemoryK4Store.prototype);
    const factWriteMethods = storeProto.filter(
      (m) =>
        m.includes("SemanticFact") &&
        m !== "getSemanticFact" &&
        m !== "seedSemanticFact",
    );
    assert.equal(
      factWriteMethods.length,
      0,
      "No semantic fact write methods should exist on K4 store",
    );
  });

  it("no concurrency primitives exist in store interface", () => {
    const storeProto = Object.getOwnPropertyNames(InMemoryK4Store.prototype);
    const concurrencyMethods = storeProto.filter(
      (m) =>
        m.includes("lock") ||
        m.includes("Lock") ||
        m.includes("lease") ||
        m.includes("Lease") ||
        m.includes("worker_id") ||
        m.includes("claimed_at") ||
        m.includes("advisory"),
    );
    assert.equal(
      concurrencyMethods.length,
      0,
      "No concurrency primitives should exist on K4 store",
    );
  });

  it("getStatusEvents returns deterministic ordering", () => {
    const fact = makeFact();
    store.seedSemanticFact(fact);
    const record = makeRecord(fact.id, { status: "FAILED" });
    store.seedRecord(record);

    // Seed events out of order
    store.seedStatusEvent(
      makeEvent(record.id, "IN_PROGRESS", "FAILED", {
        id: "evt-b",
        transitioned_at: T2,
      }),
    );
    store.seedStatusEvent(
      makeEvent(record.id, "PENDING", "IN_PROGRESS", {
        id: "evt-a",
        transitioned_at: T1,
      }),
    );

    const events = store.getStatusEvents(record.id);
    assert.equal(events[0].id, "evt-a"); // T1 < T2
    assert.equal(events[1].id, "evt-b");
  });
});
