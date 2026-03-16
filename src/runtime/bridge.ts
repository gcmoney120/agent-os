/**
 * Agent OS — Runtime Integration Layer R2
 * Plan-Dispatch Bridge: translatePlanToDispatch + syncDispatchResult
 *
 * Implements:
 *   - Binding Contract 1: PlanArtifact → DispatchRequestV1
 *   - Binding Contract 2: DispatchResult → RunLedger sync
 */

import type { PlanArtifact, PlanStep } from "../planner/types.js";
import type { RunLedger } from "../planner/execution-types.js";
import type { ProjectAdapter } from "../adapter/schema.js";
import type { DispatchRequestV1, DispatchStepV1 } from "../dispatcher/types.js";
import type { DispatchResult } from "../dispatcher/errors.js";
import type { RunLedgerStore } from "../planner/run-ledger.js";
import { updateLedgerState, appendLedgerEvent, getLedgerEvents } from "../planner/run-ledger.js";
import type { RunLedgerEvent } from "../planner/execution-types.js";
import { AGENT_ROLE_TO_ACTOR_KEY, type PlanTranslationResult, type LedgerSyncResult } from "./bridge-types.js";
import * as path from "node:path";

// ── Binding Contract 1: PlanArtifact → DispatchRequestV1 ─────────────────────

/**
 * Translate a PlanArtifact into a DispatchRequestV1 ready for dispatchRun.
 *
 * Mapping rules (Binding Contract 1):
 * - PlanStep.sequence (1-based) → DispatchStepV1.step_index (0-based): sequence - 1
 * - PlanStep.agent: AgentRole → DispatchStepV1.actor: ActorKey via AGENT_ROLE_TO_ACTOR_KEY
 * - PlanStep.input_contract → DispatchStepV1.action
 * - DispatchStepV1.capabilities derived from trust_touch + adapter policy
 * - DispatchRequestV1.run_id = runLedger.run_id
 * - DispatchRequestV1.project_root = adapter.project.repo_root
 * - DispatchRequestV1.artifacts_root = path.join(projectRoot, adapter.paths.run_root, runLedger.run_id)
 */
export function translatePlanToDispatch(
  plan: PlanArtifact,
  runLedger: RunLedger,
  adapter: ProjectAdapter,
): PlanTranslationResult {
  const projectRoot = adapter.project.repo_root;

  if (plan.steps.length === 0) {
    // An empty plan is valid — yields a zero-step dispatch request.
    const request: DispatchRequestV1 = {
      schema_version: "1.0",
      run_id: runLedger.run_id,
      project_root: projectRoot,
      artifacts_root: path.join(projectRoot, adapter.paths.run_root, runLedger.run_id),
      steps: [],
    };
    return { ok: true, request };
  }

  const steps: DispatchStepV1[] = [];

  for (const planStep of plan.steps) {
    const translationResult = translateStep(planStep, adapter);
    if (!translationResult.ok) {
      return { ok: false, code: translationResult.code, message: translationResult.message };
    }
    steps.push(translationResult.step);
  }

  const request: DispatchRequestV1 = {
    schema_version: "1.0",
    run_id: runLedger.run_id,
    project_root: projectRoot,
    artifacts_root: path.join(projectRoot, adapter.paths.run_root, runLedger.run_id),
    steps,
  };

  return { ok: true, request };
}

/** Translate a single PlanStep to a DispatchStepV1. Internal helper. */
function translateStep(
  step: PlanStep,
  adapter: ProjectAdapter,
): { ok: true; step: DispatchStepV1 } | { ok: false; code: string; message: string } {
  const actor = AGENT_ROLE_TO_ACTOR_KEY[step.agent];
  if (actor === undefined) {
    return {
      ok: false,
      code: "BRIDGE_UNKNOWN_AGENT_ROLE",
      message: `Unknown agent role: ${step.agent}`,
    };
  }

  const capabilities = deriveCapabilities(step, adapter);

  const dispatchStep: DispatchStepV1 = {
    step_index: step.sequence - 1,
    step_id: step.step_id,
    actor,
    action: step.input_contract,
    capabilities,
  };

  return { ok: true, step: dispatchStep };
}

/**
 * Derive capabilities for a step from trust_touch flag + adapter policy.
 *
 * Trust-touch steps receive the trust_change capability so the governance
 * gate in dispatchRun can apply the manual-approval policy.
 * All steps receive the adapter's enforced_output_required_actions as
 * their base capability set when they match the step's action.
 */
function deriveCapabilities(step: PlanStep, adapter: ProjectAdapter): string[] {
  const caps: string[] = [];

  if (step.trust_touch) {
    caps.push("trust_change");
  }

  // Include any adapter-enforced output_required actions that match this step
  for (const action of adapter.policy.enforced_output_required_actions) {
    if (action === step.input_contract && !caps.includes("output_required")) {
      caps.push("output_required");
    }
  }

  return caps;
}

// ── Binding Contract 2: DispatchResult → RunLedger Sync ──────────────────────

/**
 * Synchronize a DispatchResult back to the RunLedgerStore.
 *
 * Success path (Binding Contract 2):
 *   RUNNING → COMPLETING → COMPLETED
 *   + one STEP_COMPLETED event per written_step_reports entry
 *
 * Governance halt path:
 *   error.code === "DISPATCH_HALTED_GOVERNANCE":
 *   RUNNING → HALTING (stays in HALTING — awaits approval-resume)
 *
 * Other failure path:
 *   RUNNING → HALTING → FAILED
 *   + one RUN_FAILED event
 */
export function syncDispatchResult(
  result: DispatchResult,
  store: RunLedgerStore,
  runId: string,
): LedgerSyncResult {
  const ts = new Date().toISOString();

  if (result.ok) {
    return syncSuccess(result, store, runId, ts);
  }

  const code = result.error.code;

  if (code === "DISPATCH_HALTED_GOVERNANCE") {
    return syncGovernanceHalt(result, store, runId, ts);
  }

  return syncFailure(result, store, runId, ts);
}

function syncSuccess(
  result: DispatchResult & { ok: true },
  store: RunLedgerStore,
  runId: string,
  ts: string,
): LedgerSyncResult {
  // RUNNING → COMPLETING
  const completingResult = updateLedgerState(store, runId, "COMPLETING", ts);
  if (!completingResult.ok) {
    return {
      ok: false,
      code: "BRIDGE_LEDGER_SYNC_FAILED",
      message: `Failed to transition to COMPLETING: ${completingResult.message}`,
    };
  }

  // COMPLETING → COMPLETED
  const completedResult = updateLedgerState(completingResult.data, runId, "COMPLETED", ts);
  if (!completedResult.ok) {
    return {
      ok: false,
      code: "BRIDGE_LEDGER_SYNC_FAILED",
      message: `Failed to transition to COMPLETED: ${completedResult.message}`,
    };
  }

  let currentStore = completedResult.data;
  const ledger = currentStore.ledgers.get(runId);
  if (!ledger) {
    return {
      ok: false,
      code: "BRIDGE_LEDGER_SYNC_FAILED",
      message: `Ledger not found for run_id: ${runId} after state transitions`,
    };
  }

  // Append STEP_COMPLETED event for each written step report
  for (const report of result.written_step_reports) {
    const existingEvents = getLedgerEvents(currentStore, runId) ?? [];
    const nextSequence = existingEvents.length + 1;

    const event: RunLedgerEvent = {
      event_id: `evt_step_completed_${report.step_index}_${runId}`,
      run_id: runId,
      plan_id: ledger.plan_id,
      sequence: nextSequence,
      event_type: "STEP_COMPLETED",
      emitted_at: ts,
      emitted_by: "foreman",
      payload: {
        step_id: report.step_id,
        agent_id: String(report.step_index),
        output_checksum: report.path,
        duration_ms: 0,
      },
    };

    const appendResult = appendLedgerEvent(currentStore, event);
    if (!appendResult.ok) {
      return {
        ok: false,
        code: "BRIDGE_LEDGER_SYNC_FAILED",
        message: `Failed to append STEP_COMPLETED event for step ${report.step_index}: ${appendResult.message}`,
      };
    }
    currentStore = appendResult.data;
  }

  return { ok: true, store: currentStore, terminal_state: "COMPLETED" };
}

function syncGovernanceHalt(
  result: DispatchResult & { ok: false },
  store: RunLedgerStore,
  runId: string,
  ts: string,
): LedgerSyncResult {
  // RUNNING → HALTING (stays — awaits approval-resume via Relay)
  const haltingResult = updateLedgerState(
    store,
    runId,
    "HALTING",
    ts,
    result.error.message,
  );
  if (!haltingResult.ok) {
    return {
      ok: false,
      code: "BRIDGE_LEDGER_SYNC_FAILED",
      message: `Failed to transition to HALTING (governance): ${haltingResult.message}`,
    };
  }

  return { ok: true, store: haltingResult.data, terminal_state: "HALTING" };
}

function syncFailure(
  result: DispatchResult & { ok: false },
  store: RunLedgerStore,
  runId: string,
  ts: string,
): LedgerSyncResult {
  // RUNNING → HALTING
  const haltingResult = updateLedgerState(
    store,
    runId,
    "HALTING",
    ts,
    result.error.message,
  );
  if (!haltingResult.ok) {
    return {
      ok: false,
      code: "BRIDGE_LEDGER_SYNC_FAILED",
      message: `Failed to transition to HALTING: ${haltingResult.message}`,
    };
  }

  // HALTING → FAILED
  const failedResult = updateLedgerState(
    haltingResult.data,
    runId,
    "FAILED",
    ts,
    result.error.message,
  );
  if (!failedResult.ok) {
    return {
      ok: false,
      code: "BRIDGE_LEDGER_SYNC_FAILED",
      message: `Failed to transition to FAILED: ${failedResult.message}`,
    };
  }

  let currentStore = failedResult.data;
  const ledger = currentStore.ledgers.get(runId);
  if (!ledger) {
    return {
      ok: false,
      code: "BRIDGE_LEDGER_SYNC_FAILED",
      message: `Ledger not found for run_id: ${runId} after FAILED transition`,
    };
  }

  // Append RUN_FAILED event
  const existingEvents = getLedgerEvents(currentStore, runId) ?? [];
  const nextSequence = existingEvents.length + 1;
  const completedSteps = result.written_step_reports?.length ?? 0;

  const event: RunLedgerEvent = {
    event_id: `evt_run_failed_${runId}`,
    run_id: runId,
    plan_id: ledger.plan_id,
    sequence: nextSequence,
    event_type: "RUN_FAILED",
    emitted_at: ts,
    emitted_by: "foreman",
    payload: {
      terminal_reason: result.error.message,
      step_count_completed: completedSteps,
      step_count_total: completedSteps,
      duration_ms: 0,
    },
  };

  const appendResult = appendLedgerEvent(currentStore, event);
  if (!appendResult.ok) {
    return {
      ok: false,
      code: "BRIDGE_LEDGER_SYNC_FAILED",
      message: `Failed to append RUN_FAILED event: ${appendResult.message}`,
    };
  }

  return { ok: true, store: appendResult.data, terminal_state: "FAILED" };
}
