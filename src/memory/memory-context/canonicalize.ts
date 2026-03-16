/**
 * Agent OS — K9 Memory Context Canonical Serialization + Hash
 *
 * Slice: K9 — Memory Context Injection
 *
 * Provides deterministic (lexicographically-sorted) JSON serialization of a
 * MemoryContext and its SHA-256 hex digest.
 *
 * Invariants:
 *   - Key ordering is fully recursive (all nesting levels).
 *   - Arrays are preserved as-is (element order is data, not key order).
 *   - Primitive values are passed through unchanged.
 *   - Two identical MemoryContext values always produce identical output.
 *   - No external I/O. No side effects.
 */

import { createHash } from "node:crypto";
import type { MemoryContext } from "./types.js";

// ---------------------------------------------------------------------------
// Internal: recursive key sort
// ---------------------------------------------------------------------------

function sortKeysRecursive(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(sortKeysRecursive);
  }
  if (val !== null && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysRecursive(obj[key]);
    }
    return sorted;
  }
  return val;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the canonical JSON string of a MemoryContext.
 * All object keys are sorted lexicographically at every nesting level.
 * No whitespace. UTF-8 safe.
 */
export function canonicalMemoryContextJson(ctx: MemoryContext): string {
  return JSON.stringify(sortKeysRecursive(ctx));
}

/**
 * Returns the SHA-256 hex digest of the canonical JSON serialization of ctx.
 * Always 64 lowercase hex characters.
 */
export function memoryContextHash(ctx: MemoryContext): string {
  return createHash("sha256")
    .update(Buffer.from(canonicalMemoryContextJson(ctx), "utf8"))
    .digest("hex");
}
