/**
 * Agent OS — Planner Subsystem P1-S3: Append-Only Run Ledger
 *
 * In-memory implementation of the run ledger (§8).
 * RunLedgerEvent rows are INSERT only. No UPDATE, no DELETE.
 * RunLedger.state is the only mutable field; mutations are lifecycle-guarded.
 *
 * IMPORTANT: PlanArtifact.run_id is intentionally not used by P1-S3.
 * Authoritative execution binding lives in RunLedger.
 * Plan ↔ Run binding is through plan_id + plan_version.
 *
 * Freeze policy:
 * - Stored RunLedger entries are Object.freeze-d (shallow).
 * - Stored RunLedgerEvent entries are Object.freeze-d (shallow).
 * - Event arrays per run are frozen after copy.
 * - Top-level RunLedgerStore is Object.freeze-d.
 * - plan_snapshot is treated as write-once by API contract.
 *   Deep freeze is NOT applied to plan_snapshot because it is an
 *   arbitrary caller-supplied blob. Immutability of snapshot content
 *   is enforced by the absence of any mutation path in this module.
 *
 * This file is strictly ledger-only:
 * - No handoff validation
 * - No transition orchestration
 * - No time generation
 * - No ID generation
 * - No Foreman protocol logic
 *
 * Command ruling — Atlas inconsistency resolution:
 * Atlas §7 diagram includes CANCELLING but §7.1 state definitions exclude it.
 * P1-S3 does NOT add CANCELLING. Cancellation transition is RUNNING → CANCELLED.
 */

import type {
  RunLedger,
  RunLedgerEvent,
  RunLifecycleState,
  TerminalRunState,
} from "./execution-types.js";

import { TERMINAL_RUN_STATES } from "./execution-types.js";

// ── Ledger Error Codes (closed set) ──────────────────────────────────────────

export type LedgerErrorCode =
  | "DUPLICATE_RUN_ID"
  | "INVALID_RUN_ID"
  | "RUN_NOT_FOUND"
  | "LEDGER_SEQUENCE_GAP"
  | "LEDGER_SEQUENCE_REGRESSION"
  | "TERMINAL_STATE_LOCKED"
  | "INVALID_STATE_TRANSITION"
  | "ACTIVE_RUN_EXISTS"
  | "PLAN_ID_MISMATCH";

export const LEDGER_ERROR_CODES: ReadonlySet<string> = new Set<LedgerErrorCode>([
  "DUPLICATE_RUN_ID",
  "INVALID_RUN_ID",
  "RUN_NOT_FOUND",
  "LEDGER_SEQUENCE_GAP",
  "LEDGER_SEQUENCE_REGRESSION",
  "TERMINAL_STATE_LOCKED",
  "INVALID_STATE_TRANSITION",
  "ACTIVE_RUN_EXISTS",
  "PLAN_ID_MISMATCH",
]);

// ── Result Types ─────────────────────────────────────────────────────────────

export interface LedgerOk<T> {
  ok: true;
  data: T;
}

export interface LedgerFail {
  ok: false;
  code: LedgerErrorCode;
  message: string;
}

export type LedgerResult<T> = LedgerOk<T> | LedgerFail;

// ── Terminal State Helper ────────────────────────────────────────────────────

/**
 * Type-safe terminal state check. Eliminates unsafe casts throughout module.
 */
export function isTerminalRunState(
  state: RunLifecycleState,
): state is TerminalRunState {
  return TERMINAL_RUN_STATES.has(state as TerminalRunState);
}

// ── Run Lifecycle Transition Rules ───────────────────────────────────────────

/**
 * Allowed run lifecycle transitions (§7 + Command ruling).
 *
 * Command ruling: CANCELLING is NOT a defined state.
 * Cancellation path is RUNNING → CANCELLED (direct).
 */
const ALLOWED_RUN_TRANSITIONS: ReadonlyMap<
  RunLifecycleState,
  ReadonlySet<RunLifecycleState>
> = new Map([
  ["PENDING_ACK", new Set<RunLifecycleState>(["INITIATING"])],
  ["INITIATING", new Set<RunLifecycleState>(["RUNNING", "FAILED"])],
  ["RUNNING", new Set<RunLifecycleState>(["HALTING", "COMPLETING", "CANCELLED"])],
  ["HALTING", new Set<RunLifecycleState>(["FAILED"])],
  ["COMPLETING", new Set<RunLifecycleState>(["COMPLETED"])],
  ["COMPLETED", new Set<RunLifecycleState>()],
  ["FAILED", new Set<RunLifecycleState>()],
  ["CANCELLED", new Set<RunLifecycleState>()],
]);

/**
 * Pure predicate: is the (from → to) transition valid under P1-S3 lifecycle rules?
 */
export function isValidRunLifecycleTransition(
  from: RunLifecycleState,
  to: RunLifecycleState,
): boolean {
  const allowed = ALLOWED_RUN_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.has(to);
}

// ── In-Memory Ledger Store ───────────────────────────────────────────────────

export interface RunLedgerStore {
  readonly ledgers: ReadonlyMap<string, RunLedger>;
  readonly events: ReadonlyMap<string, readonly RunLedgerEvent[]>;
}

/**
 * Create an empty ledger store.
 * Explicit factory name signals initial-state intent.
 */
export function createEmptyLedgerStore(): RunLedgerStore {
  return Object.freeze({
    ledgers: new Map(),
    events: new Map(),
  });
}

// ── run_id Format Validation ─────────────────────────────────────────────────

/**
 * Validate run_id format: run_{ulid}
 * ULID is 26 characters of Crockford's Base32 (excludes I, L, O, U).
 */
export function isValidRunId(runId: string): boolean {
  return /^run_[0-9A-HJKMNP-TV-Z]{26}$/i.test(runId);
}

// ── Ledger Creation ──────────────────────────────────────────────────────────

/**
 * Create a new run ledger entry.
 * Returns a new store with the ledger added.
 *
 * Fails if:
 * - run_id format is invalid (INVALID_RUN_ID)
 * - run_id already exists (DUPLICATE_RUN_ID)
 * - ledger.state is not PENDING_ACK (INVALID_STATE_TRANSITION)
 * - an active run already exists for this plan_id (ACTIVE_RUN_EXISTS)
 */
export function createRunLedger(
  store: RunLedgerStore,
  ledger: RunLedger,
): LedgerResult<RunLedgerStore> {
  if (!isValidRunId(ledger.run_id)) {
    return {
      ok: false,
      code: "INVALID_RUN_ID",
      message: `run_id must match format run_{ulid}, got: ${ledger.run_id}`,
    };
  }

  if (store.ledgers.has(ledger.run_id)) {
    return {
      ok: false,
      code: "DUPLICATE_RUN_ID",
      message: `run_id ${ledger.run_id} already exists in ledger store`,
    };
  }

  if (ledger.state !== "PENDING_ACK") {
    return {
      ok: false,
      code: "INVALID_STATE_TRANSITION",
      message: `New run ledger must start in PENDING_ACK, got: ${ledger.state}`,
    };
  }

  if (getActiveRunForPlan(store, ledger.plan_id) !== undefined) {
    return {
      ok: false,
      code: "ACTIVE_RUN_EXISTS",
      message: `An active run already exists for plan_id ${ledger.plan_id}`,
    };
  }

  const newLedgers = new Map(store.ledgers);
  newLedgers.set(ledger.run_id, Object.freeze({ ...ledger }));

  const newEvents = new Map(store.events);
  newEvents.set(ledger.run_id, Object.freeze([] as RunLedgerEvent[]));

  return {
    ok: true,
    data: Object.freeze({ ledgers: newLedgers, events: newEvents }),
  };
}

// ── Event Append (append-only, §8 invariant) ─────────────────────────────────

/**
 * Append an event to a run's event log.
 *
 * Validates:
 * - run_id exists in both ledgers and events maps (RUN_NOT_FOUND)
 * - event.plan_id matches RunLedger.plan_id (PLAN_ID_MISMATCH)
 *
 * Sequence rules (AC-6):
 * - First event sequence must be 1.
 * - Each subsequent event must equal previous + 1.
 * - Duplicate sequence → LEDGER_SEQUENCE_REGRESSION.
 * - Regression (lower than expected) → LEDGER_SEQUENCE_REGRESSION.
 * - Gap (higher than expected) → LEDGER_SEQUENCE_GAP.
 *
 * Returns a new store with the event appended. Never mutates input.
 */
export function appendLedgerEvent(
  store: RunLedgerStore,
  event: RunLedgerEvent,
): LedgerResult<RunLedgerStore> {
  const ledger = store.ledgers.get(event.run_id);
  const existingEvents = store.events.get(event.run_id);

  if (ledger === undefined || existingEvents === undefined) {
    return {
      ok: false,
      code: "RUN_NOT_FOUND",
      message: `No ledger found for run_id: ${event.run_id}`,
    };
  }

  if (event.plan_id !== ledger.plan_id) {
    return {
      ok: false,
      code: "PLAN_ID_MISMATCH",
      message: `Event plan_id ${event.plan_id} does not match ledger plan_id ${ledger.plan_id}`,
    };
  }

  const expectedSequence = existingEvents.length + 1;

  if (event.sequence < expectedSequence) {
    return {
      ok: false,
      code: "LEDGER_SEQUENCE_REGRESSION",
      message: `Sequence regression: expected ${expectedSequence}, got ${event.sequence}`,
    };
  }

  if (event.sequence > expectedSequence) {
    return {
      ok: false,
      code: "LEDGER_SEQUENCE_GAP",
      message: `Sequence gap: expected ${expectedSequence}, got ${event.sequence}`,
    };
  }

  const newEvents = new Map(store.events);
  const updatedRunEvents = Object.freeze([
    ...existingEvents,
    Object.freeze({ ...event }),
  ]);
  newEvents.set(event.run_id, updatedRunEvents);

  return {
    ok: true,
    data: Object.freeze({ ledgers: store.ledgers, events: newEvents }),
  };
}

// ── Ledger State Update (only mutable field, §8) ─────────────────────────────

/**
 * Update the state of a run ledger.
 * RunLedger.state is the ONLY mutable field (§8 invariant).
 *
 * Enforces:
 * - No terminal → non-terminal (AC-8).
 * - No terminal → terminal rewrite.
 * - Only transitions in ALLOWED_RUN_TRANSITIONS are permitted.
 *
 * Returns a new store with the updated ledger.
 */
export function updateLedgerState(
  store: RunLedgerStore,
  runId: string,
  newState: RunLifecycleState,
  stateEnteredAt: string,
  terminalReason?: string,
): LedgerResult<RunLedgerStore> {
  const ledger = store.ledgers.get(runId);
  if (!ledger) {
    return {
      ok: false,
      code: "RUN_NOT_FOUND",
      message: `No ledger found for run_id: ${runId}`,
    };
  }

  if (isTerminalRunState(ledger.state)) {
    return {
      ok: false,
      code: "TERMINAL_STATE_LOCKED",
      message: `Run ${runId} is in terminal state ${ledger.state}; no further transitions allowed`,
    };
  }

  if (!isValidRunLifecycleTransition(ledger.state, newState)) {
    return {
      ok: false,
      code: "INVALID_STATE_TRANSITION",
      message: `Transition ${ledger.state} → ${newState} is not allowed`,
    };
  }

  const terminal = isTerminalRunState(newState);

  const updatedLedger: RunLedger = {
    ...ledger,
    state: newState,
    state_entered_at: stateEnteredAt,
    terminal_at: terminal ? stateEnteredAt : ledger.terminal_at,
    terminal_reason: terminal ? (terminalReason ?? null) : ledger.terminal_reason,
  };

  const newLedgers = new Map(store.ledgers);
  newLedgers.set(runId, Object.freeze(updatedLedger));

  return {
    ok: true,
    data: Object.freeze({ ledgers: newLedgers, events: store.events }),
  };
}

// ── Read Helpers ─────────────────────────────────────────────────────────────

/**
 * Get events for a run.
 * Returns the frozen event array if the run exists.
 * Returns undefined if run does not exist.
 *
 * A missing ledger is NOT the same as a run with zero events.
 */
export function getLedgerEvents(
  store: RunLedgerStore,
  runId: string,
): readonly RunLedgerEvent[] | undefined {
  return store.events.get(runId);
}

/**
 * Get a ledger entry by run_id. Returns undefined if not found.
 */
export function getLedger(
  store: RunLedgerStore,
  runId: string,
): RunLedger | undefined {
  return store.ledgers.get(runId);
}

/**
 * Get the last sequence number for a run's events.
 *
 * Returns undefined when:
 * - run does not exist in the store
 * - run exists but has zero events
 *
 * Both cases return undefined. Caller should use getLedger() to
 * distinguish between a missing run and a run with no events.
 */
export function getLastSequence(
  store: RunLedgerStore,
  runId: string,
): number | undefined {
  const events = store.events.get(runId);
  if (!events || events.length === 0) return undefined;
  return events[events.length - 1].sequence;
}

// ── Active Run Helpers ───────────────────────────────────────────────────────

/**
 * Check if a plan_id has an active (non-terminal) run.
 *
 * Active means any state that is NOT terminal:
 * PENDING_ACK, INITIATING, RUNNING, HALTING, COMPLETING
 *
 * Terminal (inactive):
 * COMPLETED, FAILED, CANCELLED
 */
export function hasActiveRun(
  store: RunLedgerStore,
  planId: string,
): boolean {
  return getActiveRunForPlan(store, planId) !== undefined;
}

/**
 * Get the active (non-terminal) run ledger for a plan_id.
 * Returns undefined if no active run exists.
 *
 * Provides exact conflicting run visibility for handoff validation.
 */
export function getActiveRunForPlan(
  store: RunLedgerStore,
  planId: string,
): RunLedger | undefined {
  for (const ledger of store.ledgers.values()) {
    if (ledger.plan_id === planId && !isTerminalRunState(ledger.state)) {
      return ledger;
    }
  }
  return undefined;
}
