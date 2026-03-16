/**
 * Agent OS — K6 Hybrid Memory Retrieval
 * Cursor encode/decode and keyset pagination — §9.
 *
 * Post-merge cursor model: pagination is applied to the fully merged,
 * deduplicated, ranked result set.
 *
 * Source: K6 Architecture Specification v1.1 §9
 * Slice: K6 — Hybrid Memory Retrieval
 *
 * Read-only. No writes. No mutation. No side effects.
 */

import type { HybridSearchResult, K6Error } from "./types.js";
import { K6_ERROR_CODE } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURSOR_VERSION = "k6v1";

// ---------------------------------------------------------------------------
// Cursor payload — §9.2
//
// cursor = encode({ vector_score, fact_created_at, fact_id })
// vector_score may be null for STRUCTURED-only facts.
// ---------------------------------------------------------------------------

export interface K6CursorPayload {
  readonly vector_score: number | null;
  readonly fact_created_at: string;
  readonly fact_id: string;
}

// ---------------------------------------------------------------------------
// Encode cursor — §9.2, §9.6 (deterministic)
// ---------------------------------------------------------------------------

export function encodeK6Cursor(
  vector_score: number | null,
  fact_created_at: string,
  fact_id: string,
): string {
  const payload = JSON.stringify({
    v: CURSOR_VERSION,
    vector_score,
    fact_created_at,
    fact_id,
  });
  return Buffer.from(payload, "utf-8").toString("base64");
}

// ---------------------------------------------------------------------------
// Decode cursor — returns null on invalid cursor
// ---------------------------------------------------------------------------

export function decodeK6Cursor(cursor: string): K6CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.v !== CURSOR_VERSION) return null;
    if (
      parsed.vector_score !== null &&
      typeof parsed.vector_score !== "number"
    )
      return null;
    if (
      typeof parsed.fact_created_at !== "string" ||
      !parsed.fact_created_at
    )
      return null;
    if (typeof parsed.fact_id !== "string" || !parsed.fact_id) return null;
    const ts = new Date(parsed.fact_created_at);
    if (isNaN(ts.getTime())) return null;
    return {
      vector_score: parsed.vector_score,
      fact_created_at: parsed.fact_created_at,
      fact_id: parsed.fact_id,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validate cursor — returns K6Error if cursor is present but invalid
// ---------------------------------------------------------------------------

export function validateCursor(
  cursor: string | undefined,
): { readonly ok: true; readonly decoded: K6CursorPayload | null } | K6Error {
  if (cursor === undefined) {
    return { ok: true, decoded: null };
  }
  const decoded = decodeK6Cursor(cursor);
  if (decoded === null) {
    return {
      ok: false,
      code: K6_ERROR_CODE.INVALID_CURSOR,
      message: "Invalid or malformed cursor",
    };
  }
  return { ok: true, decoded };
}

// ---------------------------------------------------------------------------
// Apply keyset condition — §9.2
//
// Retains only items that come AFTER the cursor position in the K6
// ordering: (vector_score DESC nulls last, fact_created_at ASC, fact_id ASC)
// ---------------------------------------------------------------------------

export function applyK6Cursor(
  items: readonly HybridSearchResult[],
  cursor: K6CursorPayload,
): HybridSearchResult[] {
  return items.filter((item) => isAfterCursor(item, cursor));
}

function isAfterCursor(
  item: HybridSearchResult,
  cursor: K6CursorPayload,
): boolean {
  const itemScored = item.vector_score !== null;
  const cursorScored = cursor.vector_score !== null;

  // Case 1: cursor is scored, item is unscored → item comes after (nulls last)
  if (cursorScored && !itemScored) return true;

  // Case 2: cursor is unscored, item is scored → item comes before
  if (!cursorScored && itemScored) return false;

  // Case 3: both scored
  if (cursorScored && itemScored) {
    if (item.vector_score! < cursor.vector_score!) return true;
    if (item.vector_score! > cursor.vector_score!) return false;
    // scores equal — fall through to timestamp/id
  }

  // Case 4: both unscored, or scores equal — compare by created_at ASC, id ASC
  if (item.fact_created_at > cursor.fact_created_at) return true;
  if (item.fact_created_at < cursor.fact_created_at) return false;
  return item.fact_id > cursor.fact_id;
}

// ---------------------------------------------------------------------------
// Build page from ranked, cursor-filtered items — §9
// ---------------------------------------------------------------------------

export function buildK6Page(
  items: readonly HybridSearchResult[],
  limit: number,
): {
  pageItems: readonly HybridSearchResult[];
  next_cursor: string | null;
  has_more: boolean;
} {
  const has_more = items.length > limit;
  const pageItems = has_more ? items.slice(0, limit) : items.slice();
  let next_cursor: string | null = null;

  if (has_more && pageItems.length > 0) {
    const last = pageItems[pageItems.length - 1];
    next_cursor = encodeK6Cursor(
      last.vector_score,
      last.fact_created_at,
      last.fact_id,
    );
  }

  return { pageItems, next_cursor, has_more };
}
