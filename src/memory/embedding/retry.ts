/**
 * Agent OS — K4 Embedding Pipeline
 * Retry eligibility and requeue/abandon — §9.
 *
 * Slice: K4 — Embedding Pipeline
 *
 * attempt_count is derived from embedding_status_event history only.
 * No counter column on embedding_record.
 */

import type { K2EmbeddingStatusEvent } from "../pipeline/types.js";
import type { K4EmbeddingStore, K4TransitionResult } from "./types.js";
import { EMBEDDING_STATUS, DEFAULT_MAX_ATTEMPTS } from "./types.js";
import { validateTransition } from "./status-transition.js";

/**
 * Count FAILED events for a record from event history — §9.1.
 */
export function getFailureCount(
  store: K4EmbeddingStore,
  embeddingRecordId: string,
): number {
  const events = store.getStatusEvents(embeddingRecordId);
  return events.filter(
    (e) => e.new_status === EMBEDDING_STATUS.FAILED,
  ).length;
}

/**
 * Check whether a FAILED record is eligible for retry — §9.1.
 * Eligible when failure count < maxAttempts.
 */
export function isRetryEligible(
  store: K4EmbeddingStore,
  embeddingRecordId: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): boolean {
  return getFailureCount(store, embeddingRecordId) < maxAttempts;
}

/**
 * Requeue a FAILED record back to PENDING — §9.2.
 */
export function requeueRecord(
  store: K4EmbeddingStore,
  recordId: string,
  event: K2EmbeddingStatusEvent,
): K4TransitionResult {
  const record = store.getRecord(recordId);
  if (!record) {
    return {
      ok: false,
      code: "RECORD_NOT_FOUND",
      message: `Embedding record ${recordId} not found`,
    };
  }
  const validation = validateTransition(
    record.status,
    EMBEDDING_STATUS.PENDING,
  );
  if (!validation.ok) {
    return validation;
  }
  return store.transition(recordId, event);
}

/**
 * Abandon a FAILED record — §9.4. Terminal.
 */
export function abandonRecord(
  store: K4EmbeddingStore,
  recordId: string,
  event: K2EmbeddingStatusEvent,
): K4TransitionResult {
  const record = store.getRecord(recordId);
  if (!record) {
    return {
      ok: false,
      code: "RECORD_NOT_FOUND",
      message: `Embedding record ${recordId} not found`,
    };
  }
  const validation = validateTransition(
    record.status,
    EMBEDDING_STATUS.ABANDONED,
  );
  if (!validation.ok) {
    return validation;
  }
  return store.transition(recordId, event);
}
