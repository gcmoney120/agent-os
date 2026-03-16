/**
 * Agent OS v1.0 — Dispatcher Type Contracts (Slices 3 + 8 + K9).
 *
 * DispatchRequest, FrozenStepContext, RunnerRegistry, DispatchDeps,
 * ApprovalArtifact, and ResumeRequest.
 * Actor keys match Slice 2.
 */

import type { MemoryContextResult } from "../memory/memory-context/types.js";

// ── Actor keys (must match Slice 2) ──────────────────────────────────────────

export type ActorKey = "command" | "atlas" | "forge" | "sentinel" | "compass";

// ── DispatchRequest v1.0 ─────────────────────────────────────────────────────

export interface DispatchRequestV1 {
  schema_version: "1.0";
  run_id: string;
  project_root: string;
  artifacts_root: string;
  steps: DispatchStepV1[];
}

export interface DispatchStepV1 {
  step_index: number;
  step_id: string;
  actor: ActorKey;
  action: string;
  input_ref?: InputRef;
  capabilities: string[];
}

export type InputRef =
  | { kind: "inline"; value: unknown }
  | { kind: "file"; path: string };

// ── FrozenStepContext ────────────────────────────────────────────────────────

// Forward-declared to avoid circular import from memory-context layer.
// Populated by K7 attachMemoryContext only; optional — executors must treat
// context.memory === undefined as the normal no-memory case (AC-K7-04).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryContextRef = any;

export interface FrozenStepContext {
  run_id: string;
  step_index: number;
  step_id: string;
  actor: ActorKey;
  action: string;
  project_root: string;
  artifacts_root: string;
  input?: unknown;
  capabilities: string[];
  adapter: unknown;
  /** K7: optional read-only memory package. Absent when K7 attach was not called. */
  memory?: MemoryContextRef;
}

// ── Runner contracts ─────────────────────────────────────────────────────────

export interface StepRunner {
  run(ctx: FrozenStepContext): Promise<RunnerOutput>;
}

export interface RunnerOutput {
  step_report?: unknown;
  raw_log?: string;
  /**
   * Number of times the runner invoked the writeOutput capability.
   * When present and === 0, the dispatcher may raise CAPABILITY_REQUIRED_NOT_USED
   * if the step report contains an output field.
   * Omitting this field disables the capability-usage check for this step.
   */
  write_output_calls?: number;
}

export interface RunnerRegistry {
  command: StepRunner;
  atlas: StepRunner;
  forge: StepRunner;
  sentinel: StepRunner;
  compass: StepRunner;
}

// ── Dispatcher dependencies ──────────────────────────────────────────────────

export interface DispatchDeps {
  loadProjectAdapter: (
    project_root: string,
  ) => Promise<
    { ok: true; adapter: unknown } | { ok: false; error: unknown }
  >;

  validateStepReport: (
    step_report: unknown,
  ) => { ok: true } | { ok: false; code: string; message: string };

  writeStepReport: (args: {
    artifacts_root: string;
    step_index: number;
    step_id: string;
    step_report: unknown;
  }) => Promise<{ ok: true; path: string } | { ok: false; error: unknown }>;

  writeTextFile?: (path: string, contents: string) => Promise<void>;
  writeJsonFile?: (path: string, value: unknown) => Promise<void>;
  ensureDir?: (path: string) => Promise<void>;

  /** Slice 8: Read a file as UTF-8 string. Required for dispatchResume. */
  readFile?: (path: string) => Promise<string>;

  /** Slice 8: Check if a file exists. Required for dispatchResume. */
  fileExists?: (path: string) => Promise<boolean>;

  /** Slice 8: Compute sha256 hex of a file's bytes. Required for dispatchResume. */
  sha256File?: (path: string) => Promise<string>;

  /**
   * K9: Resolve MemoryContext for the current run.
   * Called once per step, before step execution begins.
   * On failure the dispatcher halts with MEMORY_RETRIEVAL_FAILED.
   */
  resolveMemoryContext: (runId: string, projectRoot: string) => Promise<MemoryContextResult>;

  /**
   * K9: Emit a ledger event (step.failed / run.failed on retrieval failure).
   * Optional — events are silently skipped when not provided.
   * Does not alter executor-facing contracts or existing production behavior.
   */
  appendEvent?: (event: { type: string; detail: Record<string, unknown> }) => Promise<void>;

  runnerRegistry: RunnerRegistry;
}

// ── Slice 8: Approval Artifact ──────────────────────────────────────────────

export interface ApprovalArtifact {
  schema_version: "1";
  run_id: string;
  step_index: number;
  step_id: string;
  actor: string;
  action: string;
  state_impact: string;
  approved_by: string;
  approval_note: string;
  step_report_sha256: string;
}

// ── Slice 8: Resume Request ─────────────────────────────────────────────────

export interface ResumeRequest {
  run_id: string;
  step_index: number;
  step_id: string;
}
