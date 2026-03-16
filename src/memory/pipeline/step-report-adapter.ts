/**
 * Agent OS — Memory Write Pipeline K2
 * Step Report → RunStepIngestInput adapter.
 *
 * Source: agent-os/docs/architecture/memory-write-pipeline-v1.2.md
 * Slice: K2 — Memory Write Pipeline
 *
 * Converts a validated Foreman StepReportV1 into a fully normalized
 * RunStepIngestInput ready for ingestRunStep.
 *
 * Architecture boundary:
 *
 *   Foreman Step Report
 *           │
 *           ▼
 *   step-report-adapter.ts   ← this file (normalization only)
 *           │
 *           ▼
 *   run-ingest.ts            (orchestration)
 *           │
 *           ▼
 *   K2 pipeline units        (ingest + promote + backend)
 *
 * Scope — this adapter produces exactly one episodic event per Step Report:
 *   - STEP_SUCCEEDED when report.status === "succeeded"
 *   - STEP_FAILED    when report.status === "failed"
 *
 * Out of scope — not produced by this adapter:
 *   - decision_event records (governance decision mapping is not yet authorized)
 *   - promotionContext       (semantic promotion is an upstream concern)
 *
 * Strict invariants — this module must never:
 *   - generate IDs
 *   - generate timestamps
 *   - write to a database
 *   - execute promotions
 *   - perform orchestration
 *   - infer governance decisions from Step Report fields
 *
 * All IDs and timestamps are caller-supplied via StepReportAdapterContext.
 * occurred_at must be parsed from report.timestamp by the caller before
 * calling this function — no Date construction occurs inside this module.
 */

import type { StepReportV1 } from "../../step-report/stepReport.schema.js";
import type { RunStepIngestInput } from "./run-ingest.js";
import type { IngestEpisodicInput } from "./ingest.js";
import { K2_EVENT_TYPE } from "./types.js";

// ---------------------------------------------------------------------------
// StepReportAdapterContext
// All caller-supplied identifiers and timestamps.
// The adapter performs no ID generation and no timestamp generation.
// ---------------------------------------------------------------------------

export interface StepReportAdapterContext {
  /** Caller-supplied ID for the episodic event to be created. */
  readonly episodic_event_id: string;

  /** Project namespace for all records. */
  readonly project_id: string;

  /**
   * K2 pipeline schema version (e.g. "1.1").
   * Distinct from the Step Report's own schema_version field ("1.0").
   */
  readonly pipeline_schema_version: string;

  /** Session identifier for the run. */
  readonly session_id: string;

  /**
   * When the step occurred.
   * Caller must parse report.timestamp into a Date before calling this adapter.
   * Not generated inside this module.
   */
  readonly occurred_at: Date;

  /**
   * Write timestamp for the episodic event's created_at.
   * Caller-supplied; not generated here.
   */
  readonly created_at: Date;
}

// ---------------------------------------------------------------------------
// StepReportAdapterResult
// ---------------------------------------------------------------------------

export type StepReportAdapterResult =
  | { readonly ok: true; readonly input: RunStepIngestInput }
  | { readonly ok: false; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// adaptStepReport
//
// Maps a StepReportV1 + StepReportAdapterContext → RunStepIngestInput.
//
// Output shape:
//   { episodic: [one event], decisions: undefined, promotionContext: undefined }
//
// The returned RunStepIngestInput is ready to pass directly to ingestRunStep.
// ---------------------------------------------------------------------------

export function adaptStepReport(
  report: StepReportV1,
  context: StepReportAdapterContext,
): StepReportAdapterResult {

  // ── 1. Resolve event_type from report.status ───────────────────────────────

  const eventType =
    report.status === "succeeded"
      ? K2_EVENT_TYPE.STEP_SUCCEEDED
      : K2_EVENT_TYPE.STEP_FAILED;

  // ── 2. Build episodic payload ──────────────────────────────────────────────
  //
  // Step identity and report output fields are forwarded into the payload bag.
  // Optional fields are included only when present in the report.

  const payload: Record<string, unknown> = {
    step_id:      report.step_id,
    step_index:   report.step_index,
    action:       report.action,
    state_impact: report.state_impact,
    summary:      report.summary,
    artifacts:    report.artifacts,
  };

  if (report.output      !== undefined) payload.output      = report.output;
  if (report.metadata    !== undefined) payload.metadata    = report.metadata;
  if (report.tests       !== undefined) payload.tests       = report.tests;
  if (report.error       !== undefined) payload.error       = report.error;
  if (report.trust_notes !== undefined) payload.trust_notes = report.trust_notes;

  // ── 3. Build IngestEpisodicInput ───────────────────────────────────────────

  const episodic: IngestEpisodicInput = {
    id:             context.episodic_event_id,
    project_id:     context.project_id,
    schema_version: context.pipeline_schema_version,
    run_id:         report.run_id,
    session_id:     context.session_id,
    agent_role:     report.actor,
    event_type:     eventType,
    payload,
    occurred_at:    context.occurred_at,
    created_at:     context.created_at,
  };

  // ── 4. Return normalized RunStepIngestInput ────────────────────────────────
  //
  // decisions and promotionContext are deliberately absent.

  return {
    ok: true,
    input: { episodic: [episodic] },
  };
}
