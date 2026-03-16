/**
 * Agent OS — Planner Subsystem P1-S1: Validation Layer
 *
 * Deterministic, zero-side-effect validators for:
 * - Goal payload (§3)
 * - Plan artifact schema (§4)
 * - Self-check gate (§9): sequence, orphan, termination, trust escalation, MULTI governance
 *
 * All functions are pure. No I/O, no mutation, no exceptions thrown.
 */

import type {
  GoalPayload,
  PlanArtifact,
  PlanStep,
  ValidationResult,
} from "./types.js";

import {
  SCOPE_TAGS,
  AGENT_ROLES,
  STEP_STATUSES,
  TRUST_DOMAINS,
  PLAN_STATUSES,
} from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fail(code: string, message: string, detail?: unknown): ValidationResult {
  return detail !== undefined
    ? { ok: false, code, message, detail }
    : { ok: false, code, message };
}

function ok(): ValidationResult {
  return { ok: true };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function isIso8601(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

// ── Goal Payload Validation (§3) ────────────────────────────────────────────

const GOAL_REQUIRED_FIELDS: readonly (keyof GoalPayload)[] = [
  "goal_id",
  "goal_text",
  "scope_tag",
  "trust_touch",
  "submitted_by",
  "submitted_at",
];

export function validateGoalPayload(input: unknown): ValidationResult {
  if (input === null || typeof input !== "object") {
    return fail("GOAL_INVALID_SHAPE", "Goal payload must be a non-null object");
  }

  const goal = input as Record<string, unknown>;

  // Required field presence
  for (const field of GOAL_REQUIRED_FIELDS) {
    if (!(field in goal)) {
      return fail(
        "GOAL_MISSING_FIELD",
        `Missing required field: ${field}`,
        { field },
      );
    }
  }

  // goal_id must be UUID
  if (!isUuid(goal.goal_id)) {
    return fail("GOAL_INVALID_FIELD", "goal_id must be a valid UUID", {
      field: "goal_id",
    });
  }

  // goal_text must be non-empty string
  if (!isNonEmptyString(goal.goal_text)) {
    return fail("GOAL_INVALID_FIELD", "goal_text must be a non-empty string", {
      field: "goal_text",
    });
  }

  // scope_tag must be closed-set enum
  if (!SCOPE_TAGS.has(goal.scope_tag as string)) {
    return fail("GOAL_INVALID_FIELD", `scope_tag must be one of: ${[...SCOPE_TAGS].join(", ")}`, {
      field: "scope_tag",
      value: goal.scope_tag,
    });
  }

  // trust_touch must be boolean
  if (typeof goal.trust_touch !== "boolean") {
    return fail("GOAL_INVALID_FIELD", "trust_touch must be a boolean", {
      field: "trust_touch",
    });
  }

  // submitted_by must be exactly "Command"
  if (goal.submitted_by !== "Command") {
    return fail(
      "GOAL_SUBMITTED_BY_INVALID",
      'submitted_by must be "Command"',
      { field: "submitted_by", value: goal.submitted_by },
    );
  }

  // submitted_at must be valid ISO 8601
  if (!isIso8601(goal.submitted_at)) {
    return fail("GOAL_INVALID_FIELD", "submitted_at must be a valid ISO 8601 timestamp", {
      field: "submitted_at",
    });
  }

  // Optional fields type-check
  if ("constraints" in goal && goal.constraints !== undefined) {
    if (!Array.isArray(goal.constraints) || !goal.constraints.every((c: unknown) => typeof c === "string")) {
      return fail("GOAL_INVALID_FIELD", "constraints must be a string array", {
        field: "constraints",
      });
    }
  }

  if ("non_goals" in goal && goal.non_goals !== undefined) {
    if (!Array.isArray(goal.non_goals) || !goal.non_goals.every((c: unknown) => typeof c === "string")) {
      return fail("GOAL_INVALID_FIELD", "non_goals must be a string array", {
        field: "non_goals",
      });
    }
  }

  return ok();
}

// ── PlanStep Validation ─────────────────────────────────────────────────────

function validatePlanStep(step: unknown, index: number): ValidationResult {
  if (step === null || typeof step !== "object") {
    return fail("STEP_INVALID_SHAPE", `steps[${index}] must be a non-null object`);
  }

  const s = step as Record<string, unknown>;

  // Required fields
  const requiredFields = [
    "step_id", "sequence", "label", "agent", "input_contract",
    "output_contract", "acceptance_criteria", "depends_on",
    "trust_touch", "trust_touch_domains", "status", "result_ref",
  ] as const;

  for (const field of requiredFields) {
    if (!(field in s)) {
      return fail("STEP_MISSING_FIELD", `steps[${index}] missing required field: ${field}`, {
        step_index: index,
        field,
      });
    }
  }

  if (!isUuid(s.step_id)) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].step_id must be a valid UUID`, {
      step_index: index,
      field: "step_id",
    });
  }

  if (typeof s.sequence !== "number" || !Number.isInteger(s.sequence) || s.sequence < 1) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].sequence must be a positive integer`, {
      step_index: index,
      field: "sequence",
    });
  }

  if (!isNonEmptyString(s.label)) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].label must be a non-empty string`, {
      step_index: index,
      field: "label",
    });
  }

  if (!AGENT_ROLES.has(s.agent as string)) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].agent must be a valid AgentRole`, {
      step_index: index,
      field: "agent",
      value: s.agent,
    });
  }

  if (!isNonEmptyString(s.input_contract)) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].input_contract must be a non-empty string`, {
      step_index: index,
      field: "input_contract",
    });
  }

  if (!isNonEmptyString(s.output_contract)) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].output_contract must be a non-empty string`, {
      step_index: index,
      field: "output_contract",
    });
  }

  // acceptance_criteria: ≥1 non-empty string
  if (!Array.isArray(s.acceptance_criteria) || s.acceptance_criteria.length === 0) {
    return fail("STEP_AC_EMPTY", `steps[${index}].acceptance_criteria must have ≥1 entry`, {
      step_index: index,
    });
  }
  for (let i = 0; i < s.acceptance_criteria.length; i++) {
    if (!isNonEmptyString(s.acceptance_criteria[i])) {
      return fail("STEP_AC_EMPTY", `steps[${index}].acceptance_criteria[${i}] must be a non-empty string`, {
        step_index: index,
        ac_index: i,
      });
    }
  }

  // depends_on: string array of UUIDs
  if (!Array.isArray(s.depends_on)) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].depends_on must be an array`, {
      step_index: index,
      field: "depends_on",
    });
  }
  for (let i = 0; i < s.depends_on.length; i++) {
    if (!isUuid(s.depends_on[i])) {
      return fail("STEP_INVALID_FIELD", `steps[${index}].depends_on[${i}] must be a valid UUID`, {
        step_index: index,
        field: "depends_on",
      });
    }
  }

  if (typeof s.trust_touch !== "boolean") {
    return fail("STEP_INVALID_FIELD", `steps[${index}].trust_touch must be a boolean`, {
      step_index: index,
      field: "trust_touch",
    });
  }

  if (!Array.isArray(s.trust_touch_domains)) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].trust_touch_domains must be an array`, {
      step_index: index,
      field: "trust_touch_domains",
    });
  }
  for (const d of s.trust_touch_domains) {
    if (!TRUST_DOMAINS.has(d as string)) {
      return fail("STEP_INVALID_FIELD", `steps[${index}].trust_touch_domains contains invalid domain: ${d}`, {
        step_index: index,
        field: "trust_touch_domains",
        value: d,
      });
    }
  }

  if (!STEP_STATUSES.has(s.status as string)) {
    return fail("STEP_INVALID_FIELD", `steps[${index}].status must be a valid StepStatus`, {
      step_index: index,
      field: "status",
      value: s.status,
    });
  }

  // result_ref: string or null
  if (s.result_ref !== null && typeof s.result_ref !== "string") {
    return fail("STEP_INVALID_FIELD", `steps[${index}].result_ref must be a string or null`, {
      step_index: index,
      field: "result_ref",
    });
  }

  return ok();
}

// ── Plan Artifact Schema Validation (§4.1) ──────────────────────────────────

const ARTIFACT_REQUIRED_FIELDS = [
  "plan_id", "goal_id", "version", "version_history", "status", "scope_tag",
  "trust_sensitive", "steps", "non_goals", "sentinel_prereview",
  "submitted_at", "approved_at", "approved_by", "approval_acknowledgements",
  "plan_hash", "run_id", "executed_at", "archived_at",
] as const;

export function validatePlanArtifactSchema(input: unknown): ValidationResult {
  if (input === null || typeof input !== "object") {
    return fail("ARTIFACT_INVALID_SHAPE", "Plan artifact must be a non-null object");
  }

  const a = input as Record<string, unknown>;

  // Required field presence
  for (const field of ARTIFACT_REQUIRED_FIELDS) {
    if (!(field in a)) {
      return fail("ARTIFACT_MISSING_FIELD", `Missing required field: ${field}`, { field });
    }
  }

  if (!isUuid(a.plan_id)) {
    return fail("ARTIFACT_INVALID_FIELD", "plan_id must be a valid UUID", { field: "plan_id" });
  }

  if (!isUuid(a.goal_id)) {
    return fail("ARTIFACT_INVALID_FIELD", "goal_id must be a valid UUID", { field: "goal_id" });
  }

  if (typeof a.version !== "number" || !Number.isInteger(a.version) || a.version < 1) {
    return fail("ARTIFACT_INVALID_FIELD", "version must be a positive integer", { field: "version" });
  }

  if (!Array.isArray(a.version_history)) {
    return fail("ARTIFACT_INVALID_FIELD", "version_history must be an array", { field: "version_history" });
  }

  if (!PLAN_STATUSES.has(a.status as string)) {
    return fail("ARTIFACT_INVALID_FIELD", "status must be a valid PlanStatus", {
      field: "status",
      value: a.status,
    });
  }

  if (!SCOPE_TAGS.has(a.scope_tag as string)) {
    return fail("ARTIFACT_INVALID_FIELD", "scope_tag must be a valid ScopeTag", {
      field: "scope_tag",
      value: a.scope_tag,
    });
  }

  if (typeof a.trust_sensitive !== "boolean") {
    return fail("ARTIFACT_INVALID_FIELD", "trust_sensitive must be a boolean", { field: "trust_sensitive" });
  }

  if (!Array.isArray(a.steps)) {
    return fail("ARTIFACT_INVALID_FIELD", "steps must be an array", { field: "steps" });
  }

  if (a.steps.length === 0) {
    return fail("ARTIFACT_STEPS_EMPTY", "steps must contain ≥1 step");
  }

  // Validate each step structurally
  for (let i = 0; i < a.steps.length; i++) {
    const stepResult = validatePlanStep(a.steps[i], i);
    if (!stepResult.ok) return stepResult;
  }

  if (!Array.isArray(a.non_goals)) {
    return fail("ARTIFACT_INVALID_FIELD", "non_goals must be an array", { field: "non_goals" });
  }

  // sentinel_prereview: SentinelRecord or null
  if (a.sentinel_prereview !== null) {
    if (typeof a.sentinel_prereview !== "object") {
      return fail("ARTIFACT_INVALID_FIELD", "sentinel_prereview must be an object or null", {
        field: "sentinel_prereview",
      });
    }
  }

  if (!isIso8601(a.submitted_at)) {
    return fail("ARTIFACT_INVALID_FIELD", "submitted_at must be a valid ISO 8601 timestamp", {
      field: "submitted_at",
    });
  }

  // approved_at: ISO or null
  if (a.approved_at !== null && !isIso8601(a.approved_at)) {
    return fail("ARTIFACT_INVALID_FIELD", "approved_at must be a valid ISO 8601 timestamp or null", {
      field: "approved_at",
    });
  }

  // approved_by: "Command" or null
  if (a.approved_by !== null && a.approved_by !== "Command") {
    return fail("ARTIFACT_INVALID_FIELD", 'approved_by must be "Command" or null', {
      field: "approved_by",
      value: a.approved_by,
    });
  }

  if (!Array.isArray(a.approval_acknowledgements)) {
    return fail("ARTIFACT_INVALID_FIELD", "approval_acknowledgements must be an array", {
      field: "approval_acknowledgements",
    });
  }

  // plan_hash: string (sha256 hex) or null
  if (a.plan_hash !== null) {
    if (typeof a.plan_hash !== "string" || !/^[0-9a-f]{64}$/i.test(a.plan_hash)) {
      return fail("ARTIFACT_INVALID_FIELD", "plan_hash must be a 64-char hex string (SHA-256) or null", {
        field: "plan_hash",
      });
    }
  }

  // run_id: UUID or null
  if (a.run_id !== null && !isUuid(a.run_id)) {
    return fail("ARTIFACT_INVALID_FIELD", "run_id must be a valid UUID or null", { field: "run_id" });
  }

  // executed_at: ISO or null
  if (a.executed_at !== null && !isIso8601(a.executed_at)) {
    return fail("ARTIFACT_INVALID_FIELD", "executed_at must be a valid ISO 8601 timestamp or null", {
      field: "executed_at",
    });
  }

  // archived_at: ISO or null
  if (a.archived_at !== null && !isIso8601(a.archived_at)) {
    return fail("ARTIFACT_INVALID_FIELD", "archived_at must be a valid ISO 8601 timestamp or null", {
      field: "archived_at",
    });
  }

  return ok();
}

// ── Self-Check Gate Validators (§9) ─────────────────────────────────────────

/**
 * Check 1: Step sequence contiguous (1, 2, 3… no gaps)
 */
export function validateSequenceContiguous(steps: PlanStep[]): ValidationResult {
  for (let i = 0; i < steps.length; i++) {
    const expected = i + 1;
    if (steps[i].sequence !== expected) {
      return fail("SELFCHECK_SEQUENCE_GAP", `Expected sequence ${expected} at index ${i}, got ${steps[i].sequence}`, {
        step_index: i,
        expected,
        actual: steps[i].sequence,
      });
    }
  }
  return ok();
}

/**
 * Check 2: No orphan steps (all steps except step 1 must have depends_on populated)
 */
export function validateNoOrphanSteps(steps: PlanStep[]): ValidationResult {
  const stepIds = new Set(steps.map((s) => s.step_id));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Step 1 (sequence 1) is exempt from depends_on requirement
    if (step.sequence === 1) continue;

    if (step.depends_on.length === 0) {
      return fail("SELFCHECK_ORPHAN_STEP", `Step at sequence ${step.sequence} has no depends_on entries`, {
        step_index: i,
        step_id: step.step_id,
      });
    }

    // Verify all depends_on references exist in steps
    for (const dep of step.depends_on) {
      if (!stepIds.has(dep)) {
        return fail("SELFCHECK_DEPENDENCY_MISSING", `Step at sequence ${step.sequence} depends on unknown step_id: ${dep}`, {
          step_index: i,
          step_id: step.step_id,
          missing_dependency: dep,
        });
      }
    }
  }

  return ok();
}

/**
 * Check 3: Termination rule — final step must be Compass or Command
 */
export function validateTerminationRule(steps: PlanStep[]): ValidationResult {
  if (steps.length === 0) {
    return fail("SELFCHECK_NO_STEPS", "Cannot validate termination rule on empty steps array");
  }

  const finalStep = steps[steps.length - 1];
  if (finalStep.agent !== "Compass" && finalStep.agent !== "Command") {
    return fail("SELFCHECK_TERMINATION_VIOLATION", `Final step must be assigned to Compass or Command, got: ${finalStep.agent}`, {
      step_index: steps.length - 1,
      step_id: finalStep.step_id,
      agent: finalStep.agent,
    });
  }

  return ok();
}

/**
 * Check 4: Trust escalation rule (R5)
 * Any step with trust_touch = true assigned to Forge must be preceded
 * by a Sentinel step (earlier in sequence) covering the same trust domain.
 */
export function validateTrustEscalation(steps: PlanStep[]): ValidationResult {
  // Build map of trust domains covered by Sentinel steps at each sequence point
  const sentinelDomainsCovered = new Set<string>();

  for (const step of steps) {
    if (step.agent === "Sentinel" && step.trust_touch) {
      for (const domain of step.trust_touch_domains) {
        sentinelDomainsCovered.add(`${domain}@${step.sequence}`);
      }
    }
  }

  // For each Forge step with trust_touch, check that every domain is
  // covered by a Sentinel step with lower sequence
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.agent !== "Forge" || !step.trust_touch) continue;

    for (const domain of step.trust_touch_domains) {
      let covered = false;
      for (const prior of steps) {
        if (prior.sequence >= step.sequence) break;
        if (
          prior.agent === "Sentinel" &&
          prior.trust_touch &&
          prior.trust_touch_domains.includes(domain)
        ) {
          covered = true;
          break;
        }
      }
      if (!covered) {
        return fail(
          "SELFCHECK_TRUST_ESCALATION",
          `Forge step at sequence ${step.sequence} touches ${domain} without preceding Sentinel review`,
          {
            step_index: i,
            step_id: step.step_id,
            domain,
          },
        );
      }
    }
  }

  return ok();
}

/**
 * Check 5: MULTI governance (R9)
 * If scope_tag = MULTI:
 * - trust_sensitive must be explicitly evaluated (checked by caller via artifact)
 * - Mandatory Sentinel step before any Forge step
 * - Final step must be Compass
 */
export function validateMultiGovernance(
  steps: PlanStep[],
  scopeTag: string,
): ValidationResult {
  if (scopeTag !== "MULTI") return ok();

  // Final step must be Compass (stricter than general termination rule which allows Command)
  if (steps.length === 0) {
    return fail("SELFCHECK_MULTI_NO_STEPS", "MULTI plan must have ≥1 step");
  }
  const finalStep = steps[steps.length - 1];
  if (finalStep.agent !== "Compass") {
    return fail(
      "SELFCHECK_MULTI_TERMINATION",
      `MULTI plan final step must be Compass, got: ${finalStep.agent}`,
      { step_index: steps.length - 1, agent: finalStep.agent },
    );
  }

  // Mandatory Sentinel step before any Forge step
  let sentinelSeen = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.agent === "Sentinel") {
      sentinelSeen = true;
    }
    if (step.agent === "Forge" && !sentinelSeen) {
      return fail(
        "SELFCHECK_MULTI_SENTINEL_REQUIRED",
        `MULTI plan requires Sentinel step before any Forge step; Forge found at sequence ${step.sequence} with no preceding Sentinel`,
        { step_index: i, step_id: step.step_id },
      );
    }
  }

  return ok();
}

/**
 * Run the full self-check gate (§9). Returns the first failure found.
 * Caller supplies the artifact so governance fields (scope_tag) are available.
 */
export function runSelfCheck(artifact: PlanArtifact): ValidationResult {
  const steps = artifact.steps;

  // Schema validity of the artifact itself
  const schemaResult = validatePlanArtifactSchema(artifact);
  if (!schemaResult.ok) return schemaResult;

  // Contiguous sequence
  const seqResult = validateSequenceContiguous(steps);
  if (!seqResult.ok) return seqResult;

  // No orphan steps
  const orphanResult = validateNoOrphanSteps(steps);
  if (!orphanResult.ok) return orphanResult;

  // Termination rule
  const termResult = validateTerminationRule(steps);
  if (!termResult.ok) return termResult;

  // Trust escalation
  const trustResult = validateTrustEscalation(steps);
  if (!trustResult.ok) return trustResult;

  // MULTI governance
  const multiResult = validateMultiGovernance(steps, artifact.scope_tag);
  if (!multiResult.ok) return multiResult;

  return ok();
}
