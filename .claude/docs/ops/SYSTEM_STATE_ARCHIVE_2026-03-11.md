# SYSTEM STATE

## What exists right now
- Slice 1 (Auth + Identity foundation) implemented: register, email verify, phone OTP, profile setup, /api/user/me verificationTier
- Append-only AUDIT_EVENT implemented (no update/delete; invalidation uses AUDIT_EVENT_INVALIDATED)
- Onboarding gate implemented behind env flag ENABLE_ONBOARDING_GATE (safe for existing users via onboardingRequired default false)
- Required onboarding pages added: /auth/verify-email, /auth/verify-email-pending, /auth/verify-phone, /profile/setup
- Local dev now requires DATABASE_URL (+ DIRECT_URL) for Prisma; Docker Postgres configured for pestfree_dev
- **Agent OS K1 — Memory Engine Foundation implemented (TypeScript layer complete; SQL migration blocked pending spec revision — see Open Escalations below)**
  - `agent-os/src/memory/`: enums.ts, schemas.ts, store.ts, write.ts, retrieval.ts, index.ts
  - `agent-os/__tests__/memory.test.ts`: full enforcement-point coverage
  - SQL migration deferred: spec §4.1–4.6 DDL blocks must be revised to include project_id and schema_version columns before migration can be written


## What we are building next
- Finish Slice 1 hardening: fix signup UI to use the new /api/auth/register flow and resolve remaining 500s; then confirm full end-to-end onboarding works locally and on Vercel
- Agent OS: Atlas to revise Memory Engine Architecture Spec v1.1 §4.1–4.6 DDL blocks to include project_id and schema_version columns; Command to approve; Forge to write migration_k1.sql


## Weak spots / risks
- Local preview depends on correct env vars + Prisma migrate; missing DIRECT_URL blocks migrations
- Risk of legacy signup path (/api/auth/register old handler) diverging from Slice 1 register route
- Production/Vercel rollout must keep ENABLE_ONBOARDING_GATE controlled to avoid accidental lockouts


## Last deployed change
- Slice 1 Auth + Identity foundation merged + onboarding gate behind flag — 2026-02-23
- Slice 1a Email Verification Hardening implemented, validated (Compass PASS), and merged to main @ db90974 — 2026-02-24
- Slice E1 Hunter Reliability Metrics Foundation merged to main @ 7a00e91 — 2026-03-09
- Slice E2 No-Show Detection merged to main @ 939e987 — 2026-03-09
- Agent OS K1 Memory Engine Foundation — TypeScript layer committed — 2026-03-11 (migration blocked; see Open Escalations)

## Locked Decisions — 2026-02-24

### Slice 1a — Email Verification Hardening (Architecture Locked)

Source: Atlas — Email Verification Hardening

- Token stored hashed at rest (SHA-256). Raw token never stored.
- Token expiry: 24 hours (exclusive).
- Single-use enforced via atomic conditional update setting used_at.
- Resend invalidates prior open tokens via invalidated_at.
- User states: UNVERIFIED → VERIFIED only. Login blocked until VERIFIED.
- Audit events are append-only; application role has INSERT only (no UPDATE/DELETE).
- Rate limits expected: 3 resends per user per hour; 10 failed verifications per IP per 15 minutes.

---

## 2026-02-24 — Enterprise Orchestration Foundation (Phase A Complete)

### Architectural Decision
PestFree NZ is transitioning to a deterministic Foreman + MCP orchestration model.

This establishes an enterprise-grade execution layer to control all AI agents in a structured, auditable, and enforceable manner.

### Execution Model
Full-Claude architecture adopted.

Agent roles are governed by:
- AGENTS.md (global governance contract)
- FORGE_BOOT.md
- SENTINEL_BOOT.md
- COMPASS_BOOT.md

Claude agents operate under explicit Allowed / Forbidden / Stop Conditions.

Trust Engine protection remains non-negotiable.

### Orchestration Infrastructure
MCP agent-router subproject added:

mcp/agent-router/

Purpose:
- Structured agent routing
- Deterministic execution sequencing
- Future run_id enforcement
- JSON schema validation
- Append-only logging
- Stop-condition enforcement

### Repository Structure Improvements
Orchestration documents relocated to:

.claude/docs/orchestration/

Operational state remains in:

.claude/docs/ops/

Clear separation established between:
- Live operational state
- Infrastructure design documentation

### Phase A Status
Enterprise orchestration foundation is structurally complete.

No runtime Foreman loop implemented yet.
Next phase: Minimal deterministic Foreman execution loop.

Trust > Speed.

---

## 2026-02-24 — Foreman Phase B v1 Complete (Run Initialization)

### Goal
Implement the minimal deterministic Foreman run initializer.

### Implemented
- Foreman v1 scaffold under: `mcp/agent-router/src/foreman/`
- `run.ts` now:
  - Generates `run_id` via `crypto.randomUUID()`
  - Creates run directory: `mcp/agent-router/.foreman/runs/{run_id}/`
  - Appends a JSONL `run_started` event to `execution_log.jsonl`
  - Prints `run_id` and run path to stdout
  - Exits 0 on success

### Verification
Manual run executed via:
- `cd mcp/agent-router && npx tsx src/foreman/run.ts`

Confirmed output and file creation:
- `.foreman/runs/{run_id}/execution_log.jsonl` contains a valid `run_started` JSON line (append-only).

### Notes
- No Claude CLI invocation yet.
- No schema validation yet.
Next: Phase B v1.1 — deterministic `request.json` envelope generation.

Foreman — Phase B v1.2 Complete

Status: Complete
Date: 2026-02-25

Objective

Deterministic request.json materialization layer (no Claude/LLM calls, no tools, no nondeterminism).

Deliverables

src/foreman/materialize.ts — CLI materializer

buildEnvelope() reused as pure deterministic core

Canonical JSON serialization (stable key order, UTF-8, trailing newline)

Recursive alphabetical key sorting for payloads (sortKeysRecursive)

seed/request.seed.json — runnable example seed

testdata/fixture-minimal.seed.json

testdata/fixture-nested.seed.json (out-of-order keys to prove sorting)

testdata/fixture-unicode.seed.json (é, –, 🔥, 日本語, embedded \n)

testdata/fixture-invalid-ts.seed.json

src/foreman/__tests__/materialize.test.ts

Test Status

25/25 tests passing

buildRunId tests

buildEnvelope golden + edge + failure tests

materialize golden byte-for-byte tests (3 fixtures)

sortKeysRecursive unit tests

failure cases (invalid ts, missing seed)

Determinism Guarantees

No Date.now()

No new Date() except controlled parsing inside envelope validation

No randomness or UUID generation

No environment-derived data

No network or external tool calls

Identical seed input → byte-identical out/request.json

Stream Discipline

Errors written to stderr only

No partial file writes on failure

Architectural Position

Foreman now supports:

Deterministic envelope generation (Phase B v1.1)

Deterministic envelope materialization to disk (Phase B v1.2)

Next Phase: Phase B v2.0 — Append-Only Run Ledger

Foreman — Phase B v2.0 Complete (Append-Only Run Ledger Init)

Status: Complete
Date: 2026-02-25

Objective

Create an immutable run directory and append-only run log from a materialized request.json (no Claude/LLM calls, no MCP tools, no nondeterminism).

Deliverables

src/foreman/ledger.ts — ledger initializer (CLI + exported functions)

package.json — added ledger:init script

runs/<run_id>/request.json — byte-identical copy of input request

runs/<run_id>/events.log — append-only NDJSON log (LF-terminated, one JSON object per line)

testdata/ledger-golden.request.json — golden request fixture for ledger tests

src/foreman/__tests__/ledger.test.ts — ledger unit + golden + failure tests

.gitattributes — LF normalization enforced globally; explicit LF for seed/** and testdata/**

Key Design Decisions

Existing run directory policy: fail loud (exit 1) to preserve immutability (no re-init of same run_id).

Append-only log writes: events.log opened in append mode; writes are compact NDJSON + \n (LF only).

Byte-identical request copy: raw Buffer read/write (no UTF-8 decode/re-encode).

SHA-256 hashing: computed from raw on-disk bytes of request.json; recorded in run.created event.

No clock: ts sourced from envelope only; no Date.now()/new Date() usage introduced.

No stdout: all errors to stderr; stdout reserved for MCP protocol.

Determinism + Cross-Platform Stability

Added strict SHA-256 known-vector tests for "" and "abc" per NIST FIPS 180-4.

Normalized seed/** and testdata/** to LF via .gitattributes to prevent CRLF drift affecting byte hashes.

Re-baselined ledger golden fixture sha256 after LF normalization:

ledger-golden.request.json sha256: f2771841e2fcff87b80f4f65f1f09d0c1c3e6ef4012e722d43cadfb06b4bad27

Test Status

41/41 tests passing

Commands

npm run materialize -- --seed seed/request.seed.json

npm run ledger:init -- --request out/request.json

Next Phase: Phase B v2.1 — Ledger Verify (ledger:verify)

Foreman — Phase C v1.0 Complete (Single-Step Execution Wrapper)

Status: Complete
Date: 2026-02-25

Objective

Execute exactly one agent step per run with write-once artifacts and append-only ledger events (no tools; executor is dependency-injected; no nondeterministic IDs).

Deliverables

src/foreman/execute.ts

Pluggable executor interface (Executor, ExecutorResult)

STEP_ID = "step-001" fixed (no UUID/randomness)

CLI: npm run run:execute -- --run runs/<run_id> --actor <actor> --action <action>

Pipeline:

verifies run integrity via verifyLedger before execution

overwrite protection for all artifacts before touching disk

write-once artifacts + append-only events

stderr-only output (stdout reserved)

src/foreman/__tests__/execute.test.ts

package.json — added run:execute script

Artifacts (write-once)

Created under runs/<run_id>/outputs/:

step-001.invocation.json (written before executor call)

step-001.response.txt (raw output written after executor)

step-001.result.json (written last; signals step completion)

Ledger Events (append-only NDJSON in runs/<run_id>/events.log)

New event types appended by execution:

step.started

step.succeeded / step.failed

run.succeeded / run.failed

Ordering + Integrity Patch (Atlas ruling applied)

Added seq to every appended execution event:

monotonic integer, zero-indexed, per run; increments on each append

Canonical ordering is by seq; ts is informational only

Added inputs_hash to step.started:

sha256 of raw bytes of step-001.invocation.json as written to disk

New hard-fails enforced:

SEQ_GAP: any non-contiguous or duplicate seq values on read/verify/execute

INPUTS_HASH_ABSENT: cannot append step.started without inputs_hash

Determinism + Safety Guarantees

No UUID/random generation; step_id fixed to step-001

No environment-derived data

No tools enabled

Append-only ledger; no overwrites of artifacts

Execution refuses to run if ledger verification fails or artifacts already exist

Test Status

81/81 tests passing

Next Phase: Phase D v1.0 — Policy Firewall (actor/action/tool allowlist enforcement; tools still OFF initially)
2026-02-25 — Foreman Phase D v1.0 Complete (Policy Firewall)
Goal

Hard-enforce actor/action allowlist and tools-off policy before any invocation artifacts are written.

Implemented

Policy module added: actor/action allowlist enforcement

Tools remain OFF: any non-empty tools array is denied

execute pipeline updated to enforce policy after ledger verification and overwrite checks, before writing outputs/step-001.invocation.json

On policy violation:

No outputs written

Append-only ledger records terminal failure events (includes policy_reason)

Exit non-zero

No dynamic policy loading, no env reads, no time/randomness introduced

Verification

Test suite expanded with policy.test.ts (25 new tests)

Total tests: 106/106 passing

Integration proofs:

Denied runs create no outputs/

step.started not emitted on denial

Ledger seq remains contiguous; verifyLedger passes after denial

Next Phase

Phase E v1.0 — (define next slice)

2026-02-25 — Foreman Phase E v1.0 Complete (Ledger Verify CLI + Verifier Contract)
Goal

Provide a deterministic, read-only run verification command with stable machine-parseable output and strengthen verifier integrity enforcement.

Implemented

Added src/foreman/verify.ts:

verifyLedgerDetailed(runDir) — pure verification pipeline returning structured result

verifyLedger(runDir) — delegates to detailed verifier; returns 0|1; verbose stderr retained

cliVerify(runDir) — returns { code, message } for strict CLI formatting

Canonical reason codes (sole source of truth = VerifyReason):

REQUEST_JSON_UNREADABLE

EVENTS_LOG_UNREADABLE

EVENTS_LOG_EMPTY

EVENTS_LOG_CORRUPT

INVALID_FIRST_EVENT

REQUEST_HASH_MISMATCH

RUN_ID_MISMATCH

SEQ_GAP

Verifier-level seq integrity enforcement (contract):

seq must be contiguous from 0..N-1 (no gaps, no duplicates)

Any violation → SEQ_GAP hard-fail (must not be loosened)

CLI Contract (stderr-only; stdout reserved)

OK <run_id>

FAIL <run_id> <REASON>

Scripts

Added: ledger:verify → tsx src/foreman/verify.ts

Verification

All tests passing: 114/114

Added verify CLI tests + library SEQ_GAP tests

Verifier remains read-only (no writes)

Implementation Lock

Commit: 921e6fc

Next Phase

Phase F v1.0 — (to be defined)

2026-02-25 — Foreman Phase F v1.0 Complete (Deterministic Step Indexing)
Goal

Replace fixed step_id with deterministic, ledger-derived step indexing to support repeated single-step execution on the same run without overwrites.

Implemented

Added src/foreman/step_index.ts:

computeNextStepIndex(events) derives the next step index by counting completed step.started entries

Hard-fails on incomplete steps (started without terminal) via INCOMPLETE_STEP

Updated src/foreman/execute.ts:

Removed hardcoded STEP_ID

Added computeStepId(index) producing step-000, step-001, … (zero-padded)

Execute now computes next step_id from ledger events per invocation

Overwrite protection and artifact paths now use computed step_id

INCOMPLETE_STEP handling:

No outputs written

Append run.failed with reason: "INCOMPLETE_STEP" and open_step_id

policy_reason remains reserved for policy firewall denials only

Verification

Updated execute.test.ts and policy.test.ts to use computed step ids

Added src/foreman/__tests__/step_index.test.ts

Integration coverage includes:

Two sequential run:execute calls create step-000 then step-001

Incomplete prior step blocks next execution and fails safely

Total tests: 131/131 passing

Implementation lock commit: 7f440d3

Next Phase

Phase G v1.0 — (to be defined)
2026-02-26 — Foreman Phase G v1.0 Complete (request.json Steps Manifest Execution)
Goal

Enable deterministic multi-step intent via steps[] in request.json, executing exactly one declared step per run:execute invocation while keeping tools disabled and preserving backward compatibility.

Implemented

Added support for steps[] in runs/<run_id>/request.json:

Each step: { step_id (UUID), actor (<type>:<id>), action (string) }

tools key forbidden by presence (any value, even []) → TOOLS_NOT_PERMITTED

step_id must be valid UUID → INVALID_STEP_ID

Duplicate step_id within run → DUPLICATE_STEP_ID

Empty steps array → EMPTY_STEPS

Selection + execution:

Next step index derived from ledger state (Phase F)

Selected step is steps[stepIndex]

Ledger step.* events use manifest step_id (UUID)

Artifacts use deterministic prefix: step-{index3}-{step_id}

Backward compatibility:

If steps[] absent, legacy top-level actor/action behavior remains unchanged

Out-of-range handling:

If stepIndex is invalid for steps[] → append run.failed with:

reason: "STEP_INDEX_OUT_OF_RANGE"

detail: { requested_index, steps_length }

No step.started written

Verification

Acceptance coverage added/updated in execute.test.ts for AC1–AC9

Added dedicated INVALID_STEP_ID test (zero ledger appends on structural failure)

Total tests: 141/141 passing

Implementation lock commit: ce63a38

Next Phase

Phase H v1.0 — (to be defined)
2026-02-26 — Foreman Phase H v1.0 Complete (Run State Machine)
Goal

Formalize and enforce the run lifecycle derived solely from events.log, preventing execution after terminal state and strengthening ledger integrity rules for terminal/step ordering.

State Model (derived from ledger events only)

UNINITIALIZED: events.log missing or empty

INITIALIZED: run.created present, no step.started (warn does not count)

RUNNING: any step.started, no terminal

SUCCEEDED: run.succeeded present

FAILED: run.failed present
Terminal states are SUCCEEDED/FAILED only; exactly one terminal event must exist and must be the highest-seq terminal.

Verifier Integrity Upgrades (read-only)

Added hard-fail checks in ledger verification:

MULTIPLE_TERMINALS: >1 terminal event (run.succeeded / run.failed)

STEP_AFTER_TERMINAL: any step.started with seq greater than terminal seq

TERMINAL_BEFORE_STEP_COMPLETE: run.succeeded exists but last step is not terminal (open step)
Note: run.failed with an open step is permitted (failure can be abrupt).

Execute Pipeline Enforcement

Ordering invariant:

verifyLedger (catches corruption)

deriveRunState (catches terminal runs)

validateRequest (structural)

policy firewall

write invocation → step.started → invoke → outputs → step terminal
Run terminal handling:

RUN_ALREADY_TERMINAL: calling execute on SUCCEEDED/FAILED run exits with error and writes no new ledger events

steps[] mode: auto-appends run.succeeded only after the last manifest step succeeds

steps[] mode: step failure appends run.failed immediately; remaining steps are not attempted

legacy mode: terminal behavior unchanged from prior phases

Verification

Added/updated tests for all new verifier checks and run-state behaviors

Total tests: 148/148 passing

Implementation lock commit: 3535e16

Next Phase

Phase I v1.0 — (to be defined)
2026-02-26 — Foreman Phase I v1.0 Complete (Idempotent Invocation Guard: Fail-Fast Crash Recovery)
Goal

Ensure run:execute is crash-safe and idempotent: if a run is in RUNNING state with an open step (started but not terminal), execution must not proceed and must close deterministically.

Implemented

Added a pre-flight crash recovery guard in execute.ts:

After verifyLedger and deriveRunState, if state is RUNNING and an open step exists:

Append run.failed with:

reason: "INCOMPLETE_STEP_RECOVERY_REQUIRED"

open_step_id

Exit 1

No step.failed emitted

No new step.started emitted

No outputs/ artifacts written

Implemented dedicated findOpenStepId(events) to detect the latest unclosed step.started by ledger scan (no dependency on step indexing logic)

Updated prior incomplete-step test expectation to reflect Phase I interception

Verification

Added 3 crash-safety tests covering:

baseline open-step recovery

steps[] manifest run with open step

legacy run with open step

Total tests: 151/151 passing

Implementation lock commit: 8fd3fe7

Next Phase

Phase J v1.0 — (to be defined)
2026-02-26 — Foreman Phase J v1.0 Complete (Request Immutability + Step Intent Hash)
Goal

Cryptographically bind step execution to the immutable request.json bytes on disk and the selected step identity, preventing manifest drift/tampering from influencing execution.

Implemented

Request immutability enforcement at execute-time:

Recompute request_hash = SHA-256(raw bytes of runs/<run_id>/request.json)

Compare to run.created.sha256

On mismatch: hard-fail before any step starts (no outputs, no step.started)

Added request_hash and intent_hash to step.started events:

request_hash: SHA-256 hex of raw request.json bytes

intent_hash: SHA-256 hex of:

PFNZ_INTENT_V1\n{request_hash}\n{step_id}\n{actor}\n{action}\n

V1 binds actor/action only; tools remain OFF

Works for both steps[] mode (manifest UUID step_id) and legacy mode

Verification

Added tests:

Tampered request.json triggers REQUEST_HASH_MISMATCH and blocks execution

intent_hash determinism verified independently (steps[] and legacy)

Total tests: 154/154 passing

Implementation lock commit: 808feba

Next Phase

Phase K v1.0 — (to be defined)

Explored foreman pipeline architecture and Phase G parser patterns
Explored foreman pipeline architecture and Phase G parser patterns
Show more

Now I have a complete picture. Let me write the plan.


Read project plan for idempotent invocation guard implementation
Read project plan for idempotent invocation guard implementation

Old Phase I plan. Overwrite it with Phase K.


Updated plan document with security phase analysis
Updated plan document with security phase analysis

Now apply the two required tweaks — fix remaining "Phase J" reference in table, and add stderr assertions to the three test descriptions:


Examined request parsing logic in execute.ts
Examined request parsing logic in execute.ts

Now I have both insertion points. Apply A and B together:


Added capabilities validation and extended error handling codes
Added capabilities validation and extended error handling codes

Now audit the test file for all inline steps[] fixtures that need "capabilities": []:


Searched for step_id UUID references in test file
Searched for step_id UUID references in test file
Show more

Let me check the context around lines 874 and 1108:


Reviewed foreman test file sections covering duplicate step ID and open step validation scenarios
Reviewed foreman test file sections covering duplicate step ID and open step validation scenarios

AC6 needs "capabilities": [] on both steps (line 1108 is the Phase I test using the fixture file, already fixed). Fix AC6:


Updated task tracking with completed work items
Updated task tracking with completed work items

Now find the end of the test file to append the 3 Phase K tests:


Ran tests and identified failing assertion in phase G implementation
Ran tests and identified failing assertion in phase G implementation
Show more

One more test needed updating — AC3. Let me check it:


Read execute.test.ts file to examine test assertions for forge command execution
Read execute.test.ts file to examine test assertions for forge command execution

It uses STEPS_WARN_REQUEST fixture. Find that constant:


Read test data file with multi-step workflow configuration
Read test data file with multi-step workflow configuration

This fixture also needs "capabilities": []:


Ran npm test and verified test execution completed
Ran npm test and verified test execution completed
Show more

157/157. Commit:


Verified all 157 tests passed and committed code
Verified all 157 tests passed and committed code
Show more

Phase K v1.0 — Proof Bundle

Commit: c92c104
Tests: 157/157 pass (+3 Phase K, +1 fixture fix for AC3 discovered during audit)

Snippet — capabilities validation logic + reason codes (inside parseRequestSpec loop):

// ── Phase K: capabilities field — required, must be array, must be empty ─
if (!("capabilities" in step)) {
  throw makeCodedError(
    `steps[${i}] must include a capabilities field`,
    "CAPABILITIES_FIELD_REQUIRED",
  );
}
if (!Array.isArray(step["capabilities"])) {
  throw makeCodedError(
    `steps[${i}].capabilities must be an array`,
    "CAPABILITIES_INVALID_TYPE",
  );
}
if ((step["capabilities"] as unknown[]).length > 0) {
  throw makeCodedError(
    `steps[${i}].capabilities must be empty — tool use is not permitted in v1.0`,
    "CAPABILITIES_NOT_PERMITTED",
  );
}

All three throw from inside parseRequestSpec → caught at Step 3 try/catch → exit 1, zero ledger appends.

Test names proving the three failure modes:

"Phase K — CAPABILITIES_FIELD_REQUIRED: steps[] entry missing capabilities → exit 1, zero ledger appends"
"Phase K — CAPABILITIES_INVALID_TYPE: capabilities not an array → exit 1, zero ledger appends"
"Phase K — CAPABILITIES_NOT_PERMITTED: non-empty capabilities → exit 1, zero ledger appends"
Audit note: testdata/steps-with-toplevel-actor.request.json (used by AC3) also lacked "capabilities": [] and was fixed in the same commit. No other inline fixtures were affected.

Same situation as before — backend Node.js/TypeScript module, no web server. Verification is npm test (157/157 pass). Hook doesn't apply.

2026-02-26 — Foreman Phase L v1.0 Complete (Actor → Executor Routing)
Goal

Make the orchestration pipeline truly multi-agent by deterministically routing step execution by actor type, while preserving trust invariants (no outputs, no step.started on routing failures).

Implemented

Added resolve_executor.ts with pure resolveExecutorType(actor):

Splits actor on the first colon only (<type>:<id>)

No colon → ACTOR_MALFORMED with detail: { actor, problem: "no colon separator" }

Unknown type → EXECUTOR_NOT_FOUND with detail: { actor, actor_type }

Allowed types (closed enum v1.0): forge, sentinel, compass (case-sensitive)

Execute pipeline enforcement (order locked):

verifyLedger

deriveRunState (RUN_ALREADY_TERMINAL)

Phase I open-step guard

Phase J request immutability guard

resolveExecutorType (Phase L)

policy firewall

artifacts + step.started …

On ACTOR_MALFORMED / EXECUTOR_NOT_FOUND:

Append only run.failed with reason + detail

Exit 1

No outputs, no invocation.json, no step.started

Legacy mode also requires <type>:<id> and routes with the same rule (no special-casing)

Verification

Added resolver unit tests + execute integration tests for both failure modes

Updated legacy test actors to forge:main

Total tests: 168/168 passing

Commit: 12d355b

Next Phase

Phase M v1.0 — (to be defined)

2026-02-26 — Foreman Phase M v1.0 Complete (Executor Binding & Isolation)
Goal

Make routing real: each actor type must call only its bound executor. No fallback. No dynamic registration.

Implemented

Added executor.ts: canonical Executor/ExecutorInvocation/ExecutorResult interfaces (injected; never constructed in execute.ts)

ExecutorRegistry = { forge: Executor; sentinel: Executor; compass: Executor } — all three slots must be bound

executeRun is now async (Promise<0|1>); accepts ExecutorRegistry (not single executor)

Phase M binding check (EXECUTOR_BINDING_MISSING) fires after Phase L routing, before policy:

Validates bound executor exists and has .execute() method

On failure: append run.failed, exit 1 — no outputs, no step.started

Direct indexed call: await executors[actorType].execute(invocation) — no fallback, no default

EXECUTOR_EXCEPTION: thrown errors normalized to failed result with code + message

EXECUTOR_INVALID_RESULT: failed result without .error field gets sentinel code injected

result.json = ExecutorResult.output verbatim (JSON.stringify(result.output, null, 2) + "\n")

response.txt eliminated entirely

buildStepSucceededLine: output_ref/sha256 params removed; step.succeeded event simplified

Removed buildSuccessResultJson/buildFailureResultJson helpers

Verification

T1: forge actor calls only executors.forge.execute (sentinel/compass spies not called)
T2: sentinel actor calls only executors.sentinel.execute (forge/compass spies not called)
T3: compass actor calls only executors.compass.execute (forge/sentinel spies not called)
T4: EXECUTOR_BINDING_MISSING — undefined forge binding → exit 1, run.failed, no step.started
T5: legacy mode — missing sentinel binding → same EXECUTOR_BINDING_MISSING semantics
T6: executor throws Error('boom') → step.failed EXECUTOR_EXCEPTION, run.failed, no open step

Total tests: 172/172 passing (6 new Phase M, net +4 after removing 2 deleted helper unit tests)

Commit: c1e8de1

Next Phase

Phase N v1.0 — (to be defined)

2026-02-26 — Phase M v1.0 Complete (Executor Binding & Isolation — Binding Layer)

Commit: c1e8de1
Tests: 172/172 passing

Summary

Enforced strict Actor → Executor binding.

Introduced canonical Executor interface

Added mandatory ExecutorRegistry (forge/sentinel/compass)

Enforced binding check before execution (EXECUTOR_BINDING_MISSING)

Eliminated fallback and dynamic resolution

Direct indexed executor invocation

Normalized executor exceptions (EXECUTOR_EXCEPTION)

Removed response.txt

Simplified step.succeeded event

Added T1–T6 binding tests

Guarantees

No executor fallback

No dynamic executor registration

Deterministic binding

Hard fail on missing binding

No open-step leakage on crash

Routing integrity preserved

Notes

Structural isolation hardening and capability envelope enforcement deferred to next phase.

2026-02-26 — Phase N v1.0 Step 1 Complete (ExecutionContext Immutability)

Commit: 1ec2de9
Tests: 178/178 passing

Summary

Introduced immutable ExecutionContext boundary.

Added ExecutionContext { invocation, capabilities }

Implemented deepFreeze utility (recursive)

Deep-froze invocation and capability envelope before executor call

Executors now receive only frozen context

Added 6 deepFreeze immutability tests

All previous 172 tests preserved

Guarantees

Executors cannot mutate invocation

Executors cannot mutate nested inputs

Executors cannot mutate capability envelope

Structural immutability enforced at boundary

Deferred

Capability enforcement logic

capabilities_hash ledger field

Canonical serialization definition

2026-02-26 — Phase N v1.0 Step 2 Complete (writeOutput Capability Enforcement)

Commit: 08685a9
Tests: 181/181 passing

Summary

Converted result persistence into an explicit capability.

Added writeOutput(data) capability injected into per-step envelope

Removed all ambient result.json writes from Foreman flow

Executors now persist output only via context.capabilities.writeOutput(...)

Added 3 N2 tests verifying:

calling writeOutput creates result.json

not calling writeOutput creates no result.json

missing capability call fails deterministically

All prior tests preserved

Guarantees

Output persistence is capability-gated

No executor can persist result artifacts without explicit granted capability

ExecutionContext + envelope remain deeply frozen

Deferred

capabilities_hash ledger field + canonical serialization

required-output policy (enforce writeOutput usage per action type)

additional capabilities (event emission, filesystem, etc.)

GC — SYSTEM_STATE.md Update Required

Copy-paste entry:

2026-02-27 — Phase N v1.0 Step 3 Complete (capabilities_hash + __grants Audit Binding)

Commit: 89cb423
Tests: 184/184 passing

Summary

Bound step permissions to audit trail via deterministic capability hashing.

Introduced capabilities.__grants (plain JSON descriptor; audit-only)

Added canonical key-sorting serialization (canonicalize) for deterministic hashing

Logged capabilities_hash (SHA-256 hex) in step.started, computed from canonical JSON of __grants

Ensured __grants immutability via freeze + deepFreeze

Updated verifier/contracts to accept capabilities_hash

Added N3 tests:

Correct hash for { writeOutput: true }

Key order invariance

Deterministic empty grants hash

Guarantees

Step permissions are cryptographically bound at step.started

Capability grants cannot be mutated post-handoff

Hash determinism is defined and tested

Deferred

Enforcement against executors branching on __grants

Capability expansion beyond writeOutput

Required-output policy (mandating writeOutput for certain actions)

Phase N v1.0 Status

Phase N v1.0 is now complete through Steps 1–3:

Immutable ExecutionContext ✅

Capability-gated output persistence ✅

Audit-bound capability grants ✅

2026-02-27 — Phase O v1.0 Complete (Required Capability Contracts: writeOutput)

Commit: d215eb5
Tests: 187/187 passing

Summary

Enforced behavioral contract linking declared output to required capability usage.

Added writeOutputCalls tracking for per-step capability usage

Rule A: On success, if ExecutorResult.output !== undefined then writeOutput must be called ≥1 time, else fail with CAPABILITY_REQUIRED_NOT_USED (step.failed → run.failed)

Rule B: On success, output: null is invalid and fails deterministically via EXECUTOR_INVALID_RESULT (fires before Rule A)

Updated tests and routing-only executors to avoid declaring output when not persisting it

Added 3 Phase O tests (O–T1/T2/T3)

Guarantees

Executors cannot claim output without persisting it through capability-gated path

“No output” is explicitly represented by output === undefined (omitted)

Deterministic failure semantics for contract violations

Deferred

Ledger-level tracking of capability usage (e.g., writeOutput_used)

Required-output policies per action type (beyond “output declared” rule)

Additional required capability contracts for future capabilities

2026-02-27 — Phase P v1.0 Complete (Action-Level Output Contracts)

Commit: bf2a513
Tests: 190/190 passing

Summary

Enforced output declaration contract for the primary worker action.

Added OUTPUT_REQUIRED_ACTIONS = { "forge.implement" }

On success, if action is output-required and output === undefined, fail deterministically:

OUTPUT_REQUIRED_MISSING → step.failed → run.failed

Enforcement runs after Phase O null-output invalidation and before Phase O required writeOutput usage checks

Updated affected tests and added Phase P tests (P–T1/T2/T3)

Guarantees

forge.implement cannot succeed without declared output

Declared output remains capability-gated and must be persisted via writeOutput (Phase O)

Non-output-required actions may still succeed without output (e.g., sentinel.review)

Deferred

Output-required contracts for other actions (if needed)

Ledger-level recording of capability usage (e.g., writeOutput_used)

Additional capability-required contracts beyond output

Where We Are Now (Trust Milestone)

We now have a strong trust pipeline:

M: bound executor

N1: immutable context

N2: capability-gated persistence

N3: audit-bound grants hash

O: output declaration implies persistence

P: primary work action must declare output

This is a meaningful milestone.

2026-02-27 — Phase R v1.0 Complete (Stabilization Guardrails)

Commit: 2c44ca3
Tests: 195/195 passing

Summary

Locked Trust Engine invariants with anti-drift guardrail tests.

Added Phase R tests enforcing ordering + error-code precedence:

output: null ⇒ EXECUTOR_INVALID_RESULT (wins over other failures)

forge.implement with output === undefined ⇒ OUTPUT_REQUIRED_MISSING (wins over missing writeOutput)

Declared output without writeOutput ⇒ CAPABILITY_REQUIRED_NOT_USED

Locked OUTPUT_REQUIRED_ACTIONS to exactly ["forge.implement"]

Locked presence + format of capabilities_hash in step.started

Guarantees

Future changes cannot reorder enforcement checks without test failures

Output-required scope cannot expand silently

Capability hash cannot be removed without detection

Notes

Phase R is tests-only; no runtime behavior changes.

# Agent OS — SYSTEM_STATE

## Phase: Agent OS v1.0
Status: Active
Mode: Execution (C2 architecture)

---

## Slice 1 — Project Adapter Loader

Status: LOCKED  
Commit: a79d8fa  
Tests: 13/13 passing  

Delivered:

- schema.ts — canonical ProjectAdapter v1.0 interface
- loadProjectAdapter.ts — strict validation (no silent defaults)
- cli.ts — `agent-os validate` command (cwd default supported)
- Full error code coverage:
  - ADAPTER_NOT_FOUND
  - ADAPTER_PARSE_ERROR
  - ADAPTER_INVALID_SCHEMA_VERSION
  - ADAPTER_MISSING_FIELD
  - ADAPTER_INVALID_ENUM
  - ADAPTER_PATH_NOT_FOUND

Invariants:

- Exactly 5 canonical actor keys required (command, atlas, forge, sentinel, compass)
- governance.system_state_updates.mode must be "hybrid"
- require_manual_approval_for must include "trust_change"
- auto_apply_for must include "trivial"
- trust_change_triggers strictly validated (no implicit defaults)
- No throws — structured result objects only

---

## Slice 2 — Step Report Contract

Status: LOCKED  
Commit: 468851e  
Tests: 21/21 passing (13 adapter + 8 step report)

Delivered:

- stepReport.schema.ts — StepReportV1, ActorKey, StateImpact
- validateStepReport.ts — strict validator
- writeStepReport.ts — deterministic artifact writer
- relayStepReport.ts — pure passthrough relay
- CLI demo: `step-report-demo`

Step Report Artifact Layout:

<runRoot>/<run_id>/steps/<step_index>-<step_id>/step-report.json

Validator Guarantees:

- schema_version must equal "1.0"
- actor ∈ {command, atlas, forge, sentinel, compass}
- status ∈ {"succeeded", "failed"}
- state_impact ∈ {"none", "trivial", "trust_change", "phase_boundary"}
- trust_notes required when state_impact === "trust_change"
- timestamp must be valid ISO-8601
- Never throws — structured error codes:
  - STEP_REPORT_INVALID_SCHEMA
  - STEP_REPORT_MISSING_FIELD
  - STEP_REPORT_INVALID_ENUM
  - STEP_REPORT_INVALID_TIMESTAMP

System Properties Established:

- Every step must emit a validated StepReport
- Step outputs are relayable to Command
- State impact is explicitly classified
- Trust-impact is explicitly declared
- Artifact layout is deterministic

---

## Engine Status

Agent OS now contains:

- Project adapter validation layer
- Governance contract layer
- Step-level reporting contract
- Deterministic artifact layout
- Relay-ready reporting structure

---

## Slice 3 — Dispatcher Skeleton (Locked)

- Status: Locked (Sentinel PASS)
- Branch: slice3-dispatcher-skeleton
- Commits: 17db81a (+ step_id path-safety guard + AC10/AC11)
- Tests: 32/32 passing
- Summary:
  - dispatchRun() executes ordered steps with fail-fast semantics
  - Closed runner registry (command/atlas/forge/sentinel/compass)
  - Deep-frozen step context prior to runner invocation
  - capabilities must be empty (enforced)
  - StepReport required, validated before write
  - Deterministic artifacts path: `<artifacts_root>/steps/<i>-<step_id>/step-report.json`
  - step_id validated via isSafeStepId to prevent path traversal

Dispatcher / Run Engine: SLICE 3 LOCKED
Next Slice: Slice 4 (to be defined)

---

## SLICE 4 — GOVERNANCE ENFORCEMENT LAYER — SENTINEL REVIEW PASS

Status: VERIFIED (Sentinel PASS)  
Date: 2026-03-01  
Reviewer: Sentinel (local repo, review-only)  
Branch Reviewed: slice4-governance-enforcement  

### Outcome

Slice 4 Security Review: PASS

### Evidence Anchors (file + line ranges)

- Pre-run governance gate before runner invocation:
  - agent-os/src/dispatcher/dispatchRun.ts:222–268 (gate), runner invocation at 356
  - tests: agent-os/src/dispatcher/__tests__/dispatchRun.test.ts:475–499 (S4-AC1), 832–857 (S4-AC15)

- Unknown/missing state_impact hard-fail (no permissive fallthrough):
  - agent-os/src/dispatcher/dispatchRun.ts:119–124 (KNOWN_STATE_IMPACTS)
  - agent-os/src/dispatcher/dispatchRun.ts:439–452 (STEP_REPORT_INVALID before writeStepReport)

- TRUST_CHANGE_MISSING_NOTES occurs before writeStepReport:
  - agent-os/src/dispatcher/dispatchRun.ts:418–433 (check), writeStepReport at 460
  - tests: dispatchRun.test.ts:657–714 (S4-AC10/11)

- DISPATCH_HALTED_GOVERNANCE is non-persistent (no new run state / resume):
  - agent-os/src/dispatcher/dispatchRun.ts:499–516 (halt shape)
  - agent-os/src/dispatcher/errors.ts:29–53 (result/error types)

- Slice 3 invariants preserved; Slice 4 is additive only:
  - agent-os/src/dispatcher/errors.ts:9–27 (codes preserved + additive)
  - agent-os/src/dispatcher/dispatchRun.ts:128–134 (RUNNER_KEYS unchanged)
  - tests: dispatchRun.test.ts:584–611 (S4-AC7 adversarial trust_change)

### Notes

Non-blocking test coverage note recorded by Sentinel: no explicit test driving “unknown state_impact” through dispatchRun; implementation is fail-closed via STEP_REPORT_INVALID and defensive default in governanceDecision.

---
---

## SLICE 4 — GOVERNANCE ENFORCEMENT LAYER — MERGED TO MAIN

Status: MERGED  
Date: 2026-03-01  
Merged From: slice4-governance-enforcement  
Merge Type: Fast-forward  
Main Commit: 1195e0f

### Included

- Slice 4 governance enforcement implementation (dispatcher gate + per-step governance halt)
- Automated tests for S4-AC1–S4-AC15
- Sentinel PASS review recorded in SYSTEM_STATE.md

---
---

## SLICE 5 — ARTIFACT RELAY v1 (OFFLINE) — MERGED TO MAIN

Status: MERGED  
Date: 2026-03-01  
Merged From: slice5-artifact-relay-v1  
Merge Type: Fast-forward  
Main Commit: 59452d8

### Included

- Relay v1 offline bundle transport:
  - `agent-os relay export` (deterministic tar.gz bundle)
  - `agent-os relay import` (integrity + traversal protections; non-destructive by default)
- Determinism guarantees:
  - lexicographic entry order
  - fixed mtime = Unix epoch 0
  - filename includes archive SHA-256 prefix (first 12 hex)
- Integrity/security guarantees:
  - archive hash verification before extraction
  - per-file sha256 + byte count verification
  - traversal rejection + symlink rejection (fail closed; zero writes)
- Automated tests covering Slice 5 AC1–AC11 (full suite green)

---
### Slice 6 — StepReport v1 Contract Enforcement (MERGED TO MAIN)

**Commit:** 4b377e5  
**Status:** merged to `main`  
**Test status:** 69/69 passing

**Implements StepReport v1 locked contract (Atlas §2–§8):**
- `success: boolean` required on every StepReport
- `error` object required when `success=false`; forbidden when `success=true`
- `output` must not be `null` (rejects `success=true` + `output:null` pre-write)
- `state_impact` closed-world enforcement; unknown impact hard-fails (`STEP_REPORT_INVALID`)
- `trust_change` requires non-empty `trust_notes` (trim enforced) pre-write
- `metadata` constrained to JSON-serializable plain object

**Dispatcher validation ordering (locked):**
- Structural + identity mismatches → `DISPATCH_STEP_REPORT_INVALID`
- Defensive `state_impact` assert → `STEP_REPORT_INVALID`
- Pre-write hard fails:
  - `TRUST_CHANGE_MISSING_NOTES`
  - `EXECUTOR_INVALID_RESULT` (`success=true` + `output:null`)
- `writeStepReport` persists report
- Post-write enforcement:
  - `OUTPUT_REQUIRED_MISSING` for `OUTPUT_REQUIRED_ACTIONS = {"forge.implement"}`
  - `CAPABILITY_REQUIRED_NOT_USED` when output present but `write_output_calls === 0`
- Governance decision evaluated after `writeStepReport` (unchanged invariant)

**Notes:**
- Runner output now supports `write_output_calls?: number`; runners omitting it are exempt from the capability check (intentional compatibility behavior).
- Trust invariants preserved: deterministic dispatch, immutable written step reports, capability gating, fail-closed governance.

### Remediation — Slice 6.1 + Slice 7.2 Contract Hardening (MERGED TO MAIN)

**Commit:** 86638a3  
**Status:** merged to `main`  
**Test status:** 85/85 passing

**Fixes Compass validation blockers:**
- **StepReport v1 `error` contract corrected**
  - `error` changed from string to structured object `{ code, message, detail? }`
  - Enforced mutual exclusion: `success=true` forbids `error` (hard fail; no silent dropping)
  - `success=false` requires valid `error` object with non-empty `code` and `message`; optional `detail` must be JSON-serializable
  - Dispatcher continues to surface validator failures as `DISPATCH_STEP_REPORT_INVALID` (cause retains validator detail)
- **Run bundle filename run_id binding enforced**
  - Filename parser now extracts both `run_id` and `sha256prefix12` from `run_<run_id>_<sha>.tar.gz`
  - Import rejects filename run-id mismatch vs manifest (`RELAY_IMPORT_RUN_RUN_ID_MISMATCH`) fail-closed with zero-write guarantee
  - Added tests: `AC7-RunId` and StepReport mutual exclusion/object-shape tests

**Trust invariants preserved:** deterministic execution, immutable artifacts, offline relay, fail-closed governance.

## Slice 8 — Approval Artifact + Resume (v1.0)

Commit: 26802f0  
Status: Merged to main  
Security Review: PASS (Sentinel)  
Validation Review: PASS (Compass)

Summary:
Implements filesystem-based approval artifacts and deterministic resume entry point.

Adds:
- Approval artifact schema v1
- CLI: `agent-os relay approve`
- CLI: `agent-os relay resume`
- `dispatchResume()` entry point
- 10-step approval validation ordering (fail-closed)
- SHA-256 binding between approval artifact and persisted step-report.json
- Identity binding: run_id, step_index, step_id, actor, action
- Governance re-validation on resume
- Resume isolation: execution begins at step_index + 1
- written_step_reports on resume include only resumed steps

New Dispatcher Error Codes:
- APPROVAL_ARTIFACT_MISSING
- APPROVAL_ARTIFACT_INVALID
- APPROVAL_IDENTITY_MISMATCH
- APPROVAL_REPORT_NOT_FOUND
- APPROVAL_INTEGRITY_FAILED

Acceptance Criteria:
AC1–AC15 implemented and covered by automated tests.

Invariants Preserved:
- Deterministic actor→executor binding
- Immutable StepContext
- Capability enforcement
- Governance fail-closed behavior
- Offline-only model
- No new run states introduced

Test Suite:
100/100 passing.

## PestFree NZ — Phase 1

### Slice A — Hunter Identity Verification v1.0 — CLOSED
- Status: CLOSED (locked)
- Implementation commits:
  - 02e338c — feat(slice-a): Hunter Identity Verification v1.0
  - 7f70478 — fix(slice-a): enforce HUNTER role on identity/profile GET + hunter/trust-badge GET
- Data model (Prisma):
  - Enums: IdentityVerificationState, IdentityDocumentType, SubmissionStatus, VerificationDecisionOutcome
  - Models: HunterIdentityProfile, VerificationSubmission, VerificationDecision
  - Integrity constraints:
    - @@unique([profileId, idempotencyKey]) (AC-11)
    - @@unique([profileId, submissionSequence]) (deterministic ordering)
- API routes (auth required; role-gated):
  - Hunter (role=HUNTER):
    - GET/POST /api/identity/profile (GET returns non-PII state fields only)
    - POST /api/identity/submit
    - POST /api/identity/withdraw
    - POST /api/identity/resubmit
    - GET /api/hunter/trust-badge (self-only; response shape exactly { verified, verified_since })
  - Admin (role=ADMIN):
    - GET /api/admin/identity/pending
    - POST /api/admin/identity/[profileId]/decide
- Trust invariants enforced:
  - No public/enumeratable trust endpoints; all hunter-facing identity access is session-derived (no hunterId params)
  - Decision artifact written before state mutation inside a single DB transaction (AC-01)
  - Append-only audit at application layer; no update/delete operations for audit/decision artifacts (AC-05)
  - State transitions enforced via transition guard table; no silent state mutation
- Verification:
  - Sentinel PASS (recheck) — confirmed role guards, no enumeration surface, audit immutability, transaction ordering intact
  - Compass PASS — acceptance criteria verified after patch
  - Test suite: 86/86 passing at close

  ## 2026-03-03 — Slice B v1.0 Step 2 Complete (Agreement Transition Engine)

### Status
Slice B — Landowner Access Agreement Engine v1.0  
Step 2 (Transition Service + API Surface) COMPLETE.

### What Exists
- AgreementState enum (DRAFT, SENT, ACTIVE, REVOKED, EXPIRED)
- AgreementEvent enum (CREATED, SENT, ACTIVATED, REVOKED, EXPIRED)
- AgreementActorRole enum (LANDOWNER, HUNTER, SYSTEM, ADMIN)
- Property, Agreement, AgreementAuditLog models
- DB-enforced partial unique indices:
  - One ACTIVE per (hunterId, propertyId)
  - No duplicate live agreements per (landownerId, hunterId, propertyId)
- All migrations tracked and deployable via `prisma migrate deploy`

### Service Layer
`lib/services/agreements.ts` implements:
- createDraftAgreement
- updateDraftTerms
- sendAgreement (termsHash computed at freeze point)
- acceptAgreement
- revokeAgreement
- getAgreementForCaller (404 for non-participants)
- listAgreementsMine
- expireAgreementSystem

Expiry is deterministic and enforced at read boundary (AC-B08).

### Invariants Enforced
- No direct state mutation outside transition service (AC-B01)
- Terms immutable after SENT (AC-B02)
- No edits post-ACTIVE (AC-B03)
- No enumeration of foreign agreements (AC-B04)
- Deterministic transitions only (AC-B05)
- Audit emitted on every transition in same transaction (AC-B06)
- One ACTIVE per hunter/property (AC-B07)
- Expiry determinism without background jobs (AC-B08)
- Required fields before send (AC-B09)
- Role enforcement at transition layer (AC-B10)
- Hunter must be VERIFIED at creation (AC-B11)

### Test Status
150 / 150 passing.
86 pre-existing (Slice A + auth)
64 new (Slice B AC-B01..AC-B11)
No regressions.

### Architectural Note
Agreement Engine v1.0 is now legally defensible, audit-complete, and trust-aligned.
No amendments, no versioning, no silent mutations.
Freeze point at SENT is cryptographically anchored via SHA-256 termsHash.

### 2026-03-03 — Slice B v1.0 Step 3 Complete (Participant Visibility Hardening)

- Status: COMPLETE
- Commit: 908130b
- Changes:
  - Added `GET /api/v2/agreements/mine` (role-scoped: LANDOWNER/HUNTER own only; ADMIN all)
  - Applied summary-only response shaping to list endpoints (terms fields never returned in lists)
  - Added role-scoped, cursor-based pagination with ownership-scoped cursor resolution
- Security/Trust hardening:
  - Cursor lookup uses `id + baseWhere` so foreign cursors are ignored without error (no existence leak)
  - Non-participant agreement access returns HTTP 404 (not 403) to prevent enumeration
  - Summary shape excludes all 5 terms fields and withholds landownerId/hunterId except for ADMIN
- Tests:
  - 174/174 passing total
  - Added 24 tests covering AC-B12..AC-B15 (summary shape, role scoping, pagination, cursor ownership, 404 behavior)
- Gate results:
  - Sentinel PASS
  - Compass PASS

  ### Slice B — Landowner Access Agreement Engine v1.0 — Step 4 (Audit Trail) — CLOSED

**Status:** CLOSED (Sentinel PASS + Compass PASS)

**Commits:**
- `c413c16` — Step 4 implementation: `getAgreementAuditForCaller` + audit route `GET /api/v2/agreements/:id/audit`
- `942e53d` — Step 4 route-level test coverage (404/200 role cases)

**What shipped:**
- New audit trail endpoint: `GET /api/v2/agreements/:id/audit?limit=&cursor=`
- Read-only access rules mirror agreement visibility:
  - LANDOWNER (participant) | HUNTER (participant) | ADMIN (any)
  - Non-participant → **404** with fixed `{ "error": "Not found" }` (no enumeration oracle)
- Deterministic ordering: `occurredAt ASC, id ASC`
- Pagination: default limit 50, capped at 200; cursor scoped to `agreementId`; unknown/foreign cursor ignored
- Payload sanitization (non-ADMIN allowlist):
  - `SENT` → `{ termsHash }` only (string-guarded)
  - `REVOKED` → `{ priorState, reason? }` (`priorState` string-guarded)
  - all other events → `payload: null`
  - `actorId` present only for ADMIN; absent as a key for non-ADMIN

**Gates:**
- Sentinel PASS — enumeration surface clean; payload leakage clean; no write surface on audit endpoint
- Compass PASS — endpoint contract + response shape + pagination/ordering + test coverage complete

**Tests:**
- Full suite green: **200/200**

Slice C — Step 1 Complete
Landowner Agreement Detail View (read-only)
- Server role gate enforced
- LANDOWNER-only route
- Client renders Atlas 2A contract
- Audit integrated (read-only)
- No mutations introduced
- 202/202 tests passing

Slice C — Step 3 Complete
Landowner Agreements List Filtering

- URL-driven state filtering via searchParams
- Allowlisted states: DRAFT, SENT, ACTIVE, REVOKED, EXPIRED
- Invalid state resolves to ALL
- Service layer filtering via listAgreementsPaginated
- Client tab UI reflects active filter
- No client-side filtering logic
- 208/208 tests passing

## 2026-03-05 — Signing Service Migration (e61e04c)

### Architectural change
Signing logic moved from route to service layer.

New service:
signLegacyAgreement()

Service responsibilities:
- participant verification
- signatureType allowlist
- acknowledgement validation
- re-sign prevention
- fully executed guard
- atomic signing transaction
- encryption of signature artifacts

Route responsibilities:
- auth/session validation
- request parsing
- call service
- map domain errors → HTTP

### Security impact
Eliminates invariant duplication between route and service.
Prevents signing logic drift across routes.

### Tests
Sign route security tests rewritten with service mocks.

Total tests: **229 passing**

### Next
Introduce Agreement Lifecycle State Machine to enforce legal state transitions.

## 2026-03-05 — Legacy signing lifecycle guards + audit actorId (b68a50c)

### Completed
- Implemented legacy agreement lifecycle derivation (service-layer only; no schema migration):
  - deriveLegacyStatus(): DRAFT, SENT, ACCEPTED, ACTIVE, REVOKED, EXPIRED, CANCELLED
  - isTerminal(): REVOKED/EXPIRED/CANCELLED
  - isLegacyIssuable(): DRAFT signing gate (hunterEmail non-empty + accessEndDate in future)
- Wired lifecycle guards into signLegacyAgreement():
  - terminal states block signing (409, generic message)
  - hunter signing allowed only when SENT or (DRAFT + isLegacyIssuable)
  - landowner countersign allowed only when ACCEPTED
  - error responses do not disclose internal lifecycle status (anti-enumeration)
- Audit integrity hardened:
  - SignLegacyAgreementInput includes actorId (session-sourced)
  - AuditEvent.actorId written from input.actorId inside signing transaction
- Route hardening:
  - sign route passes actorId: session.user.id (never from request body)

### Tests
- Total tests: 258/258 passing
- Expanded sign-route-security tests:
  - pure function coverage (deriveLegacyStatus, isTerminal, isLegacyIssuable)
  - service-unit lifecycle window tests (vi.importActual + mocked prisma)
  - HTTP mapping tests (409 generic, no state leak)
  - actorId delegation assertion

### Next
- Sentinel security review of b68a50c (no-oracle + audit actorId + transaction integrity).
- Compass validation against Atlas lifecycle spec v1.0.
- Follow-on slice: lifecycle guards for revoke/send/accept and standardize 422→409 in v2 mutation routes.

## 2026-03-06 — v2 revoke lifecycle enforcement + 409 standardization (8d983a4)

### Completed
- Enforced v2 Agreement revoke lifecycle rule at service layer:
  - revokeAgreement() allows revoke only when currentState === ACTIVE
  - all other states reject with AgreementConflictError and generic message (no state enumeration)
  - removed state-leaking AgreementInvalidStateError from revoke flow
- Standardized v2 revoke HTTP semantics:
  - /api/v2/agreements/[id]/revoke now returns 409 for conflict/invalid transition (was 422)
- Added regression tests:
  - service-level revoke lifecycle guard coverage
  - route-level 409 mapping and generic error messaging
  - verified non-participant 404 behavior

### Verification
- Tests: 270/270 passing
- Commit: 8d983a4

### Next
- Apply the same 409 standardization to v2 send/accept routes (Compass prior gap).
- Extend lifecycle enforcement across remaining agreement mutations (send/accept), preserving anti-enumeration and audit atomicity.

## 2026-03-06 — send route validation regression fix (eb840f7)

### Issue
Sentinel review of commit 04a73de identified a regression:
- AgreementInvalidStateError from terms validation in sendAgreement()
  was no longer handled in the send route.
- Result: terms validation failures returned HTTP 500 instead of a client error.

### Fix
- Restored AgreementInvalidStateError handling in:
  /api/v2/agreements/[id]/send
- Mapping now:
  - AgreementNotFoundError     → 404
  - AgreementInvalidStateError → 400
  - AgreementConflictError     → 409

### Verification
- Added route test asserting 400 response for terms validation errors.
- Tests: 291/291 passing
- Commit: eb840f7

### Result
Lifecycle mutation endpoints are now standardized:
- send   → 409 for lifecycle conflicts, 400 for terms validation
- accept → 409 for lifecycle conflicts
- revoke → 409 for lifecycle conflicts

## 2026-03-06 — Agreement Detail READ Hardening (GET /api/v2/agreements/:id)

**Status:** COMPLETE  
**Commit:** 7c0e2dd  
**Tests:** 306/306 passing

### What changed
- Hardened agreement detail read response shape.
- `GET /api/v2/agreements/:id` now returns a **sanitized AgreementDetail** shape instead of raw Prisma rows.

### Security / Trust guarantees
- **Enumeration-safe**: non-participants and not-found both return identical 404 body ("Agreement not found").
- **Role-based redaction**:
  - LANDOWNER/HUNTER: `landownerId`/`hunterId` absent; audit `actorId` absent.
  - ADMIN: `landownerId`/`hunterId` present; audit `actorId` present.
- **Audit payload allowlisting** preserved via `sanitizeAuditPayload` (no duplication):
  - `SENT` payload restricted to `{ termsHash }` only for non-ADMIN.
- All existing PATCH/auth/enumeration logic unchanged.

### Verification
- Added route test suite (16 tests) locking shape + enumeration behavior.
- Manual dev verification: server compiles cleanly; route returns expected 401 when unauthenticated; no new runtime errors.
## 2026-03-06 — Send/Accept Lifecycle Guard Coverage Completion (64c6d62)

**Status:** COMPLETE  
**Commit:** 64c6d62  
**Tests:** 309/309 passing

### What changed
No production code changes. Three targeted test additions to complete lifecycle guard coverage:

1. **`tests/api/agreements.test.ts`** — Added missing ACTIVE state test for `acceptAgreement` lifecycle guard (AC-ACCEPT-1 gap).
   - `ACTIVE → AgreementConflictError` with generic message, no DB writes.
2. **`tests/api/send-route.test.ts`** — Added exact 404 body assertion ("Agreement not found") to lock enumeration-safe behavior at route level.
3. **`tests/api/accept-route.test.ts`** — Same 404 body lock for accept route.

### Coverage now complete
- `sendAgreement`: lifecycle guards tested for SENT/ACTIVE/REVOKED/EXPIRED; 404 body locked.
- `acceptAgreement`: lifecycle guards tested for DRAFT/ACTIVE/REVOKED/EXPIRED; 404 body locked.
- All state transitions enforced via `assertTransition` → `AgreementConflictError` (409 at route).

### Next
- Await Command for next slice assignment.

## 2026-03-06 — v2 Agreement Mutation Contract Sweep COMPLETE

**Status:** COMPLETE  
**Commits:** 7d92c2b, c420691  
**Tests:** 316/316 passing

### Goal
Lock a uniform, non-leaking external contract across all v2 agreement mutation routes:
- `POST /api/v2/agreements/[id]/send`
- `POST /api/v2/agreements/[id]/accept`
- `POST /api/v2/agreements/[id]/revoke`

### What was locked
Across all three mutation routes, tests now pin:

- exact **401** response body
- exact **403** response body
- exact **404** response body (`"Agreement not found"`)
- **409** generic conflict behavior
- no lifecycle enum leakage in client responses
- service-not-called on auth failure

### Route contract coverage
- **send**
  - 401: `"Unauthorized"`
  - 403: `"Landowner role required"`
  - 404: `"Agreement not found"`
  - 409: no leaked enum/state names
- **accept**
  - 401: `"Unauthorized"`
  - 403: `"Hunter role required"`
  - 404: `"Agreement not found"`
  - 409: no leaked enum/state names
- **revoke**
  - 401: `"Unauthorized"`
  - 403: `"Only LANDOWNER or ADMIN can revoke"`
  - 404: `"Agreement not found"`
  - 409: no leaked enum/state names

### Notes
- Final revoke test hardening required a case-sensitive no-leak regex so normal English wording like “revoked” is allowed while uppercase enum tokens remain forbidden.
- This slice was **tests-only**; no production behavior changed.

### Trust impact
The v2 agreement mutation surface is now externally consistent, enumeration-safe, and contract-locked against lifecycle state leakage.

## 2026-03-06 — Agreement Mutation Success Contract Hardening COMPLETE

**Status:** COMPLETE  
**Commit:** 4bf81a2  
**Tests:** 320/320 passing

### Goal
Lock the success response contract for the v2 agreement mutation routes:
- `POST /api/v2/agreements/[id]/send`
- `POST /api/v2/agreements/[id]/accept`
- `POST /api/v2/agreements/[id]/revoke`

### What changed
Forge discovered that all three mutation routes were returning raw updated agreement rows via `NextResponse.json(updated)`.

This exposed participant identifiers in successful mutation responses:
- `landownerId`
- `hunterId`

Routes were patched so non-ADMIN callers no longer receive those fields.

### Response hardening
For non-ADMIN callers:
- `landownerId` stripped
- `hunterId` stripped

Confirmed mutation success shapes:
- **send / LANDOWNER** → safe row with `id`, `currentState: "SENT"`, `sentAt`
- **accept / HUNTER** → safe row with `id`, `currentState: "ACTIVE"`, `activatedAt`
- **revoke / LANDOWNER** → safe row with `id`, `currentState: "REVOKED"`, `revokedAt`

For ADMIN:
- revoke response remains full row (participant IDs preserved)

### Tests
Added/updated route tests to lock:
- success response body shape
- non-ADMIN participant ID stripping
- ADMIN visibility behavior where applicable

### Trust impact
Closes a real mutation-response data leak and hardens the agreement success surface so participant IDs are not exposed to non-ADMIN callers.

## 2026-03-06 — Agreement Response Contract Consistency Cleanup COMPLETE

**Status:** COMPLETE  
**Commits:** 93abf39, 681a517  
**Tests:** 332/332 passing

### Goal
Remove the last visible agreement API response inconsistencies by:
- making duplicate-agreement accept conflicts generic and non-leaking
- hardening `PATCH /api/v2/agreements/[id]` success response shape
- closing the PATCH enumeration oracle

### What changed

#### 1. Duplicate-agreement accept conflict hardened
Two duplicate-conflict paths in `lib/services/agreements.ts` previously exposed the lifecycle enum name `ACTIVE`.

Both now return the same generic client-visible message:

`A conflicting agreement already exists for this property`

This applies to:
- the precheck conflict path
- the P2002 race-condition conflict path

#### 2. PATCH success response hardened
`app/api/v2/agreements/[id]/route.ts` now strips:
- `landownerId`
- `hunterId`

from successful PATCH responses for the non-ADMIN caller path.

PATCH remains LANDOWNER-only under current behavior.

#### 3. PATCH enumeration oracle closed
`updateDraftTerms()` previously returned:
- `404` when the agreement did not exist
- `403` when the agreement existed but belonged to another landowner

This created an existence oracle.

The non-owner path now throws `AgreementNotFoundError` instead, so:
- not-found and non-owner PATCH requests both return the same `404`
- body contract is identical: `"Agreement not found"`

### Tests
- Added PATCH route test coverage from scratch
- Updated accept route tests to lock the new generic duplicate-conflict message
- Added PATCH enumeration-safety tests locking:
  - exact 404 body for not-found
  - exact same 404 body for non-owner
  - explicit non-403 assertion
- Updated service test to require `AgreementNotFoundError` for non-owner PATCH

### Security review
- Sentinel PASS on remediation commit `681a517`
- Enumeration oracle confirmed closed
- Participant-ID stripping confirmed preserved

### Trust impact
This removes the last known response-contract inconsistency in the Agreement Trust Engine and brings PATCH into alignment with the hardened read/mutation visibility policy.

## 2026-03-06 — Slice D Hunt Session Engine v1.0 Architecture LOCKED

**Status:** LOCKED  
**Source:** Atlas Revision 2 approved by Command

### Scope
Hunt Session Engine v1.0 defined as the execution layer on top of the Agreement Trust Engine.

### Locked design decisions
- Minimal lifecycle:
  - `SCHEDULED -> ACTIVE -> COMPLETED`
  - `SCHEDULED -> CANCELLED`
  - `ACTIVE -> CANCELLED`
- No `DRAFT` state in v1
- No `EXPIRED` state in v1
- SYSTEM must not activate sessions
- SYSTEM must not complete or cancel ACTIVE sessions
- Activation allowed only when:
  - `now >= scheduledStart - 30 minutes`
  - `now <= scheduledEnd`
- Activation precondition failure cancels the session in the same transaction
- `SESSION_CANCELLED` on activation failure is attributed to the human actor (HUNTER or ADMIN) who attempted activation
- SYSTEM may co-write `SESSION_ACTIVATION_FAILED` as a diagnostic audit event only
- Session audit trail is ADMIN-only in v1
- Non-ADMIN session responses must strip `hunterId` and `landownerId`
- Offline activation/completion deferred; server-authoritative only in v1

### Implementation sequencing
Step 1 approved for build:
- schema
- audit model
- create/schedule service
- `POST /api/v2/hunt-sessions`
- tests only for create path

## 2026-03-06 — Slice D Step 1 COMPLETE (Hunt Session Engine v1.0 Foundation)

**Status:** COMPLETE  
**Commits:** 9706cdd, aab89ff  
**Tests:** 371/371 passing

### Scope
Implemented the first Hunt Session vertical slice only:
- v2 `HuntSession` schema
- v2 `HuntSessionAuditLog` schema
- create/schedule service
- `POST /api/v2/hunt-sessions`
- route + service tests

No activate / complete / cancel / detail / list work included in this step.

### What was built

#### Schema foundation
- Added new v2 models:
  - `HuntSession`
  - `HuntSessionAuditLog`
- Added required enums for session state / audit event tracking
- Added back-references from Agreement and User as required for v2 session ownership and audit linkage

#### Legacy model rename
- Legacy Prisma model `HuntSession` renamed to `AccessHuntSession`
- Underlying DB mapping preserved
- Follow-on file changes confirmed as mechanical rename fallout only
- No runtime trust/query/auth behavior change in legacy routes

#### Create service
Implemented `createHuntSession()` with service-layer enforcement for:
- agreement exists and caller is agreement hunter (enumeration-safe 404)
- agreement must be ACTIVE
- scheduledStart must be in the future
- scheduledEnd must be after scheduledStart
- minimum duration = 30 minutes
- maximum duration = 24 hours
- no overlapping SCHEDULED / ACTIVE session for same hunter × property

#### Route
Added:
- `POST /api/v2/hunt-sessions`

Route contract locked:
- `401` unauthorized
- `403 "Hunter role required"`
- `404 "Hunt session not found"` / enumeration-safe agreement ownership failure contract as implemented
- `409` generic conflict behavior
- `201` success

#### Response shaping
Successful create response strips:
- `hunterId`
- `landownerId`

for the non-ADMIN caller path.

#### Audit integrity
Successful create writes `SESSION_CREATED` in the same transaction as HuntSession insert.

### Reviews
- Sentinel PASS — enumeration safety, response exposure, conflict non-leakage, transaction integrity, legacy rename regression review
- Compass PASS after remediation — duration rules, boundary tests, scope validation, acceptance coverage

### Remediation accepted
Commit `aab89ff` closed two Step 1 blockers:
- added minimum 30 minute and maximum 24 hour duration enforcement + tests
- confirmed previously flagged out-of-scope file changes were mechanical rename fallout only

### Trust impact
This establishes the Hunt Session Engine v1.0 trust foundation without introducing activation/completion/cancellation risk yet.

## 2026-03-06 — Slice D Step 2 Activation Architecture LOCKED

**Status:** LOCKED  
**Source:** Atlas Step 2 Revision 1 approved by Command

### Scope
Session activation only:
- `POST /api/v2/hunt-sessions/:id/activate`

### Locked design decisions
- Allowed actors:
  - HUNTER (own session only)
  - ADMIN
- LANDOWNER blocked at route layer with `403 "Hunter or Admin role required"`
- HUNTER ownership rule:
  - session missing or `session.hunterId !== actorId` → `404 "Session not found"`
- ADMIN may activate any session
- Activation allowed only from `SCHEDULED`
- Precondition recheck order:
  1. agreement must still be ACTIVE
  2. hunter must still be VERIFIED
  3. timing rule:
     - too early: `now < scheduledStart - 30 minutes` → 409, no mutation
     - too late: `now > scheduledEnd` → failure-cancel path
- Success path:
  - `SCHEDULED -> ACTIVE`
  - set `activatedAt`
  - set `landownerNotifiedAt`
  - write `SESSION_ACTIVATED`
- Failure-cancel path:
  - `SCHEDULED -> CANCELLED`
  - set `cancelledAt`
  - set `cancelledByRole`
  - set `cancellationCategory`
  - write `SESSION_CANCELLED` with human actor
  - co-write `SESSION_ACTIVATION_FAILED` with `actorRole: SYSTEM`
- Too-early activation does not cancel
- `SESSION_CANCELLED` must never use `actorRole: SYSTEM`
- `SESSION_ACTIVATED` must never use `actorRole: SYSTEM`
- All 409 responses use exact body:
  - `"Session cannot be activated"`
- Non-ADMIN success response strips:
  - `hunterId`
  - `landownerId`
- `landownerNotifiedAt` is never returned in response body

### Implementation sequencing
Step 2 approved for build:
- activation service
- activation route
- activation tests only

## 2026-03-06 — Slice D Step 2 COMPLETE (Hunt Session Activation)

**Status:** COMPLETE  
**Commit:** e746ee4  
**Tests:** 423/423 passing

### Scope
Implemented Hunt Session activation only:
- `POST /api/v2/hunt-sessions/:id/activate`
- activation service
- activation route
- activation route/service tests
- required audit event enum additions

No completion / cancel endpoint / detail / list work included in this step.

### What was built

#### Route contract
Added:
- `POST /api/v2/hunt-sessions/:id/activate`

Locked response contracts:
- `401` → `"Unauthorized"`
- `403` → `"Hunter or Admin role required"`
- `404` → `"Session not found"`
- `409` → `"Session cannot be activated"`
- `200` success

### Ownership / access model
- HUNTER may activate only own session
- missing session and foreign HUNTER session both return identical `404 "Session not found"`
- ADMIN may activate any valid session
- LANDOWNER is blocked at route layer with `403`

### Activation behavior
Activation allowed only when:
- session is `SCHEDULED`
- agreement is still `ACTIVE`
- hunter is still `VERIFIED`
- `now >= scheduledStart - 30 minutes`
- `now <= scheduledEnd`

#### Too-early behavior
- returns `409 "Session cannot be activated"`
- session remains `SCHEDULED`
- no DB mutation
- no audit writes

#### Success path
In one transaction:
- session transitions `SCHEDULED -> ACTIVE`
- `activatedAt` set
- `landownerNotifiedAt` set
- `SESSION_ACTIVATED` written with `actorRole` = `HUNTER` or `ADMIN`

#### Failure-cancel path
For:
- agreement invalidated
- hunter verification lapsed
- window expired

In one transaction:
- session transitions `SCHEDULED -> CANCELLED`
- `cancelledAt` set
- `cancelledByRole` set to attempting actor
- `cancellationCategory` set
- `SESSION_CANCELLED` written with human actor (`HUNTER` or `ADMIN`)
- `SESSION_ACTIVATION_FAILED` co-written with `actorRole: SYSTEM`

### Response shaping
Success response rules:
- HUNTER response strips:
  - `hunterId`
  - `landownerId`
- ADMIN response keeps:
  - `hunterId`
  - `landownerId`
- all success responses strip:
  - `landownerNotifiedAt`
  - `cancellationCategory`
  - `cancelledAt`
  - `cancelledByRole`

### Audit / integrity
- `SESSION_CANCELLED` must never use `actorRole: SYSTEM`
- `SESSION_ACTIVATED` must never use `actorRole: SYSTEM`
- `SESSION_ACTIVATION_FAILED` uses `actorRole: SYSTEM`
- `SESSION_ACTIVATION_FAILED.actorId` stored as `null`; attempting actor preserved in diagnostic payload
- rollback coverage added for transaction failure

### Reviews
- Sentinel PASS — enumeration safety, too-early no-mutation rule, failure-path atomicity, no-leak 409 contract, success-field exposure, nullable SYSTEM actorId
- Compass PASS — scope validation, route contract coverage, ownership/admin rules, state guards, boundary timing, dual-audit failure path, response shaping

### Operational note
Schema enum additions require local apply:
- `SESSION_ACTIVATED`
- `SESSION_CANCELLED`
- `SESSION_ACTIVATION_FAILED`

Run:
`npx prisma db push`

## 2026-03-06 — Slice D Step 2 Operational Alignment COMPLETE

**Status:** COMPLETE  
**Commit:** a88305a  
**Tests:** 423/423 passing

### What changed
- Confirmed production database enum `AgreementSessionEvent` already contained:
  - `SESSION_CREATED`
  - `SESSION_ACTIVATED`
  - `SESSION_CANCELLED`
  - `SESSION_ACTIVATION_FAILED`
- Ran `prisma generate`
- Removed temporary enum-cast workaround from activation service
- Verified full suite still passing

### Result
Hunt Session Step 2 is now fully aligned across:
- code
- schema
- generated Prisma client
- production database

## 2026-03-06 — Slice D Step 3 Completion Architecture LOCKED

**Status:** LOCKED  
**Source:** Atlas Step 3 approved by Command

### Scope
Session completion only:
- `POST /api/v2/hunt-sessions/:id/complete`

### Locked design decisions
- Allowed actors:
  - HUNTER (own session only)
  - ADMIN
- LANDOWNER blocked at route layer with `403 "Hunter or Admin role required"`
- HUNTER ownership rule:
  - session missing or `session.hunterId !== actorId` → `404 "Session not found"`
- ADMIN may complete any session
- Completion allowed only from `ACTIVE`
- `outcomeCategory` required at route layer
- Allowed `outcomeCategory` values:
  - `SUCCESSFUL`
  - `NO_ACTIVITY`
  - `ABORTED`
- Missing or invalid body/value returns `400 "Invalid request"`
- `completedAt` is server-authoritative; client-provided timestamp ignored
- Success path:
  - `ACTIVE -> COMPLETED`
  - set `completedAt`
  - set `outcomeCategory`
  - write `SESSION_COMPLETED`
- No failure-path mutation
- No SYSTEM completion-failure audit event in v1
- `SESSION_COMPLETED` must never use `actorRole: SYSTEM`
- All 409 responses use exact body:
  - `"Session cannot be completed"`
- Non-ADMIN success response strips:
  - `hunterId`
  - `landownerId`
- Success response never returns:
  - `landownerNotifiedAt`
  - `cancellationCategory`
  - `cancelledAt`
  - `cancelledByRole`

### Implementation sequencing
Step 3 approved for build:
- completion service
- completion route
- completion tests only

## 2026-03-06 — Slice D Step 3 COMPLETE (Hunt Session Completion)

**Status:** COMPLETE  
**Commit:** 8a75155 (+ subsequent scope-only remediation accepted)  
**Tests:** 476/476 passing

### Scope
Implemented Hunt Session completion only:
- `POST /api/v2/hunt-sessions/:id/complete`
- completion service
- completion route
- completion route/service tests
- required `SESSION_COMPLETED` enum addition

No cancel endpoint / detail / list / audit read work included in this step.

### What was built

#### Route contract
Added:
- `POST /api/v2/hunt-sessions/:id/complete`

Locked response contracts:
- `400` → `"Invalid request"`
- `401` → `"Unauthorized"`
- `403` → `"Hunter or Admin role required"`
- `404` → `"Session not found"`
- `409` → `"Session cannot be completed"`
- `200` success

### Ownership / access model
- HUNTER may complete only own session
- missing session and foreign HUNTER session both return identical `404 "Session not found"`
- ADMIN may complete any valid session
- LANDOWNER is blocked at route layer with `403`

### Completion behavior
Completion allowed only when:
- session is `ACTIVE`
- request body contains valid `outcomeCategory`

Allowed outcome values:
- `SUCCESSFUL`
- `NO_ACTIVITY`
- `ABORTED`

#### Validation behavior
- missing body / invalid JSON / missing `outcomeCategory` / invalid `outcomeCategory` → `400 "Invalid request"`
- service not called on validation failure
- allowed values pass route validation and reach service

#### Failure behavior
- non-ACTIVE session completion attempt returns `409 "Session cannot be completed"`
- no mutation
- no audit write
- no SYSTEM failure event introduced

#### Success path
In one transaction:
- session transitions `ACTIVE -> COMPLETED`
- `completedAt` set from server time
- `outcomeCategory` persisted
- `SESSION_COMPLETED` written with `actorRole` = `HUNTER` or `ADMIN`

### Response shaping
Success response rules:
- HUNTER response strips:
  - `hunterId`
  - `landownerId`
- ADMIN response keeps:
  - `hunterId`
  - `landownerId`
- all success responses strip:
  - `landownerNotifiedAt`
  - `cancellationCategory`
  - `cancelledAt`
  - `cancelledByRole`

### Audit / integrity
- `SESSION_COMPLETED` must never use `actorRole: SYSTEM`
- no audit entry of any kind is written on completion failure
- rollback coverage added for transaction failure
- `completedAt` is server-authoritative; client-provided timestamp ignored

### Reviews
- Sentinel PASS — enumeration safety, route-layer role/validation guards, no-mutation failure semantics, no-leak 409 contract, success redaction, benign `.gitignore` note
- Compass PASS — route contract coverage, validation coverage, ownership/admin rules, state guards, atomicity, success shaping, scope closure after remediation

### Trust impact
This closes the Hunt Session completion boundary, giving the platform a trust-safe lifecycle for:
- session creation
- session activation
- session completion

## 2026-03-09 — Slice D Step 4 accepted: Hunt Session Cancellation

Status: ACCEPTED

Endpoint implemented:
- `POST /api/v2/hunt-sessions/:id/cancel`

Architecture source:
- Atlas — Slice D Step 4: Session Cancellation, Architecture Specification v1.1
- Command binding amendment A1 applied:
  - non-ADMIN success response excludes `hunterId` and `landownerId`
  - ADMIN success response includes `hunterId` and `landownerId`

Accepted implementation commit:
- `19b4a3c`

Files changed:
- `lib/services/hunt-sessions.ts`
- `app/api/v2/hunt-sessions/[id]/cancel/route.ts`
- `tests/api/hunt-sessions-cancel.test.ts`
- `tests/api/hunt-sessions-cancel-service.test.ts`

Accepted behavior:
- Allowed actors:
  - `HUNTER` may cancel own sessions
  - `LANDOWNER` may cancel sessions on owned parcel / trusted landowner-owned session field
  - `ADMIN` may cancel any session
- Allowed transitions:
  - `SCHEDULED -> CANCELLED`
  - `ACTIVE -> CANCELLED`
- Forbidden transitions:
  - `COMPLETED -> 409 "Session cannot be cancelled"`
  - `CANCELLED -> 409 "Session cannot be cancelled"`
- Enumeration-safe ownership:
  - missing session, foreign HUNTER session, and foreign LANDOWNER session all return identical `404 "Session not found"`
- Cancellation category enforcement:
  - `HUNTER -> HUNTER_CANCELLED | SAFETY_CONCERN`
  - `LANDOWNER -> LANDOWNER_CANCELLED | SAFETY_CONCERN`
  - `ADMIN -> ADMIN_CANCELLED | SAFETY_CONCERN`
  - caller-supplied `AGREEMENT_INVALIDATED` always rejected with `400 "Invalid request"`
- Atomic transaction:
  - conditional session update to `CANCELLED`
  - writes `cancelledAt`, `cancelledByRole`, `cancellationCategory` together
  - appends `SESSION_CANCELLED` audit event in same transaction
- Audit payload locked to:
  - `cancelledAt`
  - `cancellationCategory`
  - `priorState`
  - `cancelledByRole`
- Race safety:
  - concurrent cancel uses conditional `updateMany` inside transaction
  - one request succeeds, concurrent loser receives `409`
  - no duplicate audit event
- Response shaping:
  - non-ADMIN returns:
    - `id`
    - `currentState`
    - `scheduledStart`
    - `scheduledEnd`
    - `cancelledAt`
    - `cancelledByRole`
    - `cancellationCategory`
    - `outcomeCategory`
  - ADMIN additionally returns:
    - `hunterId`
    - `landownerId`
  - no leakage of `landownerNotifiedAt` or internal DB timestamps

Validation / review:
- Sentinel: PASS
- Compass: PASS

Acceptance criteria status:
- AC-1 through AC-27 accepted
- Amendment A1 accepted
- B1 null / non-object JSON guard accepted

Hunt Session lifecycle coverage after acceptance:
- `SCHEDULED -> ACTIVE`
- `SCHEDULED -> CANCELLED`
- `ACTIVE -> COMPLETED`
- `ACTIVE -> CANCELLED`
- `COMPLETED` terminal
- `CANCELLED` terminal

Notes:
- No schema migration required for this slice because `cancelledAt`, `cancelledByRole`, and `cancellationCategory` already existed in schema.
- Hunt Session v1 core lifecycle is now operationally complete.

## 2026-03-09 — Slice E1 COMPLETE (Hunter Reliability Metrics Foundation)

Status: COMPLETE  
Commits: 7a00e91, c8d107c  
Tests: 583/583 passing

### Scope
Introduced the Hunter Reliability Engine foundation.

Implemented:

- HunterTrustProfile model
- deterministic reliability score calculation
- rolling 12-month evaluation window
- event-driven trust recalculation
- append-only trust audit events
- nightly cron recalculation to advance rolling window

### Data Model
New table:

HunterTrustProfile

Fields include:

- reliabilityScore (0–100)
- rolling window bounds
- session counts:
  - sessionsCompleted
  - sessionsCancelledByHunter
  - sessionsNoShow
  - sessionsTotalEligible
- confirmedIncidentCount
- recalcVersion
- lastRecalculatedAt

One profile per hunter (unique hunterId).

### Score Model v1
Score derived from completion rate with penalty adjustments:

- completion_rate = completed / eligible
- no-show penalties escalate after first no-show
- confirmed incident penalty = 15 points each (cap 45)
- final score clamped 0–100

### Recalculation Model
Trust profile recalculated when:

- SESSION_COMPLETED
- SESSION_CANCELLED (cancelledByRole = HUNTER)

Recalculation occurs inside the same database transaction as the session mutation.

This guarantees:

- session state change
- trust profile update
- audit event

are committed atomically.

### Audit Integrity
Each recalculation appends:

TRUST_PROFILE_RECALCULATED

Payload includes snapshot of:

- input counts
- reliability score
- formula version
- window bounds

Audit remains append-only.

### Rolling Window Advancement
Added nightly cron job:

/api/cron/recalculate-trust-profiles

Purpose:

advance rolling 12-month window even when no new events occur.

### Tests
Added 32 tests covering:

- score calculation
- penalty tiers
- rolling window filtering
- invariant enforcement
- audit emission
- profile creation

Full suite: 583 / 583 passing.

### Trust Impact
This establishes the platform's first behavioural trust signal.

Reliability scores are now derived entirely from platform-recorded events and cannot be manually manipulated.

## 2026-03-10 — Slice E2 ACCEPTED (No-Show Detection)

Status: ACCEPTED  
Commits: 939e987, 4189941, d6ca61f  
Tests: 634/634 passing

### Scope
Implemented Slice E2 — No-Show Detection.

Added:

- new terminal HuntSession state: `NO_SHOW`
- new route: `POST /api/v2/hunt-sessions/:id/no-show`
- new audit event: `SESSION_NO_SHOW_CONFIRMED`
- reliability integration so `NO_SHOW` feeds `sessions_no_show`

### Locked behavior
Allowed transition:

- `SCHEDULED -> NO_SHOW`

Forbidden:

- `ACTIVE -> NO_SHOW`
- `COMPLETED -> NO_SHOW`
- `CANCELLED -> NO_SHOW`
- `HUNTER -> NO_SHOW`

Allowed actors:

- `LANDOWNER`
- `ADMIN`

Forbidden actor:

- `HUNTER`

### Timing guard
No-show confirmation allowed only when:

- `now >= scheduledStart + 30 minutes`
- `now <= scheduledEnd + 24 hours`

Outside that window:
- reject with `409 "Session cannot be marked as no-show"`

### Ownership / trust protection
- LANDOWNER must own the parcel for the session
- foreign LANDOWNER and missing session are indistinguishable:
  - both return `404 "Session not found"`
- this closes enumeration risk for non-participants

### Atomicity
Successful no-show confirmation executes in one transaction:

1. session state updated to `NO_SHOW`
2. `SESSION_NO_SHOW_CONFIRMED` audit event appended
3. `recalculateHunterTrustProfile(hunterId, tx)` executed in the same transaction

This preserves trust consistency between canonical events and derived reliability metrics.

### Audit
`SESSION_NO_SHOW_CONFIRMED` payload includes:

- `hunter_id`
- `scheduled_start`
- `confirmed_at`
- `eligibility_window_open`

Audit remains append-only.

### Reliability integration
Hunter trust recalculation now derives `sessions_no_show` from canonical HuntSession records where:

- `currentState = NO_SHOW`

Rolling-window counting uses immutable session timing fields and remains drift-safe.

### Notes
Deferred from E2:

- SYSTEM auto-confirmation
- `NO_SHOW_DISPUTED`
- incident reporting
- notifications
- UI

### Verification
- Sentinel: PASS after remediation of foreign-LANDOWNER 403/404 oracle
- Compass: PASS
- Full suite: 634/634 passing

## 2026-03-10 — Slice E3 accepted: Incident Reporting v1.1

Status: ACCEPTED

Summary:
Implemented trust-safe Incident Reporting for landowners to report serious hunter behavior incidents, with admin confirmation/rejection workflow and reliability integration gated strictly behind admin confirmation.

Locked behavior:
- LANDOWNER may submit an incident report only for their own parcel
- Hunter participation boundary requires either:
  - a HuntSession on that parcel involving that hunter, or
  - a non-DRAFT agreement relationship on that parcel
- Hunters have zero visibility into incident reports
- Non-owner / non-participant access returns indistinguishable 404
- Submission has zero effect on HunterTrustProfile
- Only ADMIN confirmation affects reliability
- Reliability uses confirmed incidents within rolling 12 months anchored by `confirmed_at`
- Rejection never affects reliability

Implemented:
- `IncidentReport` model added
- Enums added:
  - `IncidentReportStatus`: `SUBMITTED`, `CONFIRMED`, `REJECTED`
  - `IncidentType`: `UNSAFE_FIREARM_HANDLING`, `PROPERTY_DAMAGE`, `TRESPASS`, `HARASSMENT`, `OTHER`
- New service layer:
  - `submitIncidentReport`
  - `confirmIncidentReport`
  - `rejectIncidentReport`
  - `getIncidentReport`
  - `listIncidentReports`
- New audit events:
  - `INCIDENT_REPORT_SUBMITTED`
  - `INCIDENT_REPORT_CONFIRMED`
  - `INCIDENT_REPORT_REJECTED`
- New API routes:
  - `POST /api/v2/incidents`
  - `GET /api/v2/incidents`
  - `GET /api/v2/incidents/:id`
  - `POST /api/v2/incidents/:id/confirm`
  - `POST /api/v2/incidents/:id/reject`

Security / trust rulings preserved:
- Confirm/reject terminal transition guard moved inside transaction
- Single-winner semantics enforced via conditional update inside tx
- No duplicate terminal audit events on concurrent admin actions
- Reject audit now binds hunter target consistently
- Landowner responses exclude admin-only fields
- No admin queue/list endpoint introduced
- Session linkage guard requires supplied `hunt_session_id` to match both parcel and hunter

Reliability integration:
- `confirmed_incident_count` now derived from source query:
  - `status = CONFIRMED`
  - `confirmed_at >= now() - 12 months`
- `incident_date` is narrative only and not used in reliability scoring

Validation status:
- Sentinel: PASS
- Compass: PASS

Implementation references:
- Base implementation commit: `214dd1a`
- Sentinel fix patch: `020b290`
- AC2 participation-boundary patches:
  - `c8b4a36`
  - `2fa89b3`

Test status:
- 715 / 715 passing at acceptance

Notes:
- Future legal/trust review still required before any hunter-facing notification, dispute workflow, or landowner-visible/public trust-profile expansion.

---

## Open Escalations — Agent OS K1

### ESC-K1-01 — Missing project_id and schema_version in canonical spec DDL

- **Raised by:** Forge
- **Date:** 2026-03-11
- **Issue:** The canonical Memory Engine Architecture Spec v1.1 §4.1–4.6 DDL blocks do not include `project_id` or `schema_version` columns. The TypeScript layer requires both for project isolation and schema versioning. The SQL migration cannot be written until the spec reflects these columns.
- **Dependency chain:**
  1. Atlas revises canonical spec §4.1–4.6 DDL to include `project_id` and `schema_version` columns
  2. Command approves the revision
  3. Forge writes `migration_k1.sql` accordingly
- **Status:** OPEN — awaiting Atlas spec revision, then Command approval.

### ESC-K1-02 — Canonical DB enum representation

- **Raised by:** Forge
- **Date:** 2026-03-11
- **Issue:** The canonical spec uses `ENUM(...)` notation for database column types. This is a spec-level representation choice that requires architectural clarification — should the DB use PostgreSQL `CREATE TYPE ... AS ENUM` or `TEXT` columns with application-layer enum validation? Forge proposed `TEXT`; this is a schema interpretation change that must be resolved at the architecture level, not as an implementation preference.
- **Dependency chain:**
  1. Atlas clarifies/revises canonical spec on DB enum representation
  2. Command approves the approach
  3. Forge implements accordingly
- **Status:** OPEN — awaiting Atlas clarification/revision on canonical DB enum representation, then Command approval.

## Agent OS — Knowledge Layer

### Slice K1 — Memory Engine Foundation
Status: COMPLETE  
Date: 2026-03-11

Architecture:
Atlas Memory Engine Architecture Spec v1.2 approved.

Escalations Resolved:
ESC-K1-01 — Canonical DDL missing `project_id` and `schema_version`
Resolution: Both fields added to all Memory Engine tables (ADR-K1-01).

ESC-K1-02 — Enum representation ambiguity
Resolution: Canonical rule established — enum values stored as `TEXT NOT NULL` with application-layer validation (ADR-K1-02). No PostgreSQL native enums and no CHECK constraints.

Command Rulings:
- `project_id` remains application-enforced (no DB foreign key).
- `pgvector` extension permitted in K1 migration when not already present.

Implementation:
Forge created migration:
`agent-os/schemas/migration_k1.sql`

Tables introduced:
- episodic_event
- semantic_fact
- semantic_fact_event
- decision_event
- tool_invocation
- embedding_record
- embedding_status_event

Database characteristics:
- append-only governance model
- no UPDATE operations
- no DELETE operations
- no PostgreSQL native enums
- no enum CHECK constraints
- no FK on `project_id`
- no RLS
- no triggers

Indexes implemented per Atlas §5.

pgvector:
`CREATE EXTENSION IF NOT EXISTS vector;` added.

Verification:
Sentinel — PASS  
Compass — PASS  
Forge tests — 155/155 passing

Result:
K1 Memory Engine Foundation successfully established.