/**
 * Agent OS — Memory Retrieval Layer K3
 * Query parameter validation guards.
 *
 * Source: agent-os/docs/architecture/memory-retrieval-k3.md §4, §6
 * Slice: K3 — Memory Retrieval Layer
 *
 * Guards enforce:
 * - Required project_id on all query types
 * - Open-ended scan rejection for episodic events (spec §6.1)
 * - Cursor validation via decodeCursor
 * - Limit normalization via clampLimit
 * - fact_key passthrough for semantic facts (spec §6.3)
 *
 * Guards perform no query execution, no DB access, no mutation.
 */

import type {
  EpisodicEventQueryParams,
  DecisionEventQueryParams,
  SemanticFactQueryParams,
  QueryGuardResult,
} from "./types.js";

import { decodeCursor, clampLimit } from "./pagination.js";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const GUARD_CODE = {
  PROJECT_ID_REQUIRED: "PROJECT_ID_REQUIRED",
  OPEN_ENDED_SCAN: "OPEN_ENDED_SCAN",
  INVALID_CURSOR: "INVALID_CURSOR",
} as const;

// ---------------------------------------------------------------------------
// Validated query parameter containers
//
// After guard validation, callers receive a normalized copy with:
// - limit resolved (clamped)
// - cursor decoded (or null)
// - fact_key passthrough for semantic facts
// ---------------------------------------------------------------------------

export interface ValidatedEpisodicParams {
  readonly project_id: string;
  readonly run_id?: string;
  readonly event_type?: readonly string[];
  readonly actor_role?: readonly string[];
  readonly created_at_from?: string;
  readonly created_at_to?: string;
  readonly resolvedLimit: number;
  readonly decodedCursor: { readonly sort_key: string; readonly id: string } | null;
}

export interface ValidatedDecisionParams {
  readonly project_id: string;
  readonly run_id?: string;
  readonly decision_type?: readonly string[];
  readonly actor_role?: readonly string[];
  readonly episodic_event_id?: string;
  readonly created_at_from?: string;
  readonly created_at_to?: string;
  readonly resolvedLimit: number;
  readonly decodedCursor: { readonly sort_key: string; readonly id: string } | null;
}

export interface ValidatedSemanticParams {
  readonly project_id: string;
  readonly fact_type?: readonly string[];
  readonly fact_key?: string;
  readonly created_at_from?: string;
  readonly created_at_to?: string;
  readonly resolvedLimit: number;
  readonly decodedCursor: { readonly sort_key: string; readonly id: string } | null;
}

// ---------------------------------------------------------------------------
// Guard result types
// ---------------------------------------------------------------------------

export type EpisodicGuardResult =
  | { readonly ok: true; readonly params: ValidatedEpisodicParams }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type DecisionGuardResult =
  | { readonly ok: true; readonly params: ValidatedDecisionParams }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type SemanticGuardResult =
  | { readonly ok: true; readonly params: ValidatedSemanticParams }
  | { readonly ok: false; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// Episodic event query guard (spec §6.1)
//
// Prohibited pattern: project_id absent OR
// (run_id absent AND created_at_from absent AND event_type absent)
// ---------------------------------------------------------------------------

export function guardEpisodicQuery(
  params: EpisodicEventQueryParams,
): EpisodicGuardResult {
  if (!params.project_id) {
    return {
      ok: false,
      code: GUARD_CODE.PROJECT_ID_REQUIRED,
      message: "project_id is required for all K3 queries",
    };
  }

  const hasRunId = params.run_id !== undefined && params.run_id !== "";
  const hasCreatedAtFrom = params.created_at_from !== undefined && params.created_at_from !== "";
  const hasEventType = params.event_type !== undefined && params.event_type.length > 0;

  if (!hasRunId && !hasCreatedAtFrom && !hasEventType) {
    return {
      ok: false,
      code: GUARD_CODE.OPEN_ENDED_SCAN,
      message: "episodic event queries require at least one of: run_id, created_at_from, event_type",
    };
  }

  let decodedCursor: { sort_key: string; id: string } | null = null;
  if (params.cursor !== undefined && params.cursor !== "") {
    decodedCursor = decodeCursor(params.cursor);
    if (decodedCursor === null) {
      return {
        ok: false,
        code: GUARD_CODE.INVALID_CURSOR,
        message: "cursor is malformed or invalid",
      };
    }
  }

  return {
    ok: true,
    params: {
      project_id: params.project_id,
      run_id: params.run_id,
      event_type: params.event_type,
      actor_role: params.actor_role,
      created_at_from: params.created_at_from,
      created_at_to: params.created_at_to,
      resolvedLimit: clampLimit(params.limit),
      decodedCursor,
    },
  };
}

// ---------------------------------------------------------------------------
// Decision event query guard (spec §6.2)
//
// Required: project_id only.
// No open-ended scan guard beyond project_id.
// ---------------------------------------------------------------------------

export function guardDecisionQuery(
  params: DecisionEventQueryParams,
): DecisionGuardResult {
  if (!params.project_id) {
    return {
      ok: false,
      code: GUARD_CODE.PROJECT_ID_REQUIRED,
      message: "project_id is required for all K3 queries",
    };
  }

  let decodedCursor: { sort_key: string; id: string } | null = null;
  if (params.cursor !== undefined && params.cursor !== "") {
    decodedCursor = decodeCursor(params.cursor);
    if (decodedCursor === null) {
      return {
        ok: false,
        code: GUARD_CODE.INVALID_CURSOR,
        message: "cursor is malformed or invalid",
      };
    }
  }

  return {
    ok: true,
    params: {
      project_id: params.project_id,
      run_id: params.run_id,
      decision_type: params.decision_type,
      actor_role: params.actor_role,
      episodic_event_id: params.episodic_event_id,
      created_at_from: params.created_at_from,
      created_at_to: params.created_at_to,
      resolvedLimit: clampLimit(params.limit),
      decodedCursor,
    },
  };
}

// ---------------------------------------------------------------------------
// Semantic fact query guard (spec §6.3)
//
// Required: project_id only.
// fact_key passed through when present.
// ---------------------------------------------------------------------------

export function guardSemanticQuery(
  params: SemanticFactQueryParams,
): SemanticGuardResult {
  if (!params.project_id) {
    return {
      ok: false,
      code: GUARD_CODE.PROJECT_ID_REQUIRED,
      message: "project_id is required for all K3 queries",
    };
  }

  let decodedCursor: { sort_key: string; id: string } | null = null;
  if (params.cursor !== undefined && params.cursor !== "") {
    decodedCursor = decodeCursor(params.cursor);
    if (decodedCursor === null) {
      return {
        ok: false,
        code: GUARD_CODE.INVALID_CURSOR,
        message: "cursor is malformed or invalid",
      };
    }
  }

  return {
    ok: true,
    params: {
      project_id: params.project_id,
      fact_type: params.fact_type,
      fact_key: params.fact_key,
      created_at_from: params.created_at_from,
      created_at_to: params.created_at_to,
      resolvedLimit: clampLimit(params.limit),
      decodedCursor,
    },
  };
}
