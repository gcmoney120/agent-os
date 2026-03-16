/**
 * Agent OS — K8 Governance Decision Ingestion
 * Top-level orchestrator — two-phase sequential pipeline.
 *
 * Source: governance-decision-ingestion-k8-v1.1.md §9
 * Slice: K8 — Governance Decision Ingestion
 *
 * Canonical interface:
 *   ingestGovernanceDecision(backend, request): DecisionIngestResult
 *
 * Pipeline (§9.1):
 *   [1] Parameter validation  — no K2 calls on failure
 *   [2] Decision construction — pure derivation
 *   [3] Phase 1 — ingestDecisionEvent (K2)
 *   [4] Promotion check — skip Phase 2 if no promotion_directive
 *   [5] Phase 2 — executePromotion (K2); on failure decision_event already written
 *   [6] Return { ok: true, written }
 *
 * Partial-write contract (§9.3): K8_PROMOTION_WRITE_FAILED is the only
 * code under which a decision_event exists but the call returns ok: false.
 *
 * No ID generation. No timestamp generation. No K3–K7 calls.
 */

import type { K2WriteBackend } from "../pipeline/backend.js";
import type { K2PromotionBackend } from "../pipeline/backend.js";
import type { PromotionTarget } from "../pipeline/ingest.js";
import type { PromotionContext } from "../pipeline/promote.js";
import { ingestDecisionEvent } from "../pipeline/ingest.js";
import { executePromotion } from "../pipeline/promote.js";

import type {
  DecisionIngestRequest,
  DecisionIngestResult,
  WrittenRecords,
} from "./types.js";
import { K8_ERROR_CODE } from "./types.js";
import { validateDecisionIngestRequest } from "./params.js";
import { constructDecisionInput } from "./construct.js";

// ---------------------------------------------------------------------------
// K8Backend — combined write + promotion surface required by K8
// ---------------------------------------------------------------------------

export type K8Backend = K2WriteBackend & K2PromotionBackend;

// ---------------------------------------------------------------------------
// ingestGovernanceDecision — §9.1
// ---------------------------------------------------------------------------

export function ingestGovernanceDecision(
  backend: K8Backend,
  request: DecisionIngestRequest,
): DecisionIngestResult {
  // [1] Parameter validation — no K2 calls on failure
  const validation = validateDecisionIngestRequest(request);
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  // [2] Decision construction — pure derivation (§7)
  const decisionInput = constructDecisionInput(request);

  // [3] Phase 1 — Decision write
  const decisionResult = ingestDecisionEvent(backend, decisionInput);
  if (!decisionResult.ok) {
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_DECISION_WRITE_FAILED,
      message: decisionResult.message,
    };
  }

  const decisionEventId = decisionResult.decision.id;

  // [4] Promotion check — skip Phase 2 if no promotion_directive
  if (!request.promotion_directive) {
    const written: WrittenRecords = {
      decision_event_id: decisionEventId,
      promotion_written: false,
      semantic_fact_id: null,
      embedding_record_id: null,
    };
    return { ok: true, written };
  }

  // [5] Phase 2 — Promotion write
  // Map PromotionDirective to K2 PromotionTarget.
  // All Date fields use the caller-supplied timestamp (§9.2 — no K8 timestamp generation).
  const d = request.promotion_directive;
  const ts = new Date(request.timestamp);

  const target: PromotionTarget = {
    fact_id:                          d.fact_id,
    fact_type:                        d.fact_type,
    fact_key:                         d.fact_key,
    fact_value:                       d.fact_value,
    fact_created_at:                  ts,
    fact_event_id:                    d.fact_event_id,
    fact_event_observed_at:           ts,
    fact_event_created_at:            ts,
    embedding_id:                     d.embedding_record_id,
    embedding_created_at:             ts,
    embedding_status_id:              d.embedding_status_event_id,
    embedding_status_transitioned_at: ts,
    embedding_status_created_at:      ts,
  };

  const context: PromotionContext = {
    project_id:        request.project_id,
    schema_version:    request.schema_version,
    run_id:            request.run_id,
    episodic_event_id: request.episodic_event_id,
  };

  const promotionResult = executePromotion(backend, { eligible: true, target }, context);
  if (!promotionResult.ok) {
    // Partial-write state: decision_event written, promotion failed (§9.3)
    return {
      ok: false,
      code: K8_ERROR_CODE.K8_PROMOTION_WRITE_FAILED,
      message: promotionResult.message,
    };
  }

  // [6] Return success
  const written: WrittenRecords = {
    decision_event_id:  decisionEventId,
    promotion_written:  true,
    semantic_fact_id:   promotionResult.chain.fact.id,
    embedding_record_id: promotionResult.chain.embedding.id,
  };
  return { ok: true, written };
}
