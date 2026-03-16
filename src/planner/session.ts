/**
 * Agent OS — Planner Subsystem P1-S2: Runtime Session Model
 *
 * In-memory planner session. No persistence. No external storage.
 * No Foreman integration. No run_id assignment.
 *
 * PlannerSessionState is imported from types.ts (canonical shared type).
 * It is decoupled from PlanStatus (which belongs to the PlanArtifact lifecycle).
 */

import type { GoalPayload, PlanArtifact, PlannerSessionState } from "./types.js";

// ── Session Types ───────────────────────────────────────────────────────────

export interface HaltReason {
  code: string;
  message: string;
  detail?: unknown;
}

export interface PlannerSession {
  session_id: string;
  goal_payload: GoalPayload | null;
  current_state: PlannerSessionState;
  plan_artifact: PlanArtifact | null;
  created_at: string;
  updated_at: string;
  halt_reason: HaltReason | null;
}

// ── Session Factory ─────────────────────────────────────────────────────────

/**
 * Create a new PlannerSession in IDLE state.
 *
 * Caller supplies session_id and timestamps externally.
 * No ID generation. No time generation.
 */
export function createSession(
  session_id: string,
  created_at: string,
): PlannerSession {
  return {
    session_id,
    goal_payload: null,
    current_state: "IDLE",
    plan_artifact: null,
    created_at,
    updated_at: created_at,
    halt_reason: null,
  };
}
