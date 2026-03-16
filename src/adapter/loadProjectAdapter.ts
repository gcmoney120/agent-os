/**
 * Agent OS v1.0 — Project Adapter Loader.
 *
 * Reads <projectRoot>/agent-os.project.json, validates all required fields
 * and enum values, checks that referenced paths exist, and returns a
 * typed ProjectAdapter on success.
 *
 * Never throws — all errors are returned as structured { ok: false } results.
 *
 * Error codes:
 *   ADAPTER_NOT_FOUND              — file missing or unreadable
 *   ADAPTER_PARSE_ERROR            — not valid JSON
 *   ADAPTER_INVALID_SCHEMA_VERSION — schema_version !== "1.0"
 *   ADAPTER_MISSING_FIELD          — required field absent or wrong type
 *   ADAPTER_INVALID_ENUM           — field present but value not in allowed set
 *   ADAPTER_PATH_NOT_FOUND         — resolved path does not exist on disk
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectAdapter, ResolvedPaths } from "./schema.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type LoadAdapterResult =
  | { ok: true; adapter: ProjectAdapter; resolvedPaths: ResolvedPaths }
  | { ok: false; code: string; message: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const ADAPTER_FILENAME = "agent-os.project.json";

/** Exact set of actor keys required in v1.0. Order-independent. */
const REQUIRED_ACTOR_KEYS = new Set(["command", "atlas", "forge", "sentinel", "compass"]);
const ACTOR_KEYS = ["command", "atlas", "forge", "sentinel", "compass"] as const;

// ── Loader ────────────────────────────────────────────────────────────────────

export function loadProjectAdapter(projectRoot: string): LoadAdapterResult {
  const adapterPath = join(projectRoot, ADAPTER_FILENAME);

  // ── Read ──────────────────────────────────────────────────────────────────
  let raw: string;
  try {
    raw = readFileSync(adapterPath, "utf8");
  } catch {
    return {
      ok: false,
      code: "ADAPTER_NOT_FOUND",
      message: `adapter file not found: ${adapterPath}`,
    };
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      code: "ADAPTER_PARSE_ERROR",
      message: `adapter is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!isObject(parsed)) {
    return { ok: false, code: "ADAPTER_PARSE_ERROR", message: "adapter must be a JSON object" };
  }

  const obj = parsed;

  // ── schema_version ────────────────────────────────────────────────────────
  if (obj["schema_version"] !== "1.0") {
    return {
      ok: false,
      code: "ADAPTER_INVALID_SCHEMA_VERSION",
      message: `schema_version must be "1.0", got: ${JSON.stringify(obj["schema_version"])}`,
    };
  }

  // ── project ───────────────────────────────────────────────────────────────
  if (!isObject(obj["project"])) {
    return field("project must be an object");
  }
  const project = obj["project"];
  if (!nonEmptyString(project["name"])) {
    return field("project.name must be a non-empty string");
  }
  if (!nonEmptyString(project["slug"])) {
    return field("project.slug must be a non-empty string");
  }
  // repo_root is informational in v1.0; the projectRoot argument passed to this
  // function is the authoritative project root used for all path resolution.
  if (!nonEmptyString(project["repo_root"])) {
    return field("project.repo_root must be a non-empty string");
  }

  // ── paths ─────────────────────────────────────────────────────────────────
  if (!isObject(obj["paths"])) {
    return field("paths must be an object");
  }
  const paths = obj["paths"];
  if (!nonEmptyString(paths["system_state"])) {
    return field("paths.system_state must be a non-empty string");
  }
  if (!nonEmptyString(paths["run_root"])) {
    return field("paths.run_root must be a non-empty string");
  }
  if (!nonEmptyString(paths["policy_allowlist"])) {
    return field("paths.policy_allowlist must be a non-empty string");
  }
  // trust_model_doc is optional — validate only if present
  if ("trust_model_doc" in paths && !nonEmptyString(paths["trust_model_doc"])) {
    return field("paths.trust_model_doc must be a non-empty string when present");
  }

  // ── policy ────────────────────────────────────────────────────────────────
  if (!isObject(obj["policy"])) {
    return field("policy must be an object");
  }
  const policy = obj["policy"];
  if (policy["allowlist_type"] !== "ts_export_record") {
    return {
      ok: false,
      code: "ADAPTER_INVALID_ENUM",
      message: `policy.allowlist_type must be "ts_export_record", got: ${JSON.stringify(policy["allowlist_type"])}`,
    };
  }
  if (!nonEmptyString(policy["export_name"])) {
    return field("policy.export_name must be a non-empty string");
  }
  // actor_keys must be exactly the five canonical actor keys — no more, no fewer, no duplicates.
  if (!stringArray(policy["actor_keys"])) {
    return field("policy.actor_keys must be a string array");
  }
  {
    const keys = policy["actor_keys"];
    if (keys.length !== 5 || new Set(keys).size !== 5) {
      return {
        ok: false,
        code: "ADAPTER_INVALID_ENUM",
        message: "policy.actor_keys must contain exactly 5 unique keys",
      };
    }
    const keySet = new Set(keys);
    const extra = keys.filter((k) => !REQUIRED_ACTOR_KEYS.has(k));
    const missing = [...REQUIRED_ACTOR_KEYS].filter((k) => !keySet.has(k));
    if (extra.length > 0) {
      return {
        ok: false,
        code: "ADAPTER_INVALID_ENUM",
        message: `policy.actor_keys contains unknown keys: ${extra.join(", ")}`,
      };
    }
    if (missing.length > 0) {
      return {
        ok: false,
        code: "ADAPTER_INVALID_ENUM",
        message: `policy.actor_keys is missing required keys: ${missing.join(", ")}`,
      };
    }
  }
  if (!stringArray(policy["enforced_output_required_actions"])) {
    return field("policy.enforced_output_required_actions must be a string array");
  }

  // ── prompts ───────────────────────────────────────────────────────────────
  if (!isObject(obj["prompts"])) {
    return field("prompts must be an object");
  }
  const prompts = obj["prompts"];
  for (const key of ACTOR_KEYS) {
    if (!nonEmptyString(prompts[key])) {
      return field(`prompts.${key} must be a non-empty string`);
    }
  }

  // ── models ────────────────────────────────────────────────────────────────
  if (!isObject(obj["models"])) {
    return field("models must be an object");
  }
  const models = obj["models"];
  for (const key of ACTOR_KEYS) {
    if (!nonEmptyString(models[key])) {
      return field(`models.${key} must be a non-empty string`);
    }
  }

  // ── governance ────────────────────────────────────────────────────────────
  if (!isObject(obj["governance"])) {
    return field("governance must be an object");
  }
  const governance = obj["governance"];
  if (!isObject(governance["system_state_updates"])) {
    return field("governance.system_state_updates must be an object");
  }
  const ssu = governance["system_state_updates"];
  if (ssu["mode"] !== "hybrid") {
    return {
      ok: false,
      code: "ADAPTER_INVALID_ENUM",
      message: `governance.system_state_updates.mode must be "hybrid", got: ${JSON.stringify(ssu["mode"])}`,
    };
  }
  if (!stringArray(ssu["require_manual_approval_for"])) {
    return field("governance.system_state_updates.require_manual_approval_for must be a string array");
  }
  if (!ssu["require_manual_approval_for"].includes("trust_change")) {
    return {
      ok: false,
      code: "ADAPTER_INVALID_ENUM",
      message: 'governance.system_state_updates.require_manual_approval_for must include "trust_change"',
    };
  }
  if (!stringArray(ssu["auto_apply_for"])) {
    return field("governance.system_state_updates.auto_apply_for must be a string array");
  }
  if (!ssu["auto_apply_for"].includes("trivial")) {
    return {
      ok: false,
      code: "ADAPTER_INVALID_ENUM",
      message: 'governance.system_state_updates.auto_apply_for must include "trivial"',
    };
  }
  if (!isObject(ssu["trust_change_triggers"])) {
    return field("governance.system_state_updates.trust_change_triggers must be an object");
  }
  const tct = ssu["trust_change_triggers"];
  // Strictly validate every field in trust_change_triggers — no silent defaults.
  if (!stringArray(tct["paths_globs"])) {
    return field("governance.system_state_updates.trust_change_triggers.paths_globs must be a string array");
  }
  if (!stringArray(tct["keywords"])) {
    return field("governance.system_state_updates.trust_change_triggers.keywords must be a string array");
  }
  if (!stringArray(tct["action_names"])) {
    return field("governance.system_state_updates.trust_change_triggers.action_names must be a string array");
  }
  if (typeof tct["always_require_sentinel_review_if_trust_change"] !== "boolean") {
    return field(
      "governance.system_state_updates.trust_change_triggers.always_require_sentinel_review_if_trust_change must be a boolean",
    );
  }

  // ── execution ─────────────────────────────────────────────────────────────
  if (!isObject(obj["execution"])) {
    return field("execution must be an object");
  }
  const execution = obj["execution"];
  if (!nonEmptyString(execution["test_command"])) {
    return field("execution.test_command must be a non-empty string");
  }

  // ── limits ────────────────────────────────────────────────────────────────
  if (!isObject(obj["limits"])) {
    return field("limits must be an object");
  }
  const limits = obj["limits"];
  if (typeof limits["max_steps_per_run"] !== "number" || limits["max_steps_per_run"] <= 0) {
    return field("limits.max_steps_per_run must be a positive number");
  }

  // ── Path existence ────────────────────────────────────────────────────────
  const resolvedSystemState = resolve(projectRoot, paths["system_state"] as string);
  const resolvedPolicyAllowlist = resolve(projectRoot, paths["policy_allowlist"] as string);

  if (!existsSync(resolvedSystemState)) {
    return {
      ok: false,
      code: "ADAPTER_PATH_NOT_FOUND",
      message: `paths.system_state does not exist: ${resolvedSystemState}`,
    };
  }
  if (!existsSync(resolvedPolicyAllowlist)) {
    return {
      ok: false,
      code: "ADAPTER_PATH_NOT_FOUND",
      message: `paths.policy_allowlist does not exist: ${resolvedPolicyAllowlist}`,
    };
  }

  // ── Build typed result ────────────────────────────────────────────────────
  const adapter: ProjectAdapter = {
    schema_version: "1.0",
    project: {
      name: project["name"] as string,
      slug: project["slug"] as string,
      repo_root: project["repo_root"] as string,
    },
    paths: {
      system_state: paths["system_state"] as string,
      run_root: paths["run_root"] as string,
      policy_allowlist: paths["policy_allowlist"] as string,
      ...(nonEmptyString(paths["trust_model_doc"]) ? { trust_model_doc: paths["trust_model_doc"] } : {}),
    },
    policy: {
      allowlist_type: "ts_export_record",
      export_name: policy["export_name"] as string,
      actor_keys: policy["actor_keys"] as string[],
      enforced_output_required_actions: policy["enforced_output_required_actions"] as string[],
    },
    prompts: {
      command: prompts["command"] as string,
      atlas: prompts["atlas"] as string,
      forge: prompts["forge"] as string,
      sentinel: prompts["sentinel"] as string,
      compass: prompts["compass"] as string,
    },
    models: {
      command: models["command"] as string,
      atlas: models["atlas"] as string,
      forge: models["forge"] as string,
      sentinel: models["sentinel"] as string,
      compass: models["compass"] as string,
    },
    governance: {
      system_state_updates: {
        mode: "hybrid",
        require_manual_approval_for: ssu["require_manual_approval_for"] as string[],
        auto_apply_for: ssu["auto_apply_for"] as string[],
        trust_change_triggers: {
          paths_globs: tct["paths_globs"] as string[],
          keywords: tct["keywords"] as string[],
          action_names: tct["action_names"] as string[],
          always_require_sentinel_review_if_trust_change:
            tct["always_require_sentinel_review_if_trust_change"] as boolean,
        },
      },
    },
    execution: {
      test_command: execution["test_command"] as string,
    },
    limits: {
      max_steps_per_run: limits["max_steps_per_run"] as number,
    },
  };

  return {
    ok: true,
    adapter,
    resolvedPaths: {
      systemState: resolvedSystemState,
      policyAllowlist: resolvedPolicyAllowlist,
    },
  };
}

// ── Type guards ───────────────────────────────────────────────────────────────

function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

function nonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim() !== "";
}

function stringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((item) => typeof item === "string");
}

function field(message: string): { ok: false; code: string; message: string } {
  return { ok: false, code: "ADAPTER_MISSING_FIELD", message };
}
