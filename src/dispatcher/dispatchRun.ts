/**
 * Agent OS v1.0 — Dispatcher (Slices 3 + 4 + 8).
 *
 * dispatchRun() executes an ordered list of steps:
 *   1. Validates the DispatchRequest.
 *   2. Loads the project adapter via deps.
 *   3. [Slice 4] Pre-run adapter governance gate.
 *   4. Verifies the closed runner registry.
 *   5. For each step: resolve input, build frozen context, invoke runner,
 *      enforce StepReport, [Slice 4] enforce governance, write artifacts.
 *   6. Fail-fast on first error.
 *
 * dispatchResume() (Slice 8) validates an approval artifact then resumes
 * execution from step_index + 1 using the same step loop.
 *
 * All IO goes through deps — both functions are pure.
 */

import type {
  DispatchRequestV1,
  DispatchDeps,
  FrozenStepContext,
  RunnerRegistry,
  RunnerOutput,
  ApprovalArtifact,
  ResumeRequest,
} from "./types.js";
import type { DispatchResult } from "./errors.js";
import { memoryContextHash } from "../memory/memory-context/canonicalize.js";
import { verifyStepStartedEvent } from "./verifyStepStarted.js";

// ── Deep-freeze utility ──────────────────────────────────────────────────────

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

// ── Safe path-segment validator ──────────────────────────────────────────────

/**
 * Returns true only when step_id is safe to embed in a filesystem path.
 * Rejects: ".." sequences, forward/back slashes, ASCII control chars,
 * Windows reserved chars, and leading/trailing whitespace.
 */
export function isSafeStepId(step_id: string): boolean {
  if (step_id.includes("..")) return false;
  if (step_id.includes("/") || step_id.includes("\\")) return false;
  if (/[\u0000-\u001F\u007F]/.test(step_id)) return false;
  if (/[:*?"<>|]/.test(step_id)) return false;
  if (step_id !== step_id.trim()) return false;
  return true;
}

// ── Governance decision function (pure) — Slice 4 ───────────────────────────

/**
 * Determines whether a step may auto-apply or requires manual approval.
 *
 * Preconditions (caller must guarantee):
 *   - state_impact is one of { "none", "trivial", "trust_change", "phase_boundary" }
 *   - if state_impact === "trust_change", trust_notes is non-empty (checked before call)
 *
 * Pure: no side effects, no external reads. Identical inputs → identical output.
 */
export function governanceDecision(
  state_impact: string,
  _trust_notes: string | undefined,
  auto_apply_for: string[],
  _require_manual_approval_for: string[],
): "auto_apply" | "require_manual_approval" {
  switch (state_impact) {
    case "none":
      return "auto_apply";
    case "trivial":
      return auto_apply_for.includes("trivial") ? "auto_apply" : "require_manual_approval";
    case "trust_change":
      // Always require manual approval regardless of auto_apply_for contents.
      return "require_manual_approval";
    case "phase_boundary":
      // Absence of "phase_boundary" in auto_apply_for is not permission.
      return auto_apply_for.includes("phase_boundary") ? "auto_apply" : "require_manual_approval";
    default:
      // Precondition violated — defensive fallback; never reached in normal flow.
      return "require_manual_approval";
  }
}

// ── Adapter governance extractor ─────────────────────────────────────────────

interface AdapterGovernanceFields {
  mode: unknown;
  require_manual_approval_for: unknown;
  auto_apply_for: unknown;
}

function extractAdapterGovernance(adapter: unknown): AdapterGovernanceFields {
  const empty: AdapterGovernanceFields = {
    mode: undefined,
    require_manual_approval_for: undefined,
    auto_apply_for: undefined,
  };
  if (!adapter || typeof adapter !== "object") return empty;
  const a = adapter as Record<string, unknown>;
  const gov = a["governance"];
  if (!gov || typeof gov !== "object") return empty;
  const g = gov as Record<string, unknown>;
  const sus = g["system_state_updates"];
  if (!sus || typeof sus !== "object") return empty;
  const s = sus as Record<string, unknown>;
  return {
    mode: s["mode"],
    require_manual_approval_for: s["require_manual_approval_for"],
    auto_apply_for: s["auto_apply_for"],
  };
}

// ── Actions that require a non-null output field in the step report ───────────
// Slice 6: Atlas §3 conformance — forge.implement must produce structured output.

const OUTPUT_REQUIRED_ACTIONS = new Set(["forge.implement"]);

// ── Known state_impact values ─────────────────────────────────────────────────

const KNOWN_STATE_IMPACTS = new Set([
  "none",
  "trivial",
  "trust_change",
  "phase_boundary",
]);

// ── Required runner keys ─────────────────────────────────────────────────────

const RUNNER_KEYS: ReadonlyArray<keyof RunnerRegistry> = [
  "command",
  "atlas",
  "forge",
  "sentinel",
  "compass",
];

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchRun(
  req: DispatchRequestV1,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const written_step_reports: Array<{
    step_index: number;
    step_id: string;
    path: string;
  }> = [];

  // ── 4.1.1  Validate schema_version ─────────────────────────────────────
  if (
    !req ||
    typeof req !== "object" ||
    req.schema_version !== "1.0"
  ) {
    return {
      ok: false,
      run_id: req?.run_id,
      error: {
        code: "DISPATCH_INVALID_REQUEST",
        message: 'schema_version must be "1.0"',
      },
    };
  }

  // ── 4.1.2  Validate steps array + contiguous indices ───────────────────
  if (!Array.isArray(req.steps)) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "DISPATCH_INVALID_REQUEST",
        message: "steps must be an array",
      },
    };
  }

  for (let i = 0; i < req.steps.length; i++) {
    if (req.steps[i].step_index !== i) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_STEP_INDEX_GAP",
          message: `expected step_index ${i}, got ${req.steps[i].step_index}`,
          step_index: req.steps[i].step_index,
          step_id: req.steps[i].step_id,
        },
      };
    }
  }

  // ── 4.1.3  Enforce capabilities.length === 0 ──────────────────────────
  for (const step of req.steps) {
    if (step.capabilities.length > 0) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_CAPABILITIES_NOT_PERMITTED",
          message: "capabilities must be empty in v1.0",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
      };
    }
  }

  // ── 4.1.4  Load project adapter ────────────────────────────────────────
  const adapterResult = await deps.loadProjectAdapter(req.project_root);
  if (!adapterResult.ok) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "DISPATCH_ADAPTER_LOAD_FAILED",
        message: "failed to load project adapter",
        cause: adapterResult.error,
      },
    };
  }

  // ── Slice 4: Pre-run adapter governance gate ───────────────────────────
  // Must pass before any step executes. Requires adapter to be loaded first.
  const govFields = extractAdapterGovernance(adapterResult.adapter);

  if (govFields.mode !== "hybrid") {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "ADAPTER_GOVERNANCE_MISCONFIGURED",
        message: 'adapter.governance.system_state_updates.mode must be "hybrid"',
      },
      written_step_reports: [],
    };
  }
  if (
    !Array.isArray(govFields.require_manual_approval_for) ||
    !(govFields.require_manual_approval_for as string[]).includes("trust_change")
  ) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "ADAPTER_GOVERNANCE_MISCONFIGURED",
        message: 'adapter.governance.system_state_updates.require_manual_approval_for must include "trust_change"',
      },
      written_step_reports: [],
    };
  }
  if (
    !Array.isArray(govFields.auto_apply_for) ||
    !(govFields.auto_apply_for as string[]).includes("trivial")
  ) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "ADAPTER_GOVERNANCE_MISCONFIGURED",
        message: 'adapter.governance.system_state_updates.auto_apply_for must include "trivial"',
      },
      written_step_reports: [],
    };
  }

  // Governance arrays confirmed as string[] after gate.
  const autoApplyFor = govFields.auto_apply_for as string[];
  const requireManualApprovalFor = govFields.require_manual_approval_for as string[];

  // ── 4.1.5  Verify runner registry is complete ──────────────────────────
  for (const key of RUNNER_KEYS) {
    if (!deps.runnerRegistry[key]) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_RUNNER_MISSING",
          message: `runner missing for actor: ${key}`,
          actor: key,
        },
      };
    }
  }

  // ── Execute steps (fail-fast) ──────────────────────────────────────────
  for (const step of req.steps) {
    // ── §8.2  Guard: step_id must be a safe filesystem path segment ─────
    if (!isSafeStepId(step.step_id)) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_INVALID_REQUEST",
          message: "invalid step_id (unsafe for filesystem path)",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // ── §8.3  Resolve input_ref ────────────────────────────────────────
    let input: unknown = undefined;
    if (step.input_ref) {
      if (step.input_ref.kind === "inline") {
        input = step.input_ref.value;
      } else if (step.input_ref.kind === "file") {
        return {
          ok: false,
          run_id: req.run_id,
          error: {
            code: "DISPATCH_INVALID_REQUEST",
            message: "file input_ref not supported without readFile dep",
            step_index: step.step_index,
            step_id: step.step_id,
            actor: step.actor,
          },
          written_step_reports,
        };
      }
    }

    // ── §8.4  Artifact paths ───────────────────────────────────────────
    const stepDir = `${req.artifacts_root}/steps/${step.step_index}-${step.step_id}`;

    if (deps.ensureDir) {
      await deps.ensureDir(stepDir);
    }

    // ── K9 §5  Resolve MemoryContext (position 5 in pre-step gate) ────────
    // Must succeed before any step artifact is written or executor is invoked.
    const memResult = await deps.resolveMemoryContext(req.run_id, req.project_root);
    if (!memResult.ok) {
      // Emit step.failed then run.failed — ordering is invariant (AC13).
      if (deps.appendEvent) {
        await deps.appendEvent({
          type: "step.failed",
          detail: {
            step_id: step.step_id,
            step_index: step.step_index,
            reason: "MEMORY_RETRIEVAL_FAILED",
            cause: { code: memResult.code, message: memResult.message },
          },
        });
        await deps.appendEvent({
          type: "run.failed",
          detail: {
            step_id: step.step_id,
            step_index: step.step_index,
            reason: "MEMORY_RETRIEVAL_FAILED",
          },
        });
      }
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "MEMORY_RETRIEVAL_FAILED",
          message: "memory context retrieval failed before step execution",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
          cause: { code: memResult.code, message: memResult.message },
        },
        written_step_reports,
      };
    }

    const resolvedMemory = memResult.context;
    const mcHash = memoryContextHash(resolvedMemory);

    // ── K9: Validate step-started payload before write (inline assertion) ─
    // verifyStepStartedEvent is wired here as the integration point for the
    // K9 verifier. It guards the artifact before it reaches the filesystem.
    // Prior dispatcher behavior is unchanged — this call is purely additive.
    const stepStartedPayload = { memory_context_hash: mcHash, step_schema_version: "k10" };
    const stepStartedCheck = verifyStepStartedEvent(stepStartedPayload);
    if (!stepStartedCheck.ok) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "MEMORY_RETRIEVAL_FAILED",
          message: `step-started event validation failed: ${stepStartedCheck.error}`,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // ── §8.4  Build context ────────────────────────────────────────────
    const ctx: FrozenStepContext = {
      run_id: req.run_id,
      step_index: step.step_index,
      step_id: step.step_id,
      actor: step.actor,
      action: step.action,
      project_root: req.project_root,
      artifacts_root: req.artifacts_root,
      input,
      capabilities: [...step.capabilities],
      adapter: adapterResult.adapter,
      memory: resolvedMemory,
    };

    // ── K9: Emit step-started.json with memory_context_hash ───────────
    // Corresponds to the step.started event in the Foreman model.
    // Written before dispatch-context.json and before runner invocation.
    if (deps.writeJsonFile) {
      await deps.writeJsonFile(`${stepDir}/step-started.json`, stepStartedPayload);
    }

    // Write dispatch-context.json before freeze.
    if (deps.writeJsonFile) {
      await deps.writeJsonFile(`${stepDir}/dispatch-context.json`, ctx);
    }

    // ── §8.4  Deep-freeze context ──────────────────────────────────────
    deepFreeze(ctx);

    // ── §8.5  Invoke runner ────────────────────────────────────────────
    let output: RunnerOutput;
    try {
      output = await deps.runnerRegistry[step.actor].run(ctx);
    } catch (err) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_RUNNER_FAILED",
          message: `runner for ${step.actor} threw`,
          cause: err,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // ── §8.6  step_report must be present ─────────────────────────────
    if (output.step_report == null) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_STEP_REPORT_MISSING",
          message: "runner did not return step_report",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // ── §8.7  Validate step_report via dep ────────────────────────────
    const validation = deps.validateStepReport(output.step_report);
    if (!validation.ok) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_STEP_REPORT_INVALID",
          message: "step report failed validation",
          cause: validation,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // Extract governance-relevant fields from the validated report.
    const reportObj = output.step_report as Record<string, unknown>;
    const state_impact = typeof reportObj["state_impact"] === "string"
      ? reportObj["state_impact"]
      : "";
    const trust_notes = typeof reportObj["trust_notes"] === "string"
      ? reportObj["trust_notes"]
      : undefined;

    // Extract §2 fields added in Slice 6 (Atlas §2–§8 conformance).
    const reportSuccess = reportObj["success"];
    const reportOutput = "output" in reportObj ? reportObj["output"] : undefined;

    // ── §8.8  Slice 4: trust_change requires non-empty trust_notes ─────
    // Pre-write hard fail — violating report is not written to disk.
    if (state_impact === "trust_change") {
      if (trust_notes == null || trust_notes.trim().length === 0) {
        return {
          ok: false,
          run_id: req.run_id,
          error: {
            code: "TRUST_CHANGE_MISSING_NOTES",
            message: "trust_change requires a non-empty trust_notes field",
            step_index: step.step_index,
            step_id: step.step_id,
            actor: step.actor,
          },
          written_step_reports,
        };
      }
    }

    // ── §8.9  Slice 4: defensive state_impact assertion ────────────────
    // The Slice 2 validator already enforces the enum, but we assert here
    // as a last line of defence so the governance function is never called
    // with an unknown value.
    if (!KNOWN_STATE_IMPACTS.has(state_impact)) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "STEP_REPORT_INVALID",
          message: `unknown state_impact: "${state_impact}"`,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // ── §8.9a  Slice 6: success=true + output=null → EXECUTOR_INVALID_RESULT
    // Pre-write hard fail — violating report is not written to disk.
    if (reportSuccess === true && reportOutput === null) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "EXECUTOR_INVALID_RESULT",
          message: "runner reported success=true but output field is null",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // ── §8.10  Write raw_log if provided ───────────────────────────────
    if (output.raw_log && deps.writeTextFile) {
      await deps.writeTextFile(`${stepDir}/runner-log.txt`, output.raw_log);
    }

    // ── §8.10  Write step report ───────────────────────────────────────
    const writeResult = await deps.writeStepReport({
      artifacts_root: req.artifacts_root,
      step_index: step.step_index,
      step_id: step.step_id,
      step_report: output.step_report,
    });

    if (!writeResult.ok) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_WRITE_FAILED",
          message: "failed to write step report",
          cause: writeResult.error,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // ── §8.11  Record written path ─────────────────────────────────────
    written_step_reports.push({
      step_index: step.step_index,
      step_id: step.step_id,
      path: writeResult.path,
    });

    // ── §8.11a  Slice 6: Post-write output checks ──────────────────────
    // These checks fire AFTER writeStepReport — the step report is persisted
    // regardless, but dispatch halts with a hard error.
    const hasOutput =
      "output" in reportObj &&
      reportObj["output"] !== undefined &&
      reportObj["output"] !== null;

    // OUTPUT_REQUIRED_MISSING: action demands output but step report has none.
    if (OUTPUT_REQUIRED_ACTIONS.has(step.action) && !hasOutput) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "OUTPUT_REQUIRED_MISSING",
          message: `action "${step.action}" requires a non-null output field in the step report`,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // CAPABILITY_REQUIRED_NOT_USED: output claimed in report but runner never
    // invoked the writeOutput capability (write_output_calls explicitly === 0).
    // Runners that omit write_output_calls are exempt from this check.
    const writeOutputCalls = output.write_output_calls;
    if (hasOutput && writeOutputCalls !== undefined && writeOutputCalls === 0) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "CAPABILITY_REQUIRED_NOT_USED",
          message:
            "step report contains an output field but runner never invoked the writeOutput capability",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    // ── §8.12-13  Slice 4: Governance decision ─────────────────────────
    // Evaluated AFTER writeStepReport; the report is persisted regardless.
    const decision = governanceDecision(
      state_impact,
      trust_notes,
      autoApplyFor,
      requireManualApprovalFor,
    );

    if (decision === "require_manual_approval") {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_HALTED_GOVERNANCE",
          message: "manual approval required before execution can continue",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
          cause: {
            state_impact,
            decision: "require_manual_approval",
          },
        },
        written_step_reports,
      };
    }

    // decision === "auto_apply" — continue to next step.
  }

  return { ok: true, run_id: req.run_id, written_step_reports };
}

// ── Slice 8: dispatchResume ─────────────────────────────────────────────────

/**
 * Resume a halted run after approval.
 *
 * Validation ordering (Atlas spec):
 *   1. Approval file exists
 *   2. JSON parses
 *   3. schema_version === "1"
 *   4. Identity binding matches resume request + step definition
 *   5. state_impact is known enum
 *   6. approved_by non-empty
 *   7. approval_note trim non-empty
 *   8. step_report_sha256 matches on-disk step-report.json
 *   9. Adapter governance gate re-validated
 *  10. Continue execution from step_index + 1
 *
 * No step execution if any check fails.
 * Returns same shape as dispatchRun.
 * written_step_reports includes only resumed steps.
 */
export async function dispatchResume(
  resumeReq: ResumeRequest,
  req: DispatchRequestV1,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const written_step_reports: Array<{
    step_index: number;
    step_id: string;
    path: string;
  }> = [];

  // ── 1. Approval file exists ─────────────────────────────────────────────
  const approvalPath = `${req.artifacts_root}/approvals/${resumeReq.step_index}-${resumeReq.step_id}.approval.json`;

  if (!deps.fileExists) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_MISSING",
        message: "fileExists dep not provided",
      },
      written_step_reports,
    };
  }

  const exists = await deps.fileExists(approvalPath);
  if (!exists) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_MISSING",
        message: `approval artifact not found at ${approvalPath}`,
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  // ── 2. JSON parses ──────────────────────────────────────────────────────
  if (!deps.readFile) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_INVALID",
        message: "readFile dep not provided",
      },
      written_step_reports,
    };
  }

  let approvalJson: string;
  try {
    approvalJson = await deps.readFile(approvalPath);
  } catch {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_INVALID",
        message: "failed to read approval artifact",
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  let approval: Record<string, unknown>;
  try {
    approval = JSON.parse(approvalJson);
  } catch {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_INVALID",
        message: "approval artifact is not valid JSON",
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  // ── 3. schema_version === "1" ───────────────────────────────────────────
  if (approval["schema_version"] !== "1") {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_INVALID",
        message: `schema_version must be "1", got: ${JSON.stringify(approval["schema_version"])}`,
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  // ── 4. Identity binding: matches resume request + step definition ──────
  // Find the step definition in the plan
  const stepDef = req.steps.find(
    (s) => s.step_index === resumeReq.step_index && s.step_id === resumeReq.step_id,
  );

  if (
    approval["run_id"] !== resumeReq.run_id ||
    approval["step_index"] !== resumeReq.step_index ||
    approval["step_id"] !== resumeReq.step_id
  ) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_IDENTITY_MISMATCH",
        message: "approval artifact identity fields do not match resume request",
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  if (
    stepDef &&
    (approval["actor"] !== stepDef.actor || approval["action"] !== stepDef.action)
  ) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_IDENTITY_MISMATCH",
        message: "approval artifact actor/action do not match step definition",
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  // ── 5. state_impact is known enum ───────────────────────────────────────
  const approvalStateImpact = approval["state_impact"];
  if (typeof approvalStateImpact !== "string" || !KNOWN_STATE_IMPACTS.has(approvalStateImpact)) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_INVALID",
        message: `unknown state_impact: ${JSON.stringify(approvalStateImpact)}`,
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  // ── 6. approved_by non-empty ────────────────────────────────────────────
  const approvedBy = approval["approved_by"];
  if (typeof approvedBy !== "string" || approvedBy.trim().length === 0) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_INVALID",
        message: "approved_by must be a non-empty string",
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  // ── 7. approval_note trim non-empty ─────────────────────────────────────
  const approvalNote = approval["approval_note"];
  if (typeof approvalNote !== "string" || approvalNote.trim().length === 0) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_INVALID",
        message: "approval_note must be a non-empty string after trim",
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  // ── 8. step_report_sha256 matches on-disk step-report.json ──────────────
  const reportSha = approval["step_report_sha256"];
  if (typeof reportSha !== "string" || !/^[0-9a-f]{64}$/.test(reportSha)) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_ARTIFACT_INVALID",
        message: "step_report_sha256 must be a 64-char lowercase hex string",
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  const stepReportPath = `${req.artifacts_root}/steps/${resumeReq.step_index}-${resumeReq.step_id}/step-report.json`;

  const reportExists = await deps.fileExists(stepReportPath);
  if (!reportExists) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_REPORT_NOT_FOUND",
        message: `step-report.json not found at ${stepReportPath}`,
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  if (!deps.sha256File) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_INTEGRITY_FAILED",
        message: "sha256File dep not provided",
      },
      written_step_reports,
    };
  }

  const actualSha = await deps.sha256File(stepReportPath);
  if (actualSha !== reportSha) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "APPROVAL_INTEGRITY_FAILED",
        message: `sha256 mismatch: approval has ${reportSha}, on-disk is ${actualSha}`,
        step_index: resumeReq.step_index,
        step_id: resumeReq.step_id,
      },
      written_step_reports,
    };
  }

  // ── 9. Adapter governance gate re-validated ─────────────────────────────
  const adapterResult = await deps.loadProjectAdapter(req.project_root);
  if (!adapterResult.ok) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "DISPATCH_ADAPTER_LOAD_FAILED",
        message: "failed to load project adapter",
        cause: adapterResult.error,
      },
      written_step_reports,
    };
  }

  const govFields = extractAdapterGovernance(adapterResult.adapter);

  if (govFields.mode !== "hybrid") {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "ADAPTER_GOVERNANCE_MISCONFIGURED",
        message: 'adapter.governance.system_state_updates.mode must be "hybrid"',
      },
      written_step_reports,
    };
  }
  if (
    !Array.isArray(govFields.require_manual_approval_for) ||
    !(govFields.require_manual_approval_for as string[]).includes("trust_change")
  ) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "ADAPTER_GOVERNANCE_MISCONFIGURED",
        message: 'adapter.governance.system_state_updates.require_manual_approval_for must include "trust_change"',
      },
      written_step_reports,
    };
  }
  if (
    !Array.isArray(govFields.auto_apply_for) ||
    !(govFields.auto_apply_for as string[]).includes("trivial")
  ) {
    return {
      ok: false,
      run_id: req.run_id,
      error: {
        code: "ADAPTER_GOVERNANCE_MISCONFIGURED",
        message: 'adapter.governance.system_state_updates.auto_apply_for must include "trivial"',
      },
      written_step_reports,
    };
  }

  const autoApplyFor = govFields.auto_apply_for as string[];
  const requireManualApprovalFor = govFields.require_manual_approval_for as string[];

  // ── Verify runner registry ──────────────────────────────────────────────
  for (const key of RUNNER_KEYS) {
    if (!deps.runnerRegistry[key]) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_RUNNER_MISSING",
          message: `runner missing for actor: ${key}`,
          actor: key,
        },
        written_step_reports,
      };
    }
  }

  // ── 10. Continue execution from step_index + 1 ─────────────────────────
  const startFrom = resumeReq.step_index + 1;
  const remainingSteps = req.steps.filter((s) => s.step_index >= startFrom);

  for (const step of remainingSteps) {
    if (!isSafeStepId(step.step_id)) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_INVALID_REQUEST",
          message: "invalid step_id (unsafe for filesystem path)",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    let input: unknown = undefined;
    if (step.input_ref) {
      if (step.input_ref.kind === "inline") {
        input = step.input_ref.value;
      } else if (step.input_ref.kind === "file") {
        return {
          ok: false,
          run_id: req.run_id,
          error: {
            code: "DISPATCH_INVALID_REQUEST",
            message: "file input_ref not supported without readFile dep",
            step_index: step.step_index,
            step_id: step.step_id,
            actor: step.actor,
          },
          written_step_reports,
        };
      }
    }

    const stepDir = `${req.artifacts_root}/steps/${step.step_index}-${step.step_id}`;

    if (deps.ensureDir) {
      await deps.ensureDir(stepDir);
    }

    // ── K9 §5  Resolve MemoryContext (position 5 in pre-step gate) ────────
    const memResultR = await deps.resolveMemoryContext(req.run_id, req.project_root);
    if (!memResultR.ok) {
      // Emit step.failed then run.failed — ordering is invariant (AC13).
      if (deps.appendEvent) {
        await deps.appendEvent({
          type: "step.failed",
          detail: {
            step_id: step.step_id,
            step_index: step.step_index,
            reason: "MEMORY_RETRIEVAL_FAILED",
            cause: { code: memResultR.code, message: memResultR.message },
          },
        });
        await deps.appendEvent({
          type: "run.failed",
          detail: {
            step_id: step.step_id,
            step_index: step.step_index,
            reason: "MEMORY_RETRIEVAL_FAILED",
          },
        });
      }
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "MEMORY_RETRIEVAL_FAILED",
          message: "memory context retrieval failed before step execution",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
          cause: { code: memResultR.code, message: memResultR.message },
        },
        written_step_reports,
      };
    }

    const resolvedMemoryR = memResultR.context;
    const mcHashR = memoryContextHash(resolvedMemoryR);

    // ── K9: Validate step-started payload before write ─────────────────
    const stepStartedPayloadR = { memory_context_hash: mcHashR, step_schema_version: "k10" };
    const stepStartedCheckR = verifyStepStartedEvent(stepStartedPayloadR);
    if (!stepStartedCheckR.ok) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "MEMORY_RETRIEVAL_FAILED",
          message: `step-started event validation failed: ${stepStartedCheckR.error}`,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    const ctx: FrozenStepContext = {
      run_id: req.run_id,
      step_index: step.step_index,
      step_id: step.step_id,
      actor: step.actor,
      action: step.action,
      project_root: req.project_root,
      artifacts_root: req.artifacts_root,
      input,
      capabilities: [...step.capabilities],
      adapter: adapterResult.adapter,
      memory: resolvedMemoryR,
    };

    // ── K9: Emit step-started.json with memory_context_hash ───────────
    if (deps.writeJsonFile) {
      await deps.writeJsonFile(`${stepDir}/step-started.json`, stepStartedPayloadR);
    }

    if (deps.writeJsonFile) {
      await deps.writeJsonFile(`${stepDir}/dispatch-context.json`, ctx);
    }

    deepFreeze(ctx);

    let output: RunnerOutput;
    try {
      output = await deps.runnerRegistry[step.actor].run(ctx);
    } catch (err) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_RUNNER_FAILED",
          message: `runner for ${step.actor} threw`,
          cause: err,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    if (output.step_report == null) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_STEP_REPORT_MISSING",
          message: "runner did not return step_report",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    const validation = deps.validateStepReport(output.step_report);
    if (!validation.ok) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_STEP_REPORT_INVALID",
          message: "step report failed validation",
          cause: validation,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    const reportObj = output.step_report as Record<string, unknown>;
    const state_impact = typeof reportObj["state_impact"] === "string"
      ? reportObj["state_impact"]
      : "";
    const trust_notes = typeof reportObj["trust_notes"] === "string"
      ? reportObj["trust_notes"]
      : undefined;

    const reportSuccess = reportObj["success"];
    const reportOutput = "output" in reportObj ? reportObj["output"] : undefined;

    if (state_impact === "trust_change") {
      if (trust_notes == null || trust_notes.trim().length === 0) {
        return {
          ok: false,
          run_id: req.run_id,
          error: {
            code: "TRUST_CHANGE_MISSING_NOTES",
            message: "trust_change requires a non-empty trust_notes field",
            step_index: step.step_index,
            step_id: step.step_id,
            actor: step.actor,
          },
          written_step_reports,
        };
      }
    }

    if (!KNOWN_STATE_IMPACTS.has(state_impact)) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "STEP_REPORT_INVALID",
          message: `unknown state_impact: "${state_impact}"`,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    if (reportSuccess === true && reportOutput === null) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "EXECUTOR_INVALID_RESULT",
          message: "runner reported success=true but output field is null",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    if (output.raw_log && deps.writeTextFile) {
      await deps.writeTextFile(`${stepDir}/runner-log.txt`, output.raw_log);
    }

    const writeResult = await deps.writeStepReport({
      artifacts_root: req.artifacts_root,
      step_index: step.step_index,
      step_id: step.step_id,
      step_report: output.step_report,
    });

    if (!writeResult.ok) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_WRITE_FAILED",
          message: "failed to write step report",
          cause: writeResult.error,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    written_step_reports.push({
      step_index: step.step_index,
      step_id: step.step_id,
      path: writeResult.path,
    });

    const hasOutput =
      "output" in reportObj &&
      reportObj["output"] !== undefined &&
      reportObj["output"] !== null;

    if (OUTPUT_REQUIRED_ACTIONS.has(step.action) && !hasOutput) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "OUTPUT_REQUIRED_MISSING",
          message: `action "${step.action}" requires a non-null output field in the step report`,
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    const writeOutputCalls = output.write_output_calls;
    if (hasOutput && writeOutputCalls !== undefined && writeOutputCalls === 0) {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "CAPABILITY_REQUIRED_NOT_USED",
          message:
            "step report contains an output field but runner never invoked the writeOutput capability",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
        },
        written_step_reports,
      };
    }

    const decision = governanceDecision(
      state_impact,
      trust_notes,
      autoApplyFor,
      requireManualApprovalFor,
    );

    if (decision === "require_manual_approval") {
      return {
        ok: false,
        run_id: req.run_id,
        error: {
          code: "DISPATCH_HALTED_GOVERNANCE",
          message: "manual approval required before execution can continue",
          step_index: step.step_index,
          step_id: step.step_id,
          actor: step.actor,
          cause: {
            state_impact,
            decision: "require_manual_approval",
          },
        },
        written_step_reports,
      };
    }
  }

  return { ok: true, run_id: req.run_id, written_step_reports };
}
