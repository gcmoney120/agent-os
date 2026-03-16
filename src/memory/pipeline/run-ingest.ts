/**
 * Agent OS — Memory Write Pipeline K2
 * Pre-normalized K2 write pipeline orchestrator.
 *
 * Source: agent-os/docs/architecture/memory-write-pipeline-v1.2.md
 * Slice: K2 — Memory Write Pipeline
 *
 * Accepts already-structured K2 pipeline inputs and executes them in
 * deterministic order against the supplied backend.
 *
 * Execution order (locked):
 *   1. Episodic events — contract: episodic must not be empty (INGEST_EPISODIC_EMPTY).
 *                        ingestEpisodicEvent per entry; fail-fast on first error.
 *   2. Decision events — ingestDecisionEvent per entry; collect eligible
 *                        promotion targets; fail-fast on first error.
 *   3. Promotion       — executePromotion per eligible target when:
 *                          backend implements K2PromotionBackend
 *                          AND input.promotionContext is provided.
 *                        Silently skipped when either condition is absent.
 *                        Fail-fast on first promotion error.
 *
 * No raw artifact parsing. No ID generation. No time generation. No async.
 */

import type { K2WriteBackend, K2PromotionBackend } from "./backend.js";
import type { IngestEpisodicInput, IngestDecisionInput, PromotionEligible } from "./ingest.js";
import { ingestEpisodicEvent, ingestDecisionEvent } from "./ingest.js";
import { executePromotion } from "./promote.js";
import type { PromotionContext } from "./promote.js";

// Re-export collaborator types for single-import convenience.
export type { IngestEpisodicInput, IngestDecisionInput, PromotionContext };

// ---------------------------------------------------------------------------
// RunStepIngestInput
// All IDs and timestamps are caller-supplied on the nested input records.
// No top-level identity fields are duplicated here; each nested record
// carries its own identity.
// ---------------------------------------------------------------------------

export interface RunStepIngestInput {
  /**
   * Episodic events to write for this step.
   * Contract: must not be empty — returns INGEST_EPISODIC_EMPTY if so.
   */
  readonly episodic: IngestEpisodicInput[];

  /** Decision events produced during this step. Optional. */
  readonly decisions?: IngestDecisionInput[];

  /**
   * Required only when a decision returns promotionEligible AND the backend
   * supports K2PromotionBackend. Caller-supplied; never generated here.
   */
  readonly promotionContext?: PromotionContext;
}

// ---------------------------------------------------------------------------
// RunStepIngestResult
// ok:true  → exact record counts.
// ok:false → error forwarded verbatim from the failing sub-operation,
//            or INGEST_EPISODIC_EMPTY for the empty-episodic contract.
// ---------------------------------------------------------------------------

export type RunStepIngestResult =
  | {
      readonly ok: true;
      readonly episodicWritten: number;
      readonly decisionsWritten: number;
      readonly promotionsExecuted: number;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// ingestRunStep
// ---------------------------------------------------------------------------

export function ingestRunStep(
  backend: K2WriteBackend & Partial<K2PromotionBackend>,
  input: RunStepIngestInput,
): RunStepIngestResult {

  // ── Contract: episodic must not be empty ──────────────────────────────────

  if (input.episodic.length === 0) {
    return {
      ok: false,
      code: "INGEST_EPISODIC_EMPTY",
      message: "episodic must contain at least one event",
    };
  }

  // ── 1. Episodic events ────────────────────────────────────────────────────

  let episodicWritten = 0;

  for (const ev of input.episodic) {
    const result = ingestEpisodicEvent(backend, ev);
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }
    episodicWritten++;
  }

  // ── 2. Decision events ────────────────────────────────────────────────────

  let decisionsWritten = 0;
  const eligiblePromotions: Array<PromotionEligible & { eligible: true }> = [];

  for (const dec of (input.decisions ?? [])) {
    const result = ingestDecisionEvent(backend, dec);
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }
    decisionsWritten++;
    if (result.promotionEligible.eligible) {
      eligiblePromotions.push(result.promotionEligible);
    }
  }

  // ── 3. Promotion execution ────────────────────────────────────────────────

  let promotionsExecuted = 0;

  const promotionBackend: K2PromotionBackend | null =
    typeof (backend as Partial<K2PromotionBackend>).appendPromotionChain === "function"
      ? (backend as K2PromotionBackend)
      : null;

  if (promotionBackend !== null && input.promotionContext !== undefined) {
    for (const eligible of eligiblePromotions) {
      const result = executePromotion(promotionBackend, eligible, input.promotionContext);
      if (!result.ok) {
        return { ok: false, code: result.code, message: result.message };
      }
      promotionsExecuted++;
    }
  }

  return {
    ok: true,
    episodicWritten,
    decisionsWritten,
    promotionsExecuted,
  };
}
