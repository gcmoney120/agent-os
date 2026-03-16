/**
 * Agent OS — Runtime Integration Layer
 * Supabase Persistence Backend: PostgreSQL-backed implementation of PersistenceBackend.
 *
 * Replaces InMemoryPersistenceBackend with durable Supabase PostgreSQL storage.
 * Uses the Supabase JS client for database operations.
 *
 * Architecture:
 *   - MemoryStore records are persisted to PostgreSQL tables (one per K1 record type)
 *   - RunLedgerStore is persisted to run_ledgers and run_ledger_events tables
 *   - Write-through: appends go to both in-memory store and PostgreSQL
 *   - Read: in-memory store serves reads (populated from PostgreSQL on init)
 *   - flush() persists any pending writes
 *
 * Required environment:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (uses service role for backend operations)
 *
 * Required database tables (apply via migration):
 *   - agent_os.episodic_events
 *   - agent_os.semantic_facts
 *   - agent_os.semantic_fact_events
 *   - agent_os.decision_events
 *   - agent_os.tool_invocations
 *   - agent_os.embedding_records
 *   - agent_os.embedding_status_events
 *   - agent_os.run_ledgers
 *   - agent_os.run_ledger_events
 */

import { MemoryStore } from "../memory/store.js";
import {
  createEmptyLedgerStore,
  createRunLedger,
  appendLedgerEvent,
  updateLedgerState,
  type RunLedgerStore,
} from "../planner/run-ledger.js";
import type { RunLedger, RunLedgerEvent } from "../planner/execution-types.js";
import type { PersistenceBackend } from "./providers.js";
import type {
  EpisodicEvent,
  SemanticFact,
  SemanticFactEvent,
  DecisionEvent,
  ToolInvocation,
  EmbeddingRecord,
  EmbeddingStatusEvent,
} from "../memory/schemas.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SupabasePersistenceOptions {
  /** Supabase project URL. Required. */
  supabaseUrl: string;
  /** Supabase service role key. Required. */
  supabaseKey: string;
  /** Database schema for Agent OS tables. Defaults to "agent_os". */
  schema?: string;
  /** Project ID for namespace isolation. Required. */
  projectId: string;
}

interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
}

interface SupabaseQueryBuilder {
  insert(data: Record<string, unknown> | Record<string, unknown>[]): SupabaseFilterBuilder;
  select(columns?: string): SupabaseFilterBuilder;
  upsert(data: Record<string, unknown> | Record<string, unknown>[]): SupabaseFilterBuilder;
}

interface SupabaseFilterBuilder {
  eq(column: string, value: unknown): SupabaseFilterBuilder;
  order(column: string, options?: { ascending?: boolean }): SupabaseFilterBuilder;
  then: Promise<{ data: unknown[]; error: { message: string } | null }>["then"];
}

// ── Write Buffer ────────────────────────────────────────────────────────────

interface PendingWrite {
  table: string;
  record: Record<string, unknown>;
}

// ── SupabasePersistenceBackend ──────────────────────────────────────────────

/**
 * Supabase PostgreSQL persistence backend.
 *
 * Uses a write-through architecture:
 * - All appends are queued in a write buffer AND applied to the in-memory store
 * - flush() persists buffered writes to PostgreSQL
 * - Reads are served from the in-memory store for performance
 * - On initialization, load() hydrates the in-memory store from PostgreSQL
 */
export class SupabasePersistenceBackend implements PersistenceBackend {
  private readonly _memoryStore: MemoryStore;
  private _runLedgerStore: RunLedgerStore;
  private readonly _pendingWrites: PendingWrite[] = [];
  private readonly _supabaseUrl: string;
  private readonly _supabaseKey: string;
  private readonly _schema: string;
  private readonly _projectId: string;
  private _client: SupabaseClient | null = null;

  constructor(options: SupabasePersistenceOptions) {
    if (!options.supabaseUrl) {
      throw new Error(
        "SupabasePersistenceBackend: supabaseUrl option is required.",
      );
    }
    if (!options.supabaseKey) {
      throw new Error(
        "SupabasePersistenceBackend: supabaseKey option is required.",
      );
    }
    this._supabaseUrl = options.supabaseUrl;
    this._supabaseKey = options.supabaseKey;
    this._schema = options.schema ?? "agent_os";
    this._projectId = options.projectId;
    this._memoryStore = new MemoryStore();
    this._runLedgerStore = createEmptyLedgerStore();
  }

  memoryStore(): MemoryStore {
    return this._memoryStore;
  }

  runLedgerStore(): RunLedgerStore {
    return this._runLedgerStore;
  }

  /**
   * Update the ledger store reference.
   * Called by the orchestrator after syncDispatchResult.
   */
  updateRunLedgerStore(store: RunLedgerStore): void {
    this._runLedgerStore = store;
  }

  // ── Lazy client initialization ──────────────────────────────────────────

  private async getClient(): Promise<SupabaseClient> {
    if (this._client) return this._client;

    // Dynamic import to avoid hard dependency at module load time.
    // Callers must have @supabase/supabase-js installed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@supabase/supabase-js" as string);
    const createClient = mod.createClient ?? mod.default?.createClient;
    this._client = createClient(this._supabaseUrl, this._supabaseKey, {
      db: { schema: this._schema },
    }) as SupabaseClient;
    return this._client;
  }

  private tableName(table: string): string {
    return table;
  }

  // ── Memory Store Write-Through Methods ──────────────────────────────────

  /**
   * Append an episodic event to both in-memory store and write buffer.
   */
  appendEpisodicEvent(record: EpisodicEvent): void {
    this._memoryStore.appendEpisodicEvent(record);
    this._pendingWrites.push({
      table: this.tableName("episodic_events"),
      record: serializeMemoryRecord(record, this._projectId),
    });
  }

  appendSemanticFact(record: SemanticFact): void {
    this._memoryStore.appendSemanticFact(record);
    this._pendingWrites.push({
      table: this.tableName("semantic_facts"),
      record: serializeMemoryRecord(record, this._projectId),
    });
  }

  appendSemanticFactEvent(record: SemanticFactEvent): void {
    this._memoryStore.appendSemanticFactEvent(record);
    this._pendingWrites.push({
      table: this.tableName("semantic_fact_events"),
      record: serializeMemoryRecord(record, this._projectId),
    });
  }

  appendDecisionEvent(record: DecisionEvent): void {
    this._memoryStore.appendDecisionEvent(record);
    this._pendingWrites.push({
      table: this.tableName("decision_events"),
      record: serializeMemoryRecord(record, this._projectId),
    });
  }

  appendToolInvocation(record: ToolInvocation): void {
    this._memoryStore.appendToolInvocation(record);
    this._pendingWrites.push({
      table: this.tableName("tool_invocations"),
      record: serializeMemoryRecord(record, this._projectId),
    });
  }

  appendEmbeddingRecord(record: EmbeddingRecord): void {
    this._memoryStore.appendEmbeddingRecord(record);
    this._pendingWrites.push({
      table: this.tableName("embedding_records"),
      record: serializeMemoryRecord(record, this._projectId),
    });
  }

  appendEmbeddingStatusEvent(record: EmbeddingStatusEvent): void {
    this._memoryStore.appendEmbeddingStatusEvent(record);
    this._pendingWrites.push({
      table: this.tableName("embedding_status_events"),
      record: serializeMemoryRecord(record, this._projectId),
    });
  }

  // ── Run Ledger Write-Through ────────────────────────────────────────────

  /**
   * Persist a new run ledger entry.
   */
  appendRunLedger(ledger: RunLedger): void {
    const result = createRunLedger(this._runLedgerStore, ledger);
    if (result.ok) {
      this._runLedgerStore = result.data;
    }
    this._pendingWrites.push({
      table: this.tableName("run_ledgers"),
      record: serializeRunLedger(ledger, this._projectId),
    });
  }

  /**
   * Persist a run ledger event.
   */
  appendRunLedgerEvent(event: RunLedgerEvent): void {
    const result = appendLedgerEvent(this._runLedgerStore, event);
    if (result.ok) {
      this._runLedgerStore = result.data;
    }
    this._pendingWrites.push({
      table: this.tableName("run_ledger_events"),
      record: serializeRunLedgerEvent(event, this._projectId),
    });
  }

  // ── Flush ───────────────────────────────────────────────────────────────

  /**
   * Persist all buffered writes to Supabase PostgreSQL.
   * Processes writes in order to maintain causal consistency.
   */
  async flush(): Promise<void> {
    if (this._pendingWrites.length === 0) return;

    const client = await this.getClient();
    const writes = this._pendingWrites.splice(0);

    // Group writes by table for batch inserts
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const write of writes) {
      const existing = grouped.get(write.table);
      if (existing) {
        existing.push(write.record);
      } else {
        grouped.set(write.table, [write.record]);
      }
    }

    for (const [table, records] of grouped) {
      const { error } = await client.from(table).insert(records);
      if (error) {
        throw new Error(
          `SupabasePersistenceBackend: failed to flush ${records.length} records to ${table}: ${error.message}`,
        );
      }
    }
  }

  // ── Load (hydrate from PostgreSQL) ──────────────────────────────────────

  /**
   * Hydrate the in-memory store from Supabase PostgreSQL.
   * Call this once after construction to load existing state.
   */
  async load(): Promise<void> {
    const client = await this.getClient();

    // Load run ledgers
    const { data: ledgers, error: ledgerError } = await client
      .from(this.tableName("run_ledgers"))
      .select("*")
      .eq("project_id", this._projectId);

    if (ledgerError) {
      throw new Error(
        `SupabasePersistenceBackend: failed to load run ledgers: ${ledgerError.message}`,
      );
    }

    let store = createEmptyLedgerStore();
    for (const row of ledgers as Record<string, unknown>[]) {
      const ledger = deserializeRunLedger(row);
      const result = createRunLedger(store, ledger);
      if (result.ok) {
        store = result.data;
      }
    }

    // Load run ledger events
    const { data: events, error: eventsError } = await client
      .from(this.tableName("run_ledger_events"))
      .select("*")
      .eq("project_id", this._projectId)
      .order("sequence", { ascending: true });

    if (eventsError) {
      throw new Error(
        `SupabasePersistenceBackend: failed to load run ledger events: ${eventsError.message}`,
      );
    }

    for (const row of events as Record<string, unknown>[]) {
      const event = deserializeRunLedgerEvent(row);
      const result = appendLedgerEvent(store, event);
      if (result.ok) {
        store = result.data;
      }
    }

    this._runLedgerStore = store;
  }

  /**
   * Get the number of pending writes in the buffer.
   * Useful for monitoring and testing.
   */
  get pendingWriteCount(): number {
    return this._pendingWrites.length;
  }
}

// ── Serialization helpers ───────────────────────────────────────────────────

function serializeMemoryRecord(
  record: object,
  projectId: string,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  // Ensure project_id is set
  serialized.project_id = projectId;
  // Convert Date objects to ISO strings for PostgreSQL
  if (serialized.created_at instanceof Date) {
    serialized.created_at = (serialized.created_at as Date).toISOString();
  }
  return serialized;
}

function serializeRunLedger(
  ledger: RunLedger,
  projectId: string,
): Record<string, unknown> {
  return {
    run_id: ledger.run_id,
    plan_id: ledger.plan_id,
    plan_version: ledger.plan_version,
    plan_snapshot: ledger.plan_snapshot,
    plan_snapshot_chksum: ledger.plan_snapshot_chksum,
    state: ledger.state,
    state_entered_at: ledger.state_entered_at,
    requested_by: ledger.requested_by,
    foreman_version: ledger.foreman_version,
    created_at: ledger.created_at,
    terminal_at: ledger.terminal_at,
    terminal_reason: ledger.terminal_reason,
    readiness_verdict: ledger.readiness_verdict,
    project_id: projectId,
  };
}

function serializeRunLedgerEvent(
  event: RunLedgerEvent,
  projectId: string,
): Record<string, unknown> {
  return {
    event_id: event.event_id,
    run_id: event.run_id,
    plan_id: event.plan_id,
    sequence: event.sequence,
    event_type: event.event_type,
    emitted_at: event.emitted_at,
    emitted_by: event.emitted_by,
    payload: event.payload,
    project_id: projectId,
  };
}

function deserializeRunLedger(row: Record<string, unknown>): RunLedger {
  return {
    run_id: row.run_id as string,
    plan_id: row.plan_id as string,
    plan_version: row.plan_version as number,
    plan_snapshot: row.plan_snapshot,
    plan_snapshot_chksum: row.plan_snapshot_chksum as string,
    state: row.state as RunLedger["state"],
    state_entered_at: row.state_entered_at as string,
    requested_by: row.requested_by as string,
    foreman_version: row.foreman_version as string,
    created_at: row.created_at as string,
    terminal_at: (row.terminal_at as string) ?? null,
    terminal_reason: (row.terminal_reason as string) ?? null,
    readiness_verdict: (row.readiness_verdict as RunLedger["readiness_verdict"]) ?? null,
  };
}

function deserializeRunLedgerEvent(row: Record<string, unknown>): RunLedgerEvent {
  return {
    event_id: row.event_id as string,
    run_id: row.run_id as string,
    plan_id: row.plan_id as string,
    sequence: row.sequence as number,
    event_type: row.event_type as RunLedgerEvent["event_type"],
    emitted_at: row.emitted_at as string,
    emitted_by: row.emitted_by as RunLedgerEvent["emitted_by"],
    payload: row.payload as RunLedgerEvent["payload"],
  };
}

// ── Migration SQL ───────────────────────────────────────────────────────────

/**
 * Returns the SQL to create the required database tables.
 * Run this via Supabase MCP `apply_migration` or `execute_sql`.
 */
export function getSetupMigrationSQL(schema = "agent_os"): string {
  return `
-- Agent OS Persistence Backend Schema
-- Schema: ${schema}

CREATE SCHEMA IF NOT EXISTS ${schema};

-- Run Ledgers
CREATE TABLE IF NOT EXISTS ${schema}.run_ledgers (
  run_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  plan_snapshot JSONB,
  plan_snapshot_chksum TEXT NOT NULL,
  state TEXT NOT NULL,
  state_entered_at TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  foreman_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  terminal_at TEXT,
  terminal_reason TEXT,
  readiness_verdict JSONB,
  project_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_ledgers_project ON ${schema}.run_ledgers(project_id);
CREATE INDEX IF NOT EXISTS idx_run_ledgers_plan ON ${schema}.run_ledgers(plan_id);

-- Run Ledger Events
CREATE TABLE IF NOT EXISTS ${schema}.run_ledger_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ${schema}.run_ledgers(run_id),
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  emitted_at TEXT NOT NULL,
  emitted_by TEXT NOT NULL,
  payload JSONB,
  project_id TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_run_ledger_events_run ON ${schema}.run_ledger_events(run_id);

-- Episodic Events
CREATE TABLE IF NOT EXISTS ${schema}.episodic_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  run_id TEXT NOT NULL,
  slice_id TEXT,
  agent_role TEXT,
  invocation_seq INTEGER,
  input_hash TEXT,
  output_hash TEXT,
  input_ref TEXT,
  output_ref TEXT,
  stop_triggered BOOLEAN NOT NULL,
  stop_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_episodic_events_project ON ${schema}.episodic_events(project_id);
CREATE INDEX IF NOT EXISTS idx_episodic_events_run ON ${schema}.episodic_events(run_id);

-- Semantic Facts
CREATE TABLE IF NOT EXISTS ${schema}.semantic_facts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  fact_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT,
  confidence DOUBLE PRECISION,
  source_event_id TEXT,
  embedding DOUBLE PRECISION[]
);

CREATE INDEX IF NOT EXISTS idx_semantic_facts_project ON ${schema}.semantic_facts(project_id);

-- Semantic Fact Events
CREATE TABLE IF NOT EXISTS ${schema}.semantic_fact_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  fact_id TEXT NOT NULL,
  new_state TEXT NOT NULL,
  reason TEXT,
  actor TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_fact_events_project ON ${schema}.semantic_fact_events(project_id);

-- Decision Events
CREATE TABLE IF NOT EXISTS ${schema}.decision_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  run_id TEXT,
  decision_type TEXT NOT NULL,
  context_type TEXT NOT NULL,
  authority_class TEXT NOT NULL,
  binding_scope TEXT NOT NULL,
  rationale TEXT NOT NULL,
  outcome TEXT,
  alternatives JSONB
);

CREATE INDEX IF NOT EXISTS idx_decision_events_project ON ${schema}.decision_events(project_id);

-- Tool Invocations
CREATE TABLE IF NOT EXISTS ${schema}.tool_invocations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_hash TEXT,
  output_hash TEXT,
  outcome TEXT NOT NULL,
  duration_ms INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_invocations_project ON ${schema}.tool_invocations(project_id);

-- Embedding Records
CREATE TABLE IF NOT EXISTS ${schema}.embedding_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  fact_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  embedding DOUBLE PRECISION[] NOT NULL,
  dimensions INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embedding_records_project ON ${schema}.embedding_records(project_id);

-- Embedding Status Events
CREATE TABLE IF NOT EXISTS ${schema}.embedding_status_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  fact_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_embedding_status_events_project ON ${schema}.embedding_status_events(project_id);

-- RLS (enable on all tables)
ALTER TABLE ${schema}.run_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.run_ledger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.episodic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.semantic_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.semantic_fact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.decision_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.embedding_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.embedding_status_events ENABLE ROW LEVEL SECURITY;

-- Service role bypass policy (backend uses service role key)
DO $$ BEGIN
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.run_ledgers FOR ALL TO service_role USING (true) WITH CHECK (true)');
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.run_ledger_events FOR ALL TO service_role USING (true) WITH CHECK (true)');
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.episodic_events FOR ALL TO service_role USING (true) WITH CHECK (true)');
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.semantic_facts FOR ALL TO service_role USING (true) WITH CHECK (true)');
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.semantic_fact_events FOR ALL TO service_role USING (true) WITH CHECK (true)');
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.decision_events FOR ALL TO service_role USING (true) WITH CHECK (true)');
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.tool_invocations FOR ALL TO service_role USING (true) WITH CHECK (true)');
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.embedding_records FOR ALL TO service_role USING (true) WITH CHECK (true)');
  EXECUTE format('CREATE POLICY service_role_all ON ${schema}.embedding_status_events FOR ALL TO service_role USING (true) WITH CHECK (true)');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`.trim();
}
