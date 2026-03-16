/**
 * Agent OS v1.0 — Step Report Writer.
 *
 * Writes a validated StepReportV1 to the run artifact tree:
 *   <runRoot>/<run_id>/steps/<step_index>-<step_id>/step-report.json
 *
 * Creates directories as needed. Never throws.
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { StepReportV1 } from "./stepReport.schema.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type WriteResult =
  | { ok: true; path: string }
  | { ok: false; code: string; message: string };

// ── Writer ────────────────────────────────────────────────────────────────────

export function writeStepReport(runRoot: string, report: StepReportV1): WriteResult {
  const stepDir = join(
    runRoot,
    report.run_id,
    "steps",
    `${report.step_index}-${report.step_id}`,
  );
  const filePath = join(stepDir, "step-report.json");

  try {
    mkdirSync(stepDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      code: "STEP_REPORT_WRITE_ERROR",
      message: `failed to create directory ${stepDir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    writeFileSync(filePath, JSON.stringify(report, null, 2) + "\n", "utf8");
  } catch (err) {
    return {
      ok: false,
      code: "STEP_REPORT_WRITE_ERROR",
      message: `failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, path: filePath };
}
