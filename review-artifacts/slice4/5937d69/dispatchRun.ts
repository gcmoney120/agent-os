/**
 * Agent OS v1.0 — Dispatcher (Slices 3 + 4).
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
 * All IO goes through deps — dispatchRun is pure.
 */

import type {
  DispatchRequestV1,
  DispatchDeps,
  FrozenStepContext,
  RunnerRegistry,
  RunnerOutput,
} from "./types.js";
import type { DispatchResult } from "./errors.js";

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
    };

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
          cause: validation.error,
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

    // ── §8.8  Slice 4: trust_change requires non-empty trust_notes ─────
    // This check fires BEFORE writeStepReport — a violating report is not written.
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
