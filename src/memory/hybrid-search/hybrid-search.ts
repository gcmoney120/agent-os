/**
 * Agent OS — K6 Hybrid Memory Retrieval
 * Top-level orchestrator — hybridSearch.
 *
 * Calls K3 and K5 arms independently, delegates to merge/rank/cursor units,
 * assembles HybridSearchPage. Handles allow_partial failure logic (§13.2).
 *
 * Source: K6 Architecture Specification v1.1 §6, §13, §16
 * Slice: K6 — Hybrid Memory Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 *
 * Note: both arm calls are independent with no cross-arm dependency.
 * The current implementation is synchronous; true runtime concurrency
 * is not claimed. The spec's "parallel merge model" refers to the
 * architectural independence of the two retrieval paths, not to
 * concurrent execution threads.
 */

import type { K3ReadBackend } from "../retrieval/types.js";
import type { K5ReadBackend } from "../vector-search/types.js";
import type {
  HybridSearchParams,
  HybridSearchPage,
  HybridSearchOutcome,
  SourceType,
} from "./types.js";
import { K6_ERROR_CODE, validateHybridSearchParams } from "./types.js";
import { fetchK3Arm } from "./arm-k3.js";
import { fetchK5Arm } from "./arm-k5.js";
import { mergeArmResults } from "./merge.js";
import { rankMergedResults } from "./rank.js";
import { validateCursor, applyK6Cursor, buildK6Page } from "./cursor.js";

// ---------------------------------------------------------------------------
// K6 combined backend — satisfies both K3 and K5 backend interfaces
// ---------------------------------------------------------------------------

export interface K6ReadBackend extends K3ReadBackend, K5ReadBackend {}

// ---------------------------------------------------------------------------
// Arm fetch limit — §6.1
//
// K6_ARM_FETCH_LIMIT = min(limit * 3, 300)
// Fixed architectural constant. Not tunable.
// ---------------------------------------------------------------------------

export function computeArmFetchLimit(limit: number): number {
  return Math.min(limit * 3, 300);
}

// ---------------------------------------------------------------------------
// hybridSearch — §4.1 single K6 read surface
// ---------------------------------------------------------------------------

export function hybridSearch(
  backend: K6ReadBackend,
  params: HybridSearchParams,
): HybridSearchOutcome {
  // 1. Validate params (§4.6)
  const validation = validateHybridSearchParams(params);
  if (!validation.ok) return validation;
  const v = validation.validated;

  // 2. Validate cursor (deferred from params validation to cursor unit)
  const cursorResult = validateCursor(v.cursor);
  if (!cursorResult.ok) return cursorResult;
  const decodedCursor = cursorResult.decoded;

  // 3. Compute arm fetch limit (§6.1)
  const armFetchLimit = computeArmFetchLimit(v.resolvedLimit);

  // 4. Execute both arms independently (§6)
  const k3Result = fetchK3Arm(backend, v, armFetchLimit);
  const k5Result = fetchK5Arm(backend, v, armFetchLimit);

  // 5. Handle arm failures (§13)
  const k3Failed = !k3Result.ok;
  const k5Failed = !k5Result.ok;

  if (k3Failed && k5Failed) {
    // §13.1 / §13.2: both arms failed — always fail
    return {
      ok: false,
      code: K6_ERROR_CODE.ALL_ARMS_FAILED,
      message: "Both structured and vector retrieval arms failed",
    };
  }

  if (k3Failed && !v.allow_partial) {
    return {
      ok: false,
      code: K6_ERROR_CODE.STRUCTURED_ARM_FAILURE,
      message: "Structured retrieval arm failed",
    };
  }

  if (k5Failed && !v.allow_partial) {
    return {
      ok: false,
      code: K6_ERROR_CODE.VECTOR_ARM_FAILURE,
      message: "Vector retrieval arm failed",
    };
  }

  // 6. Determine degraded state
  const degraded = k3Failed || k5Failed;
  const degraded_arms: SourceType[] = [];
  if (k3Failed) degraded_arms.push("STRUCTURED");
  if (k5Failed) degraded_arms.push("VECTOR");

  // 7. Merge arm results (§8)
  const k3Items = k3Failed ? [] : k3Result.items;
  const k5Items = k5Failed ? [] : k5Result.items;
  const merged = mergeArmResults(k3Items, k5Items);

  // 8. Rank merged results (§7)
  const ranked = rankMergedResults(merged);

  // 9. Apply cursor keyset filter (§9.2)
  const afterCursor = decodedCursor
    ? applyK6Cursor(ranked, decodedCursor)
    : ranked;

  // 10. Apply include_scores (§5.2 — null all scores when false)
  const scored = v.include_scores
    ? afterCursor
    : afterCursor.map((item) => ({ ...item, vector_score: null }));

  // 11. Build page with limit + 1 for has_more detection (§9)
  const forPaging = scored.slice(0, v.resolvedLimit + 1);
  const { pageItems, next_cursor, has_more } = buildK6Page(
    forPaging,
    v.resolvedLimit,
  );

  // 12. Assemble response (§5.1)
  const page: HybridSearchPage = {
    items: pageItems,
    next_cursor,
    has_more,
    degraded,
    degraded_arms,
  };

  return { ok: true, page };
}
