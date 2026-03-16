/**
 * Agent OS — K7 Memory Context Assembly
 * Episodic lane retrieval and truncation.
 *
 * Source: memory-context-assembly-k7-v1.1.md §6.1, §6.2
 * Slice: K7 — Memory Context Assembly
 *
 * Calls K3 queryEpisodicEvents, reverses to DESC order (K3 returns ASC),
 * truncates to max_items. Returns items with pre-truncation available count.
 *
 * Cross-run mode: K3 has an OPEN_ENDED_SCAN guard requiring run_id.
 * For cross-run, K3 is called once per run_id in run_id_list; results are
 * merged and sorted DESC before truncation.
 *
 * Read-only. No writes. No mutation.
 */

import type { K3ReadBackend, EpisodicEvent } from "../retrieval/types.js";
import { queryEpisodicEvents } from "../retrieval/episodic-read.js";
import type {
  EpisodicMemoryItem,
  EpisodicLaneConfig,
  MemoryContextRequest,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants — §10
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITEMS = 20;
const CEILING_MAX_ITEMS = 100;

// ---------------------------------------------------------------------------
// Lane result type
// ---------------------------------------------------------------------------

export type EpisodicLaneResult =
  | { readonly ok: true; readonly items: EpisodicMemoryItem[]; readonly available: number }
  | { readonly ok: false };

// ---------------------------------------------------------------------------
// runEpisodicLane
// ---------------------------------------------------------------------------

export function runEpisodicLane(
  k3: K3ReadBackend,
  request: MemoryContextRequest,
): EpisodicLaneResult {
  const config: EpisodicLaneConfig = request.lanes.episodic!;

  // Clamp max_items silently to ceiling
  const maxItems = Math.min(config.max_items ?? DEFAULT_MAX_ITEMS, CEILING_MAX_ITEMS);

  // Over-fetch: min(max_items * 2, 200) — §6.1
  const fetchLimit = Math.min(maxItems * 2, 200);

  const crossRun = config.include_current_run_only === false;

  try {
    if (crossRun) {
      // K3 OPEN_ENDED_SCAN guard requires at least run_id per call.
      // Call K3 once per run_id in run_id_list, merge all results, sort DESC.
      return runCrossRun(k3, request, config, maxItems);
    }

    // Single-run: call K3 with current run_id
    const result = queryEpisodicEvents(k3, {
      project_id: request.project_id,
      run_id: request.run_id,
      event_type: config.event_types as string[] | undefined,
      limit: fetchLimit,
    });

    if (!result.ok) {
      return { ok: false };
    }

    // K3 returns created_at ASC. Reverse to DESC (most recent first) — §6.2
    const descItems = [...result.page.items].reverse();
    return packItems(descItems, maxItems);
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Cross-run: one K3 call per run_id, merge and sort DESC
// ---------------------------------------------------------------------------

function runCrossRun(
  k3: K3ReadBackend,
  request: MemoryContextRequest,
  config: EpisodicLaneConfig,
  maxItems: number,
): EpisodicLaneResult {
  const runIds = config.run_id_list ?? [];
  if (runIds.length === 0) {
    return { ok: false };
  }

  const perRunFetchLimit = Math.min(maxItems * 2, 200);
  const merged: EpisodicEvent[] = [];

  for (const runId of runIds) {
    const result = queryEpisodicEvents(k3, {
      project_id: request.project_id,
      run_id: runId,
      event_type: config.event_types as string[] | undefined,
      limit: perRunFetchLimit,
    });

    if (!result.ok) {
      return { ok: false };
    }

    merged.push(...result.page.items);
  }

  // Sort merged results DESC (most recent first) — §6.2
  merged.sort((a, b) => {
    const tA = new Date(a.created_at).getTime();
    const tB = new Date(b.created_at).getTime();
    if (tB !== tA) return tB - tA;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });

  return packItems(merged, maxItems);
}

// ---------------------------------------------------------------------------
// Pack: project to EpisodicMemoryItem and apply max_items truncation
// Expects items already in DESC order (most recent first).
// ---------------------------------------------------------------------------

function packItems(
  descItems: readonly EpisodicEvent[],
  maxItems: number,
): EpisodicLaneResult {
  const available = descItems.length;
  const truncated = descItems.slice(0, maxItems);

  const memoryItems: EpisodicMemoryItem[] = truncated.map((e) => ({
    id: e.id,
    run_id: e.run_id,
    event_type: e.event_type,
    actor_role: e.actor_role,
    payload: e.payload,
    created_at: e.created_at,
    schema_version: e.schema_version,
  }));

  return { ok: true, items: memoryItems, available };
}
