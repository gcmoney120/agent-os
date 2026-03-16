/**
 * Agent OS — Planner Subsystem P1-S1: Validation + Hash Tests
 *
 * Zero-side-effect test coverage for:
 * - Goal payload validation (AC-P1-01, AC-P1-02)
 * - Plan artifact schema validation (AC-P1-03)
 * - Self-check gate: sequence, orphan, termination, trust escalation, MULTI governance
 *   (AC-P1-05, AC-P1-06, AC-P1-12)
 * - Plan hash computation + verification (AC-P1-13, AC-P1-14)
 * - Immutability boundary enforcement at validator level (AC-P1-07)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateGoalPayload,
  validatePlanArtifactSchema,
  validateSequenceContiguous,
  validateNoOrphanSteps,
  validateTerminationRule,
  validateTrustEscalation,
  validateMultiGovernance,
  runSelfCheck,
} from "../validate.js";

import {
  buildHashBody,
  canonicalize,
  sha256,
  computePlanHash,
  verifyPlanHash,
} from "../hash.js";

import type { PlanArtifact, PlanStep } from "../types.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

const VALID_UUID_1 = "a0000000-0000-0000-0000-000000000001";
const VALID_UUID_2 = "b0000000-0000-0000-0000-000000000002";
const VALID_UUID_3 = "c0000000-0000-0000-0000-000000000003";
const VALID_UUID_4 = "d0000000-0000-0000-0000-000000000004";
const VALID_UUID_5 = "e0000000-0000-0000-0000-000000000005";
const VALID_TS = "2026-03-12T10:00:00.000Z";

function makeGoalPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    goal_id: VALID_UUID_1,
    goal_text: "Implement planner subsystem",
    scope_tag: "KNOWLEDGE",
    trust_touch: false,
    submitted_by: "Command",
    submitted_at: VALID_TS,
    ...overrides,
  };
}

function makeStep(overrides: Partial<PlanStep> & { step_id?: string; sequence?: number } = {}): PlanStep {
  return {
    step_id: VALID_UUID_2,
    sequence: 1,
    label: "Design architecture",
    agent: "Atlas",
    input_contract: "goal",
    output_contract: "Architecture spec",
    acceptance_criteria: ["Spec reviewed by Command"],
    depends_on: [],
    trust_touch: false,
    trust_touch_domains: [],
    status: "PENDING",
    result_ref: null,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<PlanArtifact> = {}): PlanArtifact {
  const step1 = makeStep({ step_id: VALID_UUID_2, sequence: 1, agent: "Atlas" });
  const step2 = makeStep({
    step_id: VALID_UUID_3,
    sequence: 2,
    agent: "Forge",
    label: "Implement",
    depends_on: [VALID_UUID_2],
  });
  const step3 = makeStep({
    step_id: VALID_UUID_4,
    sequence: 3,
    agent: "Compass",
    label: "Validate",
    depends_on: [VALID_UUID_3],
  });

  return {
    plan_id: VALID_UUID_1,
    goal_id: VALID_UUID_5,
    version: 1,
    version_history: [],
    status: "PLAN_DRAFT",
    scope_tag: "KNOWLEDGE",
    trust_sensitive: false,
    steps: [step1, step2, step3],
    non_goals: [],
    sentinel_prereview: null,
    submitted_at: VALID_TS,
    approved_at: null,
    approved_by: null,
    approval_acknowledgements: [],
    plan_hash: null,
    run_id: null,
    executed_at: null,
    archived_at: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GOAL PAYLOAD VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe("validateGoalPayload", () => {
  it("accepts a valid goal payload", () => {
    const result = validateGoalPayload(makeGoalPayload());
    assert.equal(result.ok, true);
  });

  it("rejects null", () => {
    const result = validateGoalPayload(null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_SHAPE");
  });

  it("rejects non-object", () => {
    const result = validateGoalPayload("not an object");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_SHAPE");
  });

  // AC-P1-01: missing each required field
  for (const field of ["goal_id", "goal_text", "scope_tag", "trust_touch", "submitted_by", "submitted_at"]) {
    it(`rejects missing ${field} (AC-P1-01)`, () => {
      const payload = makeGoalPayload();
      delete payload[field];
      const result = validateGoalPayload(payload);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "GOAL_MISSING_FIELD");
        assert.deepEqual((result.detail as { field: string }).field, field);
      }
    });
  }

  // AC-P1-02: submitted_by ≠ "Command"
  it('rejects submitted_by = "Atlas" (AC-P1-02)', () => {
    const result = validateGoalPayload(makeGoalPayload({ submitted_by: "Atlas" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_SUBMITTED_BY_INVALID");
  });

  it('rejects submitted_by = "Forge" (AC-P1-02)', () => {
    const result = validateGoalPayload(makeGoalPayload({ submitted_by: "Forge" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_SUBMITTED_BY_INVALID");
  });

  it("rejects invalid goal_id (not UUID)", () => {
    const result = validateGoalPayload(makeGoalPayload({ goal_id: "not-a-uuid" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_FIELD");
  });

  it("rejects empty goal_text", () => {
    const result = validateGoalPayload(makeGoalPayload({ goal_text: "" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_FIELD");
  });

  it("rejects whitespace-only goal_text", () => {
    const result = validateGoalPayload(makeGoalPayload({ goal_text: "   " }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_FIELD");
  });

  it("rejects invalid scope_tag", () => {
    const result = validateGoalPayload(makeGoalPayload({ scope_tag: "INVALID" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_FIELD");
  });

  it("rejects non-boolean trust_touch", () => {
    const result = validateGoalPayload(makeGoalPayload({ trust_touch: "yes" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_FIELD");
  });

  it("rejects invalid submitted_at", () => {
    const result = validateGoalPayload(makeGoalPayload({ submitted_at: "not-a-date" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_FIELD");
  });

  it("rejects non-array constraints", () => {
    const result = validateGoalPayload(makeGoalPayload({ constraints: "should be array" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GOAL_INVALID_FIELD");
  });

  it("accepts valid optional fields", () => {
    const result = validateGoalPayload(makeGoalPayload({
      constraints: ["no migrations"],
      non_goals: ["UI work"],
    }));
    assert.equal(result.ok, true);
  });

  it("accepts all valid scope_tags", () => {
    for (const tag of ["KNOWLEDGE", "TRUST", "INFRA", "PRODUCT", "MULTI"]) {
      const result = validateGoalPayload(makeGoalPayload({ scope_tag: tag }));
      assert.equal(result.ok, true, `Expected ${tag} to be accepted`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PLAN ARTIFACT SCHEMA VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe("validatePlanArtifactSchema", () => {
  it("accepts a valid artifact (AC-P1-03)", () => {
    const result = validatePlanArtifactSchema(makeArtifact());
    assert.equal(result.ok, true);
  });

  it("rejects null", () => {
    const result = validatePlanArtifactSchema(null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_INVALID_SHAPE");
  });

  it("rejects missing plan_id", () => {
    const a = makeArtifact() as unknown as Record<string, unknown>;
    delete a.plan_id;
    const result = validatePlanArtifactSchema(a);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_MISSING_FIELD");
  });

  it("rejects invalid plan_id", () => {
    const result = validatePlanArtifactSchema(makeArtifact({ plan_id: "bad" } as any));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_INVALID_FIELD");
  });

  it("rejects version = 0", () => {
    const result = validatePlanArtifactSchema(makeArtifact({ version: 0 }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_INVALID_FIELD");
  });

  it("rejects negative version", () => {
    const result = validatePlanArtifactSchema(makeArtifact({ version: -1 }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_INVALID_FIELD");
  });

  it("rejects empty steps array", () => {
    const result = validatePlanArtifactSchema(makeArtifact({ steps: [] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_STEPS_EMPTY");
  });

  it("rejects invalid status", () => {
    const result = validatePlanArtifactSchema(makeArtifact({ status: "BOGUS" as any }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_INVALID_FIELD");
  });

  it("rejects invalid scope_tag", () => {
    const result = validatePlanArtifactSchema(makeArtifact({ scope_tag: "BOGUS" as any }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_INVALID_FIELD");
  });

  it('rejects approved_by that is not "Command" or null', () => {
    const result = validatePlanArtifactSchema(makeArtifact({ approved_by: "Atlas" as any }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_INVALID_FIELD");
  });

  it("rejects malformed plan_hash", () => {
    const result = validatePlanArtifactSchema(makeArtifact({ plan_hash: "tooshort" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ARTIFACT_INVALID_FIELD");
  });

  it("accepts valid 64-char hex plan_hash", () => {
    const hash = "a".repeat(64);
    const result = validatePlanArtifactSchema(makeArtifact({ plan_hash: hash }));
    assert.equal(result.ok, true);
  });

  it("rejects step with missing step_id", () => {
    const steps = [{ ...makeStep(), step_id: undefined }] as any;
    const result = validatePlanArtifactSchema(makeArtifact({ steps }));
    assert.equal(result.ok, false);
  });

  it("rejects step with invalid agent", () => {
    const steps = [makeStep({ agent: "Unknown" as any })];
    const result = validatePlanArtifactSchema(makeArtifact({ steps }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STEP_INVALID_FIELD");
  });

  it("rejects step with empty acceptance_criteria", () => {
    const steps = [makeStep({ acceptance_criteria: [] })];
    const result = validatePlanArtifactSchema(makeArtifact({ steps }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STEP_AC_EMPTY");
  });

  it("rejects step with whitespace-only AC entry", () => {
    const steps = [makeStep({ acceptance_criteria: ["  "] })];
    const result = validatePlanArtifactSchema(makeArtifact({ steps }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STEP_AC_EMPTY");
  });

  it("rejects step with invalid trust_touch_domain", () => {
    const steps = [makeStep({
      trust_touch: true,
      trust_touch_domains: ["INVALID_DOMAIN" as any],
    })];
    const result = validatePlanArtifactSchema(makeArtifact({ steps }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STEP_INVALID_FIELD");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SELF-CHECK GATE VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

describe("validateSequenceContiguous", () => {
  it("passes for contiguous 1,2,3", () => {
    const steps = [
      makeStep({ sequence: 1 }),
      makeStep({ sequence: 2, step_id: VALID_UUID_3, depends_on: [VALID_UUID_2] }),
      makeStep({ sequence: 3, step_id: VALID_UUID_4, depends_on: [VALID_UUID_3] }),
    ];
    assert.equal(validateSequenceContiguous(steps).ok, true);
  });

  it("fails for gap (1, 3)", () => {
    const steps = [
      makeStep({ sequence: 1 }),
      makeStep({ sequence: 3, step_id: VALID_UUID_3 }),
    ];
    const result = validateSequenceContiguous(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_SEQUENCE_GAP");
  });

  it("fails for starting at 0", () => {
    const steps = [makeStep({ sequence: 0 })];
    const result = validateSequenceContiguous(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_SEQUENCE_GAP");
  });

  it("fails for duplicate sequence numbers", () => {
    const steps = [
      makeStep({ sequence: 1 }),
      makeStep({ sequence: 1, step_id: VALID_UUID_3 }),
    ];
    const result = validateSequenceContiguous(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_SEQUENCE_GAP");
  });
});

describe("validateNoOrphanSteps", () => {
  it("passes: step 1 has no depends_on, step 2 depends on step 1 (AC-P1-12)", () => {
    const steps = [
      makeStep({ step_id: VALID_UUID_2, sequence: 1 }),
      makeStep({ step_id: VALID_UUID_3, sequence: 2, depends_on: [VALID_UUID_2] }),
    ];
    assert.equal(validateNoOrphanSteps(steps).ok, true);
  });

  it("fails: step 2 has empty depends_on (AC-P1-12)", () => {
    const steps = [
      makeStep({ step_id: VALID_UUID_2, sequence: 1 }),
      makeStep({ step_id: VALID_UUID_3, sequence: 2, depends_on: [] }),
    ];
    const result = validateNoOrphanSteps(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_ORPHAN_STEP");
  });

  it("fails: depends_on references unknown step_id", () => {
    const steps = [
      makeStep({ step_id: VALID_UUID_2, sequence: 1 }),
      makeStep({ step_id: VALID_UUID_3, sequence: 2, depends_on: ["f0000000-0000-0000-0000-000000000099"] }),
    ];
    const result = validateNoOrphanSteps(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_DEPENDENCY_MISSING");
  });
});

describe("validateTerminationRule", () => {
  it("passes when final step is Compass (AC-P1-06)", () => {
    const steps = [
      makeStep({ sequence: 1, agent: "Atlas" }),
      makeStep({ sequence: 2, step_id: VALID_UUID_3, agent: "Compass", depends_on: [VALID_UUID_2] }),
    ];
    assert.equal(validateTerminationRule(steps).ok, true);
  });

  it("passes when final step is Command (AC-P1-06)", () => {
    const steps = [
      makeStep({ sequence: 1, agent: "Atlas" }),
      makeStep({ sequence: 2, step_id: VALID_UUID_3, agent: "Command", depends_on: [VALID_UUID_2] }),
    ];
    assert.equal(validateTerminationRule(steps).ok, true);
  });

  it("fails when final step is Forge (AC-P1-06)", () => {
    const steps = [
      makeStep({ sequence: 1, agent: "Atlas" }),
      makeStep({ sequence: 2, step_id: VALID_UUID_3, agent: "Forge", depends_on: [VALID_UUID_2] }),
    ];
    const result = validateTerminationRule(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_TERMINATION_VIOLATION");
  });

  it("fails when final step is Atlas", () => {
    const steps = [makeStep({ sequence: 1, agent: "Atlas" })];
    const result = validateTerminationRule(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_TERMINATION_VIOLATION");
  });

  it("fails when final step is Sentinel", () => {
    const steps = [makeStep({ sequence: 1, agent: "Sentinel" })];
    const result = validateTerminationRule(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_TERMINATION_VIOLATION");
  });

  it("fails on empty steps", () => {
    const result = validateTerminationRule([]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_NO_STEPS");
  });
});

describe("validateTrustEscalation", () => {
  it("passes: Sentinel before Forge on same trust domain (AC-P1-05)", () => {
    const steps: PlanStep[] = [
      makeStep({
        step_id: VALID_UUID_2,
        sequence: 1,
        agent: "Sentinel",
        trust_touch: true,
        trust_touch_domains: ["IDENTITY"],
      }),
      makeStep({
        step_id: VALID_UUID_3,
        sequence: 2,
        agent: "Forge",
        trust_touch: true,
        trust_touch_domains: ["IDENTITY"],
        depends_on: [VALID_UUID_2],
      }),
    ];
    assert.equal(validateTrustEscalation(steps).ok, true);
  });

  it("fails: Forge with trust_touch and no preceding Sentinel (AC-P1-05)", () => {
    const steps: PlanStep[] = [
      makeStep({
        step_id: VALID_UUID_2,
        sequence: 1,
        agent: "Forge",
        trust_touch: true,
        trust_touch_domains: ["IDENTITY"],
      }),
    ];
    const result = validateTrustEscalation(steps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_TRUST_ESCALATION");
  });

  it("fails: Sentinel covers AUDIT_LOGS but Forge touches IDENTITY", () => {
    const steps: PlanStep[] = [
      makeStep({
        step_id: VALID_UUID_2,
        sequence: 1,
        agent: "Sentinel",
        trust_touch: true,
        trust_touch_domains: ["AUDIT_LOGS"],
      }),
      makeStep({
        step_id: VALID_UUID_3,
        sequence: 2,
        agent: "Forge",
        trust_touch: true,
        trust_touch_domains: ["IDENTITY"],
        depends_on: [VALID_UUID_2],
      }),
    ];
    const result = validateTrustEscalation(steps);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "SELFCHECK_TRUST_ESCALATION");
      assert.equal((result.detail as any).domain, "IDENTITY");
    }
  });

  it("passes: Forge without trust_touch is not checked", () => {
    const steps: PlanStep[] = [
      makeStep({
        step_id: VALID_UUID_2,
        sequence: 1,
        agent: "Forge",
        trust_touch: false,
        trust_touch_domains: [],
      }),
    ];
    assert.equal(validateTrustEscalation(steps).ok, true);
  });

  it("passes: Sentinel covers multiple domains before Forge", () => {
    const steps: PlanStep[] = [
      makeStep({
        step_id: VALID_UUID_2,
        sequence: 1,
        agent: "Sentinel",
        trust_touch: true,
        trust_touch_domains: ["IDENTITY", "AGREEMENTS"],
      }),
      makeStep({
        step_id: VALID_UUID_3,
        sequence: 2,
        agent: "Forge",
        trust_touch: true,
        trust_touch_domains: ["IDENTITY", "AGREEMENTS"],
        depends_on: [VALID_UUID_2],
      }),
    ];
    assert.equal(validateTrustEscalation(steps).ok, true);
  });
});

describe("validateMultiGovernance", () => {
  it("skips check for non-MULTI scope_tag", () => {
    assert.equal(validateMultiGovernance([], "KNOWLEDGE").ok, true);
  });

  it("fails: MULTI with final step not Compass", () => {
    const steps = [
      makeStep({ sequence: 1, agent: "Command" }),
    ];
    const result = validateMultiGovernance(steps, "MULTI");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_MULTI_TERMINATION");
  });

  it("fails: MULTI with Forge before any Sentinel", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: VALID_UUID_2, sequence: 1, agent: "Forge" }),
      makeStep({
        step_id: VALID_UUID_3,
        sequence: 2,
        agent: "Compass",
        depends_on: [VALID_UUID_2],
      }),
    ];
    const result = validateMultiGovernance(steps, "MULTI");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_MULTI_SENTINEL_REQUIRED");
  });

  it("passes: MULTI with Sentinel before Forge, final Compass", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: VALID_UUID_2, sequence: 1, agent: "Sentinel" }),
      makeStep({
        step_id: VALID_UUID_3,
        sequence: 2,
        agent: "Forge",
        depends_on: [VALID_UUID_2],
      }),
      makeStep({
        step_id: VALID_UUID_4,
        sequence: 3,
        agent: "Compass",
        depends_on: [VALID_UUID_3],
      }),
    ];
    assert.equal(validateMultiGovernance(steps, "MULTI").ok, true);
  });

  it("fails: MULTI with empty steps", () => {
    const result = validateMultiGovernance([], "MULTI");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_MULTI_NO_STEPS");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// runSelfCheck (full gate)
// ═══════════════════════════════════════════════════════════════════════════

describe("runSelfCheck", () => {
  it("passes for valid artifact with Atlas → Forge → Compass", () => {
    const artifact = makeArtifact();
    assert.equal(runSelfCheck(artifact).ok, true);
  });

  it("fails on sequence gap", () => {
    const artifact = makeArtifact({
      steps: [
        makeStep({ step_id: VALID_UUID_2, sequence: 1 }),
        makeStep({ step_id: VALID_UUID_3, sequence: 3, agent: "Compass", depends_on: [VALID_UUID_2] }),
      ],
    });
    const result = runSelfCheck(artifact);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_SEQUENCE_GAP");
  });

  it("fails on orphan step", () => {
    const artifact = makeArtifact({
      steps: [
        makeStep({ step_id: VALID_UUID_2, sequence: 1, agent: "Atlas" }),
        makeStep({ step_id: VALID_UUID_3, sequence: 2, agent: "Forge", depends_on: [] }),
        makeStep({ step_id: VALID_UUID_4, sequence: 3, agent: "Compass", depends_on: [VALID_UUID_3] }),
      ],
    });
    const result = runSelfCheck(artifact);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_ORPHAN_STEP");
  });

  it("fails on termination violation (plan ends on Forge)", () => {
    const artifact = makeArtifact({
      steps: [
        makeStep({ step_id: VALID_UUID_2, sequence: 1, agent: "Atlas" }),
        makeStep({ step_id: VALID_UUID_3, sequence: 2, agent: "Forge", depends_on: [VALID_UUID_2] }),
      ],
    });
    const result = runSelfCheck(artifact);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_TERMINATION_VIOLATION");
  });

  it("fails on trust escalation violation", () => {
    const artifact = makeArtifact({
      steps: [
        makeStep({
          step_id: VALID_UUID_2,
          sequence: 1,
          agent: "Forge",
          trust_touch: true,
          trust_touch_domains: ["IDENTITY"],
        }),
        makeStep({
          step_id: VALID_UUID_3,
          sequence: 2,
          agent: "Compass",
          depends_on: [VALID_UUID_2],
        }),
      ],
    });
    const result = runSelfCheck(artifact);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_TRUST_ESCALATION");
  });

  it("fails on MULTI governance violation", () => {
    const artifact = makeArtifact({
      scope_tag: "MULTI",
      steps: [
        makeStep({ step_id: VALID_UUID_2, sequence: 1, agent: "Forge" }),
        makeStep({ step_id: VALID_UUID_3, sequence: 2, agent: "Compass", depends_on: [VALID_UUID_2] }),
      ],
    });
    const result = runSelfCheck(artifact);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELFCHECK_MULTI_SENTINEL_REQUIRED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HASH COMPUTATION + VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

describe("canonicalize", () => {
  it("sorts keys alphabetically", () => {
    const result = canonicalize({ z: 1, a: 2, m: 3 });
    assert.equal(result, '{"a":2,"m":3,"z":1}');
  });

  it("sorts nested object keys", () => {
    const result = canonicalize({ b: { z: 1, a: 2 }, a: 1 });
    assert.equal(result, '{"a":1,"b":{"a":2,"z":1}}');
  });

  it("preserves array order", () => {
    const result = canonicalize({ arr: [3, 1, 2] });
    assert.equal(result, '{"arr":[3,1,2]}');
  });

  it("produces no whitespace", () => {
    const result = canonicalize({ hello: "world", nested: { key: "value" } });
    assert.ok(!result.includes(" "));
    assert.ok(!result.includes("\n"));
  });

  it("is deterministic — same input, same output", () => {
    const input = { b: 1, a: { d: 2, c: 3 } };
    const r1 = canonicalize(input);
    const r2 = canonicalize(input);
    assert.equal(r1, r2);
  });
});

describe("sha256", () => {
  it("produces known hash for empty string", () => {
    assert.equal(
      sha256(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it('produces known hash for "abc"', () => {
    assert.equal(
      sha256("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces 64-char hex string", () => {
    const hash = sha256("test");
    assert.equal(hash.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  });
});

describe("buildHashBody", () => {
  it("includes only frozen fields per §5.1", () => {
    const artifact = makeArtifact();
    const body = buildHashBody(artifact);

    // Included fields
    assert.ok("approved_by" in body);
    assert.ok("goal_id" in body);
    assert.ok("non_goals" in body);
    assert.ok("plan_id" in body);
    assert.ok("scope_tag" in body);
    assert.ok("steps" in body);
    assert.ok("trust_sensitive" in body);
    assert.ok("version" in body);

    // Excluded mutable fields
    assert.ok(!("status" in body));
    assert.ok(!("run_id" in body));
    assert.ok(!("executed_at" in body));
    assert.ok(!("archived_at" in body));
    assert.ok(!("plan_hash" in body));
    assert.ok(!("version_history" in body));
    assert.ok(!("sentinel_prereview" in body));
    assert.ok(!("submitted_at" in body));
    assert.ok(!("approved_at" in body));
    assert.ok(!("approval_acknowledgements" in body));
  });

  it("excludes step mutable fields (status, result_ref)", () => {
    const artifact = makeArtifact();
    const body = buildHashBody(artifact);
    const steps = body.steps as Record<string, unknown>[];

    for (const step of steps) {
      assert.ok(!("status" in step));
      assert.ok(!("result_ref" in step));
    }
  });
});

describe("computePlanHash", () => {
  it("returns 64-char lowercase hex (AC-P1-13)", () => {
    const hash = computePlanHash(makeArtifact());
    assert.equal(hash.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  });

  it("is deterministic — same artifact, same hash", () => {
    const artifact = makeArtifact();
    const h1 = computePlanHash(artifact);
    const h2 = computePlanHash(artifact);
    assert.equal(h1, h2);
  });

  it("changes when frozen field changes", () => {
    const a1 = makeArtifact();
    const a2 = makeArtifact({ version: 2 });
    assert.notEqual(computePlanHash(a1), computePlanHash(a2));
  });

  it("does NOT change when mutable execution field changes", () => {
    const a1 = makeArtifact();
    const a2 = makeArtifact({ status: "EXECUTING" as any, run_id: VALID_UUID_5 });
    assert.equal(computePlanHash(a1), computePlanHash(a2));
  });

  it("is key-order invariant", () => {
    const a1 = makeArtifact();
    // Create equivalent artifact with different property order
    const a2: PlanArtifact = {
      archived_at: a1.archived_at,
      approval_acknowledgements: a1.approval_acknowledgements,
      approved_at: a1.approved_at,
      approved_by: a1.approved_by,
      executed_at: a1.executed_at,
      goal_id: a1.goal_id,
      non_goals: a1.non_goals,
      plan_hash: a1.plan_hash,
      plan_id: a1.plan_id,
      run_id: a1.run_id,
      scope_tag: a1.scope_tag,
      sentinel_prereview: a1.sentinel_prereview,
      status: a1.status,
      steps: a1.steps,
      submitted_at: a1.submitted_at,
      trust_sensitive: a1.trust_sensitive,
      version: a1.version,
      version_history: a1.version_history,
    };
    assert.equal(computePlanHash(a1), computePlanHash(a2));
  });
});

describe("verifyPlanHash", () => {
  it("returns ok: false when plan_hash is null (AC-P1-13)", () => {
    const artifact = makeArtifact({ plan_hash: null });
    const result = verifyPlanHash(artifact);
    assert.equal(result.ok, false);
    assert.equal(result.stored, null);
    assert.equal(typeof result.computed, "string");
  });

  it("returns ok: true when hash matches (AC-P1-14)", () => {
    const artifact = makeArtifact();
    const hash = computePlanHash(artifact);
    artifact.plan_hash = hash;
    const result = verifyPlanHash(artifact);
    assert.equal(result.ok, true);
    assert.equal(result.computed, hash);
    assert.equal(result.stored, hash);
  });

  it("returns ok: false when hash does not match — tampered artifact (AC-P1-14)", () => {
    const artifact = makeArtifact();
    const hash = computePlanHash(artifact);
    artifact.plan_hash = hash;

    // Tamper with a frozen field
    (artifact as any).version = 99;

    const result = verifyPlanHash(artifact);
    assert.equal(result.ok, false);
    assert.notEqual(result.computed, result.stored);
  });

  it("detects step tampering post-hash", () => {
    const artifact = makeArtifact();
    const hash = computePlanHash(artifact);
    artifact.plan_hash = hash;

    // Tamper with a step label
    (artifact.steps[0] as any).label = "TAMPERED";

    const result = verifyPlanHash(artifact);
    assert.equal(result.ok, false);
  });

  it("ignores mutable field changes (status, run_id) for hash comparison", () => {
    const artifact = makeArtifact();
    const hash = computePlanHash(artifact);
    artifact.plan_hash = hash;

    // Change mutable fields — hash should still match
    artifact.status = "EXECUTING";
    artifact.run_id = VALID_UUID_5;
    artifact.executed_at = VALID_TS;

    const result = verifyPlanHash(artifact);
    assert.equal(result.ok, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IMMUTABILITY BOUNDARY (AC-P1-07 — at validator level)
// ═══════════════════════════════════════════════════════════════════════════

describe("immutability boundary enforcement", () => {
  it("validators do not mutate input goal payload", () => {
    const payload = makeGoalPayload();
    const frozen = JSON.stringify(payload);
    validateGoalPayload(payload);
    assert.equal(JSON.stringify(payload), frozen);
  });

  it("validators do not mutate input artifact", () => {
    const artifact = makeArtifact();
    const frozen = JSON.stringify(artifact);
    validatePlanArtifactSchema(artifact);
    runSelfCheck(artifact);
    assert.equal(JSON.stringify(artifact), frozen);
  });

  it("hash functions do not mutate input artifact", () => {
    const artifact = makeArtifact();
    const frozen = JSON.stringify(artifact);
    buildHashBody(artifact);
    computePlanHash(artifact);
    verifyPlanHash(artifact);
    assert.equal(JSON.stringify(artifact), frozen);
  });
});
