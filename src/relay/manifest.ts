export const RELAY_FORMAT_VERSION = "1" as const;

export interface RelayManifestFile {
  path: string;   // relative path within bundle
  sha256: string; // hex lowercase
  bytes: number;  // integer
}

export interface RelayManifestV1 {
  relay_format_version: "1";
  run_id: string;
  step_index: number;
  step_id: string;
  actor: string;
  action: string;
  files: RelayManifestFile[];   // all bundled files EXCEPT relay-manifest.json
  review_targets: string[];     // relative paths
}

// ── Run-level relay manifest (Slice 7) ────────────────────────────────────────

export const RUN_RELAY_FORMAT_VERSION = "1" as const;

export interface RunRelayManifestFile {
  path: string;   // relative path within the run directory
  sha256: string; // hex lowercase
  bytes: number;  // integer
}

export interface RunRelayManifestV1 {
  relay_format_version: "1";
  run_id: string;
  files: RunRelayManifestFile[];  // all bundled files EXCEPT run-relay-manifest.json
}
