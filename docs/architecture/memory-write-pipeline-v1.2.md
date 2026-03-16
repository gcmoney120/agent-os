# Memory Write Pipeline Architecture Specification v1.2
Agent OS — Knowledge Layer
Status: Approved
Authority: Atlas (architecture), Command (approval)
---
## 1. Purpose
The Memory Write Pipeline converts Foreman execution artifacts into persistent memory records within the Memory Engine.
The pipeline ensures:
- deterministic ingestion of Foreman events
- append-only memory storage
- auditable run-level event history
- promotion of explicit governance decisions into semantic knowledge
- initialization of embedding records for semantic facts
The pipeline must operate without mutating existing memory records.
---
## 2. Governing Invariants
The Memory Engine obeys the following invariants:
- append-only database model
- no UPDATE operations
- no DELETE operations
- project_id namespace isolation
- schema_version required on all records
- enum values stored as TEXT
- application-layer enum validation
- no PostgreSQL enum types
- no enum CHECK constraints
All writes must originate from Foreman execution artifacts.
---
## 3. Pipeline Input
The pipeline consumes Foreman artifacts:
- request.json
- events.log
- step-report.json
Each run produces deterministic events recorded in `events.log`.
These events form the canonical episodic history of the run.
---
## 4. Episodic Event Ingestion
Each relevant Foreman lifecycle event is persisted as a row in:
`episodic_event`
Supported event types:
- RUN_STARTED
- STEP_STARTED
- STEP_SUCCEEDED
- STEP_FAILED
- TRUST_CHANGE_DECLARED
- GOVERNANCE_DECISION
- GOVERNANCE_HALT
- CAPABILITY_USED
- RUN_SUCCEEDED
- RUN_FAILED
Each event must include:
- project_id
- run_id
- event_type
- actor_role
- payload
- occurred_at
- schema_version
---
## 5. Decision Event Recording
Formal governance decisions are written to:
`decision_event`
Fields:
- project_id
- run_id
- episodic_event_id
- decision_type
- actor_role
- decision_payload
- occurred_at
- schema_version
Constraint:
`UNIQUE (run_id, decision_type, episodic_event_id)`
Only governance decisions produce `decision_event` records.
---
## 6. Semantic Fact Promotion
Semantic knowledge is created only from governance decisions.
Promotion requires:
`decision_payload.promote_to_semantic = true`
Authority rule:
Only Command decisions may be promoted.
Promotion writes to:
`semantic_fact`
`semantic_fact_event`
### semantic_fact
Fields:
- project_id
- fact_type
- fact_key
- fact_value
- source_run_id
- created_at
- schema_version
Constraint:
`UNIQUE (project_id, fact_type, fact_key)`
### semantic_fact_event
Links the semantic fact to the episodic event that produced it.
Fields:
- semantic_fact_id
- episodic_event_id
- observed_at
Constraint:
`UNIQUE (semantic_fact_id, episodic_event_id)`
---
## 7. Embedding Initialization
Each semantic fact creates an embedding record.
Table:
`embedding_record`
Fields:
- semantic_fact_id
- embedding VECTOR(1536) NULL
- model_id TEXT NULL
- status TEXT DEFAULT 'PENDING'
- created_at
Constraint:
`UNIQUE (semantic_fact_id)`
Embedding status transitions are recorded in:
`embedding_status_event`
Fields:
- embedding_record_id
- previous_status
- new_status
- transition_reason
- transitioned_at
Constraint:
`UNIQUE (embedding_record_id, new_status, transitioned_at)`
---
## 8. Idempotent Run Ingestion
The pipeline must support safe re-processing of a run.
Protection mechanisms:
- unique constraints
- deterministic run identifiers
- episodic event deduplication
Duplicate writes must fail safely without corrupting memory state.
---
## 9. Tool Invocation Architecture
The memory schema includes:
`tool_invocation`
However, tool invocation recording is not active in K2.
This table remains dormant until:
- tool dispatch architecture exists
- tool execution artifacts exist
No tool records are written in K2.
---
## 10. Run Terminal Events
The final pipeline write for a run must be one of:
- RUN_SUCCEEDED
- RUN_FAILED
These events mark the terminal episodic state for the run.
No additional writes may occur after a terminal run event.
---
## 11. Scope of Slice K2
K2 implements the deterministic memory write pipeline.
Included:
- episodic event ingestion
- decision event recording
- semantic fact promotion
- embedding initialization
- embedding status transitions
- run lifecycle memory events
Excluded:
- embedding generation workers
- memory retrieval APIs
- semantic learning feedback loops
- tool invocation recording
