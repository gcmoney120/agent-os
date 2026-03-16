/**
 * Agent OS — K9/K10 Step-Started Event Verifier
 *
 * Slices: K9 — Memory Context Injection
 *         K10 — Verifier-Enforceable Memory Context Hash
 *
 * Validates the step-started.json artifact emitted by the dispatcher
 * before each step execution. Called inline by dispatchRun / dispatchResume
 * as a pre-write assertion on the step-started payload.
 *
 * This module is purely additive. No prior step.started field-level validation
 * existed in agent-os before K9. The Foreman ledger verifier validates ledger
 * structure (seq ordering, hashes, run lifecycle) but does not inspect
 * step.started payload field content — so no prior validation scope is reduced.
 *
 * K9 contract (§6.3):
 *   AC5 — Events WITH memory_context_hash are permitted.
 *   AC6 — Events WITHOUT memory_context_hash are permitted (field is optional).
 *   AC7 — When present, memory_context_hash must be a 64-character lowercase
 *          hex string. Any other value causes rejection.
 *
 * K10 contract (§7, §8):
 *   Classification precedes hash evaluation (mandatory ordering):
 *   Step 1 — Inspect step_schema_version:
 *     a. Absent        → pre-K10 classification → §8.1 rules
 *     b. === "k10"     → K10+ classification   → §8.2 rules
 *     c. Any other value → UNKNOWN_STEP_SCHEMA_VERSION; halt (no hash eval)
 *   Step 2 — Apply hash rules per classification:
 *     pre-K10: hash optional; if present must be 64-char lowercase hex
 *     K10+:    hash required (MEMORY_CONTEXT_HASH_MISSING if absent);
 *              if present must be 64-char lowercase hex
 *   MEMORY_CONTEXT_HASH_MALFORMED applies whenever hash is present but invalid,
 *   on any classification that reaches Step 2.
 *
 * No I/O. No side effects. Pure validation only.
 */

const HEX64_RE = /^[0-9a-f]{64}$/;

/** K10 verifier failure codes. */
export type VerifyFailureCode =
  | "UNKNOWN_STEP_SCHEMA_VERSION"
  | "MEMORY_CONTEXT_HASH_MISSING"
  | "MEMORY_CONTEXT_HASH_MALFORMED";

export interface StepStartedVerifyResult {
  readonly ok: boolean;
  readonly code?: VerifyFailureCode;
  readonly error?: string;
}

/**
 * Validate a step-started event object.
 *
 * Returns { ok: true } when the event is well-formed.
 * Returns { ok: false, code, error } on any violation.
 *
 * Evaluation is two-phase (K10 §7):
 *   Phase 1: classify on step_schema_version
 *   Phase 2: apply memory_context_hash rules for the classification
 * An UNKNOWN_STEP_SCHEMA_VERSION failure halts before Phase 2.
 */
export function verifyStepStartedEvent(event: unknown): StepStartedVerifyResult {
  if (event === null || typeof event !== "object") {
    return { ok: false, error: "event must be a non-null object" };
  }

  const e = event as Record<string, unknown>;

  // ── Phase 1: Classify on step_schema_version (K10 §7, Step 1) ────────────

  let classification: "pre-k10" | "k10";

  if (!("step_schema_version" in e)) {
    // §7 Step 1a: absent → pre-K10
    classification = "pre-k10";
  } else if (e["step_schema_version"] === "k10") {
    // §7 Step 1b: "k10" → K10+
    classification = "k10";
  } else {
    // §7 Step 1c: present but unrecognised → hard failure; do not evaluate hash
    return {
      ok: false,
      code: "UNKNOWN_STEP_SCHEMA_VERSION",
      error: `step_schema_version value is not recognised`,
    };
  }

  // ── Phase 2: Apply hash rules per classification (K10 §8) ─────────────────

  if (classification === "k10") {
    // §8.2 K10+ enforcement: hash required
    if (!("memory_context_hash" in e)) {
      return {
        ok: false,
        code: "MEMORY_CONTEXT_HASH_MISSING",
        error: "memory_context_hash is required on K10+ step.started events",
      };
    }
    const h = e["memory_context_hash"];
    if (typeof h !== "string" || !HEX64_RE.test(h)) {
      return {
        ok: false,
        code: "MEMORY_CONTEXT_HASH_MALFORMED",
        error: "memory_context_hash must be a 64-character lowercase hex string",
      };
    }
  } else {
    // §8.1 pre-K10 enforcement: hash optional; validate format only when present
    if ("memory_context_hash" in e) {
      const h = e["memory_context_hash"];
      if (typeof h !== "string" || !HEX64_RE.test(h)) {
        return {
          ok: false,
          code: "MEMORY_CONTEXT_HASH_MALFORMED",
          error: "memory_context_hash must be a 64-character lowercase hex string",
        };
      }
    }
  }

  return { ok: true };
}
