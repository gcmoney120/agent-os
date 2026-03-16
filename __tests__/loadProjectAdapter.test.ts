/**
 * Agent OS v1.0 — loadProjectAdapter tests (slice 1).
 *
 * Coverage:
 *   - Missing adapter file              → ADAPTER_NOT_FOUND
 *   - Wrong schema_version              → ADAPTER_INVALID_SCHEMA_VERSION
 *   - Missing required fields           → ADAPTER_MISSING_FIELD
 *   - Invalid enum values               → ADAPTER_INVALID_ENUM
 *   - actor_keys: duplicate keys        → ADAPTER_INVALID_ENUM
 *   - actor_keys: unknown key           → ADAPTER_INVALID_ENUM
 *   - governance.mode not hybrid        → ADAPTER_INVALID_ENUM
 *   - require_manual_approval_for gap   → ADAPTER_INVALID_ENUM
 *   - auto_apply_for gap                → ADAPTER_INVALID_ENUM
 *   - Path not found                    → ADAPTER_PATH_NOT_FOUND
 *   - Happy path                        → ok: true, all fields correct
 *   - Happy path (nested subdirs)       → ok: true, resolved paths correct
 *
 * Run: cd agent-os && npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadProjectAdapter } from "../src/adapter/loadProjectAdapter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal valid adapter JSON object conforming to the locked v1.0 schema. */
function validAdapter(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    project: { name: "Test Project", slug: "test-project", repo_root: "." },
    paths: {
      system_state: "state.md",
      run_root: "runs/",
      policy_allowlist: "policy.ts",
      trust_model_doc: "trust.md",
    },
    policy: {
      allowlist_type: "ts_export_record",
      export_name: "ALLOWED_ACTIONS",
      actor_keys: ["command", "atlas", "forge", "sentinel", "compass"],
      enforced_output_required_actions: ["forge.implement"],
    },
    prompts: { command: "v1.0", atlas: "v1.0", forge: "v1.0", sentinel: "v1.0", compass: "v1.0" },
    models: {
      command: "claude-latest",
      atlas: "claude-latest",
      forge: "claude-latest",
      sentinel: "claude-latest",
      compass: "claude-latest",
    },
    governance: {
      system_state_updates: {
        mode: "hybrid",
        require_manual_approval_for: ["trust_change", "phase_boundary"],
        auto_apply_for: ["trivial"],
        trust_change_triggers: {
          paths_globs: ["src/**"],
          keywords: ["ledger"],
          action_names: ["forge.implement"],
          always_require_sentinel_review_if_trust_change: true,
        },
      },
    },
    execution: { test_command: "npm test" },
    limits: { max_steps_per_run: 12 },
  };
}

/**
 * Create a temp project dir, write the adapter JSON, and create the two
 * path-validated files (state.md, policy.ts). Returns the temp dir path.
 */
function makeTempProject(adapterJson: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-test-"));
  writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(adapterJson, null, 2));
  writeFileSync(join(dir, "state.md"), "# state");
  writeFileSync(join(dir, "policy.ts"), "export const ALLOWED_ACTIONS = {};");
  return dir;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("missing adapter file → ADAPTER_NOT_FOUND", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-missing-"));
  try {
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_NOT_FOUND");
    assert.ok(result.message.includes("agent-os.project.json"), "message must name the file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wrong schema_version → ADAPTER_INVALID_SCHEMA_VERSION", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-ver-"));
  try {
    const json = { ...validAdapter(), schema_version: "2.0" };
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_INVALID_SCHEMA_VERSION");
    assert.ok(result.message.includes("2.0"), "message must echo the bad value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing project.name → ADAPTER_MISSING_FIELD", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-mf-"));
  try {
    const json = validAdapter();
    (json["project"] as Record<string, unknown>)["name"] = "";
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_MISSING_FIELD");
    assert.ok(result.message.includes("project.name"), "message must identify the field");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing paths object → ADAPTER_MISSING_FIELD", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-mf2-"));
  try {
    const json = validAdapter();
    delete (json as Record<string, unknown>)["paths"];
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_MISSING_FIELD");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid policy.allowlist_type → ADAPTER_INVALID_ENUM", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-enum-"));
  try {
    const json = validAdapter();
    (json["policy"] as Record<string, unknown>)["allowlist_type"] = "hardcoded";
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_INVALID_ENUM");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("actor_keys with duplicate → ADAPTER_INVALID_ENUM (length/uniqueness check)", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-dup-"));
  try {
    // 5 entries but 'forge' appears twice — length===5, Set.size===4
    const json = validAdapter();
    (json["policy"] as Record<string, unknown>)["actor_keys"] =
      ["command", "atlas", "forge", "forge", "compass"];
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_INVALID_ENUM");
    assert.ok(result.message.includes("5 unique"), "message must cite uniqueness requirement");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("actor_keys with unknown key → ADAPTER_INVALID_ENUM", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-extra-"));
  try {
    const json = validAdapter();
    (json["policy"] as Record<string, unknown>)["actor_keys"] =
      ["command", "atlas", "forge", "sentinel", "unknown_actor"];
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_INVALID_ENUM");
    assert.ok(result.message.includes("unknown_actor"), "message must name the offending key");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("governance.mode not hybrid → ADAPTER_INVALID_ENUM", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-mode-"));
  try {
    const json = validAdapter();
    ((json["governance"] as Record<string, unknown>)["system_state_updates"] as Record<string, unknown>)["mode"] = "manual";
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_INVALID_ENUM");
    assert.ok(result.message.includes("hybrid"), "message must state expected value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("require_manual_approval_for missing trust_change → ADAPTER_INVALID_ENUM", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-rma-"));
  try {
    const json = validAdapter();
    ((json["governance"] as Record<string, unknown>)["system_state_updates"] as Record<string, unknown>)["require_manual_approval_for"] = ["phase_boundary"];
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_INVALID_ENUM");
    assert.ok(result.message.includes("trust_change"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auto_apply_for missing trivial → ADAPTER_INVALID_ENUM", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-auto-"));
  try {
    const json = validAdapter();
    ((json["governance"] as Record<string, unknown>)["system_state_updates"] as Record<string, unknown>)["auto_apply_for"] = ["other"];
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json));
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_INVALID_ENUM");
    assert.ok(result.message.includes("trivial"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("path does not exist → ADAPTER_PATH_NOT_FOUND", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-path-"));
  try {
    // Write adapter but do NOT create the referenced files.
    writeFileSync(
      join(dir, "agent-os.project.json"),
      JSON.stringify(validAdapter(), null, 2),
    );
    const result = loadProjectAdapter(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ADAPTER_PATH_NOT_FOUND");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("happy path: loads valid adapter — all fields correct", () => {
  const dir = makeTempProject(validAdapter());
  try {
    const result = loadProjectAdapter(dir);
    assert.ok(result.ok, `expected ok but got [${result.ok ? "" : result.code}] ${result.ok ? "" : result.message}`);
    if (!result.ok) return;

    const { adapter, resolvedPaths } = result;

    // Project
    assert.strictEqual(adapter.schema_version, "1.0");
    assert.strictEqual(adapter.project.name, "Test Project");
    assert.strictEqual(adapter.project.slug, "test-project");
    assert.strictEqual(adapter.project.repo_root, ".");

    // Policy
    assert.strictEqual(adapter.policy.allowlist_type, "ts_export_record");
    assert.strictEqual(adapter.policy.export_name, "ALLOWED_ACTIONS");
    assert.deepStrictEqual(
      [...adapter.policy.actor_keys].sort(),
      ["atlas", "command", "compass", "forge", "sentinel"],
    );
    assert.deepStrictEqual(adapter.policy.enforced_output_required_actions, ["forge.implement"]);

    // Prompts + Models
    assert.strictEqual(adapter.prompts.forge, "v1.0");
    assert.strictEqual(adapter.models.forge, "claude-latest");

    // Governance
    const ssu = adapter.governance.system_state_updates;
    assert.strictEqual(ssu.mode, "hybrid");
    assert.ok(ssu.require_manual_approval_for.includes("trust_change"));
    assert.ok(ssu.auto_apply_for.includes("trivial"));
    assert.strictEqual(ssu.trust_change_triggers.always_require_sentinel_review_if_trust_change, true);

    // Execution + Limits
    assert.strictEqual(adapter.execution.test_command, "npm test");
    assert.strictEqual(adapter.limits.max_steps_per_run, 12);

    // Resolved paths are absolute and end with the right filenames
    assert.ok(resolvedPaths.systemState.endsWith("state.md"), "systemState must resolve to state.md");
    assert.ok(resolvedPaths.policyAllowlist.endsWith("policy.ts"), "policyAllowlist must resolve to policy.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("happy path: adapter with nested subdirectory paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-sub-"));
  try {
    mkdirSync(join(dir, ".claude", "docs", "ops"), { recursive: true });
    writeFileSync(join(dir, ".claude", "docs", "ops", "SYSTEM_STATE.md"), "# State");
    mkdirSync(join(dir, "src", "policy"), { recursive: true });
    writeFileSync(join(dir, "src", "policy", "policy.ts"), "export const ALLOWED_ACTIONS = {};");

    const json = {
      ...validAdapter(),
      paths: {
        system_state: ".claude/docs/ops/SYSTEM_STATE.md",
        run_root: ".agent-os/runs",
        policy_allowlist: "src/policy/policy.ts",
      },
    };
    writeFileSync(join(dir, "agent-os.project.json"), JSON.stringify(json, null, 2));

    const result = loadProjectAdapter(dir);
    assert.ok(result.ok, `expected ok but got [${result.ok ? "" : result.code}] ${result.ok ? "" : result.message}`);
    if (!result.ok) return;
    assert.ok(result.resolvedPaths.systemState.includes("SYSTEM_STATE.md"));
    assert.ok(result.resolvedPaths.policyAllowlist.includes("policy.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
