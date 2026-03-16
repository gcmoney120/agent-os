-- =============================================================================
-- Agent OS — K1 Memory Engine Foundation
-- Migration: migration_k1.sql
-- Spec: Memory Engine Architecture Spec v1.2 (Atlas §4.1–§4.6a, §5)
--
-- ADR-K1-01: project_id TEXT NOT NULL + schema_version TEXT NOT NULL on all tables.
-- ADR-K1-02: All enum fields are TEXT NOT NULL. Application-layer validated only.
--
-- Constraints:
--   - Append-only: no UPDATE, no DELETE.
--   - No PostgreSQL native enums (CREATE TYPE ... AS ENUM).
--   - No CHECK constraints for enum values.
--   - No FK on project_id. No projects table. No RLS. No triggers.
--
-- Idempotent: all objects use IF NOT EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- pgvector extension — required for VECTOR(1536) on embedding_record.
-- Not present in any prior migration.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- §4.1 — episodic_event
-- Append-only. No UPDATE, no DELETE.
-- project_id is not a FK; application layer enforces valid values.
-- agent_role valid values (§3): 'orchestrator','atlas','forge','sentinel','compass'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episodic_event (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  agent_role      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- §4.2 — semantic_fact
-- Append-only. Lifecycle transitions enforced by application layer only.
-- Supersession creates a new row; prior row is not mutated.
-- fact_type valid values (§3): 'belief','constraint','preference','relationship','capability'
-- lifecycle_state valid values (§3): 'active','superseded','retracted'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semantic_fact (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  subject         TEXT NOT NULL,
  predicate       TEXT NOT NULL,
  object          TEXT NOT NULL,
  fact_type       TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  confidence      NUMERIC(4,3),
  source_run_id   TEXT,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- §4.3 — semantic_fact_event
-- Append-only audit of lifecycle transitions for semantic_fact.
-- No UPDATE, no DELETE.
-- lifecycle_state valid values (§3): 'activated','superseded','retracted'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semantic_fact_event (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  fact_id         UUID NOT NULL REFERENCES semantic_fact(id),
  lifecycle_state TEXT NOT NULL,
  actor_run_id    TEXT NOT NULL,
  reason          TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- §4.4 — decision_event
-- Append-only. Decisions are never revised in-place.
-- taxonomy valid values (§3): 'architectural','trust','product','operational'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decision_event (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  taxonomy        TEXT NOT NULL,
  title           TEXT NOT NULL,
  rationale       TEXT NOT NULL,
  alternatives    JSONB,
  outcome         TEXT NOT NULL,
  made_by         TEXT NOT NULL,
  made_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- §4.5 — tool_invocation
-- Append-only. Retried invocations produce new rows; prior rows not mutated.
-- outcome valid values (§3): 'success','failure','timeout','skipped'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_invocation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  agent_role      TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  input_payload   JSONB NOT NULL,
  output_payload  JSONB,
  outcome         TEXT NOT NULL,
  error_detail    TEXT,
  duration_ms     INTEGER,
  invoked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- §4.6 — embedding_record
-- Append-only. Re-embedding produces a new row with same source_table+source_id.
-- embedding: pgvector VECTOR(1536), dimension matches model_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embedding_record (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  source_table    TEXT NOT NULL,
  source_id       UUID NOT NULL,
  model_id        TEXT NOT NULL,
  embedding       VECTOR(1536) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- §4.6a — embedding_status_event
-- Append-only audit trail of embedding pipeline state transitions.
-- status valid values (§3): 'pending','processing','complete','failed'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embedding_status_event (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  source_table    TEXT NOT NULL,
  source_id       UUID NOT NULL,
  status          TEXT NOT NULL,
  error_detail    TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- §5 — Recommended Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_episodic_event_project_run
  ON episodic_event (project_id, run_id);

CREATE INDEX IF NOT EXISTS idx_episodic_event_project_session
  ON episodic_event (project_id, session_id);

CREATE INDEX IF NOT EXISTS idx_semantic_fact_project_lifecycle
  ON semantic_fact (project_id, lifecycle_state);

CREATE INDEX IF NOT EXISTS idx_semantic_fact_project_subject_predicate
  ON semantic_fact (project_id, subject, predicate);

CREATE INDEX IF NOT EXISTS idx_semantic_fact_event_fact
  ON semantic_fact_event (fact_id);

CREATE INDEX IF NOT EXISTS idx_decision_event_project_taxonomy
  ON decision_event (project_id, taxonomy);

CREATE INDEX IF NOT EXISTS idx_tool_invocation_project_run_role
  ON tool_invocation (project_id, run_id, agent_role);

CREATE INDEX IF NOT EXISTS idx_embedding_record_project_source
  ON embedding_record (project_id, source_table, source_id);

CREATE INDEX IF NOT EXISTS idx_embedding_status_event_project_source_time
  ON embedding_status_event (project_id, source_table, source_id, occurred_at DESC);
