/**
 * Agent OS — Runtime Integration Layer R1
 * Runtime types: RuntimeConfig, RuntimeContext, RuntimeRunResult
 */

import type { ProjectAdapter } from "../adapter/schema.js";
import type { RunLedger } from "../planner/execution-types.js";
import type { DispatchResult } from "../dispatcher/errors.js";
import type { LLMProvider, PersistenceBackend, EmbeddingBackend } from "./providers.js";
import type { MemoryContextBackends } from "../memory/memory-context/assemble.js";
import type { RunnerRegistry } from "../dispatcher/types.js";

/** Resolved runtime configuration derived from ProjectAdapter + environment. */
export interface RuntimeConfig {
  readonly projectRoot: string;
  readonly adapter: ProjectAdapter;
  readonly artifactsRoot: string; // resolved from adapter.paths.run_root
}

/** Fully wired runtime context — everything needed to execute a run. */
export interface RuntimeContext {
  readonly config: RuntimeConfig;
  readonly persistence: PersistenceBackend;
  readonly llm: LLMProvider;
  readonly embedding: EmbeddingBackend | null;
  readonly memoryBackends: MemoryContextBackends;
  /**
   * Optional runner registry override. When present, replaces the default
   * stub runner registry in buildDispatchDeps. Intended for testing.
   */
  readonly runnerRegistry?: RunnerRegistry;
}

/**
 * Terminal result of a runtime execution.
 *
 * Note on "REJECTED" terminal_state:
 * "REJECTED" is a pre-run state emitted when the Planner readiness gate
 * rejects the plan before a RunLedger entry is created. It is NOT a
 * RunLifecycleState and does NOT appear in the RunLedger. The run_id and
 * ledger fields are absent on REJECTED results because no run was initiated.
 */
export type RuntimeRunResult =
  | {
      readonly ok: true;
      readonly run_id: string;
      readonly terminal_state: "COMPLETED";
      readonly step_count: number;
      readonly step_reports: ReadonlyArray<{
        step_index: number;
        step_id: string;
        path: string;
      }>;
      readonly ledger: RunLedger;
    }
  | {
      readonly ok: false;
      readonly run_id?: string;
      readonly terminal_state: "FAILED" | "HALTING" | "REJECTED";
      readonly reason: string;
      readonly ledger?: RunLedger;
      readonly dispatch_result?: DispatchResult;
    };
