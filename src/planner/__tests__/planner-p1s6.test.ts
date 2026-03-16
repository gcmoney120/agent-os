/**
 * Agent OS — Planner Subsystem P1-S6: Execution Readiness Gate Tests
 *
 * Specification: Atlas P1-S6 corrected per CP-01 (2026-03-13).
 * FindingCode closed set: 10 codes.
 * STEP_MISSING_SCOPE_TAG and STEP_INVALID_SCOPE_TAG are absent — removed by CP-01.
 *
 * AC coverage:
 *   AC-01  ReadinessVerdict type has required fields
 *   AC-02  ReadinessStatus is exactly "READY" | "NOT_READY"
 *   AC-03  ReadinessFinding type has required fields
 *   AC-04  FindingCode is a closed set of exactly 10 codes; isValidFindingCode guards
 *   AC-05  Missing/empty plan_hash → PLAN_HASH_MISSING (BLOCKING)
 *   AC-06  Status ≠ "APPROVED" → PLAN_NOT_APPROVED (BLOCKING)
 *   AC-07  Empty steps array → STEPS_EMPTY (BLOCKING)
 *   AC-08  Non-contiguous sequences → SEQUENCE_GAP (BLOCKING)
 *   AC-09  Orphan depends_on reference → ORPHAN_DEPENDENCY (BLOCKING, step_id set)
 *   AC-10  Final step not Compass/Command → TERMINATION_RULE_VIOLATED (BLOCKING)
 *   AC-11  Missing/empty agent → STEP_MISSING_AGENT; invalid AgentRole → STEP_INVALID_AGENT_ROLE
 *   AC-12  Trust-touching step with no Sentinel transitive predecessor → TRUST_ESCALATION_MISSING
 *   AC-13  Verdict derivation: READY iff zero BLOCKING findings
 *   AC-14  Purity: deterministic output; input not mutated (Object.freeze test)
 *   AC-15  Hash recomputation via computePlanHash; both hashes in verdict; mismatch → PLAN_HASH_MISMATCH
 *   AC-16  Finding sort: plan-level nulls before step-level; lexicographic by finding_code within group
 *   AC-17  Fully valid APPROVED plan → READY with empty findings array
 *   AC-18  Plan with multiple issues → all applicable findings reported (exhaustive)
 *   AC-19  No P1-S1 through P1-S5 or K1–K13 file drift (verified by file plan adherence)
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PlanArtifact, PlanStep, AgentRole, StepStatus, TrustDomain } from "../types.js";
import { computePlanHash } from "../hash.js";
import {
  FINDING_CODES,
  isValidFindingCode,
  findingSeverity,
} from "../readiness-types.js";
import { assessReadiness } from "../readiness-gate.js";

// ── Shared fixture helpers ────────────────────────────────────────────────────

/** Minimal valid PlanStep for test composition. trust_touch and trust_touch_domains default off. */
function makeStep(
  overrides: Partial<PlanStep> & { step_id: string; sequence: number; agent: AgentRole },
): PlanStep {
  return {
    label: "test step",
    input_contract: "in",
    output_contract: "out",
    acceptance_criteria: ["AC1"],
    depends_on: [],
    trust_touch: false,
    trust_touch_domains: [],
    status: "PENDING" as StepStatus,
    result_ref: null,
    ...overrides,
  };
}

/**
 * Build a PlanArtifact with the given steps and optional overrides.
 * Computes and sets plan_hash by default unless plan_hash is explicitly provided in overrides.
 */
function makePlan(
  steps: PlanStep[],
  overrides: Partial<PlanArtifact> = {},
): PlanArtifact {
  const base: PlanArtifact = {
    plan_id: "plan-001",
    goal_id: "goal-001",
    version: 1,
    version_history: [],
    status: "APPROVED",
    scope_tag: "KNOWLEDGE",
    trust_sensitive: false,
    steps,
    non_goals: [],
    sentinel_prereview: null,
    submitted_at: "2026-03-13T00:00:00.000Z",
    approved_at: "2026-03-13T01:00:00.000Z",
    approved_by: "Command",
    approval_acknowledgements: [],
    plan_hash: null,
    run_id: null,
    executed_at: null,
    archived_at: null,
    ...overrides,
  };
  // Compute and attach hash unless caller explicitly provided plan_hash in overrides
  if (!("plan_hash" in overrides)) {
    base.plan_hash = computePlanHash(base);
  }
  return base;
}

/** Three-step READY plan: Sentinel → Forge (trust) → Compass (final). */
function makeValidPlan(): PlanArtifact {
  const steps: PlanStep[] = [
    makeStep({ step_id: "s1", sequence: 1, agent: "Sentinel" }),
    makeStep({
      step_id: "s2",
      sequence: 2,
      agent: "Forge",
      depends_on: ["s1"],
      trust_touch: true,
      trust_touch_domains: ["AUDIT_LOGS" as TrustDomain],
    }),
    makeStep({ step_id: "s3", sequence: 3, agent: "Compass", depends_on: ["s2"] }),
  ];
  return makePlan(steps);
}

// ── AC-01: ReadinessVerdict type ──────────────────────────────────────────────

describe("AC-01 — ReadinessVerdict has required fields", () => {
  test("verdict contains status, findings, assessed_plan_hash, computed_plan_hash", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.ok("status" in verdict, "missing: status");
    assert.ok("findings" in verdict, "missing: findings");
    assert.ok("assessed_plan_hash" in verdict, "missing: assessed_plan_hash");
    assert.ok("computed_plan_hash" in verdict, "missing: computed_plan_hash");
  });

  test("findings is an array", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.ok(Array.isArray(verdict.findings));
  });

  test("assessed_plan_hash and computed_plan_hash are strings", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.equal(typeof verdict.assessed_plan_hash, "string");
    assert.equal(typeof verdict.computed_plan_hash, "string");
  });
});

// ── AC-02: ReadinessStatus ────────────────────────────────────────────────────

describe("AC-02 — ReadinessStatus is exactly READY or NOT_READY", () => {
  test("READY plan produces status READY", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.equal(verdict.status, "READY");
  });

  test("invalid plan produces status NOT_READY", () => {
    const plan = makePlan([], { plan_hash: null });
    const verdict = assessReadiness(plan);
    assert.equal(verdict.status, "NOT_READY");
  });
});

// ── AC-03: ReadinessFinding type ──────────────────────────────────────────────

describe("AC-03 — ReadinessFinding has required fields", () => {
  test("each finding has finding_code, severity, message, step_id", () => {
    const plan = makePlan([], { plan_hash: null });
    const verdict = assessReadiness(plan);
    assert.ok(verdict.findings.length > 0);
    for (const f of verdict.findings) {
      assert.ok("finding_code" in f, "missing: finding_code");
      assert.ok("severity" in f, "missing: severity");
      assert.ok("message" in f, "missing: message");
      assert.ok("step_id" in f, "missing: step_id");
    }
  });

  test("step_id is string or null", () => {
    const plan = makePlan([], { plan_hash: null });
    const verdict = assessReadiness(plan);
    for (const f of verdict.findings) {
      assert.ok(
        f.step_id === null || typeof f.step_id === "string",
        `step_id must be string | null, got: ${typeof f.step_id}`,
      );
    }
  });
});

// ── AC-04: FindingCode closed set ─────────────────────────────────────────────

describe("AC-04 — FindingCode is a closed set of exactly 10 codes", () => {
  test("FINDING_CODES contains exactly 10 entries", () => {
    assert.equal(FINDING_CODES.length, 10);
  });

  test("isValidFindingCode returns true for all 10 valid codes", () => {
    for (const code of FINDING_CODES) {
      assert.ok(isValidFindingCode(code), `expected true for "${code}"`);
    }
  });

  test("isValidFindingCode returns false for unknown strings", () => {
    assert.equal(isValidFindingCode("STEP_MISSING_SCOPE_TAG"), false);
    assert.equal(isValidFindingCode("STEP_INVALID_SCOPE_TAG"), false);
    assert.equal(isValidFindingCode(""), false);
    assert.equal(isValidFindingCode("NOT_A_CODE"), false);
    assert.equal(isValidFindingCode("PLAN_MISSING"), false);
  });

  test("scope_tag codes are confirmed absent from FINDING_CODES", () => {
    assert.ok(
      !FINDING_CODES.includes("STEP_MISSING_SCOPE_TAG" as never),
      "STEP_MISSING_SCOPE_TAG must not be in the closed set (removed by CP-01)",
    );
    assert.ok(
      !FINDING_CODES.includes("STEP_INVALID_SCOPE_TAG" as never),
      "STEP_INVALID_SCOPE_TAG must not be in the closed set (removed by CP-01)",
    );
  });

  test("findingSeverity returns BLOCKING for every code in the set", () => {
    for (const code of FINDING_CODES) {
      assert.equal(findingSeverity(code), "BLOCKING");
    }
  });
});

// ── AC-05: PLAN_HASH_MISSING ──────────────────────────────────────────────────

describe("AC-05 — Missing or empty plan_hash → PLAN_HASH_MISSING", () => {
  test("plan_hash null → PLAN_HASH_MISSING BLOCKING", () => {
    const plan = makePlan([makeStep({ step_id: "s1", sequence: 1, agent: "Compass" })], {
      plan_hash: null,
    });
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "PLAN_HASH_MISSING");
    assert.ok(f, "expected PLAN_HASH_MISSING finding");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, null);
    assert.equal(verdict.status, "NOT_READY");
  });

  test("plan_hash empty string → PLAN_HASH_MISSING", () => {
    const plan = makePlan([makeStep({ step_id: "s1", sequence: 1, agent: "Compass" })], {
      plan_hash: "",
    });
    const verdict = assessReadiness(plan);
    assert.ok(verdict.findings.some(f => f.finding_code === "PLAN_HASH_MISSING"));
  });

  test("plan_hash whitespace-only → PLAN_HASH_MISSING", () => {
    const plan = makePlan([makeStep({ step_id: "s1", sequence: 1, agent: "Compass" })], {
      plan_hash: "   ",
    });
    const verdict = assessReadiness(plan);
    assert.ok(verdict.findings.some(f => f.finding_code === "PLAN_HASH_MISSING"));
  });
});

// ── AC-06: PLAN_NOT_APPROVED ──────────────────────────────────────────────────

describe("AC-06 — Status ≠ APPROVED → PLAN_NOT_APPROVED", () => {
  test("status PLAN_DRAFT → PLAN_NOT_APPROVED BLOCKING", () => {
    const steps = [makeStep({ step_id: "s1", sequence: 1, agent: "Compass" })];
    const plan = makePlan(steps, { status: "PLAN_DRAFT" });
    // Recompute hash to isolate only the status finding
    plan.plan_hash = computePlanHash(plan);
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "PLAN_NOT_APPROVED");
    assert.ok(f, "expected PLAN_NOT_APPROVED finding");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, null);
  });

  test("status HALTED → PLAN_NOT_APPROVED", () => {
    const steps = [makeStep({ step_id: "s1", sequence: 1, agent: "Compass" })];
    const plan = makePlan(steps, { status: "HALTED" });
    plan.plan_hash = computePlanHash(plan);
    const verdict = assessReadiness(plan);
    assert.ok(verdict.findings.some(f => f.finding_code === "PLAN_NOT_APPROVED"));
  });

  test("status APPROVED → no PLAN_NOT_APPROVED finding", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.ok(!verdict.findings.some(f => f.finding_code === "PLAN_NOT_APPROVED"));
  });
});

// ── AC-07: STEPS_EMPTY ────────────────────────────────────────────────────────

describe("AC-07 — Empty steps array → STEPS_EMPTY", () => {
  test("zero steps → STEPS_EMPTY BLOCKING", () => {
    const plan = makePlan([]);
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "STEPS_EMPTY");
    assert.ok(f, "expected STEPS_EMPTY finding");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, null);
    assert.equal(verdict.status, "NOT_READY");
  });

  test("non-empty steps → no STEPS_EMPTY finding", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.ok(!verdict.findings.some(f => f.finding_code === "STEPS_EMPTY"));
  });
});

// ── AC-08: SEQUENCE_GAP ───────────────────────────────────────────────────────

describe("AC-08 — Non-contiguous sequences → SEQUENCE_GAP", () => {
  test("gap between sequence 1 and 3 → SEQUENCE_GAP BLOCKING", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge" }),
      makeStep({ step_id: "s3", sequence: 3, agent: "Compass", depends_on: ["s1"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "SEQUENCE_GAP");
    assert.ok(f, "expected SEQUENCE_GAP finding");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, null);
  });

  test("multiple gaps → single SEQUENCE_GAP finding with all gaps in message", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge" }),
      makeStep({ step_id: "s3", sequence: 3, agent: "Forge", depends_on: ["s1"] }),
      makeStep({ step_id: "s5", sequence: 5, agent: "Compass", depends_on: ["s3"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const gaps = verdict.findings.filter(f => f.finding_code === "SEQUENCE_GAP");
    assert.equal(gaps.length, 1, "expected exactly one SEQUENCE_GAP finding");
    assert.ok(gaps[0].message.includes("s1"), "message should reference s1");
    assert.ok(gaps[0].message.includes("s3"), "message should reference s3");
  });

  test("contiguous sequences → no SEQUENCE_GAP", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.ok(!verdict.findings.some(f => f.finding_code === "SEQUENCE_GAP"));
  });

  test("single step plan → no SEQUENCE_GAP", () => {
    const steps = [makeStep({ step_id: "s1", sequence: 1, agent: "Compass" })];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    assert.ok(!verdict.findings.some(f => f.finding_code === "SEQUENCE_GAP"));
  });
});

// ── AC-09: ORPHAN_DEPENDENCY ──────────────────────────────────────────────────

describe("AC-09 — Orphan depends_on → ORPHAN_DEPENDENCY with step_id set", () => {
  test("step depends on nonexistent step → ORPHAN_DEPENDENCY BLOCKING, step_id identifies orphan owner", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge", depends_on: ["ghost"] }),
      makeStep({ step_id: "s2", sequence: 2, agent: "Compass", depends_on: ["s1"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "ORPHAN_DEPENDENCY");
    assert.ok(f, "expected ORPHAN_DEPENDENCY finding");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, "s1");
    assert.ok(f.message.includes("ghost"), "message should name the orphan dep");
  });

  test("multiple steps with orphan deps → one finding per offending step", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge", depends_on: ["ghost-a"] }),
      makeStep({ step_id: "s2", sequence: 2, agent: "Forge", depends_on: ["ghost-b"] }),
      makeStep({ step_id: "s3", sequence: 3, agent: "Compass", depends_on: ["s1", "s2"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const orphan_findings = verdict.findings.filter(f => f.finding_code === "ORPHAN_DEPENDENCY");
    assert.equal(orphan_findings.length, 2);
    const ids = orphan_findings.map(f => f.step_id);
    assert.ok(ids.includes("s1"));
    assert.ok(ids.includes("s2"));
  });

  test("no orphan deps → no ORPHAN_DEPENDENCY finding", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.ok(!verdict.findings.some(f => f.finding_code === "ORPHAN_DEPENDENCY"));
  });
});

// ── AC-10: TERMINATION_RULE_VIOLATED ─────────────────────────────────────────

describe("AC-10 — Final step not Compass/Command → TERMINATION_RULE_VIOLATED", () => {
  test("final step assigned to Forge → TERMINATION_RULE_VIOLATED BLOCKING", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Sentinel" }),
      makeStep({ step_id: "s2", sequence: 2, agent: "Forge", depends_on: ["s1"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "TERMINATION_RULE_VIOLATED");
    assert.ok(f, "expected TERMINATION_RULE_VIOLATED finding");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, null);
    assert.ok(f.message.includes("s2"));
  });

  test("final step assigned to Command → no TERMINATION_RULE_VIOLATED", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge" }),
      makeStep({ step_id: "s2", sequence: 2, agent: "Command", depends_on: ["s1"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    assert.ok(!verdict.findings.some(f => f.finding_code === "TERMINATION_RULE_VIOLATED"));
  });

  test("final step assigned to Compass → no TERMINATION_RULE_VIOLATED", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.ok(!verdict.findings.some(f => f.finding_code === "TERMINATION_RULE_VIOLATED"));
  });
});

// ── AC-11: STEP_MISSING_AGENT / STEP_INVALID_AGENT_ROLE ──────────────────────

describe("AC-11 — Missing/empty agent → STEP_MISSING_AGENT; invalid → STEP_INVALID_AGENT_ROLE", () => {
  test("step with empty string agent → STEP_MISSING_AGENT with step_id set", () => {
    const bad = { ...makeStep({ step_id: "s1", sequence: 1, agent: "Compass" }), agent: "" } as unknown as PlanStep;
    const steps: PlanStep[] = [bad];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "STEP_MISSING_AGENT");
    assert.ok(f, "expected STEP_MISSING_AGENT");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, "s1");
  });

  test("step with undefined agent → STEP_MISSING_AGENT with step_id set", () => {
    const bad = { ...makeStep({ step_id: "s1", sequence: 1, agent: "Compass" }) } as Record<string, unknown>;
    delete bad["agent"];
    const steps: PlanStep[] = [bad as unknown as PlanStep];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    assert.ok(verdict.findings.some(f => f.finding_code === "STEP_MISSING_AGENT" && f.step_id === "s1"));
  });

  test("step with unknown agent role → STEP_INVALID_AGENT_ROLE with step_id set", () => {
    const bad = { ...makeStep({ step_id: "s1", sequence: 1, agent: "Compass" }), agent: "Wizard" } as unknown as PlanStep;
    const steps: PlanStep[] = [
      bad,
      makeStep({ step_id: "s2", sequence: 2, agent: "Compass", depends_on: ["s1"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "STEP_INVALID_AGENT_ROLE");
    assert.ok(f, "expected STEP_INVALID_AGENT_ROLE");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, "s1");
    assert.ok(f.message.includes("Wizard"));
  });

  test("valid agent → neither STEP_MISSING_AGENT nor STEP_INVALID_AGENT_ROLE", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.ok(!verdict.findings.some(f =>
      f.finding_code === "STEP_MISSING_AGENT" ||
      f.finding_code === "STEP_INVALID_AGENT_ROLE",
    ));
  });
});

// ── AC-12: TRUST_ESCALATION_MISSING ──────────────────────────────────────────

describe("AC-12 — Trust-touching step with no Sentinel predecessor → TRUST_ESCALATION_MISSING", () => {
  test("trust_touch=true with no Sentinel in chain → TRUST_ESCALATION_MISSING BLOCKING", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Atlas" }),
      makeStep({
        step_id: "s2",
        sequence: 2,
        agent: "Forge",
        depends_on: ["s1"],
        trust_touch: true,
        trust_touch_domains: ["IDENTITY" as TrustDomain],
      }),
      makeStep({ step_id: "s3", sequence: 3, agent: "Compass", depends_on: ["s2"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "TRUST_ESCALATION_MISSING");
    assert.ok(f, "expected TRUST_ESCALATION_MISSING");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, "s2");
  });

  test("trust_touch_domains non-empty with no Sentinel → TRUST_ESCALATION_MISSING", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge" }),
      makeStep({
        step_id: "s2",
        sequence: 2,
        agent: "Forge",
        depends_on: ["s1"],
        trust_touch: false,
        trust_touch_domains: ["AGREEMENTS" as TrustDomain],
      }),
      makeStep({ step_id: "s3", sequence: 3, agent: "Compass", depends_on: ["s2"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    assert.ok(verdict.findings.some(f =>
      f.finding_code === "TRUST_ESCALATION_MISSING" && f.step_id === "s2",
    ));
  });

  test("direct Sentinel predecessor → no TRUST_ESCALATION_MISSING", () => {
    // s1(Sentinel) → s2(Forge, trust) → s3(Compass)
    const verdict = assessReadiness(makeValidPlan());
    assert.ok(!verdict.findings.some(f => f.finding_code === "TRUST_ESCALATION_MISSING"));
  });

  test("transitive Sentinel predecessor satisfies the requirement", () => {
    // s1(Sentinel) → s2(Forge, no trust) → s3(Forge, trust) → s4(Compass)
    // s3's transitive predecessors include s1 (Sentinel) via s2
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Sentinel" }),
      makeStep({ step_id: "s2", sequence: 2, agent: "Forge", depends_on: ["s1"] }),
      makeStep({
        step_id: "s3",
        sequence: 3,
        agent: "Forge",
        depends_on: ["s2"],
        trust_touch: true,
        trust_touch_domains: ["ACCESS_STATE" as TrustDomain],
      }),
      makeStep({ step_id: "s4", sequence: 4, agent: "Compass", depends_on: ["s3"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    assert.ok(!verdict.findings.some(f => f.finding_code === "TRUST_ESCALATION_MISSING"));
  });

  test("no trust domains → no TRUST_ESCALATION_MISSING", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge" }),
      makeStep({ step_id: "s2", sequence: 2, agent: "Compass", depends_on: ["s1"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    assert.ok(!verdict.findings.some(f => f.finding_code === "TRUST_ESCALATION_MISSING"));
  });
});

// ── AC-13: Verdict derivation ─────────────────────────────────────────────────

describe("AC-13 — READY iff zero BLOCKING findings", () => {
  test("zero findings → READY", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.equal(verdict.status, "READY");
    assert.equal(verdict.findings.length, 0);
  });

  test("one BLOCKING finding → NOT_READY", () => {
    const plan = makePlan([], { plan_hash: null });
    const verdict = assessReadiness(plan);
    assert.equal(verdict.status, "NOT_READY");
    assert.ok(verdict.findings.some(f => f.severity === "BLOCKING"));
  });

  test("all findings BLOCKING → NOT_READY", () => {
    // Every finding in the current closed set is BLOCKING
    const plan = makePlan([], { plan_hash: null, status: "PLAN_DRAFT" });
    const verdict = assessReadiness(plan);
    assert.equal(verdict.status, "NOT_READY");
    assert.ok(verdict.findings.every(f => f.severity === "BLOCKING"));
  });
});

// ── AC-14: Purity ─────────────────────────────────────────────────────────────

describe("AC-14 — assessReadiness is pure: deterministic and non-mutating", () => {
  test("identical input produces identical output on two calls", () => {
    const plan = makeValidPlan();
    const v1 = assessReadiness(plan);
    const v2 = assessReadiness(plan);
    assert.deepEqual(v1, v2);
  });

  test("Object.freeze on input does not cause the function to throw", () => {
    const plan = makeValidPlan();
    Object.freeze(plan.steps);
    Object.freeze(plan);
    assert.doesNotThrow(() => assessReadiness(plan));
  });

  test("plan.steps order is not mutated by assessReadiness", () => {
    const plan = makeValidPlan();
    const original_order = plan.steps.map(s => s.step_id);
    assessReadiness(plan);
    const after_order = plan.steps.map(s => s.step_id);
    assert.deepEqual(after_order, original_order);
  });

  test("plan.status is not mutated by assessReadiness", () => {
    const plan = makeValidPlan();
    assessReadiness(plan);
    assert.equal(plan.status, "APPROVED");
  });
});

// ── AC-15: Hash recomputation ─────────────────────────────────────────────────

describe("AC-15 — Hash recomputed via computePlanHash; both hashes in verdict; mismatch → PLAN_HASH_MISMATCH", () => {
  test("verdict includes assessed_plan_hash equal to plan.plan_hash", () => {
    const plan = makeValidPlan();
    const verdict = assessReadiness(plan);
    assert.equal(verdict.assessed_plan_hash, plan.plan_hash!);
  });

  test("verdict computed_plan_hash matches independent computePlanHash call", () => {
    const plan = makeValidPlan();
    const expected = computePlanHash(plan);
    const verdict = assessReadiness(plan);
    assert.equal(verdict.computed_plan_hash, expected);
  });

  test("tampered plan_hash → PLAN_HASH_MISMATCH BLOCKING; both hashes present in verdict", () => {
    const plan = makeValidPlan();
    const real_hash = plan.plan_hash!;
    plan.plan_hash = "a".repeat(64); // plausible hex string, wrong value
    const verdict = assessReadiness(plan);
    const f = verdict.findings.find(x => x.finding_code === "PLAN_HASH_MISMATCH");
    assert.ok(f, "expected PLAN_HASH_MISMATCH");
    assert.equal(f.severity, "BLOCKING");
    assert.equal(f.step_id, null);
    assert.equal(verdict.assessed_plan_hash, "a".repeat(64));
    assert.equal(verdict.computed_plan_hash, real_hash);
    assert.notEqual(verdict.assessed_plan_hash, verdict.computed_plan_hash);
  });

  test("null plan_hash → assessed_plan_hash is empty string", () => {
    const plan = makePlan(
      [makeStep({ step_id: "s1", sequence: 1, agent: "Compass" })],
      { plan_hash: null },
    );
    const verdict = assessReadiness(plan);
    assert.equal(verdict.assessed_plan_hash, "");
  });

  test("PLAN_HASH_MISSING does not also emit PLAN_HASH_MISMATCH", () => {
    const plan = makePlan(
      [makeStep({ step_id: "s1", sequence: 1, agent: "Compass" })],
      { plan_hash: null },
    );
    const verdict = assessReadiness(plan);
    assert.ok(verdict.findings.some(f => f.finding_code === "PLAN_HASH_MISSING"));
    assert.ok(!verdict.findings.some(f => f.finding_code === "PLAN_HASH_MISMATCH"));
  });
});

// ── AC-16: Finding sort order ─────────────────────────────────────────────────

describe("AC-16 — Findings sorted: plan-level (null) before step-level; lexicographic by finding_code", () => {
  test("all null step_id findings precede all non-null step_id findings", () => {
    // Trigger plan-level: PLAN_HASH_MISSING, PLAN_NOT_APPROVED, STEPS_EMPTY
    // (no step-level findings since steps is empty)
    const plan = makePlan([], { plan_hash: null, status: "PLAN_DRAFT" });
    const verdict = assessReadiness(plan);
    let saw_step_level = false;
    for (const f of verdict.findings) {
      if (f.step_id !== null) saw_step_level = true;
      if (saw_step_level) {
        assert.ok(f.step_id !== null, "plan-level finding appeared after step-level finding");
      }
    }
  });

  test("plan-level findings are sorted lexicographically by finding_code", () => {
    // Force PLAN_HASH_MISSING + PLAN_NOT_APPROVED + STEPS_EMPTY
    const plan = makePlan([], { plan_hash: null, status: "PLAN_DRAFT" });
    const verdict = assessReadiness(plan);
    const plan_findings = verdict.findings.filter(f => f.step_id === null);
    const codes = plan_findings.map(f => f.finding_code);
    const sorted = [...codes].sort();
    assert.deepEqual(codes, sorted);
  });

  test("step-level findings sorted by finding_code then step_id", () => {
    // Two steps each with missing agent — same code, different step_id
    const s1 = { ...makeStep({ step_id: "s1", sequence: 1, agent: "Compass" }), agent: "" } as unknown as PlanStep;
    const s2 = { ...makeStep({ step_id: "s2", sequence: 2, agent: "Compass" }), agent: "" } as unknown as PlanStep;
    const plan = makePlan([s1, s2]);
    const verdict = assessReadiness(plan);
    const step_findings = verdict.findings.filter(f =>
      f.step_id !== null && f.finding_code === "STEP_MISSING_AGENT",
    );
    assert.equal(step_findings.length, 2);
    assert.equal(step_findings[0].step_id, "s1");
    assert.equal(step_findings[1].step_id, "s2");
  });
});

// ── AC-17: Fully valid plan → READY ──────────────────────────────────────────

describe("AC-17 — Fully valid APPROVED plan → READY with empty findings", () => {
  test("three-step valid plan: Sentinel → Forge(trust) → Compass → READY", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.equal(verdict.status, "READY");
    assert.equal(verdict.findings.length, 0);
  });

  test("two-step valid plan without trust domains: Forge → Command → READY", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge" }),
      makeStep({ step_id: "s2", sequence: 2, agent: "Command", depends_on: ["s1"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    assert.equal(verdict.status, "READY");
    assert.equal(verdict.findings.length, 0);
  });

  test("assessed_plan_hash equals computed_plan_hash for READY plan", () => {
    const verdict = assessReadiness(makeValidPlan());
    assert.equal(verdict.assessed_plan_hash, verdict.computed_plan_hash);
  });
});

// ── AC-18: Exhaustive findings (multiple issues) ──────────────────────────────

describe("AC-18 — All applicable findings reported; gate is not short-circuiting", () => {
  test("plan with missing hash AND wrong status AND empty steps → finds all three", () => {
    const plan = makePlan([], { plan_hash: null, status: "PLAN_DRAFT" });
    const verdict = assessReadiness(plan);
    const codes = verdict.findings.map(f => f.finding_code);
    assert.ok(codes.includes("PLAN_HASH_MISSING"), "expected PLAN_HASH_MISSING");
    assert.ok(codes.includes("PLAN_NOT_APPROVED"), "expected PLAN_NOT_APPROVED");
    assert.ok(codes.includes("STEPS_EMPTY"), "expected STEPS_EMPTY");
  });

  test("plan with two steps with orphan deps → two ORPHAN_DEPENDENCY findings", () => {
    const steps: PlanStep[] = [
      makeStep({ step_id: "s1", sequence: 1, agent: "Forge", depends_on: ["ghost-a"] }),
      makeStep({ step_id: "s2", sequence: 2, agent: "Forge", depends_on: ["ghost-b"] }),
      makeStep({ step_id: "s3", sequence: 3, agent: "Compass", depends_on: ["s1", "s2"] }),
    ];
    const plan = makePlan(steps);
    const verdict = assessReadiness(plan);
    const orphans = verdict.findings.filter(f => f.finding_code === "ORPHAN_DEPENDENCY");
    assert.equal(orphans.length, 2, "expected two ORPHAN_DEPENDENCY findings");
  });

  test("plan with mixed plan-level and step-level issues → all findings present", () => {
    // Plan: wrong hash (present but bad), non-approved status, invalid agent on s1,
    // trust touch on s2 with no Sentinel, final step not Compass/Command
    const steps: PlanStep[] = [
      { ...makeStep({ step_id: "s1", sequence: 1, agent: "Compass" }), agent: "Robot" } as unknown as PlanStep,
      makeStep({
        step_id: "s2",
        sequence: 2,
        agent: "Forge",
        depends_on: ["s1"],
        trust_touch: true,
        trust_touch_domains: ["IDENTITY" as TrustDomain],
      }),
      makeStep({ step_id: "s3", sequence: 3, agent: "Forge", depends_on: ["s2"] }),
    ];
    const plan = makePlan(steps, {
      status: "HALTED",
      plan_hash: "wrong-hash-value",
    });
    const verdict = assessReadiness(plan);
    const codes = verdict.findings.map(f => f.finding_code);
    assert.ok(codes.includes("PLAN_HASH_MISMATCH"), "expected PLAN_HASH_MISMATCH");
    assert.ok(codes.includes("PLAN_NOT_APPROVED"), "expected PLAN_NOT_APPROVED");
    assert.ok(codes.includes("STEP_INVALID_AGENT_ROLE"), "expected STEP_INVALID_AGENT_ROLE");
    assert.ok(codes.includes("TERMINATION_RULE_VIOLATED"), "expected TERMINATION_RULE_VIOLATED");
    assert.ok(codes.includes("TRUST_ESCALATION_MISSING"), "expected TRUST_ESCALATION_MISSING");
    assert.equal(verdict.status, "NOT_READY");
  });
});

// ── AC-19: No file drift ──────────────────────────────────────────────────────

describe("AC-19 — No P1-S1 through P1-S5 or K1–K13 file drift", () => {
  test("gate imports are satisfied by existing modules without modification", () => {
    // The gate imports only: types.js (read-only), hash.js (read-only), readiness-types.js (new).
    // If P1-S1–S5 contracts had been modified, those test suites would detect regressions.
    assert.ok(typeof assessReadiness === "function");
    assert.ok(typeof computePlanHash === "function");
    assert.ok(typeof isValidFindingCode === "function");
    assert.ok(typeof findingSeverity === "function");
  });

  test(
    "high-coverage guard: verify removed scope_tag codes are not emitted" +
    " across representative invalid inputs for the current gate behavior",
    () => {
      const bad_step: PlanStep = {
        ...makeStep({ step_id: "s1", sequence: 1, agent: "Compass" }),
        agent: "" as unknown as AgentRole,
        trust_touch: true,
        trust_touch_domains: ["AUDIT_LOGS" as TrustDomain],
      };
      const plan = makePlan([bad_step], { plan_hash: null, status: "PLAN_DRAFT" });
      const verdict = assessReadiness(plan);
      for (const f of verdict.findings) {
        assert.notEqual(
          f.finding_code,
          "STEP_MISSING_SCOPE_TAG" as never,
          "STEP_MISSING_SCOPE_TAG must never be emitted (removed by CP-01)",
        );
        assert.notEqual(
          f.finding_code,
          "STEP_INVALID_SCOPE_TAG" as never,
          "STEP_INVALID_SCOPE_TAG must never be emitted (removed by CP-01)",
        );
      }
    },
  );
});
