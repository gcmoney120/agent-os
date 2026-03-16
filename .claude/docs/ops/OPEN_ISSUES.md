---
file_class: CLASS_A_LIVE
owner: Command
write_rule: OVERWRITE
purpose: Tracks open blockers, named notes, and unresolved flags that must be acknowledged before a slice can close or before dependent slices may start. Also contains the stale-content invalidation procedure (AC-5) that agents execute at session start.
---

# OPEN_ISSUES

---

## STALE-CONTENT INVALIDATION PROCEDURE

Execute this checklist at every session start before reading any CLASS A file as authoritative.
If any check fails: STOP. Surface the stale condition to Command. Do not proceed until Command updates the stale file.

**Check 1 — CURRENT_FOCUS.md**
Read CURRENT_FOCUS.md. Read SLICE_LEDGER.md.
STALE if: CURRENT_FOCUS.md references a slice that appears in SLICE_LEDGER.md as ACCEPTED or ACCEPTED_WITH_NOTE, and CURRENT_FOCUS.md has not been updated since that close date.
Action on stale: STOP. Report to Command.

**Check 2 — ACTIVE_SLICE.md**
Read ACTIVE_SLICE.md. Read SLICE_STATUS.md.
STALE if: The slice ID in ACTIVE_SLICE.md does not match the slice ID recorded in SLICE_STATUS.md.
Action on stale: STOP. Report to Command.

**Check 3 — SLICE_STATUS.md**
Read SLICE_STATUS.md. Read SLICE_LEDGER.md.
STALE if: SLICE_STATUS.md does not reflect the outcome recorded in SLICE_LEDGER.md for the current slice (e.g., SLICE_LEDGER.md shows ACCEPTED but SLICE_STATUS.md still shows VALIDATED).
Action on stale: STOP. Report to Command.

**Check 4 — NEXT_ACTION.md**
Read NEXT_ACTION.md. Compare to known completed actions in this session.
STALE if: NEXT_ACTION.md references an action that has already been completed and no new directive has superseded it.
Action on stale: STOP. Report to Command.

**Check 5 — COMMAND_DECISION.md**
Read COMMAND_DECISION.md. Check DECISION_LOG.md for the most recent entry.
STALE if: COMMAND_DECISION.md references a prior submission, and a new PENDING_* file has been written since that decision without a corresponding new entry in DECISION_LOG.md.
Action on stale: STOP. Report to Command.

**Check 6 — ATLAS_LATEST.md**
Read ATLAS_LATEST.md (header/date). Read DECISION_LOG.md for the most recent Atlas ACCEPTED entry.
STALE if: DECISION_LOG.md shows a more recently accepted Atlas submission than the content currently in ATLAS_LATEST.md.
Action on stale: STOP. Report to Command.

**Check 7 — Staleness is a blocking condition**
A stale CLASS A file is not a warning. It is a blocking condition.
No agent proceeds on stale content. Staleness must be resolved by Command before any implementation, review, or validation work begins.

**Check 8 — CLASS B files**
CLASS B files (SYSTEM_STATE.md, DECISION_LOG.md, SLICE_LEDGER.md, archive files) do not go stale.
For SYSTEM_STATE.md: use the milestone/progress history sections as the authoritative record. Summary/control sections may be pending a Command update. Do not treat an outdated summary section as a blocking condition — read the milestone history.

---

## OPEN ISSUES

### F-C1 (OPEN — future slice candidate)
**Raised:** 2026-03-15 (Sentinel R3 TS-2; Compass R3 Note 3)
**Scope:** CLI plan.json structural schema validation
**Description:** `cmdRun` casts `JSON.parse(raw) as PlanArtifact` without structural validation. Invalid plan structures reach `executeRun` and fail gracefully (no panic, no gate bypass). A future slice should add Zod-style or type-guard validation at the CLI boundary before calling `executeRun`.
**Status:** OPEN — future slice candidate. Non-blocking.

### F-C2 (OPEN — future slice candidate)
**Raised:** 2026-03-15 (Compass R3 Note 2)
**Scope:** CLI unit tests for cmdRun and missing-args guard
**Description:** AC-R3-08 and AC-R3-09 are verified by code inspection only. Unit tests for `cmdRun` and the missing `--project`/`--plan` guard would improve regression safety.
**Status:** OPEN — future slice candidate. Non-blocking.

### F-C3 (OPEN — future slice candidate)
**Raised:** 2026-03-15 (Compass R3 Note 1)
**Scope:** K2 data content assertion in AC-R3-06 test
**Description:** The AC-R3-06 test verifies run completion but does not assert K2 backend data content. A future test asserting `k2Backend.snapshotEpisodicEvents().length > 0` after a COMPLETED run would close the evidence gap.
**Status:** OPEN — future slice candidate. Non-blocking.


### AS-2-C1 (OPEN — future Atlas amendment)
**Raised:** 2026-03-15 (Compass AS-4)
**Scope:** AC-AS2-08 text-vs-intent conflict
**Description:** AC-AS2-08 text reads "contains no reference to" — but the independence declarations in sentinel.md/compass.md reference the opposing agent's name and pending file in order to prohibit coordination. Command ruled (DL-013, confirmed DL-014): intent governs; prohibition declaration satisfies independence criterion. Atlas should correct AC-AS2-08 text in a future amendment to read "contains no operational dependency on" or equivalent, eliminating the text-vs-intent gap.
**Status:** OPEN — future Atlas amendment. Non-blocking.

### AS-2-C3 (OPEN — future documentation correction)
**Raised:** 2026-03-15 (Compass AS-4)
**Scope:** AC count discrepancy in ATLAS_LATEST.md and DECISION_LOG.md
**Description:** ATLAS_LATEST.md and DL-012 record 16 AS-2 ACs and 7 AS-4 ACs. Authoritative source (PENDING_ATLAS.md) has 17 AS-2 ACs and 8 AS-4 ACs. Omitted criteria (AC-AS2-17: no agent writes to another agent's PENDING_*.md; AC-AS4-08: DECISION_LOG chain-stage extension backward compatibility) are both FULLY MET per evidence inspection. Atlas should correct the count in a future ATLAS_LATEST.md amendment.
**Status:** OPEN — future documentation correction. Non-blocking.

### AS-2-C4 (OPEN — future template and spec amendment)
**Raised:** 2026-03-15 (Compass AS-4)
**Scope:** TEMPLATE.md "Chain Context Provided" field gap + AC-AS4-05 text inconsistency
**Description:** "Chain Context Provided" per-stage field is absent from Stage 1 (architecturally correct — first dispatch has no prior chain context) and Stage 3 parallel review stages (gap: review agents receive Forge key decisions as dispatch context, this field should be populable). Also: AC-AS4-05 says "six required elements" but enumerates five — Atlas spec error. Future amendment: add "Chain Context Provided" to Stage 3 Sentinel and Compass stage templates; correct "six" to "five" in AC-AS4-05 text.
**Status:** OPEN — future template/spec amendment. Non-blocking.


### B-2-TS1 (OPEN — future governed amendment)
**Raised:** 2026-03-16 (Sentinel B-2-S1 trust review, DL-024 finding S-1)
**Scope:** submission.md Phase 3 — Reroute decision type governance
**Description:** The Reroute decision type (added in B-2-S1) has no maximum iteration count or loop-detection escalation gate. The correction mechanism caps at 2 attempts per stage before escalation to principal; Reroute has no equivalent. Chain context audit trail (rerouting decisions recorded with specific finding + rationale) provides visibility but no automatic stop. Reroute trigger condition ("architectural gap, contradiction, or unresolved question") bounds misuse in practice, but there is no mechanical stop. Risk is operational (Command judgment failure), not systemic.
**Recommended correction:** Future governed amendment to submission.md to add a Reroute count limit or escalation trigger consistent with the correction count mechanism (e.g., maximum 2 Reroutes to the same agent before escalation to principal).
**Status:** OPEN — future governed amendment. Non-blocking.

### X1-TS-1 (OPEN — deferred to X3/X4)
**Raised:** 2026-03-16 (Sentinel X1 trust review, DL-033)
**Scope:** Byte-identity enforcement mechanism for shared dispatch/identity files
**Description:** The full-copy model for dispatch commands and identity files (~13 files identical across agent-os and pest-free-nz repos) relies on Sentinel byte-identity enforcement to detect drift. The specific enforcement mechanism (automated hash comparison, CI check, or manual audit) is deferred to X3/X4. Until then, the copy model is operative but unenforced — drift between repos would not be automatically detected.
**Status:** OPEN — deferred to X3/X4. Non-blocking for X2.

### X1-TS-2 (OPEN — Command pre-X2 action)
**Raised:** 2026-03-16 (Sentinel X1 trust review, DL-033)
**Scope:** .env.production credential exposure — pre-existing
**Description:** `.env.production` is untracked but not listed in `.gitignore`. Contains production credentials (DATABASE_URL, DIRECT_URL, ENCRYPTION_KEY, GMAIL_APP_PASSWORD, NEXTAUTH_SECRET, VERCEL_OIDC_TOKEN). Pre-existing condition, not introduced by X1. Risk: accidental `git add .` could commit credentials.
**Recommended action:** Add `.env.production` to `.gitignore` before X2 activation.
**Status:** OPEN — Command pre-X2 action. Blocking for X2 activation.

### B-2-TS2 (OPEN — future governed amendment)
**Raised:** 2026-03-16 (Sentinel B-2-S1 trust review, DL-024 finding S-2)
**Scope:** COMMAND_ID.md boot procedure — boot step label ordering
**Description:** Boot steps 5a and 5b are labeled "5a" and "5b" but are physically inserted after step 6 in the boot procedure, creating ordering: 1, 2, 3, 4, 5, 6, 5a, 5b, 7, 8. The ordering is architecturally correct and confirmed intentional by DL-023 (step 6 must run first as 5a requires knowledge of which slice is active). No trust risk. The non-sequential labeling creates a cognitive readability risk for future Command operators who may scan the boot procedure numerically.
**Recommended correction:** Future governed amendment to COMMAND_ID.md to rename steps 5a/5b to 6a/6b, matching their physical position in the boot sequence.
**Status:** OPEN — future governed amendment. Non-blocking.

---

## RESOLVED ISSUES

### AS3-F1 / AS-2-C2 (RESOLVED — B-2-S2)
**Raised:** 2026-03-15 (Sentinel AS-3 TS-2 MEDIUM; Compass AS-4 AS-2-C2 — convergent finding)
**Resolved:** 2026-03-16 (B-2-S2, DL-028/DL-029; confirmed by Sentinel TS-1 and Compass AC-B2S2-6)
**Scope:** Authorization gate asymmetry — dispatch/sentinel.md and dispatch/compass.md
**Resolution:** B-2-S2 added explicit STOP instructions to sentinel.md (line 20) and compass.md (line 20): "If COMMAND_DECISION.md does not authorize [Sentinel/Compass] to review, STOP. Do not proceed until Command issues authorization." Both instructions structurally match atlas.md/forge.md authorization pattern. Sentinel verified: "Unambiguous gate" (TS-1 CLEAR). Compass verified: AC-B2S2-6 FULLY MET. Gap fully closed.

### B-1-TS2 (RESOLVED — B-2-S2)
**Raised:** 2026-03-15 (Sentinel B-1 trust review, DL-018)
**Resolved:** 2026-03-16 (B-2-S2, DL-028/DL-029; confirmed by Sentinel TS-2 and Compass AC-B2S2-7)
**Scope:** Defense-in-depth — Continuation Context authorship invariant co-location in dispatch files
**Resolution:** B-2-S2 added authorship invariant ("This block is Command-authored only. Agents do not self-populate or modify it. If no CONTINUATION CONTEXT: block is present in $ARGUMENTS, this is a non-segmented task — proceed normally.") co-located with the Continuation Context detection instruction in all 4 dispatch files (atlas.md lines 55/57, forge.md lines 54/56, sentinel.md lines 55/57, compass.md lines 55/57). Sentinel verified: B-1-TS2 CONFIRMED RESOLVED (TS-2 CLEAR). Compass verified: AC-B2S2-7 FULLY MET. Gap fully closed.

### B-1-TS7 (RESOLVED — B-2-S1)
**Raised:** 2026-03-15 (Sentinel B-1 trust review, DL-018; pre-existing carry-forward from DL-016)
**Resolved:** 2026-03-16 (B-2-S1, DL-026; confirmed by Compass AC-B2S1-8, DL-025)
**Scope:** review/submission.md Phase 1 routing — STATUS: SEGMENT-COMPLETE
**Resolution:** B-2-S1 Insertion 1 added SEGMENT-COMPLETE as an explicit Phase 1 routing case with a 4-step handler. The handler explicitly does not route SEGMENT-COMPLETE to Phase 2 adversarial review. The gap is fully closed.

### R3-C1 (RESOLVED — R3)
**Resolved:** 2026-03-15. `deriveCapabilities` dedup guard corrected to `caps.includes("output_required")`. Sentinel TS-1 confirmed.

### R3-C2 (RESOLVED — R3)
**Resolved:** 2026-03-15. `isStepIdSafe` regex validator added and wired as first operation in `writeStepReport`. Sentinel TS-4 full audit confirmed.

### R3-C3 (RESOLVED — R3)
**Resolved:** 2026-03-15. `appendEvent` now persists K1 EpisodicEvent via `memoryStore().appendEpisodicEvent`. Sentinel TS-5 confirmed.

### R3-C4 (RESOLVED — R3)
**Resolved:** 2026-03-15. Two tests added to `bridge.test.ts` covering `BRIDGE_UNKNOWN_AGENT_ROLE` error path. Compass confirmed.

### NB-2 (RESOLVED)
**Raised:** 2026-03-15 (identified during R1 Forge deliverable review)
**Resolved:** 2026-03-15 (R2 Phase 1)
**Scope:** Pre-existing tsc errors in modified/untracked files outside R1 scope
**Resolution:** Forge resolved all 11 errors across 13 files. `validateStepReport` return type aligned; no validation logic changed; no behavior change. `tsc --noEmit` → 0 errors. Confirmed by Sentinel TS-3 (CLEAR).

### NB-1 (RESOLVED)
**Raised:** 2026-03-14 (carried from P1-S7)
**Resolved:** 2026-03-15 (confirmed during R1 — fix was applied in a prior session)
**Scope:** processHandoff / RunLedger readiness_verdict type alignment
**Resolution:** `processHandoff` in `execution.ts` (line 330) explicitly sets `readiness_verdict: null`. P1-S3 test helper in `planner-p1s3.test.ts` (line 233) includes `readiness_verdict: null`. The 2 NB-1-attributable tsc errors are absent from current `tsc --noEmit` output. No interface change — implementation compliance only.
