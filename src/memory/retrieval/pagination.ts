/**
 * Agent OS — Memory Retrieval Layer K3
 * Pagination helpers: opaque cursor encode/decode, deterministic keyset
 * pagination, and limit clamping.
 *
 * Source: agent-os/docs/architecture/memory-retrieval-k3.md §8
 * Slice: K3 — Memory Retrieval Layer
 *
 * Design:
 * - Opaque cursor-based pagination only. No offset pagination.
 * - Cursors encode a structured JSON payload with (v, sort_key, id).
 * - Keyset condition: WHERE (sort_key, id) > (cursor_sort_key, cursor_id)
 * - Default page size: 50. Maximum page size: 200. Values >200 clamped.
 * - No caller-controlled sort order.
 * - Two ordering profiles:
 *   (1) (created_at ASC, id ASC) — episodic_event, decision_event,
 *       semantic_fact, embedding_record
 *   (2) (transitioned_at ASC, id ASC) — embedding_status_event
 */

import type { Page } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CURSOR_VERSION = "k3v1";

// ---------------------------------------------------------------------------
// Limit clamping (spec §8.2)
// Values >200 are clamped to 200 without error.
// ---------------------------------------------------------------------------

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || limit <= 0) return DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(limit);
}

// ---------------------------------------------------------------------------
// Cursor encode/decode
//
// Cursor format: base64(JSON.stringify({ v, sort_key, id }))
// - v: version marker ("k3v1") for forward compatibility.
// - sort_key: ISO 8601 timestamp string of the last record.
// - id: string id of the last record.
// - Callers must not construct or manipulate cursors.
// - Cursors are opaque strings.
// ---------------------------------------------------------------------------

export interface CursorPayload {
  readonly sort_key: string; // ISO 8601 timestamp
  readonly id: string;
}

export function encodeCursor(sort_key: string, id: string): string {
  const payload = JSON.stringify({ v: CURSOR_VERSION, sort_key, id });
  return Buffer.from(payload, "utf-8").toString("base64");
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.v !== CURSOR_VERSION) return null;
    if (typeof parsed.sort_key !== "string" || !parsed.sort_key) return null;
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    const ts = new Date(parsed.sort_key);
    if (isNaN(ts.getTime())) return null;
    return { sort_key: parsed.sort_key, id: parsed.id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deterministic comparator for (created_at ASC, id ASC)
//
// Used by: episodic_event, decision_event, semantic_fact, embedding_record
// ---------------------------------------------------------------------------

export function compareByCreatedAtId(
  a: { readonly created_at: Date; readonly id: string },
  b: { readonly created_at: Date; readonly id: string },
): number {
  const tsDiff = a.created_at.getTime() - b.created_at.getTime();
  if (tsDiff !== 0) return tsDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Deterministic comparator for (transitioned_at ASC, id ASC)
//
// Used by: embedding_status_event
// ---------------------------------------------------------------------------

export function compareByTransitionedAtId(
  a: { readonly transitioned_at: Date; readonly id: string },
  b: { readonly transitioned_at: Date; readonly id: string },
): number {
  const tsDiff = a.transitioned_at.getTime() - b.transitioned_at.getTime();
  if (tsDiff !== 0) return tsDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Keyset filter — apply cursor-based WHERE condition.
//
// Retains only records where (sort_key, id) > (cursor.sort_key, cursor.id).
// ---------------------------------------------------------------------------

export function applyCreatedAtCursor<T extends { readonly created_at: Date; readonly id: string }>(
  records: readonly T[],
  cursor: CursorPayload,
): T[] {
  const cursorTs = new Date(cursor.sort_key).getTime();
  return records.filter((r) => {
    const ts = r.created_at.getTime();
    if (ts > cursorTs) return true;
    if (ts === cursorTs && r.id > cursor.id) return true;
    return false;
  });
}

export function applyTransitionedAtCursor<T extends { readonly transitioned_at: Date; readonly id: string }>(
  records: readonly T[],
  cursor: CursorPayload,
): T[] {
  const cursorTs = new Date(cursor.sort_key).getTime();
  return records.filter((r) => {
    const ts = r.transitioned_at.getTime();
    if (ts > cursorTs) return true;
    if (ts === cursorTs && r.id > cursor.id) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Page builder — slice sorted records into a Page<T>.
//
// Accepts already-sorted, already-filtered records and a resolved limit.
// Produces the Page envelope with cursor for the next page.
//
// extractSortKey: extracts the ISO 8601 sort key from a projected record.
// extractId: extracts the id from a projected record.
// ---------------------------------------------------------------------------

export function buildPage<T>(
  items: readonly T[],
  limit: number,
  extractSortKey: (item: T) => string,
  extractId: (item: T) => string,
): Page<T> {
  const has_more = items.length > limit;
  const pageItems = has_more ? items.slice(0, limit) : items.slice();
  const last = pageItems.length > 0 ? pageItems[pageItems.length - 1] : null;
  const next_cursor = has_more && last
    ? encodeCursor(extractSortKey(last), extractId(last))
    : null;
  return { items: pageItems, next_cursor, has_more };
}
