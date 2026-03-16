/**
 * Agent OS — K5 Memory Retrieval Layer
 * Pagination helpers for vector search: opaque cursor encode/decode,
 * keyset pagination for (similarity DESC, created_at ASC, id ASC).
 *
 * Source: K5 Vector Search Retrieval specification v1.1 §8
 * Slice: K5 — Vector Search Retrieval
 *
 * Design:
 * - Opaque cursor-based pagination only.
 * - Cursors encode (v, last_similarity, last_created_at, last_id).
 * - Keyset ordering: similarity DESC, created_at ASC, id ASC.
 * - Cursors are valid only within the same query parameter set.
 */

import type { VectorSearchPage, VectorSearchResultItem } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURSOR_VERSION = "k5v1";

// ---------------------------------------------------------------------------
// Cursor payload
// ---------------------------------------------------------------------------

export interface VectorCursorPayload {
  readonly last_similarity: number;
  readonly last_created_at: string;
  readonly last_id: string;
}

// ---------------------------------------------------------------------------
// Encode cursor
// ---------------------------------------------------------------------------

export function encodeVectorCursor(
  last_similarity: number,
  last_created_at: string,
  last_id: string,
): string {
  const payload = JSON.stringify({
    v: CURSOR_VERSION,
    last_similarity,
    last_created_at,
    last_id,
  });
  return Buffer.from(payload, "utf-8").toString("base64");
}

// ---------------------------------------------------------------------------
// Decode cursor
// ---------------------------------------------------------------------------

export function decodeVectorCursor(cursor: string): VectorCursorPayload | null {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.v !== CURSOR_VERSION) return null;
    if (typeof parsed.last_similarity !== "number") return null;
    if (typeof parsed.last_created_at !== "string" || !parsed.last_created_at) return null;
    if (typeof parsed.last_id !== "string" || !parsed.last_id) return null;
    const ts = new Date(parsed.last_created_at);
    if (isNaN(ts.getTime())) return null;
    return {
      last_similarity: parsed.last_similarity,
      last_created_at: parsed.last_created_at,
      last_id: parsed.last_id,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Keyset filter — apply cursor condition for vector search ordering.
//
// Ordering: similarity DESC, created_at ASC, id ASC
// A record passes the cursor if it comes AFTER the cursor position.
// ---------------------------------------------------------------------------

export function applyVectorCursor<T extends {
  readonly _similarity: number;
  readonly _created_at: Date;
  readonly _id: string;
}>(
  records: readonly T[],
  cursor: VectorCursorPayload,
): T[] {
  const cursorTs = new Date(cursor.last_created_at).getTime();
  return records.filter((r) => {
    if (r._similarity < cursor.last_similarity) return true;
    if (r._similarity === cursor.last_similarity) {
      const ts = r._created_at.getTime();
      if (ts > cursorTs) return true;
      if (ts === cursorTs && r._id > cursor.last_id) return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Comparator for (similarity DESC, created_at ASC, id ASC)
// ---------------------------------------------------------------------------

export function compareBySimilarity(
  a: { readonly _similarity: number; readonly _created_at: Date; readonly _id: string },
  b: { readonly _similarity: number; readonly _created_at: Date; readonly _id: string },
): number {
  if (a._similarity !== b._similarity) return b._similarity - a._similarity;
  const tsDiff = a._created_at.getTime() - b._created_at.getTime();
  if (tsDiff !== 0) return tsDiff;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Page builder for vector search results
// ---------------------------------------------------------------------------

export function buildVectorPage(
  items: readonly VectorSearchResultItem[],
  limit: number,
  similarities: readonly number[],
  createdAts: readonly string[],
  ids: readonly string[],
): VectorSearchPage {
  const has_more = items.length > limit;
  const pageItems = has_more ? items.slice(0, limit) : items.slice();
  let next_cursor: string | null = null;
  if (has_more && pageItems.length > 0) {
    const lastIdx = pageItems.length - 1;
    next_cursor = encodeVectorCursor(
      similarities[lastIdx],
      createdAts[lastIdx],
      ids[lastIdx],
    );
  }
  return { items: pageItems, next_cursor, has_more };
}
