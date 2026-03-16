/**
 * Agent OS — Runtime Integration Layer R1
 * Plan-to-Dispatch bridge types: AGENT_ROLE_TO_ACTOR_KEY, PlanTranslationResult, LedgerSyncResult
 */

import type { AgentRole } from "../planner/types.js";
import type { ActorKey, DispatchRequestV1 } from "../dispatcher/types.js";
import type { RunLedgerStore } from "../planner/run-ledger.js";
import type { RunLifecycleState } from "../planner/execution-types.js";

/** Canonical AgentRole → ActorKey mapping. Immutable const record. */
export const AGENT_ROLE_TO_ACTOR_KEY: Readonly<Record<AgentRole, ActorKey>> = {
  Command: "command",
  Atlas: "atlas",
  Forge: "forge",
  Sentinel: "sentinel",
  Compass: "compass",
} as const;

/** Result of plan-to-dispatch translation. */
export type PlanTranslationResult =
  | { readonly ok: true; readonly request: DispatchRequestV1 }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Result of dispatch-to-ledger synchronization. */
export type LedgerSyncResult =
  | {
      readonly ok: true;
      readonly store: RunLedgerStore;
      readonly terminal_state: RunLifecycleState;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };
