# K8-C — Knowledge Layer Contract Extraction Report

**Slice:** K8-C — Knowledge Layer Contract Extraction + Confirmation
**Version:** v3
**Produced by:** Forge
**Date:** 2026-03-12
**Status:** AWAITING GOVERNANCE REVIEW

---

## 1. Source Files Read

| # | File Path | Role |
|---|---|---|
| 1 | `agent-os/src/memory/memory-context/types.ts` | K7 type definitions — authoritative exported shapes |
| 2 | `agent-os/src/memory/memory-context/assemble.ts` | Top-level assembleMemoryContext — MemoryContext packing |
| 3 | `agent-os/src/memory/memory-context/lane-episodic.ts` | Episodic lane — projection to EpisodicMemoryItem |
| 4 | `agent-os/src/memory/memory-context/lane-decision.ts` | Decision lane — projection to DecisionMemoryItem |
| 5 | `agent-os/src/memory/memory-context/lane-semantic.ts` | Semantic lane — projection to SemanticMemoryItem (hybrid + structured) |
| 6 | `agent-os/src/memory/retrieval/types.ts` | K3 return shapes — upstream input to lane projections |
| 7 | `.claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md` | Accepted reference spec — provenance cross-reference |

---

## 2. Extraction Method Applied

Per K8-C §10, Forge:

1. Located K7 entry point: `assembleMemoryContext` in `assemble.ts`
2. Traced each lane's population path to its projection function
3. Recorded every field present in the projected objects (not DB column names)
4. Cross-referenced against Memory Engine Spec v1.1 §4
5. Recorded all discrepancies
6. Confirmed no stop condition was triggered (see §7)

---

## 3. Episodic Lane — `EpisodicMemoryItem`

**Projection source:** `lane-episodic.ts:142–150`
**K7 type definition:** `memory-context/types.ts:84–92`
**Upstream raw type:** `K3ReadBackend → EpisodicEvent` (`retrieval/types.ts:36–45`)

### 3.1 Provenance Table

| Field | TypeScript Type | K7 Source (file:line) | Spec v1.1 Reference | Status |
|---|---|---|---|---|
| `id` | `string` | `types.ts:86`, `lane-episodic.ts:143` | Spec §4.1 `EPISODIC_EVENT.id` (UUID PK) | **confirmed** |
| `run_id` | `string` | `types.ts:87`, `lane-episodic.ts:144` | Spec §4.1 `EPISODIC_EVENT.run_id` | **confirmed** |
| `event_type` | `string` | `types.ts:88`, `lane-episodic.ts:145` | `retrieval/types.ts:40` — not in Spec §4.1 | **K7 source only** |
| `actor_role` | `string` | `types.ts:89`, `lane-episodic.ts:146` | `retrieval/types.ts:41` — Spec §4.1 has `agent_role`; name differs | **discrepancy: renamed** |
| `payload` | `Record<string, unknown> \| null` | `types.ts:90`, `lane-episodic.ts:147` | `retrieval/types.ts:42` — not in Spec §4.1 | **K7 source only** |
| `created_at` | `string` (ISO 8601) | `types.ts:91`, `lane-episodic.ts:148` | Spec §4.1 `EPISODIC_EVENT.created_at` | **confirmed** |
| `schema_version` | `string` | `types.ts:92`, `lane-episodic.ts:149` | `retrieval/types.ts:44` — not in Spec §4.1 | **K7 source only** |

### 3.2 Spec §4.1 Fields Not Surfaced by K7

The following fields are defined in Spec §4.1 `EPISODIC_EVENT` but do **not** appear in `EpisodicMemoryItem`:

`slice_id`, `agent_role` (surfaced as `actor_role`), `invocation_seq`, `input_hash`, `output_hash`, `input_ref`, `output_ref`, `stop_triggered`, `stop_reason`, `outcome`

---

## 4. Decision Lane — `DecisionMemoryItem`

**Projection source:** `lane-decision.ts:86–95`
**K7 type definition:** `memory-context/types.ts:94–103`
**Upstream raw type:** `K3ReadBackend → DecisionEvent` (`retrieval/types.ts:51–61`)

### 4.1 Provenance Table

| Field | TypeScript Type | K7 Source (file:line) | Spec v1.1 Reference | Status |
|---|---|---|---|---|
| `id` | `string` | `types.ts:95`, `lane-decision.ts:87` | Spec §4.3 `DECISION_EVENT.id` (UUID PK) | **confirmed** |
| `run_id` | `string` | `types.ts:96`, `lane-decision.ts:88` | Spec §4.3 `DECISION_EVENT.run_id` | **confirmed** |
| `episodic_event_id` | `string` | `types.ts:97`, `lane-decision.ts:89` | `retrieval/types.ts:55` — not in Spec §4.3 | **K7 source only** |
| `decision_type` | `string` | `types.ts:98`, `lane-decision.ts:90` | `retrieval/types.ts:56` — Spec §4.3 has `decision_context_type`; semantics differ | **discrepancy: differs from Spec** |
| `actor_role` | `string` | `types.ts:99`, `lane-decision.ts:91` | `retrieval/types.ts:57` — not in Spec §4.3 | **K7 source only** |
| `decision_payload` | `Record<string, unknown> \| null` | `types.ts:100`, `lane-decision.ts:92` | `retrieval/types.ts:58` — not in Spec §4.3 | **K7 source only** |
| `created_at` | `string` (ISO 8601) | `types.ts:101`, `lane-decision.ts:93` | Spec §4.3 `DECISION_EVENT.created_at` | **confirmed** |
| `schema_version` | `string` | `types.ts:102`, `lane-decision.ts:94` | `retrieval/types.ts:60` — not in Spec §4.3 | **K7 source only** |

### 4.2 Spec §4.3 Fields Not Surfaced by K7

The following fields are defined in Spec §4.3 `DECISION_EVENT` but do **not** appear in `DecisionMemoryItem`:

`decision_context_type` (surfaced as `decision_type`), `authority_class`, `binding_scope`, `rationale`, `affected_slice_id`, `affected_artifact_id`

---

## 5. Semantic Lane — `SemanticMemoryItem`

**Projection sources:**
- Hybrid mode: `lane-semantic.ts:115–125` (from `HybridSearchResult`)
- Structured-only mode: `lane-semantic.ts:172–183` (from `SemanticFact`)

**K7 type definition:** `memory-context/types.ts:105–115`
**Upstream raw types:** `HybridSearchResult` (`hybrid-search/types.ts:81–91`), `SemanticFact` (`retrieval/types.ts:67–79`)

### 5.1 Provenance Table

| Field | TypeScript Type | K7 Source (file:line) | Spec v1.1 Reference | Status |
|---|---|---|---|---|
| `fact_id` | `string` | `types.ts:106`, `lane-semantic.ts:116,173` | Spec §4.2 `SEMANTIC_FACT.id` — K7 renames to `fact_id` | **discrepancy: renamed** |
| `fact_type` | `string` | `types.ts:107`, `lane-semantic.ts:117,174` | Spec §4.2 `SEMANTIC_FACT.fact_type` | **confirmed** |
| `fact_key` | `string` | `types.ts:108`, `lane-semantic.ts:118,175` | `retrieval/types.ts:71` — not in Spec §4.2 | **K7 source only** |
| `fact_value` | `string` | `types.ts:109`, `lane-semantic.ts:119,176` | `retrieval/types.ts:72` — Spec §4.2 has `content: TEXT`; K7 splits into `fact_key` + `fact_value` | **discrepancy: replaces Spec `content`** |
| `source_run_id` | `string` | `types.ts:110`, `lane-semantic.ts:120,177` | Spec §4.2 `SEMANTIC_FACT.source_run_id` | **confirmed** |
| `fact_created_at` | `string` (ISO 8601) | `types.ts:111`, `lane-semantic.ts:121,178` | Spec §4.2 `SEMANTIC_FACT.created_at` — K7 renames | **discrepancy: renamed** |
| `fact_schema_version` | `string` | `types.ts:112`, `lane-semantic.ts:122,179` | `retrieval/types.ts:76` — not in Spec §4.2 | **K7 source only** |
| `vector_score` | `number \| null` | `types.ts:113`, `lane-semantic.ts:123,180` | not in Spec §4.2 | **K7 source only** (`null` in structured_only mode) |
| `sources` | `readonly SourceType[]` | `types.ts:114`, `lane-semantic.ts:124,181` | not in Spec §4.2 | **K7 source only** (`SourceType = "STRUCTURED" \| "VECTOR"`) |

### 5.2 Spec §4.2 Fields Not Surfaced by K7

The following fields are defined in Spec §4.2 `SEMANTIC_FACT` but do **not** appear in `SemanticMemoryItem`:

`content` (split into `fact_key` + `fact_value`), `embedding` (never returned by K3 by design), `confidence`, `source_slice_id`, `valid_from`, `valid_until`, `superseded_by`, `written_by_role`

---

## 6. MemoryContext Container

**Assembly source:** `assemble.ts:134–155`
**K7 type definition:** `memory-context/types.ts:148–158`

### 6.1 Provenance Table

| Field | TypeScript Type | K7 Source (file:line) | Spec v1.1 Reference | Status |
|---|---|---|---|---|
| `project_id` | `string` | `types.ts:149`, `assemble.ts:135` | not in Spec §4 container shape (derived from request) | **K7 source only** |
| `run_id` | `string` | `types.ts:150`, `assemble.ts:136` | not in Spec §4 container shape (derived from request) | **K7 source only** |
| `assembled_at` | `string` (ISO 8601) | `types.ts:151`, `assemble.ts:137` | not in Spec §4 container shape | **K7 source only** |
| `episodic` | `readonly EpisodicMemoryItem[]` | `types.ts:153`, `assemble.ts:138` | Spec §3.1 Episodic Memory | **confirmed** |
| `decisions` | `readonly DecisionMemoryItem[]` | `types.ts:154`, `assemble.ts:139` | Spec §3.3 Decision Memory | **confirmed** |
| `semantic` | `readonly SemanticMemoryItem[]` | `types.ts:155`, `assemble.ts:140` | Spec §3.2 Semantic Memory | **confirmed** |
| `semantic_mode` | `"hybrid" \| "structured_only" \| "disabled"` | `types.ts:156`, `assemble.ts:141` | not in Spec §4 | **K7 source only** |
| `item_counts` | `LaneItemCounts` | `types.ts:157`, `assemble.ts:142–149` | not in Spec §4 | **K7 source only** |
| `lane_states` | `LaneStates` | `types.ts:158`, `assemble.ts:150–154` | not in Spec §4 | **K7 source only** |

---

## 7. Stop Condition Assessment

| Stop Condition | Triggered? | Evidence |
|---|---|---|
| K7 does not produce an identifiable MemoryContext object | **No** | `assembleMemoryContext` at `assemble.ts:43` returns typed `MemoryContext` |
| K7 lane arrays are not identifiable as episodic/decisions/semantic | **No** | Three distinct typed arrays confirmed |
| K7 output shapes are entirely untyped | **No** | All shapes explicitly typed in `memory-context/types.ts` |
| More than 30% of extracted fields are unprovenanced | **No** | 0% unprovenanced — all 24 extracted fields trace to K7 implementation source (accepted producer surface) |

**No stop condition triggered. Execution proceeded to D2.**

---

## 8. Discrepancy Summary

### 8.1 K7 Fields That Differ From or Are Absent in Spec v1.1

| Lane | K7 Field | Discrepancy |
|---|---|---|
| Episodic | `event_type` | Not in Spec §4.1 — K7 source only |
| Episodic | `actor_role` | Spec §4.1 uses `agent_role` — renamed in K7 |
| Episodic | `payload` | Not in Spec §4.1 — K7 source only |
| Episodic | `schema_version` | Not in Spec §4.1 — K7 source only |
| Decision | `episodic_event_id` | Not in Spec §4.3 — K7 source only |
| Decision | `decision_type` | Spec §4.3 uses `decision_context_type` with typed enum — K7 uses `string` |
| Decision | `actor_role` | Not in Spec §4.3 — K7 source only |
| Decision | `decision_payload` | Not in Spec §4.3 — K7 source only |
| Decision | `schema_version` | Not in Spec §4.3 — K7 source only |
| Semantic | `fact_id` | Spec §4.2 uses `id` — renamed in K7 |
| Semantic | `fact_key` | Not in Spec §4.2 — K7 source only |
| Semantic | `fact_value` | Spec §4.2 uses `content: TEXT` — K7 splits into `fact_key` + `fact_value` |
| Semantic | `fact_created_at` | Spec §4.2 uses `created_at` — renamed in K7 |
| Semantic | `fact_schema_version` | Not in Spec §4.2 — K7 source only |
| Semantic | `vector_score` | Not in Spec §4.2 — K7 source only |
| Semantic | `sources` | Not in Spec §4.2 — K7 source only |

### 8.2 Spec v1.1 Fields Not Surfaced by K7

| Lane | Spec §4 Field | Status in K7 |
|---|---|---|
| Episodic (§4.1) | `slice_id` | Not projected into EpisodicMemoryItem |
| Episodic (§4.1) | `agent_role` | Surfaced as `actor_role` (renamed) |
| Episodic (§4.1) | `invocation_seq` | Not projected |
| Episodic (§4.1) | `input_hash` | Not projected |
| Episodic (§4.1) | `output_hash` | Not projected |
| Episodic (§4.1) | `input_ref` | Not projected |
| Episodic (§4.1) | `output_ref` | Not projected |
| Episodic (§4.1) | `stop_triggered` | Not projected |
| Episodic (§4.1) | `stop_reason` | Not projected |
| Episodic (§4.1) | `outcome` | Not projected |
| Decision (§4.3) | `decision_context_type` | Surfaced as `decision_type` (renamed, different type) |
| Decision (§4.3) | `authority_class` | Not projected |
| Decision (§4.3) | `binding_scope` | Not projected |
| Decision (§4.3) | `rationale` | Not projected |
| Decision (§4.3) | `affected_slice_id` | Not projected |
| Decision (§4.3) | `affected_artifact_id` | Not projected |
| Semantic (§4.2) | `content` | Split into `fact_key` + `fact_value` |
| Semantic (§4.2) | `embedding` | Never returned by K3 (by design) |
| Semantic (§4.2) | `confidence` | Not projected |
| Semantic (§4.2) | `source_slice_id` | Not projected |
| Semantic (§4.2) | `valid_from` | Not projected |
| Semantic (§4.2) | `valid_until` | Not projected |
| Semantic (§4.2) | `superseded_by` | Not projected |
| Semantic (§4.2) | `written_by_role` | Not projected |

### 8.3 Unprovenanced Fields

**None.** All 24 extracted fields trace to at least the K7 retrieval implementation source, which is an accepted producer surface per K8-C §3.

---

## 9. Impact on K9

The discrepancies documented in §8 are the direct cause of the K9 escalation raised prior to this slice. Specifically:

- K9 v1.1 assumed `MemoryContext` fields `assemblyId`, `subjectId`, and `entries[]` — none of which exist in the actual K7 contract
- K9 v1.1 assumed per-entry fields `entryId`, `source`, `ruleKey`, `outcome`, `recordedAt`, `weight` — none of which exist in any K7 lane item type
- The confirmed K7 contract (D2) provides the authoritative surface against which Atlas must revise K9

---

## 10. Acceptance Criteria Checklist

| AC | Criterion | Met? |
|---|---|---|
| AC1 | Extraction Report exists as a markdown file in Agent OS docs directory | Yes — this file |
| AC2 | Report lists every K7 source file read with file path | Yes — §1 |
| AC3 | Provenance table for each lane with field name, TypeScript type, source, and status | Yes — §3.1, §4.1, §5.1, §6.1 |
| AC4 | All discrepancies listed — Spec v1.1 fields not surfaced, and K7 fields not in Spec v1.1 | Yes — §8.1, §8.2 |
| AC5 | Unprovenanced fields explicitly flagged for Command disposition | Yes — §8.3 (none found) |
| AC6 | Single new TypeScript file exists in Agent OS Knowledge Layer types directory | Yes — D2 |
| AC7 | File exports lane item types for each of the three lanes | Yes — D2 |
| AC8 | File exports MemoryContext container type | Yes — D2 |
| AC9 | Every field has an inline provenance comment | Yes — D2 |
| AC10 | No field present that K7 retrieval does not currently output | Yes — D2 mirrors extraction exactly |
| AC11 | No field absent that K7 retrieval currently outputs | Yes — D2 mirrors extraction exactly |
| AC12 | `tsc --noEmit` passes | Verified — see §11 |
| AC13 | Existing K7 files modified only with import statements and type annotations | n/a — no existing files modified |
| AC14 | No runtime behavior change | Yes — D1 and D2 are new files only |
| AC15 | No test failures introduced | Yes — no logic changed |
| AC16 | If stop condition triggered, partial report produced | n/a — no stop condition triggered |

---

## 11. `tsc --noEmit` Result

See deliverable report. Compile-time verification run after D2 was created.
