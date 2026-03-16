# Agent OS — CURRENT FOCUS

## Current slice
X2 — Physical Extraction

## Current phase
X-Series — Repository Extraction (X1 → X2 → X3 → X4)

## X-Series status
X1: ACCEPTED (DL-035, SL-012) — Extraction manifest operative
X2: ACTIVE — DEFINED (Atlas architecture required)
X3: Not started — PestFree NZ governance bootstrap
X4: Not started — Parallel operation validation

## X-Series context
X-Series extracts Agent OS from the PestFree NZ host repository into a standalone git repository. The current repo becomes pest-free-nz (app code stays in place). Agent OS becomes an independent repo consumed via npm workspace (local dev) or published package (production). Four slices: X1 (audit), X2 (scaffold agent-os repo), X3 (bootstrap pest-free-nz governance), X4 (parallel operation validation).

## X2 scope
Physical extraction: workspace root creation, agent-os repo initialization with fresh git history, file moves per extraction manifest, governance tree setup, test suite validation. Extraction manifest (`.claude/docs/ops/extraction-manifest.md`) is binding — all file dispositions pre-decided by X1.

## B-Series status (prior series — complete)
B-1: ACCEPTED_WITH_NOTE (DL-020; SL-010) — Session Boundary Protocol operative
B-2: ACCEPTED (DL-030, SL-011) — Command Orchestration Layer operative

## A-Series status (prior series — complete)
AS-1: COMPLETE — Architecture Pack (DL-012)
AS-2: ACCEPTED_WITH_NOTE (DL-014) — 7 command files live, §38 operative, §14 operative

## What is now operational
- `/dispatch/atlas` — boot Atlas for architecture work
- `/dispatch/forge` — boot Forge for implementation
- `/dispatch/sentinel` — boot Sentinel for trust review
- `/dispatch/compass` — boot Compass for validation
- `/review/submission` — Command three-phase review protocol
- `/govern/activate-slice` — formal slice activation
- `/govern/close-slice` — formal slice closure
- `/govern/plan` — Command planning slash command
- Chain Context Document system (`.claude/docs/chains/`)
- Extraction manifest operative (`.claude/docs/ops/extraction-manifest.md`)
- COMMAND_ID.md §38–§40 operative
- CONTROL_PLANE_OPERATING_MODEL.md §14–§15 operative

## Control-plane layer status
CTRL-S1 through CTRL-S6: ACCEPTED — COMPLETE

## Knowledge Layer status
K1–K13: COMPLETE

## R-Series status
R1–R3: COMPLETE (DL-008/DL-010/DL-011)
1398/1398 tests pass | 0 tsc errors

## Open carry-forward items (non-blocking)
- X1-TS-1: Byte-identity enforcement mechanism deferred to X3/X4
- AS-2-C1: AC-AS2-08 text correction (future Atlas amendment)
- AS-2-C3: AC count documentation correction (future Atlas amendment)
- AS-2-C4: TEMPLATE.md field gap + AC-AS4-05 text (future amendment)
- F-C1: CLI plan.json schema validation
- F-C2: CLI unit tests for cmdRun
- F-C3: K2 data content assertion
- B-2-TS1: Reroute loop-detection gate in submission.md (future governed amendment)
- B-2-TS2: Boot step 5a/5b label ordering rename in COMMAND_ID.md (future governed amendment)

## Next action
Dispatch Atlas to produce X2 architecture pack for Physical Extraction.
