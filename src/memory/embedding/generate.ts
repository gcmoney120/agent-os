/**
 * Agent OS — K4 Embedding Pipeline
 * Complete and fail paths for embedding generation — §8.2, §8.3.
 *
 * Slice: K4 — Embedding Pipeline
 */

import type { K2EmbeddingStatusEvent } from "../pipeline/types.js";
import type { K4EmbeddingStore, K4TransitionResult } from "./types.js";
import { EMBEDDING_STATUS } from "./types.js";
import { validateTransition } from "./status-transition.js";

/**
 * Complete an IN_PROGRESS record with model_id + embedding.
 * Validates event contract + transition before delegating to store.
 * Atomic: status + model_id + embedding + event are written together.
 */
export function completeRecord(
  store: K4EmbeddingStore,
  recordId: string,
  modelId: string,
  embedding: readonly number[],
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

  // Event contract: caller must supply coherent previous/new status.
  if (event.previous_status !== EMBEDDING_STATUS.IN_PROGRESS) {
    return {
      ok: false,
      code: "EVENT_CONTRACT_VIOLATION",
      message: `event.previous_status must be ${EMBEDDING_STATUS.IN_PROGRESS}, got ${event.previous_status}`,
    };
  }
  if (event.new_status !== EMBEDDING_STATUS.COMPLETE) {
    return {
      ok: false,
      code: "EVENT_CONTRACT_VIOLATION",
      message: `event.new_status must be ${EMBEDDING_STATUS.COMPLETE}, got ${event.new_status}`,
    };
  }

  const validation = validateTransition(
    record.status,
    EMBEDDING_STATUS.COMPLETE,
  );
  if (!validation.ok) {
    return validation;
  }

  return store.transitionComplete(recordId, modelId, embedding, event);
}

/**
 * Fail an IN_PROGRESS record.
 * Validates event contract + transition before delegating to store.
 * Failure reason is recorded in the event's transition_reason.
 */
export function failRecord(
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

  // Event contract: caller must supply coherent previous/new status.
  if (event.previous_status !== EMBEDDING_STATUS.IN_PROGRESS) {
    return {
      ok: false,
      code: "EVENT_CONTRACT_VIOLATION",
      message: `event.previous_status must be ${EMBEDDING_STATUS.IN_PROGRESS}, got ${event.previous_status}`,
    };
  }
  if (event.new_status !== EMBEDDING_STATUS.FAILED) {
    return {
      ok: false,
      code: "EVENT_CONTRACT_VIOLATION",
      message: `event.new_status must be ${EMBEDDING_STATUS.FAILED}, got ${event.new_status}`,
    };
  }

  const validation = validateTransition(
    record.status,
    EMBEDDING_STATUS.FAILED,
  );
  if (!validation.ok) {
    return validation;
  }

  return store.transition(recordId, event);
}
