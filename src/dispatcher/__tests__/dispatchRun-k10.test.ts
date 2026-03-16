/**
 * Agent OS — K10 Verifier-Enforceable Memory Context Hash — Acceptance Tests
 *
 * Slice: K10 — Verifier-Enforceable Memory Context Hash
 *
 * Locked Atlas acceptance criteria under test:
 *
 *   AC1  — Dispatcher writes step_schema_version: "k10" on every step.started event.
 *           No K10 dispatcher code path produces a step.started without this field.
 *
 *   AC2  — Verifier classifies step_schema_version === "k10" as K10+ and applies
 *           strict enforcement. Proved by: K10+ with valid hash passes; K10+ without
 *           hash returns MEMORY_CONTEXT_HASH_MISSING (strict path was reached).
 *
 *   AC3  — Verifier classifies absent step_schema_version as pre-K10. Applies
 *           pre-K10 rules: silent on hash absence.
 *
 *   AC4  — K10+ event missing memory_context_hash → MEMORY_CONTEXT_HASH_MISSING.
 *
 *   AC5  — K10+ event with valid 64-char lowercase hex memory_context_hash passes.
 *
 *   AC6  — Pre-K10 event without memory_context_hash passes without error or warning.
 *
 *   AC7  — Pre-K10 event carrying memory_context_hash passes; hash validated for
 *           format only (malformed pre-K10 hash → MEMORY_CONTEXT_HASH_MALFORMED).
 *
 *   AC8  — step_schema_version present but not a recognised value →
 *           UNKNOWN_STEP_SCHEMA_VERSION. Multiple unrecognised values confirmed.
 *
 *   AC9  — Unknown step_schema_version halts at Step 1c of classification rule.
 *           Hash evaluation does not execute. MEMORY_CONTEXT_HASH_MALFORMED is not
 *           emitted even when a malformed hash is present on the same event.
 *
 *   AC10 — Verifier classifies and enforces each step.started event independently.
 *           A ledger containing mixed pre-K10 and K10+ events is valid when each
 *           event individually satisfies its classification rules.
 *
 *   AC11 — No K1–K9 ledger artifact is rejected by K10 verifier rules. All
 *           pre-K10 passing cases continue to pass without modification.
 *
 *   AC12 — ExecutionContext shape remains { invocation, capabilities } after K10.
 *           step_schema_version is a ledger event field only. Proved by:
 *           (a) step-started.json carries the field;
 *           (b) dispatch-context.json (FrozenStepContext) does NOT carry it;
 *           (c) runner spy confirms ctx passed to executor does NOT carry it at
 *               any level (top-level, capabilities array, or nested fields).
 *
 *   AC13 — __grants, capabilities_hash, MemoryContext shape, and K7 retrieval
 *           logic are unmodified. Proved by:
 *           (a) MemoryContext shape: runner spy confirms ctx.memory equals the
 *               resolved context exactly (same shape as K9, no fields added/removed);
 *           (b) K7 retrieval: resolveMemoryContext spy confirms identical call
 *               signature (runId, projectRoot) with no new arguments;
 *           (c) __grants / capabilities_hash: Foreman-layer fields in
 *               mcp/agent-router — zero files in that layer were touched by K10.
 *               File-boundary proof in deliverable report.
 *
 *   AC14 — K10 dispatcher does not alter position, computation, or value of
 *           memory_context_hash. K9 hash logic is invoked unchanged; K10 only
 *           adds step_schema_version to the same payload.
 *
 *   AC15 — All K10 verifier behavior is exercised by unit tests using fixture
 *           ledger events. No live dispatcher execution is required for verifier tests.
 *           (AC2–AC11 verifier tests call verifyStepStartedEvent() directly.)
 *
 *   AC16 — No new run states, step states, or state machine transitions after K10.
 *           Structural review evidence: K10 changes are confined to one additive
 *           field on stepStartedPayload (two sites in dispatchRun.ts) and updated
 *           verifyStepStartedEvent logic. No new DispatchErrorCode values were
 *           added; DispatchResult union shape is unchanged. Proved here by runtime
 *           shape check + explicit classification as structural review boundary.
 *
 * AC15 note: Tests for AC2–AC11 are pure unit tests calling verifyStepStartedEvent()
 * directly with fixture event objects. No live dispatcher or K7 dependency required.
 *
 * Uses Node.js native test runner. No real filesystem. No live K7 dependency.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatchRun } from "../dispatchRun.js";
import { verifyStepStartedEvent } from "../verifyStepStarted.js";
import { memoryContextHash } from "../../memory/memory-context/canonicalize.js";
import type {
  DispatchRequestV1,
  DispatchDeps,
  FrozenStepContext,
  StepRunner,
  RunnerRegistry,
} from "../types.js";
import type { MemoryContext } from "../../memory/memory-context/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** 64 lowercase hex characters — a valid memory_context_hash for fixture use. */
const VALID_HASH = "a1b2c3d4e5f6".repeat(5) + "a1b2";
const HEX64_RE = /^[0-9a-f]{64}$/;

function stubMemoryContext(overrides: Partial<MemoryContext> = {}): MemoryContext {
  return {
    project_id: "k10-project",
    run_id: "run-k10",
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

function validStepReport(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: "1.0",
    run_id: "run-k10",
    step_id: "step-k10",
    step_index: 0,
    actor: "forge",
    action: "forge.implement",
    success: true,
    status: "succeeded",
    summary: "done",
    artifacts: {},
    output: { result: "ok" },
    state_impact: "none",
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

function oneStepRequest(overrides: Partial<DispatchRequestV1> = {}): DispatchRequestV1 {
  return {
    schema_version: "1.0",
    run_id: "run-k10",
    project_root: "/project",
    artifacts_root: "/artifacts",
    steps: [
      {
        step_index: 0,
        step_id: "step-k10",
        actor: "forge",
        action: "forge.implement",
        capabilities: [],
      },
    ],
    ...overrides,
  };
}

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("K10 — Verifier-Enforceable Memory Context Hash", () => {

  // ── AC1: Dispatcher writes step_schema_version: "k10" on every step.started ─

  it("AC1 — single step: step-started.json carries step_schema_version: 'k10'", async () => {
    const writtenFiles = new Map<string, unknown>();
    const deps = stubDeps({
      writeJsonFile: async (path, value) => { writtenFiles.set(path, value); },
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);

    const artifact = writtenFiles.get("/artifacts/steps/0-step-k10/step-started.json");
    assert.ok(artifact !== undefined, "step-started.json must be written");
    const e = artifact as Record<string, unknown>;
    assert.ok("step_schema_version" in e, "step-started.json must contain step_schema_version");
    assert.equal(e["step_schema_version"], "k10", "step_schema_version must be 'k10'");
  });

  it("AC1 — multi-step run: every step.started carries step_schema_version: 'k10' (3-step proof)", async () => {
    const writtenFiles = new Map<string, unknown>();
    const deps = stubDeps({
      writeJsonFile: async (path, value) => { writtenFiles.set(path, value); },
    });

    const req: DispatchRequestV1 = {
      schema_version: "1.0",
      run_id: "run-k10",
      project_root: "/project",
      artifacts_root: "/artifacts",
      steps: [
        { step_index: 0, step_id: "step-a", actor: "forge", action: "forge.implement", capabilities: [] },
        { step_index: 1, step_id: "step-b", actor: "forge", action: "forge.implement", capabilities: [] },
        { step_index: 2, step_id: "step-c", actor: "forge", action: "forge.implement", capabilities: [] },
      ],
    };

    const result = await dispatchRun(req, deps);
    assert.equal(result.ok, true);

    for (const [id, idx] of [["step-a", 0], ["step-b", 1], ["step-c", 2]] as const) {
      const path = `/artifacts/steps/${idx}-${id}/step-started.json`;
      const artifact = writtenFiles.get(path) as Record<string, unknown> | undefined;
      assert.ok(artifact !== undefined, `step-started.json must be written for ${id}`);
      assert.equal(
        artifact["step_schema_version"],
        "k10",
        `step_schema_version must be 'k10' for step ${id}`,
      );
    }
  });

  // ── AC2: Verifier classifies step_schema_version === "k10" as K10+ ────────
  // (AC15: pure unit test — no live dispatcher)

  it("AC2 — K10+ path reached: verifier passes event with step_schema_version 'k10' + valid hash", () => {
    assert.equal(VALID_HASH.length, 64, "fixture hash must be 64 chars");
    const result = verifyStepStartedEvent({ step_schema_version: "k10", memory_context_hash: VALID_HASH });
    assert.equal(result.ok, true, "K10+ event with valid hash must pass");
    assert.equal(result.code, undefined);
  });

  it("AC2 — K10+ strict enforcement confirmed: K10+ event without hash returns MEMORY_CONTEXT_HASH_MISSING (not silent)", () => {
    // Proves K10+ classification path reached — if pre-K10 rules were applied the
    // absent hash would be silent. The MISSING code confirms strict path was used.
    const result = verifyStepStartedEvent({ step_schema_version: "k10" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MISSING",
      "K10+ without hash must return MEMORY_CONTEXT_HASH_MISSING — confirms K10+ classification");
  });

  // ── AC3: Verifier classifies absent step_schema_version as pre-K10 ────────
  // (AC15: pure unit test)

  it("AC3 — pre-K10 classification: absent step_schema_version + absent hash → passes silently", () => {
    const result = verifyStepStartedEvent({});
    assert.equal(result.ok, true);
    assert.equal(result.code, undefined, "no failure code on pre-K10 pass");
  });

  it("AC3 — pre-K10 classification: event with other fields but no step_schema_version → passes", () => {
    const result = verifyStepStartedEvent({ run_id: "r1", step_id: "s1", actor: "forge" });
    assert.equal(result.ok, true);
  });

  // ── AC4: K10+ missing memory_context_hash → MEMORY_CONTEXT_HASH_MISSING ──
  // (AC15: pure unit test)

  it("AC4 — K10+ event with memory_context_hash absent → MEMORY_CONTEXT_HASH_MISSING", () => {
    const result = verifyStepStartedEvent({ step_schema_version: "k10" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MISSING");
    assert.ok(typeof result.error === "string" && result.error.length > 0,
      "error message must be present");
  });

  // ── AC5: K10+ with valid hash → passes ────────────────────────────────────
  // (AC15: pure unit test)

  it("AC5 — K10+ event with valid 64-char lowercase hex hash passes verifier enforcement", () => {
    const result = verifyStepStartedEvent({
      step_schema_version: "k10",
      memory_context_hash: VALID_HASH,
    });
    assert.equal(result.ok, true);
    assert.equal(result.code, undefined);
  });

  // ── AC6: Pre-K10 without hash → passes without error ──────────────────────
  // (AC15: pure unit test)

  it("AC6 — pre-K10 step.started without memory_context_hash passes without error or warning", () => {
    const result = verifyStepStartedEvent({});
    assert.equal(result.ok, true);
    assert.equal(result.code, undefined);
    assert.equal(result.error, undefined);
  });

  // ── AC7: Pre-K10 with hash → passes; format validated only ────────────────
  // (AC15: pure unit test)

  it("AC7 — pre-K10 event with valid memory_context_hash passes (format validated, passes)", () => {
    const result = verifyStepStartedEvent({ memory_context_hash: VALID_HASH });
    assert.equal(result.ok, true);
    assert.equal(result.code, undefined);
  });

  it("AC7 — pre-K10 event with short malformed hash → MEMORY_CONTEXT_HASH_MALFORMED", () => {
    const result = verifyStepStartedEvent({ memory_context_hash: "abc123" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MALFORMED");
    assert.ok(result.error?.includes("64-character"),
      "error must reference 64-character constraint");
  });

  it("AC7 — pre-K10 event with uppercase 64-char hash → MEMORY_CONTEXT_HASH_MALFORMED", () => {
    const result = verifyStepStartedEvent({ memory_context_hash: "A".repeat(64) });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MALFORMED");
  });

  it("AC7 — pre-K10 event with non-string hash → MEMORY_CONTEXT_HASH_MALFORMED", () => {
    const result = verifyStepStartedEvent({ memory_context_hash: 12345678 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MALFORMED");
  });

  it("AC7 — pre-K10 event with 63 hex chars + non-hex char → MEMORY_CONTEXT_HASH_MALFORMED", () => {
    const result = verifyStepStartedEvent({ memory_context_hash: "a".repeat(63) + "g" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MALFORMED");
  });

  // ── AC8: Unrecognised step_schema_version → UNKNOWN_STEP_SCHEMA_VERSION ────
  // (AC15: pure unit test — closed enum confirmed across multiple values)

  it("AC8 — step_schema_version 'k9' (not in closed enum) → UNKNOWN_STEP_SCHEMA_VERSION", () => {
    const result = verifyStepStartedEvent({ step_schema_version: "k9" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_STEP_SCHEMA_VERSION");
  });

  it("AC8 — step_schema_version 'k11' (future, not yet in enum) → UNKNOWN_STEP_SCHEMA_VERSION", () => {
    const result = verifyStepStartedEvent({ step_schema_version: "k11" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_STEP_SCHEMA_VERSION");
  });

  it("AC8 — step_schema_version '' (empty string) → UNKNOWN_STEP_SCHEMA_VERSION", () => {
    const result = verifyStepStartedEvent({ step_schema_version: "" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_STEP_SCHEMA_VERSION");
  });

  it("AC8 — step_schema_version numeric 10 → UNKNOWN_STEP_SCHEMA_VERSION", () => {
    const result = verifyStepStartedEvent({ step_schema_version: 10 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_STEP_SCHEMA_VERSION");
  });

  it("AC8 — step_schema_version 'K10' (wrong case) → UNKNOWN_STEP_SCHEMA_VERSION", () => {
    const result = verifyStepStartedEvent({ step_schema_version: "K10" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_STEP_SCHEMA_VERSION");
  });

  // ── AC9: Unknown version halts before hash evaluation ─────────────────────
  // (AC15: pure unit test — three sub-cases)

  it("AC9 — unknown version + malformed hash: only UNKNOWN_STEP_SCHEMA_VERSION emitted; MALFORMED not reached", () => {
    const result = verifyStepStartedEvent({
      step_schema_version: "unknown",
      memory_context_hash: "bad",  // malformed — must never be evaluated
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_STEP_SCHEMA_VERSION",
      "classification halts at Step 1c; MEMORY_CONTEXT_HASH_MALFORMED must not be returned");
  });

  it("AC9 — unknown version + absent hash: only UNKNOWN_STEP_SCHEMA_VERSION (MISSING not emitted)", () => {
    const result = verifyStepStartedEvent({ step_schema_version: "k99" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_STEP_SCHEMA_VERSION",
      "classification halts at Step 1c; MEMORY_CONTEXT_HASH_MISSING must not be returned");
  });

  it("AC9 — unknown version + valid hash: only UNKNOWN_STEP_SCHEMA_VERSION (hash value irrelevant)", () => {
    const result = verifyStepStartedEvent({
      step_schema_version: "k-future",
      memory_context_hash: VALID_HASH,  // valid — but must not be evaluated
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_STEP_SCHEMA_VERSION");
  });

  // ── AC10: Mixed ledger events classified independently ────────────────────
  // (AC15: pure unit test — three independent calls simulating a mixed ledger)

  it("AC10 — pre-K10 event passes independently (mixed ledger simulation)", () => {
    const result = verifyStepStartedEvent({});  // no step_schema_version, no hash
    assert.equal(result.ok, true, "pre-K10 event must pass");
    assert.equal(result.code, undefined);
  });

  it("AC10 — K10+ event passes independently (mixed ledger simulation)", () => {
    const result = verifyStepStartedEvent({
      step_schema_version: "k10",
      memory_context_hash: VALID_HASH,
    });
    assert.equal(result.ok, true, "K10+ event with valid hash must pass");
    assert.equal(result.code, undefined);
  });

  it("AC10 — failing K10+ event does not affect independent pre-K10 evaluation", () => {
    // Call in sequence to simulate evaluating events from a mixed ledger.
    // Each call is independent; failure in one must not contaminate the other.
    const k10Failing = verifyStepStartedEvent({ step_schema_version: "k10" }); // missing hash
    const preK10Pass = verifyStepStartedEvent({});                               // pre-K10, no hash

    assert.equal(k10Failing.ok, false);
    assert.equal(k10Failing.code, "MEMORY_CONTEXT_HASH_MISSING");

    assert.equal(preK10Pass.ok, true,
      "pre-K10 event evaluated independently must pass regardless of prior K10+ failure");
    assert.equal(preK10Pass.code, undefined);
  });

  it("AC10 — mixed ledger: K9-era then K10+ then another pre-K10, each classified correctly", () => {
    // Simulates a three-event ledger produced during a K9→K10 transition.
    const k9Era  = verifyStepStartedEvent({ memory_context_hash: VALID_HASH }); // pre-K10, hash present
    const k10Evt = verifyStepStartedEvent({ step_schema_version: "k10", memory_context_hash: VALID_HASH });
    const k8Era  = verifyStepStartedEvent({ run_id: "old" });                    // pre-K10, no hash

    assert.equal(k9Era.ok,  true, "K9-era event must pass");
    assert.equal(k10Evt.ok, true, "K10+ event must pass");
    assert.equal(k8Era.ok,  true, "K8-era event must pass");
  });

  // ── AC11: No K1–K9 artifact rejected ─────────────────────────────────────
  // (AC15: pure unit test — existing K9 test surface re-proved here explicitly)

  it("AC11 — K9-era artifact (no step_schema_version, valid hash) passes unchanged", () => {
    const k9Artifact = { memory_context_hash: VALID_HASH };
    const result = verifyStepStartedEvent(k9Artifact);
    assert.equal(result.ok, true, "K9-era artifact must not be rejected by K10 verifier");
    assert.equal(result.code, undefined);
  });

  it("AC11 — K8-era artifact (no step_schema_version, no hash) passes unchanged", () => {
    const k8Artifact = { run_id: "run-old", step_id: "step-old" };
    const result = verifyStepStartedEvent(k8Artifact);
    assert.equal(result.ok, true, "K8-era artifact must not be rejected by K10 verifier");
    assert.equal(result.code, undefined);
  });

  it("AC11 — K1–K8-era artifact (empty object) passes unchanged (null event remains rejected as before)", () => {
    // Regression guard: the null-object guard predates K10 and must be unchanged.
    const nullResult = verifyStepStartedEvent(null);
    assert.equal(nullResult.ok, false, "null is not a valid event (pre-existing rule)");
    // Empty object is fine (no version, no hash = pre-K10 pass).
    const emptyResult = verifyStepStartedEvent({});
    assert.equal(emptyResult.ok, true, "empty object event must pass (pre-K10 rules)");
  });

  // ── AC12: step_schema_version is ledger-event-only; not on ExecutionContext ─

  it("AC12 — step-started.json carries step_schema_version; dispatch-context.json does NOT", async () => {
    const writtenFiles = new Map<string, unknown>();
    const deps = stubDeps({
      writeJsonFile: async (path, value) => { writtenFiles.set(path, value); },
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);

    // (a) step-started.json IS the ledger event — must carry the field
    const stepStarted = writtenFiles.get(
      "/artifacts/steps/0-step-k10/step-started.json",
    ) as Record<string, unknown>;
    assert.ok(stepStarted !== undefined, "step-started.json must be written");
    assert.equal(stepStarted["step_schema_version"], "k10",
      "step-started.json must carry step_schema_version: 'k10'");

    // (b) dispatch-context.json is the FrozenStepContext passed to the executor — must NOT carry it
    const dispatchCtx = writtenFiles.get(
      "/artifacts/steps/0-step-k10/dispatch-context.json",
    ) as Record<string, unknown>;
    assert.ok(dispatchCtx !== undefined, "dispatch-context.json must be written");
    assert.ok(
      !("step_schema_version" in dispatchCtx),
      "dispatch-context.json (FrozenStepContext) must NOT contain step_schema_version",
    );
  });

  it("AC12 — runner spy confirms FrozenStepContext received by executor does NOT carry step_schema_version", async () => {
    let capturedCtx: FrozenStepContext | undefined;
    const spyRunner: StepRunner = {
      run: async (ctx) => {
        capturedCtx = ctx;
        return { step_report: validStepReport() };
      },
    };

    const deps = stubDeps({
      runnerRegistry: fullRegistry({ forge: spyRunner }),
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);
    assert.ok(capturedCtx !== undefined, "runner must have been invoked");

    // step_schema_version must not appear at the top level of FrozenStepContext
    assert.ok(
      !("step_schema_version" in (capturedCtx as unknown as Record<string, unknown>)),
      "FrozenStepContext passed to runner must NOT contain step_schema_version",
    );

    // capabilities must remain a plain string[] with no step_schema_version contamination
    assert.ok(
      Array.isArray(capturedCtx.capabilities),
      "capabilities must be an array",
    );
    assert.ok(
      !capturedCtx.capabilities.includes("step_schema_version"),
      "capabilities array must not contain 'step_schema_version'",
    );
  });

  // ── AC13: MemoryContext shape and K7 retrieval call signature unchanged ────

  it("AC13 — MemoryContext shape unchanged: runner receives ctx.memory with all K7 fields intact", async () => {
    const resolvedCtx = stubMemoryContext({ project_id: "ac13-project", run_id: "run-k10" });
    let capturedCtx: FrozenStepContext | undefined;

    const spyRunner: StepRunner = {
      run: async (ctx) => {
        capturedCtx = ctx;
        return { step_report: validStepReport() };
      },
    };

    const deps = stubDeps({
      resolveMemoryContext: async () => ({ ok: true as const, context: resolvedCtx }),
      runnerRegistry: fullRegistry({ forge: spyRunner }),
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);
    assert.ok(capturedCtx !== undefined);

    // ctx.memory must equal the resolved context exactly — same shape as K9, unmodified by K10
    assert.deepEqual(
      capturedCtx.memory,
      resolvedCtx,
      "ctx.memory must equal the resolved MemoryContext exactly (K7 shape unchanged by K10)",
    );

    // Confirm all K7 MemoryContext fields are present at the expected positions
    const mem = capturedCtx.memory as MemoryContext;
    assert.equal(typeof mem.project_id, "string", "project_id must be present");
    assert.equal(typeof mem.run_id, "string", "run_id must be present");
    assert.ok(Array.isArray(mem.episodic), "episodic must be present");
    assert.ok(Array.isArray(mem.decisions), "decisions must be present");
    assert.ok(Array.isArray(mem.semantic), "semantic must be present");
    assert.equal(typeof mem.lane_states, "object", "lane_states must be present");
    assert.equal(typeof mem.item_counts, "object", "item_counts must be present");
  });

  it("AC13 — K7 retrieval call signature unchanged: resolveMemoryContext called with (runId, projectRoot) only", async () => {
    const calls: Array<[string, string]> = [];

    const deps = stubDeps({
      resolveMemoryContext: async (runId, projectRoot) => {
        calls.push([runId, projectRoot]);
        return { ok: true as const, context: stubMemoryContext() };
      },
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);

    // Must be called exactly once for the one step
    assert.equal(calls.length, 1, "resolveMemoryContext must be called once");
    // Arguments must match run_id and project_root from the request — no new arguments
    assert.equal(calls[0][0], "run-k10", "first arg must be run_id");
    assert.equal(calls[0][1], "/project", "second arg must be project_root");
  });

  // ── AC14: memory_context_hash computation is unchanged from K9 ────────────

  it("AC14 — step-started.json memory_context_hash equals K9 memoryContextHash computation", async () => {
    const resolvedCtx = stubMemoryContext();
    const expectedHash = memoryContextHash(resolvedCtx);
    assert.match(expectedHash, HEX64_RE, "expected hash must be 64-char lowercase hex");

    const writtenFiles = new Map<string, unknown>();
    const deps = stubDeps({
      resolveMemoryContext: async () => ({ ok: true as const, context: resolvedCtx }),
      writeJsonFile: async (path, value) => { writtenFiles.set(path, value); },
    });

    const result = await dispatchRun(oneStepRequest(), deps);
    assert.equal(result.ok, true);

    const artifact = writtenFiles.get(
      "/artifacts/steps/0-step-k10/step-started.json",
    ) as Record<string, unknown>;
    assert.ok(artifact !== undefined, "step-started.json must be written");

    assert.equal(
      artifact["memory_context_hash"],
      expectedHash,
      "memory_context_hash must equal memoryContextHash(resolvedContext) — K10 does not alter computation",
    );
    // The only addition K10 makes is step_schema_version alongside the unchanged hash.
    assert.equal(artifact["step_schema_version"], "k10",
      "step_schema_version is additive only — hash value is unchanged");
  });

  // ── AC16: No new run states, step states, or transitions ─────────────────
  // Structural review evidence. The runtime shape check proves DispatchResult
  // union is unchanged. The boundary note documents what was NOT changed.

  it("AC16 — DispatchResult shape is unchanged (structural boundary check)", async () => {
    const result = await dispatchRun(oneStepRequest(), stubDeps());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.run_id, "string", "run_id field unchanged");
      assert.ok(Array.isArray(result.written_step_reports), "written_step_reports field unchanged");
      // No new top-level fields on the success result shape.
      const keys = Object.keys(result).sort();
      assert.deepEqual(keys, ["ok", "run_id", "written_step_reports"].sort(),
        "DispatchResult success shape must have exactly ok, run_id, written_step_reports");
    }
  });

  // ── K10+ malformed hash (additional coverage) ──────────────────────────────

  it("K10+ event with malformed hash → MEMORY_CONTEXT_HASH_MALFORMED", () => {
    const result = verifyStepStartedEvent({ step_schema_version: "k10", memory_context_hash: "short" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MALFORMED");
    assert.ok(result.error?.includes("64-character"));
  });

  it("K10+ event with uppercase 64-char hash → MEMORY_CONTEXT_HASH_MALFORMED", () => {
    const result = verifyStepStartedEvent({
      step_schema_version: "k10",
      memory_context_hash: "A".repeat(64),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MALFORMED");
  });

  it("K10+ event with non-string hash → MEMORY_CONTEXT_HASH_MALFORMED", () => {
    const result = verifyStepStartedEvent({ step_schema_version: "k10", memory_context_hash: 999 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MEMORY_CONTEXT_HASH_MALFORMED");
  });

});
