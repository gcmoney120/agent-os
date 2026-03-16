/**
 * Agent OS — Memory Write Pipeline K2
 * Semantic promotion orchestrator.
 *
 * Source: agent-os/docs/architecture/memory-write-pipeline-v1.2.md
 * Slice: K2 — Memory Write Pipeline
 *
 * Thin orchestrator that builds the 4 promotion records from
 * PromotionTarget + PromotionContext, then delegates to the atomic
 * K2PromotionBackend.appendPromotionChain for fail-closed commit.
 *
 * No time generation. No ID generation. No raw file parsing.
 * All fields are caller-supplied via PromotionTarget and PromotionContext.
 */

import type {
  K2SemanticFact,
  K2SemanticFactEvent,
  K2EmbeddingRecord,
  K2EmbeddingStatusEvent,
} from "./types.js";

import type { K2PromotionBackend } from "./backend.js";
import type { PromotionTarget, PromotionEligible } from "./ingest.js";

// ---------------------------------------------------------------------------
// Local types — not canonical upstream contracts.
// ---------------------------------------------------------------------------

export interface PromotionContext {
  readonly project_id: string;
  readonly schema_version: string;
  readonly run_id: string;
  readonly episodic_event_id: string;
}

export interface PromotionChainResult {
  readonly fact: K2SemanticFact;
  readonly factEvent: K2SemanticFactEvent;
  readonly embedding: K2EmbeddingRecord;
  readonly embeddingStatus: K2EmbeddingStatusEvent;
}

export type PromoteResult =
  | { readonly ok: true; readonly chain: PromotionChainResult }
  | { readonly ok: false; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// executePromotion
// ---------------------------------------------------------------------------

export function executePromotion(
  backend: K2PromotionBackend,
  eligible: PromotionEligible & { eligible: true },
  context: PromotionContext,
): PromoteResult {
  const target = eligible.target;

  // Build the 4 records from PromotionTarget + PromotionContext.

  const fact: K2SemanticFact = {
    id: target.fact_id,
    project_id: context.project_id,
    schema_version: context.schema_version,
    fact_type: target.fact_type,
    fact_key: target.fact_key,
    fact_value: target.fact_value,
    source_run_id: context.run_id,
    created_at: target.fact_created_at,
  };

  const factEvent: K2SemanticFactEvent = {
    id: target.fact_event_id,
    project_id: context.project_id,
    schema_version: context.schema_version,
    semantic_fact_id: target.fact_id,
    episodic_event_id: context.episodic_event_id,
    observed_at: target.fact_event_observed_at,
    created_at: target.fact_event_created_at,
  };

  const embedding: K2EmbeddingRecord = {
    id: target.embedding_id,
    project_id: context.project_id,
    schema_version: context.schema_version,
    semantic_fact_id: target.fact_id,
    status: "PENDING",
    model_id: null,
    embedding: null,
    created_at: target.embedding_created_at,
  };

  const embeddingStatus: K2EmbeddingStatusEvent = {
    id: target.embedding_status_id,
    project_id: context.project_id,
    schema_version: context.schema_version,
    embedding_record_id: target.embedding_id,
    previous_status: null,
    new_status: "PENDING",
    transition_reason: "promotion",
    transitioned_at: target.embedding_status_transitioned_at,
    created_at: target.embedding_status_created_at,
  };

  // Delegate to atomic backend.
  const result = backend.appendPromotionChain({ fact, factEvent, embedding, embeddingStatus });

  if (!result.ok) {
    return {
      ok: false,
      code: "PROMOTE_DUPLICATE",
      message: `${result.table} duplicate during promotion`,
    };
  }

  return {
    ok: true,
    chain: result.chain,
  };
}
