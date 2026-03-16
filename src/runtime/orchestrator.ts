/**
 * Agent OS — Runtime Integration Layer R3
 * RuntimeOrchestrator: executeRun end-to-end
 *
 * AC-R3-01: executeRun takes an approved PlanArtifact and returns RuntimeRunResult
 * AC-R3-02: Readiness gate rejection produces structured rejection (not a throw)
 * AC-R3-03: Successful execution → COMPLETED RunLedger with frozen readiness_verdict
 * AC-R3-04: Failed execution → FAILED RunLedger with terminal_reason
 * AC-R3-05: Governance halt → HALTING RunLedger; result indicates halt, not failure
 * AC-R3-06: Memory ingestion post-execution (when persistence provides MemoryStore)
 * AC-R3-07: Memory ingestion failure does not fail the run
 * AC-R3-12: No frozen subsystem interface modified
 */

import { randomBytes } from "node:crypto";

import type { PlanArtifact } from "../planner/types.js";
import type { RuntimeRunResult } from "./types.js";
import type { ProviderOverrides } from "./compose.js";
import { buildRuntimeContext, buildDispatchDeps } from "./compose.js";
import { assessReadiness } from "../planner/readiness-gate.js";
import { initiateRunWithReadiness } from "../planner/execution.js";
import {
  createRunLedger,
  updateLedgerState,
  type RunLedgerStore,
} from "../planner/run-ledger.js";
import { translatePlanToDispatch, syncDispatchResult } from "./bridge.js";
import { dispatchRun } from "../dispatcher/dispatchRun.js";
import { ingestCompletedSteps } from "./memory-ingest.js";

// ── Run ID generation ─────────────────────────────────────────────────────────

/** Crockford's Base32 character set (26 symbols: 0-9, A-H, J-K, M-N, P-T, V-Z). */
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a valid run_id: "run_" + 26 Crockford Base32 characters.
 * Uses crypto.randomBytes for unpredictability.
 */
function generateRunId(): string {
  const bytes = randomBytes(26);
  let result = "";
  for (let i = 0; i < 26; i++) {
    result += CROCKFORD_BASE32[bytes[i] % 32];
  }
  return `run_${result}`;
}

// ── executeRun ────────────────────────────────────────────────────────────────

/**
 * Execute an approved PlanArtifact end-to-end.
 *
 * Orchestration sequence (9 steps):
 *   1. Build runtime context (load adapter, compose providers)
 *   2. Assess readiness via Planner readiness gate
 *   3. Create run via initiateRunWithReadiness (frozen readiness_verdict)
 *   4. Transition PENDING_ACK → INITIATING → RUNNING
 *   5. Translate plan → DispatchRequestV1 via bridge
 *   6. Execute via dispatchRun (Dispatcher)
 *   7. Sync dispatch result → RunLedger state
 *   8. Ingest step reports → Memory (K2 pipeline, graceful)
 *   9. Return terminal RuntimeRunResult
 *
 * Returns a structured result — never throws on expected failure paths.
 * Throws only on programming-error precondition violations (duplicate run_id,
 * invalid run_id format) that indicate a caller bug, not normal operation.
 */
export async function executeRun(
  plan: PlanArtifact,
  projectRoot: string,
  providers?: Partial<ProviderOverrides>,
): Promise<RuntimeRunResult> {

  // ── Step 1: Build runtime context ─────────────────────────────────────────

  const contextResult = buildRuntimeContext(projectRoot, providers);
  if (!contextResult.ok) {
    return {
      ok: false,
      terminal_state: "REJECTED",
      reason: `Context build failed [${contextResult.code}]: ${contextResult.message}`,
    };
  }
  const context = contextResult.context;

  // ── Step 2: Assess readiness (AC-R3-02) ───────────────────────────────────

  const verdict = assessReadiness(plan);
  if (verdict.status !== "READY") {
    const blockingMessages = verdict.findings
      .filter((f) => f.severity === "BLOCKING")
      .map((f) => f.message)
      .join("; ");
    return {
      ok: false,
      terminal_state: "REJECTED",
      reason: `Readiness gate rejected plan: ${blockingMessages || "NOT_READY"}`,
    };
  }

  // ── Step 3: Create run via initiateRunWithReadiness (AC-R3-03) ────────────

  const runId = generateRunId();
  const ts = new Date().toISOString();
  let store: RunLedgerStore = context.persistence.runLedgerStore();

  let runCreation;
  try {
    runCreation = initiateRunWithReadiness(
      plan,
      verdict,
      store,
      runId,
      "agent-os-runtime-1.0",
      ts,
      "agent-os-cli",
    );
  } catch (err) {
    return {
      ok: false,
      terminal_state: "REJECTED",
      reason: `Run initiation threw: ${String(err)}`,
    };
  }

  if ("rejected" in runCreation) {
    return {
      ok: false,
      terminal_state: "REJECTED",
      reason: `Run creation rejected [${runCreation.reason}]: plan hash may be stale or plan not ready`,
    };
  }

  // Rebuild store with the created ledger.
  //
  // initiateRunWithReadiness creates the ledger in a functional copy of the
  // passed store. The original `store` is unchanged. We replicate that
  // by calling createRunLedger on the original store with the same
  // ledger entry returned in runCreation.ledger_entry.
  const rebuildResult = createRunLedger(store, runCreation.ledger_entry);
  if (!rebuildResult.ok) {
    return {
      ok: false,
      run_id: runId,
      terminal_state: "FAILED",
      reason: `Ledger store rebuild failed [${rebuildResult.code}]: ${rebuildResult.message}`,
    };
  }
  store = rebuildResult.data;

  // ── Step 4: Transition PENDING_ACK → INITIATING → RUNNING ─────────────────

  const initiatingResult = updateLedgerState(store, runId, "INITIATING", ts);
  if (!initiatingResult.ok) {
    return {
      ok: false,
      run_id: runId,
      terminal_state: "FAILED",
      reason: `State transition to INITIATING failed: ${initiatingResult.message}`,
    };
  }
  store = initiatingResult.data;

  const runningResult = updateLedgerState(store, runId, "RUNNING", ts);
  if (!runningResult.ok) {
    return {
      ok: false,
      run_id: runId,
      terminal_state: "FAILED",
      reason: `State transition to RUNNING failed: ${runningResult.message}`,
    };
  }
  store = runningResult.data;

  // ── Step 5: Translate plan → DispatchRequestV1 ────────────────────────────

  const translationResult = translatePlanToDispatch(
    plan,
    runCreation.ledger_entry,
    context.config.adapter,
  );
  if (!translationResult.ok) {
    return {
      ok: false,
      run_id: runId,
      terminal_state: "FAILED",
      reason: `Plan translation failed [${translationResult.code}]: ${translationResult.message}`,
    };
  }

  // ── Step 6: Build DispatchDeps and execute via dispatchRun ─────────────────

  const deps = buildDispatchDeps(context);
  const dispatchResult = await dispatchRun(translationResult.request, deps);

  // ── Step 7: Sync dispatch result → RunLedger state ────────────────────────

  const syncResult = syncDispatchResult(dispatchResult, store, runId);
  if (!syncResult.ok) {
    return {
      ok: false,
      run_id: runId,
      terminal_state: "FAILED",
      reason: `Ledger sync failed [${syncResult.code}]: ${syncResult.message}`,
    };
  }
  store = syncResult.store;

  // Propagate updated store to persistence backend.
  // Uses duck-typed optional method so production backends without
  // updateRunLedgerStore are unaffected.
  const mutablePersistence = context.persistence as {
    updateRunLedgerStore?: (s: RunLedgerStore) => void;
  };
  mutablePersistence.updateRunLedgerStore?.(store);

  const finalLedger = store.ledgers.get(runId);

  // ── Step 8: Memory ingestion post-execution (AC-R3-06/07) ─────────────────

  // Graceful: memory ingestion failures never fail the run.
  await ingestCompletedSteps(context, dispatchResult);

  // ── Step 9: Return terminal RuntimeRunResult (AC-R3-01) ───────────────────

  if (dispatchResult.ok) {
    // AC-R3-03: successful execution → COMPLETED
    return {
      ok: true,
      run_id: runId,
      terminal_state: "COMPLETED",
      step_count: dispatchResult.written_step_reports.length,
      step_reports: dispatchResult.written_step_reports,
      ledger: finalLedger!,
    };
  }

  // AC-R3-05: governance halt → HALTING (not FAILED)
  // AC-R3-04: other failures → FAILED
  const terminalState = syncResult.terminal_state === "HALTING" ? "HALTING" : "FAILED";
  return {
    ok: false,
    run_id: runId,
    terminal_state: terminalState,
    reason: dispatchResult.error.message,
    ledger: finalLedger,
    dispatch_result: dispatchResult,
  };
}
