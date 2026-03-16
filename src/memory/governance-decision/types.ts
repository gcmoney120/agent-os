/**
 * Agent OS — K8 Governance Decision Ingestion
 * Type definitions.
 *
 * Source: governance-decision-ingestion-k8-v1.1.md §6, §11
 * Slice: K8 — Governance Decision Ingestion
 *
 * Defines DecisionIngestRequest, PromotionDirective, DecisionIngestResult,
 * WrittenRecords, and the K8ErrorCode enum.
 *
 * No writes. No runtime dependencies on K3–K7.
 */

import type { StepReportV1 } from "../../step-report/stepReport.schema.js";

// ---------------------------------------------------------------------------
// Error codes — §11.3
// ---------------------------------------------------------------------------

export const K8_ERROR_CODE = {
  K8_MISSING_PROJECT_ID:                     "K8_MISSING_PROJECT_ID",
  K8_MISSING_RUN_ID:                         "K8_MISSING_RUN_ID",
  K8_MISSING_STEP_REPORT:                    "K8_MISSING_STEP_REPORT",
  K8_MISSING_EPISODIC_EVENT_ID:              "K8_MISSING_EPISODIC_EVENT_ID",
  K8_MISSING_DECISION_ID:                    "K8_MISSING_DECISION_ID",
  K8_MISSING_DECISION_PAYLOAD:               "K8_MISSING_DECISION_PAYLOAD",
  K8_MISSING_SCHEMA_VERSION:                 "K8_MISSING_SCHEMA_VERSION",
  K8_INVALID_TIMESTAMP:                      "K8_INVALID_TIMESTAMP",
  K8_INELIGIBLE_STATE_IMPACT:                "K8_INELIGIBLE_STATE_IMPACT",
  K8_UNKNOWN_STATE_IMPACT:                   "K8_UNKNOWN_STATE_IMPACT",
  K8_PROMOTION_PROHIBITED_FOR_TRUST_CHANGE:  "K8_PROMOTION_PROHIBITED_FOR_TRUST_CHANGE",
  K8_INVALID_PROMOTION_DIRECTIVE:            "K8_INVALID_PROMOTION_DIRECTIVE",
  K8_DECISION_WRITE_FAILED:                  "K8_DECISION_WRITE_FAILED",
  K8_PROMOTION_WRITE_FAILED:                 "K8_PROMOTION_WRITE_FAILED",
} as const;

export type K8ErrorCode = (typeof K8_ERROR_CODE)[keyof typeof K8_ERROR_CODE];

// ---------------------------------------------------------------------------
// PromotionDirective — §6.3
// Supplies identifiers and content for K2 appendPromotionChain.
// Only evaluated when state_impact = 'phase_boundary'.
// ---------------------------------------------------------------------------

export interface PromotionDirective {
  readonly fact_id: string;
  readonly fact_event_id: string;
  readonly embedding_record_id: string;
  readonly embedding_status_event_id: string;
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// DecisionIngestRequest — §6.2
// ---------------------------------------------------------------------------

export interface DecisionIngestRequest {
  readonly project_id: string;
  readonly run_id: string;
  readonly step_report: StepReportV1;
  readonly episodic_event_id: string;
  readonly decision_id: string;
  readonly decision_payload: Record<string, unknown>;
  readonly promotion_directive?: PromotionDirective;
  readonly schema_version: string;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// WrittenRecords — §11.2
// ---------------------------------------------------------------------------

export interface WrittenRecords {
  readonly decision_event_id: string;
  readonly promotion_written: boolean;
  readonly semantic_fact_id: string | null;
  readonly embedding_record_id: string | null;
}

// ---------------------------------------------------------------------------
// DecisionIngestResult — §11.1
// ---------------------------------------------------------------------------

export type DecisionIngestResult =
  | { readonly ok: true; readonly written: WrittenRecords }
  | { readonly ok: false; readonly code: K8ErrorCode; readonly message: string };
