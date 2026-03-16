/**
 * Agent OS — Runtime Integration Layer R2
 * Composition root: buildRuntimeContext + buildDispatchDeps
 *
 * Binding Contract 3: wires existing infrastructure + provider interfaces
 * into a fully composed RuntimeContext and DispatchDeps ready for dispatchRun.
 */

import { join } from "node:path";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";

import { loadProjectAdapter } from "../adapter/loadProjectAdapter.js";
import type { ProjectAdapter } from "../adapter/schema.js";
import { validateStepReportV1 } from "../step-report/validateStepReport.js";
import { assembleMemoryContext } from "../memory/memory-context/assemble.js";
import type { MemoryContextResult } from "../memory/memory-context/types.js";
import type { EpisodicEvent } from "../memory/schemas.js";
import { K1_SCHEMA_VERSION } from "../memory/schemas.js";
import type { RuntimeContext } from "./types.js";
import type { LLMProvider, PersistenceBackend, EmbeddingBackend } from "./providers.js";
import type { DispatchDeps, StepRunner, RunnerRegistry } from "../dispatcher/types.js";
import { InMemoryPersistenceBackend, StubLLMProvider } from "./providers-inmemory.js";
import { constructMemoryBackends, buildMemoryRequest } from "./memory-wiring.js";

// ── step_id path-safety validator ─────────────────────────────────────────────

/**
 * Returns true only when step_id is safe to embed in a filesystem path.
 * Accepts alphanumeric characters, hyphens, and underscores only.
 * Rejects empty strings, dots (path traversal via ".."), slashes, and all
 * other characters that could alter the resolved path.
 */
function isStepIdSafe(step_id: string): boolean {
  return step_id.length > 0 && /^[A-Za-z0-9_-]+$/.test(step_id);
}

// ── ProviderOverrides ─────────────────────────────────────────────────────────

/** Optional provider overrides for buildRuntimeContext. */
export interface ProviderOverrides {
  readonly persistence: PersistenceBackend;
  readonly llm: LLMProvider;
  readonly embedding: EmbeddingBackend | null;
  /**
   * Optional adapter override. When provided, loadProjectAdapter is skipped.
   * Intended for testing — allows injection of a mock adapter without
   * requiring an agent-os.project.json file on disk.
   */
  readonly adapter?: ProjectAdapter;
  /**
   * Optional runner registry override. When provided, replaces the default
   * stub runner registry in buildDispatchDeps.
   * Intended for testing — allows injection of custom runners without
   * requiring the stub runner behaviour.
   */
  readonly runnerRegistry?: import("../dispatcher/types.js").RunnerRegistry;
}

// ── buildRuntimeContext ───────────────────────────────────────────────────────

/**
 * Build a fully wired RuntimeContext from a project root.
 *
 * Loads the ProjectAdapter, then composes providers:
 * - persistence: InMemoryPersistenceBackend (default) or override
 * - llm: StubLLMProvider (default) or override
 * - embedding: null (deferred per R-series decision) or override
 * - memoryBackends: K3ReadBackend wired from persistence.k2Backend()
 *
 * Provider defaults are test-suitable stubs. Pass overrides to inject
 * production or alternate providers without changing caller code.
 */
export function buildRuntimeContext(
  projectRoot: string,
  providers?: Partial<ProviderOverrides>,
): { ok: true; context: RuntimeContext } | { ok: false; code: string; message: string } {
  let adapter: ProjectAdapter;
  if (providers?.adapter !== undefined) {
    // Adapter injected directly — skip file-based load (used for testing).
    adapter = providers.adapter;
  } else {
    const adapterResult = loadProjectAdapter(projectRoot);
    if (!adapterResult.ok) {
      return {
        ok: false,
        code: adapterResult.code,
        message: adapterResult.message,
      };
    }
    adapter = adapterResult.adapter;
  }

  const artifactsRoot = join(projectRoot, adapter.paths.run_root);

  // Persistence
  const persistence: PersistenceBackend =
    providers?.persistence ?? new InMemoryPersistenceBackend();

  // LLM
  const llm: LLMProvider = providers?.llm ?? new StubLLMProvider();

  // Embedding (null = deferred per R-series infrastructure decision)
  const embedding: EmbeddingBackend | null =
    providers?.embedding !== undefined ? providers.embedding : null;

  // Memory backends — K3ReadBackend wired from InMemoryK2Backend
  // When persistence override is supplied but doesn't expose k2Backend(),
  // construct empty memory backends as a safe fallback.
  const k2Backend =
    persistence instanceof InMemoryPersistenceBackend
      ? persistence.k2Backend()
      : null;

  const memoryBackends = k2Backend !== null
    ? constructMemoryBackends(k2Backend)
    : { k3: emptyK3Backend() };

  const context: RuntimeContext = {
    config: {
      projectRoot,
      adapter,
      artifactsRoot,
    },
    persistence,
    llm,
    embedding,
    memoryBackends,
    runnerRegistry: providers?.runnerRegistry,
  };

  return { ok: true, context };
}

// ── buildDispatchDeps ─────────────────────────────────────────────────────────

/**
 * Build a DispatchDeps from a RuntimeContext.
 *
 * Wires all DispatchDeps fields from the resolved context (Binding Contract 3):
 * - loadProjectAdapter: delegates to adapter loader
 * - validateStepReport: delegates to validateStepReportV1
 * - writeStepReport: writes to artifacts_root/steps/<index>-<id>/step-report.json
 * - file IO: node:fs/promises wrappers
 * - resolveMemoryContext: assembleMemoryContext via K7
 * - appendEvent: no-op (K2 write-path ingestion deferred to R3)
 * - runnerRegistry: stub runners (real runners wired in R3)
 */
export function buildDispatchDeps(context: RuntimeContext): DispatchDeps {
  const { config, memoryBackends } = context;

  return {
    // ── Adapter loader ──────────────────────────────────────────────────────
    loadProjectAdapter: async (project_root: string) => {
      const result = loadProjectAdapter(project_root);
      if (result.ok) {
        return { ok: true, adapter: result.adapter };
      }
      return { ok: false, error: new Error(`${result.code}: ${result.message}`) };
    },

    // ── Step report ─────────────────────────────────────────────────────────
    validateStepReport: (step_report: unknown) => {
      const result = validateStepReportV1(step_report);
      if (result.ok) {
        return { ok: true };
      }
      return { ok: false, code: result.code, message: result.message };
    },

    writeStepReport: async ({ artifacts_root, step_index, step_id, step_report }) => {
      // R3-C2: validate step_id before composing filesystem path
      if (!isStepIdSafe(step_id)) {
        return {
          ok: false,
          error: new Error(
            `writeStepReport: step_id "${step_id}" contains characters unsafe for filesystem paths`,
          ),
        };
      }
      const stepDir = join(artifacts_root, "steps", `${step_index}-${step_id}`);
      const filePath = join(stepDir, "step-report.json");
      try {
        await fs.mkdir(stepDir, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(step_report, null, 2) + "\n", "utf8");
        return { ok: true, path: filePath };
      } catch (err) {
        return { ok: false, error: err };
      }
    },

    // ── File IO ─────────────────────────────────────────────────────────────
    writeTextFile: async (path: string, contents: string) => {
      await fs.writeFile(path, contents, "utf8");
    },

    writeJsonFile: async (path: string, value: unknown) => {
      await fs.writeFile(path, JSON.stringify(value, null, 2), "utf8");
    },

    ensureDir: async (path: string) => {
      await fs.mkdir(path, { recursive: true });
    },

    readFile: async (path: string) => {
      return fs.readFile(path, "utf8");
    },

    fileExists: async (path: string) => {
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },

    sha256File: async (path: string) => {
      const bytes = await fs.readFile(path);
      return createHash("sha256").update(bytes).digest("hex");
    },

    // ── Memory context (K7) ─────────────────────────────────────────────────
    resolveMemoryContext: async (runId: string, projectRoot: string): Promise<MemoryContextResult> => {
      const request = buildMemoryRequest(runId, projectRoot);
      return assembleMemoryContext(memoryBackends, request);
    },

    // ── Event append (R3-C3: persisted to K1 MemoryStore) ───────────────────
    appendEvent: async (event) => {
      // Persist dispatcher trace events (memory-retrieval failures, etc.)
      // to the K1 MemoryStore as episodic events.
      // Fields drawn from event.detail where available; fallback to "unknown".
      const runId =
        typeof event.detail.run_id === "string" ? event.detail.run_id : "unknown";
      const record: EpisodicEvent = {
        id: `dispatcher_${event.type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        project_id: config.projectRoot,
        schema_version: K1_SCHEMA_VERSION,
        created_at: new Date(),
        run_id: runId,
        stop_triggered: event.type === "run.failed",
        stop_reason: event.type === "run.failed" ? "memory_retrieval_failed" : undefined,
      };
      context.persistence.memoryStore().appendEpisodicEvent(record);
    },

    // ── Runner registry ──────────────────────────────────────────────────────
    // Use injected registry if present (testing), otherwise use stub runners.
    runnerRegistry: context.runnerRegistry ?? buildStubRunnerRegistry(config.artifactsRoot),
  };
}

// ── Stub runner registry ──────────────────────────────────────────────────────

/**
 * Build a stub RunnerRegistry with a no-op runner for every actor.
 *
 * Stub runners return no step_report (undefined). The dispatcher will
 * raise DISPATCH_STEP_REPORT_MISSING for steps that require a report.
 * Real runners are wired in R3 via LLMProvider.
 */
function buildStubRunnerRegistry(_artifactsRoot: string): RunnerRegistry {
  const stubRunner: StepRunner = {
    async run(_ctx) {
      // Stub: returns no step_report.
      // R3 will replace this with an LLM-backed runner.
      return { step_report: undefined };
    },
  };

  return {
    command: stubRunner,
    atlas: stubRunner,
    forge: stubRunner,
    sentinel: stubRunner,
    compass: stubRunner,
  };
}

// ── Empty K3 backend (fallback) ───────────────────────────────────────────────

/** Empty K3ReadBackend used when no K2 backend is available. */
function emptyK3Backend() {
  return {
    allEpisodicEvents: () => [] as never[],
    allDecisionEvents: () => [] as never[],
    allSemanticFacts: () => [] as never[],
    allSemanticFactEvents: () => [] as never[],
    allEmbeddingRecords: () => [] as never[],
    allEmbeddingStatusEvents: () => [] as never[],
  };
}
