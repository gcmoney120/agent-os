/**
 * Agent OS — Memory Write Pipeline K2
 * Deterministic ingestion orchestrator.
 *
 * Source: agent-os/docs/architecture/memory-write-pipeline-v1.2.md
 * Slice: K2 — Memory Write Pipeline
 *
 * Pure orchestration layer over caller-supplied structured input.
 * All IDs and timestamps are caller-supplied.
 * No time generation. No ID generation. No raw file parsing.
 * Input shapes are module-local types, not canonical upstream contracts.
 *
 * Promotion writes are not performed in this unit.
 * Promotion eligibility is validated and reported in the result.
 */

import type {
  K2EventType,
  K2EpisodicEvent,
  K2DecisionEvent,
} from "./types.js";

import type { K2WriteBackend } from "./backend.js";

// ---------------------------------------------------------------------------
// Local input shapes — not canonical upstream contracts.
// ---------------------------------------------------------------------------

export interface IngestEpisodicInput {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;
  readonly run_id: string;
  readonly session_id: string;
  readonly agent_role: string;
  readonly event_type: K2EventType;
  readonly payload: Record<string, unknown>;
  readonly occurred_at: Date;
  readonly created_at: Date;
}

export interface PromotionTarget {
  readonly fact_id: string;
  readonly fact_type: string;
  readonly fact_key: string;
  readonly fact_value: Record<string, unknown>;
  readonly fact_created_at: Date;
  readonly fact_event_id: string;
  readonly fact_event_observed_at: Date;
  readonly fact_event_created_at: Date;
  readonly embedding_id: string;
  readonly embedding_created_at: Date;
  readonly embedding_status_id: string;
  readonly embedding_status_transitioned_at: Date;
  readonly embedding_status_created_at: Date;
}

export interface IngestDecisionInput {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;
  readonly run_id: string;
  readonly decision_type: string;
  readonly actor_role: string;
  readonly episodic_event_id: string;
  readonly decision_payload: Record<string, unknown>;
  readonly decided_at: Date;
  readonly created_at: Date;
  readonly promotion?: PromotionTarget;
}

// ---------------------------------------------------------------------------
// Result types.
// ---------------------------------------------------------------------------

export type PromotionEligible =
  | { readonly eligible: false }
  | { readonly eligible: true; readonly target: PromotionTarget };

export type IngestEpisodicResult =
  | { readonly ok: true; readonly event: K2EpisodicEvent }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type IngestDecisionResult =
  | { readonly ok: true; readonly decision: K2DecisionEvent; readonly promotionEligible: PromotionEligible }
  | { readonly ok: false; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// ingestEpisodicEvent
// ---------------------------------------------------------------------------

export function ingestEpisodicEvent(
  backend: K2WriteBackend,
  input: IngestEpisodicInput,
): IngestEpisodicResult {
  // 1. Terminal guard.
  if (backend.hasTerminalEvent(input.run_id)) {
    return {
      ok: false,
      code: "INGEST_RUN_TERMINATED",
      message: `Run ${input.run_id} already has a terminal event`,
    };
  }

  // 2. Build record from caller-supplied fields.
  const event: K2EpisodicEvent = {
    id: input.id,
    project_id: input.project_id,
    schema_version: input.schema_version,
    run_id: input.run_id,
    session_id: input.session_id,
    agent_role: input.agent_role,
    event_type: input.event_type,
    payload: input.payload,
    occurred_at: input.occurred_at,
    created_at: input.created_at,
  };

  // 3. Append.
  const result = backend.appendEpisodicEvent(event);
  if (!result.ok) {
    return {
      ok: false,
      code: "INGEST_DUPLICATE",
      message: `episodic_event duplicate: id=${input.id}`,
    };
  }

  return { ok: true, event: result.record };
}

// ---------------------------------------------------------------------------
// ingestDecisionEvent
// ---------------------------------------------------------------------------

export function ingestDecisionEvent(
  backend: K2WriteBackend,
  input: IngestDecisionInput,
): IngestDecisionResult {
  // 1. Terminal guard.
  if (backend.hasTerminalEvent(input.run_id)) {
    return {
      ok: false,
      code: "INGEST_RUN_TERMINATED",
      message: `Run ${input.run_id} already has a terminal event`,
    };
  }

  // 2. Promotion authority check — before any writes.
  const promoteRequested = input.decision_payload.promote_to_semantic === true;
  if (promoteRequested && input.actor_role !== "command") {
    return {
      ok: false,
      code: "INGEST_PROMOTION_FORBIDDEN",
      message: `Only actor_role "command" may promote to semantic; got "${input.actor_role}"`,
    };
  }

  // 3. Promotion target check — before any writes.
  if (promoteRequested && !input.promotion) {
    return {
      ok: false,
      code: "INGEST_PROMOTION_MISSING",
      message: "decision_payload.promote_to_semantic is true but no promotion target supplied",
    };
  }

  // 4. Append decision_event.
  const decision: K2DecisionEvent = {
    id: input.id,
    project_id: input.project_id,
    schema_version: input.schema_version,
    run_id: input.run_id,
    decision_type: input.decision_type,
    actor_role: input.actor_role,
    episodic_event_id: input.episodic_event_id,
    decision_payload: input.decision_payload,
    decided_at: input.decided_at,
    created_at: input.created_at,
  };

  const decisionResult = backend.appendDecisionEvent(decision);
  if (!decisionResult.ok) {
    return {
      ok: false,
      code: "INGEST_DUPLICATE",
      message: "decision_event duplicate",
    };
  }

  // 5. Determine promotion eligibility — no promotion writes in this unit.
  const promotionEligible: PromotionEligible =
    promoteRequested && input.promotion
      ? { eligible: true, target: input.promotion }
      : { eligible: false };

  return { ok: true, decision: decisionResult.record, promotionEligible };
}
