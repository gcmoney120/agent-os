/**
 * Agent OS v1.0 — Dispatcher Error Codes (Slices 3 + 4).
 *
 * Exact error codes and result types for dispatchRun.
 */

export type DispatchErrorCode =
  // ── Slice 3 ────────────────────────────────────────────────────────────────
  | "DISPATCH_INVALID_REQUEST"
  | "DISPATCH_STEP_INDEX_GAP"
  | "DISPATCH_CAPABILITIES_NOT_PERMITTED"
  | "DISPATCH_ADAPTER_LOAD_FAILED"
  | "DISPATCH_RUNNER_MISSING"
  | "DISPATCH_RUNNER_FAILED"
  | "DISPATCH_STEP_REPORT_MISSING"
  | "DISPATCH_STEP_REPORT_INVALID"
  | "DISPATCH_WRITE_FAILED"
  | "DISPATCH_ABORTED_AFTER_FAILURE"
  // ── Slice 4 ────────────────────────────────────────────────────────────────
  /** Pre-run gate: adapter governance fields missing or misconfigured. */
  | "ADAPTER_GOVERNANCE_MISCONFIGURED"
  /** Defensive assertion: state_impact is unknown despite passing validateStepReport. */
  | "STEP_REPORT_INVALID"
  /** trust_change step report missing non-empty trust_notes. */
  | "TRUST_CHANGE_MISSING_NOTES"
  /** Governance policy requires manual approval; dispatcher halted. */
  | "DISPATCH_HALTED_GOVERNANCE";

export interface DispatchError {
  code: DispatchErrorCode;
  message: string;
  cause?: unknown;
  step_index?: number;
  step_id?: string;
  actor?: string;
}

export type DispatchResult =
  | {
      ok: true;
      run_id: string;
      written_step_reports: Array<{
        step_index: number;
        step_id: string;
        path: string;
      }>;
    }
  | {
      ok: false;
      run_id?: string;
      error: DispatchError;
      written_step_reports?: Array<{
        step_index: number;
        step_id: string;
        path: string;
      }>;
    };
