/**
 * Agent OS — K7 Memory Context Assembly
 * Part B: ExecutionContext attachment seam.
 *
 * Source: memory-context-assembly-k7-v1.1.md §13
 * Slice: K7 — Memory Context Assembly
 *
 * attachMemoryContext: accepts a frozen FrozenStepContext and a MemoryContext,
 * attaches memory as a read-only field, deep-freezes the result, and returns
 * the new frozen FrozenStepContext.
 *
 * One-time operation: if memory is already present, returns an error.
 * No dispatcher logic, no governance, no capability changes.
 */

import type { FrozenStepContext } from "../../dispatcher/types.js";
import type { MemoryContext } from "./types.js";
import { K7_ERROR_CODE } from "./types.js";

// ---------------------------------------------------------------------------
// Attach result
// ---------------------------------------------------------------------------

export type AttachResult =
  | { readonly ok: true; readonly context: FrozenStepContext }
  | { readonly ok: false; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// deepFreeze (private) — mirrors Phase N1 implementation in dispatchRun.ts.
// Duplicated here to avoid importing from the dispatcher layer into the
// memory layer, keeping the dependency arrow one-way.
// ---------------------------------------------------------------------------

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

// ---------------------------------------------------------------------------
// attachMemoryContext — §13.2 canonical interface
// ---------------------------------------------------------------------------

/**
 * Attaches a MemoryContext to a FrozenStepContext.
 *
 * Invariants (§13):
 * - Input context must not already have a memory field (one-time attachment).
 * - Result is deep-frozen using the same deepFreeze contract as Phase N1.
 * - No existing FrozenStepContext field is modified or removed.
 * - memory is read-only data; it carries no authority or capability.
 */
export function attachMemoryContext(
  context: FrozenStepContext,
  memory: MemoryContext,
): AttachResult {
  // AC-K7-22: one-time attachment — error if memory already present
  if ((context as { memory?: unknown }).memory !== undefined) {
    return {
      ok: false,
      code: K7_ERROR_CODE.MEMORY_ALREADY_ATTACHED,
      message: "Memory context is already attached to this FrozenStepContext",
    };
  }

  // Construct new context with memory field — additive only (§13.3)
  const newContext = { ...context, memory } as FrozenStepContext;

  // Deep-freeze the result (§13.2, Phase N1 contract)
  deepFreeze(newContext);

  return { ok: true, context: newContext };
}
