/**
 * Agent OS — Planner Subsystem P1-S6: Execution Readiness Gate
 *
 * Determines whether an APPROVED PlanArtifact is structurally, operationally,
 * and governance-complete before execution may begin.
 *
 * This is a pure assessment — it does not mutate plan status or initiate
 * execution. Only Command may act on the returned ReadinessVerdict.
 *
 * Specification: Atlas P1-S6 corrected per CP-01 (2026-03-13).
 * FindingCode closed set: 10 codes (STEP_MISSING_SCOPE_TAG and
 * STEP_INVALID_SCOPE_TAG removed; PlanStep carries no scope_tag field).
 *
 * Pure function — no I/O, no mutation of inputs, no ID/timestamp generation,
 * no side effects. Identical input always produces identical output.
 */

import type { PlanArtifact, PlanStep } from "./types.js";
import { AGENT_ROLES } from "./types.js";
import { computePlanHash } from "./hash.js";
import type { ReadinessFinding, ReadinessVerdict } from "./readiness-types.js";
import { findingSeverity } from "./readiness-types.js";

// ── Internal helpers ─────────────────────────────────────────────────────────

function makeFinding(
  code: Parameters<typeof findingSeverity>[0],
  message: string,
  step_id: string | null = null,
): ReadinessFinding {
  return {
    finding_code: code,
    severity: findingSeverity(code),
    message,
    step_id,
  };
}

/**
 * Collect all transitive predecessor step IDs for a given step via BFS.
 * Cycle-safe: visited set prevents revisiting nodes.
 */
function collectPredecessorIds(
  stepId: string,
  stepMap: ReadonlyMap<string, PlanStep>,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];

  const origin = stepMap.get(stepId);
  if (origin) {
    for (const dep of origin.depends_on) {
      queue.push(dep);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const pred = stepMap.get(id);
    if (pred) {
      for (const dep of pred.depends_on) {
        if (!visited.has(dep)) {
          queue.push(dep);
        }
      }
    }
  }

  return visited;
}

/**
 * Sort findings per §8 of the corrected spec:
 *   1. Plan-level findings (step_id === null) before step-level findings.
 *   2. Within each group, lexicographically by finding_code.
 *   3. Tiebreak on step_id for step-level findings (determinism).
 */
function sortFindings(findings: ReadinessFinding[]): ReadinessFinding[] {
  return findings.slice().sort((a, b) => {
    // Nulls first (plan-level before step-level)
    if (a.step_id === null && b.step_id !== null) return -1;
    if (a.step_id !== null && b.step_id === null) return 1;
    // Lexicographic by finding_code
    if (a.finding_code < b.finding_code) return -1;
    if (a.finding_code > b.finding_code) return 1;
    // Tiebreak on step_id for full determinism
    if (a.step_id !== null && b.step_id !== null) {
      if (a.step_id < b.step_id) return -1;
      if (a.step_id > b.step_id) return 1;
    }
    return 0;
  });
}

// ── Step-level checks ────────────────────────────────────────────────────────

function checkStep(
  step: PlanStep,
  stepMap: ReadonlyMap<string, PlanStep>,
  collected: ReadinessFinding[],
): void {
  // AC-11: STEP_MISSING_AGENT / STEP_INVALID_AGENT_ROLE
  // Field name is `agent` per P1-S1 PlanStep contract (CP-01 corrects `assigned_agent`).
  const agent = step.agent as string | undefined;
  if (!agent || agent.trim() === "") {
    collected.push(makeFinding(
      "STEP_MISSING_AGENT",
      `Step "${step.step_id}" has a missing or empty agent assignment.`,
      step.step_id,
    ));
  } else if (!AGENT_ROLES.has(agent)) {
    collected.push(makeFinding(
      "STEP_INVALID_AGENT_ROLE",
      `Step "${step.step_id}" has an invalid agent role "${agent}".`,
      step.step_id,
    ));
  }

  // AC-12: TRUST_ESCALATION_MISSING
  // A step touches a trust domain when trust_touch is true or trust_touch_domains
  // is non-empty. Both fields are real PlanStep contract fields per P1-S1.
  const touches_trust =
    step.trust_touch === true || step.trust_touch_domains.length > 0;
  if (touches_trust) {
    const predecessors = collectPredecessorIds(step.step_id, stepMap);
    const sentinel_precedes = [...predecessors].some(
      id => stepMap.get(id)?.agent === "Sentinel",
    );
    if (!sentinel_precedes) {
      collected.push(makeFinding(
        "TRUST_ESCALATION_MISSING",
        `Step "${step.step_id}" touches a trust domain but has no Sentinel-assigned step in its transitive dependency chain.`,
        step.step_id,
      ));
    }
  }
}

// ── assessReadiness ──────────────────────────────────────────────────────────

/**
 * Assess whether an approved PlanArtifact is ready for execution.
 *
 * Returns a ReadinessVerdict:
 * - status READY  — zero BLOCKING findings
 * - status NOT_READY — one or more BLOCKING findings
 *
 * Both assessed_plan_hash (stored) and computed_plan_hash (recomputed) are
 * always present in the verdict for integrity verification (AC-15).
 *
 * Throws only if the input is not a structurally valid PlanArtifact.
 * Callers should have validated via P1-S1 validatePlanArtifact first.
 */
export function assessReadiness(plan: PlanArtifact): ReadinessVerdict {
  // Defensive guard — not a normal code path.
  if (typeof plan !== "object" || plan === null || !Array.isArray(plan.steps)) {
    throw new Error(
      "assessReadiness: input is not a structurally valid PlanArtifact",
    );
  }

  const collected: ReadinessFinding[] = [];

  // Hash is always recomputed regardless of whether plan_hash is present (AC-15).
  const computed_plan_hash = computePlanHash(plan);
  const assessed_plan_hash = plan.plan_hash ?? "";

  // ── Plan-level checks ──────────────────────────────────────────────────────

  // AC-05: PLAN_HASH_MISSING
  const hash_present =
    typeof plan.plan_hash === "string" && plan.plan_hash.trim() !== "";
  if (!hash_present) {
    collected.push(makeFinding(
      "PLAN_HASH_MISSING",
      "Plan hash is missing or empty.",
    ));
  } else {
    // AC-15: PLAN_HASH_MISMATCH — only checked when plan_hash is present
    if (computed_plan_hash !== plan.plan_hash) {
      collected.push(makeFinding(
        "PLAN_HASH_MISMATCH",
        `Plan hash mismatch: stored "${plan.plan_hash}" does not match computed "${computed_plan_hash}".`,
      ));
    }
  }

  // AC-06: PLAN_NOT_APPROVED
  if (plan.status !== "APPROVED") {
    collected.push(makeFinding(
      "PLAN_NOT_APPROVED",
      `Plan status is "${plan.status}"; expected "APPROVED".`,
    ));
  }

  // AC-07: STEPS_EMPTY
  if (plan.steps.length === 0) {
    collected.push(makeFinding("STEPS_EMPTY", "Plan has no steps."));
  } else {
    // Sort a copy by sequence for contiguity and termination checks.
    // Original plan.steps is never mutated.
    const sorted_steps = plan.steps.slice().sort((a, b) => a.sequence - b.sequence);
    const step_ids = new Set(plan.steps.map(s => s.step_id));
    const step_map: ReadonlyMap<string, PlanStep> = new Map(
      plan.steps.map(s => [s.step_id, s]),
    );

    // AC-08: SEQUENCE_GAP
    // One plan-level finding lists all detected gaps.
    const gaps: string[] = [];
    for (let i = 1; i < sorted_steps.length; i++) {
      const prev = sorted_steps[i - 1];
      const curr = sorted_steps[i];
      if (curr.sequence !== prev.sequence + 1) {
        gaps.push(
          `${prev.step_id}(seq:${prev.sequence}) → ${curr.step_id}(seq:${curr.sequence})`,
        );
      }
    }
    if (gaps.length > 0) {
      collected.push(makeFinding(
        "SEQUENCE_GAP",
        `Non-contiguous step sequences detected: ${gaps.join("; ")}.`,
      ));
    }

    // AC-09: ORPHAN_DEPENDENCY
    // One finding per step that has any depends_on entry not in the plan.
    for (const step of plan.steps) {
      const orphans = step.depends_on.filter(dep => !step_ids.has(dep));
      if (orphans.length > 0) {
        collected.push(makeFinding(
          "ORPHAN_DEPENDENCY",
          `Step "${step.step_id}" depends on unknown step(s): ${orphans.map(d => `"${d}"`).join(", ")}.`,
          step.step_id,
        ));
      }
    }

    // AC-10: TERMINATION_RULE_VIOLATED
    // Final step (highest sequence) must be assigned to Compass or Command.
    const final_step = sorted_steps[sorted_steps.length - 1];
    if (final_step.agent !== "Compass" && final_step.agent !== "Command") {
      collected.push(makeFinding(
        "TERMINATION_RULE_VIOLATED",
        `Final step "${final_step.step_id}" (seq:${final_step.sequence}) is assigned to "${final_step.agent}"; expected "Compass" or "Command".`,
      ));
    }

    // ── Step-level checks (AC-11, AC-12) ──────────────────────────────────
    for (const step of plan.steps) {
      checkStep(step, step_map, collected);
    }
  }

  // ── Verdict derivation (AC-13) ────────────────────────────────────────────
  // READY if and only if zero BLOCKING findings. No discretionary judgment.
  const sorted_findings = sortFindings(collected);
  const has_blocking = sorted_findings.some(f => f.severity === "BLOCKING");

  return {
    status: has_blocking ? "NOT_READY" : "READY",
    findings: sorted_findings,
    assessed_plan_hash,
    computed_plan_hash,
  };
}
