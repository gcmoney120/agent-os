/**
 * Agent OS — K9 Memory Context Injection — Acceptance Tests
 *
 * Slice: K9 — Memory Context Injection
 *
 * Approved K9 acceptance criteria under test:
 *   AC2  — canonical JSON hash is deterministic for identical contexts
 *   AC3  — writeStepReport is NOT called when resolveMemoryContext fails
 *   AC4  — appendEvent emits step.failed (with exact detail) then run.failed on retrieval failure
 *   AC5  — verifyStepStartedEvent permits events with a valid memory_context_hash
 *   AC6  — verifyStepStartedEvent permits events without memory_context_hash
 *   AC7  — verifyStepStartedEvent rejects malformed memory_context_hash values
 *   AC8  — resolveMemoryContext is called exactly once per step, strictly before that step's runner
 *   AC9  — dispatch-context.json artifact contains `memory` field set to the resolved MemoryContext
 *   AC10 — step-started.json artifact contains memory_context_hash as 64-char lowercase hex
 *   AC11 — retrieval failure returns DispatchError code MEMORY_RETRIEVAL_FAILED
 *   AC12 — hash is deterministic: identical contexts always yield the identical hash
 *   AC13 — step.failed event is always emitted before run.failed (ordering invariant)
 *
 * Additional implementation tests (not approved ACs):
 *   IMPL-1 — resolveMemoryContext is present as a required field in DispatchDeps
 *             (compile-time contract; verified by TypeScript, tested here via structural check)
 *
 * Field name ruling (Command, 2026-03-12):
 *   The authoritative K9 invocation field name is `memory`.
 *   It must not be renamed to memory_context.
 *   Tests assert ctx["memory"] to match dispatchRun.ts ~line 418:
 *     const ctx: FrozenStepContext = { ..., memory: resolvedMemory };
 *
 * Uses Node.js native test runner. No real filesystem. No live K7 dependency.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatchRun } from "../dispatchRun.js";
import { verifyStepStartedEvent } from "../verifyStepStarted.js";
import {
  canonicalMemoryContextJson,
  memoryContextHash,
} from "../../memory/memory-context/canonicalize.js";
import type {
  DispatchRequestV1,
  DispatchDeps,
  FrozenStepContext,
  StepRunner,
  RunnerRegistry,
} from "../types.js";
import type { MemoryContext } from "../../memory/memory-context/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal valid MemoryContext for K9 stubs. */
function stubMemoryContext(overrides: Partial<MemoryContext> = {}): MemoryContext {
  return {
    project_id: "test-project",
    run_id: "run-k9",
    assembled_at: "2026-01-01T00:00:00.000Z",
    episodic: [],
    decisions: [],
    semantic: [],
    semantic_mode: "structured_only",
    item_counts: {
      episodic_included: 0,
      episodic_available: 0,
      decision_included: 0,
      decision_available: 0,
      semantic_included: 0,
      semantic_available: 0,
    },
    lane_states: {
      episodic: "empty",
      decision: "empty",
      semantic: "disabled",
    },
    ...overrides,
  };
}

/**
 * A minimal valid StepReport that passes all dispatcher post-validation gates
 * for actor=forge, action=forge.implement (a member of OUTPUT_REQUIRED_ACTIONS).
 */
function validStepReport(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: "1.0",
    run_id: "run-k9",
    step_id: "step-a",
    step_index: 0,
    actor: "forge",
    action: "forge.implement",
    success: true,
    status: "succeeded",
    summary: "done",
    artifacts: {},
    output: { result: "ok" },  // required: forge.implement is in OUTPUT_REQUIRED_ACTIONS
    state_impact: "none",       // governance: always auto_apply
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function stubRunner(report: unknown = validStepReport()): StepRunner {
  return { run: async () => ({ step_report: report }) };
}

function fullRegistry(overrides: Partial<RunnerRegistry> = {}): RunnerRegistry {
  const d = stubRunner();
  return { command: d, atlas: d, forge: d, sentinel: d, compass: d, ...overrides };
}

/** A governance-valid adapter (passes the Slice 4 pre-run gate). */
function validAdapter(): unknown {
  return {
    name: "test-adapter",
    governance: {
      system_state_updates: {
        mode: "hybrid",
        require_manual_approval_for: ["trust_change"],
        auto_apply_for: ["trivial"],
      },
    },
  };
}

/** Single-step DispatchRequest. */
function oneStepRequest(overrides: Partial<DispatchRequestV1> = {}): DispatchRequestV1 {
  return {
    schema_version: "1.0",
    run_id: "run-k9",
    project_root: "/project",
    artifacts_root: "/artifacts",
    steps: [
      {
        step_index: 0,
        step_id: "step-a",
        actor: "forge",
        action: "forge.implement",
        capabilities: [],
      },
    ],
    ...overrides,
  };
}

/** Build DispatchDeps with sensible defaults; all fields overridable. */
function stubDeps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    loadProjectAdapter: async () => ({ ok: true as const, adapter: validAdapter() }),
    validateStepReport: () => ({ ok: true as const }),
    writeStepReport: async ({ artifacts_root, step_index, step_id }) => ({
      ok: true as const,
      path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
    }),
    resolveMemoryContext: async () => ({
      ok: true as const,
      context: stubMemoryContext(),
    }),
    runnerRegistry: fullRegistry(),
    ...overrides,
  };
}

const HEX64_RE = /^[0-9a-f]{64}$/;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("K9 — Memory Context Injection", () => {

  // ── IMPL-1: resolveMemoryContext presence in DispatchDeps ─────────────────
  // Not an approved AC. Structural runtime check that the field is wired through
  // stubDeps; TypeScript enforces it as a required field at compile time.

  it("IMPL-1 — resolveMemoryContext is present in stubDeps and callable", async () => {
    const deps = stubDeps();
    const result = await deps.resolveMemoryContext("run-k9", "/project");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.context.project_id, "string");
    }
  });

  // ── AC2 / AC12: Canonical hash determinism ────────────────────────────────

  it("AC2/AC12 — identical contexts always produce the same 64-char hex hash", () => {
    const a = stubMemoryContext();
    const b = stubMemoryContext();
    const hashA = memoryContextHash(a);
    const hashB = memoryContextHash(b);

    assert.equal(hashA, hashB, "identical contexts must produce identical hash");
    assert.match(hashA, HEX64_RE, "hash must be 64-character lowercase hex");
  });

  it("AC2/AC12 — key insertion order does not affect canonical JSON or hash", () => {
    // Two value-identical MemoryContext objects whose JS property insertion order
    // differs. sortKeysRecursive must normalize both to the same canonical JSON
    // string and therefore the same SHA-256 hash.
    const base = stubMemoryContext({ project_id: "ktest", run_id: "r1" });

    // Object a: natural stubMemoryContext insertion order
    // (project_id, run_id, assembled_at, episodic, decisions, ...)
    const a: MemoryContext = { ...base };

    // Object b: alphabetical insertion order — all values identical to base,
    // only the JS property sequence differs.
    const b: MemoryContext = {
      assembled_at:  base.assembled_at,
      decisions:     base.decisions,
      episodic:      base.episodic,
      item_counts:   base.item_counts,
      lane_states:   base.lane_states,
      project_id:    base.project_id,
      run_id:        base.run_id,
      semantic:      base.semantic,
      semantic_mode: base.semantic_mode,
    };

    assert.equal(
      canonicalMemoryContextJson(a),
      canonicalMemoryContextJson(b),
      "canonical JSON must be identical regardless of key insertion order",
    );
    assert.equal(memoryContextHash(a), memoryContextHash(b));
  });

  // ── AC5 / AC6 / AC7: verifyStepStartedEvent ──────────────────────────────

  it("AC5 — verifier permits events WITH a valid 64-char lowercase hex memory_context_hash", () => {
    // 12 * 5 + 4 = 64 chars, all lowercase hex
    const validHash = "a1b2c3d4e5f6".repeat(5) + "a1b2";
    assert.equal(validHash.length, 64);
    const result = verifyStepStartedEvent({ memory_context_hash: validHash });
    assert.equal(result.ok, true);
  });

  it("AC6 — verifier permits events WITHOUT memory_context_hash (field is optional)", () => {
    const result = verifyStepStartedEvent({});
    assert.equal(result.ok, true);
  });

  it("AC7 — verifier rejects hash shorter than 64 chars", () => {
    const result = verifyStepStartedEvent({ memory_context_hash: "abc123" });
    assert.equal(result.ok, false);
    assert.ok(
      result.error?.includes("64-character"),
      `error message must reference 64-character constraint; got: ${result.error}`,
    );
  });

  it("AC7 — verifier rejects 64-char hash containing uppercase letters", () => {
    const result = verifyStepStartedEvent({ memory_context_hash: "A".repeat(64) });
    assert.equal(result.ok, false);
  });

  it("AC7 — verifier rejects non-string memory_context_hash (number)", () => {
    const result = verifyStepStartedEvent({ memory_context_hash: 12345678 });
    assert.equal(result.ok, false);
  });

  it("AC7 — verifier rejects null as event argument", () => {
    const result = verifyStepStartedEvent(null);
    assert.equal(result.ok, false);
  });

  it("AC7 — verifier rejects 64-char string containing a non-hex character", () => {
    // 63 valid hex chars + one 'g' (outside [0-9a-f])
    const result = verifyStepStartedEvent({ memory_context_hash: "a".repeat(63) + "g" });
    assert.equal(result.ok, false);
  });

  // ── AC11: MEMORY_RETRIEVAL_FAILED error code ──────────────────────────────

  it("AC11 — resolveMemoryContext failure returns MEMORY_RETRIEVAL_FAILED with correct identity fields", async () => {
    const deps = stubDeps({
      resolveMemoryContext: async () => ({
        ok: false as const,
        code: "K7_EPISODIC_LANE_FAILURE" as const,
        message: "episodic lane failed",
      }),
    });

    const result = await dispatchRun(oneStepRequest(), deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code,       "MEMORY_RETRIEVAL_FAILED");
      assert.equal(result.error.step_index, 0);
      assert.equal(result.error.step_id,    "step-a");
      assert.equal(result.error.actor,      "forge");
    }
  });

  // ── AC3: writeStepReport not called on retrieval failure ─────────────────

  it("AC3 — writeStepReport is NOT called when resolveMemoryContext fails before step execution", async () => {
    // The dispatcher gates on resolveMemoryContext (~line 345) and returns early
    // on failure before ever reaching writeStepReport (~line 564).
    let writeStepReportCalls = 0;

    const deps = stubDeps({
      resolveMemoryContext: async () => ({
        ok: false as const,
        code: "K7_DECISION_LANE_FAILURE" as const,
        message: "decision lane down",
      }),
      writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
        writeStepReportCalls++;
        return {
          ok: true as const,
          path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
        };
      },
    });

    const result = await dispatchRun(oneStepRequest(), deps);

    assert.equal(result.ok, false);
    assert.equal(
      writeStepReportCalls,
      0,
      "writeStepReport must not be called when memory retrieval fails before step execution",
    );
  });

  // ── AC4 + AC13: appendEvent ordering and exact detail fields ─────────────

  it("AC4/AC13 — step.failed emitted before run.failed with exact detail fields on retrieval failure", async () => {
    const events: Array<{ type: string; detail: Record<string, unknown> }> = [];

    const deps = stubDeps({
      resolveMemoryContext: async () => ({
        ok: false as const,
        code: "K7_DECISION_LANE_FAILURE" as const,
        message: "decision lane error",
      }),
      appendEvent: async (ev) => { events.push(ev); },
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, false);

    // AC13: exactly two events; step.failed must precede run.failed
    assert.equal(events.length, 2, "exactly two events must be emitted on retrieval failure");
    assert.equal(events[0].type, "step.failed", "first event must be step.failed");
    assert.equal(events[1].type, "run.failed",  "second event must be run.failed");

    // AC4: step.failed detail — all required fields present with correct values
    assert.equal(events[0].detail.step_id,    "step-a",                  "step.failed.detail.step_id");
    assert.equal(events[0].detail.step_index,  0,                         "step.failed.detail.step_index");
    assert.equal(events[0].detail.reason,     "MEMORY_RETRIEVAL_FAILED", "step.failed.detail.reason");
    assert.deepEqual(
      events[0].detail.cause,
      { code: "K7_DECISION_LANE_FAILURE", message: "decision lane error" },
      "step.failed.detail.cause must carry the K7 error code and message",
    );

    // AC4: run.failed detail
    assert.equal(events[1].detail.step_id,    "step-a",                  "run.failed.detail.step_id");
    assert.equal(events[1].detail.step_index,  0,                         "run.failed.detail.step_index");
    assert.equal(events[1].detail.reason,     "MEMORY_RETRIEVAL_FAILED", "run.failed.detail.reason");
  });

  it("AC13 — no appendEvent calls when resolveMemoryContext succeeds", async () => {
    const events: Array<unknown> = [];
    const deps = stubDeps({
      appendEvent: async (ev) => { events.push(ev); },
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);
    assert.equal(events.length, 0, "no events must be emitted on successful dispatch");
  });

  // ── Comprehensive retrieval-failure proof ─────────────────────────────────
  // Proves all locked K9 failure-path invariants atomically:
  //   AC3  — writeStepReport not called
  //   AC4  — appendEvent carries exact detail fields
  //   AC8  — runner not invoked (failure-path branch)
  //   AC9  — dispatch-context.json not written
  //   AC10 — step-started.json not written
  //   AC11 — MEMORY_RETRIEVAL_FAILED error code
  //   AC13 — step.failed before run.failed, exactly

  it("K9 retrieval-failure — complete locked behavior: no executor, no artifacts, correct events", async () => {
    let runnerInvocations = 0;
    let writeStepReportCalls = 0;
    const writtenFiles = new Map<string, unknown>();
    const events: Array<{ type: string; detail: Record<string, unknown> }> = [];

    const spyRunner: StepRunner = {
      run: async (_ctx) => {
        runnerInvocations++;
        return { step_report: validStepReport() };
      },
    };

    const deps = stubDeps({
      resolveMemoryContext: async () => ({
        ok: false as const,
        code: "K7_EPISODIC_LANE_FAILURE" as const,
        message: "lane failure",
      }),
      runnerRegistry: fullRegistry({ forge: spyRunner }),
      writeJsonFile: async (path, value) => { writtenFiles.set(path, value); },
      writeStepReport: async ({ artifacts_root, step_index, step_id }) => {
        writeStepReportCalls++;
        return {
          ok: true as const,
          path: `${artifacts_root}/steps/${step_index}-${step_id}/step-report.json`,
        };
      },
      appendEvent: async (ev) => { events.push(ev); },
    });

    const result = await dispatchRun(oneStepRequest(), deps);

    // AC11: error code
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "MEMORY_RETRIEVAL_FAILED");

    // AC8 (failure-path): no executor invocation
    assert.equal(runnerInvocations, 0,
      "runner must not be invoked when memory retrieval fails");

    // AC10: step-started.json must not be written
    assert.equal(
      writtenFiles.has("/artifacts/steps/0-step-a/step-started.json"),
      false,
      "step-started.json must not be written when retrieval fails",
    );

    // AC9: dispatch-context.json must not be written
    assert.equal(
      writtenFiles.has("/artifacts/steps/0-step-a/dispatch-context.json"),
      false,
      "dispatch-context.json must not be written when retrieval fails",
    );

    // AC3: step-report must not be written
    assert.equal(writeStepReportCalls, 0,
      "writeStepReport must not be called when memory retrieval fails");

    // AC4/AC13: event sequence is exactly [step.failed, run.failed]
    assert.equal(events.length, 2,
      "exactly two events must be emitted on retrieval failure");
    assert.equal(events[0].type, "step.failed", "first event must be step.failed");
    assert.equal(events[1].type, "run.failed",  "second event must be run.failed");
    assert.equal(events[0].detail.reason, "MEMORY_RETRIEVAL_FAILED",
      "step.failed.detail.reason");
    assert.deepEqual(
      events[0].detail.cause,
      { code: "K7_EPISODIC_LANE_FAILURE", message: "lane failure" },
      "step.failed.detail.cause must carry the K7 error code and message",
    );
    assert.equal(events[1].detail.reason, "MEMORY_RETRIEVAL_FAILED",
      "run.failed.detail.reason");
  });

  // ── AC8: per-step ordered trace proof ────────────────────────────────────

  it("AC8 — resolveMemoryContext fires once per step, strictly before that step's runner (3-step ordered trace)", async () => {
    /**
     * For a 3-step run the required trace is:
     *   [0] { event: "resolve", stepIndex: 0 }
     *   [1] { event: "runner",  stepIndex: 0 }
     *   [2] { event: "resolve", stepIndex: 1 }
     *   [3] { event: "runner",  stepIndex: 1 }
     *   [4] { event: "resolve", stepIndex: 2 }
     *   [5] { event: "runner",  stepIndex: 2 }
     *
     * Each pair at positions (2i, 2i+1) proves resolve(N) precedes runner(N)
     * with no cross-step interleave possible.
     */
    type TraceEntry = { event: "resolve" | "runner"; stepIndex: number };
    const stepTrace: TraceEntry[] = [];
    let resolveCallN = 0;  // proxy for step index: resolve is called once per step in order

    const tracingRunner: StepRunner = {
      run: async (ctx: FrozenStepContext) => {
        stepTrace.push({ event: "runner", stepIndex: ctx.step_index });
        return {
          step_report: validStepReport({
            run_id:     "run-k9",
            step_id:    ctx.step_id,
            step_index: ctx.step_index,
          }),
        };
      },
    };

    const deps = stubDeps({
      resolveMemoryContext: async () => {
        stepTrace.push({ event: "resolve", stepIndex: resolveCallN++ });
        return { ok: true as const, context: stubMemoryContext() };
      },
      runnerRegistry: fullRegistry({ forge: tracingRunner }),
    });

    const req: DispatchRequestV1 = {
      schema_version: "1.0",
      run_id: "run-k9",
      project_root: "/project",
      artifacts_root: "/artifacts",
      steps: [
        { step_index: 0, step_id: "step-a", actor: "forge", action: "forge.implement", capabilities: [] },
        { step_index: 1, step_id: "step-b", actor: "forge", action: "forge.implement", capabilities: [] },
        { step_index: 2, step_id: "step-c", actor: "forge", action: "forge.implement", capabilities: [] },
      ],
    };

    const result = await dispatchRun(req, deps);
    assert.equal(
      result.ok,
      true,
      `dispatch must succeed; error: ${!result.ok ? JSON.stringify((result as { error: unknown }).error) : "none"}`,
    );

    // Exact trace length: 3 resolve + 3 runner = 6
    assert.equal(stepTrace.length, 6, "trace must contain exactly 6 entries (3 resolve + 3 runner)");

    // Strict index-bound interleave assertion per step
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(
        stepTrace[i * 2],
        { event: "resolve", stepIndex: i },
        `trace[${i * 2}] must be resolve for step ${i}`,
      );
      assert.deepEqual(
        stepTrace[i * 2 + 1],
        { event: "runner", stepIndex: i },
        `trace[${i * 2 + 1}] must be runner for step ${i}`,
      );
    }
  });

  // ── AC9: dispatch-context.json `memory` field ────────────────────────────
  // Field name ruling (Command, 2026-03-12): field is `memory`.
  // Binding source: dispatchRun.ts ~line 418:
  //   const ctx: FrozenStepContext = { ..., memory: resolvedMemory };

  it("AC9 — dispatch-context.json contains `memory` field set to the resolved MemoryContext", async () => {
    const expectedContext = stubMemoryContext({ project_id: "ac9-project", run_id: "run-k9" });
    const writtenFiles = new Map<string, unknown>();

    const deps = stubDeps({
      resolveMemoryContext: async () => ({ ok: true as const, context: expectedContext }),
      writeJsonFile: async (path, value) => { writtenFiles.set(path, value); },
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);

    // Path formula: `${artifacts_root}/steps/${step_index}-${step_id}/dispatch-context.json`
    const artifactPath = "/artifacts/steps/0-step-a/dispatch-context.json";
    const ctxArtifact = writtenFiles.get(artifactPath);
    assert.ok(ctxArtifact !== undefined, `dispatch-context.json must be written at ${artifactPath}`);

    const ctx = ctxArtifact as Record<string, unknown>;
    assert.ok(
      "memory" in ctx,
      "dispatch-context.json (FrozenStepContext) must contain field `memory`",
    );
    assert.deepEqual(
      ctx["memory"],
      expectedContext,
      "`memory` field must equal the resolved MemoryContext",
    );
  });

  // ── AC10: step-started.json memory_context_hash ──────────────────────────

  it("AC10 — step-started.json contains memory_context_hash as 64-char lowercase hex matching computed hash", async () => {
    const resolvedCtx = stubMemoryContext();
    const expectedHash = memoryContextHash(resolvedCtx);
    const writtenFiles = new Map<string, unknown>();

    const deps = stubDeps({
      resolveMemoryContext: async () => ({ ok: true as const, context: resolvedCtx }),
      writeJsonFile: async (path, value) => { writtenFiles.set(path, value); },
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);

    // Path formula: `${artifacts_root}/steps/${step_index}-${step_id}/step-started.json`
    const artifactPath = "/artifacts/steps/0-step-a/step-started.json";
    const stepStarted = writtenFiles.get(artifactPath);
    assert.ok(stepStarted !== undefined, `step-started.json must be written at ${artifactPath}`);

    const artifact = stepStarted as Record<string, unknown>;
    assert.ok(
      "memory_context_hash" in artifact,
      "step-started.json must contain field `memory_context_hash`",
    );

    const hash = artifact["memory_context_hash"];
    assert.equal(typeof hash, "string", "memory_context_hash must be a string");
    assert.match(hash as string, HEX64_RE, "memory_context_hash must be 64-char lowercase hex");
    assert.equal(
      hash,
      expectedHash,
      "memory_context_hash must equal memoryContextHash(resolvedContext)",
    );
  });

});
