/**
 * Agent OS — Planner Subsystem P1-S2: Runtime Orchestration
 *
 * Implements:
 * - Goal intake (submitGoal)
 * - Plan draft lifecycle (createPlanDraft, updatePlanDraft, finalizePlanDraft)
 * - Sentinel prereview routing (trust-domain gate)
 * - Approval validation placeholder (applyCommandApproval)
 * - Halt clear (clearHalt)
 *
 * All functions are pure. No I/O. No persistence. No Foreman integration.
 * No run_id assignment. No version_history mutation. No execution start.
 *
 * Caller supplies all IDs and timestamps externally.
 *
 * P1-R9: plan_hash is null until APPROVED. Hash is computed atomically
 * at the approval transition boundary inside applyCommandApproval().
 */

import type {
  GoalPayload,
  PlanArtifact,
  PlanStep,
  PlannerSessionState,
  ScopeTag,
  TrustDomain,
} from "./types.js";

import type { PlannerSession, HaltReason } from "./session.js";
import { validateGoalPayload, runSelfCheck } from "./validate.js";
import { computePlanHash } from "./hash.js";
import { transitionPlannerState } from "./transitions.js";
import type { TransitionResult } from "./transitions.js";

// ── Result Types ────────────────────────────────────────────────────────────

export interface RuntimeOk<T = void> {
  ok: true;
  session: PlannerSession;
  data?: T;
}

export interface RuntimeFail {
  ok: false;
  code: string;
  message: string;
  session: PlannerSession;
  detail?: unknown;
}

export type RuntimeResult<T = void> = RuntimeOk<T> | RuntimeFail;

// ── Internal Helpers ────────────────────────────────────────────────────────

function runtimeFail(
  code: string,
  message: string,
  session: PlannerSession,
  detail?: unknown,
): RuntimeFail {
  return detail !== undefined
    ? { ok: false, code, message, session, detail }
    : { ok: false, code, message, session };
}

function applyTransition(
  session: PlannerSession,
  event: Parameters<typeof transitionPlannerState>[1],
  timestamp: string,
): { ok: true; session: PlannerSession } | { ok: false; result: TransitionResult } {
  const tr = transitionPlannerState(session.current_state, event);
  if (!tr.ok) {
    return { ok: false, result: tr };
  }
  return {
    ok: true,
    session: {
      ...session,
      current_state: tr.to,
      updated_at: timestamp,
    },
  };
}

/**
 * Halt a session with a structured reason.
 * Used for runtime halt paths (e.g. validation failure).
 */
function haltSession(
  session: PlannerSession,
  reason: HaltReason,
  timestamp: string,
): PlannerSession {
  return {
    ...session,
    current_state: "HALTED" as PlannerSessionState,
    halt_reason: reason,
    updated_at: timestamp,
  };
}

// ── Goal Intake ─────────────────────────────────────────────────────────────

/**
 * Submit a goal to the planner session.
 *
 * Flow:
 * - Valid only from IDLE
 * - Validate with P1-S1 goal validator
 * - If valid: IDLE → GOAL_RECEIVED → DECOMPOSING
 * - If invalid: IDLE → GOAL_RECEIVED → HALTED (preserves validation failure)
 */
export function submitGoal(
  session: PlannerSession,
  goalPayload: GoalPayload,
  timestamp: string,
): RuntimeResult {
  // Transition IDLE → GOAL_RECEIVED
  const toGoalReceived = applyTransition(session, "GOAL_SUBMITTED", timestamp);
  if (!toGoalReceived.ok) {
    return runtimeFail(
      "SUBMIT_GOAL_INVALID_STATE",
      `Cannot submit goal: ${(toGoalReceived.result as { reason: string }).reason}`,
      session,
    );
  }

  let current = {
    ...toGoalReceived.session,
    goal_payload: goalPayload,
  };

  // Validate goal payload
  const validation = validateGoalPayload(goalPayload);
  if (!validation.ok) {
    // GOAL_RECEIVED → HALTED
    const toHalted = applyTransition(current, "GOAL_INVALID", timestamp);
    if (!toHalted.ok) {
      return runtimeFail(
        "SUBMIT_GOAL_TRANSITION_FAILED",
        "Failed to transition to HALTED after invalid goal",
        current,
      );
    }

    const halted = haltSession(toHalted.session, {
      code: validation.code,
      message: validation.message,
      detail: (validation as { detail?: unknown }).detail,
    }, timestamp);
    halted.goal_payload = goalPayload;

    return runtimeFail(
      "SUBMIT_GOAL_VALIDATION_FAILED",
      validation.message,
      halted,
      (validation as { detail?: unknown }).detail,
    );
  }

  // GOAL_RECEIVED → DECOMPOSING
  const toDecomposing = applyTransition(current, "GOAL_VALIDATED", timestamp);
  if (!toDecomposing.ok) {
    return runtimeFail(
      "SUBMIT_GOAL_TRANSITION_FAILED",
      "Failed to transition to DECOMPOSING after valid goal",
      current,
    );
  }

  return {
    ok: true,
    session: {
      ...toDecomposing.session,
      goal_payload: goalPayload,
    },
  };
}

// ── Plan Draft Lifecycle ────────────────────────────────────────────────────

export interface CreatePlanDraftInput {
  plan_id: string;
  scope_tag: ScopeTag;
  trust_sensitive: boolean;
  steps: PlanStep[];
  non_goals: string[];
}

/**
 * Create a plan draft from decomposition output.
 *
 * Only callable in DECOMPOSING.
 * Transitions DECOMPOSING → PLAN_DRAFT.
 * Builds a PlanArtifact shell matching P1-S1 types.
 * plan_hash remains null (R9: hash computed at approval only).
 *
 * After creation, caller uses updatePlanDraft() to refine,
 * then finalizePlanDraft() to validate and route onward.
 */
export function createPlanDraft(
  session: PlannerSession,
  input: CreatePlanDraftInput,
  timestamp: string,
): RuntimeResult {
  if (session.current_state !== "DECOMPOSING") {
    return runtimeFail(
      "CREATE_DRAFT_INVALID_STATE",
      `Cannot create plan draft in state ${session.current_state}; requires DECOMPOSING`,
      session,
    );
  }

  if (!session.goal_payload) {
    return runtimeFail(
      "CREATE_DRAFT_NO_GOAL",
      "Cannot create plan draft without a goal payload",
      session,
    );
  }

  // Transition DECOMPOSING → PLAN_DRAFT
  const toDraft = applyTransition(session, "DECOMPOSITION_COMPLETE", timestamp);
  if (!toDraft.ok) {
    return runtimeFail(
      "CREATE_DRAFT_TRANSITION_FAILED",
      "Failed to transition to PLAN_DRAFT",
      session,
    );
  }

  const artifact: PlanArtifact = {
    plan_id: input.plan_id,
    goal_id: session.goal_payload.goal_id,
    version: 1,
    version_history: [],
    status: "PLAN_DRAFT",
    scope_tag: input.scope_tag,
    trust_sensitive: input.trust_sensitive,
    steps: input.steps,
    non_goals: input.non_goals,
    sentinel_prereview: null,
    submitted_at: timestamp,
    approved_at: null,
    approved_by: null,
    approval_acknowledgements: [],
    plan_hash: null,
    run_id: null,
    executed_at: null,
    archived_at: null,
  };

  return {
    ok: true,
    session: {
      ...toDraft.session,
      plan_artifact: artifact,
    },
  };
}

/**
 * Update a plan draft's mutable fields.
 *
 * Only callable in PLAN_DRAFT.
 * Allowed updates: steps, non_goals, trust_sensitive.
 * Does NOT transition state. plan_hash remains null.
 */
export function updatePlanDraft(
  session: PlannerSession,
  updates: {
    steps?: PlanStep[];
    non_goals?: string[];
    trust_sensitive?: boolean;
  },
  timestamp: string,
): RuntimeResult {
  if (session.current_state !== "PLAN_DRAFT") {
    return runtimeFail(
      "UPDATE_DRAFT_INVALID_STATE",
      `Cannot update plan draft in state ${session.current_state}; requires PLAN_DRAFT`,
      session,
    );
  }

  if (!session.plan_artifact) {
    return runtimeFail(
      "UPDATE_DRAFT_NO_ARTIFACT",
      "Cannot update plan draft without an existing plan artifact",
      session,
    );
  }

  const updatedArtifact: PlanArtifact = {
    ...session.plan_artifact,
    steps: updates.steps ?? session.plan_artifact.steps,
    non_goals: updates.non_goals ?? session.plan_artifact.non_goals,
    trust_sensitive: updates.trust_sensitive ?? session.plan_artifact.trust_sensitive,
  };

  return {
    ok: true,
    session: {
      ...session,
      plan_artifact: updatedArtifact,
      updated_at: timestamp,
    },
  };
}

// ── Sentinel Prereview Routing ──────────────────────────────────────────────

const SENTINEL_REQUIRED_DOMAINS: ReadonlySet<TrustDomain> = new Set([
  "AUDIT_LOGS",
  "IDENTITY",
  "AGREEMENTS",
  "ACCESS_STATE",
]);

/**
 * Determine whether a plan requires Sentinel prereview.
 *
 * Returns true if any step has trust_touch = true AND any of its
 * trust_touch_domains intersects SENTINEL_REQUIRED_DOMAINS.
 */
export function requiresSentinelPrereview(steps: PlanStep[]): boolean {
  for (const step of steps) {
    if (!step.trust_touch) continue;
    for (const domain of step.trust_touch_domains) {
      if (SENTINEL_REQUIRED_DOMAINS.has(domain)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Finalize a plan draft and route to the appropriate next state.
 *
 * Only callable in PLAN_DRAFT.
 * Runs:
 * 1. Self-check gate (P1-S1, includes schema validation)
 * 2. Route: SENTINEL_PREREVIEW if trust domains require it, else REVIEW_PENDING
 *
 * plan_hash remains null — R9 requires hash at approval boundary only.
 *
 * On self-check failure: session transitions to HALTED with structured
 * halt_reason preserving the validation failure code/message/detail.
 */
export function finalizePlanDraft(
  session: PlannerSession,
  timestamp: string,
): RuntimeResult {
  if (session.current_state !== "PLAN_DRAFT") {
    return runtimeFail(
      "FINALIZE_DRAFT_INVALID_STATE",
      `Cannot finalize plan draft in state ${session.current_state}; requires PLAN_DRAFT`,
      session,
    );
  }

  if (!session.plan_artifact) {
    return runtimeFail(
      "FINALIZE_DRAFT_NO_ARTIFACT",
      "Cannot finalize without a plan artifact",
      session,
    );
  }

  // Run self-check (includes schema validation)
  const selfCheckResult = runSelfCheck(session.plan_artifact);
  if (!selfCheckResult.ok) {
    // Self-check failure: halt the session.
    // This is a direct runtime halt path caused by validation failure.
    const halted = haltSession(session, {
      code: selfCheckResult.code,
      message: selfCheckResult.message,
      detail: (selfCheckResult as { detail?: unknown }).detail,
    }, timestamp);

    return runtimeFail(
      "FINALIZE_DRAFT_SELFCHECK_FAILED",
      selfCheckResult.message,
      halted,
      (selfCheckResult as { detail?: unknown }).detail,
    );
  }

  // Route based on trust domain analysis
  // plan_hash remains null — computed at approval boundary (R9)
  const needsSentinel = requiresSentinelPrereview(session.plan_artifact.steps);
  const event = needsSentinel ? "PLAN_FINALIZED_SENTINEL" : "PLAN_FINALIZED_REVIEW";

  const transitioned = applyTransition(session, event, timestamp);
  if (!transitioned.ok) {
    return runtimeFail(
      "FINALIZE_DRAFT_TRANSITION_FAILED",
      "Failed to transition after finalization",
      session,
    );
  }

  const newStatus = needsSentinel ? "SENTINEL_PREREVIEW" : "REVIEW_PENDING";
  const finalArtifact: PlanArtifact = {
    ...session.plan_artifact,
    status: newStatus,
    plan_hash: null,
  };

  return {
    ok: true,
    session: {
      ...transitioned.session,
      plan_artifact: finalArtifact,
    },
  };
}

// ── Approval Validation ─────────────────────────────────────────────────────

export interface CommandApproval {
  approved_by: string;
  approved_at: string;
  acknowledgements: string[];
}

/**
 * Validate and apply a Command approval to a plan.
 *
 * Only callable in REVIEW_PENDING.
 * Validates:
 * - approved_by === "Command"
 * - trust_sensitive plans require acknowledgement "TRUST_SENSITIVE_ACKNOWLEDGED"
 * - MULTI scope plans require acknowledgement "MULTI_SCOPE_ACKNOWLEDGED"
 *
 * On success: REVIEW_PENDING → APPROVED.
 * R9: plan_hash is computed atomically at this boundary from the frozen
 * plan body, and written together with approved_at, approved_by,
 * and approval_acknowledgements.
 *
 * Does NOT start execution. Does NOT assign run_id. Does NOT write a run ledger.
 */
export function applyCommandApproval(
  session: PlannerSession,
  approval: CommandApproval,
): RuntimeResult {
  if (session.current_state !== "REVIEW_PENDING") {
    return runtimeFail(
      "APPROVAL_INVALID_STATE",
      `Cannot apply approval in state ${session.current_state}; requires REVIEW_PENDING`,
      session,
    );
  }

  if (!session.plan_artifact) {
    return runtimeFail(
      "APPROVAL_NO_ARTIFACT",
      "Cannot approve without a plan artifact",
      session,
    );
  }

  // Validate approved_by
  if (approval.approved_by !== "Command") {
    return runtimeFail(
      "APPROVAL_INVALID_AUTHORITY",
      `approved_by must be "Command", got: ${approval.approved_by}`,
      session,
      { approved_by: approval.approved_by },
    );
  }

  // Validate trust_sensitive acknowledgement
  if (
    session.plan_artifact.trust_sensitive &&
    !approval.acknowledgements.includes("TRUST_SENSITIVE_ACKNOWLEDGED")
  ) {
    return runtimeFail(
      "APPROVAL_MISSING_ACKNOWLEDGEMENT",
      "Trust-sensitive plan requires TRUST_SENSITIVE_ACKNOWLEDGED acknowledgement",
      session,
      { required: "TRUST_SENSITIVE_ACKNOWLEDGED" },
    );
  }

  // Validate MULTI scope acknowledgement
  if (
    session.plan_artifact.scope_tag === "MULTI" &&
    !approval.acknowledgements.includes("MULTI_SCOPE_ACKNOWLEDGED")
  ) {
    return runtimeFail(
      "APPROVAL_MISSING_ACKNOWLEDGEMENT",
      "MULTI scope plan requires MULTI_SCOPE_ACKNOWLEDGED acknowledgement",
      session,
      { required: "MULTI_SCOPE_ACKNOWLEDGED" },
    );
  }

  // Transition REVIEW_PENDING → APPROVED
  const transitioned = applyTransition(session, "COMMAND_APPROVED", approval.approved_at);
  if (!transitioned.ok) {
    return runtimeFail(
      "APPROVAL_TRANSITION_FAILED",
      "Failed to transition to APPROVED",
      session,
    );
  }

  // R9: compute plan_hash atomically at approval boundary
  const planHash = computePlanHash(session.plan_artifact);

  const approvedArtifact: PlanArtifact = {
    ...session.plan_artifact,
    status: "APPROVED",
    approved_at: approval.approved_at,
    approved_by: "Command",
    approval_acknowledgements: approval.acknowledgements,
    plan_hash: planHash,
  };

  return {
    ok: true,
    session: {
      ...transitioned.session,
      plan_artifact: approvedArtifact,
    },
  };
}

// ── Halt Clear ──────────────────────────────────────────────────────────────

/**
 * Clear a HALTED session back to IDLE.
 *
 * Resets goal_payload, plan_artifact, and halt_reason.
 */
export function clearHalt(
  session: PlannerSession,
  timestamp: string,
): RuntimeResult {
  const transitioned = applyTransition(session, "HALT_CLEARED", timestamp);
  if (!transitioned.ok) {
    return runtimeFail(
      "CLEAR_HALT_INVALID_STATE",
      `Cannot clear halt: ${(transitioned.result as { reason: string }).reason}`,
      session,
    );
  }

  return {
    ok: true,
    session: {
      ...transitioned.session,
      goal_payload: null,
      plan_artifact: null,
      halt_reason: null,
    },
  };
}
