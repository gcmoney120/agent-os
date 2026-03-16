/**
 * Agent OS — K7 Memory Context Assembly
 * Input validation for MemoryContextRequest.
 *
 * Source: memory-context-assembly-k7-v1.1.md §5.7
 * Slice: K7 — Memory Context Assembly
 *
 * Returns structured error on any violation before any retrieval call.
 * No side effects.
 */

import type { MemoryContextRequest } from "./types.js";
import { K7_ERROR_CODE, type K7ErrorCode } from "./types.js";

const VECTOR_DIMENSION = 1536;

type ParamValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: K7ErrorCode; readonly message: string };

/**
 * Validates MemoryContextRequest before any retrieval is attempted.
 * All failures are returned as structured errors — no throws.
 */
export function validateMemoryContextRequest(
  request: MemoryContextRequest,
): ParamValidationResult {
  // project_id required
  if (!request.project_id || request.project_id.trim() === "") {
    return {
      ok: false,
      code: K7_ERROR_CODE.MISSING_PROJECT_ID,
      message: "project_id is required",
    };
  }

  // run_id required
  if (!request.run_id || request.run_id.trim() === "") {
    return {
      ok: false,
      code: K7_ERROR_CODE.MISSING_RUN_ID,
      message: "run_id is required",
    };
  }

  // lanes required; at least one must be enabled
  if (!request.lanes) {
    return {
      ok: false,
      code: K7_ERROR_CODE.NO_LANES_ENABLED,
      message: "lanes is required and at least one lane must be enabled",
    };
  }

  const episodicEnabled = request.lanes.episodic?.enabled === true;
  const decisionEnabled = request.lanes.decision?.enabled === true;
  const semanticEnabled = request.lanes.semantic?.enabled === true;

  if (!episodicEnabled && !decisionEnabled && !semanticEnabled) {
    return {
      ok: false,
      code: K7_ERROR_CODE.NO_LANES_ENABLED,
      message: "at least one lane must be enabled",
    };
  }

  // query_vector dimension check
  if (request.query_vector !== undefined) {
    if (request.query_vector.length !== VECTOR_DIMENSION) {
      return {
        ok: false,
        code: K7_ERROR_CODE.INVALID_VECTOR_DIMENSION,
        message: `query_vector must have exactly ${VECTOR_DIMENSION} dimensions`,
      };
    }

    // model_id required when query_vector is supplied
    if (!request.model_id || request.model_id.trim() === "") {
      return {
        ok: false,
        code: K7_ERROR_CODE.MISSING_MODEL_ID,
        message: "model_id is required when query_vector is supplied",
      };
    }
  }

  // min_vector_score range
  if (
    request.lanes.semantic?.min_vector_score !== undefined &&
    (request.lanes.semantic.min_vector_score < 0.0 ||
      request.lanes.semantic.min_vector_score > 1.0)
  ) {
    return {
      ok: false,
      code: K7_ERROR_CODE.INVALID_SCORE_THRESHOLD,
      message: "min_vector_score must be between 0.0 and 1.0",
    };
  }

  // run_id_list required when include_current_run_only: false (episodic)
  if (
    episodicEnabled &&
    request.lanes.episodic!.include_current_run_only === false
  ) {
    const list = request.lanes.episodic!.run_id_list;
    if (!list || list.length === 0) {
      return {
        ok: false,
        code: K7_ERROR_CODE.MISSING_RUN_ID_LIST,
        message:
          "episodic lane: run_id_list is required when include_current_run_only is false",
      };
    }
  }

  // run_id_list required when include_current_run_only: false (decision)
  if (
    decisionEnabled &&
    request.lanes.decision!.include_current_run_only === false
  ) {
    const list = request.lanes.decision!.run_id_list;
    if (!list || list.length === 0) {
      return {
        ok: false,
        code: K7_ERROR_CODE.MISSING_RUN_ID_LIST,
        message:
          "decision lane: run_id_list is required when include_current_run_only is false",
      };
    }
  }

  return { ok: true };
}
