/**
 * Agent OS — Planner Subsystem P1-S6: Readiness Gate Types
 *
 * Types and supporting functions for the Execution Readiness Gate.
 * Consumed by readiness-gate.ts; may be imported by future integration slices.
 *
 * All types and functions are pure. No I/O, no side effects.
 */

// ── Status and severity ──────────────────────────────────────────────────────

export type ReadinessStatus = "READY" | "NOT_READY";

/** All P1-S6 finding codes are BLOCKING. ADVISORY is reserved for future slices. */
export type FindingSeverity = "BLOCKING";

// ── Finding code closed set (§6, corrected per CP-01) ───────────────────────
//
// Exactly 10 codes. All codes in this initial set are BLOCKING severity.
// STEP_MISSING_SCOPE_TAG and STEP_INVALID_SCOPE_TAG removed per CP-01:
// PlanStep carries no scope_tag field; checks against a nonexistent field
// are not authorized without a P1-S1 contract amendment.
// Extending the set requires an architecture amendment.

export type FindingCode =
  | "ORPHAN_DEPENDENCY"
  | "PLAN_HASH_MISSING"
  | "PLAN_HASH_MISMATCH"
  | "PLAN_NOT_APPROVED"
  | "SEQUENCE_GAP"
  | "STEP_INVALID_AGENT_ROLE"
  | "STEP_MISSING_AGENT"
  | "STEPS_EMPTY"
  | "TERMINATION_RULE_VIOLATED"
  | "TRUST_ESCALATION_MISSING";

/**
 * Ordered array of all valid FindingCodes.
 * Used for runtime closed-set enforcement.
 */
export const FINDING_CODES: ReadonlyArray<FindingCode> = [
  "ORPHAN_DEPENDENCY",
  "PLAN_HASH_MISSING",
  "PLAN_HASH_MISMATCH",
  "PLAN_NOT_APPROVED",
  "SEQUENCE_GAP",
  "STEP_INVALID_AGENT_ROLE",
  "STEP_MISSING_AGENT",
  "STEPS_EMPTY",
  "TERMINATION_RULE_VIOLATED",
  "TRUST_ESCALATION_MISSING",
] as const;

// ── Finding and verdict types ────────────────────────────────────────────────

export interface ReadinessFinding {
  finding_code: FindingCode;
  severity: FindingSeverity;
  message: string;
  step_id: string | null; // null for plan-level findings; step_id for step-scoped findings
}

export interface ReadinessVerdict {
  status: ReadinessStatus;
  findings: readonly ReadinessFinding[];
  assessed_plan_hash: string; // plan_hash from the input PlanArtifact (empty string if null)
  computed_plan_hash: string; // hash recomputed by the gate for integrity verification
}

// ── Severity map ─────────────────────────────────────────────────────────────
//
// All codes in the initial set are BLOCKING.
// Centralized here so severity assignment is not scattered across assessment logic.

const SEVERITY_MAP: Readonly<Record<FindingCode, FindingSeverity>> = {
  ORPHAN_DEPENDENCY: "BLOCKING",
  PLAN_HASH_MISSING: "BLOCKING",
  PLAN_HASH_MISMATCH: "BLOCKING",
  PLAN_NOT_APPROVED: "BLOCKING",
  SEQUENCE_GAP: "BLOCKING",
  STEP_INVALID_AGENT_ROLE: "BLOCKING",
  STEP_MISSING_AGENT: "BLOCKING",
  STEPS_EMPTY: "BLOCKING",
  TERMINATION_RULE_VIOLATED: "BLOCKING",
  TRUST_ESCALATION_MISSING: "BLOCKING",
};

// ── Supporting functions ─────────────────────────────────────────────────────

/**
 * Runtime closed-set membership check for finding codes.
 * Returns false for any string not in the closed set.
 */
export function isValidFindingCode(code: string): code is FindingCode {
  return (FINDING_CODES as ReadonlyArray<string>).includes(code);
}

/**
 * Returns the severity for a given finding code.
 * Severity is fixed per code; this is a lookup, not a computation.
 */
export function findingSeverity(code: FindingCode): FindingSeverity {
  return SEVERITY_MAP[code];
}
