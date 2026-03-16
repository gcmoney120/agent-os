/**
 * Agent OS — Planner Subsystem P1-S7: Readiness Gate Integration Tests
 *
 * Acceptance criteria coverage:
 *
 * AC-01: assessForExecution calls P1-S6 assessReadiness and returns ReadinessVerdict.
 * AC-02: Run creation requires a ReadinessVerdict parameter (compile-time + runtime).
 * AC-03: NOT_READY verdict → ReadinessRejection{reason:"NOT_READY"}; no ledger write.
 * AC-04: Successful run creation → ledger entry has readiness_verdict field.
 * AC-05: readiness_verdict on ledger entry is frozen (TypeError on mutation attempt).
 * AC-06: ReadinessRejection shape: rejected:true, reason:ReadinessRejectionReason, verdict.
 * AC-07: PLAN_HASH_STALE rejection when assessed_plan_hash !== plan.plan_hash; no ledger write.
 * AC-08: Verdict is a snapshot — mutating original after creation does not affect stored.
 * AC-09: No bypass — NOT_READY and stale-hash both reject without ledger write.
 * AC-10: ReadinessRejectionReason is a closed set of exactly "NOT_READY" | "PLAN_HASH_STALE".
 * AC-11: RunCreationResult is a discriminated union with created:true and rejected:true branches.
 * AC-12: All existing P1-S3 tests pass without modification (confirmed by full suite run).
 * AC-13: No P1-S6, P1-S2, P1-S4, P1-S5, or K1–K13 files modified (confirmed by file diff).
 * AC-14: Full agent-os test suite passes with zero failures (confirmed by full suite run).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── P1-S7: new types from execution-types.ts ────────────────────────────────

import type {
  RunCreationResult,
  ReadinessRejection,
} from "../execution-types.js";

import { READINESS_REJECTION_REASONS } from "../execution-types.js";

// ── P1-S7: new functions from execution.ts ──────────────────────────────────

import {
  assessForExecution,
  initiateRunWithReadiness,
} from "../execution.js";

// ── P1-S6: types consumed read-only ─────────────────────────────────────────

import type { ReadinessVerdict } from "../readiness-types.js";
import { assessReadiness } from "../readiness-gate.js";

// ── P1-S3: ledger primitives (consumed read-only for test assertions) ────────

import {
  createEmptyLedgerStore,
  getLedger,
} from "../run-ledger.js";

// ── P1-S1: plan types ────────────────────────────────────────────────────────

import type { PlanArtifact, PlanStep, AgentRole, StepStatus, TrustDomain } from "../types.js";
import { computePlanHash } from "../hash.js";

// ── Test Constants ───────────────────────────────────────────────────────────

const NOW = "2026-03-14T10:00:00.000Z";
// Valid ULID: 26 chars from Crockford Base32 (0-9, A-H, J, K, M, N, P-T, V-Z — no I/L/O/U)
const VALID_RUN_ID = "run_0000000000P1S7TEST000000AA";
const VALID_RUN_ID_2 = "run_0000000000P1S7TEST000000AB";
const FOREMAN_VERSION = "foreman-1.0.0";
const REQUESTED_BY = "Command";

// ── Fixture Builders ─────────────────────────────────────────────────────────

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
 * Computes and sets plan_hash (matching what assessReadiness will compute)
 * unless plan_hash is explicitly provided in overrides.
 */
function makePlan(
  steps: PlanStep[],
  overrides: Partial<PlanArtifact> = {},
): PlanArtifact {
  const base: PlanArtifact = {
    plan_id: "plan-p1s7-001",
    goal_id: "goal-p1s7-001",
    version: 1,
    version_history: [],
    status: "APPROVED",
    scope_tag: "KNOWLEDGE",
    trust_sensitive: false,
    steps,
    non_goals: [],
    sentinel_prereview: null,
    submitted_at: NOW,
    approved_at: NOW,
    approved_by: "Command",
    approval_acknowledgements: [],
    plan_hash: null,
    run_id: null,
    executed_at: null,
    archived_at: null,
    ...overrides,
  };
  if (!("plan_hash" in overrides)) {
    base.plan_hash = computePlanHash(base);
  }
  return base;
}

/**
 * Three-step READY plan: Sentinel → Forge (trust-touch) → Compass (final).
 * Passes all P1-S6 readiness checks.
 */
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

/**
 * Build a READY ReadinessVerdict for a given plan using the real P1-S6 gate.
 */
function readyVerdictFor(plan: PlanArtifact): ReadinessVerdict {
  const verdict = assessReadiness(plan);
  assert.equal(verdict.status, "READY", `Expected READY plan but got NOT_READY: ${JSON.stringify(verdict.findings)}`);
  return verdict;
}

/**
 * Build a NOT_READY ReadinessVerdict directly.
 * Simulates assessment of a plan that fails a readiness check.
 */
function notReadyVerdict(assessedHash: string): ReadinessVerdict {
  return {
    status: "NOT_READY",
    findings: [
      {
        finding_code: "PLAN_NOT_APPROVED",
        severity: "BLOCKING",
        message: "Plan is not in APPROVED state",
        step_id: null,
      },
    ],
    assessed_plan_hash: assessedHash,
    computed_plan_hash: assessedHash,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-01: assessForExecution calls P1-S6 assessReadiness and returns verdict
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-01: assessForExecution calls assessReadiness and returns ReadinessVerdict", () => {
  it("returns a ReadinessVerdict with required fields for a READY plan", () => {
    const plan = makeValidPlan();

    const verdict = assessForExecution(plan);

    assert.ok(typeof verdict === "object" && verdict !== null);
    assert.ok("status" in verdict);
    assert.ok("findings" in verdict);
    assert.ok("assessed_plan_hash" in verdict);
    assert.ok("computed_plan_hash" in verdict);
    assert.equal(verdict.status, "READY");
    assert.equal(Array.isArray(verdict.findings), true);
    assert.equal(verdict.findings.length, 0);
  });

  it("assessForExecution and assessReadiness return identical results for the same plan", () => {
    const plan = makeValidPlan();

    const direct = assessReadiness(plan);
    const viaAssessForExecution = assessForExecution(plan);

    assert.deepEqual(viaAssessForExecution, direct);
  });

  it("assessForExecution carries the plan_hash in assessed_plan_hash", () => {
    const plan = makeValidPlan();

    const verdict = assessForExecution(plan);

    assert.equal(verdict.assessed_plan_hash, plan.plan_hash ?? "");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-02: Run creation requires a ReadinessVerdict parameter
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-02: initiateRunWithReadiness requires a ReadinessVerdict parameter", () => {
  it("function arity matches the expected seven-parameter integration signature", () => {
    // Structural signal: arity confirms the full governed creation signature.
    // 7 required parameters: plan, verdict, store, runId, foremanVersion, timestamp, requestedBy.
    assert.equal(initiateRunWithReadiness.length, 7);
  });

  it("calling with a valid READY verdict succeeds (verdict is a required input)", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal((result as { created: boolean }).created, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-03: NOT_READY verdict → ReadinessRejection; no run_id generated; no ledger write
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-03: NOT_READY verdict → rejection with reason NOT_READY; no ledger write", () => {
  it("returns ReadinessRejection with reason NOT_READY when verdict is NOT_READY", () => {
    const plan = makeValidPlan();
    const verdict = notReadyVerdict(plan.plan_hash ?? "");
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal((result as ReadinessRejection).rejected, true);
    assert.equal((result as ReadinessRejection).reason, "NOT_READY");
    assert.ok("verdict" in result);
  });

  it("no run_id is generated on NOT_READY rejection", () => {
    const plan = makeValidPlan();
    const verdict = notReadyVerdict(plan.plan_hash ?? "");
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal("created" in result, false);
    assert.equal("run_id" in result, false);
    assert.equal("ledger_entry" in result, false);
  });

  it("no ledger entry is written on NOT_READY rejection", () => {
    const plan = makeValidPlan();
    const verdict = notReadyVerdict(plan.plan_hash ?? "");
    const store = createEmptyLedgerStore();

    initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal(getLedger(store, VALID_RUN_ID), undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-04: Successful run creation → ledger entry has readiness_verdict field
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-04: Successful run creation produces ledger entry with readiness_verdict", () => {
  it("ledger_entry in result has readiness_verdict field", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as { created: true; run_id: string; ledger_entry: ReturnType<typeof getLedger> };

    assert.equal(result.created, true);
    assert.ok(result.ledger_entry);
    assert.ok("readiness_verdict" in result.ledger_entry!);
  });

  it("readiness_verdict on ledger entry matches the supplied verdict", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as { created: true; run_id: string; ledger_entry: { readiness_verdict: ReadinessVerdict } };

    const stored = result.ledger_entry.readiness_verdict;
    assert.equal(stored.status, verdict.status);
    assert.equal(stored.assessed_plan_hash, verdict.assessed_plan_hash);
    assert.equal(stored.computed_plan_hash, verdict.computed_plan_hash);
    assert.deepEqual(stored.findings, verdict.findings);
  });

  it("result run_id matches the supplied runId", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as { created: true; run_id: string };

    assert.equal(result.run_id, VALID_RUN_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-05: readiness_verdict on ledger entry is frozen
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-05: readiness_verdict on ledger entry is frozen (TypeError on mutation)", () => {
  it("attempting to mutate readiness_verdict.status throws in strict mode", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as { created: true; run_id: string; ledger_entry: { readiness_verdict: ReadinessVerdict } };

    const storedVerdict = result.ledger_entry.readiness_verdict;

    assert.throws(() => {
      // @ts-expect-error intentional mutation attempt for freeze test
      (storedVerdict as Record<string, unknown>).status = "NOT_READY";
    }, TypeError);
  });

  it("attempting to mutate readiness_verdict.findings throws in strict mode", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as unknown as { created: true; run_id: string; ledger_entry: { readiness_verdict: { findings: unknown[] } } };

    const storedVerdict = result.ledger_entry.readiness_verdict;

    assert.throws(() => {
      (storedVerdict as unknown as Record<string, unknown>).findings = [];
    }, TypeError);
  });

  it("attempting to push to frozen findings array throws in strict mode", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as { created: true; run_id: string; ledger_entry: { readiness_verdict: ReadinessVerdict } };

    const findings = result.ledger_entry.readiness_verdict.findings as unknown as unknown[];

    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (findings as any).push({ finding_code: "STEPS_EMPTY" });
    }, TypeError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-06: ReadinessRejection shape
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-06: ReadinessRejection has correct shape: rejected, reason, verdict", () => {
  it("NOT_READY rejection has rejected:true, reason:NOT_READY, and verdict fields", () => {
    const plan = makeValidPlan();
    const verdict = notReadyVerdict(plan.plan_hash ?? "");
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as ReadinessRejection;

    assert.equal(result.rejected, true);
    assert.equal(typeof result.reason, "string");
    assert.ok("verdict" in result);
    assert.equal(result.verdict.status, "NOT_READY");
  });

  it("PLAN_HASH_STALE rejection has rejected:true, reason:PLAN_HASH_STALE, and verdict fields", () => {
    const plan = makeValidPlan();
    const staleVerdict: ReadinessVerdict = {
      status: "READY",
      findings: [],
      assessed_plan_hash: "stale-hash-that-does-not-match",
      computed_plan_hash: "stale-hash-that-does-not-match",
    };
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, staleVerdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as ReadinessRejection;

    assert.equal(result.rejected, true);
    assert.equal(result.reason, "PLAN_HASH_STALE");
    assert.ok("verdict" in result);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-07: PLAN_HASH_STALE rejection when assessed_plan_hash !== plan.plan_hash
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-07: PLAN_HASH_STALE rejection when hash mismatch; no ledger write", () => {
  it("returns PLAN_HASH_STALE when verdict was assessed against a different plan version", () => {
    const plan = makeValidPlan();
    const staleVerdict: ReadinessVerdict = {
      status: "READY",
      findings: [],
      assessed_plan_hash: "000000000000000000000000000000000000000000000000000000000000dead",
      computed_plan_hash: "000000000000000000000000000000000000000000000000000000000000dead",
    };
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, staleVerdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal((result as ReadinessRejection).rejected, true);
    assert.equal((result as ReadinessRejection).reason, "PLAN_HASH_STALE");
  });

  it("no run_id or ledger entry on PLAN_HASH_STALE rejection", () => {
    const plan = makeValidPlan();
    const staleVerdict: ReadinessVerdict = {
      status: "READY",
      findings: [],
      assessed_plan_hash: "stale",
      computed_plan_hash: "stale",
    };
    const store = createEmptyLedgerStore();

    initiateRunWithReadiness(
      plan, staleVerdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal(getLedger(store, VALID_RUN_ID), undefined);
  });

  it("PLAN_HASH_STALE check occurs before ledger creation even on READY verdict", () => {
    const plan = makeValidPlan();
    const staleReadyVerdict: ReadinessVerdict = {
      status: "READY",
      findings: [],
      assessed_plan_hash: "this-hash-does-not-match-the-current-plan",
      computed_plan_hash: "this-hash-does-not-match-the-current-plan",
    };
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, staleReadyVerdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal((result as ReadinessRejection).rejected, true);
    assert.equal((result as ReadinessRejection).reason, "PLAN_HASH_STALE");
  });

  it("matching hash does NOT produce PLAN_HASH_STALE", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal((result as { created: boolean }).created, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-08: Verdict is a snapshot — mutating original after creation has no effect
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-08: Stored verdict is a snapshot; mutating original does not affect ledger entry", () => {
  it("changing assessed_plan_hash on original verdict does not affect stored verdict", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const originalHash = verdict.assessed_plan_hash;
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as { created: true; run_id: string; ledger_entry: { readiness_verdict: ReadinessVerdict } };

    // Attempt mutation of original (if original is frozen, this throws — catch it)
    try {
      (verdict as unknown as Record<string, unknown>).assessed_plan_hash = "mutated-hash";
    } catch {
      // original may already be frozen by assessReadiness — that is acceptable
    }

    // Stored verdict must retain the original hash regardless
    assert.equal(result.ledger_entry.readiness_verdict.assessed_plan_hash, originalHash);
  });

  it("stored verdict remains stable after attempted mutation of the original input verdict", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const originalStatus = verdict.status;
    const originalHash = verdict.assessed_plan_hash;
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as { created: true; run_id: string; ledger_entry: { readiness_verdict: ReadinessVerdict } };

    // Attempt all mutations on the original; each may throw if already frozen
    try { (verdict as unknown as Record<string, unknown>).status = "NOT_READY"; } catch { /* frozen */ }
    try { (verdict as unknown as Record<string, unknown>).assessed_plan_hash = "tampered"; } catch { /* frozen */ }
    try { (verdict as unknown as Record<string, unknown>).computed_plan_hash = "tampered"; } catch { /* frozen */ }
    try { (verdict as unknown as Record<string, unknown>).findings = []; } catch { /* frozen */ }

    // Stored verdict must be stable regardless of what happened to the input
    const stored = result.ledger_entry.readiness_verdict;
    assert.equal(stored.status, originalStatus);
    assert.equal(stored.assessed_plan_hash, originalHash);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-09: No bypass — both rejection paths leave the ledger store unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-09: No bypass — both NOT_READY and PLAN_HASH_STALE reject without ledger write", () => {
  it("NOT_READY verdict leaves store with zero ledger entries", () => {
    const plan = makeValidPlan();
    const verdict = notReadyVerdict(plan.plan_hash ?? "");
    const store = createEmptyLedgerStore();

    initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal(store.ledgers.size, 0);
    assert.equal(store.events.size, 0);
  });

  it("PLAN_HASH_STALE verdict leaves store with zero ledger entries", () => {
    const plan = makeValidPlan();
    const staleVerdict: ReadinessVerdict = {
      status: "READY",
      findings: [],
      assessed_plan_hash: "stale-hash",
      computed_plan_hash: "stale-hash",
    };
    const store = createEmptyLedgerStore();

    initiateRunWithReadiness(
      plan, staleVerdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal(store.ledgers.size, 0);
    assert.equal(store.events.size, 0);
  });

  it("only READY verdict with matching hash produces a ledger entry", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    assert.equal((result as { created: boolean }).created, true);
    const entry = (result as { ledger_entry: { state: string } }).ledger_entry;
    assert.equal(entry.state, "PENDING_ACK");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-10: ReadinessRejectionReason is a closed set
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-10: ReadinessRejectionReason is a closed set of exactly two values", () => {
  it("READINESS_REJECTION_REASONS contains exactly 2 values", () => {
    assert.equal(READINESS_REJECTION_REASONS.size, 2);
  });

  it("NOT_READY is in the closed set", () => {
    assert.equal(READINESS_REJECTION_REASONS.has("NOT_READY"), true);
  });

  it("PLAN_HASH_STALE is in the closed set", () => {
    assert.equal(READINESS_REJECTION_REASONS.has("PLAN_HASH_STALE"), true);
  });

  it("unknown reason codes are not in the set", () => {
    assert.equal(READINESS_REJECTION_REASONS.has("UNKNOWN"), false);
    assert.equal(READINESS_REJECTION_REASONS.has("INVALID"), false);
    assert.equal(READINESS_REJECTION_REASONS.has(""), false);
    assert.equal(READINESS_REJECTION_REASONS.has("not_ready"), false); // case-sensitive
  });

  it("all rejection results carry a reason within the closed set", () => {
    const plan = makeValidPlan();
    const store = createEmptyLedgerStore();

    // NOT_READY
    const r1 = initiateRunWithReadiness(
      plan, notReadyVerdict(plan.plan_hash ?? ""), store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as ReadinessRejection;
    assert.equal(READINESS_REJECTION_REASONS.has(r1.reason), true);

    // PLAN_HASH_STALE
    const staleVerdict: ReadinessVerdict = { status: "READY", findings: [], assessed_plan_hash: "x", computed_plan_hash: "x" };
    const r2 = initiateRunWithReadiness(
      plan, staleVerdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as ReadinessRejection;
    assert.equal(READINESS_REJECTION_REASONS.has(r2.reason), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-11: RunCreationResult is a discriminated union
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-11: RunCreationResult is a discriminated union with created:true and rejected:true branches", () => {
  it("success branch has created:true, run_id, and ledger_entry fields", () => {
    const plan = makeValidPlan();
    const verdict = readyVerdictFor(plan);
    const store = createEmptyLedgerStore();

    const result: RunCreationResult = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    if (!("created" in result && result.created)) {
      assert.fail("Expected created:true branch");
    }
    assert.equal(result.created, true);
    assert.equal(typeof result.run_id, "string");
    assert.ok(result.ledger_entry !== undefined);
  });

  it("rejection branch has rejected:true, reason, and verdict fields", () => {
    const plan = makeValidPlan();
    const verdict = notReadyVerdict(plan.plan_hash ?? "");
    const store = createEmptyLedgerStore();

    const result: RunCreationResult = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );

    if (!("rejected" in result && result.rejected)) {
      assert.fail("Expected rejected:true branch");
    }
    assert.equal(result.rejected, true);
    assert.ok(typeof result.reason === "string");
    assert.ok("verdict" in result);
  });

  it("success branch has no rejected field; rejection branch has no created field", () => {
    const plan = makeValidPlan();
    const store = createEmptyLedgerStore();

    const success: RunCreationResult = initiateRunWithReadiness(
      plan, readyVerdictFor(plan), store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );
    assert.equal("rejected" in success, false);

    const rejection: RunCreationResult = initiateRunWithReadiness(
      plan, notReadyVerdict(plan.plan_hash ?? ""), store,
      VALID_RUN_ID_2, FOREMAN_VERSION, NOW, REQUESTED_BY,
    );
    assert.equal("created" in rejection, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Additional edge cases: NOT_READY takes priority over PLAN_HASH_STALE
// ═══════════════════════════════════════════════════════════════════════════

describe("Guard ordering: NOT_READY checked before PLAN_HASH_STALE", () => {
  it("NOT_READY verdict with stale hash → reason is NOT_READY (NOT_READY checked first)", () => {
    const plan = makeValidPlan();
    const verdict: ReadinessVerdict = {
      status: "NOT_READY",
      findings: [
        { finding_code: "PLAN_NOT_APPROVED", severity: "BLOCKING", message: "not approved", step_id: null },
      ],
      assessed_plan_hash: "stale-hash-also-wrong",
      computed_plan_hash: "stale-hash-also-wrong",
    };
    const store = createEmptyLedgerStore();

    const result = initiateRunWithReadiness(
      plan, verdict, store, VALID_RUN_ID, FOREMAN_VERSION, NOW, REQUESTED_BY,
    ) as ReadinessRejection;

    // NOT_READY guard fires first
    assert.equal(result.reason, "NOT_READY");
  });
});
