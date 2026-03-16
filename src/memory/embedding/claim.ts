/**
 * Agent OS — K4 Embedding Pipeline
 * Claim a PENDING record → IN_PROGRESS — §7.3.
 *
 * Slice: K4 — Embedding Pipeline
 */

import type { K2EmbeddingStatusEvent } from "../pipeline/types.js";
import type { K4EmbeddingStore, K4TransitionResult } from "./types.js";
import { EMBEDDING_STATUS } from "./types.js";
import { validateTransition } from "./status-transition.js";

/**
 * Claims a single embedding record for processing.
 * Validates PENDING → IN_PROGRESS and event contract before delegating to store.
 */
export function claimRecord(
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
  if (event.previous_status !== EMBEDDING_STATUS.PENDING) {
    return {
      ok: false,
      code: "EVENT_CONTRACT_VIOLATION",
      message: `event.previous_status must be ${EMBEDDING_STATUS.PENDING}, got ${event.previous_status}`,
    };
  }
  if (event.new_status !== EMBEDDING_STATUS.IN_PROGRESS) {
    return {
      ok: false,
      code: "EVENT_CONTRACT_VIOLATION",
      message: `event.new_status must be ${EMBEDDING_STATUS.IN_PROGRESS}, got ${event.new_status}`,
    };
  }

  const validation = validateTransition(
    record.status,
    EMBEDDING_STATUS.IN_PROGRESS,
  );
  if (!validation.ok) {
    return validation;
  }

  return store.transition(recordId, event);
}
