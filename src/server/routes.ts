/**
 * Agent OS — API Layer: Route Handlers
 *
 * HTTP route handlers wrapping the runtime executeRun function.
 *
 * Routes:
 *   POST /api/v1/runs          — Execute a plan
 *   GET  /api/v1/runs/:id      — Get run status (from ledger)
 *   GET  /api/v1/health        — Health check
 *   POST /api/v1/runs/:id/approve — Approve a halted step
 */

import type { PlanArtifact } from "../planner/types.js";
import type { ProviderOverrides } from "../runtime/compose.js";
import type { RuntimeRunResult } from "../runtime/types.js";
import type { RunLedgerStore } from "../planner/run-ledger.js";
import { getLedger, getLedgerEvents } from "../planner/run-ledger.js";
import { executeRun } from "../runtime/orchestrator.js";
import type { AuthResult } from "./auth.js";

// ── Request/Response Types ──────────────────────────────────────────────────

export interface CreateRunRequest {
  /** The approved PlanArtifact to execute. */
  plan: PlanArtifact;
  /** Project root path on the server filesystem. */
  project_root: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface RunResponse {
  run_id: string;
  terminal_state: string;
  step_count?: number;
  step_reports?: ReadonlyArray<{
    step_index: number;
    step_id: string;
    path: string;
  }>;
  reason?: string;
}

export interface RunStatusResponse {
  run_id: string;
  state: string;
  plan_id: string;
  created_at: string;
  terminal_at: string | null;
  terminal_reason: string | null;
  event_count: number;
}

// ── Route Handler Context ───────────────────────────────────────────────────

export interface RouteContext {
  /** Provider overrides for executeRun. */
  providers?: Partial<ProviderOverrides>;
  /** Access to the current ledger store for status queries. */
  getLedgerStore: () => RunLedgerStore;
  /** Update ledger store reference after a run completes. */
  setLedgerStore: (store: RunLedgerStore) => void;
}

// ── Route Handlers ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/runs — Execute a plan.
 */
export async function handleCreateRun(
  body: unknown,
  auth: AuthResult,
  ctx: RouteContext,
): Promise<{ status: number; body: ApiResponse<RunResponse> }> {
  // Validate request body
  if (!body || typeof body !== "object") {
    return {
      status: 400,
      body: {
        ok: false,
        error: { code: "INVALID_REQUEST", message: "Request body must be a JSON object." },
      },
    };
  }

  const req = body as Record<string, unknown>;

  if (!req.plan || typeof req.plan !== "object") {
    return {
      status: 400,
      body: {
        ok: false,
        error: { code: "MISSING_PLAN", message: "Request must include a 'plan' field with a PlanArtifact." },
      },
    };
  }

  if (!req.project_root || typeof req.project_root !== "string") {
    return {
      status: 400,
      body: {
        ok: false,
        error: { code: "MISSING_PROJECT_ROOT", message: "Request must include a 'project_root' string." },
      },
    };
  }

  const plan = req.plan as PlanArtifact;
  const projectRoot = req.project_root as string;

  // Execute the run
  let result: RuntimeRunResult;
  try {
    result = await executeRun(plan, projectRoot, ctx.providers);
  } catch (err) {
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: "EXECUTION_ERROR",
          message: `Run execution threw: ${err instanceof Error ? err.message : String(err)}`,
        },
      },
    };
  }

  // Map result to API response
  if (result.ok) {
    // Update ledger store from the run's final state
    if (result.ledger) {
      const store = ctx.getLedgerStore();
      const newLedgers = new Map(store.ledgers);
      newLedgers.set(result.run_id, result.ledger);
      ctx.setLedgerStore(Object.freeze({ ledgers: newLedgers, events: store.events }));
    }

    return {
      status: 200,
      body: {
        ok: true,
        data: {
          run_id: result.run_id,
          terminal_state: result.terminal_state,
          step_count: result.step_count,
          step_reports: result.step_reports,
        },
      },
    };
  }

  // Failed or halted run
  const httpStatus = result.terminal_state === "REJECTED" ? 422 : 500;
  return {
    status: httpStatus,
    body: {
      ok: false,
      data: {
        run_id: result.run_id ?? "none",
        terminal_state: result.terminal_state,
        reason: result.reason,
      },
      error: {
        code: `RUN_${result.terminal_state}`,
        message: result.reason,
      },
    },
  };
}

/**
 * GET /api/v1/runs/:id — Get run status.
 */
export function handleGetRunStatus(
  runId: string,
  _auth: AuthResult,
  ctx: RouteContext,
): { status: number; body: ApiResponse<RunStatusResponse> } {
  const store = ctx.getLedgerStore();
  const ledger = getLedger(store, runId);

  if (!ledger) {
    return {
      status: 404,
      body: {
        ok: false,
        error: { code: "RUN_NOT_FOUND", message: `No run found with ID: ${runId}` },
      },
    };
  }

  const events = getLedgerEvents(store, runId);

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        run_id: ledger.run_id,
        state: ledger.state,
        plan_id: ledger.plan_id,
        created_at: ledger.created_at,
        terminal_at: ledger.terminal_at,
        terminal_reason: ledger.terminal_reason,
        event_count: events?.length ?? 0,
      },
    },
  };
}

/**
 * GET /api/v1/health — Health check.
 */
export function handleHealthCheck(): { status: number; body: ApiResponse<{ status: string }> } {
  return {
    status: 200,
    body: {
      ok: true,
      data: { status: "healthy" },
    },
  };
}
