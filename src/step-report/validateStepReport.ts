/**
 * Agent OS v1.0 — Step Report Validator.
 *
 * Validates an unknown value against the StepReportV1 contract.
 * Never throws — all errors returned as structured { ok: false } results.
 *
 * Error codes:
 *   STEP_REPORT_INVALID_SCHEMA    — schema_version !== "1.0"
 *   STEP_REPORT_MISSING_FIELD     — required field absent or wrong type
 *   STEP_REPORT_INVALID_ENUM      — field present but value not in allowed set
 *   STEP_REPORT_INVALID_TIMESTAMP — timestamp not a valid ISO-8601 string
 */

import type { StepReportV1 } from "./stepReport.schema.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type ValidateResult =
  | { ok: true; report: StepReportV1 }
  | { ok: false; code: string; message: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_ACTORS = new Set(["command", "atlas", "forge", "sentinel", "compass"]);
const VALID_STATUSES = new Set(["succeeded", "failed"]);
const VALID_STATE_IMPACTS = new Set(["none", "trivial", "trust_change", "phase_boundary"]);

// ── Validator ─────────────────────────────────────────────────────────────────

export function validateStepReportV1(report: unknown): ValidateResult {
  if (!isObject(report)) {
    return missing("report must be a JSON object");
  }

  const obj = report;

  // ── schema_version ──────────────────────────────────────────────────────
  if (obj["schema_version"] !== "1.0") {
    return {
      ok: false,
      code: "STEP_REPORT_INVALID_SCHEMA",
      message: `schema_version must be "1.0", got: ${JSON.stringify(obj["schema_version"])}`,
    };
  }

  // ── Required string fields ──────────────────────────────────────────────
  if (!nonEmptyString(obj["run_id"])) {
    return missing("run_id must be a non-empty string");
  }
  if (!nonEmptyString(obj["step_id"])) {
    return missing("step_id must be a non-empty string");
  }
  if (typeof obj["step_index"] !== "number" || !Number.isInteger(obj["step_index"]) || obj["step_index"] < 0) {
    return missing("step_index must be a non-negative integer");
  }

  // ── actor ───────────────────────────────────────────────────────────────
  if (!nonEmptyString(obj["actor"])) {
    return missing("actor must be a non-empty string");
  }
  if (!VALID_ACTORS.has(obj["actor"])) {
    return {
      ok: false,
      code: "STEP_REPORT_INVALID_ENUM",
      message: `actor must be one of [${[...VALID_ACTORS].join(", ")}], got: ${JSON.stringify(obj["actor"])}`,
    };
  }

  // ── action ──────────────────────────────────────────────────────────────
  if (!nonEmptyString(obj["action"])) {
    return missing("action must be a non-empty string");
  }

  // ── success (Atlas §2 — Slice 6) ────────────────────────────────────────
  if (typeof obj["success"] !== "boolean") {
    return missing("success must be a boolean");
  }

  // ── error mutual-exclusion + object shape (Atlas §2 — Slice 6.1) ────────
  // success=true  → error must be absent.
  // success=false → error must be a valid object { code, message, detail? }.
  if (obj["success"] === true) {
    if ("error" in obj && obj["error"] !== undefined) {
      return missing("error must be absent when success is true");
    }
  } else {
    // success === false
    const err = obj["error"];
    if (!isObject(err)) {
      return missing("error is required and must be an object when success is false");
    }
    if (!nonEmptyString(err["code"])) {
      return missing("error.code must be a non-empty string");
    }
    if (!nonEmptyString(err["message"])) {
      return missing("error.message must be a non-empty string");
    }
    if ("detail" in err && err["detail"] !== undefined) {
      if (
        typeof err["detail"] !== "object" ||
        Array.isArray(err["detail"]) ||
        err["detail"] === null
      ) {
        return missing("error.detail must be a plain object when present");
      }
      try {
        JSON.stringify(err["detail"]);
      } catch {
        return missing("error.detail must be JSON-serializable");
      }
    }
  }

  // ── status ──────────────────────────────────────────────────────────────
  if (!nonEmptyString(obj["status"])) {
    return missing("status must be a non-empty string");
  }
  if (!VALID_STATUSES.has(obj["status"])) {
    return {
      ok: false,
      code: "STEP_REPORT_INVALID_ENUM",
      message: `status must be one of [${[...VALID_STATUSES].join(", ")}], got: ${JSON.stringify(obj["status"])}`,
    };
  }

  // ── summary ─────────────────────────────────────────────────────────────
  if (!nonEmptyString(obj["summary"])) {
    return missing("summary must be a non-empty string");
  }

  // ── artifacts ───────────────────────────────────────────────────────────
  if (!isObject(obj["artifacts"])) {
    return missing("artifacts must be an object");
  }
  const artifacts = obj["artifacts"];
  if ("result_path" in artifacts && typeof artifacts["result_path"] !== "string") {
    return missing("artifacts.result_path must be a string when present");
  }
  if ("diff_path" in artifacts && typeof artifacts["diff_path"] !== "string") {
    return missing("artifacts.diff_path must be a string when present");
  }
  if ("additional_paths" in artifacts) {
    if (!stringArray(artifacts["additional_paths"])) {
      return missing("artifacts.additional_paths must be a string array when present");
    }
  }

  // ── output (must not be null if present) ────────────────────────────────
  if ("output" in obj && obj["output"] === null) {
    return {
      ok: false,
      code: "STEP_REPORT_MISSING_FIELD",
      message: "output must not be null when present",
    };
  }

  // ── metadata (must be a JSON-serializable plain object) ─────────────────
  if ("metadata" in obj && obj["metadata"] !== undefined) {
    if (
      typeof obj["metadata"] !== "object" ||
      Array.isArray(obj["metadata"]) ||
      obj["metadata"] === null
    ) {
      return missing("metadata must be a plain object when present");
    }
    try {
      JSON.stringify(obj["metadata"]);
    } catch {
      return {
        ok: false,
        code: "STEP_REPORT_MISSING_FIELD",
        message: "metadata must be JSON-serializable",
      };
    }
  }

  // ── tests (optional) ───────────────────────────────────────────────────
  if ("tests" in obj && obj["tests"] !== undefined) {
    if (!isObject(obj["tests"])) {
      return missing("tests must be an object when present");
    }
    const tests = obj["tests"];
    if (typeof tests["passed"] !== "number" || !Number.isInteger(tests["passed"])) {
      return missing("tests.passed must be an integer");
    }
    if (typeof tests["total"] !== "number" || !Number.isInteger(tests["total"])) {
      return missing("tests.total must be an integer");
    }
    if (tests["passed"] < 0 || tests["passed"] > tests["total"]) {
      return missing("tests.passed must satisfy 0 <= passed <= total");
    }
  }

  // ── state_impact ────────────────────────────────────────────────────────
  if (!nonEmptyString(obj["state_impact"])) {
    return missing("state_impact must be a non-empty string");
  }
  if (!VALID_STATE_IMPACTS.has(obj["state_impact"])) {
    return {
      ok: false,
      code: "STEP_REPORT_INVALID_ENUM",
      message: `state_impact must be one of [${[...VALID_STATE_IMPACTS].join(", ")}], got: ${JSON.stringify(obj["state_impact"])}`,
    };
  }

  // ── trust_notes (required when state_impact === "trust_change") ────────
  if (obj["state_impact"] === "trust_change") {
    if (!nonEmptyString(obj["trust_notes"])) {
      return missing("trust_notes is required when state_impact is trust_change");
    }
  }

  // ── status === "failed" + state_impact constraint ─────────────────────
  // When status is "failed", state_impact must be "none" unless trust_notes
  // is provided explaining why.
  if (obj["status"] === "failed" && obj["state_impact"] !== "none") {
    if (!nonEmptyString(obj["trust_notes"])) {
      return missing(
        'when status is "failed", state_impact must be "none" unless trust_notes is provided',
      );
    }
  }

  // ── timestamp ───────────────────────────────────────────────────────────
  if (!nonEmptyString(obj["timestamp"])) {
    return missing("timestamp must be a non-empty string");
  }
  if (!isValidISOTimestamp(obj["timestamp"])) {
    return {
      ok: false,
      code: "STEP_REPORT_INVALID_TIMESTAMP",
      message: `timestamp must be a valid ISO-8601 string, got: ${JSON.stringify(obj["timestamp"])}`,
    };
  }

  // ── Build typed result ────────────────────────────────────────────────
  const result: StepReportV1 = {
    schema_version: "1.0",
    run_id: obj["run_id"] as string,
    step_id: obj["step_id"] as string,
    step_index: obj["step_index"] as number,
    actor: obj["actor"] as StepReportV1["actor"],
    action: obj["action"] as string,
    success: obj["success"] as boolean,
    ...(obj["success"] === false && isObject(obj["error"])
      ? {
          error: {
            code: (obj["error"] as Record<string, unknown>)["code"] as string,
            message: (obj["error"] as Record<string, unknown>)["message"] as string,
            ...("detail" in (obj["error"] as Record<string, unknown>) &&
              (obj["error"] as Record<string, unknown>)["detail"] !== undefined
              ? { detail: (obj["error"] as Record<string, unknown>)["detail"] as Record<string, unknown> }
              : {}),
          },
        }
      : {}),
    status: obj["status"] as StepReportV1["status"],
    summary: obj["summary"] as string,
    artifacts: {
      ...(typeof artifacts["result_path"] === "string" ? { result_path: artifacts["result_path"] } : {}),
      ...(typeof artifacts["diff_path"] === "string" ? { diff_path: artifacts["diff_path"] } : {}),
      ...(Array.isArray(artifacts["additional_paths"])
        ? { additional_paths: artifacts["additional_paths"] as string[] }
        : {}),
    },
    ...("output" in obj && obj["output"] !== undefined && obj["output"] !== null
      ? { output: obj["output"] }
      : {}),
    ...(isObject(obj["metadata"])
      ? { metadata: obj["metadata"] as Record<string, unknown> }
      : {}),
    ...(isObject(obj["tests"])
      ? { tests: { passed: (obj["tests"] as Record<string, unknown>)["passed"] as number, total: (obj["tests"] as Record<string, unknown>)["total"] as number } }
      : {}),
    state_impact: obj["state_impact"] as StepReportV1["state_impact"],
    ...(nonEmptyString(obj["trust_notes"]) ? { trust_notes: obj["trust_notes"] } : {}),
    timestamp: obj["timestamp"] as string,
  };

  return { ok: true, report: result };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

function nonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim() !== "";
}

function stringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((item) => typeof item === "string");
}

function missing(message: string): { ok: false; code: string; message: string } {
  return { ok: false, code: "STEP_REPORT_MISSING_FIELD", message };
}

/**
 * Simple deterministic ISO-8601 check:
 *   1. Date.parse must succeed (not NaN)
 *   2. String must contain "T" (date-time separator)
 *   3. String must end with "Z" or contain a timezone offset (+/-HH:MM)
 */
function isValidISOTimestamp(val: string): boolean {
  if (Number.isNaN(Date.parse(val))) return false;
  if (!val.includes("T")) return false;
  // Ends with Z, or has a +/-HH:MM offset after the time portion
  if (val.endsWith("Z")) return true;
  // Match +HH:MM or -HH:MM at the end
  if (/[+-]\d{2}:\d{2}$/.test(val)) return true;
  return false;
}
