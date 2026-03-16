# Memory Engine Architecture Specification v1.1
Agent OS — PestFree NZ
Atlas | 2026-03-11 | STATUS: AWAITING COMMAND APPROVAL

---

## 1. Scope

Design the persistent memory substrate for the multi-agent system. Memory must support agent continuity across sessions, governed retrieval, and a feedback loop that improves execution quality — without permitting any memory artifact to override, weaken, or circumvent AGENTS.md governance rules or Trust Engine invariants.

---

## 2. Governing Constraints

| Constraint | Source |
|---|---|
| Memory cannot override governance rules | AGENTS.md §Repo Collaboration Rules |
| Audit logs append-only, no UPDATE/DELETE | SYSTEM_STATE.md §Locked Decisions |
| Trust Engine modifications require Sentinel + Command | AGENTS.md §Forge Forbidden |
| All agent actions must be logged with run_id | SYSTEM_STATE.md §Orchestration Model |
| PII must be handled with access control | AGENTS.md §Sentinel Mission |

**Hard invariant:** A memory artifact that contradicts a governance rule is silently invalid. The retrieval layer must never surface a memory artifact as authoritative over a current AGENTS.md or Slice Contract binding.

---

## 3. Memory Type Taxonomy

### 3.1 Episodic Memory

Factual record of what happened in a specific agent run.

Captures: run_id, agent_role, slice_id, inputs, outputs, stop conditions triggered, timestamps, outcome (COMPLETE / STOPPED / FAILED).

Retention: Permanent. Append-only. No correction — errors are recorded as subsequent events.

Scope: One record per agent invocation within a Foreman run.

### 3.2 Semantic Memory

Distilled knowledge extracted from episodic records — patterns, resolved ambiguities, architectural decisions.

Captures: fact_type (ARCHITECTURE_DECISION, RESOLVED_AMBIGUITY, KNOWN_CONSTRAINT, DOMAIN_FACT), provenance (source run_id + slice_id), confidence score (0.0–1.0), valid_from / valid_until.

Retention: Permanent. Versioned. Superseded facts are retired via lifecycle event — not deleted. Each fact has an explicit superseded_by FK when replaced.

Lifecycle: Governed exclusively by SemanticFactEvent. The SemanticFact row carries no mutable status field. A fact is retrievable only when its latest SemanticFactEvent has state = APPROVED.

Scope: Shared read access across all agents. Write access: Command and Atlas only.

### 3.3 Decision Memory

Record of governance decisions: Command approvals, Sentinel PASS/FAIL, Compass PASS/FAIL, escalation resolutions.

Captures: decision_context_type, authority_class, binding_scope, rationale, affected_slice_id, affected_artifact_id, run_id (nullable), timestamp.

Retention: Permanent. Append-only. Constitutes the governance audit trail for the agent system itself.

Scope: Read: all agents. Write: Command, Sentinel, Compass only (role-enforced at DB layer).

### 3.4 Tool Performance Memory

Empirical record of tool invocation outcomes — latency, success rate, error classes — used to inform retrieval routing and fallback logic.

Captures: tool_name, run_id, invocation_timestamp, duration_ms, outcome (SUCCESS / TIMEOUT / ERROR), error_class (nullable), token_cost (nullable).

Retention: **Permanent. Append-only. No purge.** Raw TOOL_INVOCATION records are retained indefinitely. Materialised aggregation (TOOL_PERFORMANCE_SUMMARY) is deferred to a future phase and is not a current active schema dependency.

Scope: Read: Foreman, Atlas. Write: Foreman runtime only (automated, not LLM-authored).

---

## 4. Memory Artifact Schemas

### 4.1 EPISODIC_EVENT

```
EPISODIC_EVENT
─────────────────────────────────────
id               UUID PK
run_id           UUID NOT NULL          ← Foreman-generated; required
slice_id         VARCHAR                ← active Slice Contract id
agent_role       ENUM(command, atlas, forge, sentinel, compass)
invocation_seq   INT                    ← position within run
input_hash       VARCHAR                ← SHA-256 of serialised input
output_hash      VARCHAR                ← SHA-256 of serialised output
input_ref        VARCHAR                ← storage key (S3 / filesystem)
output_ref       VARCHAR                ← storage key
stop_triggered   BOOLEAN NOT NULL DEFAULT false
stop_reason      TEXT
outcome          ENUM(COMPLETE, STOPPED, FAILED)
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
```

No UPDATE. No DELETE. INSERT only.

Written by Foreman runtime process only. Foreman is not an LLM agent role — it is the execution orchestrator that wraps every agent invocation. The `agent_role` field records which LLM agent was invoked; the writer of this record is always Foreman.

### 4.2 SEMANTIC_FACT

```
SEMANTIC_FACT
─────────────────────────────────────
id               UUID PK
fact_type        ENUM(ARCHITECTURE_DECISION, RESOLVED_AMBIGUITY, KNOWN_CONSTRAINT, DOMAIN_FACT)
content          TEXT NOT NULL
embedding        VECTOR(1536)           ← pgvector; populated by K4 embedding pipeline
confidence       NUMERIC(3,2)           ← 0.00–1.00
source_run_id    UUID                   ← provenance
source_slice_id  VARCHAR
valid_from       TIMESTAMPTZ NOT NULL
valid_until      TIMESTAMPTZ            ← NULL = no expiry set
superseded_by    UUID FK → SEMANTIC_FACT(id) nullable
written_by_role  ENUM(command, atlas)
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
```

No UPDATE. No DELETE. INSERT only.

**SemanticFact carries no mutable status field.** Lifecycle is governed exclusively by SemanticFactEvent (§4.2a). A fact is retrievable only when its latest SemanticFactEvent has state = APPROVED.

Retraction requires a SemanticFactEvent with state = RETRACTED and a mandatory decision_event_id FK referencing the approving DecisionEvent. KNOWN_CONSTRAINT facts additionally require Sentinel co-approval before a RETRACTED or APPROVED event may be written (see §7.3).

### 4.2a SEMANTIC_FACT_EVENT

```
SEMANTIC_FACT_EVENT
─────────────────────────────────────
id                UUID PK
semantic_fact_id  UUID NOT NULL FK → SEMANTIC_FACT(id)
state             ENUM(PROPOSED, APPROVED, SUPERSEDED, RETRACTED)
decision_event_id UUID FK → DECISION_EVENT(id) nullable
                               ← required when state = RETRACTED
created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
```

No UPDATE. No DELETE. INSERT only.

Permitted lifecycle transitions:

```
PROPOSED  → APPROVED
APPROVED  → SUPERSEDED
APPROVED  → RETRACTED   (decision_event_id required)
```

The retrieval gate evaluates the latest SemanticFactEvent for each fact. Only APPROVED facts are returned. PROPOSED, SUPERSEDED, and RETRACTED facts are never returned by the retrieval layer.

### 4.3 DECISION_EVENT

```
DECISION_EVENT
─────────────────────────────────────
id                     UUID PK
decision_context_type  ENUM(RUN, SLICE, ARCHITECTURE, GOVERNANCE, MEMORY)
authority_class        ENUM(BINDING, REVIEW, ESCALATION, RECORD)
binding_scope          ENUM(RUN, SLICE, ARCHITECTURE, TRUST_ENGINE, MEMORY, PROJECT)
rationale              TEXT
affected_slice_id      VARCHAR nullable
affected_artifact_id   UUID nullable
run_id                 UUID nullable    ← optional; not required on scope-independent decisions
created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
```

Append-only. No UPDATE. No DELETE.

**Field semantics:**

- `decision_context_type` — the domain in which the decision was made: RUN (within a single run), SLICE (governs a slice contract), ARCHITECTURE (architectural ruling), GOVERNANCE (process or role governance), MEMORY (memory lifecycle action such as retraction or approval)
- `authority_class` — the nature of the authority exercised: BINDING (must be honoured by all agents), REVIEW (outcome of a formal review gate), ESCALATION (escalation raised or resolved), RECORD (informational record with no mandatory enforcement)
- `binding_scope` — what the decision binds: RUN (this run only), SLICE (named slice), ARCHITECTURE (system architecture), TRUST_ENGINE (Trust Engine invariants), MEMORY (memory artifact), PROJECT (whole project scope)
- `run_id` — nullable. Not required on decisions that are scope-independent (e.g. ARCHITECTURE, GOVERNANCE decisions made outside of a run context).

Write access: Command, Sentinel, Compass only (role-enforced at DB layer).

### 4.4 TOOL_INVOCATION

```
TOOL_INVOCATION
─────────────────────────────────────
id           UUID PK
run_id       UUID NOT NULL
tool_name    VARCHAR NOT NULL
invoked_at   TIMESTAMPTZ NOT NULL
duration_ms  INT
outcome      ENUM(SUCCESS, TIMEOUT, ERROR)
error_class  VARCHAR nullable
token_cost   INT nullable
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```

No UPDATE. No DELETE. INSERT only. **Records retained permanently — no purge.**

Written by Foreman runtime process only. Read by Foreman + Atlas for routing decisions.

### 4.5 EMBEDDING_RECORD

```
EMBEDDING_RECORD
─────────────────────────────────────
id                       UUID PK
semantic_fact_id         UUID NOT NULL FK → SEMANTIC_FACT(id)
embedding_model          VARCHAR NOT NULL   ← model identifier; e.g. text-embedding-3-small
embedding_version        VARCHAR NOT NULL   ← version pin; required for re-index governance
embedding_generated_at   TIMESTAMPTZ NOT NULL
created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
```

No UPDATE. No DELETE. INSERT only.

K1 implements this as a structural stub — the schema is defined to enforce version governance from first write, but embedding generation is deferred to K4. `embedding_model`, `embedding_version`, and `embedding_generated_at` are mandatory fields; the K4 pipeline is responsible for populating them. Embeddings are recomputed via a new row when content changes (supersession) — never mutated in place.

### 4.6 EMBEDDING_STATUS_EVENT

```
EMBEDDING_STATUS_EVENT
─────────────────────────────────────
id                   UUID PK
embedding_record_id  UUID NOT NULL FK → EMBEDDING_RECORD(id)
state                VARCHAR NOT NULL   ← K4 will replace with typed enum
created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
```

No UPDATE. No DELETE. INSERT only. Structural stub — state enum expansion is a K4 deliverable.

### Note: TOOL_PERFORMANCE_SUMMARY

TOOL_PERFORMANCE_SUMMARY is planned as a future materialised aggregate over TOOL_INVOCATION records. It is **not an active schema dependency for the current phase**. Foreman performs tool routing decisions using raw TOOL_INVOCATION queries until the aggregate is built. Schema and recomputation schedule will be defined in a future phase.

---

## 5. Storage Architecture

### 5.1 Primary Store — Postgres + pgvector

| Table | Type | Notes |
|---|---|---|
| EPISODIC_EVENT | Append-only | Partitioned by created_at (monthly) |
| SEMANTIC_FACT | Append-only (versioned rows) | pgvector index on embedding column (K4) |
| SEMANTIC_FACT_EVENT | Append-only | Sole lifecycle gate for SEMANTIC_FACT retrieval |
| DECISION_EVENT | Append-only | FK integrity enforced |
| TOOL_INVOCATION | Append-only | Permanent; no purge |
| EMBEDDING_RECORD | Append-only stub | K4 populates model + version + embedding |
| EMBEDDING_STATUS_EVENT | Append-only stub | K4 defines state enum |

pgvector index: HNSW on SEMANTIC_FACT.embedding. ef_construction=128, m=16. Index rebuilt on significant bulk insert. Deferred to K4.

**DB roles:**

| Role | INSERT | SELECT | UPDATE | DELETE |
|---|---|---|---|---|
| foreman_rw | EPISODIC_EVENT, TOOL_INVOCATION | All | — | — |
| atlas_rw | SEMANTIC_FACT, SEMANTIC_FACT_EVENT, EMBEDDING_RECORD, EMBEDDING_STATUS_EVENT | All | — | — |
| command_rw | SEMANTIC_FACT, SEMANTIC_FACT_EVENT, DECISION_EVENT | All | — | — |
| agent_ro | — | SEMANTIC_FACT (lifecycle state = APPROVED only, via SemanticFactEvent), DECISION_EVENT, EPISODIC_EVENT | — | — |
| sentinel_rw | DECISION_EVENT, SEMANTIC_FACT_EVENT | All | — | — |
| compass_rw | DECISION_EVENT, SEMANTIC_FACT_EVENT | All | — | — |

No role has DELETE on any governance table. No role has UPDATE on any governance table. Foreman owns EPISODIC_EVENT and TOOL_INVOCATION INSERT via foreman_rw. Foreman is a runtime process identity — it does not appear in the agent_role enum on EPISODIC_EVENT.

### 5.2 Blob Store (S3 / filesystem)

Agent input/output payloads stored as compressed JSON blobs. Referenced by input_ref / output_ref keys in EPISODIC_EVENT. Payloads are write-once. Deletion prohibited. Encryption at rest required.

### 5.3 Embedding Model

text-embedding-3-small (1536 dimensions). Version must be pinned and recorded in EMBEDDING_RECORD.embedding_version on every write. If the embedding model changes, existing vectors are incompatible with new vectors — re-indexing is required. Re-indexing policy must be approved by Command before execution.

Embedding pipeline deferred to K4.

---

## 6. Retrieval Layer

### 6.1 Query Interface

Retrieval is request-scoped. Each agent invocation may issue retrieval queries pre-authorised for its role. Foreman injects retrieval results into the agent context payload — agents do not query the DB directly.

| Mode | Mechanism | Use case |
|---|---|---|
| semantic_search | pgvector ANN on SEMANTIC_FACT.embedding | Find relevant architectural facts |
| decision_lookup | Exact FK / enum filter on DECISION_EVENT | Confirm prior Command decisions |
| episodic_replay | run_id / slice_id filter on EPISODIC_EVENT | Reconstruct prior run context |
| tool_routing | TOOL_INVOCATION query by tool_name (raw records; TOOL_PERFORMANCE_SUMMARY aggregate deferred) | Inform Foreman fallback decisions |

### 6.2 Retrieval Access by Role

| Agent | semantic_search | decision_lookup | episodic_replay | tool_routing |
|---|---|---|---|---|
| Command | ✓ | ✓ | ✓ | — |
| Atlas | ✓ | ✓ | ✓ | ✓ |
| Forge | ✓ | ✓ (slice-scoped) | ✓ (own run only) | — |
| Sentinel | ✓ | ✓ | ✓ | — |
| Compass | ✓ | ✓ | ✓ | — |
| Foreman | — | ✓ | ✓ | ✓ |

Forge episodic_replay is scoped to the active run_id and slice_id only — no cross-slice history access.

### 6.3 Retrieval Result Trust Classification

All retrieval results are injected with a trust_class field:

| trust_class | Condition | Agent behaviour |
|---|---|---|
| BINDING | Source is a DECISION_EVENT with authority_class = BINDING | Must be honoured |
| INFORMATIVE | SEMANTIC_FACT with confidence ≥ 0.7 and latest SemanticFactEvent.state = APPROVED | May inform; must not override governance |
| WEAK | SEMANTIC_FACT with confidence < 0.7 and latest SemanticFactEvent.state = APPROVED | Treat as hint only |
| SUPERSEDED | SEMANTIC_FACT where latest SemanticFactEvent.state = SUPERSEDED | Must be ignored |

**Critical rule:** No retrieval result of any trust_class may override a current Slice Contract constraint or AGENTS.md rule. Governance documents always take precedence.

### 6.4 Context Window Budget

Retrieval results are ranked by relevance score and injected up to a token budget per agent role:

| Role | Max retrieval tokens |
|---|---|
| Command | 4,000 |
| Atlas | 6,000 |
| Forge | 3,000 |
| Sentinel | 3,000 |
| Compass | 3,000 |

Foreman enforces budget. Overflow: highest-relevance results retained, remainder dropped with a truncation log entry in EPISODIC_EVENT.

---

## 7. Agent Memory Access Rules

### 7.1 Write Rules

| Memory type | Who may write | Mechanism |
|---|---|---|
| EPISODIC_EVENT | Foreman runtime only | Automated post-invocation |
| SEMANTIC_FACT | Atlas, Command | Explicit output artifact, reviewed |
| SEMANTIC_FACT_EVENT | Atlas, Command, Sentinel, Compass | Role-enforced; lifecycle transitions only |
| DECISION_EVENT | Command, Sentinel, Compass | Role-enforced, structured output |
| TOOL_INVOCATION | Foreman runtime only | Automated on each tool call |
| EMBEDDING_RECORD | Atlas (via K4 pipeline) | Automated on SEMANTIC_FACT approval |
| EMBEDDING_STATUS_EVENT | Atlas (via K4 pipeline) | Automated by embedding pipeline |

No agent LLM output is written directly to any table. All writes transit Foreman schema validation first.

### 7.2 Read Rules

As per §6.2. All reads via Foreman retrieval API — no direct DB access from agent prompts.

### 7.3 Forbidden Operations

- No agent may request deletion of any memory record.
- No agent may modify a DECISION_EVENT after creation.
- No agent may write a SEMANTIC_FACT that contradicts a locked DECISION_EVENT without first raising an escalation.
- SEMANTIC_FACT with fact_type = KNOWN_CONSTRAINT requires **both Command approval and Sentinel co-approval** before a SemanticFactEvent with state = APPROVED may be written. Single-approver promotion of KNOWN_CONSTRAINT facts is forbidden.

---

## 8. Learning Feedback Loop

### 8.1 Loop Stages

```
[1] Foreman records EPISODIC_EVENT + TOOL_INVOCATION on every run
    ↓
[2] Post-run: Atlas reviews episodic record for extractable facts
    ↓
[3] Atlas produces candidate SEMANTIC_FACTs (structured output, not free text)
    — each candidate is written with a SemanticFactEvent of state = PROPOSED
    ↓
[4] Command reviews candidates
    — standard facts: Command approval → SemanticFactEvent(APPROVED)
    — KNOWN_CONSTRAINT facts: Command approval + Sentinel co-approval required
      before SemanticFactEvent(APPROVED) may be written
    — rejected facts: remain PROPOSED; not retrievable
    ↓
[5] Approved facts indexed (embedding computed by K4); available for next retrieval
    ↓
[6] Foreman reads raw TOOL_INVOCATION records for routing decisions
    (TOOL_PERFORMANCE_SUMMARY aggregation deferred to future phase)
    ↓
[7] On next run: retrieval injects relevant APPROVED facts into agent context
```

### 8.2 Feedback Triggers

| Trigger | Action |
|---|---|
| STOP_CONDITION fired | Atlas reviews episodic record; candidate fact type: KNOWN_CONSTRAINT |
| Sentinel FAIL | DECISION_EVENT written; Atlas may propose constraint fact |
| Compass FAIL | Same as Sentinel FAIL |
| Novel ambiguity resolved by Command | Atlas extracts as RESOLVED_AMBIGUITY fact |
| Tool error rate exceeds 20% (7d window) | Foreman flags to Command; Atlas may propose KNOWN_CONSTRAINT |

### 8.3 Feedback Loop Invariants

- Feedback loop may only ADD knowledge — never delete or overwrite governance.
- A SEMANTIC_FACT cannot lower the confidence of a locked DECISION_EVENT.
- Atlas may propose but not self-approve any SEMANTIC_FACT.
- Feedback loop is paused if the active Slice Contract is in STOPPED state.

---

## 9. PII Handling

Memory artifacts may contain PII (hunter names, contact details, land parcel references).

Mandatory rules:

- EPISODIC_EVENT input_ref/output_ref payloads: encrypted at rest (AES-256). Access requires explicit DB role.
- SEMANTIC_FACT content: must not contain raw PII. Summaries only. Atlas is responsible for redaction before write.
- DECISION_EVENT rationale: may reference identifiers but not raw PII fields.
- Retrieval results containing any PII markers: classified trust_class = INFORMATIVE max — never BINDING.
- **Escalation required:** Any memory artifact discovered to contain raw PII must be reported to Command immediately. No self-remediation by agents.

---

## 10. Non-Goals (Explicit)

The following are out of scope for this specification:

- Real-time streaming memory updates during a run.
- Cross-tenant memory sharing (memory is scoped to this project instance only).
- LLM fine-tuning from memory artifacts.
- Memory-driven auto-approval of governance decisions.
- Vector similarity search on EPISODIC_EVENT payloads (payload blobs are not embedded).
- User-facing memory UI or memory export.
- Memory-based override of any Trust Engine state machine.
- Automatic SEMANTIC_FACT promotion without Command approval.
- TOOL_PERFORMANCE_SUMMARY materialised aggregate (deferred to future phase).

---

## 11. Acceptance Criteria

| # | Criterion |
|---|---|
| AC-MEM-01 | EPISODIC_EVENT records exist for every agent invocation in a Foreman run, keyed by run_id |
| AC-MEM-02 | No INSERT succeeds on EPISODIC_EVENT without run_id. DECISION_EVENT.run_id is nullable and may be omitted without error. |
| AC-MEM-03 | SEMANTIC_FACT where latest SemanticFactEvent.state ≠ APPROVED is never returned by the retrieval layer |
| AC-MEM-04 | Forge retrieval is scoped to active slice_id; cross-slice episodic_replay returns 0 results |
| AC-MEM-05 | No agent LLM output is written directly to DB without Foreman schema validation |
| AC-MEM-06 | TOOL_INVOCATION records are retained permanently; no DELETE or purge path exists |
| AC-MEM-07 | A SEMANTIC_FACT whose latest SemanticFactEvent.state = PROPOSED is not retrievable |
| AC-MEM-08 | Context window budget enforcement: no agent receives a retrieval payload exceeding its token limit |
| AC-MEM-09 | All memory table DDL enforces INSERT-only via DB role grants (no UPDATE/DELETE grants on governance tables) |
| AC-MEM-10 | PII escalation path tested: agent receives PII-containing payload → stop condition fires → DECISION_EVENT written with authority_class = ESCALATION |

---

## 12. Resolved Command Rulings

All four previously open escalations are resolved. These rulings are locked and must not be re-opened without a new Command decision.

| # | Topic | Ruling | Authority |
|---|---|---|---|
| RES-MEM-01 | SEMANTIC_FACT retention | **Permanent.** No rolling cull. APPROVED facts are retained indefinitely. Supersession via lifecycle event is the only retirement path. | Command |
| RES-MEM-02 | Embedding model version governance | **Required.** `embedding_model` and `embedding_version` are mandatory fields on EMBEDDING_RECORD. If the embedding model changes, all existing vectors are incompatible. Re-indexing requires Command approval before execution. Version pin must be recorded on every EMBEDDING_RECORD write. | Command |
| RES-MEM-03 | TOOL_INVOCATION retention | **Permanent. No purge.** Raw TOOL_INVOCATION records are retained indefinitely. The 90-day rolling purge model is rejected. TOOL_PERFORMANCE_SUMMARY aggregation is deferred and does not affect raw record retention. | Command |
| RES-MEM-04 | KNOWN_CONSTRAINT approval quorum | **Command + Sentinel co-approval required.** A SEMANTIC_FACT with fact_type = KNOWN_CONSTRAINT may not have a SemanticFactEvent(APPROVED) written on Command approval alone. Sentinel co-approval is mandatory before promotion. | Command |

---

## v1.1 Change Log

| Change | Section | Reason |
|---|---|---|
| Document version corrected to v1.1; status set to AWAITING COMMAND APPROVAL | Header | File content was internally labelled v1.0 draft |
| Removed mutable `status` field from SEMANTIC_FACT | §4.2 | Lifecycle governed exclusively by SemanticFactEvent; row-level status created a dual-source-of-truth vulnerability |
| Added §4.2a SEMANTIC_FACT_EVENT as first-class schema section | §4.2a | Clarifies lifecycle as the sole retrieval gate |
| Replaced `decision_type` / `deciding_role` / `outcome` with `decision_context_type` / `authority_class` / `binding_scope` on DECISION_EVENT | §4.3 | Approved v1.1 taxonomy |
| DECISION_EVENT.run_id explicitly nullable with rationale | §4.3 | Prevents incorrect NOT NULL enforcement on scope-independent decisions |
| TOOL_INVOCATION retention changed from rolling 90-day to permanent | §3.4, §4.4, §5.1 | Command ruling RES-MEM-03: purge model rejected |
| TOOL_PERFORMANCE_SUMMARY removed as active current schema dependency | §4 note, §5.1, §10 | Not an active requirement for this phase; deferred |
| EMBEDDING_RECORD approved long-term fields added: `embedding_model`, `embedding_version`, `embedding_generated_at` | §4.5 | Command ruling RES-MEM-02: version governance required from first write |
| Foreman clarified as runtime process identity, not LLM agent role | §4.1, §4.4, §5.1 | Prevents FOREMAN from appearing in agent_role enum |
| §6.3 trust classification updated to reference SemanticFactEvent.state | §6.3 | Removes dependency on removed SEMANTIC_FACT.status field |
| tool_routing mechanism updated to raw TOOL_INVOCATION (no TOOL_PERFORMANCE_SUMMARY) | §6.1 | Consistent with deferral of aggregate |
| §7.3 KNOWN_CONSTRAINT updated to require Command + Sentinel co-approval | §7.3 | Command ruling RES-MEM-04 |
| §8.1 feedback loop updated for KNOWN_CONSTRAINT quorum and no aggregate | §8.1 | Consistency with resolved rulings |
| AC-MEM-02 corrected: DECISION_EVENT.run_id is nullable | §11 | Spec alignment |
| AC-MEM-03 updated to reference SemanticFactEvent.state | §11 | Removes dependency on removed status field |
| AC-MEM-06 replaced: permanence test replaces 90-day purge test | §11 | Command ruling RES-MEM-03 |
| AC-MEM-07 updated: PROPOSED replaces PENDING | §11 | Correct lifecycle state name |
| AC-MEM-10 updated: references authority_class = ESCALATION | §11 | v1.1 field alignment |
| Open Escalations replaced with Resolved Command Rulings | §12 | All four escalations closed by Command |

---

ATLAS SIGN-OFF (v1.1): Specification corrected and internally consistent. Awaiting Command architecture approval before implementation.
