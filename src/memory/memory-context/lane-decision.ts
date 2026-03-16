/**
 * Agent OS — K7 Memory Context Assembly
 * Decision lane retrieval and truncation.
 *
 * Source: memory-context-assembly-k7-v1.1.md §6.1, §6.2
 * Slice: K7 — Memory Context Assembly
 *
 * Calls K3 queryDecisionEvents, reverses to DESC order, truncates to
 * max_items. Returns items with pre-truncation available count.
 *
 * Read-only. No writes. No mutation.
 */

import type { K3ReadBackend } from "../retrieval/types.js";
import { queryDecisionEvents } from "../retrieval/decision-read.js";
import type {
  DecisionMemoryItem,
  DecisionLaneConfig,
  MemoryContextRequest,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants — §10
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITEMS = 10;
const CEILING_MAX_ITEMS = 50;

// ---------------------------------------------------------------------------
// Lane result type
// ---------------------------------------------------------------------------

export type DecisionLaneResult =
  | { readonly ok: true; readonly items: DecisionMemoryItem[]; readonly available: number }
  | { readonly ok: false };

// ---------------------------------------------------------------------------
// runDecisionLane
// ---------------------------------------------------------------------------

export function runDecisionLane(
  k3: K3ReadBackend,
  request: MemoryContextRequest,
): DecisionLaneResult {
  const config: DecisionLaneConfig = request.lanes.decision!;

  // Clamp max_items silently to ceiling
  const maxItems = Math.min(config.max_items ?? DEFAULT_MAX_ITEMS, CEILING_MAX_ITEMS);

  // Over-fetch: min(max_items * 2, 100) — §6.1
  const fetchLimit = Math.min(maxItems * 2, 100);

  // Determine run_id scope
  const crossRun = config.include_current_run_only === false;
  const runId = crossRun ? undefined : request.run_id;

  try {
    const result = queryDecisionEvents(k3, {
      project_id: request.project_id,
      run_id: runId,
      decision_type: config.decision_types as string[] | undefined,
      limit: fetchLimit,
    });

    if (!result.ok) {
      return { ok: false };
    }

    let items = [...result.page.items];

    // Post-filter for cross-run scoping (K3 has no run_id_list param)
    if (crossRun && config.run_id_list && config.run_id_list.length > 0) {
      const allowed = new Set(config.run_id_list);
      items = items.filter((d) => allowed.has(d.run_id));
    }

    // K3 returns created_at ASC. Reverse to get DESC (most recent first) — §6.2
    items.reverse();

    const available = items.length;

    // Truncate to max_items
    const truncated = items.slice(0, maxItems);

    // Project to DecisionMemoryItem
    const memoryItems: DecisionMemoryItem[] = truncated.map((d) => ({
      id: d.id,
      run_id: d.run_id,
      episodic_event_id: d.episodic_event_id,
      decision_type: d.decision_type,
      actor_role: d.actor_role,
      decision_payload: d.decision_payload,
      created_at: d.created_at,
      schema_version: d.schema_version,
    }));

    return { ok: true, items: memoryItems, available };
  } catch {
    return { ok: false };
  }
}
