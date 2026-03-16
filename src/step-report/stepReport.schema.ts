/**
 * Agent OS v1.0 — Step Report Schema.
 *
 * Locked contract for step-level output reporting.
 * All fields are required unless noted.
 */

/** The five canonical actor keys. */
export type ActorKey = "command" | "atlas" | "forge" | "sentinel" | "compass";

/** Classification of a step's impact on system state. */
export type StateImpact = "none" | "trivial" | "trust_change" | "phase_boundary";

/** Fully validated step report — v1.0. */
export interface StepReportV1 {
  /** Must be exactly "1.0". */
  schema_version: "1.0";

  /** Unique identifier for the run this step belongs to. */
  run_id: string;

  /** Unique identifier for this step within the run. */
  step_id: string;

  /** Zero-based ordinal position of this step in the run. */
  step_index: number;

  /** Actor that executed this step. */
  actor: ActorKey;

  /** Dotted action name (e.g. "forge.implement"). */
  action: string;

  /** Whether the step succeeded or failed. */
  status: "succeeded" | "failed";

  /**
   * Whether the step succeeded. Must be consistent with status.
   * Added in Atlas §2 conformance (Slice 6).
   */
  success: boolean;

  /**
   * Structured error produced when success === false.
   * Required when success === false. Forbidden when success === true.
   */
  error?: {
    /** Machine-readable error code (non-empty string). */
    code: string;
    /** Human-readable description (non-empty string). */
    message: string;
    /** Optional JSON-serializable detail bag. */
    detail?: Record<string, unknown>;
  };

  /** Human-readable summary of what this step did. */
  summary: string;

  /** Paths to artifacts produced by this step. */
  artifacts: {
    result_path?: string;
    diff_path?: string;
    additional_paths?: string[];
  };

  /**
   * Structured output produced by this step.
   * Must not be null if present.
   */
  output?: unknown;

  /**
   * Arbitrary serializable metadata about this step.
   * Must be a plain JSON-serializable object.
   */
  metadata?: Record<string, unknown>;

  /** Test results, if the step ran tests. Optional. */
  tests?: {
    passed: number;
    total: number;
  };

  /** Classification of this step's impact on system state. */
  state_impact: StateImpact;

  /** Required when state_impact === "trust_change". Optional otherwise. */
  trust_notes?: string;

  /** ISO-8601 timestamp of step completion. */
  timestamp: string;
}
