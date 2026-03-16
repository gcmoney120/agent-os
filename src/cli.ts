#!/usr/bin/env node
/**
 * Agent OS CLI — v1.0.
 *
 * Usage:
 *   agent-os validate [--project <path>]
 *   agent-os step-report-demo
 *   agent-os relay approve --run <run_id> --step <step_id|step_index> --approved-by <id> --note <note>
 *   agent-os relay resume --run <run_id> --step <step_id|step_index>
 *
 * --project defaults to the current working directory when omitted.
 * Exits 0 on success, 1 on failure.
 * Summary is written to stdout; errors to stderr.
 */

import { resolve } from "node:path";
import * as fs from "node:fs/promises";
import { loadProjectAdapter } from "./adapter/loadProjectAdapter.js";
import { relayExport } from "./relay/export.js";
import { relayImport } from "./relay/import.js";
import { relayExportRun } from "./relay/export-run.js";
import { relayImportRun } from "./relay/import-run.js";
import { validateStepReportV1 } from "./step-report/validateStepReport.js";
import { writeStepReport } from "./step-report/writeStepReport.js";
import { writeApprovalArtifact } from "./approval/writeApproval.js";
import type { StepReportV1 } from "./step-report/stepReport.schema.js";
import { executeRun } from "./runtime/orchestrator.js";
import type { PlanArtifact } from "./planner/types.js";

// ── Argument parsing ──────────────────────────────────────────────────────────

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

function usage(): void {
  process.stderr.write(
    "Usage:\n  agent-os validate [--project <path>]\n  agent-os step-report-demo\n" +
    "  agent-os run --project <path> --plan <plan.json>\n" +
    "  agent-os relay export --run <run_id> --step <id|index> --artifacts-root <path> --out <dir>\n" +
    "  agent-os relay import --bundle <path> --into <artifact_root> [--overwrite]\n" +
    "  agent-os relay export-run --run-id <id> --runs-root <path> --out <dir> [--overwrite]\n" +
    "  agent-os relay import-run <bundle> --into <runs_root> [--overwrite]\n" +
    "  agent-os relay approve --run <run_id> --step <step_id|step_index> --approved-by <id> --note <note> [--runs-root <path>]\n" +
    "  agent-os relay resume --run <run_id> --step <step_id|step_index>\n",
  );
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdValidate(argv: string[]): void {
  const projectRoot = resolve(getArg(argv, "--project") ?? ".");
  const result = loadProjectAdapter(projectRoot);

  if (!result.ok) {
    process.stderr.write(`agent-os validate: FAILED [${result.code}]\n  ${result.message}\n`);
    process.exit(1);
  }

  const { adapter, resolvedPaths } = result;
  const ssu = adapter.governance.system_state_updates;

  const lines = [
    "agent-os validate: OK",
    "",
    `  Project:    ${adapter.project.name} (${adapter.project.slug})`,
    `  Schema:     ${adapter.schema_version}`,
    "",
    "  Paths:",
    `    system_state:     ${resolvedPaths.systemState}`,
    `    run_root:         ${adapter.paths.run_root}`,
    `    policy_allowlist: ${resolvedPaths.policyAllowlist}`,
    ...(adapter.paths.trust_model_doc
      ? [`    trust_model_doc:  ${adapter.paths.trust_model_doc}`]
      : []),
    "",
    "  Policy:",
    `    allowlist_type:           ${adapter.policy.allowlist_type}`,
    `    export_name:              ${adapter.policy.export_name}`,
    `    actor_keys:               ${adapter.policy.actor_keys.join(", ")}`,
    `    enforced_output_required: ${adapter.policy.enforced_output_required_actions.join(", ") || "(none)"}`,
    "",
    "  Prompts:",
    `    command=${adapter.prompts.command}  atlas=${adapter.prompts.atlas}  forge=${adapter.prompts.forge}  sentinel=${adapter.prompts.sentinel}  compass=${adapter.prompts.compass}`,
    "",
    "  Models:",
    `    command=${adapter.models.command}  atlas=${adapter.models.atlas}  forge=${adapter.models.forge}  sentinel=${adapter.models.sentinel}  compass=${adapter.models.compass}`,
    "",
    "  Governance (system_state_updates):",
    `    mode:                        ${ssu.mode}`,
    `    require_manual_approval_for: ${ssu.require_manual_approval_for.join(", ")}`,
    `    auto_apply_for:              ${ssu.auto_apply_for.join(", ")}`,
    "",
    "  Execution:",
    `    test_command: ${adapter.execution.test_command}`,
    "",
    "  Limits:",
    `    max_steps_per_run: ${adapter.limits.max_steps_per_run}`,
    "",
  ];

  process.stdout.write(lines.join("\n"));
}

function cmdStepReportDemo(): void {
  const demoReport: StepReportV1 = {
    schema_version: "1.0",
    run_id: "demo",
    step_id: "step-001",
    step_index: 0,
    actor: "forge",
    action: "forge.implement",
    success: true,
    status: "succeeded",
    summary: "Demo step report to verify artifact layout",
    artifacts: {
      result_path: "result.json",
    },
    output: { result: "demo" },
    tests: { passed: 13, total: 13 },
    state_impact: "none",
    timestamp: new Date().toISOString(),
  };

  // Validate
  const validated = validateStepReportV1(demoReport);
  if (!validated.ok) {
    process.stderr.write(
      `step-report-demo: validation failed [${validated.code}]\n  ${validated.message}\n`,
    );
    process.exit(1);
  }

  // Write under .agent-os/runs/
  const runRoot = resolve(".agent-os", "runs");
  const written = writeStepReport(runRoot, validated.report);
  if (!written.ok) {
    process.stderr.write(
      `step-report-demo: write failed [${written.code}]\n  ${written.message}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`step-report-demo: OK\n  written: ${written.path}\n`);
}

async function cmdRelayExport(argv: string[]): Promise<void> {
  const runId = getArg(argv, "--run");
  const step = getArg(argv, "--step");
  const artifactsRoot = getArg(argv, "--artifacts-root") ?? resolve(".agent-os", "runs");
  const outDir = getArg(argv, "--out");

  if (!runId || !step || !outDir) {
    process.stderr.write("relay export: --run, --step, and --out are required\n");
    process.exit(1);
  }

  const result = await relayExport({ runId, step, artifactsRoot: resolve(artifactsRoot), outDir: resolve(outDir) });
  if (!result.ok) {
    process.stderr.write(`relay export: FAILED [${result.code}]\n  ${result.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`relay export: OK\n  bundle: ${result.bundlePath}\n`);
}

async function cmdRelayImport(argv: string[]): Promise<void> {
  const bundlePath = getArg(argv, "--bundle");
  const artifactRoot = getArg(argv, "--into");
  const overwrite = argv.includes("--overwrite");

  if (!bundlePath || !artifactRoot) {
    process.stderr.write("relay import: --bundle and --into are required\n");
    process.exit(1);
  }

  const result = await relayImport({ bundlePath: resolve(bundlePath), artifactRoot: resolve(artifactRoot), overwrite });
  if (!result.ok) {
    process.stderr.write(`relay import: FAILED [${result.code}]\n  ${result.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`relay import: OK\n  files: ${result.files.length}\n`);
}

async function cmdRelayExportRun(argv: string[]): Promise<void> {
  const runId = getArg(argv, "--run-id");
  const runsRoot = getArg(argv, "--runs-root") ?? resolve(".agent-os", "runs");
  const outDir = getArg(argv, "--out");
  const overwrite = argv.includes("--overwrite");

  if (!runId || !outDir) {
    process.stderr.write("relay export-run: --run-id and --out are required\n");
    process.exit(1);
  }

  const result = await relayExportRun({
    runId,
    runsRoot: resolve(runsRoot),
    outDir: resolve(outDir),
    overwrite,
  });
  if (!result.ok) {
    process.stderr.write(`relay export-run: FAILED [${result.code}]\n  ${result.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`relay export-run: OK\n  bundle: ${result.bundlePath}\n`);
}

async function cmdRelayImportRun(argv: string[]): Promise<void> {
  // First positional argument after the subcommand name.
  const bundlePath = argv[2];
  const runsRoot = getArg(argv, "--into");
  const overwrite = argv.includes("--overwrite");

  if (!bundlePath || !runsRoot) {
    process.stderr.write("relay import-run: <bundle> and --into are required\n");
    process.exit(1);
  }

  const result = await relayImportRun({
    bundlePath: resolve(bundlePath),
    runsRoot: resolve(runsRoot),
    overwrite,
  });
  if (!result.ok) {
    process.stderr.write(`relay import-run: FAILED [${result.code}]\n  ${result.message}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `relay import-run: OK\n  run_id: ${result.runId}\n  files: ${result.files.length}\n`,
  );
}

// ── Slice 8: run ──────────────────────────────────────────────────────────────

/**
 * agent-os run --project <path> --plan <plan.json>
 *
 * Loads a PlanArtifact from a JSON file and executes it end-to-end via
 * executeRun. Prints a structured result summary to stdout on success,
 * or an error message to stderr and exits 1 on failure.
 *
 * AC-R3-08: executes and prints result summary
 * AC-R3-09: missing args → usage + exit 1
 */
async function cmdRun(argv: string[]): Promise<void> {
  const projectRaw = getArg(argv, "--project");
  const planPath = getArg(argv, "--plan");

  if (!projectRaw || !planPath) {
    process.stderr.write("run: --project and --plan are required\n");
    usage();
    process.exit(1);
  }

  const projectRoot = resolve(projectRaw);
  const resolvedPlan = resolve(planPath);

  // Load and parse plan artifact
  let planArtifact: PlanArtifact;
  try {
    const raw = await fs.readFile(resolvedPlan, "utf8");
    planArtifact = JSON.parse(raw) as PlanArtifact;
  } catch (err) {
    process.stderr.write(`run: failed to load plan from "${resolvedPlan}": ${String(err)}\n`);
    process.exit(1);
  }

  const result = await executeRun(planArtifact, projectRoot);

  if (result.ok) {
    const lines = [
      "agent-os run: COMPLETED",
      "",
      `  run_id:      ${result.run_id}`,
      `  step_count:  ${result.step_count}`,
      `  state:       ${result.ledger.state}`,
      "",
    ];
    if (result.step_reports.length > 0) {
      lines.push("  step reports:");
      for (const r of result.step_reports) {
        lines.push(`    [${r.step_index}] ${r.step_id}  →  ${r.path}`);
      }
      lines.push("");
    }
    process.stdout.write(lines.join("\n"));
  } else {
    const runLine = result.run_id ? `  run_id: ${result.run_id}\n` : "";
    process.stderr.write(
      `run: ${result.terminal_state} — ${result.reason}\n${runLine}`,
    );
    process.exit(1);
  }
}

// ── Slice 9: approve ──────────────────────────────────────────────────────────

function cmdRelayApprove(argv: string[]): void {
  const runId = getArg(argv, "--run");
  const stepRaw = getArg(argv, "--step");
  const approvedBy = getArg(argv, "--approved-by");
  const note = getArg(argv, "--note");
  const runsRoot = getArg(argv, "--runs-root") ?? resolve(".agent-os", "runs");

  if (!runId || !stepRaw || !approvedBy || !note) {
    process.stderr.write("relay approve: --run, --step, --approved-by, and --note are required\n");
    process.exit(1);
  }

  // Parse --step: if purely numeric treat as step_index, else step_id.
  // We need to locate the step directory to resolve both step_index and step_id.
  let step_index: number;
  let step_id: string;

  const parsed = Number(stepRaw);
  if (!Number.isNaN(parsed) && Number.isInteger(parsed) && parsed >= 0) {
    // Numeric: scan runs/<run_id>/steps/ for directory starting with <index>-
    step_index = parsed;
    const stepsDir = resolve(runsRoot, runId, "steps");
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    let found = false;
    try {
      for (const entry of readdirSync(stepsDir)) {
        if (entry.startsWith(`${step_index}-`)) {
          step_id = entry.slice(`${step_index}-`.length);
          found = true;
          break;
        }
      }
    } catch {
      // stepsDir doesn't exist
    }
    if (!found) {
      process.stderr.write(`relay approve: could not find step directory for index ${step_index}\n`);
      process.exit(1);
    }
    step_id = step_id!;
  } else {
    // step_id provided — scan for matching directory
    step_id = stepRaw;
    const stepsDir = resolve(runsRoot, runId, "steps");
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    let found = false;
    try {
      for (const entry of readdirSync(stepsDir)) {
        const dashIdx = entry.indexOf("-");
        if (dashIdx !== -1 && entry.slice(dashIdx + 1) === step_id) {
          step_index = Number(entry.slice(0, dashIdx));
          found = true;
          break;
        }
      }
    } catch {
      // stepsDir doesn't exist
    }
    if (!found) {
      process.stderr.write(`relay approve: could not find step directory for step_id "${step_id}"\n`);
      process.exit(1);
    }
    step_index = step_index!;
  }

  const result = writeApprovalArtifact({
    runsRoot: resolve(runsRoot),
    run_id: runId,
    step_index,
    step_id,
    approved_by: approvedBy,
    approval_note: note,
  });

  if (!result.ok) {
    process.stderr.write(`relay approve: FAILED [${result.code}]\n  ${result.message}\n`);
    process.exit(1);
  }

  process.stdout.write(`relay approve: OK\n  path: ${result.path}\n  sha256: ${result.sha256}\n`);
}

function cmdRelayResume(argv: string[]): void {
  // Stub: prints instruction. Actual dispatch is wired by the caller.
  const runId = getArg(argv, "--run");
  const stepRaw = getArg(argv, "--step");

  if (!runId || !stepRaw) {
    process.stderr.write("relay resume: --run and --step are required\n");
    process.exit(1);
  }

  process.stdout.write(
    `relay resume: dispatch point\n  run_id: ${runId}\n  step: ${stepRaw}\n` +
    "  (dispatchResume must be called programmatically with the full plan + deps)\n",
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  switch (command) {
    case "validate":
      cmdValidate(argv);
      break;
    case "step-report-demo":
      cmdStepReportDemo();
      break;
    case "run":
      await cmdRun(argv);
      break;
    case "relay": {
      const subcmd = argv[1];
      if (subcmd === "export") { await cmdRelayExport(argv); break; }
      if (subcmd === "import") { await cmdRelayImport(argv); break; }
      if (subcmd === "export-run") { await cmdRelayExportRun(argv); break; }
      if (subcmd === "import-run") { await cmdRelayImportRun(argv); break; }
      if (subcmd === "approve") { cmdRelayApprove(argv); break; }
      if (subcmd === "resume") { cmdRelayResume(argv); break; }
      process.stderr.write(`agent-os relay: unknown subcommand "${subcmd ?? ""}"\n`);
      usage(); process.exit(1);
    }
    default:
      process.stderr.write(
        command
          ? `agent-os: unknown command "${command}"\n`
          : "agent-os: command required\n",
      );
      usage();
      process.exit(1);
  }
}

main().catch((e) => { process.stderr.write(String(e) + "\n"); process.exit(1); });
