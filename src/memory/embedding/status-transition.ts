/**
 * Agent OS — K4 Embedding Pipeline
 * Pure transition validation — no store access.
 *
 * Slice: K4 — Embedding Pipeline
 */

import { VALID_TRANSITIONS, TERMINAL_STATUSES } from "./types.js";

/**
 * Returns true if the transition from → to is in the approved state machine.
 */
export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.has(to);
}

/**
 * Validates a proposed transition. Returns a structured result.
 */
export function validateTransition(
  from: string,
  to: string,
): { ok: true } | { ok: false; code: string; message: string } {
  if (TERMINAL_STATUSES.has(from)) {
    return {
      ok: false,
      code: "TERMINAL_STATE",
      message: `Cannot transition from terminal state ${from}`,
    };
  }
  if (!isValidTransition(from, to)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Invalid transition: ${from} → ${to}`,
    };
  }
  return { ok: true };
}
