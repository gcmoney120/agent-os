/**
 * Agent OS v1.0 — Dispatcher Error Codes (Slices 3 + 4 + 8).
 *
 * Exact error codes and result types for dispatchRun / dispatchResume.
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
  // ── Slice 6 ────────────────────────────────────────────────────────────────
  /** Runner returned success=true but the output field is null. */
  | "EXECUTOR_INVALID_RESULT"
  /** Action requires output but step report contains no output field. */
  | "OUTPUT_REQUIRED_MISSING"
  /** Step report contains an output field but runner never invoked writeOutput capability. */
  | "CAPABILITY_REQUIRED_NOT_USED"
  /** Governance policy requires manual approval; dispatcher halted. */
  | "DISPATCH_HALTED_GOVERNANCE"
  // ── Slice K9 ───────────────────────────────────────────────────────────────
  /** K7 memory context retrieval failed before step execution. */
  | "MEMORY_RETRIEVAL_FAILED"
  // ── Slice 8 ────────────────────────────────────────────────────────────────
  /** Approval artifact file not found on disk. */
  | "APPROVAL_ARTIFACT_MISSING"
  /** Approval artifact JSON failed to parse or schema_version mismatch. */
  | "APPROVAL_ARTIFACT_INVALID"
  /** Approval artifact identity fields do not match resume request + step definition. */
  | "APPROVAL_IDENTITY_MISMATCH"
  /** Step report referenced by approval artifact not found on disk. */
  | "APPROVAL_REPORT_NOT_FOUND"
  /** step_report_sha256 in approval does not match on-disk step-report.json. */
  | "APPROVAL_INTEGRITY_FAILED";

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
