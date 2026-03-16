/**
 * Agent OS — K4 Embedding Pipeline
 * Single-worker orchestrator — §7, §8, §9.
 *
 * Slice: K4 — Embedding Pipeline
 *
 * Flow: poll → claim → fact lookup → generate → complete/fail → retry/abandon.
 * No ID generation in pipeline units — worker supplies all IDs and timestamps.
 * No concurrency primitives. Single-worker only.
 */

import type { K2EmbeddingStatusEvent } from "../pipeline/types.js";
import type {
  K4EmbeddingStore,
  EmbeddingGenerator,
  K4WorkerResult,
} from "./types.js";
import {
  EMBEDDING_STATUS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BATCH_SIZE,
} from "./types.js";
import { pollQueue } from "./queue.js";
import { claimRecord } from "./claim.js";
import { completeRecord, failRecord } from "./generate.js";
import { isRetryEligible, requeueRecord, abandonRecord } from "./retry.js";

// ---------------------------------------------------------------------------
// Worker dependencies — all injected, no ambient state.
// ---------------------------------------------------------------------------

export interface K4WorkerDeps {
  readonly store: K4EmbeddingStore;
  readonly generateEmbedding: EmbeddingGenerator;
  readonly generateId: () => string;
  readonly now: () => Date;
  readonly projectId: string;
  readonly schemaVersion: string;
  readonly maxAttempts?: number;
  readonly batchSize?: number;
}

// ---------------------------------------------------------------------------
// Canonical failure reason codes — §8.4.
// Only these codes may appear in transition_reason for failure events.
// ---------------------------------------------------------------------------

const FAILURE_REASON = {
  MODEL_ERROR: "MODEL_ERROR",
  TIMEOUT: "TIMEOUT",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  INPUT_TOO_LONG: "INPUT_TOO_LONG",
  WORKER_ABORT: "WORKER_ABORT",
} as const;

/**
 * Classify a generator error into a canonical failure reason code.
 * No raw exception messages are written into transition_reason.
 */
function classifyGeneratorError(err: unknown): string {
  if (!(err instanceof Error)) {
    return FAILURE_REASON.MODEL_ERROR;
  }
  const msg = err.message.toUpperCase();
  if (msg.includes("TIMEOUT")) {
    return FAILURE_REASON.TIMEOUT;
  }
  if (msg.includes("INVALID_RESPONSE") || msg.includes("INVALID RESPONSE")) {
    return FAILURE_REASON.INVALID_RESPONSE;
  }
  if (
    msg.includes("INPUT_TOO_LONG") ||
    msg.includes("TOKEN LIMIT") ||
    msg.includes("TOO LONG")
  ) {
    return FAILURE_REASON.INPUT_TOO_LONG;
  }
  if (msg.includes("ABORT")) {
    return FAILURE_REASON.WORKER_ABORT;
  }
  return FAILURE_REASON.MODEL_ERROR;
}

// ---------------------------------------------------------------------------
// Event builder — worker-internal only.
// ---------------------------------------------------------------------------

function buildStatusEvent(
  projectId: string,
  recordId: string,
  previousStatus: string,
  newStatus: string,
  reason: string,
  eventId: string,
  transitionedAt: Date,
  schemaVersion: string,
): K2EmbeddingStatusEvent {
  return {
    id: eventId,
    project_id: projectId,
    schema_version: schemaVersion,
    embedding_record_id: recordId,
    previous_status: previousStatus,
    new_status: newStatus,
    transition_reason: reason,
    transitioned_at: transitionedAt,
    created_at: transitionedAt,
  };
}

// ---------------------------------------------------------------------------
// Retry handler — worker-internal only.
// ---------------------------------------------------------------------------

function handleRetry(
  deps: K4WorkerDeps,
  recordId: string,
  projectId: string,
): K4WorkerResult {
  const { store, generateId, now, schemaVersion } = deps;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (isRetryEligible(store, recordId, maxAttempts)) {
    const event = buildStatusEvent(
      projectId,
      recordId,
      EMBEDDING_STATUS.FAILED,
      EMBEDDING_STATUS.PENDING,
      "RETRY_SCHEDULED",
      generateId(),
      now(),
      schemaVersion,
    );
    const result = requeueRecord(store, recordId, event);
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }
    return { ok: true, action: "failed_and_requeued", recordId };
  } else {
    const event = buildStatusEvent(
      projectId,
      recordId,
      EMBEDDING_STATUS.FAILED,
      EMBEDDING_STATUS.ABANDONED,
      "RETRY_LIMIT_EXHAUSTED",
      generateId(),
      now(),
      schemaVersion,
    );
    const result = abandonRecord(store, recordId, event);
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }
    return { ok: true, action: "failed_and_abandoned", recordId };
  }
}

// ---------------------------------------------------------------------------
// processNextEmbedding — main worker entry point.
// Processes a single record per invocation.
// ---------------------------------------------------------------------------

export async function processNextEmbedding(
  deps: K4WorkerDeps,
): Promise<K4WorkerResult> {
  const {
    store,
    generateEmbedding,
    generateId,
    now,
    projectId,
    schemaVersion,
  } = deps;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  // 1. Poll queue — project-scoped, deterministic order.
  const pending = pollQueue(store, projectId, batchSize);
  if (pending.length === 0) {
    return { ok: true, action: "queue_empty" };
  }

  const record = pending[0];

  // 2. Claim (PENDING → IN_PROGRESS).
  const claimEvent = buildStatusEvent(
    projectId,
    record.id,
    EMBEDDING_STATUS.PENDING,
    EMBEDDING_STATUS.IN_PROGRESS,
    "DISPATCH",
    generateId(),
    now(),
    schemaVersion,
  );
  const claimResult = claimRecord(store, record.id, claimEvent);
  if (!claimResult.ok) {
    return {
      ok: false,
      code: claimResult.code,
      message: claimResult.message,
    };
  }

  // 3. Look up semantic fact.
  const fact = store.getSemanticFact(record.semantic_fact_id);
  if (!fact) {
    // Missing fact is an internal pipeline failure → WORKER_ABORT.
    const failEvent = buildStatusEvent(
      projectId,
      record.id,
      EMBEDDING_STATUS.IN_PROGRESS,
      EMBEDDING_STATUS.FAILED,
      FAILURE_REASON.WORKER_ABORT,
      generateId(),
      now(),
      schemaVersion,
    );
    const failResult = failRecord(store, record.id, failEvent);
    if (!failResult.ok) {
      return {
        ok: false,
        code: failResult.code,
        message: failResult.message,
      };
    }
    return handleRetry(deps, record.id, projectId);
  }

  // Project isolation: fact.project_id must match the worker's project scope.
  if (fact.project_id !== projectId) {
    // Isolation violation is an internal pipeline failure → WORKER_ABORT.
    const failEvent = buildStatusEvent(
      projectId,
      record.id,
      EMBEDDING_STATUS.IN_PROGRESS,
      EMBEDDING_STATUS.FAILED,
      FAILURE_REASON.WORKER_ABORT,
      generateId(),
      now(),
      schemaVersion,
    );
    const failResult = failRecord(store, record.id, failEvent);
    if (!failResult.ok) {
      return {
        ok: false,
        code: failResult.code,
        message: failResult.message,
      };
    }
    return handleRetry(deps, record.id, projectId);
  }

  // 4. Generate embedding.
  try {
    const genResult = await generateEmbedding(
      fact.fact_value,
      fact.fact_type,
    );

    // 5. Complete (IN_PROGRESS → COMPLETE).
    const completeEvent = buildStatusEvent(
      projectId,
      record.id,
      EMBEDDING_STATUS.IN_PROGRESS,
      EMBEDDING_STATUS.COMPLETE,
      "EMBEDDING_GENERATED",
      generateId(),
      now(),
      schemaVersion,
    );
    const completeResult = completeRecord(
      store,
      record.id,
      genResult.modelId,
      genResult.embedding,
      completeEvent,
    );
    if (!completeResult.ok) {
      return {
        ok: false,
        code: completeResult.code,
        message: completeResult.message,
      };
    }
    return {
      ok: true,
      action: "completed",
      recordId: record.id,
      modelId: genResult.modelId,
    };
  } catch (err) {
    // 6. Fail (IN_PROGRESS → FAILED) with canonical reason code.
    const reason = classifyGeneratorError(err);
    const failEvent = buildStatusEvent(
      projectId,
      record.id,
      EMBEDDING_STATUS.IN_PROGRESS,
      EMBEDDING_STATUS.FAILED,
      reason,
      generateId(),
      now(),
      schemaVersion,
    );
    const failResult = failRecord(store, record.id, failEvent);
    if (!failResult.ok) {
      return {
        ok: false,
        code: failResult.code,
        message: failResult.message,
      };
    }

    // 7. Handle retry.
    return handleRetry(deps, record.id, projectId);
  }
}
