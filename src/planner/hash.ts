/**
 * Agent OS — Planner Subsystem P1-S1: Deterministic Plan Hashing
 *
 * Implements R9 (§5) plan_hash computation:
 * - Canonical frozen-plan projection (excludes mutable execution fields)
 * - Stable serialization (alphabetically sorted keys, no whitespace)
 * - SHA-256 hex digest
 * - Recompute-and-compare verification function
 *
 * All functions are pure. No I/O, no mutation.
 */

import { createHash } from "node:crypto";
import type { PlanArtifact, PlanStep } from "./types.js";

// ── Canonical Projection (§5.1) ─────────────────────────────────────────────

/**
 * Sort object keys alphabetically, recursively.
 * Arrays preserve order; objects get sorted keys.
 */
function sortKeysRecursive(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursive);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysRecursive((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Project only the frozen (immutable) fields from a PlanStep for hashing.
 * Excludes mutable execution fields: status, result_ref.
 */
function projectStep(step: PlanStep): Record<string, unknown> {
  return {
    step_id: step.step_id,
    sequence: step.sequence,
    label: step.label,
    agent: step.agent,
    input_contract: step.input_contract,
    output_contract: step.output_contract,
    acceptance_criteria: step.acceptance_criteria,
    depends_on: step.depends_on,
    trust_touch: step.trust_touch,
    trust_touch_domains: step.trust_touch_domains,
  };
}

/**
 * Build the canonical hash input body from a PlanArtifact.
 * Per §5.1, only frozen plan fields are included.
 * Mutable execution fields (status, result_ref, run_id, executed_at, archived_at)
 * are excluded.
 */
export function buildHashBody(artifact: PlanArtifact): Record<string, unknown> {
  return {
    approved_by: artifact.approved_by,
    goal_id: artifact.goal_id,
    non_goals: artifact.non_goals,
    plan_id: artifact.plan_id,
    scope_tag: artifact.scope_tag,
    steps: artifact.steps.map(projectStep),
    trust_sensitive: artifact.trust_sensitive,
    version: artifact.version,
  };
}

// ── Stable Serialization ────────────────────────────────────────────────────

/**
 * Canonical JSON serialization: alphabetically sorted keys, no whitespace.
 * Deterministic for any structurally equivalent input.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysRecursive(value));
}

// ── SHA-256 ─────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

// ── Plan Hash Computation ───────────────────────────────────────────────────

/**
 * Compute the plan_hash for a PlanArtifact per R9 (§5.1).
 * Returns a lowercase 64-char hex SHA-256 string.
 */
export function computePlanHash(artifact: PlanArtifact): string {
  const body = buildHashBody(artifact);
  const canonical = canonicalize(body);
  return sha256(canonical);
}

// ── Recompute-and-Compare ───────────────────────────────────────────────────

export interface HashVerifyResult {
  ok: boolean;
  computed: string;
  stored: string | null;
}

/**
 * Verify a PlanArtifact's plan_hash by recomputing and comparing.
 *
 * Returns { ok: false } if:
 * - plan_hash is null (not yet hashed)
 * - recomputed hash does not match stored plan_hash
 */
export function verifyPlanHash(artifact: PlanArtifact): HashVerifyResult {
  const computed = computePlanHash(artifact);
  const stored = artifact.plan_hash;

  if (stored === null) {
    return { ok: false, computed, stored };
  }

  return {
    ok: computed.toLowerCase() === stored.toLowerCase(),
    computed,
    stored,
  };
}
