/**
 * Agent OS — K8 Governance Decision Ingestion
 * Input validation.
 *
 * Source: governance-decision-ingestion-k8-v1.1.md §6.4
 * Slice: K8 — Governance Decision Ingestion
 *
 * Validates all DecisionIngestRequest fields in the order specified by §6.4.
 * Returns { ok: false, code } on the first failing condition.
 * Makes no K2 calls. Performs no writes.
 */

import type { DecisionIngestRequest } from "./types.js";
import { K8_ERROR_CODE } from "./types.js";
import type { K8ErrorCode } from "./types.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ParamValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: K8ErrorCode; readonly message: string };

// ---------------------------------------------------------------------------
// Known state_impact values (closed world) — §5
// ---------------------------------------------------------------------------

const KNOWN_STATE_IMPACTS = new Set(["none", "trivial", "trust_change", "phase_boundary"]);

// ---------------------------------------------------------------------------
// validateDecisionIngestRequest — §6.4
// Validation order matches the spec table exactly.
// ---------------------------------------------------------------------------

export function validateDecisionIngestRequest(
  request: DecisionIngestRequest,
): ParamValidationResult {
  if (!request.project_id) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_MISSING_PROJECT_ID,
      message: "project_id is required",
    };
  }

  if (!request.run_id) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_MISSING_RUN_ID,
      message: "run_id is required",
    };
  }

  if (!request.step_report) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_MISSING_STEP_REPORT,
      message: "step_report is required",
    };
  }

  if (!request.episodic_event_id) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_MISSING_EPISODIC_EVENT_ID,
      message: "episodic_event_id is required",
    };
  }

  if (!request.decision_id) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_MISSING_DECISION_ID,
      message: "decision_id is required",
    };
  }

  if (!request.decision_payload) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_MISSING_DECISION_PAYLOAD,
      message: "decision_payload is required",
    };
  }

  if (!request.schema_version) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_MISSING_SCHEMA_VERSION,
      message: "schema_version is required",
    };
  }

  // timestamp: absent or not valid ISO 8601
  if (!request.timestamp || isNaN(Date.parse(request.timestamp))) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_INVALID_TIMESTAMP,
      message: "timestamp must be a valid ISO 8601 string",
    };
  }

  // state_impact: unknown value check before eligibility check — §5
  const stateImpact = request.step_report.state_impact;
  if (!KNOWN_STATE_IMPACTS.has(stateImpact)) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_UNKNOWN_STATE_IMPACT,
      message: `state_impact "${stateImpact}" is not a recognised value`,
    };
  }

  // state_impact: none/trivial are ineligible — §5
  if (stateImpact === "none" || stateImpact === "trivial") {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_INELIGIBLE_STATE_IMPACT,
      message: `state_impact "${stateImpact}" does not qualify for governance decision ingestion`,
    };
  }

  // promotion_directive prohibited for trust_change — §6.4
  if (stateImpact === "trust_change" && request.promotion_directive !== undefined) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_PROMOTION_PROHIBITED_FOR_TRUST_CHANGE,
      message: "promotion_directive is not permitted when state_impact is 'trust_change'",
    };
  }

  // promotion_directive field validation — §6.3
  if (request.promotion_directive !== undefined) {
    const d = request.promotion_directive;
    if (
      !d.fact_id ||
      !d.fact_event_id ||
      !d.embedding_record_id ||
      !d.embedding_status_event_id ||
      !d.fact_type ||
      !d.fact_key ||
      !d.fact_value
    ) {
      return {
        ok: false,
        code: K8_ERROR_CODE.K8_INVALID_PROMOTION_DIRECTIVE,
        message: "promotion_directive has one or more missing required fields",
      };
    }
  }

  return { ok: true };
}
