/**
 * Agent OS — Runtime Integration Layer R3
 * Memory ingestion post-execution: ingestCompletedSteps
 *
 * Binding Contract 4: After each successful run, step reports are ingested
 * into the Memory pipeline for future context retrieval.
 *
 * AC-R3-06: Memory ingestion appends step report data to MemoryStore after
 *           successful steps when a persistence backend is available.
 * AC-R3-07: Memory ingestion failure does not fail the run (graceful degradation).
 *
 * Scope:
 *   - Reads step-report.json from artifacts_root for each completed step
 *   - Calls K12 step-report adapter (adaptStepReport) to produce memory records
 *   - Ingests via K2 write pipeline (ingestStepReport)
 *   - Appends to InMemoryK2Backend via the persistence backend
 *
 * Invariants:
 *   - Never throws — all errors are swallowed (graceful degradation)
 *   - Never mutates the dispatch result or the context
 *   - Only runs when dispatchResult.ok is true (completed steps only)
 */

import * as fs from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeContext } from "./types.js";
import type { DispatchResult } from "../dispatcher/errors.js";
import type { StepReportV1 } from "../step-report/stepReport.schema.js";
import { InMemoryPersistenceBackend } from "./providers-inmemory.js";
import { ingestStepReport } from "../memory/pipeline/run-step-ingestion.js";
import type { StepReportAdapterContext } from "../memory/pipeline/step-report-adapter.js";

// ── ingestCompletedSteps ──────────────────────────────────────────────────────

/**
 * Ingest completed step reports into the K2 memory pipeline.
 *
 * Reads each step-report.json from disk, adapts via K12 step-report adapter,
 * and writes to the K2 backend. Silently skips on any error (parse failure,
 * missing file, pipeline error) so that memory ingestion failures never
 * propagate to the run result.
 *
 * Only runs when:
 *   1. dispatchResult.ok is true (completed steps have artifacts)
 *   2. persistence backend is an InMemoryPersistenceBackend (K2 backend available)
 */
export async function ingestCompletedSteps(
  context: RuntimeContext,
  dispatchResult: DispatchResult,
): Promise<void> {
  // Only ingest after successful dispatch (AC-R3-06)
  if (!dispatchResult.ok) {
    return;
  }

  // K2 backend is only available on InMemoryPersistenceBackend in R-series.
  // Gracefully skip when a different persistence backend is in use.
  if (!(context.persistence instanceof InMemoryPersistenceBackend)) {
    return;
  }

  const k2Backend = context.persistence.k2Backend();
  const now = new Date();
  const projectId = context.config.projectRoot;

  for (const reportRef of dispatchResult.written_step_reports) {
    try {
      // Read and parse step-report.json
      const raw = await fs.readFile(reportRef.path, "utf8");
      const parsed: unknown = JSON.parse(raw);

      // Basic structural check before passing to adapter
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as Record<string, unknown>).run_id !== "string"
      ) {
        // Invalid structure — skip silently (AC-R3-07)
        continue;
      }

      const report = parsed as StepReportV1;

      // Build adapter context with caller-supplied IDs and timestamps
      const occurred_at = report.timestamp ? new Date(report.timestamp) : now;
      const adapterCtx: StepReportAdapterContext = {
        episodic_event_id: `ep_${report.run_id}_${report.step_index}_${Date.now()}`,
        project_id: projectId,
        pipeline_schema_version: "1.1",
        session_id: report.run_id,
        occurred_at,
        created_at: now,
      };

      // Ingest via K12 adapter + K2 pipeline (AC-R3-06)
      // Result is ignored — failure is graceful (AC-R3-07)
      ingestStepReport(k2Backend, report, adapterCtx);
    } catch {
      // Any error (file read, JSON parse, pipeline error) is swallowed.
      // Memory ingestion must never fail the run (AC-R3-07).
    }
  }
}
