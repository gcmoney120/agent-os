/**
 * Agent OS v1.0 — Approval Artifact Writer (Slice 8).
 *
 * Writes a validated approval artifact to the run layout:
 *   runs/<run_id>/approvals/<step_index>-<step_id>.approval.json
 *
 * Fails if the file already exists (no silent overwrite).
 */

import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ApprovalArtifact } from "../dispatcher/types.js";

// ── Known state_impact values ─────────────────────────────────────────────────

const KNOWN_STATE_IMPACTS = new Set([
  "none",
  "trivial",
  "trust_change",
  "phase_boundary",
]);

// ── Public types ──────────────────────────────────────────────────────────────

export interface ApproveArgs {
  runsRoot: string;
  run_id: string;
  step_index: number;
  step_id: string;
  approved_by: string;
  approval_note: string;
}

export type ApproveResult =
  | { ok: true; path: string; sha256: string }
  | { ok: false; code: string; message: string };

// ── Writer ────────────────────────────────────────────────────────────────────

export function writeApprovalArtifact(args: ApproveArgs): ApproveResult {
  const { runsRoot, run_id, step_index, step_id, approved_by, approval_note } = args;

  // ── Validate approved_by ────────────────────────────────────────────────
  if (!approved_by || approved_by.trim().length === 0) {
    return { ok: false, code: "APPROVAL_INVALID", message: "approved_by must be non-empty" };
  }

  // ── Validate approval_note ──────────────────────────────────────────────
  if (!approval_note || approval_note.trim().length === 0) {
    return { ok: false, code: "APPROVAL_INVALID", message: "approval_note must be non-empty after trim" };
  }

  // ── Locate step-report.json ─────────────────────────────────────────────
  const stepDir = join(runsRoot, run_id, "steps", `${step_index}-${step_id}`);
  const stepReportPath = join(stepDir, "step-report.json");

  if (!existsSync(stepReportPath)) {
    return { ok: false, code: "STEP_REPORT_NOT_FOUND", message: `step-report.json not found at ${stepReportPath}` };
  }

  // ── Read and parse step report for identity fields ──────────────────────
  const reportBytes = readFileSync(stepReportPath);
  const reportSha = createHash("sha256").update(reportBytes).digest("hex");

  let report: Record<string, unknown>;
  try {
    report = JSON.parse(reportBytes.toString("utf8"));
  } catch {
    return { ok: false, code: "STEP_REPORT_PARSE_ERROR", message: "step-report.json is not valid JSON" };
  }

  const actor = typeof report["actor"] === "string" ? report["actor"] : "";
  const action = typeof report["action"] === "string" ? report["action"] : "";
  const state_impact = typeof report["state_impact"] === "string" ? report["state_impact"] : "";

  if (!KNOWN_STATE_IMPACTS.has(state_impact)) {
    return { ok: false, code: "APPROVAL_INVALID", message: `unknown state_impact: "${state_impact}"` };
  }

  // ── Build approval artifact ─────────────────────────────────────────────
  const artifact: ApprovalArtifact = {
    schema_version: "1",
    run_id,
    step_index,
    step_id,
    actor,
    action,
    state_impact,
    approved_by,
    approval_note: approval_note.trim(),
    step_report_sha256: reportSha,
  };

  // ── Write to disk (fail if exists) ──────────────────────────────────────
  const approvalsDir = join(runsRoot, run_id, "approvals");
  const approvalPath = join(approvalsDir, `${step_index}-${step_id}.approval.json`);

  if (existsSync(approvalPath)) {
    return { ok: false, code: "APPROVAL_ALREADY_EXISTS", message: `approval artifact already exists at ${approvalPath}` };
  }

  try {
    mkdirSync(approvalsDir, { recursive: true });
  } catch (err) {
    return { ok: false, code: "APPROVAL_WRITE_ERROR", message: `failed to create directory: ${err instanceof Error ? err.message : String(err)}` };
  }

  const json = JSON.stringify(artifact, null, 2) + "\n";

  try {
    writeFileSync(approvalPath, json, { flag: "wx" });
  } catch (err) {
    return { ok: false, code: "APPROVAL_WRITE_ERROR", message: `failed to write approval: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { ok: true, path: approvalPath, sha256: reportSha };
}
