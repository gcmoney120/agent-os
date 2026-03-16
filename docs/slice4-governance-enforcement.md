# Slice 4 — Governance Enforcement Layer (LOCKED FOR IMPLEMENTATION)

**Status:** Locked for Implementation
**Date:** 2026-02-27
**Author:** Command
**Supersedes:** Any earlier Slice 4 draft

---

## 1. Purpose

Slice 4 adds a deterministic, policy-driven governance layer to `dispatchRun()`. After each step's StepReport is validated, the dispatcher evaluates the report's `state_impact` against the project adapter's governance configuration and either continues execution (auto_apply) or halts (require_manual_approval). All decisions are derived solely from the validated StepReport and the locked adapter — no runtime state, no LLM calls, no side effects beyond halting.

---

## 2. Scope Boundary

**In scope:**

- A pre-run adapter governance validation gate (runs before any step executes).
- A pure governance decision function that maps `(state_impact, trust_notes, adapter.governance)` to `auto_apply | require_manual_approval`.
- Integration of the decision function into `dispatchRun()` at the correct ordering point.
- Hard-fail error codes for all violation conditions.
- Acceptance criteria and edge case resolution.

**Out of scope (explicitly prohibited — see also §12):**

- Approval acknowledgment workflows.
- New Foreman run states.
- Changes to `StepReportV1` schema.
- Changes to `ProjectAdapter` schema.
- Changes to tools/capabilities behavior.
- Writing to `SYSTEM_STATE.md`.
- Any dynamic, runtime, or LLM-derived governance logic.

---

## 3. Governance Inputs

The governance decision function receives exactly these inputs. No other inputs are permitted.

| Input | Source | Type |
|---|---|---|
| `state_impact` | Validated `StepReportV1.state_impact` | `"none" \| "trivial" \| "trust_change" \| "phase_boundary"` |
| `trust_notes` | Validated `StepReportV1.trust_notes` | `string \| undefined` |
| `auto_apply_for` | `adapter.governance.system_state_updates.auto_apply_for` | `string[]` |
| `require_manual_approval_for` | `adapter.governance.system_state_updates.require_manual_approval_for` | `string[]` |

The adapter object passed to `dispatchRun()` via `deps.loadProjectAdapter()` is the sole source of governance configuration. The governance fields are read from the adapter after the pre-run gate (§4) has confirmed their validity. No re-validation occurs per-step.

---

## 4. Adapter Governance Validation (Pre-Run Gate)

This gate executes **once**, before any step in the run begins. If it fails, no steps execute and the dispatcher returns `{ ok: false }` immediately.

The following conditions must all hold. If any condition is violated, return `ADAPTER_GOVERNANCE_MISCONFIGURED`:

1. `adapter.governance.system_state_updates.mode === "hybrid"`
2. `adapter.governance.system_state_updates.require_manual_approval_for` is an array and includes the string `"trust_change"`.
3. `adapter.governance.system_state_updates.auto_apply_for` is an array and includes the string `"trivial"`.

**Validation is structural only.** The gate does not evaluate whether the full policy is sensible for a given run — it confirms minimum required fields are present and correctly typed.

**Error response shape on gate failure:**

```
{
  ok: false,
  run_id: <req.run_id>,
  error: {
    code: "ADAPTER_GOVERNANCE_MISCONFIGURED",
    message: <description of which condition failed>,
  },
  written_step_reports: []
}
```

No steps are attempted. `written_step_reports` is always empty when this error is returned.

---

## 5. Governance Decision Function (Pure)

```
governanceDecision(
  state_impact: string,
  trust_notes: string | undefined,
  auto_apply_for: string[],
  require_manual_approval_for: string[]
): "auto_apply" | "require_manual_approval"
```

**Preconditions (caller must guarantee before invoking):**

- `state_impact` is one of `{ "none", "trivial", "trust_change", "phase_boundary" }`. Any other value must have already caused a hard-fail (see §7 — `STEP_REPORT_INVALID`). The function does not re-validate this; it asserts.
- If `state_impact === "trust_change"`, `trust_notes` must be a non-empty string (trim().length > 0). The function does not re-validate this; the `TRUST_CHANGE_MISSING_NOTES` check must have already fired (see §7).

**The function is pure:** it has no side effects, reads no external state, and its output is fully determined by its inputs.

**Decision logic (see full matrix in §6):**

- `"none"` → always `auto_apply`.
- `"trivial"` → `auto_apply` if and only if `"trivial" ∈ auto_apply_for`; otherwise `require_manual_approval`.
- `"trust_change"` → always `require_manual_approval`.
- `"phase_boundary"` → `auto_apply` if and only if `"phase_boundary" ∈ auto_apply_for`; otherwise `require_manual_approval`. **Absence is not permission.**

Membership tests use strict string equality. No case folding, no trimming, no partial matching.

---

## 6. Explicit Rule Matrix

| `state_impact` | Condition | Decision |
|---|---|---|
| `none` | always | `auto_apply` |
| `trivial` | `"trivial" ∈ auto_apply_for` | `auto_apply` |
| `trivial` | `"trivial" ∉ auto_apply_for` | `require_manual_approval` |
| `trust_change` | always | `require_manual_approval` |
| `phase_boundary` | `"phase_boundary" ∈ auto_apply_for` | `auto_apply` |
| `phase_boundary` | `"phase_boundary" ∉ auto_apply_for` | `require_manual_approval` |

**Unknown or missing `state_impact` is not a row in this table.** It is a hard-fail (`STEP_REPORT_INVALID`) that must occur before this function is ever called. There is no fallthrough, no default row, and no implied permissiveness for unrecognised values.

---

## 7. Failure Conditions (Hard-Fail Codes)

All failures return `{ ok: false }` and halt the dispatcher immediately. No subsequent steps execute after any failure.

### `ADAPTER_GOVERNANCE_MISCONFIGURED`

**When:** Pre-run gate (§4) detects adapter governance fields missing or incorrect.
**Specifically:**
- `mode !== "hybrid"`, or
- `require_manual_approval_for` is absent, not an array, or does not contain `"trust_change"`, or
- `auto_apply_for` is absent, not an array, or does not contain `"trivial"`.

**Effect:** No steps execute. `written_step_reports: []`.

---

### `STEP_REPORT_INVALID`

**When:** The StepReport returned by a runner is structurally invalid **or** contains a `state_impact` value that is missing or not one of `{ "none", "trivial", "trust_change", "phase_boundary" }`.

**This code is the Slice 4 extension of the existing `DISPATCH_STEP_REPORT_INVALID` / `DISPATCH_STEP_REPORT_MISSING` error surface.** Implementors must use the appropriate existing code for the pre-existing validation cases (runner returns no report, report fails Slice 2 validator). The `STEP_REPORT_INVALID` code defined here is used only when Slice 2 validation passes but governance-layer validation rejects the `state_impact` value — which in practice cannot occur since the Slice 2 validator already enforces the `state_impact` enum. Therefore: **if the Slice 2 `validateStepReport` dependency already rejects unknown `state_impact` values (which it does), `STEP_REPORT_INVALID` need not be raised as a separate code in normal flow.** However, the governance decision function must assert the precondition and must never silently auto-apply an unknown `state_impact`. If the precondition assertion fires (implementation-level defensive check), the dispatcher must surface `STEP_REPORT_INVALID` and halt.

**Effect:** Dispatcher halts. `written_step_reports` contains reports written before this step.

---

### `TRUST_CHANGE_MISSING_NOTES`

**When:** `state_impact === "trust_change"` and `trust_notes` is either absent or is a string whose `trim().length === 0`.
**Timing:** This check must occur **before** the governance decision function is called and **before** any governance decision is emitted.
**This is a hard-fail.** It is not a soft warning.

**Effect:** Dispatcher halts. `written_step_reports` contains reports written before this step. The StepReport is **not** written to disk for the failing step.

---

### `DISPATCH_HALTED_GOVERNANCE`

**When:** The governance decision function returns `require_manual_approval`.
**This is not an error in the traditional sense** — the adapter policy is working correctly. However, it halts the dispatcher and must be surfaced to the caller as `{ ok: false }` so that the calling orchestration layer can take appropriate action.

**Error shape:**

```
{
  ok: false,
  run_id: <req.run_id>,
  error: {
    code: "DISPATCH_HALTED_GOVERNANCE",
    message: "manual approval required before execution can continue",
    step_index: <step.step_index>,
    step_id: <step.step_id>,
    actor: <step.actor>,
    cause: {
      state_impact: <value>,
      decision: "require_manual_approval"
    }
  },
  written_step_reports: <all reports written up to and including this step>
}
```

The StepReport for the halting step **has already been written** to disk before the governance decision is evaluated (see §8 ordering). The halting step's entry **is included** in `written_step_reports`.

---

## 8. Dispatcher Integration Point (Ordering Locked)

The following ordering is locked and must not be altered. Each number represents a distinct phase within `dispatchRun()`.

**One-time pre-run gate (before the step loop):**

1. Validate adapter governance fields → `ADAPTER_GOVERNANCE_MISCONFIGURED` on failure.

**Per-step loop (for each step, in order):**

2. Validate `step_id` is filesystem-safe (existing Slice 3 guard — unchanged).
3. Resolve `input_ref` (existing Slice 3 — unchanged).
4. Build and deep-freeze `FrozenStepContext` (existing Slice 3 — unchanged).
5. Invoke runner → `DISPATCH_RUNNER_FAILED` on throw.
6. Assert `step_report` present → `DISPATCH_STEP_REPORT_MISSING` on absence.
7. Validate `step_report` via `deps.validateStepReport()` → `DISPATCH_STEP_REPORT_INVALID` on failure.
8. **(Slice 4 — new)** If `state_impact === "trust_change"`, assert `trust_notes` is non-empty → `TRUST_CHANGE_MISSING_NOTES` on failure.
9. **(Slice 4 — new)** Assert `state_impact` is a known value (defensive) → `STEP_REPORT_INVALID` if assertion fails.
10. Write `step_report` via `deps.writeStepReport()` → `DISPATCH_WRITE_FAILED` on failure.
11. Record written path in `written_step_reports`.
12. **(Slice 4 — new)** Evaluate governance decision: `governanceDecision(state_impact, trust_notes, auto_apply_for, require_manual_approval_for)`.
13. **(Slice 4 — new)** If decision is `require_manual_approval` → return `DISPATCH_HALTED_GOVERNANCE` (halt; do not execute next step).
14. If decision is `auto_apply` → continue to next step.

**Immutable ordering constraints:**

- The pre-run governance gate (step 1) must complete before the step loop begins.
- The `TRUST_CHANGE_MISSING_NOTES` check (step 8) must occur before `writeStepReport` (step 10). A report with a trust_change violation is never written to disk.
- The governance decision (step 12) must occur after `writeStepReport` (step 10). The StepReport is persisted regardless of the governance outcome; the governance decision controls whether execution continues, not whether the report is saved.
- No retroactive rollback. Steps that completed before a halt are not undone.

---

## 9. Run State Constraints

Slice 4 introduces **no new run states**.

The dispatcher operates on a simple linear execution model: steps execute in order until completion, a hard-fail, or a governance halt. The `DISPATCH_HALTED_GOVERNANCE` result is an orchestration signal to the caller, not a persistent state recorded in the Foreman ledger or any other store.

Approval acknowledgment — the mechanism by which a halted run is resumed after human approval — is **future Agent OS scope** and is explicitly out of scope for Slice 4. The dispatcher has no `resume()` entry point. No `awaiting_approval` state is defined, stored, or checked.

---

## 10. Determinism Guarantees

The governance enforcement layer must satisfy all of the following determinism properties:

1. **Pure decision function.** `governanceDecision()` reads only its arguments. Given identical inputs, it always returns the same output. It has no side effects and reads no global, mutable, or external state.

2. **Adapter read-once.** Governance configuration is read from the adapter once, at the start of the pre-run gate. It is not re-read per step. The adapter object is already deep-frozen by the time it reaches `FrozenStepContext.adapter` (existing Slice 3 guarantee). The governance fields extracted from it must be treated as immutable for the duration of the run.

3. **No clock, no randomness.** The governance layer introduces no calls to `Date.now()`, `Math.random()`, `crypto.randomUUID()`, or any equivalent.

4. **Membership test is exact string equality.** `auto_apply_for.includes("trivial")` is the canonical check. No normalisation, no case folding, no regex. An adapter that contains `"Trivial"` does not satisfy the `"trivial"` requirement.

5. **Halt is unconditional.** When `require_manual_approval` is returned, the dispatcher always halts. There is no retry, no bypass, no configurable threshold. The halt decision cannot be overridden by any field in the request, context, or runner output.

6. **Error codes are stable.** The four codes defined in §7 (`ADAPTER_GOVERNANCE_MISCONFIGURED`, `STEP_REPORT_INVALID`, `TRUST_CHANGE_MISSING_NOTES`, `DISPATCH_HALTED_GOVERNANCE`) are the complete set introduced by Slice 4. No additional codes are permitted without a spec revision.

---

## 11. Edge Case Resolution Table

| Scenario | Expected Behaviour |
|---|---|
| `state_impact === "phase_boundary"` and `auto_apply_for` is `["trivial"]` | `require_manual_approval`. Absence of `"phase_boundary"` in `auto_apply_for` is not permission. |
| `state_impact === "phase_boundary"` and `auto_apply_for` is `["trivial", "phase_boundary"]` | `auto_apply`. Explicit inclusion is required. |
| `state_impact === "trust_change"` and `trust_notes` is `"  "` (whitespace only) | `TRUST_CHANGE_MISSING_NOTES`. `trim().length === 0` fails the non-empty check. |
| `state_impact === "trust_change"` and `trust_notes` is `undefined` | `TRUST_CHANGE_MISSING_NOTES`. Absence is treated identically to empty. |
| `state_impact === "none"` and `require_manual_approval_for` includes `"none"` | `auto_apply`. The `require_manual_approval_for` array is **not consulted** for the `"none"` impact. `"none"` is always auto-applied. |
| `state_impact === "trivial"` and `require_manual_approval_for` includes `"trivial"` AND `auto_apply_for` includes `"trivial"` | `auto_apply`. The decision rule for `"trivial"` is: `auto_apply_for` membership determines the outcome. A conflicting `require_manual_approval_for` entry does not override it. |
| Adapter `auto_apply_for` contains `"trust_change"` | `require_manual_approval` is still returned. `trust_change` is always `require_manual_approval` regardless of `auto_apply_for` contents. The governance decision function hard-codes this. |
| Runner output contains a `state_impact` that is a valid enum value but `validateStepReport` was mocked to return `{ ok: true }` without actually checking it | Governance defensive assert (step 9 in §8) catches the invalid value and returns `STEP_REPORT_INVALID`. This is the last line of defence and must not be omitted. |
| First step halts with `DISPATCH_HALTED_GOVERNANCE` | Second step never executes. First step's report is in `written_step_reports`. |
| `ADAPTER_GOVERNANCE_MISCONFIGURED` fires | `written_step_reports` is `[]`. The pre-run gate fires before any step begins. |
| Adapter `require_manual_approval_for` contains `"trust_change"` but `auto_apply_for` does not contain `"trivial"` | Pre-run gate fails → `ADAPTER_GOVERNANCE_MISCONFIGURED`. Both conditions must hold. |

---

## 12. Out-of-Scope (Explicitly Prohibited)

The following must not appear in the Slice 4 implementation:

- **Approval acknowledgment.** No `approve()`, `resume()`, `acknowledgeApproval()`, or equivalent entry point. No reading of an approval token, file, or flag to resume a halted run.
- **New Foreman run states.** No `AWAITING_APPROVAL`, `PAUSED`, `PENDING_REVIEW`, or equivalent state added to the Foreman ledger or `HuntSessionStatus`/`RunState` enums.
- **StepReport schema changes.** `StepReportV1` in `src/step-report/stepReport.schema.ts` must not be modified.
- **ProjectAdapter schema changes.** The `ProjectAdapter` interface in `src/adapter/schema.ts` must not be modified.
- **SYSTEM_STATE.md writes.** The dispatcher must not write to `SYSTEM_STATE.md` or any human-facing governance document. Adapter governance configuration declares policy only; it has no write authority.
- **Dynamic governance loading.** Governance configuration must not be loaded from a network resource, environment variable, or any source other than the adapter object provided by `deps.loadProjectAdapter()`.
- **LLM calls or agent invocations.** The governance decision function is pure and computational. It calls no external service.
- **Retroactive rollback.** Steps completed before a governance halt are not undone, reversed, or marked as invalid.
- **Soft warnings.** Every governance violation defined in §7 is a hard-fail. There is no `{ ok: true, warnings: [...] }` variant.
- **New capability definitions.** Slice 4 does not introduce new entries into the `capabilities` array or expand the capability model.
- **Changes to the test script or package.json** beyond what is required to register the new test file for Slice 4.

---

## 13. Acceptance Criteria

All acceptance criteria must be satisfied by automated tests using the Node.js native test runner (`node:test`) with stub deps. No real filesystem access in tests.

**AC1 — Pre-run gate: mode violation**
Adapter has `mode: "not-hybrid"` → `DISPATCH_HALTED_GOVERNANCE` is not returned; instead `ADAPTER_GOVERNANCE_MISCONFIGURED` is returned before any step executes. `written_step_reports` is `[]`.

**AC2 — Pre-run gate: missing trust_change in require_manual_approval_for**
Adapter `require_manual_approval_for` does not include `"trust_change"` → `ADAPTER_GOVERNANCE_MISCONFIGURED`. No steps execute.

**AC3 — Pre-run gate: missing trivial in auto_apply_for**
Adapter `auto_apply_for` does not include `"trivial"` → `ADAPTER_GOVERNANCE_MISCONFIGURED`. No steps execute.

**AC4 — auto_apply: none**
Step report has `state_impact: "none"` → governance decision is `auto_apply`. Dispatcher continues. Result is `{ ok: true }` (single step run completes successfully).

**AC5 — auto_apply: trivial in auto_apply_for**
Step report has `state_impact: "trivial"`, adapter `auto_apply_for` includes `"trivial"` → `auto_apply`. Dispatcher continues.

**AC6 — require_manual_approval: trivial not in auto_apply_for**
Adapter `auto_apply_for` is `["other_thing"]` (does not include `"trivial"`), step report has `state_impact: "trivial"` → `DISPATCH_HALTED_GOVERNANCE`. Step report is in `written_step_reports`.

**AC7 — require_manual_approval: trust_change always halts**
Step report has `state_impact: "trust_change"`, `trust_notes: "reason"`, adapter `auto_apply_for` includes `"trust_change"` (adversarial adapter) → `DISPATCH_HALTED_GOVERNANCE`. The `auto_apply_for` value is ignored for `trust_change`.

**AC8 — require_manual_approval: phase_boundary not in auto_apply_for**
Adapter `auto_apply_for` is `["trivial"]`, step report has `state_impact: "phase_boundary"` → `DISPATCH_HALTED_GOVERNANCE`. Absence of `"phase_boundary"` in `auto_apply_for` is not permission.

**AC9 — auto_apply: phase_boundary explicitly in auto_apply_for**
Adapter `auto_apply_for` is `["trivial", "phase_boundary"]`, step report has `state_impact: "phase_boundary"` → `auto_apply`. Dispatcher continues.

**AC10 — TRUST_CHANGE_MISSING_NOTES: trust_notes absent**
Step report has `state_impact: "trust_change"`, `trust_notes` is `undefined` → `TRUST_CHANGE_MISSING_NOTES`. `writeStepReport` is not called for this step.

**AC11 — TRUST_CHANGE_MISSING_NOTES: trust_notes whitespace only**
Step report has `state_impact: "trust_change"`, `trust_notes: "   "` → `TRUST_CHANGE_MISSING_NOTES`. `writeStepReport` is not called for this step.

**AC12 — Halt is fail-fast: step 1 halts, step 2 runner never called**
Two-step run. Step 0 report has `state_impact: "trust_change"`, `trust_notes: "reason"` → governance halts after step 0. Step 1 runner is never invoked. `written_step_reports` contains step 0 only.

**AC13 — DISPATCH_HALTED_GOVERNANCE result shape**
On governance halt, result includes: `ok: false`, `error.code === "DISPATCH_HALTED_GOVERNANCE"`, `error.step_index`, `error.step_id`, `error.actor`, `error.cause.state_impact`, `written_step_reports` containing the halting step's entry.

**AC14 — StepReport written before governance decision**
On a step that results in `DISPATCH_HALTED_GOVERNANCE`, `writeStepReport` was called exactly once for that step before the halt was returned. Verify via spy on `deps.writeStepReport`.

**AC15 — Pre-run gate fires before any runner**
Misconfigured adapter → `ADAPTER_GOVERNANCE_MISCONFIGURED` returned. Runner for step 0 is never called. Verify via spy.
