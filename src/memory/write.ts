/**
 * Agent OS — Memory Engine K1
 * Write interfaces — append-only, project-scoped, schema-versioned.
 *
 * Source: .claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md
 * Slice: K1 — Memory Engine Foundation
 *
 * Enforcement points in this module and their canonical AC-MEM references:
 *
 * AC-MEM-01  FOREMAN-only writes for EPISODIC_EVENT.
 * AC-MEM-06  FOREMAN-only writes for TOOL_INVOCATION; permanent retention.
 * AC-MEM-09  INSERT-only writer identity enforcement per table (write-layer
 *             equivalent of DB role grants; spec §5.1 DB roles).
 * AC-MEM-03  SemanticFactEvent transition gate — state ≠ APPROVED not returned.
 * AC-MEM-07  First SemanticFactEvent must be PROPOSED — PROPOSED not retrievable.
 *
 * Additional K1 write-contract enforcement (no canonical AC-MEM equivalent):
 *   - project_id required on all writes.
 *   - schema_version stamped = K1_SCHEMA_VERSION on all writes.
 *   - written_by_role must match caller identity — forged authorship is rejected
 *     (spec §7.1: write access role-enforced).
 *   - RETRACTED requires decision_event_id (spec §4.2a).
 *   - semantic_fact_id must exist within the same project before a
 *     SemanticFactEvent is written.
 *   - decision_event_id on RETRACTED must resolve to a DecisionEvent in the
 *     same project.
 *   - EMBEDDING_RECORD and EMBEDDING_STATUS_EVENT write paths deferred to K4
 *     (spec §7.1, §4.5); both return DEFERRED_TO_K4 in K1.
 *
 * Design:
 * - All write functions accept a MemoryStore parameter (dependency injection).
 *   No module-level singleton. Composition root provides the runtime store.
 *   Tests pass in isolated MemoryStore instances.
 * - Never-throw contract: all functions return WriteResult<T>.
 *   Errors surface as { ok: false, code, message }. Nothing throws.
 */

import { randomUUID } from "crypto";

import {
  WRITER_IDENTITY,
  SEMANTIC_FACT_WRITER_ROLE,
  SEMANTIC_FACT_EVENT_WRITER_ROLE,
  DECISION_EVENT_WRITER_ROLE,
  SEMANTIC_FACT_LIFECYCLE_STATE,
} from "./enums.js";
import type { WriterIdentity } from "./enums.js";
import type {
  EpisodicEvent,
  SemanticFact,
  SemanticFactEvent,
  DecisionEvent,
  ToolInvocation,
  EmbeddingRecord,
  EmbeddingStatusEvent,
} from "./schemas.js";
import { K1_SCHEMA_VERSION } from "./schemas.js";
import type { MemoryStore } from "./store.js";

// ---------------------------------------------------------------------------
// Result type — never-throw contract.
// ---------------------------------------------------------------------------

export type WriteOk<T> = { readonly ok: true; readonly record: T };
export type WriteErr = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};
export type WriteResult<T> = WriteOk<T> | WriteErr;

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/** Fields stamped by the write layer — callers never supply these. */
type StampFields = "id" | "project_id" | "schema_version" | "created_at";

/** Produce the four stamp fields for a new record. */
function makeStamps(
  projectId: string
): { id: string; project_id: string; schema_version: string; created_at: Date } {
  return {
    id: randomUUID(),
    project_id: projectId,
    schema_version: K1_SCHEMA_VERSION,
    created_at: new Date(),
  };
}

/** Guard: project_id must be a non-empty, non-whitespace string. */
function guardProjectId(projectId: string): WriteErr | null {
  if (!projectId || projectId.trim() === "") {
    return {
      ok: false,
      code: "MISSING_PROJECT_ID",
      message: "project_id is required on all writes (K1 write contract)",
    };
  }
  return null;
}

/**
 * Guard: caller must hold one of the permitted identities for this table.
 * Enforces the explicit write surface role sets defined in enums.ts (AC-MEM-09).
 */
function guardWriterIdentity(
  callerIdentity: WriterIdentity,
  permittedSet: ReadonlyArray<string>,
  table: string
): WriteErr | null {
  if (!permittedSet.includes(callerIdentity)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: `Caller '${callerIdentity}' is not permitted to write to ${table} (AC-MEM-09)`,
    };
  }
  return null;
}

/**
 * Resolve the latest lifecycle state for a given SemanticFact.
 * Scans the store snapshot in insertion order; last match wins.
 * Returns undefined if no SemanticFactEvent exists for this fact yet.
 */
function resolveLatestFactState(
  store: MemoryStore,
  semanticFactId: string
): string | undefined {
  let latestState: string | undefined;
  for (const ev of store.snapshotSemanticFactEvents()) {
    if (ev.semantic_fact_id === semanticFactId) {
      latestState = ev.state;
    }
  }
  return latestState;
}

// Pre-computed permitted writer arrays — derived from enums, not hardcoded.
const _foremanOnly = [WRITER_IDENTITY.FOREMAN] as const;
const _semanticFactWriters = Object.values(SEMANTIC_FACT_WRITER_ROLE) as string[];
const _semanticFactEventWriters = Object.values(SEMANTIC_FACT_EVENT_WRITER_ROLE) as string[];
const _decisionEventWriters = Object.values(DECISION_EVENT_WRITER_ROLE) as string[];

// Valid transitions: current state → permitted next states (AC-MEM-03, AC-MEM-07).
// Terminal states (SUPERSEDED, RETRACTED) are absent from this map intentionally.
const VALID_TRANSITIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED]: [
    SEMANTIC_FACT_LIFECYCLE_STATE.APPROVED,
  ],
  [SEMANTIC_FACT_LIFECYCLE_STATE.APPROVED]: [
    SEMANTIC_FACT_LIFECYCLE_STATE.SUPERSEDED,
    SEMANTIC_FACT_LIFECYCLE_STATE.RETRACTED,
  ],
};

// ---------------------------------------------------------------------------
// §4.1 — writeEpisodicEvent
// Enforcement: AC-MEM-01 (FOREMAN only), project_id guard, schema_version stamp.
// ---------------------------------------------------------------------------

export function writeEpisodicEvent(
  store: MemoryStore,
  callerIdentity: WriterIdentity,
  projectId: string,
  input: Omit<EpisodicEvent, StampFields>
): WriteResult<EpisodicEvent> {
  const pidErr = guardProjectId(projectId);
  if (pidErr) return pidErr;

  const idErr = guardWriterIdentity(callerIdentity, _foremanOnly, "EPISODIC_EVENT");
  if (idErr) return idErr;

  const record = { ...makeStamps(projectId), ...input } as EpisodicEvent;
  store.appendEpisodicEvent(record);
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// §4.2 — writeSemanticFact
// Enforcement:
//   AC-MEM-09  writer identity (command, atlas only).
//   spec §7.1  written_by_role must match caller identity — forged authorship
//               is rejected. Mismatch → WRITER_ROLE_MISMATCH.
//   project_id guard, schema_version stamp.
// ---------------------------------------------------------------------------

export function writeSemanticFact(
  store: MemoryStore,
  callerIdentity: WriterIdentity,
  projectId: string,
  input: Omit<SemanticFact, StampFields>
): WriteResult<SemanticFact> {
  const pidErr = guardProjectId(projectId);
  if (pidErr) return pidErr;

  const idErr = guardWriterIdentity(callerIdentity, _semanticFactWriters, "SEMANTIC_FACT");
  if (idErr) return idErr;

  // Authorship binding: written_by_role must match the authenticated caller.
  // Prevents a caller from storing a record attributed to a different identity.
  if (input.written_by_role !== callerIdentity) {
    return {
      ok: false,
      code: "WRITER_ROLE_MISMATCH",
      message: `written_by_role '${input.written_by_role}' must match caller identity '${callerIdentity}' (spec §7.1)`,
    };
  }

  const record = { ...makeStamps(projectId), ...input } as SemanticFact;
  store.appendSemanticFact(record);
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// §4.2a — writeSemanticFactEvent
// Enforcement:
//   AC-MEM-09  writer identity (atlas, command, sentinel, compass).
//   AC-MEM-03  transition gate — ensures only valid states reach the store.
//   AC-MEM-07  first event must be PROPOSED.
//   spec §4.2a RETRACTED requires decision_event_id (presence + same-project
//               existence check).
//   write integrity: semantic_fact_id must exist within the same project.
// ---------------------------------------------------------------------------

export function writeSemanticFactEvent(
  store: MemoryStore,
  callerIdentity: WriterIdentity,
  projectId: string,
  input: Omit<SemanticFactEvent, StampFields>
): WriteResult<SemanticFactEvent> {
  const pidErr = guardProjectId(projectId);
  if (pidErr) return pidErr;

  const idErr = guardWriterIdentity(
    callerIdentity,
    _semanticFactEventWriters,
    "SEMANTIC_FACT_EVENT"
  );
  if (idErr) return idErr;

  // Project-local reference integrity: fact must exist within this project.
  const fact = store
    .snapshotSemanticFacts()
    .find((f) => f.id === input.semantic_fact_id);
  if (!fact) {
    return {
      ok: false,
      code: "SEMANTIC_FACT_NOT_FOUND",
      message: `No SemanticFact found with id '${input.semantic_fact_id}'; lifecycle event cannot be written for a nonexistent fact`,
    };
  }
  if (fact.project_id !== projectId) {
    return {
      ok: false,
      code: "CROSS_PROJECT_REFERENCE_FORBIDDEN",
      message: `SemanticFact '${input.semantic_fact_id}' belongs to project '${fact.project_id}', not '${projectId}'; cross-project references are forbidden`,
    };
  }

  // Spec §4.2a: RETRACTED requires decision_event_id, with same-project
  // existence check — a fake or cross-project reference is rejected.
  if (input.state === SEMANTIC_FACT_LIFECYCLE_STATE.RETRACTED) {
    if (!input.decision_event_id) {
      return {
        ok: false,
        code: "MISSING_DECISION_EVENT_ID",
        message:
          "decision_event_id is required when transitioning to RETRACTED (spec §4.2a)",
      };
    }
    const decision = store
      .snapshotDecisionEvents()
      .find((d) => d.id === input.decision_event_id);
    if (!decision) {
      return {
        ok: false,
        code: "DECISION_EVENT_NOT_FOUND",
        message: `No DecisionEvent found with id '${input.decision_event_id}'; RETRACTED requires a valid decision reference`,
      };
    }
    if (decision.project_id !== projectId) {
      return {
        ok: false,
        code: "CROSS_PROJECT_REFERENCE_FORBIDDEN",
        message: `DecisionEvent '${input.decision_event_id}' belongs to project '${decision.project_id}', not '${projectId}'; cross-project references are forbidden`,
      };
    }
  }

  // AC-MEM-03 / AC-MEM-07: Transition validation.
  const currentState = resolveLatestFactState(store, input.semantic_fact_id);

  if (currentState === undefined) {
    // No prior event — first event must be PROPOSED (AC-MEM-07).
    if (input.state !== SEMANTIC_FACT_LIFECYCLE_STATE.PROPOSED) {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        message: `First SemanticFactEvent must be PROPOSED; got '${input.state}' (AC-MEM-07)`,
      };
    }
  } else {
    const allowed = VALID_TRANSITIONS[currentState];
    if (!allowed) {
      // currentState is SUPERSEDED or RETRACTED — terminal; absent from map.
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        message: `State '${currentState}' is terminal; no further transitions are permitted (AC-MEM-03)`,
      };
    }
    if (!allowed.includes(input.state)) {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        message: `Cannot transition from '${currentState}' to '${input.state}'. Allowed: ${[...allowed].join(", ")} (AC-MEM-03)`,
      };
    }
  }

  const record = { ...makeStamps(projectId), ...input } as SemanticFactEvent;
  store.appendSemanticFactEvent(record);
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// §4.3 — writeDecisionEvent
// Enforcement: AC-MEM-09 (command, sentinel, compass only), project_id guard,
//              schema_version stamp.
// ---------------------------------------------------------------------------

export function writeDecisionEvent(
  store: MemoryStore,
  callerIdentity: WriterIdentity,
  projectId: string,
  input: Omit<DecisionEvent, StampFields>
): WriteResult<DecisionEvent> {
  const pidErr = guardProjectId(projectId);
  if (pidErr) return pidErr;

  const idErr = guardWriterIdentity(
    callerIdentity,
    _decisionEventWriters,
    "DECISION_EVENT"
  );
  if (idErr) return idErr;

  const record = { ...makeStamps(projectId), ...input } as DecisionEvent;
  store.appendDecisionEvent(record);
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// §4.4 — writeToolInvocation
// Enforcement: AC-MEM-06 (FOREMAN only, permanent retention), project_id guard,
//              schema_version stamp.
// ---------------------------------------------------------------------------

export function writeToolInvocation(
  store: MemoryStore,
  callerIdentity: WriterIdentity,
  projectId: string,
  input: Omit<ToolInvocation, StampFields>
): WriteResult<ToolInvocation> {
  const pidErr = guardProjectId(projectId);
  if (pidErr) return pidErr;

  const idErr = guardWriterIdentity(callerIdentity, _foremanOnly, "TOOL_INVOCATION");
  if (idErr) return idErr;

  const record = { ...makeStamps(projectId), ...input } as ToolInvocation;
  store.appendToolInvocation(record);
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// §4.5 — writeEmbeddingRecord  [K1 STUB — WRITE PATH NOT ACTIVE]
// Per spec §7.1 and §5.1 DB roles: Atlas via K4 pipeline only.
// K1 defines the schema stub. K4 activates this write path.
// All calls return DEFERRED_TO_K4 in K1.
// ---------------------------------------------------------------------------

export function writeEmbeddingRecord(
  _store: MemoryStore,
  _callerIdentity: WriterIdentity,
  _projectId: string,
  _input: Omit<EmbeddingRecord, StampFields>
): WriteResult<EmbeddingRecord> {
  return {
    ok: false,
    code: "DEFERRED_TO_K4",
    message:
      "EMBEDDING_RECORD writes are activated by the K4 embedding pipeline (Atlas only). This write path is not active in K1.",
  };
}

// ---------------------------------------------------------------------------
// §4.6 — writeEmbeddingStatusEvent  [K1 STUB — WRITE PATH NOT ACTIVE]
// Per spec §7.1 and §5.1 DB roles: Atlas via K4 pipeline only.
// K1 defines the schema stub. K4 activates this write path.
// All calls return DEFERRED_TO_K4 in K1.
// ---------------------------------------------------------------------------

export function writeEmbeddingStatusEvent(
  _store: MemoryStore,
  _callerIdentity: WriterIdentity,
  _projectId: string,
  _input: Omit<EmbeddingStatusEvent, StampFields>
): WriteResult<EmbeddingStatusEvent> {
  return {
    ok: false,
    code: "DEFERRED_TO_K4",
    message:
      "EMBEDDING_STATUS_EVENT writes are activated by the K4 embedding pipeline (Atlas only). This write path is not active in K1.",
  };
}
