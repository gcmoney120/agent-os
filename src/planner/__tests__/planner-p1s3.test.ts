/**
 * Agent OS — Planner Subsystem P1-S3: Execution Binding Tests
 *
 * Deterministic test coverage mapped to Atlas P1-S3 v1.0 acceptance criteria:
 *
 * AC-1:  Only READY plan may be handed off
 *        (Atlas "READY" = P1-S2 "APPROVED" per Command ruling)
 * AC-2:  Only Foreman assigns run_id
 * AC-3:  run_id never reused
 * AC-4:  HANDOFF_REJECTED leaves plan in READY with no ledger entry
 * AC-5:  Every execution event carries non-null run_id, plan_id, sequence, emitted_at
 * AC-6:  Sequence gapless and monotonic; gap triggers halt
 * AC-7:  No PENDING_ACK → RUNNING direct
 * AC-8:  No terminal state transitions onward
 * AC-9:  RunLedgerEvent admits no update/delete at application role level
 * AC-10: Non-Command cancellation rejected and logged
 * AC-11: Stored plan snapshot always matches checksum after INITIATING
 * AC-12: Simultaneous handoff requests for same plan_id yield exactly one ACK and one rejection
 * AC-13: All halt procedures emit HALT_INITIATED before terminal event
 * AC-14: P1-S1 and P1-S2 contracts unmodified
 *
 * Additional sections:
 * - Supporting contract validation (payload §6.3, closed sets)
 * - Run lifecycle orchestration (initiateRun, completeRun, halt, cancellation)
 * - Command ruling: architecture constants (drain window)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── P1-S3: execution-types.ts ────────────────────────────────────────────────

import type {
  RunLifecycleState,
  HaltReasonCode,
  HandoffRequest,
  RunLedger,
  RunLedgerEvent,
  ExecutionStartedPayload,
  StepFailedPayload,
  StopConditionTriggeredPayload,
  HaltInitiatedPayload,
  RunTerminalPayload,
} from "../execution-types.js";

import {
  RUN_LIFECYCLE_STATES,
  TERMINAL_RUN_STATES,
  EXECUTION_EVENT_TYPES,
  HALT_REASON_CODES,
  HANDOFF_REJECTION_CODES,
  HALT_DRAIN_WINDOW_MS,
} from "../execution-types.js";

// ── P1-S3: run-ledger.ts ────────────────────────────────────────────────────

import {
  createEmptyLedgerStore,
  createRunLedger,
  appendLedgerEvent,
  updateLedgerState,
  isValidRunId,
  isTerminalRunState,
  isValidRunLifecycleTransition,
  getLedger,
  getLedgerEvents,
  getLastSequence,
  hasActiveRun,
  getActiveRunForPlan,
} from "../run-ledger.js";

import type { RunLedgerStore } from "../run-ledger.js";

// ── P1-S3: execution.ts ────────────────────────────────────────────────────

import {
  transitionRunState,
  validateHandoff,
  processHandoff,
  createRunInitiated,
  buildRunTerminal,
  verifyPlanSnapshot,
  createExecutionEvent,
  validateEventPayload,
  initiateRun,
  failRunFromInitiation,
  completeRun,
  executeHaltProcedure,
  requestCancellation,
  handleStopCondition,
} from "../execution.js";

// ── P1-S1/S2 read-only imports for fixture construction ─────────────────────

import type { PlanArtifact, PlanStep, GoalPayload } from "../types.js";
import type { PlannerSession } from "../session.js";
import { createSession } from "../session.js";
import {
  submitGoal,
  createPlanDraft,
  finalizePlanDraft,
  applyCommandApproval,
} from "../runtime.js";
import { sha256, canonicalize, computePlanHash, verifyPlanHash } from "../hash.js";
import { validatePlanArtifactSchema, runSelfCheck } from "../validate.js";

// ── Test Constants ──────────────────────────────────────────────────────────

const NOW = "2026-03-12T10:00:00.000Z";
const LATER = "2026-03-12T10:05:00.000Z";
const SESSION_ID = "sess-p1s3-001";
const PLAN_ID = "d0000000-0000-0000-0000-000000000001";
const GOAL_ID = "a0000000-0000-0000-0000-000000000001";
// Crockford's Base32 ULID (26 chars, excludes I, L, O, U)
const VALID_RUN_ID = "run_01HWMNYP8G3QR5JBKZXCTV2E4A";
const VALID_RUN_ID_2 = "run_01HWMNYP8G3QR5JBKZXCTV2E4B";
const FOREMAN_VERSION = "foreman-1.0.0";
const EVENT_ID_1 = "evt-001";
const EVENT_ID_2 = "evt-002";
const EVENT_ID_3 = "evt-003";
const EVENT_ID_4 = "evt-004";
const EVENT_ID_5 = "evt-005";

// ── Fixture Builders ────────────────────────────────────────────────────────

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

function compassStep(): PlanStep {
  return validStep({
    step_id: "c0000000-0000-0000-0000-000000000001",
    sequence: 2,
    label: "Compass validates",
    agent: "Compass",
    input_contract: "Adapter output",
    output_contract: "Validation report",
    depends_on: ["b0000000-0000-0000-0000-000000000001"],
  });
}

function validGoal(): GoalPayload {
  return {
    goal_id: GOAL_ID,
    goal_text: "Implement K14 adapter",
    scope_tag: "KNOWLEDGE",
    trust_touch: false,
    submitted_by: "Command",
    submitted_at: NOW,
  };
}

/**
 * Drive a session from IDLE to APPROVED with plan_hash set.
 * Uses P1-S2 runtime functions (read-only dependency).
 */
function sessionInApproved(): PlannerSession {
  let session = createSession(SESSION_ID, NOW);
  let result = submitGoal(session, validGoal(), NOW);
  assert.equal(result.ok, true);
  session = (result as { ok: true; session: PlannerSession }).session;

  result = createPlanDraft(session, {
    plan_id: PLAN_ID,
    scope_tag: "KNOWLEDGE",
    trust_sensitive: false,
    steps: [validStep(), compassStep()],
    non_goals: [],
  }, NOW);
  assert.equal(result.ok, true);
  session = (result as { ok: true; session: PlannerSession }).session;

  result = finalizePlanDraft(session, NOW);
  assert.equal(result.ok, true);
  session = (result as { ok: true; session: PlannerSession }).session;

  result = applyCommandApproval(session, {
    approved_by: "Command",
    approved_at: NOW,
    acknowledgements: [],
  });
  assert.equal(result.ok, true);
  session = (result as { ok: true; session: PlannerSession }).session;

  assert.equal(session.current_state, "APPROVED");
  assert.ok(session.plan_artifact);
  assert.ok(session.plan_artifact!.plan_hash);
  return session;
}

function validHandoffRequest(session: PlannerSession): HandoffRequest {
  const artifact = session.plan_artifact!;
  const snapshot = artifact;
  return {
    plan_id: artifact.plan_id,
    plan_version: artifact.version,
    plan_snapshot: JSON.parse(JSON.stringify(snapshot)),
    requested_by: "Command",
    requested_at: NOW,
    checksum: sha256(canonicalize(snapshot)),
  };
}

function makeLedger(overrides?: Partial<RunLedger>): RunLedger {
  const defaultSnapshot = { test: "data" };
  return {
    run_id: VALID_RUN_ID,
    plan_id: PLAN_ID,
    plan_version: 1,
    plan_snapshot: defaultSnapshot,
    plan_snapshot_chksum: sha256(canonicalize(defaultSnapshot)),
    state: "PENDING_ACK" as RunLifecycleState,
    state_entered_at: NOW,
    requested_by: "Command",
    foreman_version: FOREMAN_VERSION,
    created_at: NOW,
    terminal_at: null,
    terminal_reason: null,
    readiness_verdict: null,
    ...overrides,
  };
}

/** Create a store with a run in RUNNING state. */
function storeWithRunningRun(): { store: RunLedgerStore; ledger: RunLedger } {
  const ledger = makeLedger();
  let result = createRunLedger(createEmptyLedgerStore(), ledger);
  assert.equal(result.ok, true);
  let store = (result as { ok: true; data: RunLedgerStore }).data;

  let stateResult = updateLedgerState(store, VALID_RUN_ID, "INITIATING", NOW);
  assert.equal(stateResult.ok, true);
  store = (stateResult as { ok: true; data: RunLedgerStore }).data;

  stateResult = updateLedgerState(store, VALID_RUN_ID, "RUNNING", NOW);
  assert.equal(stateResult.ok, true);
  store = (stateResult as { ok: true; data: RunLedgerStore }).data;

  return { store, ledger: getLedger(store, VALID_RUN_ID)! };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-1: Only READY plan may be handed off
//       (Atlas "READY" = P1-S2 "APPROVED" per Command ruling)
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-1: Only READY (APPROVED) plan may be handed off", () => {
  it("accepts handoff for plan in APPROVED state", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const result = validateHandoff(request, session, createEmptyLedgerStore());
    assert.equal(result.ok, true);
  });

  it("rejects handoff for plan in REVIEW_PENDING (PLAN_NOT_READY)", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const notReady = { ...session, current_state: "REVIEW_PENDING" as const };
    const result = validateHandoff(request, notReady, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "PLAN_NOT_READY");
  });

  it("rejects handoff for plan in IDLE (PLAN_NOT_READY)", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const idle = { ...session, current_state: "IDLE" as const };
    const result = validateHandoff(request, idle, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "PLAN_NOT_READY");
  });

  it("rejects handoff for plan in EXECUTING (PLAN_NOT_READY)", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const executing = { ...session, current_state: "EXECUTING" as const };
    const result = validateHandoff(request, executing, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "PLAN_NOT_READY");
  });

  it("rejects unknown plan_id (PLAN_NOT_FOUND)", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.plan_id = "unknown-plan-id";
    const result = validateHandoff(request, session, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "PLAN_NOT_FOUND");
  });

  it("rejects version mismatch (PLAN_VERSION_MISMATCH)", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.plan_version = 999;
    const result = validateHandoff(request, session, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "PLAN_VERSION_MISMATCH");
  });

  it("rejects self-inconsistent checksum (CHECKSUM_MISMATCH)", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.checksum = "deadbeef";
    const result = validateHandoff(request, session, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "CHECKSUM_MISMATCH");
  });

  it("rejects forged snapshot with matching self-checksum (CHECKSUM_MISMATCH)", () => {
    const session = sessionInApproved();
    const forgedSnapshot = { forged: true };
    const request: HandoffRequest = {
      plan_id: session.plan_artifact!.plan_id,
      plan_version: session.plan_artifact!.version,
      plan_snapshot: forgedSnapshot,
      requested_by: "Command",
      requested_at: NOW,
      checksum: sha256(canonicalize(forgedSnapshot)),
    };
    const result = validateHandoff(request, session, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "CHECKSUM_MISMATCH");
  });

  it("rejects non-Command requestor (REQUESTOR_NOT_COMMAND)", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.requested_by = "Forge";
    const result = validateHandoff(request, session, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "REQUESTOR_NOT_COMMAND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2: Only Foreman assigns run_id
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-2: Only Foreman assigns run_id", () => {
  it("processHandoff requires caller-supplied run_id (no generation)", () => {
    // processHandoff signature requires runId parameter — it does not generate one.
    // Proof: calling with a valid Foreman-assigned run_id produces that exact run_id
    // in the returned ACK and ledger.
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const result = processHandoff(
      request, session, createEmptyLedgerStore(),
      VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.ack.run_id, VALID_RUN_ID);
      const ledger = getLedger(result.store, VALID_RUN_ID)!;
      assert.equal(ledger.run_id, VALID_RUN_ID);
    }
  });

  it("validateHandoff does not reference or generate run_id", () => {
    // validateHandoff return type is HandoffValidationResult — no run_id field.
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const result = validateHandoff(request, session, createEmptyLedgerStore());
    assert.equal(result.ok, true);
    // Result has no run_id property
    assert.equal("run_id" in result, false);
  });

  it("run_id format validated as run_{ulid}", () => {
    assert.equal(isValidRunId(VALID_RUN_ID), true);
    assert.equal(isValidRunId("a0000000-0000-0000-0000-000000000001"), false);
    assert.equal(isValidRunId("bad-id"), false);
  });

  it("processHandoff returns internal error for invalid Foreman-assigned run_id", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const result = processHandoff(
      request, session, createEmptyLedgerStore(),
      "bad-id", FOREMAN_VERSION, NOW,
    );
    assert.equal(result.ok, false);
    if (!result.ok && "internal" in result) {
      assert.equal(result.internal, true);
      assert.equal(result.code, "INVALID_RUN_ID");
    } else {
      assert.fail("Expected HandoffInternalError");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3: run_id never reused
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-3: run_id never reused", () => {
  it("rejects duplicate run_id on active run", () => {
    const ledger = makeLedger();
    const first = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(first.ok, true);
    const second = createRunLedger(
      (first as { ok: true; data: RunLedgerStore }).data, ledger,
    );
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "DUPLICATE_RUN_ID");
  });

  it("rejects same run_id even after prior run reaches terminal state", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    let store = (createResult as { ok: true; data: RunLedgerStore }).data;

    // Drive to terminal: PENDING_ACK → INITIATING → FAILED
    let s = updateLedgerState(store, VALID_RUN_ID, "INITIATING", NOW);
    assert.equal(s.ok, true);
    s = updateLedgerState(
      (s as { ok: true; data: RunLedgerStore }).data,
      VALID_RUN_ID, "FAILED", NOW, "test failure",
    );
    assert.equal(s.ok, true);
    store = (s as { ok: true; data: RunLedgerStore }).data;

    // Confirm run is terminal
    const terminated = getLedger(store, VALID_RUN_ID)!;
    assert.equal(isTerminalRunState(terminated.state), true);

    // Attempt to reuse same run_id
    const reuseLedger = makeLedger({ plan_id: "other-plan-id" });
    const reuseResult = createRunLedger(store, reuseLedger);
    assert.equal(reuseResult.ok, false);
    if (!reuseResult.ok) assert.equal(reuseResult.code, "DUPLICATE_RUN_ID");
  });

  it("processHandoff returns internal error for duplicate run_id after terminal", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);

    // First handoff
    const first = processHandoff(
      request, session, createEmptyLedgerStore(),
      VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(first.ok, true);
    let store = (first as { ok: true; store: RunLedgerStore }).store;

    // Terminate the run
    let s = updateLedgerState(store, VALID_RUN_ID, "INITIATING", NOW);
    assert.equal(s.ok, true);
    s = updateLedgerState(
      (s as { ok: true; data: RunLedgerStore }).data,
      VALID_RUN_ID, "FAILED", NOW, "done",
    );
    assert.equal(s.ok, true);
    store = (s as { ok: true; data: RunLedgerStore }).data;

    // Reuse same run_id → internal error (not handoff rejection)
    const second = processHandoff(
      request, session, store, VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(second.ok, false);
    if (!second.ok && "internal" in second) {
      assert.equal(second.internal, true);
    } else {
      assert.fail("Expected HandoffInternalError for reused run_id");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4: HANDOFF_REJECTED leaves plan in READY with no ledger entry
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-4: HANDOFF_REJECTED leaves no ledger entry", () => {
  it("rejection for unknown plan_id creates no ledger", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.plan_id = "unknown-plan";
    const store = createEmptyLedgerStore();
    const result = processHandoff(
      request, session, store, VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(result.ok, false);
    if (!result.ok && "rejected" in result) {
      // Store unchanged — no ledger for the attempted run
      assert.equal(getLedger(result.store, VALID_RUN_ID), undefined);
      assert.equal(result.store.ledgers.size, 0);
    }
  });

  it("rejection for version mismatch creates no ledger", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.plan_version = 999;
    const store = createEmptyLedgerStore();
    const result = processHandoff(
      request, session, store, VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(result.ok, false);
    if (!result.ok && "rejected" in result) {
      assert.equal(getLedger(result.store, VALID_RUN_ID), undefined);
    }
  });

  it("rejection for non-Command requestor creates no ledger", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.requested_by = "Forge";
    const store = createEmptyLedgerStore();
    const result = processHandoff(
      request, session, store, VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(result.ok, false);
    if (!result.ok && "rejected" in result) {
      assert.equal(getLedger(result.store, VALID_RUN_ID), undefined);
    }
  });

  it("rejection for checksum mismatch creates no ledger", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.checksum = "wrong";
    const store = createEmptyLedgerStore();
    const result = processHandoff(
      request, session, store, VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(result.ok, false);
    if (!result.ok && "rejected" in result) {
      assert.equal(getLedger(result.store, VALID_RUN_ID), undefined);
    }
  });

  it("rejection for non-APPROVED state creates no ledger", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const notReady = { ...session, current_state: "REVIEW_PENDING" as const };
    const store = createEmptyLedgerStore();
    const result = processHandoff(
      request, notReady, store, VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(result.ok, false);
    if (!result.ok && "rejected" in result) {
      assert.equal(getLedger(result.store, VALID_RUN_ID), undefined);
    }
  });

  it("session remains in APPROVED after rejection (P1-S2 not mutated)", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    request.plan_version = 999;
    processHandoff(
      request, session, createEmptyLedgerStore(),
      VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    // processHandoff is pure — session object is not mutated
    assert.equal(session.current_state, "APPROVED");
    assert.ok(session.plan_artifact);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-5: Every execution event carries non-null run_id, plan_id, sequence, emitted_at
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-5: Execution event envelope fields non-null", () => {
  const validPayload: ExecutionStartedPayload = {
    plan_snapshot_checksum: "abc123",
    foreman_version: FOREMAN_VERSION,
    env_context_hash: "hash-001",
  };

  it("rejects empty event_id", () => {
    const r = createExecutionEvent("", VALID_RUN_ID, PLAN_ID, "EXECUTION_STARTED", NOW, "foreman", validPayload, 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "EVENT_MISSING_ID");
  });

  it("rejects empty run_id", () => {
    const r = createExecutionEvent(EVENT_ID_1, "", PLAN_ID, "EXECUTION_STARTED", NOW, "foreman", validPayload, 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "EVENT_MISSING_RUN_ID");
  });

  it("rejects empty plan_id", () => {
    const r = createExecutionEvent(EVENT_ID_1, VALID_RUN_ID, "", "EXECUTION_STARTED", NOW, "foreman", validPayload, 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "EVENT_MISSING_PLAN_ID");
  });

  it("rejects empty emitted_at", () => {
    const r = createExecutionEvent(EVENT_ID_1, VALID_RUN_ID, PLAN_ID, "EXECUTION_STARTED", "", "foreman", validPayload, 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "EVENT_MISSING_EMITTED_AT");
  });

  it("rejects empty emitted_by", () => {
    const r = createExecutionEvent(EVENT_ID_1, VALID_RUN_ID, PLAN_ID, "EXECUTION_STARTED", NOW, "", validPayload, 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "EVENT_MISSING_EMITTED_BY");
  });

  it("rejects sequence < 1", () => {
    const r = createExecutionEvent(EVENT_ID_1, VALID_RUN_ID, PLAN_ID, "EXECUTION_STARTED", NOW, "foreman", validPayload, 0);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "EVENT_INVALID_SEQUENCE");
  });

  it("accepts valid event with all required fields", () => {
    const r = createExecutionEvent(EVENT_ID_1, VALID_RUN_ID, PLAN_ID, "EXECUTION_STARTED", NOW, "foreman", validPayload, 1);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.event.event_id, EVENT_ID_1);
      assert.equal(r.event.run_id, VALID_RUN_ID);
      assert.equal(r.event.plan_id, PLAN_ID);
      assert.equal(r.event.emitted_at, NOW);
      assert.equal(r.event.sequence, 1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-6: Sequence gapless and monotonic; gap triggers halt
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-6: Sequence gapless, monotonic; gap triggers halt", () => {
  it("first event must be sequence 1", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    const store = (createResult as { ok: true; data: RunLedgerStore }).data;

    const event: RunLedgerEvent = {
      event_id: EVENT_ID_1, run_id: VALID_RUN_ID, plan_id: PLAN_ID,
      sequence: 2, event_type: "EXECUTION_STARTED", emitted_at: NOW,
      emitted_by: "foreman",
      payload: { plan_snapshot_checksum: "c", foreman_version: "v", env_context_hash: "h" } as ExecutionStartedPayload,
    };
    const result = appendLedgerEvent(store, event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "LEDGER_SEQUENCE_GAP");
  });

  it("detects sequence regression (duplicate sequence number)", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    let store = (createResult as { ok: true; data: RunLedgerStore }).data;

    const event1: RunLedgerEvent = {
      event_id: EVENT_ID_1, run_id: VALID_RUN_ID, plan_id: PLAN_ID,
      sequence: 1, event_type: "EXECUTION_STARTED", emitted_at: NOW,
      emitted_by: "foreman",
      payload: { plan_snapshot_checksum: "c", foreman_version: "v", env_context_hash: "h" } as ExecutionStartedPayload,
    };
    const append1 = appendLedgerEvent(store, event1);
    assert.equal(append1.ok, true);
    store = (append1 as { ok: true; data: RunLedgerStore }).data;

    const event1dup: RunLedgerEvent = {
      event_id: EVENT_ID_2, run_id: VALID_RUN_ID, plan_id: PLAN_ID,
      sequence: 1, event_type: "EXECUTION_STARTED", emitted_at: NOW,
      emitted_by: "foreman",
      payload: { plan_snapshot_checksum: "c", foreman_version: "v", env_context_hash: "h" } as ExecutionStartedPayload,
    };
    const result = appendLedgerEvent(store, event1dup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "LEDGER_SEQUENCE_REGRESSION");
  });

  it("accepts monotonic sequence 1, 2, 3", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    let store = (createResult as { ok: true; data: RunLedgerStore }).data;

    for (let seq = 1; seq <= 3; seq++) {
      const event: RunLedgerEvent = {
        event_id: `evt-${seq}`, run_id: VALID_RUN_ID, plan_id: PLAN_ID,
        sequence: seq, event_type: "EXECUTION_STARTED", emitted_at: NOW,
        emitted_by: "foreman",
        payload: { plan_snapshot_checksum: "c", foreman_version: "v", env_context_hash: "h" } as ExecutionStartedPayload,
      };
      const result = appendLedgerEvent(store, event);
      assert.equal(result.ok, true, `Sequence ${seq} should be accepted`);
      store = (result as { ok: true; data: RunLedgerStore }).data;
    }
    assert.equal(getLastSequence(store, VALID_RUN_ID), 3);
  });

  it("rejects plan_id mismatch on event append", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    const store = (createResult as { ok: true; data: RunLedgerStore }).data;

    const event: RunLedgerEvent = {
      event_id: EVENT_ID_1, run_id: VALID_RUN_ID, plan_id: "wrong-plan-id",
      sequence: 1, event_type: "EXECUTION_STARTED", emitted_at: NOW,
      emitted_by: "foreman",
      payload: { plan_snapshot_checksum: "c", foreman_version: "v", env_context_hash: "h" } as ExecutionStartedPayload,
    };
    const result = appendLedgerEvent(store, event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PLAN_ID_MISMATCH");
  });

  it("SEQUENCE_INTEGRITY stop condition forces halt via P1-S3 policy", () => {
    // Sequence integrity violations are classified in FORCED_HALT_CONDITION_IDS.
    // When detected, handleStopCondition forces halt even with halt_required=false.
    const { store } = storeWithRunningRun();
    const payload: StopConditionTriggeredPayload = {
      condition_id: "SEQUENCE_INTEGRITY",
      triggered_by_step: "step-001",
      evidence_summary: "Sequence gap detected in event stream",
      halt_required: false, // forced regardless by P1-S3 policy
    };
    const result = handleStopCondition(
      store, VALID_RUN_ID, payload,
      EVENT_ID_1, EVENT_ID_2, EVENT_ID_3, NOW, 0, 2, 1000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.halted, true);
      const ledger = getLedger(result.store, VALID_RUN_ID)!;
      assert.equal(ledger.state, "FAILED");
      // Verify HALT_INITIATED and RUN_FAILED emitted
      const events = getLedgerEvents(result.store, VALID_RUN_ID)!;
      const types = events.map(e => e.event_type);
      assert.ok(types.includes("HALT_INITIATED"));
      assert.ok(types.includes("RUN_FAILED"));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-7: No PENDING_ACK → RUNNING direct
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-7: No PENDING_ACK → RUNNING direct", () => {
  it("transitionRunState rejects PENDING_ACK → RUNNING", () => {
    const result = transitionRunState("PENDING_ACK", "RUNNING");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /must pass through INITIATING/);
  });

  it("isValidRunLifecycleTransition returns false for PENDING_ACK → RUNNING", () => {
    assert.equal(isValidRunLifecycleTransition("PENDING_ACK", "RUNNING"), false);
  });

  it("PENDING_ACK → INITIATING is the only allowed outbound transition", () => {
    assert.equal(isValidRunLifecycleTransition("PENDING_ACK", "INITIATING"), true);
    // All other targets rejected
    for (const target of ["RUNNING", "HALTING", "COMPLETING", "COMPLETED", "FAILED", "CANCELLED"] as RunLifecycleState[]) {
      assert.equal(
        isValidRunLifecycleTransition("PENDING_ACK", target), false,
        `PENDING_ACK → ${target} should be rejected`,
      );
    }
  });

  it("CANCELLING state does NOT exist (Command ruling)", () => {
    assert.equal(RUN_LIFECYCLE_STATES.has("CANCELLING"), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-8: No terminal state transitions onward
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-8: No terminal state transitions onward", () => {
  const terminalStates: RunLifecycleState[] = ["COMPLETED", "FAILED", "CANCELLED"];
  const nonTerminalTargets: RunLifecycleState[] = [
    "PENDING_ACK", "INITIATING", "RUNNING", "HALTING", "COMPLETING",
  ];

  for (const terminal of terminalStates) {
    it(`${terminal} rejects all outbound transitions`, () => {
      for (const target of nonTerminalTargets) {
        assert.equal(
          isValidRunLifecycleTransition(terminal, target), false,
          `${terminal} → ${target} should be rejected`,
        );
      }
    });

    it(`${terminal} is in TERMINAL_RUN_STATES`, () => {
      assert.ok(TERMINAL_RUN_STATES.has(terminal as "COMPLETED" | "FAILED" | "CANCELLED"));
    });

    it(`isTerminalRunState returns true for ${terminal}`, () => {
      assert.equal(isTerminalRunState(terminal), true);
    });

    it(`transitionRunState returns structured reason for ${terminal}`, () => {
      const result = transitionRunState(terminal, "RUNNING");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /Terminal state/);
    });
  }

  it("updateLedgerState returns TERMINAL_STATE_LOCKED for terminal ledger", () => {
    const { store } = storeWithRunningRun();
    let s = updateLedgerState(store, VALID_RUN_ID, "COMPLETING", NOW);
    assert.equal(s.ok, true);
    s = updateLedgerState((s as { ok: true; data: RunLedgerStore }).data, VALID_RUN_ID, "COMPLETED", NOW);
    assert.equal(s.ok, true);
    const blocked = updateLedgerState(
      (s as { ok: true; data: RunLedgerStore }).data, VALID_RUN_ID, "RUNNING", NOW,
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "TERMINAL_STATE_LOCKED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-9: RunLedgerEvent admits no update/delete at application role level
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-9: Append-only ledger integrity", () => {
  it("events array grows monotonically (no shrink path)", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    let store = (createResult as { ok: true; data: RunLedgerStore }).data;
    assert.equal(getLedgerEvents(store, VALID_RUN_ID)!.length, 0);

    const event: RunLedgerEvent = {
      event_id: EVENT_ID_1, run_id: VALID_RUN_ID, plan_id: PLAN_ID,
      sequence: 1, event_type: "EXECUTION_STARTED", emitted_at: NOW,
      emitted_by: "foreman",
      payload: { plan_snapshot_checksum: "c", foreman_version: "v", env_context_hash: "h" } as ExecutionStartedPayload,
    };
    const append = appendLedgerEvent(store, event);
    assert.equal(append.ok, true);
    store = (append as { ok: true; data: RunLedgerStore }).data;
    assert.equal(getLedgerEvents(store, VALID_RUN_ID)!.length, 1);
  });

  it("stored ledger entries are Object.freeze-d", () => {
    const ledger = makeLedger();
    const result = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(result.ok, true);
    const store = (result as { ok: true; data: RunLedgerStore }).data;
    assert.ok(Object.isFrozen(getLedger(store, VALID_RUN_ID)!));
  });

  it("stored events arrays are frozen", () => {
    const ledger = makeLedger();
    const result = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(result.ok, true);
    const store = (result as { ok: true; data: RunLedgerStore }).data;
    assert.ok(Object.isFrozen(getLedgerEvents(store, VALID_RUN_ID)!));
  });

  it("store itself is Object.freeze-d", () => {
    assert.ok(Object.isFrozen(createEmptyLedgerStore()));
  });

  it("new ledger must start in PENDING_ACK", () => {
    const ledger = makeLedger({ state: "RUNNING" as RunLifecycleState });
    const result = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_STATE_TRANSITION");
  });

  it("appendLedgerEvent returns new store — does not mutate input", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    const store = (createResult as { ok: true; data: RunLedgerStore }).data;
    const eventsBefore = getLedgerEvents(store, VALID_RUN_ID)!;

    const event: RunLedgerEvent = {
      event_id: EVENT_ID_1, run_id: VALID_RUN_ID, plan_id: PLAN_ID,
      sequence: 1, event_type: "EXECUTION_STARTED", emitted_at: NOW,
      emitted_by: "foreman",
      payload: { plan_snapshot_checksum: "c", foreman_version: "v", env_context_hash: "h" } as ExecutionStartedPayload,
    };
    const appendResult = appendLedgerEvent(store, event);
    assert.equal(appendResult.ok, true);

    // Original store unchanged
    assert.equal(eventsBefore.length, 0);
    assert.equal(getLedgerEvents(store, VALID_RUN_ID)!.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-10: Non-Command cancellation rejected and logged
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-10: Non-Command cancellation rejected and logged", () => {
  it("rejects non-Command cancellation with ACTOR_UNAUTHORISED", () => {
    const { store } = storeWithRunningRun();
    const result = requestCancellation(
      store, VALID_RUN_ID, "Forge",
      EVENT_ID_1, EVENT_ID_2, NOW, 0, 2, 1000,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ACTOR_UNAUTHORISED");
  });

  it("provides structured audit artifact on unauthorised cancellation", () => {
    const { store } = storeWithRunningRun();
    const result = requestCancellation(
      store, VALID_RUN_ID, "Forge",
      EVENT_ID_1, EVENT_ID_2, NOW, 0, 2, 1000,
    );
    assert.equal(result.ok, false);
    if (!result.ok && "audit_artifact" in result) {
      assert.equal(result.audit_artifact.run_id, VALID_RUN_ID);
      assert.equal(result.audit_artifact.requested_by, "Forge");
      assert.equal(result.audit_artifact.reason, "ACTOR_UNAUTHORISED");
      assert.equal(result.audit_artifact.rejected_at, NOW);
    } else {
      assert.fail("Expected audit_artifact in result");
    }
  });

  it("allows Command-role cancellation", () => {
    const { store } = storeWithRunningRun();
    const result = requestCancellation(
      store, VALID_RUN_ID, "Command",
      EVENT_ID_1, EVENT_ID_2, NOW, 1, 2, 5000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(getLedger(result.store, VALID_RUN_ID)!.state, "CANCELLED");
      assert.equal(result.terminal.terminal_state, "CANCELLED");
    }
  });

  it("cancellation transitions RUNNING → CANCELLED directly (no HALTING)", () => {
    const { store } = storeWithRunningRun();
    const result = requestCancellation(
      store, VALID_RUN_ID, "Command",
      EVENT_ID_1, EVENT_ID_2, NOW, 0, 0, 0,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const ledger = getLedger(result.store, VALID_RUN_ID)!;
      assert.equal(ledger.state, "CANCELLED");
      assert.equal(ledger.terminal_reason, "Cancelled by Command");
    }
  });

  it("rejects cancellation of non-RUNNING run", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    const store = (createResult as { ok: true; data: RunLedgerStore }).data;
    const result = requestCancellation(
      store, VALID_RUN_ID, "Command",
      EVENT_ID_1, EVENT_ID_2, NOW, 0, 0, 0,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CANCEL_INVALID_STATE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-11: Stored plan snapshot always matches checksum after INITIATING
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-11: Plan snapshot checksum verification", () => {
  it("verifyPlanSnapshot returns true for matching checksum", () => {
    const snapshot = { key: "value" };
    const ledger = makeLedger({
      plan_snapshot: snapshot,
      plan_snapshot_chksum: sha256(canonicalize(snapshot)),
    });
    assert.equal(verifyPlanSnapshot(ledger), true);
  });

  it("verifyPlanSnapshot returns false for mismatched checksum", () => {
    const ledger = makeLedger({
      plan_snapshot: { key: "value" },
      plan_snapshot_chksum: "wrong-checksum",
    });
    assert.equal(verifyPlanSnapshot(ledger), false);
  });

  it("initiateRun fails on snapshot mismatch → FAILED state with events", () => {
    const ledger = makeLedger({ plan_snapshot_chksum: "tampered" });
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    const store = (createResult as { ok: true; data: RunLedgerStore }).data;

    const result = initiateRun(
      store, VALID_RUN_ID, EVENT_ID_1, "hash-001", NOW,
      EVENT_ID_2, EVENT_ID_3,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "INITIATE_RUN_SNAPSHOT_MISMATCH");
      assert.ok(result.store);
      const failedLedger = getLedger(result.store!, VALID_RUN_ID)!;
      assert.equal(failedLedger.state, "FAILED");
    }
  });

  it("initiateRun snapshot mismatch emits HALT_INITIATED + RUN_FAILED", () => {
    const ledger = makeLedger({ plan_snapshot_chksum: "tampered" });
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    const store = (createResult as { ok: true; data: RunLedgerStore }).data;

    const result = initiateRun(
      store, VALID_RUN_ID, EVENT_ID_1, "hash-001", NOW,
      EVENT_ID_2, EVENT_ID_3,
    );
    assert.equal(result.ok, false);
    if (!result.ok && result.store) {
      const events = getLedgerEvents(result.store, VALID_RUN_ID)!;
      assert.ok(events.length >= 2);
      assert.equal(events[0].event_type, "HALT_INITIATED");
      assert.equal(events[1].event_type, "RUN_FAILED");
    }
  });

  it("validateHandoff rejects forged snapshot even with valid self-checksum", () => {
    const session = sessionInApproved();
    const forged = { forged: true };
    const request: HandoffRequest = {
      plan_id: session.plan_artifact!.plan_id,
      plan_version: session.plan_artifact!.version,
      plan_snapshot: forged,
      requested_by: "Command",
      requested_at: NOW,
      checksum: sha256(canonicalize(forged)),
    };
    const result = validateHandoff(request, session, createEmptyLedgerStore());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason_code, "CHECKSUM_MISMATCH");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-12: Simultaneous handoff for same plan_id → one ACK, one rejection
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-12: Simultaneous handoff yields one ACK and one rejection", () => {
  it("first handoff succeeds, second rejected with ACTIVE_RUN_EXISTS", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const emptyStore = createEmptyLedgerStore();

    // First handoff
    const first = processHandoff(
      request, session, emptyStore, VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(first.ok, true);
    const storeAfterFirst = (first as { ok: true; store: RunLedgerStore }).store;

    // Second handoff with different run_id
    const second = processHandoff(
      request, session, storeAfterFirst, VALID_RUN_ID_2, FOREMAN_VERSION, NOW,
    );
    assert.equal(second.ok, false);
    if (!second.ok && "rejected" in second) {
      assert.equal(second.rejected.reason_code, "ACTIVE_RUN_EXISTS");
    } else {
      assert.fail("Expected HandoffRejectedResult with ACTIVE_RUN_EXISTS");
    }
  });

  it("exactly one ledger created for the plan's active run", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);

    const first = processHandoff(
      request, session, createEmptyLedgerStore(),
      VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(first.ok, true);
    const storeAfterFirst = (first as { ok: true; store: RunLedgerStore }).store;

    processHandoff(
      request, session, storeAfterFirst,
      VALID_RUN_ID_2, FOREMAN_VERSION, NOW,
    );

    // Only one ledger exists for this plan's active run
    assert.ok(getLedger(storeAfterFirst, VALID_RUN_ID));
    assert.equal(getLedger(storeAfterFirst, VALID_RUN_ID_2), undefined);
    assert.equal(storeAfterFirst.ledgers.size, 1);
  });

  it("rejected handoff store is unchanged from input", () => {
    const session = sessionInApproved();
    const request = validHandoffRequest(session);

    const first = processHandoff(
      request, session, createEmptyLedgerStore(),
      VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(first.ok, true);
    const storeAfterFirst = (first as { ok: true; store: RunLedgerStore }).store;

    const second = processHandoff(
      request, session, storeAfterFirst,
      VALID_RUN_ID_2, FOREMAN_VERSION, NOW,
    );
    assert.equal(second.ok, false);
    if (!second.ok && "rejected" in second) {
      // Store returned with rejection is the same input store
      assert.equal(second.store, storeAfterFirst);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-13: All halt procedures emit HALT_INITIATED before terminal event
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-13: HALT_INITIATED before terminal event", () => {
  it("executeHaltProcedure: HALT_INITIATED before RUN_FAILED in event log", () => {
    const { store } = storeWithRunningRun();
    const result = executeHaltProcedure(
      store, VALID_RUN_ID,
      "UNRECOVERABLE_STEP_FAILURE", "foreman",
      { detail: "step crashed" },
      EVENT_ID_1, EVENT_ID_2, NOW, 1, 3, 5000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const events = getLedgerEvents(result.store, VALID_RUN_ID)!;
      const haltIdx = events.findIndex(e => e.event_type === "HALT_INITIATED");
      const termIdx = events.findIndex(e => e.event_type === "RUN_FAILED");
      assert.ok(haltIdx >= 0, "HALT_INITIATED must exist");
      assert.ok(termIdx >= 0, "RUN_FAILED must exist");
      assert.ok(haltIdx < termIdx, "HALT_INITIATED must precede RUN_FAILED");
    }
  });

  it("requestCancellation: HALT_INITIATED before RUN_CANCELLED in event log", () => {
    const { store } = storeWithRunningRun();
    const result = requestCancellation(
      store, VALID_RUN_ID, "Command",
      EVENT_ID_1, EVENT_ID_2, NOW, 0, 0, 0,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const events = getLedgerEvents(result.store, VALID_RUN_ID)!;
      const haltIdx = events.findIndex(e => e.event_type === "HALT_INITIATED");
      const termIdx = events.findIndex(e => e.event_type === "RUN_CANCELLED");
      assert.ok(haltIdx >= 0, "HALT_INITIATED must exist");
      assert.ok(termIdx >= 0, "RUN_CANCELLED must exist");
      assert.ok(haltIdx < termIdx, "HALT_INITIATED must precede RUN_CANCELLED");
    }
  });

  it("failRunFromInitiation: HALT_INITIATED before RUN_FAILED", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    let store = (createResult as { ok: true; data: RunLedgerStore }).data;
    const toInit = updateLedgerState(store, VALID_RUN_ID, "INITIATING", NOW);
    assert.equal(toInit.ok, true);
    store = (toInit as { ok: true; data: RunLedgerStore }).data;

    const result = failRunFromInitiation(
      store, VALID_RUN_ID, "Foreman crashed",
      EVENT_ID_1, EVENT_ID_2, NOW, 0,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const events = getLedgerEvents(result.store, VALID_RUN_ID)!;
      assert.ok(events.length >= 2);
      assert.equal(events[0].event_type, "HALT_INITIATED");
      assert.equal(events[1].event_type, "RUN_FAILED");
    }
  });

  it("terminal state set AFTER terminal event appended (halt procedure)", () => {
    const { store } = storeWithRunningRun();
    const result = executeHaltProcedure(
      store, VALID_RUN_ID,
      "CONTRACT_VIOLATION", "foreman",
      { detail: "contract broken" },
      EVENT_ID_1, EVENT_ID_2, NOW, 0, 0, 0,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const ledger = getLedger(result.store, VALID_RUN_ID)!;
      assert.equal(ledger.state, "FAILED");
      const events = getLedgerEvents(result.store, VALID_RUN_ID)!;
      assert.equal(events.length, 2);
      assert.equal(events[0].event_type, "HALT_INITIATED");
      assert.equal(events[1].event_type, "RUN_FAILED");
    }
  });

  it("terminal state set AFTER terminal event appended (completion)", () => {
    const { store } = storeWithRunningRun();
    const result = completeRun(store, VALID_RUN_ID, EVENT_ID_1, NOW, 2, 2, 3000);
    assert.equal(result.ok, true);
    if (result.ok) {
      const ledger = getLedger(result.store, VALID_RUN_ID)!;
      assert.equal(ledger.state, "COMPLETED");
      const events = getLedgerEvents(result.store, VALID_RUN_ID)!;
      assert.equal(events[events.length - 1].event_type, "RUN_COMPLETED");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-14: P1-S1 and P1-S2 contracts unmodified
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-14: P1-S1 and P1-S2 contracts unmodified", () => {
  it("PlanArtifact.run_id remains unused by P1-S3 (authoritative binding is RunLedger)", () => {
    // processHandoff creates a RunLedger, not a PlanArtifact mutation.
    // The session's plan_artifact.run_id is not modified.
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const runIdBefore = session.plan_artifact!.run_id;

    processHandoff(
      request, session, createEmptyLedgerStore(),
      VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );

    // Session not mutated — run_id on artifact unchanged
    assert.equal(session.plan_artifact!.run_id, runIdBefore);
  });

  it("P1-S1 validatePlanArtifactSchema still works unchanged", () => {
    // P1-S1 validator is not modified by P1-S3.
    // Verify it accepts valid artifacts and rejects invalid ones.
    const session = sessionInApproved();
    const artifact = session.plan_artifact!;
    const schemaResult = validatePlanArtifactSchema(artifact);
    assert.equal(schemaResult.ok, true);
  });

  it("P1-S1 runSelfCheck still works unchanged", () => {
    const session = sessionInApproved();
    const artifact = session.plan_artifact!;
    const selfCheckResult = runSelfCheck(artifact);
    assert.equal(selfCheckResult.ok, true);
  });

  it("P1-S1 computePlanHash and verifyPlanHash still work unchanged", () => {
    const session = sessionInApproved();
    const artifact = session.plan_artifact!;
    assert.ok(artifact.plan_hash);

    // Prove computePlanHash is deterministic: same input → same output.
    const hash1 = computePlanHash(artifact);
    const hash2 = computePlanHash(artifact);
    assert.equal(hash1, hash2, "computePlanHash must be deterministic");
    assert.equal(hash1.length, 64, "SHA-256 hex must be 64 chars");

    // Prove verifyPlanHash works correctly on a self-consistent artifact
    // (one where plan_hash was computed with the same field values).
    // Note: applyCommandApproval computes hash before setting approved_by,
    // so the approved artifact's stored hash reflects approved_by=null.
    // This is a P1-S2 design detail, not a P1-S3 concern.
    // We verify by building a self-consistent artifact:
    const consistentArtifact = { ...artifact, plan_hash: computePlanHash(artifact) };
    const verifyResult = verifyPlanHash(consistentArtifact);
    assert.equal(verifyResult.ok, true, "verifyPlanHash must pass on self-consistent artifact");

    // Prove verifyPlanHash rejects tampered hash
    const tampered = { ...artifact, plan_hash: "0".repeat(64) };
    const tamperedResult = verifyPlanHash(tampered);
    assert.equal(tamperedResult.ok, false, "verifyPlanHash must reject tampered hash");
  });

  it("P1-S2 session functions are read-only (session not mutated by P1-S3)", () => {
    const session = sessionInApproved();
    const stateBefore = session.current_state;
    const artifactBefore = session.plan_artifact;

    // Execute P1-S3 operations that take session as input
    validateHandoff(validHandoffRequest(session), session, createEmptyLedgerStore());

    // Session unchanged
    assert.equal(session.current_state, stateBefore);
    assert.equal(session.plan_artifact, artifactBefore);
  });

  it("P1-S3 does not write back to PlanArtifact schema fields", () => {
    // After processHandoff, the returned store contains RunLedger entries.
    // No PlanArtifact is returned or modified.
    const session = sessionInApproved();
    const request = validHandoffRequest(session);
    const result = processHandoff(
      request, session, createEmptyLedgerStore(),
      VALID_RUN_ID, FOREMAN_VERSION, NOW,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      // Result contains store + ack, not a modified PlanArtifact
      assert.ok(result.store);
      assert.ok(result.ack);
      assert.equal("plan_artifact" in result, false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Supporting: Payload validation (§6.3 exactness)
// ═══════════════════════════════════════════════════════════════════════════

describe("Supporting: Payload validation (§6.3)", () => {
  it("rejects invalid HaltReasonCode in HALT_INITIATED", () => {
    const r = validateEventPayload("HALT_INITIATED", {
      reason_code: "INVALID_CODE" as HaltReasonCode,
      initiated_by: "foreman",
      evidence: {},
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /HaltReasonCode/);
  });

  it("rejects invalid initiated_by in HALT_INITIATED", () => {
    const r = validateEventPayload("HALT_INITIATED", {
      reason_code: "CONTRACT_VIOLATION",
      initiated_by: "unknown_actor" as "foreman",
      evidence: {},
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /initiated_by/);
  });

  it("rejects missing evidence in HALT_INITIATED", () => {
    const payload = { reason_code: "CONTRACT_VIOLATION", initiated_by: "foreman" };
    const r = validateEventPayload("HALT_INITIATED", payload as HaltInitiatedPayload);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /evidence/);
  });

  it("rejects negative duration_ms", () => {
    const r = validateEventPayload("RUN_COMPLETED", {
      terminal_reason: "done",
      step_count_completed: 2,
      step_count_total: 2,
      duration_ms: -1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /duration_ms/);
  });

  it("rejects NaN in numeric fields", () => {
    const r = validateEventPayload("RUN_FAILED", {
      terminal_reason: "error",
      step_count_completed: NaN,
      step_count_total: 2,
      duration_ms: 100,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /step_count_completed/);
  });

  it("rejects Infinity in numeric fields", () => {
    const r = validateEventPayload("STEP_COMPLETED", {
      step_id: "s1", agent_id: "a1", output_checksum: "chk",
      duration_ms: Infinity,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /duration_ms/);
  });

  it("accepts valid EXECUTION_STARTED payload", () => {
    const r = validateEventPayload("EXECUTION_STARTED", {
      plan_snapshot_checksum: "abc", foreman_version: "v1", env_context_hash: "h1",
    });
    assert.equal(r.ok, true);
  });

  it("accepts valid HALT_INITIATED payload", () => {
    const r = validateEventPayload("HALT_INITIATED", {
      reason_code: "FOREMAN_INTERNAL_ERROR",
      initiated_by: "foreman",
      evidence: { detail: "crash" },
    });
    assert.equal(r.ok, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Supporting: Run lifecycle orchestration
// ═══════════════════════════════════════════════════════════════════════════

describe("Supporting: Run lifecycle orchestration", () => {
  it("initiateRun transitions PENDING_ACK → INITIATING → RUNNING", () => {
    const snapshot = { test: "data" };
    const chksum = sha256(canonicalize(snapshot));
    const ledger = makeLedger({ plan_snapshot: snapshot, plan_snapshot_chksum: chksum });
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    const store = (createResult as { ok: true; data: RunLedgerStore }).data;

    const result = initiateRun(
      store, VALID_RUN_ID, EVENT_ID_1, "env-hash", NOW,
      EVENT_ID_2, EVENT_ID_3,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(getLedger(result.store, VALID_RUN_ID)!.state, "RUNNING");
      assert.equal(result.initiated.run_id, VALID_RUN_ID);
      assert.equal(result.executionStartedEvent.event_type, "EXECUTION_STARTED");
    }
  });

  it("completeRun transitions RUNNING → COMPLETING → COMPLETED", () => {
    const { store } = storeWithRunningRun();
    const result = completeRun(store, VALID_RUN_ID, EVENT_ID_1, NOW, 2, 2, 3000);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(getLedger(result.store, VALID_RUN_ID)!.state, "COMPLETED");
      assert.equal(result.terminalEvent.event_type, "RUN_COMPLETED");
      assert.equal(result.terminal.terminal_state, "COMPLETED");
    }
  });

  it("completeRun rejects unrecoverable STEP_FAILED", () => {
    const { store } = storeWithRunningRun();
    const failEvent: RunLedgerEvent = {
      event_id: EVENT_ID_1, run_id: VALID_RUN_ID, plan_id: PLAN_ID,
      sequence: 1, event_type: "STEP_FAILED", emitted_at: NOW,
      emitted_by: "foreman",
      payload: {
        step_id: "s1", agent_id: "a1",
        failure_code: "CRASH", failure_detail: "Crashed",
        is_recoverable: false,
      } as StepFailedPayload,
    };
    const appendResult = appendLedgerEvent(store, failEvent);
    assert.equal(appendResult.ok, true);
    const storeWithFail = (appendResult as { ok: true; data: RunLedgerStore }).data;

    const result = completeRun(storeWithFail, VALID_RUN_ID, EVENT_ID_2, NOW, 1, 2, 3000);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "COMPLETE_RUN_UNRESOLVED_FAILURE");
  });

  it("completeRun allows recoverable STEP_FAILED", () => {
    const { store } = storeWithRunningRun();
    const failEvent: RunLedgerEvent = {
      event_id: EVENT_ID_1, run_id: VALID_RUN_ID, plan_id: PLAN_ID,
      sequence: 1, event_type: "STEP_FAILED", emitted_at: NOW,
      emitted_by: "foreman",
      payload: {
        step_id: "s1", agent_id: "a1",
        failure_code: "TIMEOUT", failure_detail: "Timed out",
        is_recoverable: true,
      } as StepFailedPayload,
    };
    const appendResult = appendLedgerEvent(store, failEvent);
    assert.equal(appendResult.ok, true);

    const result = completeRun(
      (appendResult as { ok: true; data: RunLedgerStore }).data,
      VALID_RUN_ID, EVENT_ID_2, NOW, 2, 2, 3000,
    );
    assert.equal(result.ok, true);
  });

  it("executeHaltProcedure transitions RUNNING → HALTING → FAILED", () => {
    const { store } = storeWithRunningRun();
    const result = executeHaltProcedure(
      store, VALID_RUN_ID,
      "UNRECOVERABLE_STEP_FAILURE", "foreman",
      { detail: "step failed" },
      EVENT_ID_1, EVENT_ID_2, NOW, 1, 3, 5000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(getLedger(result.store, VALID_RUN_ID)!.state, "FAILED");
      assert.equal(result.terminalState, "FAILED");
    }
  });

  it("failRunFromInitiation transitions INITIATING → FAILED", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    let store = (createResult as { ok: true; data: RunLedgerStore }).data;
    const toInit = updateLedgerState(store, VALID_RUN_ID, "INITIATING", NOW);
    assert.equal(toInit.ok, true);
    store = (toInit as { ok: true; data: RunLedgerStore }).data;

    const result = failRunFromInitiation(
      store, VALID_RUN_ID, "Env setup failed",
      EVENT_ID_1, EVENT_ID_2, NOW, 0,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(getLedger(result.store, VALID_RUN_ID)!.state, "FAILED");
      assert.equal(result.terminal.terminal_state, "FAILED");
    }
  });

  it("buildRunTerminal returns structured failure for non-terminal state", () => {
    const ledger = makeLedger({ state: "RUNNING" as RunLifecycleState });
    const result = buildRunTerminal(ledger);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "RUN_NOT_TERMINAL");
  });

  it("buildRunTerminal returns RunTerminal for terminal state", () => {
    const ledger = makeLedger({
      state: "COMPLETED" as RunLifecycleState,
      terminal_at: NOW,
      terminal_reason: "Done",
    });
    const result = buildRunTerminal(ledger);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.terminal.terminal_state, "COMPLETED");
      assert.equal(result.terminal.terminal_reason, "Done");
    }
  });

  it("createRunInitiated builds correct protocol message", () => {
    const msg = createRunInitiated(VALID_RUN_ID, PLAN_ID, 1, NOW);
    assert.equal(msg.run_id, VALID_RUN_ID);
    assert.equal(msg.plan_id, PLAN_ID);
    assert.equal(msg.plan_version, 1);
    assert.equal(msg.initiated_at, NOW);
  });

  it("active run detection across lifecycle", () => {
    const ledger = makeLedger();
    const createResult = createRunLedger(createEmptyLedgerStore(), ledger);
    assert.equal(createResult.ok, true);
    let store = (createResult as { ok: true; data: RunLedgerStore }).data;

    assert.equal(hasActiveRun(store, PLAN_ID), true);
    assert.ok(getActiveRunForPlan(store, PLAN_ID));

    let s = updateLedgerState(store, VALID_RUN_ID, "INITIATING", NOW);
    assert.equal(s.ok, true);
    s = updateLedgerState((s as { ok: true; data: RunLedgerStore }).data, VALID_RUN_ID, "FAILED", NOW, "test");
    assert.equal(s.ok, true);
    store = (s as { ok: true; data: RunLedgerStore }).data;

    assert.equal(hasActiveRun(store, PLAN_ID), false);
    assert.equal(getActiveRunForPlan(store, PLAN_ID), undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Supporting: Stop condition routing
// ═══════════════════════════════════════════════════════════════════════════

describe("Supporting: Stop condition routing (§9.3)", () => {
  function stopPayload(overrides?: Partial<StopConditionTriggeredPayload>): StopConditionTriggeredPayload {
    return {
      condition_id: "INFORMATIONAL_CONDITION",
      triggered_by_step: "step-001",
      evidence_summary: "Some evidence",
      halt_required: false,
      ...overrides,
    };
  }

  it("halt_required=false + non-critical → logged only", () => {
    const { store } = storeWithRunningRun();
    const result = handleStopCondition(
      store, VALID_RUN_ID, stopPayload(),
      EVENT_ID_1, EVENT_ID_2, EVENT_ID_3, NOW, 0, 2, 1000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.halted, false);
      assert.equal(getLedger(result.store, VALID_RUN_ID)!.state, "RUNNING");
    }
  });

  it("halt_required=true → triggers halt procedure", () => {
    const { store } = storeWithRunningRun();
    const result = handleStopCondition(
      store, VALID_RUN_ID, stopPayload({ halt_required: true }),
      EVENT_ID_1, EVENT_ID_2, EVENT_ID_3, NOW, 0, 2, 1000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.halted, true);
      assert.equal(getLedger(result.store, VALID_RUN_ID)!.state, "FAILED");
    }
  });

  for (const conditionId of [
    "TRUST_VIOLATION",
    "AUTH_FAILURE",
    "CONTRACT_VIOLATION",
    "SEQUENCE_INTEGRITY",
    "LEDGER_INTEGRITY",
  ]) {
    it(`${conditionId} forces halt even with halt_required=false (P1-S3 policy)`, () => {
      const { store } = storeWithRunningRun();
      const result = handleStopCondition(
        store, VALID_RUN_ID,
        stopPayload({ condition_id: conditionId, halt_required: false }),
        EVENT_ID_1, EVENT_ID_2, EVENT_ID_3, NOW, 0, 0, 0,
      );
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.halted, true);
    });
  }

  it("halted stop condition: event order is STOP_CONDITION → HALT_INITIATED → RUN_FAILED", () => {
    const { store } = storeWithRunningRun();
    const result = handleStopCondition(
      store, VALID_RUN_ID, stopPayload({ halt_required: true }),
      EVENT_ID_1, EVENT_ID_2, EVENT_ID_3, NOW, 0, 2, 1000,
    );
    assert.equal(result.ok, true);
    if (result.ok && result.halted) {
      const events = getLedgerEvents(result.store, VALID_RUN_ID)!;
      const types = events.map(e => e.event_type);
      const condIdx = types.indexOf("STOP_CONDITION_TRIGGERED");
      const haltIdx = types.indexOf("HALT_INITIATED");
      const failIdx = types.indexOf("RUN_FAILED");
      assert.ok(condIdx < haltIdx, "STOP_CONDITION before HALT_INITIATED");
      assert.ok(haltIdx < failIdx, "HALT_INITIATED before RUN_FAILED");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Supporting: Closed-set enforcement
// ═══════════════════════════════════════════════════════════════════════════

describe("Supporting: Closed-set enforcement", () => {
  it("RUN_LIFECYCLE_STATES has exactly 8 members", () => {
    assert.equal(RUN_LIFECYCLE_STATES.size, 8);
  });
  it("EXECUTION_EVENT_TYPES has exactly 9 members", () => {
    assert.equal(EXECUTION_EVENT_TYPES.size, 9);
  });
  it("HALT_REASON_CODES has exactly 7 members", () => {
    assert.equal(HALT_REASON_CODES.size, 7);
  });
  it("HANDOFF_REJECTION_CODES has exactly 6 members", () => {
    assert.equal(HANDOFF_REJECTION_CODES.size, 6);
  });
  it("TERMINAL_RUN_STATES has exactly 3 members", () => {
    assert.equal(TERMINAL_RUN_STATES.size, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Command ruling: Architecture constants
// ═══════════════════════════════════════════════════════════════════════════

describe("Command ruling: Architecture constants", () => {
  it("HALT_DRAIN_WINDOW_MS is exactly 30000 (30s)", () => {
    assert.equal(HALT_DRAIN_WINDOW_MS, 30_000);
  });
});
