/**
 * Agent OS — Planner Subsystem P1-S4: Dispatch Validation
 *
 * Pure validation functions — no side effects, no I/O, no mutation of inputs.
 *
 * Exports:
 *   detectDependencyCycle      — DFS cycle detection at plan-creation time
 *   isValidTransition          — guard for step state machine transitions
 *   isValidActorForTransition  — guard for actor authority per transition
 *   isMatchingBoundRunId       — trust gate: equality to bound RunLedger run_id
 *   VALID_TRANSITIONS          — closed set of allowed from:to pairs
 *   TRANSITION_ACTORS          — closed map of transition → allowed actors
 *
 * run_id trust enforcement:
 *   P1-S4 does not define a new run_id format contract.
 *   The trust gate for worker reports is equality to the bound RunLedger run_id,
 *   enforced by isMatchingBoundRunId. Format validation is the responsibility of
 *   P1-S3 (run-ledger.ts::isValidRunId), which owns the run_id format contract.
 */

import type { StepState, StepEventActor, StepDefinition } from "./dispatch-types.js";

// ── Cycle Detection ───────────────────────────────────────────────────────────

export interface CycleDetectionOk {
  readonly has_cycle: false;
}

export interface CycleDetectionFail {
  readonly has_cycle: true;
  readonly cycle_path: readonly string[];
}

export type CycleDetectionResult = CycleDetectionOk | CycleDetectionFail;

/**
 * Detects dependency cycles using depth-first search with three-colour marking.
 *   WHITE (0): unvisited
 *   GRAY  (1): in the current DFS stack
 *   BLACK (2): fully explored
 *
 * A cycle is detected when DFS encounters a GRAY node (back edge).
 * The cycle path returned reflects the nodes forming the back edge.
 *
 * This function is plan-creation validation only.
 * It does not validate plan binding, rebinding, or post-bind graph mutation.
 * Structural completeness (unknown step_ids in depends_on) is the caller's
 * responsibility and is not checked here — this function detects cycles only.
 */
export function detectDependencyCycle(
  steps: ReadonlyArray<Pick<StepDefinition, "step_id" | "depends_on">>,
): CycleDetectionResult {
  // Build adjacency map: step_id → [dependency step_ids]
  const adj = new Map<string, readonly string[]>();
  for (const step of steps) {
    adj.set(step.step_id, step.depends_on);
  }

  // Three-colour state: 0=WHITE, 1=GRAY, 2=BLACK
  const colour = new Map<string, 0 | 1 | 2>();
  const parent = new Map<string, string>();

  function dfs(node: string): readonly string[] | null {
    colour.set(node, 1); // GRAY — node is on the current DFS stack
    for (const dep of adj.get(node) ?? []) {
      const c = colour.get(dep) ?? 0;
      if (c === 1) {
        // Back edge found — reconstruct the cycle path
        const path: string[] = [dep];
        let cur = node;
        while (cur !== dep) {
          path.push(cur);
          const p = parent.get(cur);
          if (p === undefined) break;
          cur = p;
        }
        path.push(dep);
        path.reverse();
        return path;
      }
      if (c === 0) {
        parent.set(dep, node);
        const found = dfs(dep);
        if (found !== null) return found;
      }
    }
    colour.set(node, 2); // BLACK — fully explored
    return null;
  }

  for (const step of steps) {
    if ((colour.get(step.step_id) ?? 0) === 0) {
      const cycle = dfs(step.step_id);
      if (cycle !== null) {
        return { has_cycle: true, cycle_path: cycle };
      }
    }
  }

  return { has_cycle: false };
}

// ── Transition Guards ─────────────────────────────────────────────────────────

/**
 * Closed set of valid step state transitions, encoded as "FROM:TO" strings.
 * No transition outside this set is permitted.
 * Terminal states (COMPLETED, FAILED, SKIPPED) have no outbound entries —
 * the absence of "COMPLETED:*" etc. enforces the terminal lock.
 */
export const VALID_TRANSITIONS: ReadonlySet<string> = new Set([
  "PENDING:READY",
  "READY:DISPATCHED",
  "DISPATCHED:RUNNING",
  "RUNNING:COMPLETED",
  "RUNNING:FAILED",
  "PENDING:SKIPPED",
  "READY:SKIPPED",
]);

/**
 * Returns true when the from → to transition is in the closed allowed set.
 */
export function isValidTransition(from: StepState, to: StepState): boolean {
  return VALID_TRANSITIONS.has(`${from}:${to}`);
}

// ── Actor Validation ──────────────────────────────────────────────────────────

/**
 * Closed map: transition key → set of actors authorised to trigger it.
 *
 *   PENDING → READY       : SYSTEM only         (dependency resolution)
 *   READY → DISPATCHED    : SYSTEM only         (engine dispatch)
 *   DISPATCHED → RUNNING  : WORKER only         (worker acknowledgement)
 *   RUNNING → COMPLETED   : WORKER only         (worker success report)
 *   RUNNING → FAILED      : WORKER | TIMEOUT_WATCHDOG
 *   PENDING → SKIPPED     : SYSTEM only         (skip propagation)
 *   READY → SKIPPED       : SYSTEM only         (skip propagation)
 */
export const TRANSITION_ACTORS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["PENDING:READY",      new Set(["SYSTEM"])],
  ["READY:DISPATCHED",   new Set(["SYSTEM"])],
  ["DISPATCHED:RUNNING", new Set(["WORKER"])],
  ["RUNNING:COMPLETED",  new Set(["WORKER"])],
  ["RUNNING:FAILED",     new Set(["WORKER", "TIMEOUT_WATCHDOG"])],
  ["PENDING:SKIPPED",    new Set(["SYSTEM"])],
  ["READY:SKIPPED",      new Set(["SYSTEM"])],
]);

/**
 * Returns true when actor is authorised for the given from → to transition.
 * Returns false for any unknown transition key (fail-closed).
 */
export function isValidActorForTransition(
  from: StepState,
  to: StepState,
  actor: StepEventActor,
): boolean {
  const allowed = TRANSITION_ACTORS.get(`${from}:${to}`);
  if (allowed === undefined) return false;
  return allowed.has(actor);
}

// ── run_id Trust Gate ─────────────────────────────────────────────────────────

/**
 * Trust gate for worker reports: candidate run_id must exactly equal the
 * run_id bound in RunLedger when the plan was handed off.
 *
 * This is a pure equality check — not format validation.
 * run_id format is owned by P1-S3 (run-ledger.ts::isValidRunId).
 * P1-S4 trusts only that the candidate matches what was bound.
 */
export function isMatchingBoundRunId(
  candidate_run_id: string,
  bound_run_id: string,
): boolean {
  return candidate_run_id === bound_run_id;
}
