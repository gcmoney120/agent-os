/**
 * Agent OS v1.0 — Project Adapter Schema.
 *
 * Canonical TypeScript types for agent-os.project.json.
 * All fields are required unless noted. Enum values are exact strings.
 */

/** Trust change trigger conditions (open structure, v1.0). */
export interface TrustChangeTriggers {
  paths_globs: string[];
  keywords: string[];
  action_names: string[];
  always_require_sentinel_review_if_trust_change: boolean;
}

/** System-state update governance rules. */
export interface SystemStateUpdates {
  /** Must be exactly "hybrid" in v1.0. */
  mode: "hybrid";
  /** Must include "trust_change". */
  require_manual_approval_for: string[];
  /** Must include "trivial". */
  auto_apply_for: string[];
  trust_change_triggers: TrustChangeTriggers;
}

/** Fully validated project adapter — all fields present and type-checked. */
export interface ProjectAdapter {
  /** Must be exactly "1.0". */
  schema_version: "1.0";

  project: {
    name: string;
    slug: string;
    repo_root: string;
  };

  paths: {
    /** Path to SYSTEM_STATE.md, relative to projectRoot. */
    system_state: string;
    /** Root directory for agent run artifacts, relative to projectRoot. */
    run_root: string;
    /** Path to policy allowlist file, relative to projectRoot. */
    policy_allowlist: string;
    /** Path to trust model documentation, relative to projectRoot. Optional. */
    trust_model_doc?: string;
  };

  policy: {
    /** Must be exactly "ts_export_record" in v1.0. */
    allowlist_type: "ts_export_record";
    /** Name of the exported const to read from the allowlist file. */
    export_name: string;
    /** Keys identifying each actor in the system. */
    actor_keys: string[];
    enforced_output_required_actions: string[];
  };

  /** Prompt version tags per actor. */
  prompts: {
    command: string;
    atlas: string;
    forge: string;
    sentinel: string;
    compass: string;
  };

  /** Model identifiers per actor. */
  models: {
    command: string;
    atlas: string;
    forge: string;
    sentinel: string;
    compass: string;
  };

  governance: {
    system_state_updates: SystemStateUpdates;
  };

  execution: {
    test_command: string;
    /** Shell command to build the project. Optional in v1.0. */
    build_command?: string;
    /** Shell command to deploy the project. Optional in v1.0. */
    deploy_command?: string;
    /** Shell command to lint the project. Optional in v1.0. */
    lint_command?: string;
  };

  limits: {
    max_steps_per_run: number;
  };
}

/** Absolute paths resolved from the adapter's relative path fields. */
export interface ResolvedPaths {
  systemState: string;
  policyAllowlist: string;
}
