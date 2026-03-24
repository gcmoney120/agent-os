---
file_class: CLASS_A_LIVE
owner: Command
write_rule: OVERWRITE
purpose: Master reference for the shared file set between agent-os and all consuming projects. Lists all files under byte-identity enforcement and documents the Sentinel comparison protocol. Agent-os is the canonical source.
---

# Shared Files — Master Byte-Identity Enforcement Reference

## Canonical source

Agent-os is the canonical source for all shared files. No consuming project may independently amend a shared file. All amendments originate in agent-os.

## Consuming projects

| # | Project | Path |
|---|---------|------|
| 1 | PestFree NZ | `C:/Users/Cyronick/Documents/Pest Control App/` |
| 2 | ClearPath | `C:/Users/Cyronick/Documents/clearpath/` |
| 3 | BrightSteps | `C:/Users/Cyronick/Documents/brightsteps/` |

## Shared file set (19 files)

All files listed below must be byte-identical between agent-os and every consuming project. Agent-os is the canonical source.

| # | Path | Type |
|---|------|------|
| 1 | `.claude/commands/dispatch/atlas.md` | Dispatch command |
| 2 | `.claude/commands/dispatch/forge.md` | Dispatch command |
| 3 | `.claude/commands/dispatch/sentinel.md` | Dispatch command |
| 4 | `.claude/commands/dispatch/compass.md` | Dispatch command |
| 5 | `.claude/commands/govern/activate-slice.md` | Governance command |
| 6 | `.claude/commands/govern/close-slice.md` | Governance command |
| 7 | `.claude/commands/govern/express.md` | Governance command |
| 8 | `.claude/commands/govern/init-project.md` | Governance command |
| 9 | `.claude/commands/govern/plan.md` | Governance command |
| 10 | `.claude/commands/review/submission.md` | Review command |
| 11 | `.claude/commands/handoff.md` | Workflow command |
| 12 | `.claude/commands/pre-deploy.md` | Workflow command |
| 13 | `.claude/commands/bulk-edit.md` | Workflow command |
| 14 | `.claude/docs/agents/COMMAND_ID.md` | Agent identity |
| 15 | `.claude/docs/agents/ATLAS_ID.md` | Agent identity |
| 16 | `.claude/docs/agents/FORGE_ID.md` | Agent identity |
| 17 | `.claude/docs/agents/SENTINEL_ID.md` | Agent identity |
| 18 | `.claude/docs/agents/COMPASS_ID.md` | Agent identity |
| 19 | `.claude/docs/chains/TEMPLATE.md` | Chain template |

## Files NOT in the shared set

- `.claude/docs/governance/CONTROL_PLANE_OPERATING_MODEL.md` — each project has its own variant with the same §1–§15 body but project-specific provenance header
- `.claude/docs/architecture/templates/*` — copy-once starting points, may diverge per project
- All `.claude/docs/ops/*` state files — entirely project-specific
- `agent-os.project.json` — generated per project by `init-project`
- `.claude/settings.local.json` — project-specific permissions

## Governance rule

When agent-os amends any shared file, the same amendment must be propagated to all consuming projects. Propagation is not required in the same slice, but must happen before the next slice in that project that touches shared-file-dependent behavior.

## Sentinel byte-identity enforcement protocol

During any review of a shared-surface slice (a slice that touches or depends on shared files), Sentinel must execute the following comparison:

1. For each file in the shared file set (16 files), compare every consuming project's version against the agent-os version.
2. **Comparison method:** `diff` or equivalent byte-level comparison.
3. **Agent-os path:** `C:/Users/Cyronick/Documents/agent-os/.claude/[path]`
4. **Per-project paths:** As listed in the consuming projects table above, plus `/.claude/[path]`
5. **Finding severity:** Any difference between a consuming project's file and its agent-os counterpart = **HIGH** finding (unauthorized divergence).
6. Sentinel reports all HIGH findings. Zero differences across all files and projects = CLEAR.

## Notes

- `.gitattributes` with `* text=auto` must be present in all repos to ensure consistent line-ending normalization, preventing false positives in byte-identity comparisons.
- When a new consuming project is added, update this file and create a project-scoped `shared-files.md` in the new project.
