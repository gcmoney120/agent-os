/**
 * Agent OS — Planner Subsystem P1-S2: Runtime State Machine Tests
 *
 * Deterministic test coverage for:
 * - Session creation
 * - All allowed transitions
 * - Forbidden transitions (explicit rejection with reason)
 * - COMPLETE terminal state enforcement
 * - Goal intake (valid + invalid)
 * - Plan draft lifecycle (create, update, finalize)
 * - Self-check failure blocks finalization and halts session
 * - Sentinel prereview routing
 * - Approval validation placeholder (authority, acknowledgements, plan_hash)
 * - HALTED → IDLE clear path
 * - No hidden execution behavior
 * - Immutability: input sessions not mutated
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { PlannerSessionState } from "../types.js";
import type { GoalPayload, PlanStep } from "../types.js";
import { createSession } from "../session.js";
import type { PlannerSession } from "../session.js";
import {
  transitionPlannerState,
  isTransitionAllowed,
} from "../transitions.js";
import type { PlannerEvent } from "../transitions.js";
import {
  submitGoal,
  createPlanDraft,
  updatePlanDraft,
  finalizePlanDraft,
  requiresSentinelPrereview,
  applyCommandApproval,
  clearHalt,
} from "../runtime.js";
import type { CreatePlanDraftInput, CommandApproval } from "../runtime.js";
import { buildHashBody, canonicalize, sha256 } from "../hash.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

const NOW = "2026-03-12T10:00:00.000Z";
const LATER = "2026-03-12T10:05:00.000Z";
const SESSION_ID = "sess-001";

function validGoal(): GoalPayload {
  return {
    goal_id: "a0000000-0000-0000-0000-000000000001",
    goal_text: "Implement K14 adapter",
    scope_tag: "KNOWLEDGE",
    trust_touch: false,
    submitted_by: "Command",
    submitted_at: NOW,
  };
}

function validStep(overrides?: Partial<PlanStep>): PlanStep {
  return {
    step_id: "b0000000-0000-0000-0000-000000000001",
    sequence: 1,
    label: "Forge implements adapter",
    agent: "Forge",
    input_contract: "K13 contract surface",
    output_contract: "K14 adapter module",
    acceptance_criteria: ["Adapter passes tests"],
    depends_on: [],
    trust_touch: false,
    trust_touch_domains: [],
    status: "PENDING",
    result_ref: null,
    ...overrides,
  };
}

function compassFinalStep(seq: number, depId: string): PlanStep {
  return validStep({
    step_id: "c0000000-0000-0000-0000-000000000001",
    sequence: seq,
    label: "Compass validates",
    agent: "Compass",
    input_contract: "Adapter output",
    output_contract: "Validation report",
    depends_on: [depId],
  });
}

function validDraftInput(): CreatePlanDraftInput {
  const forgeStep = validStep();
  const compassStep = compassFinalStep(2, forgeStep.step_id);
  return {
    plan_id: "d0000000-0000-0000-0000-000000000001",
    scope_tag: "KNOWLEDGE",
    trust_sensitive: false,
    steps: [forgeStep, compassStep],
    non_goals: [],
  };
}

function trustTouchDraftInput(): CreatePlanDraftInput {
  const sentinelStep = validStep({
    step_id: "e0000000-0000-0000-0000-000000000001",
    sequence: 1,
    label: "Sentinel reviews identity change",
    agent: "Sentinel",
    trust_touch: true,
    trust_touch_domains: ["IDENTITY"],
    depends_on: [],
  });
  const forgeStep = validStep({
    step_id: "e0000000-0000-0000-0000-000000000002",
    sequence: 2,
    label: "Forge implements identity change",
    agent: "Forge",
    trust_touch: true,
    trust_touch_domains: ["IDENTITY"],
    depends_on: [sentinelStep.step_id],
  });
  const compassStep = validStep({
    step_id: "e0000000-0000-0000-0000-000000000003",
    sequence: 3,
    label: "Compass validates",
    agent: "Compass",
    input_contract: "Adapter output",
    output_contract: "Validation report",
    depends_on: [forgeStep.step_id],
  });
  return {
    plan_id: "d0000000-0000-0000-0000-000000000002",
    scope_tag: "TRUST",
    trust_sensitive: true,
    steps: [sentinelStep, forgeStep, compassStep],
    non_goals: [],
  };
}

// ── State Setup Helpers ─────────────────────────────────────────────────────

/** Drive a session from IDLE to DECOMPOSING via valid goal submission */
function sessionInDecomposing(): PlannerSession {
  const session = createSession(SESSION_ID, NOW);
  const result = submitGoal(session, validGoal(), NOW);
  assert.equal(result.ok, true);
  return (result as { ok: true; session: PlannerSession }).session;
}

/** Drive a session from IDLE to PLAN_DRAFT via goal + createPlanDraft */
function sessionInPlanDraft(input?: CreatePlanDraftInput): PlannerSession {
  const decomposing = sessionInDecomposing();
  const result = createPlanDraft(decomposing, input ?? validDraftInput(), NOW);
  assert.equal(result.ok, true);
  return (result as { ok: true; session: PlannerSession }).session;
}

/** Drive a session to REVIEW_PENDING via goal + draft + finalize (no trust touch) */
function sessionInReviewPending(): PlannerSession {
  const draft = sessionInPlanDraft();
  const result = finalizePlanDraft(draft, NOW);
  assert.equal(result.ok, true);
  return (result as { ok: true; session: PlannerSession }).session;
}

/**
 * Test-only scaffolding: simulate Sentinel PASS to advance a session
 * from SENTINEL_PREREVIEW to REVIEW_PENDING.
 *
 * Sentinel prereview runtime logic is deferred beyond P1-S2.
 * This helper exists solely to test approval validation for trust-sensitive
 * plans that route through SENTINEL_PREREVIEW.
 */
function simulateSentinelPassForTesting(session: PlannerSession): PlannerSession {
  assert.equal(
    session.current_state,
    "SENTINEL_PREREVIEW",
    "simulateSentinelPassForTesting requires SENTINEL_PREREVIEW state",
  );
  return {
    ...session,
    current_state: "REVIEW_PENDING" as PlannerSessionState,
    plan_artifact: session.plan_artifact
      ? { ...session.plan_artifact, status: "REVIEW_PENDING" }
      : null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Session Creation
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Session creation", () => {
  it("creates session in IDLE state", () => {
    const s = createSession(SESSION_ID, NOW);
    assert.equal(s.current_state, "IDLE");
    assert.equal(s.session_id, SESSION_ID);
    assert.equal(s.goal_payload, null);
    assert.equal(s.plan_artifact, null);
    assert.equal(s.halt_reason, null);
    assert.equal(s.created_at, NOW);
    assert.equal(s.updated_at, NOW);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transition Table — Allowed Transitions
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Allowed transitions", () => {
  const allowedPairs: Array<[PlannerSessionState, PlannerEvent, PlannerSessionState]> = [
    ["IDLE", "GOAL_SUBMITTED", "GOAL_RECEIVED"],
    ["GOAL_RECEIVED", "GOAL_VALIDATED", "DECOMPOSING"],
    ["GOAL_RECEIVED", "GOAL_INVALID", "HALTED"],
    ["DECOMPOSING", "DECOMPOSITION_COMPLETE", "PLAN_DRAFT"],
    ["DECOMPOSING", "DECOMPOSITION_FAILED", "HALTED"],
    ["PLAN_DRAFT", "PLAN_FINALIZED_SENTINEL", "SENTINEL_PREREVIEW"],
    ["PLAN_DRAFT", "PLAN_FINALIZED_REVIEW", "REVIEW_PENDING"],
    ["SENTINEL_PREREVIEW", "SENTINEL_PREREVIEW_PASSED", "REVIEW_PENDING"],
    ["SENTINEL_PREREVIEW", "SENTINEL_PREREVIEW_FAILED", "HALTED"],
    ["REVIEW_PENDING", "COMMAND_APPROVED", "APPROVED"],
    ["REVIEW_PENDING", "COMMAND_REJECTED", "REJECTED"],
    ["REJECTED", "REJECTION_CLEARED", "IDLE"],
    ["APPROVED", "EXECUTION_STARTED", "EXECUTING"],
    ["EXECUTING", "EXECUTION_COMPLETE", "COMPLETE"],
    ["EXECUTING", "EXECUTION_HALTED", "HALTED"],
    ["HALTED", "HALT_CLEARED", "IDLE"],
  ];

  for (const [from, event, to] of allowedPairs) {
    it(`${from} + ${event} → ${to}`, () => {
      const result = transitionPlannerState(from, event);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.from, from);
        assert.equal(result.to, to);
        assert.equal(result.event, event);
      }
    });
  }

  it("isTransitionAllowed returns true for all allowed pairs", () => {
    for (const [from, event] of allowedPairs) {
      assert.equal(
        isTransitionAllowed(from, event),
        true,
        `Expected ${from} + ${event} to be allowed`,
      );
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transition Table — Forbidden Transitions
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Forbidden transitions", () => {
  it("HALTED + EXECUTION_STARTED is rejected", () => {
    const r = transitionPlannerState("HALTED", "EXECUTION_STARTED");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /must clear halt/);
    }
  });

  it("SENTINEL_PREREVIEW + COMMAND_APPROVED is rejected", () => {
    const r = transitionPlannerState("SENTINEL_PREREVIEW", "COMMAND_APPROVED");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /Sentinel prereview/);
    }
  });

  it("APPROVED + GOAL_SUBMITTED is rejected", () => {
    const r = transitionPlannerState("APPROVED", "GOAL_SUBMITTED");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /after approval/);
    }
  });

  it("APPROVED + GOAL_VALIDATED is rejected", () => {
    const r = transitionPlannerState("APPROVED", "GOAL_VALIDATED");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /after approval/);
    }
  });

  it("APPROVED + DECOMPOSITION_COMPLETE is rejected", () => {
    const r = transitionPlannerState("APPROVED", "DECOMPOSITION_COMPLETE");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /steps after approval/);
    }
  });

  it("APPROVED + PLAN_FINALIZED_SENTINEL is rejected", () => {
    const r = transitionPlannerState("APPROVED", "PLAN_FINALIZED_SENTINEL");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /after approval/);
    }
  });

  it("APPROVED + PLAN_FINALIZED_REVIEW is rejected", () => {
    const r = transitionPlannerState("APPROVED", "PLAN_FINALIZED_REVIEW");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /after approval/);
    }
  });

  it("EXECUTING + DECOMPOSITION_COMPLETE is rejected", () => {
    const r = transitionPlannerState("EXECUTING", "DECOMPOSITION_COMPLETE");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /during execution/);
    }
  });

  it("EXECUTING + PLAN_FINALIZED_SENTINEL is rejected", () => {
    const r = transitionPlannerState("EXECUTING", "PLAN_FINALIZED_SENTINEL");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /during execution/);
    }
  });

  it("EXECUTING + PLAN_FINALIZED_REVIEW is rejected", () => {
    const r = transitionPlannerState("EXECUTING", "PLAN_FINALIZED_REVIEW");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /during execution/);
    }
  });

  it("isTransitionAllowed returns false for forbidden pairs", () => {
    assert.equal(isTransitionAllowed("HALTED", "EXECUTION_STARTED"), false);
    assert.equal(isTransitionAllowed("APPROVED", "DECOMPOSITION_COMPLETE"), false);
    assert.equal(isTransitionAllowed("EXECUTING", "PLAN_FINALIZED_REVIEW"), false);
    assert.equal(isTransitionAllowed("SENTINEL_PREREVIEW", "COMMAND_APPROVED"), false);
  });

  it("transitionPlannerState never throws", () => {
    const states: PlannerSessionState[] = [
      "IDLE", "GOAL_RECEIVED", "DECOMPOSING", "PLAN_DRAFT",
      "SENTINEL_PREREVIEW", "REVIEW_PENDING", "APPROVED",
      "EXECUTING", "COMPLETE", "REJECTED", "HALTED",
    ];
    const events: PlannerEvent[] = [
      "GOAL_SUBMITTED", "GOAL_VALIDATED", "GOAL_INVALID",
      "DECOMPOSITION_COMPLETE", "DECOMPOSITION_FAILED",
      "PLAN_FINALIZED_SENTINEL", "PLAN_FINALIZED_REVIEW",
      "SENTINEL_PREREVIEW_PASSED", "SENTINEL_PREREVIEW_FAILED",
      "COMMAND_APPROVED", "COMMAND_REJECTED", "REJECTION_CLEARED",
      "EXECUTION_STARTED", "EXECUTION_COMPLETE", "EXECUTION_HALTED",
      "HALT_CLEARED",
    ];
    for (const s of states) {
      for (const e of events) {
        assert.doesNotThrow(() => transitionPlannerState(s, e));
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// COMPLETE Terminal State
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: COMPLETE terminal state", () => {
  const allEvents: PlannerEvent[] = [
    "GOAL_SUBMITTED", "GOAL_VALIDATED", "GOAL_INVALID",
    "DECOMPOSITION_COMPLETE", "DECOMPOSITION_FAILED",
    "PLAN_FINALIZED_SENTINEL", "PLAN_FINALIZED_REVIEW",
    "SENTINEL_PREREVIEW_PASSED", "SENTINEL_PREREVIEW_FAILED",
    "COMMAND_APPROVED", "COMMAND_REJECTED", "REJECTION_CLEARED",
    "EXECUTION_STARTED", "EXECUTION_COMPLETE", "EXECUTION_HALTED",
    "HALT_CLEARED",
  ];

  for (const event of allEvents) {
    it(`COMPLETE + ${event} is rejected`, () => {
      const r = transitionPlannerState("COMPLETE", event);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.match(r.reason, /terminal state COMPLETE/);
      }
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Goal Intake
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Goal intake", () => {
  it("valid goal: IDLE → GOAL_RECEIVED → DECOMPOSING", () => {
    const session = createSession(SESSION_ID, NOW);
    const result = submitGoal(session, validGoal(), NOW);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.session.current_state, "DECOMPOSING");
      assert.deepStrictEqual(result.session.goal_payload, validGoal());
      assert.equal(result.session.halt_reason, null);
    }
  });

  it("invalid goal: IDLE → GOAL_RECEIVED → HALTED with halt_reason", () => {
    const session = createSession(SESSION_ID, NOW);
    const badGoal: GoalPayload = {
      ...validGoal(),
      submitted_by: "Atlas", // invalid — must be Command
    };
    const result = submitGoal(session, badGoal, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "SUBMIT_GOAL_VALIDATION_FAILED");
      assert.equal(result.session.current_state, "HALTED");
      assert.notEqual(result.session.halt_reason, null);
      assert.equal(result.session.halt_reason!.code, "GOAL_SUBMITTED_BY_INVALID");
      // Goal payload is preserved even on failure
      assert.deepStrictEqual(result.session.goal_payload, badGoal);
    }
  });

  it("submitGoal from non-IDLE state fails", () => {
    const session = sessionInDecomposing();
    const result = submitGoal(session, validGoal(), NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "SUBMIT_GOAL_INVALID_STATE");
    }
  });

  it("submitGoal does not mutate input session", () => {
    const session = createSession(SESSION_ID, NOW);
    const frozen = JSON.parse(JSON.stringify(session));
    submitGoal(session, validGoal(), NOW);
    assert.deepStrictEqual(session, frozen);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Plan Draft Lifecycle
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Plan draft lifecycle", () => {
  it("createPlanDraft: DECOMPOSING → PLAN_DRAFT", () => {
    const decomposing = sessionInDecomposing();
    const result = createPlanDraft(decomposing, validDraftInput(), NOW);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.session.current_state, "PLAN_DRAFT");
      assert.notEqual(result.session.plan_artifact, null);
      assert.equal(result.session.plan_artifact!.plan_hash, null);
      assert.equal(result.session.plan_artifact!.status, "PLAN_DRAFT");
      assert.equal(result.session.plan_artifact!.version, 1);
      assert.equal(result.session.plan_artifact!.goal_id, validGoal().goal_id);
    }
  });

  it("createPlanDraft fails from non-DECOMPOSING state", () => {
    const session = createSession(SESSION_ID, NOW);
    const result = createPlanDraft(session, validDraftInput(), NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "CREATE_DRAFT_INVALID_STATE");
    }
  });

  it("createPlanDraft does not mutate input session", () => {
    const decomposing = sessionInDecomposing();
    const frozen = JSON.parse(JSON.stringify(decomposing));
    createPlanDraft(decomposing, validDraftInput(), NOW);
    assert.deepStrictEqual(decomposing, frozen);
  });

  it("updatePlanDraft: updates steps in PLAN_DRAFT", () => {
    const draft = sessionInPlanDraft();
    const newStep = validStep({
      step_id: "f0000000-0000-0000-0000-000000000001",
      label: "Updated step",
    });
    const result = updatePlanDraft(
      draft,
      { steps: [newStep, compassFinalStep(2, newStep.step_id)] },
      LATER,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.session.current_state, "PLAN_DRAFT");
      assert.equal(result.session.plan_artifact!.steps[0].label, "Updated step");
      assert.equal(result.session.plan_artifact!.plan_hash, null);
      assert.equal(result.session.updated_at, LATER);
    }
  });

  it("updatePlanDraft fails from non-PLAN_DRAFT state", () => {
    const decomposing = sessionInDecomposing();
    const result = updatePlanDraft(decomposing, { non_goals: ["x"] }, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "UPDATE_DRAFT_INVALID_STATE");
    }
  });

  it("updatePlanDraft does not mutate input session", () => {
    const draft = sessionInPlanDraft();
    const frozen = JSON.parse(JSON.stringify(draft));
    updatePlanDraft(draft, { non_goals: ["y"] }, LATER);
    assert.deepStrictEqual(draft, frozen);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Finalize Plan Draft
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Finalize plan draft", () => {
  it("finalizePlanDraft: routes to REVIEW_PENDING (no trust touch)", () => {
    const draft = sessionInPlanDraft();
    const result = finalizePlanDraft(draft, LATER);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.session.current_state, "REVIEW_PENDING");
      assert.equal(result.session.plan_artifact!.status, "REVIEW_PENDING");
      assert.equal(result.session.plan_artifact!.plan_hash, null);
    }
  });

  it("finalizePlanDraft: routes to SENTINEL_PREREVIEW (trust touch)", () => {
    const draft = sessionInPlanDraft(trustTouchDraftInput());
    const result = finalizePlanDraft(draft, LATER);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.session.current_state, "SENTINEL_PREREVIEW");
      assert.equal(result.session.plan_artifact!.status, "SENTINEL_PREREVIEW");
      assert.equal(result.session.plan_artifact!.plan_hash, null);
    }
  });

  it("finalizePlanDraft: self-check failure halts session", () => {
    // Create a draft with invalid steps (no termination step — final agent is Forge)
    const badInput: CreatePlanDraftInput = {
      plan_id: "d0000000-0000-0000-0000-000000000099",
      scope_tag: "KNOWLEDGE",
      trust_sensitive: false,
      steps: [validStep()], // single Forge step — violates termination rule
      non_goals: [],
    };
    const draft = sessionInPlanDraft(badInput);
    const result = finalizePlanDraft(draft, LATER);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "FINALIZE_DRAFT_SELFCHECK_FAILED");
      assert.equal(result.session.current_state, "HALTED");
      assert.notEqual(result.session.halt_reason, null);
      assert.match(result.session.halt_reason!.message, /Compass or Command/);
    }
  });

  it("finalizePlanDraft fails from non-PLAN_DRAFT state", () => {
    const session = createSession(SESSION_ID, NOW);
    const result = finalizePlanDraft(session, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "FINALIZE_DRAFT_INVALID_STATE");
    }
  });

  it("finalizePlanDraft does not mutate input session", () => {
    const draft = sessionInPlanDraft();
    const frozen = JSON.parse(JSON.stringify(draft));
    finalizePlanDraft(draft, LATER);
    assert.deepStrictEqual(draft, frozen);
  });

  it("plan_hash is null through PLAN_DRAFT, SENTINEL_PREREVIEW, REVIEW_PENDING", () => {
    // PLAN_DRAFT
    const draft = sessionInPlanDraft(trustTouchDraftInput());
    assert.equal(draft.plan_artifact!.plan_hash, null);

    // SENTINEL_PREREVIEW
    const finalized = finalizePlanDraft(draft, LATER);
    assert.equal(finalized.ok, true);
    if (finalized.ok) {
      assert.equal(finalized.session.current_state, "SENTINEL_PREREVIEW");
      assert.equal(finalized.session.plan_artifact!.plan_hash, null);

      // REVIEW_PENDING (via test-only sentinel pass scaffolding)
      const reviewed = simulateSentinelPassForTesting(finalized.session);
      assert.equal(reviewed.current_state, "REVIEW_PENDING");
      assert.equal(reviewed.plan_artifact!.plan_hash, null);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sentinel Prereview Routing
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Sentinel prereview routing", () => {
  it("requiresSentinelPrereview: true for AUDIT_LOGS", () => {
    const steps = [validStep({ trust_touch: true, trust_touch_domains: ["AUDIT_LOGS"] })];
    assert.equal(requiresSentinelPrereview(steps), true);
  });

  it("requiresSentinelPrereview: true for IDENTITY", () => {
    const steps = [validStep({ trust_touch: true, trust_touch_domains: ["IDENTITY"] })];
    assert.equal(requiresSentinelPrereview(steps), true);
  });

  it("requiresSentinelPrereview: true for AGREEMENTS", () => {
    const steps = [validStep({ trust_touch: true, trust_touch_domains: ["AGREEMENTS"] })];
    assert.equal(requiresSentinelPrereview(steps), true);
  });

  it("requiresSentinelPrereview: true for ACCESS_STATE", () => {
    const steps = [validStep({ trust_touch: true, trust_touch_domains: ["ACCESS_STATE"] })];
    assert.equal(requiresSentinelPrereview(steps), true);
  });

  it("requiresSentinelPrereview: false when trust_touch is false", () => {
    const steps = [validStep({ trust_touch: false, trust_touch_domains: ["IDENTITY"] })];
    assert.equal(requiresSentinelPrereview(steps), false);
  });

  it("requiresSentinelPrereview: false when trust_touch_domains is empty", () => {
    const steps = [validStep({ trust_touch: true, trust_touch_domains: [] })];
    assert.equal(requiresSentinelPrereview(steps), false);
  });

  it("requiresSentinelPrereview: false when no steps have trust_touch", () => {
    assert.equal(requiresSentinelPrereview([validStep()]), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Approval Validation
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Approval validation", () => {
  function validApproval(): CommandApproval {
    return {
      approved_by: "Command",
      approved_at: LATER,
      acknowledgements: [],
    };
  }

  it("applyCommandApproval: REVIEW_PENDING → APPROVED with plan_hash", () => {
    const session = sessionInReviewPending();
    const result = applyCommandApproval(session, validApproval());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.session.current_state, "APPROVED");
      assert.equal(result.session.plan_artifact!.status, "APPROVED");
      assert.equal(result.session.plan_artifact!.approved_by, "Command");
      assert.equal(result.session.plan_artifact!.approved_at, LATER);
      // R9: plan_hash computed at approval — non-null and SHA-256 formatted
      assert.notEqual(result.session.plan_artifact!.plan_hash, null);
      assert.match(result.session.plan_artifact!.plan_hash!, /^[0-9a-f]{64}$/);
    }
  });

  it("plan_hash at approval matches frozen-body hash projection", () => {
    const session = sessionInReviewPending();
    const result = applyCommandApproval(session, validApproval());
    assert.equal(result.ok, true);
    if (result.ok) {
      // Recompute expected hash from the exact frozen-body projection
      // that applyCommandApproval uses (via buildHashBody → canonicalize → sha256)
      // using the pre-approval artifact (same body that applyCommandApproval hashes)
      const expectedHash = sha256(canonicalize(buildHashBody(session.plan_artifact!)));
      assert.equal(result.session.plan_artifact!.plan_hash, expectedHash);
    }
  });

  it("plan_hash is null before APPROVED", () => {
    const session = sessionInReviewPending();
    assert.equal(session.plan_artifact!.plan_hash, null);
  });

  it("applyCommandApproval fails from non-REVIEW_PENDING state", () => {
    const session = createSession(SESSION_ID, NOW);
    const result = applyCommandApproval(session, validApproval());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "APPROVAL_INVALID_STATE");
    }
  });

  it("applyCommandApproval rejects non-Command authority", () => {
    const session = sessionInReviewPending();
    const result = applyCommandApproval(session, {
      ...validApproval(),
      approved_by: "Atlas",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "APPROVAL_INVALID_AUTHORITY");
    }
  });

  it("trust_sensitive plan requires TRUST_SENSITIVE_ACKNOWLEDGED", () => {
    const draft = sessionInPlanDraft(trustTouchDraftInput());
    const finalized = finalizePlanDraft(draft, NOW);
    assert.equal(finalized.ok, true);
    if (!finalized.ok) return;

    // Test-only scaffolding: Sentinel prereview runtime deferred
    const prereviewed = simulateSentinelPassForTesting(finalized.session);

    const result = applyCommandApproval(prereviewed, validApproval());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "APPROVAL_MISSING_ACKNOWLEDGEMENT");
      assert.match(result.message, /TRUST_SENSITIVE_ACKNOWLEDGED/);
    }
  });

  it("trust_sensitive plan succeeds with TRUST_SENSITIVE_ACKNOWLEDGED", () => {
    const draft = sessionInPlanDraft(trustTouchDraftInput());
    const finalized = finalizePlanDraft(draft, NOW);
    assert.equal(finalized.ok, true);
    if (!finalized.ok) return;

    // Test-only scaffolding: Sentinel prereview runtime deferred
    const prereviewed = simulateSentinelPassForTesting(finalized.session);

    const result = applyCommandApproval(prereviewed, {
      ...validApproval(),
      acknowledgements: ["TRUST_SENSITIVE_ACKNOWLEDGED"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.session.current_state, "APPROVED");
    }
  });

  it("MULTI scope plan requires MULTI_SCOPE_ACKNOWLEDGED", () => {
    // Build a MULTI scope plan with valid structure
    const sentinelStep = validStep({
      step_id: "e0000000-0000-0000-0000-000000000010",
      sequence: 1,
      label: "Sentinel reviews",
      agent: "Sentinel",
      depends_on: [],
    });
    const forgeStep = validStep({
      step_id: "e0000000-0000-0000-0000-000000000011",
      sequence: 2,
      label: "Forge implements",
      agent: "Forge",
      depends_on: [sentinelStep.step_id],
    });
    const compassStep = validStep({
      step_id: "e0000000-0000-0000-0000-000000000012",
      sequence: 3,
      label: "Compass validates",
      agent: "Compass",
      depends_on: [forgeStep.step_id],
    });

    const multiInput: CreatePlanDraftInput = {
      plan_id: "d0000000-0000-0000-0000-000000000099",
      scope_tag: "MULTI",
      trust_sensitive: false,
      steps: [sentinelStep, forgeStep, compassStep],
      non_goals: [],
    };

    const draft = sessionInPlanDraft(multiInput);
    const finalized = finalizePlanDraft(draft, NOW);
    assert.equal(finalized.ok, true);
    if (!finalized.ok) return;

    const result = applyCommandApproval(finalized.session, validApproval());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "APPROVAL_MISSING_ACKNOWLEDGEMENT");
      assert.match(result.message, /MULTI_SCOPE_ACKNOWLEDGED/);
    }
  });

  it("applyCommandApproval does not mutate input session", () => {
    const session = sessionInReviewPending();
    const frozen = JSON.parse(JSON.stringify(session));
    applyCommandApproval(session, validApproval());
    assert.deepStrictEqual(session, frozen);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Halt and Clear
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: Halt and clear", () => {
  it("HALTED → IDLE via clearHalt", () => {
    const session = createSession(SESSION_ID, NOW);
    const bad = submitGoal(session, { ...validGoal(), submitted_by: "Atlas" } as GoalPayload, NOW);
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.session.current_state, "HALTED");

      const cleared = clearHalt(bad.session, LATER);
      assert.equal(cleared.ok, true);
      if (cleared.ok) {
        assert.equal(cleared.session.current_state, "IDLE");
        assert.equal(cleared.session.goal_payload, null);
        assert.equal(cleared.session.plan_artifact, null);
        assert.equal(cleared.session.halt_reason, null);
        assert.equal(cleared.session.updated_at, LATER);
      }
    }
  });

  it("clearHalt from non-HALTED state fails", () => {
    const session = createSession(SESSION_ID, NOW);
    const result = clearHalt(session, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "CLEAR_HALT_INVALID_STATE");
    }
  });

  it("clearHalt does not mutate input session", () => {
    const session = createSession(SESSION_ID, NOW);
    const bad = submitGoal(session, { ...validGoal(), submitted_by: "Atlas" } as GoalPayload, NOW);
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      const frozen = JSON.parse(JSON.stringify(bad.session));
      clearHalt(bad.session, LATER);
      assert.deepStrictEqual(bad.session, frozen);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// No Hidden Execution Behavior
// ═════════════════════════════════════════════════════════════════════════════

describe("P1-S2: No hidden execution behavior", () => {
  it("approved session has no run_id", () => {
    const session = sessionInReviewPending();
    const result = applyCommandApproval(session, {
      approved_by: "Command",
      approved_at: LATER,
      acknowledgements: [],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.session.plan_artifact!.run_id, null);
      assert.equal(result.session.plan_artifact!.executed_at, null);
    }
  });

  it("approved session has no version_history mutations", () => {
    const session = sessionInReviewPending();
    const result = applyCommandApproval(session, {
      approved_by: "Command",
      approved_at: LATER,
      acknowledgements: [],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.session.plan_artifact!.version_history, []);
    }
  });
});
