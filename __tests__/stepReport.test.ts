/**
 * Agent OS v1.0 — Step Report tests (slice 2).
 *
 * Coverage:
 *   1. invalid schema_version       → STEP_REPORT_INVALID_SCHEMA
 *   2. missing required field        → STEP_REPORT_MISSING_FIELD
 *   3. invalid actor                 → STEP_REPORT_INVALID_ENUM
 *   4. invalid timestamp             → STEP_REPORT_INVALID_TIMESTAMP
 *   5. trust_change without notes    → STEP_REPORT_MISSING_FIELD
 *   6. trust_change with notes       → ok
 *   7. failed + state_impact != none → STEP_REPORT_MISSING_FIELD (no trust_notes)
 *   8. writeStepReport creates path  → correct file + contents
 *
 * Run: cd agent-os && npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateStepReportV1 } from "../src/step-report/validateStepReport.js";
import { writeStepReport } from "../src/step-report/writeStepReport.js";
import type { StepReportV1 } from "../src/step-report/stepReport.schema.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal valid StepReportV1 object (includes Slice 6 fields). */
function validReport(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    run_id: "run-abc",
    step_id: "step-001",
    step_index: 0,
    actor: "forge",
    action: "forge.implement",
    success: true,
    status: "succeeded",
    summary: "Implemented feature X",
    artifacts: {},
    state_impact: "none",
    timestamp: "2026-02-27T12:00:00Z",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("1. invalid schema_version → STEP_REPORT_INVALID_SCHEMA", () => {
  const report = { ...validReport(), schema_version: "2.0" };
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_INVALID_SCHEMA");
});

test("2. missing required field (run_id) → STEP_REPORT_MISSING_FIELD", () => {
  const report = validReport();
  delete report["run_id"];
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_MISSING_FIELD");
  assert.ok(result.message.includes("run_id"));
});

test("3. invalid actor → STEP_REPORT_INVALID_ENUM", () => {
  const report = { ...validReport(), actor: "rogue_agent" };
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_INVALID_ENUM");
  assert.ok(result.message.includes("rogue_agent"));
});

test("4. invalid timestamp string → STEP_REPORT_INVALID_TIMESTAMP", () => {
  const report = { ...validReport(), timestamp: "not-a-date" };
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_INVALID_TIMESTAMP");
});

test("5. trust_change without trust_notes → STEP_REPORT_MISSING_FIELD", () => {
  const report = { ...validReport(), state_impact: "trust_change" };
  // Deliberately omit trust_notes
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_MISSING_FIELD");
  assert.ok(result.message.includes("trust_notes"));
});

test("6. trust_change with trust_notes → ok", () => {
  const report = {
    ...validReport(),
    state_impact: "trust_change",
    trust_notes: "Modified foreman policy allowlist",
  };
  const result = validateStepReportV1(report);
  assert.ok(result.ok, `expected ok but got [${result.ok ? "" : result.code}] ${result.ok ? "" : result.message}`);
  if (!result.ok) return;
  assert.strictEqual(result.report.state_impact, "trust_change");
  assert.strictEqual(result.report.trust_notes, "Modified foreman policy allowlist");
});

test("7. status failed + state_impact != none without trust_notes → STEP_REPORT_MISSING_FIELD", () => {
  const report = {
    ...validReport(),
    success: false,
    error: { code: "STEP_FAILED", message: "step failed" }, // object shape (Slice 6.1)
    status: "failed",
    state_impact: "trivial",
    // No trust_notes — triggers the status/state_impact constraint
  };
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_MISSING_FIELD");
  assert.ok(result.message.includes("trust_notes"));
});

// ── Slice 6.1 — error mutual exclusion + object shape ─────────────────────────

test("9. success=true + error present → STEP_REPORT_MISSING_FIELD (error must be absent)", () => {
  const report = {
    ...validReport(),
    success: true,
    error: { code: "OOPS", message: "should not be here" },
  };
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_MISSING_FIELD");
  assert.ok(result.message.includes("absent"));
});

test("10. success=false + error missing → STEP_REPORT_MISSING_FIELD", () => {
  const report = {
    ...validReport(),
    success: false,
    status: "failed",
    // error intentionally absent
  };
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_MISSING_FIELD");
  assert.ok(result.message.includes("error"));
});

test("11. success=false + error is a plain string → STEP_REPORT_MISSING_FIELD (must be object)", () => {
  const report = {
    ...validReport(),
    success: false,
    error: "plain string error",  // wrong — must be { code, message }
    status: "failed",
  };
  const result = validateStepReportV1(report);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "STEP_REPORT_MISSING_FIELD");
  assert.ok(result.message.includes("object"));
});

test("12. success=false + error valid object { code, message } → ok", () => {
  const report = {
    ...validReport(),
    success: false,
    error: { code: "TASK_FAILED", message: "the task failed cleanly" },
    status: "failed",
    state_impact: "none",
  };
  const result = validateStepReportV1(report);
  assert.ok(result.ok, `expected ok but got [${result.ok ? "" : result.code}] ${result.ok ? "" : result.message}`);
  if (!result.ok) return;
  assert.strictEqual(result.report.success, false);
  assert.deepStrictEqual(result.report.error, {
    code: "TASK_FAILED",
    message: "the task failed cleanly",
  });
});

test("8. writeStepReport creates correct path + file contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-write-"));
  try {
    const report: StepReportV1 = {
      schema_version: "1.0",
      run_id: "run-xyz",
      step_id: "step-007",
      step_index: 3,
      actor: "sentinel",
      action: "sentinel.review",
      status: "succeeded",
      success: true,
      summary: "Reviewed trust surface",
      artifacts: { result_path: "review.json" },
      tests: { passed: 5, total: 5 },
      state_impact: "none",
      timestamp: "2026-02-27T15:30:00Z",
    };

    const result = writeStepReport(dir, report);
    assert.ok(result.ok, `expected ok but got [${result.ok ? "" : result.code}] ${result.ok ? "" : result.message}`);
    if (!result.ok) return;

    // Verify path structure: <runRoot>/run-xyz/steps/3-step-007/step-report.json
    const expectedPath = join(dir, "run-xyz", "steps", "3-step-007", "step-report.json");
    assert.strictEqual(result.path, expectedPath);
    assert.ok(existsSync(expectedPath), "file must exist on disk");

    // Verify file contents
    const contents = readFileSync(expectedPath, "utf8");
    assert.ok(contents.endsWith("\n"), "file must end with newline");
    const parsed = JSON.parse(contents) as StepReportV1;
    assert.strictEqual(parsed.schema_version, "1.0");
    assert.strictEqual(parsed.run_id, "run-xyz");
    assert.strictEqual(parsed.step_id, "step-007");
    assert.strictEqual(parsed.step_index, 3);
    assert.strictEqual(parsed.actor, "sentinel");
    assert.strictEqual(parsed.status, "succeeded");
    assert.strictEqual(parsed.tests?.passed, 5);
    assert.strictEqual(parsed.tests?.total, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
