/**
 * Agent OS — K8 Governance Decision Ingestion
 * Decision construction — pure function.
 *
 * Source: governance-decision-ingestion-k8-v1.1.md §7
 * Slice: K8 — Governance Decision Ingestion
 *
 * Derives IngestDecisionInput from DecisionIngestRequest.
 * All fields are caller-supplied. No writes. No ID generation.
 * No timestamp generation.
 *
 * decision_type mapping (§7):
 *   trust_change   → "TRUST_CHANGE"
 *   phase_boundary → "PHASE_BOUNDARY"
 *
 * input.promotion is always undefined — K8 controls Phase 2 separately
 * via executePromotion; K2's internal promote_to_semantic mechanism is
 * not used.
 */

import type { DecisionIngestRequest } from "./types.js";
import type { IngestDecisionInput } from "../pipeline/ingest.js";

// ---------------------------------------------------------------------------
// constructDecisionInput — §7
// ---------------------------------------------------------------------------

export function constructDecisionInput(
  request: DecisionIngestRequest,
): IngestDecisionInput {
  const stateImpact = request.step_report.state_impact;
  const decisionType = stateImpact === "trust_change" ? "TRUST_CHANGE" : "PHASE_BOUNDARY";

  const ts = new Date(request.timestamp);

  return {
    id: request.decision_id,
    project_id: request.project_id,
    schema_version: request.schema_version,
    run_id: request.run_id,
    decision_type: decisionType,
    actor_role: request.step_report.actor,
    episodic_event_id: request.episodic_event_id,
    decision_payload: request.decision_payload,
    decided_at: ts,
    created_at: ts,
    // promotion is left undefined: K8 drives Phase 2 via executePromotion directly
  };
}
