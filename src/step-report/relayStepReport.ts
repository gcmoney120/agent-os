/**
 * Agent OS v1.0 — Step Report Relay (stub).
 *
 * Locks the contract for future "Command receives report" wiring.
 * In slice 2 this is a passthrough — returns the report unchanged.
 */

import type { StepReportV1 } from "./stepReport.schema.js";

/**
 * Relay a step report to the caller (Command).
 * Stub: returns the report as-is. Future slices will wire this
 * to the Command dispatcher.
 */
export function relayStepReport(report: StepReportV1): StepReportV1 {
  return report;
}
