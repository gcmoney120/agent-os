/**
 * Agent OS — K4 Embedding Pipeline
 * Project-scoped queue polling — §7.2.
 *
 * Slice: K4 — Embedding Pipeline
 */

import type { K2EmbeddingRecord } from "../pipeline/types.js";
import type { K4EmbeddingStore } from "./types.js";
import { DEFAULT_BATCH_SIZE } from "./types.js";

/**
 * Poll for PENDING embedding records within a project.
 * Returns records ordered by created_at ASC, id ASC, capped to batchSize.
 */
export function pollQueue(
  store: K4EmbeddingStore,
  projectId: string,
  batchSize: number = DEFAULT_BATCH_SIZE,
): readonly K2EmbeddingRecord[] {
  return store.queryPending(projectId, batchSize);
}
