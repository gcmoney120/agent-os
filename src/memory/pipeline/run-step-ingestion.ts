/**
 * Agent OS — Memory Write Pipeline K2
 * Foreman → Memory ingestion entrypoint.
 *
 * Source: agent-os/docs/architecture/memory-write-pipeline-v1.2.md
 * Slice: K2 — Memory Write Pipeline
 *
 * Execution path:
 *
 *   StepReportV1
 *        │
 *        ▼
 *   adaptStepReport()   — normalization
 *        │
 *        ▼
 *   ingestRunStep()     — K2 pipeline orchestration
 *
 * This unit is purely pipeline wiring. No new logic is introduced.
 * No ID generation. No timestamp generation. No DB writes.
 * No orchestration. No promotion logic. No decision construction.
 * No mutation of adapter output.
 */

import type { StepReportV1 } from "../../step-report/stepReport.schema.js";
import type { K2WriteBackend, K2PromotionBackend } from "./backend.js";
import type { StepReportAdapterContext } from "./step-report-adapter.js";
import { adaptStepReport } from "./step-report-adapter.js";
import { ingestRunStep } from "./run-ingest.js";
import type { RunStepIngestResult } from "./run-ingest.js";

// ---------------------------------------------------------------------------
// ingestStepReport
//
// Wires adaptStepReport → ingestRunStep.
//
// On adapter failure: returns the adapter error unchanged.
// On adapter success: passes the normalized input to ingestRunStep and
//                     returns its result unchanged.
// ---------------------------------------------------------------------------

export function ingestStepReport(
  backend: K2WriteBackend & Partial<K2PromotionBackend>,
  report: StepReportV1,
  context: StepReportAdapterContext,
): RunStepIngestResult {
  const adapted = adaptStepReport(report, context);

  if (!adapted.ok) {
    return { ok: false, code: adapted.code, message: adapted.message };
  }

  return ingestRunStep(backend, adapted.input);
}
