/**
 * Agent OS — Knowledge Layer K11 + K12 + K13
 * Foreman Artifact Adapter — deterministic, stateless normalization layer.
 *
 * Source: K11 Architecture Specification
 *         K12 Architecture Specification
 *         K13 Architecture Specification
 * Slices: K11 — Run Ingest Adapter (Foreman → K2)
 *         K12 — Governance Decision Adapter (Foreman → K2)
 *         K13 — Capability-Used Adapter (Foreman → K2)
 *
 * Transforms an ordered sequence of raw Foreman artifact events into a
 * validated RunStepIngestInput ready for handoff to the existing ingestRunStep
 * entrypoint (run-ingest.ts).
 *
 * Architecture boundary:
 *
 *   ForemanArtifact[]
 *           │
 *           ▼
 *   artifact-adapter.ts   ← this file (validation + normalization only)
 *           │
 *           ▼
 *   run-ingest.ts         (caller passes ingestInput to ingestRunStep)
 *           │
 *           ▼
 *   K2 pipeline units     (ingest + promote + backend)
 *
 * K11 Invariants (enforced):
 *
 *   INV-K11-01 — Stateless. No mutable state between calls.
 *   INV-K11-02 — Fail-closed on unknown artifact type.
 *   INV-K11-03 — Fail-closed on schema version violation (step.started).
 *   INV-K11-04 — Full structural validation completes before normalization.
 *   INV-K11-05 — Input artifact order is preserved in output episodic array.
 *   INV-K11-06 — No ID or timestamp generation.
 *   INV-K11-07 — run-ingest.ts is not called or modified by this module.
 *
 * K12 Invariants (enforced):
 *
 *   INV-K12-01 — Adapter remains stateless.
 *   INV-K12-02 — Promotion authority enforced at normalization time:
 *                governance.decision produces a decision input only when
 *                promote_to_semantic === true AND actor_role === "COMMAND".
 *   INV-K12-03 — TRUST_CHANGE_DECLARED is never promotable.
 *   INV-K12-04 — GOVERNANCE_HALT is never promotable.
 *   INV-K12-05 — Fail-closed on missing required governance.decision fields.
 *   INV-K12-06 — actor_role is a passthrough field; only === "COMMAND" is
 *                evaluated for promotion gating. No enum validation.
 *   INV-K12-07 — Governance artifact ordering is preserved in episodic output.
 *   INV-K12-08 — No ID or timestamp generation.
 *   INV-K12-09 — adaptForeman signature is unchanged.
 *
 * K13 Invariants (enforced):
 *
 *   INV-K13-01 — Adapter remains stateless.
 *   INV-K13-02 — capability.used is episodic-only. No decision output.
 *   INV-K13-03 — promote_to_semantic on capability.used is ignored.
 *   INV-K13-04 — Fail-closed on missing required capability.used fields:
 *                step_id, capability_id, invocation_id, actor_role, occurred_at.
 *   INV-K13-05 — capability.used requires a preceding run.started in sequence.
 *   INV-K13-06 — Artifact ordering preserved in episodic output.
 *   INV-K13-07 — No ID or timestamp generation.
 *   INV-K13-08 — adaptForeman signature is unchanged.
 *
 * No ID generation. No timestamp generation. No database writes.
 * No calls to runIngest — caller is responsible for the handoff.
 */

import type { RunStepIngestInput, IngestEpisodicInput, IngestDecisionInput } from "./run-ingest.js";
import { K2_EVENT_TYPE } from "./types.js";

// ── ForemanArtifact ───────────────────────────────────────────────────────────

/**
 * A single Foreman execution artifact event presented to the K11 adapter.
 *
 * All identity and timing fields (id, run_id, project_id,
 * pipeline_schema_version, session_id, ts) are pre-populated by the caller
 * before being passed to adaptForeman.
 *
 * The adapter does not generate IDs or timestamps (INV-K11-06).
 *
 * Step-specific fields (actor, step_id, step_index, action) are required
 * on step.started / step.succeeded / step.failed artifacts.
 *
 * K10 fields (step_schema_version, memory_context_hash) are validated and
 * extracted from step.started artifacts only.
 *
 * All additional fields beyond the typed ones are forwarded into the
 * episodic payload bag unchanged.
 */
export interface ForemanArtifact {
  /** Event type discriminant (e.g. "run.started", "step.started"). */
  readonly type: string;

  /** Caller-supplied unique identifier for this event record. */
  readonly id: string;

  /** Run identifier shared across all artifacts in this sequence. */
  readonly run_id: string;

  /** Project namespace for all records. */
  readonly project_id: string;

  /**
   * K2 pipeline schema version (e.g. "1.1").
   * Distinct from the step-report schema_version field.
   */
  readonly pipeline_schema_version: string;

  /** Session identifier for the run. */
  readonly session_id: string;

  /** ISO 8601 timestamp string of when the event occurred. */
  readonly ts: string;

  /** All additional artifact fields (actor, step_id, step_index, action,
   *  step_schema_version, memory_context_hash, reason, etc.). */
  readonly [key: string]: unknown;
}

// ── AdapterErrorCode ──────────────────────────────────────────────────────────

export type AdapterErrorCode =
  | "ADAPTER_UNKNOWN_EVENT_TYPE"
  | "ADAPTER_STEP_SCHEMA_VERSION_MISSING"
  | "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN"
  | "ADAPTER_MISSING_REQUIRED_FIELD"
  | "ADAPTER_ARTIFACT_SEQUENCE_INVALID";

// ── AdapterResult ─────────────────────────────────────────────────────────────

export type AdapterResult =
  | { readonly ok: true; readonly ingestInput: RunStepIngestInput }
  | { readonly ok: false; readonly code: AdapterErrorCode; readonly detail: string };

// ── Internal constants ────────────────────────────────────────────────────────

/** Recognized artifact event types (closed enum — K11 v1 + K12 + K13 extension). */
const RECOGNIZED_TYPES = new Set([
  // K11 run + step lifecycle
  "run.started",
  "step.started",
  "step.succeeded",
  "step.failed",
  "run.succeeded",
  "run.failed",
  // K12 governance + trust
  "governance.decision",
  "governance.halt",
  "trust.change_declared",
  // K13 capability evidence
  "capability.used",
]);

/**
 * Artifact types that represent per-step execution events.
 * These require a preceding run.started in the sequence (INV-K11-02 sequencing)
 * and must carry the step identity fields (step_id, actor, action, step_index).
 */
const STEP_ARTIFACT_TYPES = new Set([
  "step.started",
  "step.succeeded",
  "step.failed",
]);

/**
 * All artifact types that require a preceding run.started in the sequence.
 * Superset of STEP_ARTIFACT_TYPES — includes K13 capability.used (INV-K13-05).
 */
const REQUIRES_RUN_STARTED_TYPES = new Set([
  ...STEP_ARTIFACT_TYPES,
  "capability.used",
]);

/**
 * Top-level identity and timing fields extracted into IngestEpisodicInput.
 * These are excluded from the forwarded payload bag to avoid duplication.
 */
const EXCLUDED_FROM_PAYLOAD = new Set([
  "type",
  "id",
  "run_id",
  "project_id",
  "pipeline_schema_version",
  "session_id",
  "ts",
]);

// ── adaptForeman ──────────────────────────────────────────────────────────────

/**
 * Adapts an ordered sequence of Foreman artifact events into a
 * RunStepIngestInput ready for handoff to ingestRunStep.
 *
 * Two-phase execution (INV-K11-04):
 *   Phase 1 — Full structural validation of all artifacts.
 *             Returns structured error on first violation; no normalization
 *             is performed and runIngest is never called.
 *   Phase 2 — Deterministic normalization, preserving input order (INV-K11-05).
 *             Each artifact maps to exactly one IngestEpisodicInput.
 *
 * @param artifacts  Ordered Foreman artifact events, pre-enriched by caller.
 * @returns AdapterResult — ok: true with ingestInput, or ok: false with code + detail.
 */
export function adaptForeman(artifacts: ForemanArtifact[]): AdapterResult {

  // ── Phase 1: Full structural validation (INV-K11-04) ─────────────────────
  //
  // All artifacts are validated before any normalization begins.
  // The first violation short-circuits and returns a structured error.
  // runIngest is never called from within this function.

  let hasRunStarted = false;

  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];

    // ── 1a. Recognized event type (INV-K11-02) ───────────────────────────────

    if (!RECOGNIZED_TYPES.has(artifact.type)) {
      return {
        ok: false,
        code: "ADAPTER_UNKNOWN_EVENT_TYPE",
        detail: `artifact[${i}]: unrecognized event type "${artifact.type}"`,
      };
    }

    // ── 1b. Sequence validation ───────────────────────────────────────────────
    //
    // Step artifacts and capability.used must be preceded by a run.started
    // in this sequence. Encountering them before run.started is a sequence error.

    if (REQUIRES_RUN_STARTED_TYPES.has(artifact.type) && !hasRunStarted) {
      return {
        ok: false,
        code: "ADAPTER_ARTIFACT_SEQUENCE_INVALID",
        detail: `artifact[${i}]: artifact "${artifact.type}" appeared before run.started`,
      };
    }

    if (artifact.type === "run.started") {
      hasRunStarted = true;
    }

    // ── 1c. Required base fields on all artifact types ────────────────────────

    for (const field of ["id", "run_id", "project_id", "pipeline_schema_version", "session_id", "ts"] as const) {
      if (typeof artifact[field] !== "string" || (artifact[field] as string).length === 0) {
        return {
          ok: false,
          code: "ADAPTER_MISSING_REQUIRED_FIELD",
          detail: `artifact[${i}] (type: "${artifact.type}"): missing or empty required field "${field}"`,
        };
      }
    }

    // ── 1d. Required step fields on step artifact types ───────────────────────

    if (STEP_ARTIFACT_TYPES.has(artifact.type)) {
      for (const field of ["step_id", "actor", "action"] as const) {
        if (typeof artifact[field] !== "string" || (artifact[field] as string).length === 0) {
          return {
            ok: false,
            code: "ADAPTER_MISSING_REQUIRED_FIELD",
            detail: `artifact[${i}] (type: "${artifact.type}"): missing or empty required step field "${field}"`,
          };
        }
      }
      if (typeof artifact["step_index"] !== "number") {
        return {
          ok: false,
          code: "ADAPTER_MISSING_REQUIRED_FIELD",
          detail: `artifact[${i}] (type: "${artifact.type}"): missing or invalid required step field "step_index"`,
        };
      }
    }

    // ── 1e. K10 schema version enforcement on step.started (INV-K11-03) ──────
    //
    // K11 is K10+ only. Pre-K10 step.started artifacts are rejected.
    // The step_schema_version field must be present and equal "k10".

    if (artifact.type === "step.started") {
      const ssv = artifact["step_schema_version"];

      if (ssv === undefined || ssv === null) {
        return {
          ok: false,
          code: "ADAPTER_STEP_SCHEMA_VERSION_MISSING",
          detail: `artifact[${i}]: step.started is missing step_schema_version — K11 requires K10+ artifacts (step_schema_version: "k10")`,
        };
      }

      if (ssv !== "k10") {
        return {
          ok: false,
          code: "ADAPTER_STEP_SCHEMA_VERSION_UNKNOWN",
          detail: `artifact[${i}]: step.started has step_schema_version "${String(ssv)}" — only "k10" is accepted by K11`,
        };
      }
    }

    // ── 1f. K13: capability.used required fields (INV-K13-04) ────────────────
    //
    // step_id, capability_id, invocation_id, actor_role, and occurred_at are
    // required on every capability.used artifact (in addition to the base
    // fields already validated in step 1c).
    // promote_to_semantic is not evaluated — capability.used is episodic-only.

    if (artifact.type === "capability.used") {
      for (const field of ["step_id", "capability_id", "invocation_id", "actor_role", "occurred_at"] as const) {
        if (typeof artifact[field] !== "string" || (artifact[field] as string).length === 0) {
          return {
            ok: false,
            code: "ADAPTER_MISSING_REQUIRED_FIELD",
            detail: `artifact[${i}] (type: "capability.used"): missing or empty required field "${field}"`,
          };
        }
      }
    }

    // ── 1g. K12: governance.decision required fields (INV-K12-05) ────────────
    //
    // decision_type, actor_role, and decision_payload are required.
    // actor_role is not enum-validated — only === "COMMAND" is evaluated
    // for promotion gating in Phase 2 (INV-K12-06).
    // decision_payload must be a non-null, non-array object.

    if (artifact.type === "governance.decision") {
      if (typeof artifact["decision_type"] !== "string" || (artifact["decision_type"] as string).length === 0) {
        return {
          ok: false,
          code: "ADAPTER_MISSING_REQUIRED_FIELD",
          detail: `artifact[${i}] (type: "governance.decision"): missing or empty required field "decision_type"`,
        };
      }
      if (typeof artifact["actor_role"] !== "string" || (artifact["actor_role"] as string).length === 0) {
        return {
          ok: false,
          code: "ADAPTER_MISSING_REQUIRED_FIELD",
          detail: `artifact[${i}] (type: "governance.decision"): missing or empty required field "actor_role"`,
        };
      }
      const dp = artifact["decision_payload"];
      if (dp === null || dp === undefined || typeof dp !== "object" || Array.isArray(dp)) {
        return {
          ok: false,
          code: "ADAPTER_MISSING_REQUIRED_FIELD",
          detail: `artifact[${i}] (type: "governance.decision"): missing or invalid required field "decision_payload" — must be a non-null object`,
        };
      }
    }
  }

  // ── Phase 2: Normalization (INV-K11-05 / INV-K12-07 — artifact order preserved) ─
  //
  // Each artifact maps to exactly one IngestEpisodicInput.
  // K12: governance.decision additionally produces an IngestDecisionInput
  //      when promote_to_semantic === true AND actor_role === "COMMAND" (INV-K12-02).
  // All timing fields are parsed from artifact.ts (no new Date() generation).
  // All payload fields are forwarded from the artifact.

  const episodic: IngestEpisodicInput[] = [];

  // K12: collected decision inputs, populated for qualifying governance.decision artifacts.
  const decisions: IngestDecisionInput[] = [];

  for (const artifact of artifacts) {
    const eventType = mapEventType(artifact.type);

    // Build payload: forward all artifact fields except identity/timing fields
    // that are promoted to IngestEpisodicInput top-level fields.
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(artifact)) {
      if (!EXCLUDED_FROM_PAYLOAD.has(key)) {
        payload[key] = value;
      }
    }

    // Resolve agent_role:
    //   - Step artifacts: use actor field.
    //   - governance.decision: use actor_role field (K12).
    //   - All others: "system".
    const agentRole =
      typeof artifact["actor"] === "string" && artifact["actor"].length > 0
        ? artifact["actor"]
        : typeof artifact["actor_role"] === "string" && (artifact["actor_role"] as string).length > 0
          ? artifact["actor_role"] as string
          : "system";

    const input: IngestEpisodicInput = {
      id:             artifact.id,
      project_id:     artifact.project_id,
      schema_version: artifact.pipeline_schema_version,
      run_id:         artifact.run_id,
      session_id:     artifact.session_id,
      agent_role:     agentRole,
      event_type:     eventType,
      payload,
      occurred_at:    new Date(artifact.ts),
      created_at:     new Date(artifact.ts),
    };

    episodic.push(input);

    // ── K12: governance.decision decision input (INV-K12-02) ─────────────────
    //
    // Produce a decision ingest input only when BOTH:
    //   1. promote_to_semantic === true is present on the artifact.
    //   2. actor_role === "COMMAND" (Foreman-level authority check).
    //
    // All other cases (non-promotable decision, governance.halt,
    // trust.change_declared) are episodic-only. No error is raised.

    if (
      artifact.type === "governance.decision" &&
      artifact["promote_to_semantic"] === true &&
      artifact["actor_role"] === "COMMAND"
    ) {
      const decisionInput: IngestDecisionInput = {
        id:                artifact.id,
        project_id:        artifact.project_id,
        schema_version:    artifact.pipeline_schema_version,
        run_id:            artifact.run_id,
        decision_type:     artifact["decision_type"] as string,
        actor_role:        artifact["actor_role"] as string,
        episodic_event_id: artifact.id,
        decision_payload:  artifact["decision_payload"] as Record<string, unknown>,
        decided_at:        new Date(artifact.ts),
        created_at:        new Date(artifact.ts),
      };
      decisions.push(decisionInput);
    }
  }

  return {
    ok: true,
    ingestInput: {
      episodic,
      ...(decisions.length > 0 ? { decisions } : {}),
    },
  };
}

// ── mapEventType (internal) ───────────────────────────────────────────────────

/**
 * Maps a recognized Foreman event type string to the corresponding K2EventType.
 * Precondition: type has already been validated as a member of RECOGNIZED_TYPES.
 * Unreachable branches are defended with a runtime error.
 */
function mapEventType(type: string): (typeof K2_EVENT_TYPE)[keyof typeof K2_EVENT_TYPE] {
  switch (type) {
    // K11 — run + step lifecycle
    case "run.started":          return K2_EVENT_TYPE.RUN_STARTED;
    case "step.started":         return K2_EVENT_TYPE.STEP_STARTED;
    case "step.succeeded":       return K2_EVENT_TYPE.STEP_SUCCEEDED;
    case "step.failed":          return K2_EVENT_TYPE.STEP_FAILED;
    case "run.succeeded":        return K2_EVENT_TYPE.RUN_SUCCEEDED;
    case "run.failed":           return K2_EVENT_TYPE.RUN_FAILED;
    // K12 — governance + trust
    case "governance.decision":  return K2_EVENT_TYPE.GOVERNANCE_DECISION;
    case "governance.halt":      return K2_EVENT_TYPE.GOVERNANCE_HALT;
    case "trust.change_declared":return K2_EVENT_TYPE.TRUST_CHANGE_DECLARED;
    // K13 — capability evidence
    case "capability.used":      return K2_EVENT_TYPE.CAPABILITY_USED;
    default:
      throw new Error(`unreachable: unrecognized event type "${type}" passed validation`);
  }
}
