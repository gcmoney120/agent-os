-- =============================================================================
-- Agent OS — K1.1 Memory Schema Correction
-- Migration: migration_k1_1.sql
-- Authority: Atlas K2/K1 Reconciliation Decision v1.0 + Command Rulings R1–R11
--
-- Purpose:
--   Correct five K1 tables to support the approved K2 Memory Write Pipeline
--   architecture. episodic_event and tool_invocation are not modified; they
--   are K2-compatible as-is.
--
-- Approach: Drop-and-recreate.
--   Safe: all corrected tables are currently empty. K2 is not yet implemented;
--   no application writes have occurred against these tables. This is a
--   schema-only slice — no runtime code is changed.
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
-- Idempotent: DROP IF EXISTS CASCADE + CREATE IF NOT EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Drop affected tables in reverse FK dependency order.
-- CASCADE removes dependent objects (indexes, FK constraints) automatically.
-- episodic_event and tool_invocation are NOT dropped — unchanged.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS embedding_status_event CASCADE;
DROP TABLE IF EXISTS embedding_record CASCADE;
DROP TABLE IF EXISTS semantic_fact_event CASCADE;
DROP TABLE IF EXISTS decision_event CASCADE;
DROP TABLE IF EXISTS semantic_fact CASCADE;

-- ---------------------------------------------------------------------------
-- §4.2 — semantic_fact (corrected)
-- Replaces triple-store (subject/predicate/object) with fact_key/fact_value model.
-- source_run_id is TEXT NOT NULL (required for K2 provenance chain).
-- lifecycle_state and confidence not approved for K1.1 — removed.
-- valid_from/valid_until removed (not part of K2 approved model).
-- UNIQUE constraint: (project_id, fact_type, fact_key).
-- fact_type is TEXT NOT NULL.
-- Values are defined by the approved K2 architecture and validated at the application layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semantic_fact (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  fact_type       TEXT NOT NULL,
  fact_key        TEXT NOT NULL,
  fact_value      JSONB NOT NULL,
  source_run_id   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, fact_type, fact_key)
);

-- ---------------------------------------------------------------------------
-- §4.3 — semantic_fact_event (corrected)
-- Anchor-link table: joins a semantic_fact to its originating episodic_event.
-- No lifecycle, provenance, or reason fields — those were not approved.
-- R6: observed_at (not occurred_at).
-- UNIQUE constraint: (semantic_fact_id, episodic_event_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semantic_fact_event (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        TEXT NOT NULL,
  schema_version    TEXT NOT NULL,
  semantic_fact_id  UUID NOT NULL REFERENCES semantic_fact(id),
  episodic_event_id UUID NOT NULL REFERENCES episodic_event(id),
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (semantic_fact_id, episodic_event_id)
);

-- ---------------------------------------------------------------------------
-- §4.4 — decision_event (corrected)
-- Replaces taxonomy/title/rationale/alternatives/outcome/made_by model with
-- decision_type/actor_role/decision_payload + episodic_event_id anchor FK.
-- UNIQUE constraint: (run_id, decision_type, episodic_event_id).
-- decision_type is TEXT NOT NULL.
-- Values are defined by the approved K2 architecture and validated at the application layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decision_event (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        TEXT NOT NULL,
  schema_version    TEXT NOT NULL,
  run_id            TEXT NOT NULL,
  decision_type     TEXT NOT NULL,
  actor_role        TEXT NOT NULL,
  episodic_event_id UUID NOT NULL REFERENCES episodic_event(id),
  decision_payload  JSONB NOT NULL,
  decided_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, decision_type, episodic_event_id)
);

-- ---------------------------------------------------------------------------
-- §4.6 — embedding_record (corrected)
-- semantic_fact_id FK replaces polymorphic (source_table, source_id) model.
-- embedding is nullable: K2 creates rows in PENDING state; K4 populates vector.
-- status TEXT NOT NULL DEFAULT 'PENDING' tracks pipeline state machine.
-- R9: model_id retained as TEXT NULL. Populated by K4 on vector commit.
-- UNIQUE constraint: (semantic_fact_id) — one embedding record per fact.
-- status valid values (§3): 'PENDING','PROCESSING','COMPLETE','FAILED'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embedding_record (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       TEXT NOT NULL,
  schema_version   TEXT NOT NULL,
  semantic_fact_id UUID NOT NULL REFERENCES semantic_fact(id),
  status           TEXT NOT NULL DEFAULT 'PENDING',
  model_id         TEXT NULL,
  embedding        VECTOR(1536),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (semantic_fact_id)
);

-- ---------------------------------------------------------------------------
-- §4.6a — embedding_status_event (corrected)
-- embedding_record_id FK replaces polymorphic (source_table, source_id, status).
-- Transition history model: previous_status + new_status + transitioned_at.
-- transition_reason TEXT NOT NULL — required on all transitions.
-- UNIQUE constraint: (embedding_record_id, new_status, transitioned_at).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embedding_status_event (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          TEXT NOT NULL,
  schema_version      TEXT NOT NULL,
  embedding_record_id UUID NOT NULL REFERENCES embedding_record(id),
  previous_status     TEXT,
  new_status          TEXT NOT NULL,
  transition_reason   TEXT NOT NULL,
  transitioned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (embedding_record_id, new_status, transitioned_at)
);

-- =============================================================================
-- Indexes — corrected tables only.
-- Indexes on episodic_event and tool_invocation are unchanged and not dropped.
-- Dropped tables' old indexes were removed by CASCADE above.
-- =============================================================================

-- semantic_fact
CREATE INDEX IF NOT EXISTS idx_semantic_fact_project_type_key
  ON semantic_fact (project_id, fact_type, fact_key);

-- semantic_fact_event
CREATE INDEX IF NOT EXISTS idx_semantic_fact_event_semantic_fact
  ON semantic_fact_event (semantic_fact_id);

CREATE INDEX IF NOT EXISTS idx_semantic_fact_event_episodic
  ON semantic_fact_event (episodic_event_id);

-- decision_event
CREATE INDEX IF NOT EXISTS idx_decision_event_project_type
  ON decision_event (project_id, decision_type);

CREATE INDEX IF NOT EXISTS idx_decision_event_episodic
  ON decision_event (episodic_event_id);

-- embedding_record
CREATE INDEX IF NOT EXISTS idx_embedding_record_semantic_fact
  ON embedding_record (semantic_fact_id);

CREATE INDEX IF NOT EXISTS idx_embedding_record_project_status
  ON embedding_record (project_id, status);

-- embedding_status_event
CREATE INDEX IF NOT EXISTS idx_embedding_status_event_record_time
  ON embedding_status_event (embedding_record_id, transitioned_at DESC);
