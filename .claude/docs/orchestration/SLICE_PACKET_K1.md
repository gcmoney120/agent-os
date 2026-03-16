# Slice K1 — Memory Engine Foundation

Status: APPROVED FOR IMPLEMENTATION
Source of Authority: Memory_Engine_Architecture_Spec_v1.1.md
Owner: Command
Implementor: Forge
Date: 2026-03-11

---

## 1. Objective

Implement the foundational schema, write interfaces, and retrieval skeleton for the Agent OS Memory Engine as defined in Memory_Engine_Architecture_Spec_v1.1.md. This slice establishes the append-only, project-namespaced, lifecycle-governed substrate that all subsequent K-series slices build upon.

---

## 2. In Scope

### Models
- `EpisodicEvent` — immutable agent invocation record; Foreman-only writer; `run_id` required
- `SemanticFact` — lifecycle-gated knowledge record; retrievable only when latest lifecycle event = APPROVED
- `SemanticFactEvent` — append-only lifecycle state transitions for `SemanticFact` (states: PROPOSED, APPROVED, SUPERSEDED, RETRACTED)
- `DecisionEvent` — immutable governance decision audit record; `run_id` optional (nullable)
- `ToolInvocation` — immutable tool call record; Foreman-only writer; `run_id` required
- `EmbeddingRecord` — structural placeholder linked to `SemanticFact`; populated by K4
- `EmbeddingStatusEvent` — structural placeholder for embedding lifecycle events; populated by K4

### Core Constraints (non-negotiable)
- All records append-only: no UPDATE or DELETE paths on any primary record
- `project_id` namespace required on every record
- `schema_version` required on every write
- Retrieval deny-by-default: no record returned unless role is explicitly permitted
- `SemanticFact` retrievable only when latest `SemanticFactEvent` lifecycle state = `APPROVED`
- `EpisodicEvent` and `ToolInvocation` writeable by Foreman role only

### Deliverables
- Schema definitions for all seven models
- Migration
- Memory store write interfaces (TypeScript) with Foreman-only guard on `EpisodicEvent` and `ToolInvocation`
- Retrieval engine skeleton with deny-by-default enforcement and APPROVED gate on `SemanticFact`
- Lifecycle event enforcement for `SemanticFact` via `SemanticFactEvent`
- Basic test coverage for all acceptance criteria below

---

## 3. Out of Scope

- Embedding generation pipeline (K4) — `EmbeddingRecord` / `EmbeddingStatusEvent` are structural stubs only; no vector computation, no pgvector index, no embedding model calls
- Learning feedback loop (K5)
- Autonomous knowledge extraction (K3)
- Retrieval authorization layer beyond deny-by-default skeleton (K2)
- Context window budget enforcement (K2)
- Retrieval result trust classification (K2)
- `TOOL_PERFORMANCE_SUMMARY` materialised aggregate
- UI or observability tooling
- PII escalation path testing
- Cross-project memory sharing
- PestFree NZ domain logic of any kind

---

## 4. Trust Engine Impact

- [x] **Major — explicit approval required**

Explanation:
This slice introduces new append-only audit record models (`EpisodicEvent`, `ToolInvocation`, `DecisionEvent`) with write-restricted roles, a lifecycle-gated access control boundary (`SemanticFact` APPROVED filter via `SemanticFactEvent`), and a `project_id`-scoped access namespace. The retrieval layer is deny-by-default — incorrect implementation creates either data leakage or total retrieval failure. Foreman-only write enforcement for `EpisodicEvent` and `ToolInvocation` must be verified at the interface layer, not schema alone.

Trust Change Protocol was triggered and completed prior to this packet. Command GO is recorded in this packet as the approval artifact.

Command GO: GRANTED — proceed.

---

## 5. Data Model Changes

Seven new models added under `agent-os/`. No changes to any PestFree NZ Prisma models or application code.

| Model | Type | Notes |
|---|---|---|
| `EpisodicEvent` | Append-only | `run_id` NOT NULL; Foreman writer only |
| `SemanticFact` | Versioned rows | APPROVED gate on retrieval via lifecycle events |
| `SemanticFactEvent` | Append-only | Lifecycle state machine for SemanticFact |
| `DecisionEvent` | Append-only | `run_id` nullable; governance audit trail |
| `ToolInvocation` | Append-only | `run_id` NOT NULL; Foreman writer only |
| `EmbeddingRecord` | Structural stub | Linked to SemanticFact; content populated by K4 |
| `EmbeddingStatusEvent` | Structural stub | Embedding lifecycle; populated by K4 |

All models carry: `project_id` (NOT NULL), `schema_version` (NOT NULL), `created_at`.
No model carries an UPDATE or DELETE path.

---

## 6. State Machine Changes

### SemanticFact lifecycle (via SemanticFactEvent)

Permitted event states — from spec only, no additions:

```
PROPOSED → APPROVED
APPROVED → SUPERSEDED
APPROVED → RETRACTED  (requires decision_event_id FK reference)
```

Retrieval gate: `SemanticFact` is returned only when the latest `SemanticFactEvent` for that fact has `state = APPROVED`. All other states (PROPOSED, SUPERSEDED, RETRACTED) yield zero retrieval results.

### EmbeddingRecord lifecycle (via EmbeddingStatusEvent)

Structural stub only. Lifecycle state machine deferred to K4.
`EmbeddingStatusEvent` schema must accept a `state` field but state enum expansion is a K4 deliverable.

---

## 7. Acceptance Criteria (Must Be Testable)

Scoped strictly to K1 deliverables. Spec criteria outside K1 scope are deferred.

| # | Criterion |
|---|---|
| AC-K1-01 | `EpisodicEvent` write succeeds with valid `run_id`, `project_id`, `schema_version`; write without `run_id` is rejected at the interface layer |
| AC-K1-02 | `DecisionEvent` write succeeds with `run_id` omitted (nullable); write without `project_id` or `schema_version` is rejected |
| AC-K1-03 | `SemanticFact` with no `SemanticFactEvent` of state `APPROVED` is not returned by the retrieval skeleton |
| AC-K1-04 | `SemanticFact` whose latest `SemanticFactEvent` has state `APPROVED` is returned by the retrieval skeleton |
| AC-K1-05 | `SemanticFact` whose latest `SemanticFactEvent` has state `SUPERSEDED` is not returned by the retrieval skeleton |
| AC-K1-06 | `EpisodicEvent` write interface rejects callers not presenting the Foreman writer identity |
| AC-K1-07 | `ToolInvocation` write interface rejects callers not presenting the Foreman writer identity |
| AC-K1-08 | Retrieval skeleton returns an empty result set for any query where the requesting role has no explicit permission (deny-by-default) |
| AC-K1-09 | All seven models require `project_id` and `schema_version`; writes omitting either field are rejected at the interface layer |
| AC-K1-10 | No model exposes an UPDATE or DELETE path anywhere in the write interface |

---

## 8. Guardrails (Non-Negotiable)

- No scope expansion beyond the ten acceptance criteria above.
- No architecture drift from Memory_Engine_Architecture_Spec_v1.1.md.
- No PestFree NZ domain assumptions in any Agent OS core file.
- No changes to existing PestFree NZ Prisma schema, API routes, or application code.
- All Agent OS schemas live under `agent-os/` only.
- No embedding generation, vector indexing, or pgvector calls in this slice.
- No retrieval result trust classification (deferred to K2).
- No UPDATE or DELETE on any primary record — violation is a hard blocker.
- `DECISION_EVENT.run_id` is nullable — do not enforce NOT NULL on this field.
- `SemanticFactEvent` states are exactly: PROPOSED, APPROVED, SUPERSEDED, RETRACTED — no additions.
- Sentinel PASS required before merge.
- Compass PASS required before merge.
- SYSTEM_STATE.md must be updated on acceptance.
